'use strict';
/*
 * Beans&Beats queue server. Zero-framework Node HTTP server.
 *  - Append-only op log (data/ops.ndjson) replayed into memory on boot
 *  - POST /api/sync : clients push queued ops, pull everything they missed
 *  - GET  /api/stream : Server-Sent Events, live fan-out of new ops
 *  - GET  /api/track/:token : public guest status (no auth, unguessable token)
 *  - Web Push when an order turns "ready"
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('./public/shared/core.js');
const seedMenu = require('./seed-menu.js');

let webpush = null;
try { webpush = require('web-push'); } catch (e) { console.warn('web-push not installed; push alerts disabled'); }

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const BARISTA_PIN = String(process.env.BARISTA_PIN || '1111');
const LEAD_PIN = String(process.env.LEAD_PIN || '9999');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const OPS_FILE = path.join(DATA_DIR, 'ops.ndjson');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const PUSH_FILE = path.join(DATA_DIR, 'push.json');
const EPOCH_FILE = path.join(DATA_DIR, 'epoch.txt');
// The epoch changes whenever the op log is wiped (full reset), so tablets know
// to throw away their cached copy instead of waiting for ops that never come.
if (!fs.existsSync(OPS_FILE) || !fs.existsSync(EPOCH_FILE)) fs.writeFileSync(EPOCH_FILE, crypto.randomBytes(6).toString('hex'));
const EPOCH = fs.readFileSync(EPOCH_FILE, 'utf8').trim();

// ---------- secrets (token signing + VAPID), generated once and persisted ----------
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch (e) { /* first boot */ }
if (!secrets.hmac) secrets.hmac = crypto.randomBytes(32).toString('hex');
if (webpush && !secrets.vapid) secrets.vapid = webpush.generateVAPIDKeys();
fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
const HMAC = process.env.SESSION_SECRET || secrets.hmac;
const VAPID = process.env.VAPID_PUBLIC_KEY
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : secrets.vapid;
if (webpush && VAPID) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:general@beansnbeats.com', VAPID.publicKey, VAPID.privateKey);

// ---------- state ----------
const state = Core.emptyState();
let log = [];             // [{seq, ...op}]
const seen = new Set();   // opIds already applied (idempotency)
let seq = 0;
let dirtyPII = false;

function loadLog() {
  if (!fs.existsSync(OPS_FILE)) return;
  const lines = fs.readFileSync(OPS_FILE, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const op = JSON.parse(line);
      seq = Math.max(seq, op.seq);
      seen.add(op.opId);
      Core.apply(state, op);
      log.push(op);
    } catch (e) { console.warn('skipping corrupt log line'); }
  }
}

function persist(op) { fs.appendFileSync(OPS_FILE, JSON.stringify(op) + '\n'); }

function commit(op) {
  if (seen.has(op.opId)) return null;
  seen.add(op.opId);
  const before = op.type === 'order.status' && state.orders[op.payload.id] ? state.orders[op.payload.id].status : null;
  const changed = Core.apply(state, op);
  const entry = Object.assign({ seq: ++seq }, op);
  log.push(entry);
  persist(entry);
  if (op.type === 'order.create' && op.payload.mobile) dirtyPII = true;
  if (op.type === 'day.close') scrubPII();
  if (changed && op.type === 'order.status') {
    const o = state.orders[op.payload.id];
    if (o.status === 'ready' && before !== 'ready') notifyReady(o);
    if (o.status === 'collected' || o.status === 'cancelled') { if (pushSubs[o.token]) { delete pushSubs[o.token]; savePush(); } }
  }
  return entry;
}

