/* Guest status page: follow one order live, get alerted when it's ready. */
(function () {
  'use strict';
  const token = (location.pathname.match(/^\/o\/([A-Za-z0-9_-]{16,64})/) || [])[1];
  const $ = (id) => document.getElementById(id);
  const KEY = 'bb.guest.' + token;
  let snap = null;
  try { snap = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))); } catch (e) { /* no fragment */ }
  let last = null;
  try { last = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* none */ }
  let alerted = last && (last.status === 'ready' || last.status === 'collected');
  let audioCtx = null;
  let failures = 0;

  if (!token) { $('title').textContent = 'Order not found'; return; }

  // Pickup QR: the barista's tablet scans this to hand over the right drink.
  try {
    const qr = window.qrcode(0, 'M'); qr.addData('BB:' + token); qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { $('pickup').hidden = true; }

  function chime(times) {
    if (!audioCtx) return;
    for (let k = 0; k < (times || 1); k++) {
      [880, 1175, 1568].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + k * 0.9 + i * 0.16;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
      });
    }
  }
  let flashTimer = null;
  function flashTitle(text) {
    clearInterval(flashTimer); let on = false;
    flashTimer = setInterval(() => { document.title = (on = !on) ? text : 'Beans&Beats'; }, 900);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flashTimer); document.title = text; } }, { once: true });
  }

  function alertReady(d) {
    if (alerted) return;
    alerted = true;
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
    chime(3);
    flashTitle('READY · Order ' + d.no);
    // Local notification (covers the case where push is not available but the page is still alive).
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification('Order ' + d.no + ' is ready', {
        body: (d.name ? d.name + ', y' : 'Y') + 'our drink is ready. Pick it up at the Beans&Beats counter.',
        tag: 'order-' + token, renotify: true, requireInteraction: true, vibrate: [400, 150, 400], icon: '/icons/icon.svg',
      })).catch(() => {});
    }
  }

  function render(d, offline) {
    const no = d && d.no ? d.no : (snap && snap.no);
    const name = d && d.name ? d.name : (snap && snap.name);
    const items = d && d.items ? d.items : (snap && snap.items);
    const status = (d && d.status) || 'received';
    $('title').textContent = no ? 'Order ' + no : 'Your order';
    $('desc').textContent = [name, items].filter(Boolean).join(', ');
    const rank = { received: 0, queued: 0, making: 1, ready: 2, collected: 3, cancelled: -1 }[status];
    $('s-received').className = 'step done' + (rank === 0 ? ' now' : '');
    $('s-making').className = 'step' + (rank >= 1 ? ' done' : '') + (rank === 1 ? ' now' : '');
    $('pill').className = 'pill' + (rank >= 2 ? ' on' : '');
    $('pillTxt').textContent = rank === 3 ? 'Collected' : 'Ready to collect';
    document.body.classList.toggle('ready', rank === 2);
    document.querySelector('meta[name=theme-color]').content = rank === 2 ? '#0a0a0a' : '#ffffff';
    $('pickup').classList.toggle('big', rank === 2);
    $('pickTitle').textContent = rank === 2 ? 'Show this at the counter' : 'Your pickup code';
    $('ahead').textContent = d && (status === 'queued' || status === 'making') && d.ahead ? d.ahead + ' order' + (d.ahead === 1 ? '' : 's') + ' ahead of you' : '';
    let msg;
    if (status === 'received') msg = 'Order received at the counter. It is on its way to the bar.';
    else if (status === 'queued') msg = 'You are in the queue. We will let you know the moment it is ready.';
    else if (status === 'making') msg = 'Your barista is making it now.';
    else if (status === 'ready') msg = 'Your drink is ready. Pick it up at the counter and enjoy the set.';
    else if (status === 'collected') msg = 'Enjoy! Thank you for supporting Singapore Red Cross Young Hearts.';
    else if (status === 'cancelled') msg = 'This order was cancelled. Please speak to the counter.';
    $('msg').textContent = msg;
    $('off').hidden = !offline;
    const done = rank >= 3 || rank < 0;
    $('alertBtn').hidden = done || rank === 2 || alertsOn;
    $('pickup').hidden = done;
    if (rank === 2) alertReady({ no, name });
  }

  async function poll() {
    let next = document.hidden ? 8000 : 3000;
    try {
      const res = await fetch('/api/track/' + token, { cache: 'no-store' });
      if (res.status === 404) { render(last, false); }
      else if (res.ok) {
        const d = await res.json(); last = d; failures = 0;
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
        render(d, false);
        if (d.status === 'collected' || d.status === 'cancelled') next = 60000;
      } else throw new Error(res.status);
    } catch (e) {
      failures++; render(last, true); next = Math.min(15000, 3000 + failures * 1000);
    }
    clearTimeout(poll.t); poll.t = setTimeout(poll, next);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.addEventListener('online', poll);

  // ---- alerts: sound + vibration (needs a tap), notifications + Web Push
  let alertsOn = false;
  function b64ToU8(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  $('alertBtn').addEventListener('click', async () => {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); chime(1); } catch (e) { /* no audio */ }
    if (navigator.vibrate) navigator.vibrate(80);
    try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    let note = 'Sound alert on. Keep this page open.';
    try {
      if ('Notification' in window && 'serviceWorker' in navigator) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          note = 'Alerts on. We will notify you even if you switch apps.';
          const reg = await navigator.serviceWorker.ready;
          if (reg.pushManager) {
            const { key } = await (await fetch('/api/vapid')).json();
            if (key) {
              const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
              await fetch('/api/push/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
            }
          }
        }
      } else if (/iPhone|iPad/.test(navigator.userAgent)) {
        note = 'On iPhone, keep this page open: it will chime and turn black when your drink is ready. (For lock-screen alerts, Share → Add to Home Screen.)';
      }
    } catch (e) { /* push optional: polling + sound still work */ }
    alertsOn = true; $('alertBtn').hidden = true; $('alertNote').textContent = note;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render(last, false);
  poll();
})();
