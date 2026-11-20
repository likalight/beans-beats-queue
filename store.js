'use strict';
/*
 * Durable mirror for the data directory.
 *
 * The server always works from local files in DATA_DIR (fast, offline-safe,
 * zero setup). Free hosts such as Render's free plan wipe that disk on every
 * restart and deploy, so when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set this module also:
 *
 *   1. on boot, restores ops.ndjson / epoch / secrets / push subscriptions
 *      from Redis into DATA_DIR before the server reads them, and
 *   2. while running, mirrors every write to Redis through an ordered,
 *      retrying queue (one RPUSH per op), flushed on SIGTERM.
 *
 * Upstash's REST API is plain HTTPS, so there is no client library to install.
 * Without the env vars every function here is a no-op.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const URL_ = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PREFIX = process.env.REDIS_PREFIX || 'bb:';
const enabled = !!(URL_ && TOKEN);
const K = { ops: PREFIX + 'ops', epoch: PREFIX + 'epoch', secrets: PREFIX + 'secrets', push: PREFIX + 'push' };

async function call(cmds, transactional) {
  const res = await fetch(URL_ + (transactional ? '/multi-exec' : '/pipeline'), {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error('redis HTTP ' + res.status);
  const out = await res.json();
  const bad = (Array.isArray(out) ? out : [out]).find((r) => r && r.error);
  if (bad) throw new Error('redis ' + bad.error);
  return out.map((r) => r.result);
}

// ---------- boot: Redis -> DATA_DIR (runs in a child process so server.js can stay synchronous)
async function hydrate(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const [len, epoch, secrets, push] = await call([['LLEN', K.ops], ['GET', K.epoch], ['GET', K.secrets], ['GET', K.push]]);
  const localOps = path.join(dir, 'ops.ndjson');
  if (!len && !epoch) {
    // Fresh Redis: upload whatever is on disk (first deploy, or moving from a disk host).
    const cmds = [];
    if (fs.existsSync(localOps)) {
      const lines = fs.readFileSync(localOps, 'utf8').split('\n').filter(Boolean);
      for (let i = 0; i < lines.length; i += 500) cmds.push(['RPUSH', K.ops].concat(lines.slice(i, i + 500)));
    }
    for (const [key, file] of [[K.epoch, 'epoch.txt'], [K.secrets, 'secrets.json'], [K.push, 'push.json']]) {
      const f = path.join(dir, file);
      if (fs.existsSync(f)) cmds.push(['SET', key, fs.readFileSync(f, 'utf8')]);
    }
    if (cmds.length) await call(cmds);
    return 'seeded redis from disk (' + cmds.length + ' writes)';
  }
  const lines = [];
  for (let i = 0; i < len; i += 1000) lines.push(...(await call([['LRANGE', K.ops, i, i + 999]]))[0]);
  fs.writeFileSync(localOps, lines.length ? lines.join('\n') + '\n' : '');
  if (epoch) fs.writeFileSync(path.join(dir, 'epoch.txt'), epoch);
  if (secrets) fs.writeFileSync(path.join(dir, 'secrets.json'), secrets);
  if (push) fs.writeFileSync(path.join(dir, 'push.json'), push);
  return 'restored ' + lines.length + ' ops from redis';
}
function hydrateSync(dir) {
  if (!enabled) return null;
  const out = execFileSync(process.execPath, [__filename, '--hydrate', dir], { env: process.env, encoding: 'utf8', timeout: 60000 });
  return out.trim();
}

// ---------- runtime: ordered write-behind queue with retry
const queue = [];
let busy = false;
let failures = 0;
async function drain() {
  if (busy || !queue.length) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue[0];
      try { await call(job.cmds, job.tx); queue.shift(); failures = 0; } catch (e) {
        failures++;
        if (failures === 1 || failures % 20 === 0) console.warn('redis mirror: ' + e.message + ' (' + queue.length + ' pending, retrying)');
        await new Promise((r) => setTimeout(r, Math.min(30000, 500 * 2 ** Math.min(failures, 6))));
      }
    }
  } finally { busy = false; }
}
function enqueue(cmds, tx) {
  if (!enabled) return;
  // Coalesce consecutive RPUSHes into one request so a burst of ops is one round trip.
  const last = queue[queue.length - 1];
  if (!tx && last && !last.tx && !(busy && last === queue[0]) && cmds.length === 1 && cmds[0][0] === 'RPUSH' && last.cmds.length < 200) last.cmds.push(cmds[0]);
  else queue.push({ cmds, tx });
  drain();
}

const store = {
  enabled,
  hydrateSync,
  appendOp(line) { enqueue([['RPUSH', K.ops, line]]); },
  replaceOps(lines) {
    const cmds = [['DEL', K.ops]];
    for (let i = 0; i < lines.length; i += 500) cmds.push(['RPUSH', K.ops].concat(lines.slice(i, i + 500)));
    enqueue(cmds, true);
  },
  setEpoch(v) { enqueue([['SET', K.epoch, v]]); },
  setSecrets(json) { enqueue([['SET', K.secrets, json]]); },
  setPush(json) { enqueue([['SET', K.push, json]]); },
  pending() { return queue.length; },
  async flush(ms) {
    const until = Date.now() + (ms || 5000);
    while ((queue.length || busy) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    return queue.length === 0;
  },
  // Full wipe (scripts/reset-day.js --wipe-all): drop orders, keep secrets.
  async wipe(newEpoch) { if (enabled) await call([['DEL', K.ops, K.push], ['SET', K.epoch, newEpoch]], true); },
};
module.exports = store;

if (require.main === module && process.argv[2] === '--hydrate') {
  (async () => {
    // Booting with an empty disk while Redis holds the real log would fork
    // history, so retry a few times and then refuse to start (the host restarts us).
    for (let i = 1; ; i++) {
      try { process.stdout.write(await hydrate(path.resolve(process.argv[3])) + '\n'); return; } catch (e) {
        process.stderr.write('redis hydrate failed (try ' + i + '): ' + e.message + '\n');
        if (i >= 4) process.exit(1);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  })();
}