// Rewrite the op log so personal data that the reducer has already dropped
// (names after day close, mobiles after pickup) also disappears from disk.
function scrubPII() {
  log = log.map((op) => {
    if (op.type !== 'order.create') return op;
    const o = state.orders[op.payload.id];
    if (!o) return op;
    const payload = Object.assign({}, op.payload);
    if (o.name == null) payload.name = null;
    if (o.mobile == null) payload.mobile = null;
    return Object.assign({}, op, { payload });
  });
  const tmp = OPS_FILE + '.tmp';
  fs.writeFileSync(tmp, log.map((o) => JSON.stringify(o)).join('\n') + (log.length ? '\n' : ''));
  fs.renameSync(tmp, OPS_FILE);
  for (const t in pushSubs) {
    const o = Object.values(state.orders).find((x) => x.token === t);
    if (!o || o.name == null) delete pushSubs[t];
  }
  savePush();
  dirtyPII = false;
}
setInterval(() => { if (dirtyPII) scrubPII(); }, 10 * 60 * 1000).unref();

// ---------- push subscriptions (token -> [subscription]) ----------
let pushSubs = {};
try { pushSubs = JSON.parse(fs.readFileSync(PUSH_FILE, 'utf8')); } catch (e) { pushSubs = {}; }
function savePush() { fs.writeFileSync(PUSH_FILE, JSON.stringify(pushSubs)); }
function notifyReady(o) {
  const subs = pushSubs[o.token];
  if (!webpush || !subs || !subs.length) return;
  const body = JSON.stringify({
    title: 'Order ' + Core.fmtNo(o.no) + ' is ready',
    body: (o.name ? o.name + ', y' : 'Y') + 'our drink is ready. Pick it up at the Beans&Beats counter.',
    url: '/o/' + o.token,
    tag: 'order-' + o.token,
  });
  for (const sub of subs) {
    webpush.sendNotification(sub, body, { TTL: 600, urgency: 'high' }).catch((err) => {
      if (err.statusCode === 404 || err.statusCode === 410) {
        pushSubs[o.token] = (pushSubs[o.token] || []).filter((s) => s.endpoint !== sub.endpoint); savePush();
      }
    });
  }
}

// ---------- seed menu on first boot ----------
loadLog();
if (!Object.keys(state.menu.items).length) {
  const now = Date.now();
  seedMenu.forEach((m, i) => commit({ opId: 'seed-' + m.kind + '-' + m.id, type: 'menu.upsert', at: now + i, device: 'server',
    payload: { kind: m.kind, id: m.id, data: m.data } }));
  commit({ opId: 'seed-settings', type: 'settings.update', at: now, device: 'server', payload: { credit: 'Queue system built for Beans&Beats × Christmas Together 2026', icedSurcharge: 100 } });
}

// ---------- auth ----------
function sign(role) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days, survives the event weekend offline
  const body = role + '.' + exp;
  return body + '.' + crypto.createHmac('sha256', HMAC).update(body).digest('base64url');
}
function verify(tok) {
  if (!tok) return null;
  const [role, exp, mac] = String(tok).split('.');
  if (!role || !exp || !mac) return null;
  const want = crypto.createHmac('sha256', HMAC).update(role + '.' + exp).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  if (Number(exp) < Date.now()) return null;
  return Core.ROLE_OPS[role] ? role : null;
}
function authOf(req, url) {
  const h = req.headers.authorization || '';
  return verify(h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('auth'));
}

// ---------- SSE ----------
const streams = new Set();
function broadcast(entries) {
  if (!entries.length) return;
  const msg = 'event: ops\ndata: ' + JSON.stringify(entries) + '\n\n';
  for (const res of streams) res.write(msg);
}
setInterval(() => { for (const res of streams) res.write(': ping\n\n'); }, 20000).unref();

