/* Guest status page: follow one order live, get alerted when it's ready,
 * then share a story card for Singapore Red Cross Young Hearts. */
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
  let alertsOn = false;
  let etaAt = null; // local timestamp the drink should be ready by

  if (!token) { $('title').textContent = 'Order not found'; return; }

  // Pickup QR: the barista's tablet scans this to hand over the right drink.
  try {
    const qr = window.qrcode(0, 'M'); qr.addData('BB:' + token); qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { $('pickup').hidden = true; }

  function chime(times) {
    if (!audioCtx) return;
    for (let k = 0; k < (times || 1); k++) {
      [659, 988, 1319, 1760].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = i % 2 ? 'triangle' : 'sine'; o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + k * 0.9 + i * 0.11;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.start(t); o.stop(t + 0.65);
      });
    }
  }
  let flashTimer = null;
  function flashTitle(text) {
    clearInterval(flashTimer); let on = false;
    flashTimer = setInterval(() => { document.title = (on = !on) ? text : 'beans&beats'; }, 900);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { clearInterval(flashTimer); document.title = text; } }, { once: true });
  }

  // ---- confetti (canvas, no library)
  const fx = $('fx'), fctx = fx.getContext('2d'); let parts = [], fxRaf = 0;
  function confetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = Math.min(2, devicePixelRatio || 1); fx.width = innerWidth * dpr; fx.height = innerHeight * dpr; fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = ['#fa6105', '#ff8a3d', '#ffffff', '#ffd2b3', '#a8693a'];
    for (let i = 0; i < 140; i++) parts.push({ x: innerWidth / 2, y: innerHeight * 0.3, vx: (Math.random() - 0.5) * 14, vy: -4 - Math.random() * 10, s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length], l: 120 + Math.random() * 60 });
    if (!fxRaf) fxRaf = requestAnimationFrame(tick);
  }
  function tick() {
    fctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) { p.vy += 0.25; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.l--; fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.r); fctx.globalAlpha = Math.min(1, p.l / 30); fctx.fillStyle = p.c; fctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); fctx.restore(); }
    parts = parts.filter((p) => p.l > 0 && p.y < innerHeight + 30);
    fxRaf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  function alertReady(d) {
    if (alerted) return;
    alerted = true;
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
    chime(3); confetti();
    flashTitle('READY · Order ' + d.no);
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification('Order ' + d.no + ' is ready', {
        body: (d.name ? d.name + ', y' : 'Y') + 'our drink is ready. Pick it up at the beans&beats counter.',
        tag: 'order-' + token, renotify: true, requireInteraction: true, vibrate: [400, 150, 400], icon: '/icons/icon.svg',
      })).catch(() => {});
    }
  }

  const LEVEL = { received: 0.1, queued: 0.12, making: 0.55, ready: 0.93, collected: 0.93, cancelled: 0 };
  function setLevel(f) { $('liq').style.transform = 'translateY(' + (110 - f * 118).toFixed(1) + 'px)'; }

  function renderEta() {
    const el = $('eta');
    if (!etaAt) { el.textContent = ''; return; }
    const mins = Math.max(0, (etaAt - Date.now()) / 60000);
    el.innerHTML = mins < 1 ? 'Ready in <b class="num">under a minute</b>' : 'Ready in about <b class="num">' + Math.ceil(mins) + ' min</b>';
  }
  setInterval(renderEta, 5000);

  function renderImpact(imp) {
    if (!imp) return;
    const pct = Math.min(100, 100 * imp.total / (imp.goal || 1));
    $('impact').hidden = false;
    $('impact').innerHTML = '<div class="t"><span>Raised together for Red Cross Young Hearts</span><b class="num">$' + Math.round(imp.total / 100).toLocaleString('en-SG') + '</b></div>' +
      '<div class="bar"><i style="width:' + pct.toFixed(1) + '%"></i></div><div class="s"><span class="num">' + imp.cups.toLocaleString('en-SG') + ' cups poured, yours included</span><span class="num">goal $' + Math.round(imp.goal / 100).toLocaleString('en-SG') + '</span></div>';
  }

  function render(d, offline) {
    const no = d && d.no ? d.no : (snap && snap.no);
    const name = d && d.name ? d.name : (snap && snap.name);
    const items = d && d.items ? d.items : (snap && snap.items);
    const status = (d && d.status) || 'received';
    $('title').textContent = no ? 'Order ' + no : 'Your order';
    $('desc').textContent = [name, items].filter(Boolean).join(', ');
    const rank = { received: 0, queued: 0, making: 1, ready: 2, collected: 3, cancelled: -1 }[status];
    $('s-received').className = rank >= 1 ? 'done' : 'now';
    $('s-making').className = rank >= 2 ? 'done' : rank === 1 ? 'now' : '';
    $('s-ready').className = rank >= 2 ? 'done' : '';
    document.body.className = 'st-' + status + (rank === 2 ? ' ready' : '') + (/\biced\b/.test(items || '') ? ' iced' : ' hot');
    setLevel(LEVEL[status] || 0.1);
    $('pill').className = 'pill' + (rank >= 2 ? ' on' : '');
    $('pillTxt').textContent = rank === 3 ? 'Collected. Enjoy!' : 'Ready to collect';
    document.querySelector('meta[name=theme-color]').content = rank === 2 ? '#141212' : '#ffffff';
    $('pickup').classList.toggle('big', rank === 2);
    $('pickTitle').textContent = rank === 2 ? 'Show this at the counter' : 'Your pickup code';
    if (d && d.etaMs && (status === 'queued' || status === 'making')) etaAt = Date.now() + d.etaMs; else if (rank !== 0 || !d) etaAt = rank >= 2 ? null : etaAt;
    if (rank >= 2 || rank < 0) etaAt = null;
    renderEta();
    if (d && d.ahead && (status === 'queued' || status === 'making')) $('eta').innerHTML += '<br>' + d.ahead + ' order' + (d.ahead === 1 ? '' : 's') + ' ahead of you';
    let msg;
    if (status === 'received') msg = 'Order received at the counter. It is on its way to the bar.';
    else if (status === 'queued') msg = 'You are in the queue. Enjoy the set, we will let you know the moment it is ready.';
    else if (status === 'making') msg = 'Your barista is making it now.';
    else if (status === 'ready') msg = 'Your drink is ready. Pick it up at the counter and enjoy the set.';
    else if (status === 'collected') msg = 'Enjoy! Thank you for supporting Singapore Red Cross Young Hearts.';
    else if (status === 'cancelled') msg = 'This order was cancelled. Please speak to the counter.';
    $('msg').textContent = msg;
    $('off').hidden = !offline;
    const done = rank >= 3 || rank < 0;
    $('alertBtn').hidden = done || rank === 2 || alertsOn;
    $('shareBtn').hidden = rank < 2;
    $('pickup').hidden = done;
    if (d && d.impact) renderImpact(d.impact);
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

  // ---- story card: 1080x1920 PNG drawn on the phone, shared with the native sheet
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function storyCard() {
    const d = last || snap || {};
    const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    try { await Promise.all([document.fonts.load('700 120px "Alte Haas Grotesk"'), document.fonts.load('900 300px "Archivo"')]); } catch (e) { /* fallback fonts */ }
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#ff7a1f'); g.addColorStop(1, '#d94f00');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 70; i++) { c.beginPath(); c.arc((i * 137) % W, (i * 271) % H, 3 + (i % 5), 0, 7); c.fill(); }
    try { const logo = await loadImg('/brand/logo-white.png'); c.drawImage(logo, 90, 110, 300, 300 * logo.height / logo.width); } catch (e) { /* no logo */ }
    c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    c.font = '700 64px "Alte Haas Grotesk", Helvetica, Arial'; c.fillText('× Christmas Together 2026', 90, 560);
    c.font = '700 150px "Alte Haas Grotesk", Helvetica, Arial';
    c.fillText('I sipped', 84, 820); c.fillText('for Young', 84, 970); c.fillText('Hearts.', 84, 1120);
    c.font = '900 270px "Archivo", Helvetica, Arial'; c.globalAlpha = 0.2; c.fillText(String(d.no || ''), 76, 1545); c.globalAlpha = 1;
    c.font = '700 54px "Alte Haas Grotesk", Helvetica, Arial';
    const drink = (d.items || 'coffee').slice(0, 40);
    c.fillText('order ' + (d.no || '') + ' · ' + drink, 90, 1250);
    c.fillStyle = '#1d1b1b'; const y = 1600; roundRect(c, 70, y, W - 140, 200, 40); c.fill();
    c.fillStyle = '#fff'; c.font = '700 46px "Alte Haas Grotesk", Helvetica, Arial';
    const imp = d.impact;
    c.fillText(imp ? '$' + Math.round(imp.total / 100).toLocaleString('en-SG') + ' raised together, ' + imp.cups + ' cups' : 'Every dollar to Red Cross Young Hearts', 120, y + 88);
    c.fillStyle = '#ffb27a'; c.font = '400 38px "Alte Haas Grotesk", Helvetica, Arial';
    c.fillText('coffee clubbing · Hall F, Marina Bay Sands', 120, y + 150);
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  $('shareBtn').addEventListener('click', async () => {
    const blob = await storyCard(); if (!blob) return;
    const file = new File([blob], 'beansnbeats-young-hearts.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: 'Coffee for a cause at beans&beats × Christmas Together 2026 ☕' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  });
  window.__bbStory = storyCard; // used by screenshot script

  // ---- alerts: sound + vibration (needs a tap), notifications + Web Push
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
        note = 'On iPhone, keep this page open: it will chime and turn dark when your drink is ready. (For lock-screen alerts, Share → Add to Home Screen.)';
      }
    } catch (e) { /* push optional: polling + sound still work */ }
    alertsOn = true; $('alertBtn').hidden = true; $('alertNote').textContent = note;
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  render(last, false);
  poll();
})();
