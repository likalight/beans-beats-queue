// End-to-end smoke test: boots the server on a temp data dir and exercises
// login, offline-style batched sync, idempotency, LWW conflicts, guest
// tracking, CSV export and the end-of-day PII wipe. Run: npm test
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const Core = require('../public/shared/core.js');

const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-test-'));
const base = 'http://localhost:' + PORT;
let proc;

function start() {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: DATA }), stdio: 'pipe' });
  return new Promise((res) => proc.stdout.on('data', (d) => { if (String(d).includes('queue on')) res(); }));
}
function stop() { return new Promise((res) => { proc.on('exit', res); proc.kill(); }); }
async function j(p, opts, tok) {
  const r = await fetch(base + p, Object.assign({ headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}) }, opts));
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch (e) { return { status: r.status, body: t }; }
}
const op = (type, payload, at) => ({ opId: Math.random().toString(36).slice(2) + Date.now(), type, at: at || Date.now(), device: 'test', payload });

(async () => {
  await start();
  try {
    assert.strictEqual((await j('/api/login', { method: 'POST', body: '{"pin":"0000"}' })).status, 401);
    const bar = (await j('/api/login', { method: 'POST', body: '{"pin":"1111"}' })).body;
    const lead = (await j('/api/login', { method: 'POST', body: '{"pin":"9999"}' })).body;
    assert.strictEqual(bar.role, 'barista'); assert.strictEqual(lead.role, 'lead');

    const st = (await j('/api/state', {}, bar.token)).body;
    assert.ok(st.state.menu.items.latte, 'seed menu present');
    assert.strictEqual(st.state.menu.items.latte.price, 800);

    // Two orders created "offline", sent in one batch, sent twice (retry) -> applied once.
    const tok1 = 'tok_' + 'a'.repeat(20), tok2 = 'tok_' + 'b'.repeat(20);
    const o1 = op('order.create', { id: 'o1', no: 1, token: tok1, name: 'Mei', mobile: '91234567', consent: true, pay: 'paynow',
      items: [{ itemId: 'flatwhite', name: 'Flat White', price: 900, qty: 1, temp: 'hot', milkId: 'oat', milkName: 'Oat' }] }, Date.now() - 5000);
    const o2 = op('order.create', { id: 'o2', no: 2, token: tok2, name: 'Jon', pay: 'card',
      items: [{ itemId: 'americano', name: 'Americano', price: 700, qty: 2, temp: 'iced' }] }, Date.now() - 4000);
    let r = await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [o1, o2], since: st.seq }) }, bar.token);
    assert.deepStrictEqual(r.body.acked, [o1.opId, o2.opId]);
    r = await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [o1, o2], since: r.body.seq }) }, bar.token);
    assert.strictEqual(r.body.ops.length, 0, 'retry is idempotent');

    // Barista cannot edit menu.
    const bad = op('menu.upsert', { kind: 'item', id: 'latte', data: { price: 1 } });
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [bad], since: 0 }) }, bar.token);
    assert.strictEqual((await j('/api/state', {}, lead.token)).body.state.menu.items.latte.price, 800, 'role check');

    // Guest tracking (public, no auth).
    let g = await j('/api/track/' + tok1);
    assert.strictEqual(g.body.no, '001'); assert.strictEqual(g.body.status, 'queued'); assert.ok(!('mobile' in g.body), 'no mobile leak');
    assert.strictEqual((await j('/api/track/' + 'z'.repeat(20))).status, 404);

    // Conflict: an older "making" arriving after a newer "ready" must not win.
    const ready = op('order.status', { id: 'o1', status: 'ready' }, Date.now());
    const staleMaking = op('order.status', { id: 'o1', status: 'making' }, Date.now() - 2000);
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [ready, staleMaking], since: 0 }) }, bar.token);
    g = await j('/api/track/' + tok1);
    assert.strictEqual(g.body.status, 'ready', 'LWW keeps the newest status');

    // Collection drops the mobile number.
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [op('order.status', { id: 'o1', status: 'collected' })], since: 0 }) }, bar.token);
    let s = (await j('/api/state', {}, lead.token)).body.state;
    assert.strictEqual(s.orders.o1.mobile, null, 'mobile wiped on collect');

    // CSV: lead only, no names, correct totals.
    assert.strictEqual((await j('/api/report.csv', {}, bar.token)).status, 401);
    const csv = (await j('/api/report.csv?day=' + Core.sgDay(), {}, lead.token)).body;
    assert.ok(!/Mei|Jon/.test(csv), 'CSV has no names');
    assert.ok(/TOTAL,,,,3,23\.00/.test(csv), 'CSV total 3 cups $23.00');
    assert.ok(/PayNow,1,9\.00/.test(csv) && /Card,1,14\.00/.test(csv), 'payment split');

    // Close the day: names wiped in memory AND in the op log on disk.
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [op('day.close', { day: Core.sgDay() })], since: 0 }) }, lead.token);
    s = (await j('/api/state', {}, lead.token)).body.state;
    assert.strictEqual(s.orders.o2.name, null); assert.strictEqual(s.orders.o2.status, 'collected');
    const disk = fs.readFileSync(path.join(DATA, 'ops.ndjson'), 'utf8');
    assert.ok(!/"Mei"|"Jon"|91234567/.test(disk), 'PII scrubbed from disk');

    // Restart: state rebuilds from the log, figures intact.
    await stop(); await start();
    s = (await j('/api/state', {}, lead.token)).body.state;
    assert.strictEqual(Core.report(s, Core.sgDay()).total, 2300, 'report survives restart');
    console.log('All smoke tests passed');
  } finally {
    await stop();
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); if (proc) proc.kill(); process.exit(1); });