// ---------- helpers ----------
const MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function send(res, code, body, type, extra) {
  const headers = Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }, extra || {});
  res.writeHead(code, headers);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > (limit || 1e6)) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cache || 'no-cache' });
  });
}
// Streams the demo film with byte ranges so every browser can seek and play it.
function serveVideo(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const base = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, Object.assign({ 'Content-Length': st.size }, base)); return fs.createReadStream(file).pipe(res); }
    let start = m[1] ? +m[1] : st.size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (!m[1]) start = Math.max(0, start);
    if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
    res.writeHead(206, Object.assign({ 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size, 'Content-Length': end - start + 1 }, base));
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}
function publicOrder(o) {
  const ahead = o.status === 'queued' || o.status === 'making'
    ? Object.values(state.orders).filter((x) => (x.status === 'queued' || x.status === 'making') && x.createdAt < o.createdAt).length
    : 0;
  const t = Date.now();
  const imp = Core.impact(state, t);
  return { no: Core.fmtNo(o.no), name: o.name, items: Core.describeItems(o), cups: Core.orderCups(o), status: o.status, times: o.times, ahead,
    etaMs: Core.eta(state, o, t), impact: { cups: imp.cups, total: imp.total, goal: imp.goal }, now: t };
}
// Ops the server is willing to accept from a client of a given role.
function validOp(op, role) {
  if (!op || typeof op.opId !== 'string' || op.opId.length > 64 || typeof op.type !== 'string') return false;
  if (!Core.ROLE_OPS[role].includes(op.type)) return false;
  if (typeof op.at !== 'number' || !isFinite(op.at)) return false;
  if (!op.payload || typeof op.payload !== 'object') return false;
  if (op.type === 'order.create') {
    const p = op.payload;
    if (typeof p.id !== 'string' || typeof p.token !== 'string' || p.token.length < 16 || !Number.isInteger(p.no)) return false;
    if (!Array.isArray(p.items) || !p.items.length || p.items.length > 20) return false;
    if (p.mobile && !/^\+?\d{8,15}$/.test(String(p.mobile).replace(/\s/g, ''))) p.mobile = null;
    if (p.mobile && !p.consent) p.mobile = null; // PDPA: no consent, no mobile
  }
  return true;
}

