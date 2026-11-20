// Durable-storage test: runs the server against an in-memory fake of the
// Upstash Redis REST API, wipes the local disk (what a free host does on every
// restart), boots again and checks that orders, logins and the data epoch
// survive. Run: npm run test:storage
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// ---------- fake Upstash (only the commands store.js uses)
const db = new Map();
let calls = 0;
function run([cmd, key, ...args]) {
  calls++;
  switch (cmd) {
    case 'GET': return db.has(key) ? db.get(key) : null;
    case 'SET': db.set(key, args[0]); return 'OK';
    case 'DEL': { let n = 0; for (const k of [key, ...args]) n += db.delete(k) ? 1 : 0; return n; }
    case 'RPUSH': { const l = db.get(key) || []; l.push(...args.map(String)); db.set(key, l); return l.length; }
    case 'LLEN': return (db.get(key) || []).length;
    case 'LRANGE': { const l = db.get(key) || []; const end = +args[1] < 0 ? l.length + +args[1] : +args[1]; return l.slice(+args[0], end + 1); }
    default: throw new Error('unsupported ' + cmd);
  }
}
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => body += c);
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    const cmds = JSON.parse(body);
    const out = cmds.map((c) => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});

const PORT = 3800 + Math.floor(Math.random() * 90);
const base = 'http://localhost:' + PORT;
let proc;
function start(dataDir, redisPort) {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT, DATA_DIR: dataDir, UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:' + redisPort, UPSTASH_REDIS_REST_TOKEN: 'test-token' }), stdio: 'pipe',
  });
  let err = '';
  proc.stderr.on('data', (d) => err += d);
  return new Promise((res, rej) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('queue on')) res(); });
    proc.on('exit', (code) => rej(new Error('server exited ' + code + ': ' + err)));
  });
}
function stop() { return new Promise((res) => { proc.removeAllListeners('exit'); proc.on('exit', res); proc.kill(); }); }
async function j(p, opts, tok) {
  const r = await fetch(base + p, Object.assign({ headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}) }, opts));
  return { status: r.status, body: await r.json() };
}
async function settled() { for (let i = 0; i < 100; i++) { if ((await j('/api/health')).body.pending === 0) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('mirror never drained'); }

(async () => {
  await new Promise((r) => fake.listen(0, r));
  const rport = fake.address().port;
  const disk1 = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-store-'));
  try {
    await start(disk1, rport);
    const h = (await j('/api/health')).body;
    assert.strictEqual(h.storage, 'redis');
    const bar = (await j('/api/login', { method: 'POST', body: '{"pin":"1111"}' })).body;
    const st1 = (await j('/api/state', {}, bar.token)).body;
    const op = { opId: 'persist-1', type: 'order.create', at: Date.now(), device: 't',
      payload: { id: 'p1', token: 'persisttokenabcdefgh', no: 1, name: 'Mei', items: [{ id: 'latte', name: 'Latte', price: 800, qty: 1 }], pay: 'paynow' } };
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [op], since: 0 }) }, bar.token);
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [{ opId: 'persist-2', type: 'order.status', at: Date.now(), device: 't', payload: { id: 'p1', status: 'making' } }], since: 0 }) }, bar.token);
    await settled();
    assert.ok(db.get('bb:ops').length >= 3, 'ops mirrored to redis');
    assert.ok(db.get('bb:secrets'), 'secrets mirrored');
    await stop();

    // A free host restarts with an empty disk.
    fs.rmSync(disk1, { recursive: true, force: true });
    const disk2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-store-'));
    await start(disk2, rport);
    const st2 = (await j('/api/state', {}, bar.token));
    assert.strictEqual(st2.status, 200, 'old login token still valid after restart (secret restored)');
    assert.strictEqual(st2.body.epoch, st1.epoch, 'same data epoch, tablets keep their cache');
    assert.strictEqual(st2.body.seq, (await j('/api/health')).body.seq);
    assert.strictEqual(st2.body.state.orders.p1.status, 'making', 'order survived the wiped disk');
    assert.strictEqual(Object.keys(st2.body.state.menu.items).length, Object.keys(st1.state.menu.items).length, 'menu not re-seeded twice');
    const track = await j('/api/track/persisttokenabcdefgh');
    assert.strictEqual(track.body.no, '001');

    // Day close rewrites the log without guest names, in redis too.
    const lead = (await j('/api/login', { method: 'POST', body: '{"pin":"9999"}' })).body;
    await j('/api/sync', { method: 'POST', body: JSON.stringify({ ops: [{ opId: 'close-1', type: 'day.close', at: Date.now(), device: 't', payload: { day: st2.body.state.orders.p1.day } }], since: 0 }) }, lead.token);
    await settled();
    assert.ok(!db.get('bb:ops').some((l) => l.includes('"Mei"')), 'guest name scrubbed from redis');
    await stop();
    fs.rmSync(disk2, { recursive: true, force: true });
    console.log('Storage tests passed (' + calls + ' redis commands)');
  } catch (e) {
    console.error(e); if (proc) await stop().catch(() => {}); process.exitCode = 1;
  } finally { fake.close(); }
})();
