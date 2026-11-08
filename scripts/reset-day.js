#!/usr/bin/env node
/*
 * Reset between event days / after the dry run.
 *
 *   node scripts/reset-day.js                       close today (SGT) on the running server
 *   node scripts/reset-day.js 2026-11-26            close a specific day
 *   node scripts/reset-day.js --url https://x.y     target a deployed server
 *   node scripts/reset-day.js --wipe-all            FULL reset: delete every order (server must be stopped)
 *
 * "Close day" = same as the booth lead's "Close day" button: marks open
 * orders collected, deletes guest names + mobiles for that day everywhere,
 * keeps the sales figures. Order numbers restart at 001 automatically on the
 * next SGT calendar day, so no action is needed for numbering.
 *
 * --wipe-all is for after the dry run (week of 16 Nov): it removes the op
 * log, keeps secrets (PINs/VAPID keys) and re-seeds the menu on next start.
 * Tablets notice the new data epoch and drop their cached copy automatically.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('../public/shared/core.js');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

(async () => {
  if (flag('--wipe-all')) {
    const dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
    try {
      const res = await fetch((val('--url') || 'http://localhost:' + (process.env.PORT || 3000)) + '/api/health');
      if (res.ok) { console.error('Server is still running. Stop it first, then run --wipe-all.'); process.exit(1); }
    } catch (e) { /* not running: good */ }
    for (const f of ['ops.ndjson', 'push.json', 'epoch.txt']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        const backup = p + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(p, backup);
        console.log('moved', f, '->', path.basename(backup));
      }
    }
    fs.writeFileSync(path.join(dir, 'epoch.txt'), crypto.randomBytes(6).toString('hex'));
    console.log('Done. Start the server: the menu is re-seeded and tablets resync automatically.');
    console.log('Backups (.bak-*) still contain guest names: delete them once you no longer need them.');
    return;
  }
  const url = val('--url') || 'http://localhost:' + (process.env.PORT || 3000);
  const day = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || Core.sgDay();
  const pin = process.env.LEAD_PIN || '9999';
  const login = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  if (!login.ok) { console.error('Lead login failed (set LEAD_PIN).'); process.exit(1); }
  const { token } = await login.json();
  const op = { opId: 'cli-close-' + day + '-' + Date.now(), type: 'day.close', at: Date.now(), device: 'cli', payload: { day } };
  const r = await fetch(url + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ ops: [op], since: 0 }) });
  if (!r.ok) { console.error('Failed:', r.status); process.exit(1); }
  const csv = await fetch(url + '/api/report.csv?day=' + day, { headers: { Authorization: 'Bearer ' + token } });
  const file = path.join(process.cwd(), 'beansbeats-sales-' + day + '.csv');
  fs.writeFileSync(file, await csv.text());
  console.log('Closed ' + day + '. Guest data wiped. Sales CSV saved to ' + file);
})().catch((e) => { console.error(e.message); process.exit(1); });
