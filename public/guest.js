/* Guest status page: follow one order live, get alerted when it's ready,
 * then share a story card for the event's beneficiary. */
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
  let contribution = null;

  if (!token) { $('title').textContent = 'Order not found'; return; }

  function pickupCode() {
    const container = $('qr');
    if (container.firstChild) return true;
    try {
      const qr = window.qrcode(0, 'M'); qr.addData('BB:' + token); qr.make();
      container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      return true;
    } catch (e) { return false; }
  }

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
  function alertReady(d) {
    if (alerted) return;
    alerted = true;
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 800]);
    chime();
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification('Order ' + d.no + ' is ready', {
        body: (d.name ? d.name + ', y' : 'Y') + 'our drink is ready. Pick it up at the beans&beats counter.',
        tag: 'order-' + token, renotify: true, requireInteraction: true, vibrate: [400, 150, 400], icon: '/icons/icon.svg',
      })).catch(() => {});
    }
  }


  function renderEta() {
    const el = $('eta');
    if (!etaAt) { el.textContent = ''; return; }
    const mins = Math.max(0, (etaAt - Date.now()) / 60000);
    el.innerHTML = mins < 1 ? 'Ready in <b class="num">under a minute</b>' : 'Ready in about <b class="num">' + Math.ceil(mins) + ' min</b>';
  }
  setInterval(renderEta, 5000);

  const DEFAULT_CAUSE = 'Singapore Red Cross Young Hearts';
  function boothFor(d) {
    return Object.assign({ pickupScan: false, showDonation: true, showDonationGoal: true, donationName: DEFAULT_CAUSE }, (d && d.booth) || (snap && snap.booth));
  }
  function renderImpact(imp, booth) {
    const el = $('impact');
    el.hidden = !booth.showDonation || !booth.showDonationGoal || !imp;
    el.replaceChildren();
    if (el.hidden) return;
    const heading = document.createElement('div'); heading.className = 't';
    const label = document.createElement('span'); label.textContent = 'Event sales';
    const total = document.createElement('b'); total.className = 'num'; total.textContent = '$' + (imp.total / 100).toLocaleString('en-SG', { maximumFractionDigits: 2 });
    heading.append(label, total); el.append(heading);
    if (booth.showDonationGoal && imp.goal > 0) {
      const bar = document.createElement('div'); bar.className = 'bar';
      const fill = document.createElement('i'); fill.style.width = Math.max(0, Math.min(100, 100 * imp.total / imp.goal)).toFixed(1) + '%';
      bar.append(fill); el.append(bar);
      const goal = document.createElement('div'); goal.className = 'small'; goal.textContent = 'Towards our $' + (imp.goal / 100).toLocaleString('en-SG', { maximumFractionDigits: 2 }) + ' sales goal'; el.append(goal);
    }
  }

  function render(d, offline) {
    const no = d && d.no ? d.no : (snap && snap.no);
    const name = d && d.name ? d.name : (snap && snap.name);
    const items = d && d.items ? d.items : (snap && snap.items);
    const status = (d && d.status) || 'received';
    const booth = boothFor(d);
    const title = no ? 'Order ' + no : 'Your order';
    $('title').textContent = title;
    document.title = title + (status === 'ready' ? ' is ready' : '') + ' · beans&beats';
    $('desc').textContent = [name, items].filter(Boolean).join(', ');
    const rank = { received: 0, queued: 0, making: 1, ready: 2, collected: 3, cancelled: -1 }[status];
    $('s-received').className = rank >= 1 ? 'done' : 'now';
    $('s-making').className = rank >= 2 ? 'done' : rank === 1 ? 'now' : '';
    $('s-ready').className = rank >= 2 ? 'done' : '';
    $('pill').hidden = rank < 2;
    $('pillTxt').textContent = rank === 3 ? 'Collected. Enjoy!' : 'Ready to collect';
    $('track').hidden = rank >= 2 || rank < 0;
    const showPickup = rank === 2 && booth.pickupScan && pickupCode();
    if (d && d.etaMs && (status === 'queued' || status === 'making')) etaAt = Date.now() + d.etaMs; else if (rank !== 0 || !d) etaAt = rank >= 2 ? null : etaAt;
    if (rank >= 2 || rank < 0) etaAt = null;
    renderEta();
    if (d && d.ahead && (status === 'queued' || status === 'making')) $('eta').innerHTML += '<br>' + d.ahead + ' order' + (d.ahead === 1 ? '' : 's') + ' ahead of you';
    let msg;
    if (status === 'received') msg = 'Order received.';
    else if (status === 'queued') msg = 'You’re in the queue.';
    else if (status === 'making') msg = 'Your barista is making it now.';
    else if (status === 'ready') msg = showPickup ? 'Show your pickup code at the counter.' : 'Give your order number at the counter.';
    else if (status === 'collected') msg = 'Enjoy your drink. Thanks for joining us.';
    else if (status === 'cancelled') msg = 'This order was cancelled. Please speak to the counter.';
    if ($('msg').textContent !== msg) $('msg').textContent = msg;
    $('off').hidden = !offline;
    renderAlerts(rank);
    $('pickup').hidden = !showPickup;
    const canShare = !!no && rank >= 0 && booth.showDonation;
    $('contribution').hidden = !canShare;
    if (canShare) {
      const cause = booth.donationName || DEFAULT_CAUSE;
      $('cause').textContent = 'Your coffee supports ' + cause + '. Thank you.';
      prepareContribution(cause);
      renderImpact(d && d.impact, booth);
    }
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
  async function storyCard(beneficiary = boothFor(last).donationName || DEFAULT_CAUSE) {
    const W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    if (!c) return null;
    try { await document.fonts.load('700 140px "Alte Haas Grotesk"'); } catch (e) { /* fallback fonts */ }
    c.fillStyle = '#1d1b1b'; c.fillRect(0, 0, W, H);
    try { const logo = await loadImg('/brand/logo-white.png'); c.drawImage(logo, 90, 130, 240, 240 * logo.height / logo.width); } catch (e) { /* no logo */ }
    c.fillStyle = '#fa6105'; c.fillRect(90, 637, 110, 8);
    c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    c.font = '700 140px "Alte Haas Grotesk", Helvetica, Arial';
    c.fillText('I got coffee', 84, 830, 900); c.fillText('for a cause.', 84, 975, 900);
    c.fillStyle = '#c6c3c2'; c.font = '400 42px "Alte Haas Grotesk", Helvetica, Arial';
    c.fillText('My cup supported', 90, 1160);
    c.fillStyle = '#fff'; c.font = '700 55px "Alte Haas Grotesk", Helvetica, Arial';
    const words = beneficiary.split(/\s+/);
    let line = '', lineY = 1248;
    for (const word of words) {
      const candidate = line ? line + ' ' + word : word;
      if (c.measureText(candidate).width > 900 && line) { c.fillText(line, 90, lineY, 900); lineY += 68; line = word; } else line = candidate;
    }
    if (line) c.fillText(line, 90, lineY, 900);
    c.fillStyle = '#797574'; c.fillRect(90, 1690, 900, 2);
    c.fillStyle = '#c6c3c2'; c.font = '400 42px "Alte Haas Grotesk", Helvetica, Arial';
    c.fillText('beans&beats · Christmas Together 2026', 90, 1785, 900);
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  function prepareContribution(cause) {
    if (contribution?.cause === cause) return;
    const card = { cause, file: null };
    contribution = card;
    const button = $('shareBtn');
    button.disabled = true;
    // Prepare the file before the tap so the iOS share sheet keeps the user gesture.
    storyCard(cause).then((blob) => {
      if (blob) card.file = new File([blob], 'beansandbeats-contribution.png', { type: 'image/png' });
    }).catch(() => {}).finally(() => {
      if (contribution === card) button.disabled = !card.file;
    });
  }
  $('shareBtn').addEventListener('click', async () => {
    const file = contribution?.file;
    if ($('contribution').hidden || !file) return;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: 'My coffee at beans&beats supported ' + contribution.cause + '.' });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  });
  window.__bbStory = storyCard; // used by screenshot script

  // ---- alerts. Browsers only allow notifications after one tap from the guest,
  // with a chime and vibration available while the page is open.
  //   alertsOn: false | 'push' (OS notification + Web Push) | 'sound' (page must stay open)
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const canNotify = 'Notification' in window && 'serviceWorker' in navigator;
  const ALERT_KEY = KEY + '.alerts';
  let lastRank = 0;
  let pushError = ''; // why lock-screen alerts couldn't be set up, shown to the guest

  // iPhone only allows web notifications from a home-screen app, so give this
  // order its own manifest: "Add to Home Screen" then opens straight to it.
  try { document.querySelector('link[rel=manifest]').href = '/api/manifest/' + token; } catch (e) { /* ignore */ }

  function alertState() {
    if (pushError) return 'failed';
    if (alertsOn) return 'on';
    if (canNotify) return Notification.permission === 'denied' ? 'denied' : 'ask';
    if (ios && !standalone) return 'ios';
    return 'sound';
  }
  function renderAlerts(rank) {
    lastRank = rank;
    const st = alertState();
    const live = rank >= 0 && rank < 2;
    $('alerts').hidden = !live || st === 'on';
    $('alon').hidden = !live || st !== 'on';
    const steps = $('alSteps');
    steps.hidden = st !== 'ios';
    if (st === 'ask') {
      $('alS').textContent = 'Get a notification when your drink is ready.';
      $('alBtnTxt').textContent = 'Turn on notifications';
    } else if (st === 'failed') {
      $('alS').textContent = 'Keep this page open for a sound alert, or try notifications again.';
      $('alBtnTxt').textContent = 'Try again';
    } else if (st === 'denied') {
      $('alS').textContent = 'Notifications are blocked. You can use a sound alert while this page is open.';
      $('alBtnTxt').textContent = 'Turn on sound alert';
    } else if (st === 'ios') {
      $('alS').textContent = 'iPhone only sends web notifications from apps on your home screen. It takes ten seconds:';
      steps.innerHTML = '<li>Tap <b>Share</b> <i class="ph-bold ph-export"></i> at the bottom of Safari</li><li>Tap <b>Add to Home Screen</b>, then <b>Add</b></li><li>Open <b>B&amp;B order</b> from your home screen and tap <b>Turn on notifications</b></li>';
      $('alBtnTxt').textContent = 'Use a sound alert instead';
    } else if (st === 'sound') {
      $('alS').textContent = 'Keep this page open to hear the sound alert.';
      $('alBtnTxt').textContent = 'Turn on sound alert';
    } else {
      $('alonTxt').textContent = alertsOn === 'push' ? 'Ready notification on.' : 'Sound alert on. Keep this page open.';
    }
  }

  function b64ToU8(b64) { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  function unlockAudio() {
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); return true; } catch (e) { return false; }
  }
  // Any tap on the page unlocks sound, so even guests who skip the card get a chime.
  document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  let wake = null;
  async function keepAwake() { try { if (navigator.wakeLock && !document.hidden) wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ } }
  document.addEventListener('visibilitychange', () => { if (alertsOn === 'sound' && !document.hidden) keepAwake(); });

  function sameKey(a, b) { if (!a || a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a); for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false; return true; }
  function withTimeout(p, ms, what) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms))]); }
  // Registers this phone with the browser's push service and hands the
  // subscription to our server. Throws with a short reason on failure, so the
  // page never claims "Notifications on" unless the server really has it.
  async function subscribePush() {
    if (!('PushManager' in window)) throw new Error('no push support in this browser');
    const reg = await withTimeout(navigator.serviceWorker.ready, 8000, 'service worker');
    const res = await fetch('/api/vapid', { cache: 'no-store' });
    const { key } = await res.json();
    if (!key) throw new Error('server has no push key');
    const appKey = b64ToU8(key);
    let sub = await reg.pushManager.getSubscription();
    // A subscription made against an older server key can never receive our pushes.
    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, appKey)) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } sub = null; }
    if (!sub) {
      const opts = { userVisibleOnly: true, applicationServerKey: appKey };
      try { sub = await withTimeout(reg.pushManager.subscribe(opts), 15000, 'push service'); }
      catch (e) { await new Promise((r) => setTimeout(r, 1200)); sub = await withTimeout(reg.pushManager.subscribe(opts), 15000, 'push service'); }
    }
    const r = await fetch('/api/push/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    if (!r.ok) throw new Error('server said ' + r.status);
    return true;
  }
  async function connectPush() {
    $('alBtnTxt').textContent = 'Connecting…';
    try { await subscribePush(); pushError = ''; setOn('push'); }
    catch (e) { pushError = (e && (e.message || e.name)) || 'unknown error'; alertsOn = 'sound'; renderAlerts(lastRank); }
  }
  function setOn(mode) {
    alertsOn = mode;
    try { localStorage.setItem(ALERT_KEY, mode); } catch (e) { /* ignore */ }
    renderAlerts(lastRank);
  }

  $('alertBtn').addEventListener('click', async () => {
    unlockAudio(); chime(1);
    if (navigator.vibrate) navigator.vibrate(80);
    keepAwake();
    const st = alertState();
    if (st === 'failed') { await connectPush(); return; }
    if (st === 'ask') {
      $('alBtnTxt').textContent = 'Allow it in the pop-up…';
      let perm = 'default';
      try { perm = await Notification.requestPermission(); } catch (e) { /* old Safari */ }
      if (perm === 'granted') { await connectPush(); return; }
      if (perm === 'denied') { renderAlerts(lastRank); return; }
      $('alBtnTxt').textContent = 'Turn on notifications'; // dismissed: let them try again
      return;
    }
    setOn('sound');
  });
  $('testBtn').addEventListener('click', async () => {
    unlockAudio(); chime(1);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if (alertsOn !== 'push') return;
    // A real push from the server, so locking the phone right after proves the lock-screen path.
    $('testBtn').textContent = 'Sending…';
    try {
      const r = await fetch('/api/push/' + token + '/test', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      $('alonTxt').textContent = r.ok && d.sent ? 'Test sent. Lock your phone now: it should buzz in a few seconds.' : 'Test failed (' + (d.error || r.status) + '). Tap Test again, or keep this page open.';
    } catch (e) { $('alonTxt').textContent = 'No connection. Try again in a moment.'; }
    $('testBtn').textContent = 'Test';
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Permission already granted (reload, second order, home-screen app): turn
  // alerts on silently, no tap needed.
  if (canNotify && Notification.permission === 'granted') {
    alertsOn = 'push';
    subscribePush().catch((e) => { pushError = (e && e.message) || 'unknown error'; alertsOn = 'sound'; renderAlerts(lastRank); });
  } else {
    try { if (localStorage.getItem(ALERT_KEY) === 'sound') alertsOn = 'sound'; } catch (e) { /* ignore */ }
  }
  render(last, false);
  poll();
})();