// ---------- routes ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, seq, orders: Object.keys(state.orders).length });

    if (p === '/api/login' && req.method === 'POST') {
      const { pin } = await readBody(req, 1e3);
      const role = String(pin) === LEAD_PIN ? 'lead' : String(pin) === BARISTA_PIN ? 'barista' : null;
      if (!role) { await new Promise((r) => setTimeout(r, 600)); return send(res, 401, { error: 'Wrong PIN' }); }
      return send(res, 200, { role, token: sign(role) });
    }

    if (p === '/api/state' && req.method === 'GET') {
      if (!authOf(req, url)) return send(res, 401, { error: 'auth' });
      return send(res, 200, { epoch: EPOCH, seq, state, now: Date.now(), vapid: VAPID && VAPID.publicKey });
    }

    if (p === '/api/sync' && req.method === 'POST') {
      const role = authOf(req, url);
      if (!role) return send(res, 401, { error: 'auth' });
      const body = await readBody(req, 2e6);
      const acked = []; const fresh = [];
      const now = Date.now();
      for (const op of (Array.isArray(body.ops) ? body.ops : []).slice(0, 2000)) {
        if (seen.has(op && op.opId)) { acked.push(op.opId); continue; }
        if (!validOp(op, role)) { acked.push(op && op.opId); continue; } // drop invalid so the outbox can't jam
        op.at = Math.min(op.at, now + 60000); // a fast device clock can't win LWW for ever
        const e = commit({ opId: op.opId, type: op.type, at: op.at, device: String(op.device || '').slice(0, 40), payload: op.payload });
        acked.push(op.opId);
        if (e) fresh.push(e);
      }
      broadcast(fresh);
      const since = Number(body.since) || 0;
      const missed = since >= seq ? [] : log.filter((e) => e.seq > since);
      return send(res, 200, { epoch: EPOCH, acked, seq, ops: missed, now });
    }

    if (p === '/api/stream') {
      if (!authOf(req, url)) return send(res, 401, { error: 'auth' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\nevent: hello\ndata: ' + JSON.stringify({ seq }) + '\n\n');
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    let m;
    if ((m = p.match(/^\/api\/track\/([A-Za-z0-9_-]{16,64})$/)) && req.method === 'GET') {
      const o = Object.values(state.orders).find((x) => x.token === m[1]);
      if (!o) return send(res, 404, { status: 'unknown' });
      return send(res, 200, publicOrder(o));
    }

    if ((m = p.match(/^\/api\/push\/([A-Za-z0-9_-]{16,64})$/)) && req.method === 'POST') {
      const sub = await readBody(req, 5e3);
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return send(res, 400, { error: 'bad sub' });
      const list = (pushSubs[m[1]] || []).filter((s) => s.endpoint !== sub.endpoint);
      list.push({ endpoint: sub.endpoint, keys: sub.keys });
      pushSubs[m[1]] = list.slice(-3);
      savePush();
      const o = Object.values(state.orders).find((x) => x.token === m[1]);
      if (o && o.status === 'ready') notifyReady(o); // subscribed late but already ready
      return send(res, 200, { ok: true });
    }

    if (p === '/api/menu') {
      const items = Object.values(state.menu.items).filter((i) => !i.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0))
        .map((i) => ({ name: i.name, price: i.price, temps: i.temps, milk: i.milk, soldOut: !!i.soldOut }));
      const milks = Object.values(state.menu.milks).filter((m) => !m.deleted).map((m) => ({ name: m.name, surcharge: m.surcharge || 0, soldOut: !!m.soldOut }));
      return send(res, 200, { items, milks, icedSurcharge: state.settings.icedSurcharge || 0 });
    }
    if (p === '/api/vapid') return send(res, 200, { key: VAPID ? VAPID.publicKey : null });

    if (p === '/api/report.csv' || p === '/api/days.csv') {
      const role = authOf(req, url);
      if (role !== 'lead') return send(res, 401, 'Booth lead login required', 'text/plain');
      const day = url.searchParams.get('day') || Core.sgDay();
      const csv = p === '/api/days.csv' ? Core.daysCsv(state) : Core.reportCsv(state, day);
      const name = p === '/api/days.csv' ? 'beansbeats-all-days.csv' : 'beansbeats-sales-' + day + '.csv';
      return send(res, 200, '﻿' + csv, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="' + name + '"' });
    }

    // ---------- static ----------
    if (p === '/vendor/qrcode.js') return serveFile(res, require.resolve('qrcode-generator/qrcode.js'), 'public, max-age=86400');
    if (p === '/vendor/fonts/archivo.woff2') return serveFile(res, require.resolve('@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'), 'public, max-age=604800');
    let vm;
    if ((vm = p.match(/^\/vendor\/ph\/(bold|fill)\/(style\.css|Phosphor-(?:Bold|Fill)\.woff2?)$/))) {
      return serveFile(res, path.join(__dirname, 'node_modules', '@phosphor-icons', 'web', 'src', vm[1], vm[2]), 'public, max-age=604800');
    }
    if (p === '/vendor/jsqr.js') return serveFile(res, require.resolve('jsqr/dist/jsQR.js'), 'public, max-age=86400');
    if (p === '/m') return serveFile(res, path.join(PUBLIC_DIR, 'menu.html'));
    if (p === '/demo') return serveFile(res, path.join(PUBLIC_DIR, 'demo.html'));
    if (p === '/film') return serveFile(res, path.join(PUBLIC_DIR, 'film.html'));
    if (p === '/film.mp4') return serveVideo(req, res, path.join(__dirname, 'docs', 'demo.mp4'));
    if (p.startsWith('/o/')) return serveFile(res, path.join(PUBLIC_DIR, 'guest.html'));
    if (p === '/' || p === '/board' || p === '/queue' || p === '/order' || p === '/menu' || p === '/report' || p === '/display') return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    const file = path.normalize(path.join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    return serveFile(res, file, p === '/sw.js' ? 'no-cache' : undefined);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 400, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log('Beans&Beats queue on http://localhost:' + PORT + '  (data: ' + DATA_DIR + ')');
  if (!process.env.BARISTA_PIN || !process.env.LEAD_PIN) console.log('Using default PINs barista=1111 lead=9999. Set BARISTA_PIN / LEAD_PIN in production.');
});

module.exports = { server, state };
