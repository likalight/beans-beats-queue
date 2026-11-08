/* Beans&Beats booth app: Order, Queue, Board, Menu, Report.
 * Local-first: every action is written to a local outbox and applied to the
 * screen immediately; a sync loop ships the outbox to the server whenever the
 * network allows and pulls everyone else's changes (SSE + polling fallback). */
(function () {
  'use strict';
  const C = window.Core;
  const $app = document.getElementById('app');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('bb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bb.' + k, JSON.stringify(v)); return true; } catch (e) { console.warn('storage full', e); return false; } },
    del(k) { try { localStorage.removeItem('bb.' + k); } catch (e) { /* ignore */ } },
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  function rid(n) {
    const b = new Uint8Array(n || 16); crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function ic(name) { return '<i class="ph-bold ph-' + name + '" aria-hidden="true"></i>'; }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : rid(16)); }

  // ------------------------------------------------------------------ store
  const S = {
    token: LS.get('token', null),
    role: LS.get('role', null),
    device: LS.get('device', null) || (function () { const d = 'dev-' + rid(6); LS.set('device', d); return d; })(),
    station: LS.get('station', 1),
    stations: LS.get('stations', 1),
    simOffline: LS.get('simOffline', false),
    base: LS.get('base', null) || C.emptyState(),
    seq: LS.get('seq', 0),
    epoch: LS.get('epoch', null),
    outbox: LS.get('outbox', []),
    view: null,
    online: false,
    lastOk: 0,
    clockSkew: 0,
  };
  function now() { return Date.now() + S.clockSkew; }
  function rebuild() {
    const v = JSON.parse(JSON.stringify(S.base));
    for (const op of S.outbox) C.apply(v, op);
    S.pendingIds = new Set(S.outbox.map((o) => o.payload && o.payload.id));
    S.view = v;
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { LS.set('base', S.base); LS.set('seq', S.seq); LS.set('epoch', S.epoch); }, 300);
    LS.set('outbox', S.outbox); // outbox is saved synchronously: never lose an order
  }
  function dispatch(type, payload) {
    const op = { opId: uuid(), type, at: now(), device: S.device, payload };
    S.outbox.push(op);
    save(); rebuild(); render();
    syncSoon(50);
    return op;
  }
  function applyServerOps(ops) {
    for (const e of ops) { C.apply(S.base, e); if (e.seq > S.seq) S.seq = e.seq; }
  }

  // ------------------------------------------------------------------ network
  let syncing = false, syncTimer = null, es = null;
  function syncSoon(ms) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms == null ? 0 : ms); }
  async function api(path, opts) {
    if (S.simOffline) throw new Error('offline (simulated)');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(path, Object.assign({ signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token } }, opts));
      if (res.status === 401) { logout('Session expired, please log in again'); throw new Error('auth'); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }
  async function sync() {
    if (syncing || !S.token) return;
    syncing = true;
    const batch = S.outbox.slice(0, 500);
    try {
      let r = await api('/api/sync', { method: 'POST', body: JSON.stringify({ ops: S.epoch ? batch : [], since: S.epoch ? S.seq : 0 }) });
      if (r.epoch !== S.epoch) {
        // Server data was reset (or first contact): take a fresh snapshot.
        const st = await api('/api/state');
        if (S.epoch) { S.outbox = []; resetCounters(); } // ops from before a full reset must not resurrect old orders
        S.base = st.state; S.seq = st.seq; S.epoch = st.epoch;
        r = { acked: [], ops: [], now: st.now };
        if (S.outbox.length) syncSoon(50);
      }
      const acked = new Set(r.acked);
      S.outbox = S.outbox.filter((o) => !acked.has(o.opId));
      // When a fresh device has no history yet, take a full snapshot.
      applyServerOps(r.ops);
      S.clockSkew = Math.abs(r.now - Date.now()) > 5000 ? r.now - Date.now() : 0;
      S.online = true; S.lastOk = Date.now();
      save(); rebuild(); render();
      ensureStream();
      if (S.outbox.length) syncSoon(100);
    } catch (e) {
      S.online = false; renderNet();
    } finally { syncing = false; }
  }
  function ensureStream() {
    if (es || S.simOffline || !S.token || !window.EventSource) return;
    es = new EventSource('/api/stream?auth=' + encodeURIComponent(S.token));
    es.addEventListener('ops', (ev) => {
      const ops = JSON.parse(ev.data);
      const gap = ops.length && ops[0].seq > S.seq + 1;
      applyServerOps(ops);
      S.online = true; S.lastOk = Date.now();
      save(); rebuild(); render();
      if (gap) syncSoon(0);
    });
    es.addEventListener('hello', (ev) => { const d = JSON.parse(ev.data); if (d.seq > S.seq) syncSoon(0); });
    es.onerror = () => { S.online = false; renderNet(); if (es && es.readyState === 2) { es = null; } };
  }
  function closeStream() { if (es) { es.close(); es = null; } }
  setInterval(() => {
    if (S.simOffline) return;
    if (S.outbox.length || Date.now() - S.lastOk > 10000) sync();
  }, 3000);
  window.addEventListener('online', () => syncSoon(0));
  window.addEventListener('offline', () => { S.online = false; renderNet(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(0); });

  // ------------------------------------------------------------------ auth
  function logout(msg) {
    S.token = null; S.role = null; LS.del('token'); LS.del('role'); closeStream();
    route = 'login'; loginMsg = msg || ''; render();
  }
  let loginMsg = '';
  let pinBuf = '';
  function drawPin() {
    const r = document.getElementById('pinrow'); if (!r) return;
    const n = Math.max(4, pinBuf.length);
    r.innerHTML = Array.from({ length: n }, (_, i) => '<span class="' + (i < pinBuf.length ? 'on' : '') + '"></span>').join('');
  }
  function pinKey(k) {
    if (k === 'del') pinBuf = pinBuf.slice(0, -1); else if (pinBuf.length < 8) pinBuf += k;
    drawPin(); const e = document.getElementById('loginErr'); if (e) e.textContent = '';
  }
  document.addEventListener('keydown', (e) => {
    if (S.token || !document.getElementById('pinrow')) return;
    if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('del'); else if (e.key === 'Enter') { e.preventDefault(); doLogin(pinBuf); }
  });

  // ------------------------------------------------------------------ routing
  const TABS = [
    { id: 'order', label: 'Order', icon: 'coffee' }, { id: 'queue', label: 'Queue', icon: 'list-checks' },
    { id: 'board', label: 'Ready board', icon: 'television-simple' }, { id: 'display', label: 'Guest display', icon: 'qr-code' },
    { id: 'menu', label: 'Menu', icon: 'sliders-horizontal', lead: true }, { id: 'report', label: 'Sales', icon: 'chart-bar', lead: true },
  ];
  let route = location.pathname.replace(/^\//, '') || 'order';
  function go(r) { route = r; history.pushState(null, '', '/' + r); render(); }
  window.addEventListener('popstate', () => { route = location.pathname.replace(/^\//, '') || 'order'; render(); });

  // ------------------------------------------------------------------ helpers
  function today() { return C.sgDay(now()); }
  function orders() { return Object.values(S.view.orders); }
  function menuItems() { return Object.values(S.view.menu.items).filter((i) => !i.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name)); }
  function milks() { return Object.values(S.view.menu.milks).filter((i) => !i.deleted).sort((a, b) => (a.sort || 0) - (b.sort || 0)); }
  function ageMin(ts) { return Math.max(0, Math.floor((now() - ts) / 60000)); }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = ic('check-circle') + esc(msg); document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function lineDesc(it) {
    let s = '';
    if (it.temp === 'iced') s += '<span class="tag iced">' + ic('snowflake') + 'ICED</span>'; else s += '<span class="tag hot">' + ic('fire') + 'HOT</span>';
    if (it.milkName && it.milkName !== 'Milk') s += '<span class="tag oat">' + esc(it.milkName.toUpperCase()) + '</span>';
    return s + (it.qty > 1 ? '<b>' + it.qty + '× </b>' : '') + esc(it.name);
  }
  function resetCounters() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('bb.counter.')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
  }
  function nextNumber() {
    const day = today();
    const st = Number(S.station) || 1, n = Number(S.stations) || 1;
    let max = LS.get('counter.' + day, 0);
    for (const o of orders()) if (o.day === day && (o.no % n) === (st % n) && o.no > max) max = o.no;
    let next = max ? max + n : st;
    if (next % n !== st % n) next = st;
    LS.set('counter.' + day, next);
    return next;
  }
  function qrSvg(text) {
    const qr = window.qrcode(0, 'L'); qr.addData(text); qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }

  // ------------------------------------------------------------------ render
  function render() {
    if (!S.token) return renderLogin();
    if (!S.view) rebuild();
    const tab = TABS.find((t) => t.id === route) || TABS[0];
    if ((tab.lead && S.role !== 'lead')) route = 'order';
    document.body.classList.toggle('boardmode', route === 'board' || route === 'display');
    if (route === 'board') return renderBoard();
    if (route === 'display') return renderDisplay();
    const keepScroll = window.scrollY;
    const active = document.activeElement && document.activeElement.id;
    const caret = document.activeElement && document.activeElement.selectionStart;
    let body = '';
    if (route === 'order') body = viewOrder();
    else if (route === 'queue') body = viewQueue();
    else if (route === 'menu') body = viewMenu();
    else if (route === 'report') body = viewReport();
    $app.innerHTML =
      '<header class="top"><div class="brand"><b>B&amp;B</b><span>Beans&amp;Beats</span></div><nav class="tabs">' +
      TABS.filter((t) => !t.lead || S.role === 'lead').map((t) => '<a href="/' + t.id + '" data-go="' + t.id + '" class="' + (route === t.id ? 'on' : '') + '" title="' + t.label + '">' + ic(t.icon) + '<span>' + t.label + '</span></a>').join('') +
      '</nav><div id="net"></div><button class="iconbtn" data-act="settings" title="Device settings" aria-label="Device settings">' + ic('gear-six') + '</button></header>' +
      '<main>' + body + '</main>' + (modal ? modal : '');
    renderNet();
    if (active) { const el = document.getElementById(active); if (el) { el.focus(); try { if (caret != null) el.setSelectionRange(caret, caret); } catch (e) { /* number inputs */ } } }
    window.scrollTo(0, keepScroll);
  }
  function renderNet() {
    const el = document.getElementById('net'); if (!el) return;
    const n = S.outbox.length;
    const off = !S.online || S.simOffline;
    el.className = 'net' + (off ? ' off' : n ? ' pend' : '');
    el.innerHTML = ic(off ? 'wifi-slash' : n ? 'arrows-clockwise' : 'wifi-high') + (S.simOffline ? 'Wifi drop (simulated)' : off ? 'Offline' : 'Live') + (n ? ' · ' + n + ' to sync' : off ? ', saved on device' : '');
  }

  // ---- login
  function renderLogin() {
    document.body.classList.remove('boardmode');
    pinBuf = '';
    $app.innerHTML = '<div class="login"><section class="poster"><div class="mark"><b>B&amp;B</b>Beans&amp;Beats × Christmas Together</div>' +
      '<div><h1>Help us keep the queue moving.</h1><p>Charity coffee booth, Hall F, Marina Bay Sands. Every dollar of profit goes to Singapore Red Cross Young Hearts.</p></div>' +
      '<i class="ph-bold ph-snowflake snow" aria-hidden="true"></i></section>' +
      '<form id="loginForm" autocomplete="off"><h2>Enter booth PIN</h2><div class="pinrow" id="pinrow" aria-live="polite"></div>' +
      '<input id="pin" type="password" inputmode="numeric" class="hidden" aria-label="PIN">' +
      '<div class="keypad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button type="button" data-key="' + n + '">' + n + '</button>').join('') +
      '<button type="button" class="k-fn" data-key="del" aria-label="Delete">' + ic('backspace') + '</button><button type="button" data-key="0">0</button>' +
      '<button type="submit" class="k-go" aria-label="Log in">' + ic('arrow-right') + '</button></div>' +
      '<div class="err" id="loginErr">' + esc(loginMsg) + '</div><div class="hint">Baristas and the booth lead have separate PINs.<br>Log in once on wifi; the tablet then works offline.</div></form></div>';
    drawPin();
  }
  async function doLogin(pin) {
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
      const d = await res.json();
      if (!res.ok) { $('#loginErr').textContent = d.error || 'Login failed'; pinBuf = ''; drawPin(); const r = $('#pinrow'); r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); return; }
      S.token = d.token; S.role = d.role; LS.set('token', d.token); LS.set('role', d.role);
      try {
        const st = await api('/api/state');
        if (st.epoch !== S.epoch || !Object.keys(S.base.menu.items).length) { if (S.epoch) { S.outbox = []; resetCounters(); } S.base = st.state; S.seq = st.seq; S.epoch = st.epoch; }
      } catch (e) { /* fine, sync will catch up */ }
      save(); rebuild(); loginMsg = '';
      route = d.role === 'lead' && route === 'login' ? 'order' : (route === 'login' ? 'order' : route);
      render(); sync();
    } catch (e) { $('#loginErr').textContent = 'No connection. Login needs wifi once; after that the tablet works offline.'; }
  }

  // ---- order screen
  let cart = LS.get('cart', []);
  let draft = LS.get('draft', { name: '', mobile: '', consent: false });
  function saveCart() { LS.set('cart', cart); LS.set('draft', draft); }
  function unitPrice(line) {
    const item = S.view.menu.items[line.itemId];
    const milk = line.milkId && S.view.menu.milks[line.milkId];
    const base = item ? item.price : line.price;
    return base + (line.temp === 'iced' ? (S.view.settings.icedSurcharge || 0) : 0) + (milk ? milk.surcharge || 0 : 0);
  }
  function cartTotal() { return cart.reduce((s, l) => s + unitPrice(l) * l.qty, 0); }
  function viewOrder() {
    const items = menuItems();
    const ms = milks();
    const total = cartTotal();
    const ice = S.view.settings.icedSurcharge || 0;
    const inCart = {}; cart.forEach((l) => { inCart[l.itemId] = (inCart[l.itemId] || 0) + l.qty; });
    let h = '<div class="order"><section><div class="sect-h"><h2>Drinks</h2><span class="mute">' + items.filter((i) => !i.soldOut).length + ' available</span></div><div class="drinks">';
    for (const it of items) {
      const meta = [(it.temps || []).includes('iced') ? ((it.temps || []).includes('hot') ? 'Hot / Iced' : 'Iced') : 'Hot only'];
      if (it.milk) meta.push('Milk / Oat'); else meta.push('Black');
      h += '<button class="drink' + (it.soldOut ? ' out' : '') + '" data-add="' + esc(it.id) + '" aria-label="Add ' + esc(it.name) + '">' +
        (inCart[it.id] ? '<span class="count num">' + inCart[it.id] + '</span>' : '<span class="plus">' + ic('plus') + '</span>') +
        '<b>' + esc(it.name) + '</b><div class="meta">' + meta.map((m) => '<span>' + m + '</span>').join('') + '</div>' +
        '<span class="price num">' + (it.soldOut ? 'Sold out' : '$' + C.money(it.price)) + '</span></button>';
    }
    h += '</div><p class="tip">' + ic('info') + 'Tap to add. Set hot / iced (+$' + C.money(ice) + ') and milk on the order line.</p></section>';
    h += '<aside class="cart"><h2><span>New order</span><span class="tag-no num">No. ' + C.fmtNo(peekNumber()) + '</span></h2>';
    if (!cart.length) h += '<div class="empty">' + ic('coffee') + 'Tap a drink to start an order</div>';
    cart.forEach((l, i) => {
      const item = S.view.menu.items[l.itemId] || { name: l.name, temps: ['hot'], milk: false };
      h += '<div class="line"><div class="hd"><span>' + esc(item.name) + (item.soldOut ? ' <span class="tag" style="color:var(--warn)">SOLD OUT</span>' : '') + '</span><span class="num">$' + C.money(unitPrice(l) * l.qty) + '</span></div><div class="opts">';
      for (const t of ['hot', 'iced']) {
        if ((item.temps || ['hot']).includes(t)) h += '<button class="chip' + (l.temp === t ? ' on ' + t : '') + '" data-line="' + i + '" data-temp="' + t + '">' + ic(t === 'hot' ? 'fire' : 'snowflake') + (t === 'hot' ? 'Hot' : 'Iced' + (ice ? ' +$' + C.money(ice) : '')) + '</button>';
      }
      if (item.milk) for (const m of ms) {
        h += '<button class="chip' + (l.milkId === m.id ? ' on' : '') + '" data-line="' + i + '" data-milk="' + esc(m.id) + '"' + (m.soldOut ? ' disabled' : '') + '>' + esc(m.name) + (m.surcharge ? ' +$' + C.money(m.surcharge) : '') + '</button>';
      }
      h += '</div><div class="qty"><button class="step" data-line="' + i + '" data-q="-1" aria-label="Fewer">' + ic('minus') + '</button><b class="num">' + l.qty + '</b><button class="step" data-line="' + i + '" data-q="1" aria-label="More">' + ic('plus') + '</button>' +
        '<button class="rm" data-line="' + i + '" data-rm="1">' + ic('trash') + 'Remove</button></div></div>';
    });
    h += '<label class="field">First name <small>(for calling out the order)</small><input id="fName" type="text" autocomplete="off" autocapitalize="words" maxlength="20" value="' + esc(draft.name) + '" placeholder="e.g. Mei"></label>';
    h += '<label class="field">Mobile <small>(optional)</small><input id="fMobile" type="tel" inputmode="tel" autocomplete="off" maxlength="16" value="' + esc(draft.mobile) + '" placeholder="Only if guest wants a call"></label>';
    if (draft.mobile) h += '<label class="consent"><input id="fConsent" type="checkbox"' + (draft.consent ? ' checked' : '') + '> Guest agrees Beans&amp;Beats may use this number only to reach them about this order today. It is deleted once the drink is collected.</label>';
    h += '<div class="bill"><span>' + ic('cash-register') + 'Bill on POS</span><b class="num">$' + C.money(total) + '</b></div>';
    const ok = cart.length && draft.name.trim() && (!draft.mobile || draft.consent) && cart.every((l) => { const it = S.view.menu.items[l.itemId]; return it && !it.soldOut; });
    h += '<div class="pay"><button class="btn dark" data-pay="paynow"' + (ok ? '' : ' disabled') + '>' + ic('qr-code') + 'Paid · PayNow</button><button class="btn dark" data-pay="card"' + (ok ? '' : ' disabled') + '>' + ic('credit-card') + 'Paid · Card</button></div>';
    if (cart.length && !ok) h += '<div class="hint">' + (!draft.name.trim() ? 'Add the guest\'s first name to continue.' : draft.mobile && !draft.consent ? 'Tick consent or clear the mobile number.' : 'Remove sold-out drinks to continue.') + '</div>';
    if (cart.length) h += '<button class="btn" data-act="clearCart">' + ic('x') + 'Clear order</button>';
    h += '</aside></div>';
    return h;
  }
  let _peek = null;
  function peekNumber() {
    const day = today(); const st = Number(S.station) || 1, n = Number(S.stations) || 1;
    let max = LS.get('counter.' + day, 0);
    for (const o of orders()) if (o.day === day && (o.no % n) === (st % n) && o.no > max) max = o.no;
    _peek = max ? max + n : st; return _peek;
  }
  function addDrink(id) {
    const it = S.view.menu.items[id]; if (!it || it.soldOut) return;
    const firstMilk = milks().find((m) => !m.soldOut);
    cart.push({ itemId: id, name: it.name, qty: 1, temp: (it.temps || ['hot'])[0], milkId: it.milk && firstMilk ? firstMilk.id : null });
    saveCart(); render();
  }
  function placeOrder(pay) {
    const name = draft.name.trim().split(/\s+/)[0].slice(0, 20);
    const no = nextNumber();
    const token = rid(16);
    const items = cart.map((l) => {
      const m = l.milkId && S.view.menu.milks[l.milkId];
      return { itemId: l.itemId, name: S.view.menu.items[l.itemId].name, price: unitPrice(l), qty: l.qty, temp: l.temp, milkId: m ? m.id : null, milkName: m ? m.name : null };
    });
    const mobile = draft.mobile && draft.consent ? draft.mobile.replace(/\s/g, '') : null;
    const op = dispatch('order.create', { id: uuid(), no, token, station: Number(S.station) || 1, name, mobile, consent: !!mobile, items, pay });
    cart = []; draft = { name: '', mobile: '', consent: false }; saveCart();
    showConfirm(S.view.orders[op.payload.id]);
  }
  let modal = '', modalTimer = null;
  function showConfirm(o) {
    const url = guestUrl(o);
    modal = '<div class="modal" data-act="closeModal"><div class="sheet">' +
      '<div class="paid">' + ic('check-circle') + 'Paid $' + C.money(C.orderTotal(o)) + ' by ' + (o.pay === 'card' ? 'card' : 'PayNow') + '</div>' +
      '<div class="mute">Order number</div><div class="big num">' + C.fmtNo(o.no) + '</div>' +
      '<div class="who">' + esc(o.name) + ', ' + esc(C.describeItems(o)) + '</div>' +
      '<div class="qr">' + qrSvg(url) + '</div><div style="font-weight:700;font-size:20px">Scan to follow your order live.<br>We\'ll alert you when it\'s ready.</div><div class="mute" style="font-size:14px">Turn the tablet to the guest. No receipt: they show this page at pickup.</div>' +
      '<button class="btn dark" data-act="closeModal">' + ic('arrow-right') + 'Next order</button></div></div>';
    render();
    clearTimeout(modalTimer); modalTimer = setTimeout(() => { modal = ''; render(); }, 45000);
  }

  // ---- queue
  function viewQueue() {
    const day = today();
    const list = orders().filter((o) => ['queued', 'making', 'ready'].includes(o.status)).sort((a, b) => a.createdAt - b.createdAt);
    const cols = [
      { st: 'queued', title: 'Up next', btn: 'Start making', next: 'making' },
      { st: 'making', title: 'Making', btn: 'Ready', next: 'ready' },
      { st: 'ready', title: 'Ready · waiting', btn: 'Collected', next: 'collected' },
    ];
    const todays = orders().filter((o) => o.day === day && o.status !== 'cancelled');
    const waits = todays.filter((o) => o.times && o.times.ready).map((o) => (o.times.ready - o.createdAt) / 60000);
    const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null;
    let h = '<div class="qbar"><button class="btn dark" data-act="scan">' + ic('scan') + 'Scan to collect</button>' +
      '<div class="stats"><div><small>Cups today</small><b class="num">' + todays.reduce((a, o) => a + C.orderCups(o), 0) + '</b></div>' +
      '<div><small>In progress</small><b class="num">' + list.filter((o) => o.status !== 'ready').length + '</b></div>' +
      '<div><small>Avg. order to ready</small><b class="num">' + (avg == null ? '–' : avg + 'm') + '</b></div></div></div><div class="queue">';
    for (const c of cols) {
      const os = list.filter((o) => o.status === c.st);
      const cicon = { queued: 'tray', making: 'coffee', ready: 'bell-ringing' }[c.st];
      h += '<section class="col c-' + c.st + '"><h2><span>' + ic(cicon) + c.title + '</span><span class="cnt num">' + os.length + (os.length === 1 ? ' order · ' : ' orders · ') + os.reduce((s, o) => s + C.orderCups(o), 0) + ' cups</span></h2>';
      if (!os.length) h += '<div class="empty">' + ic({ queued: 'smiley', making: 'coffee-bean', ready: 'check-circle' }[c.st]) + { queued: 'No orders waiting', making: 'Nothing on the bar', ready: 'Everything collected' }[c.st] + '</div>';
      for (const o of os) {
        const age = ageMin(o.createdAt);
        const since = ageMin(o.statusAt);
        h += '<article class="card ' + o.status + '"><div class="hd"><span class="no num">' + C.fmtNo(o.no) + '</span><span class="nm">' + esc(o.name || '—') + '</span>' +
          '<span class="age num' + (age >= 10 && o.status !== 'ready' ? ' late' : '') + (o.status === 'ready' && since >= 10 ? ' late' : '') + '">' + ic('clock') + (o.status === 'ready' ? since + 'm waiting' : age + 'm') + '</span></div>' +
          '<ul>' + o.items.map((it) => '<li>' + lineDesc(it) + '</li>').join('') + '</ul>' +
          (o.mobile && o.status === 'ready' && since >= 5 ? '<div style="font-size:13px">Mobile on file: ' + esc(o.mobile.replace(/.(?=.{4})/g, '•')) + ' <button class="chip" data-call="' + o.id + '">Show</button></div>' : '') +
          (S.pendingIds.has(o.id) ? '<div class="pending-sync">' + ic('cloud-arrow-up') + 'Saved on this tablet, syncing</div>' : '') +
          (o.day !== day ? '<div class="pending-sync">from ' + esc(o.day) + '</div>' : '') +
          '<div class="act"><button class="btn dark" data-st="' + c.next + '" data-id="' + o.id + '">' + ic({ making: 'play', ready: 'bell-ringing', collected: 'hand-coins' }[c.next]) + c.btn + '</button>' +
          '<button class="btn more" data-more="' + o.id + '" aria-label="More actions">' + ic('dots-three') + '</button></div></article>';
      }
      h += '</section>';
    }
    h += '</div>';
    const done = orders().filter((o) => o.day === day && (o.status === 'collected' || o.status === 'cancelled')).sort((a, b) => b.statusAt - a.statusAt).slice(0, 8);
    if (done.length) {
      h += '<div class="recent"><div class="sect-h"><h3 style="font-size:16px">Recently collected</h3></div><div class="recent-list">' +
        done.map((o) => '<div class="recent-item"><b class="num">' + C.fmtNo(o.no) + ' <span style="font-weight:650;font-size:16px">' + esc(o.name || '') + '</span></b><small>' + esc(C.describeItems(o)) + '</small><small>' + (o.status === 'cancelled' ? 'Cancelled' : 'Collected') + ' ' + C.sgTime(o.statusAt) + '</small><button class="chip" data-st="ready" data-id="' + o.id + '">' + ic('arrow-counter-clockwise') + 'Back to ready</button></div>').join('') +
        '</div></div>';
    }
    return h;
  }
  function moreMenu(id) {
    const o = S.view.orders[id]; if (!o) return;
    const back = { making: 'queued', ready: 'making' }[o.status];
    modal = '<div class="modal" data-act="closeModal"><div class="sheet"><div class="big num" style="font-size:56px">' + C.fmtNo(o.no) + '</div><div>' + esc(o.name || '') + ' · ' + esc(C.describeItems(o)) + '</div>' +
      (back ? '<button class="btn line" data-st="' + back + '" data-id="' + id + '">Undo: move back to ' + (back === 'queued' ? 'Up next' : 'Making') + '</button>' : '') +
      '<button class="btn line" data-reprint="' + id + '">Show guest QR again</button>' +
      '<button class="btn warn" data-st="cancelled" data-id="' + id + '" data-confirm="Cancel order ' + C.fmtNo(o.no) + '? Remember to refund on the POS.">Cancel order</button>' +
      '<button class="btn" data-act="closeModal">Close</button></div></div>';
    render();
  }

  // ---- board (public screen)
  let lastReady = new Set(LS.get('boardSeen', []));
  let boardFirst = true;
  function chime() {
    try {
      const ctx = chime.ctx || (chime.ctx = new (window.AudioContext || window.webkitAudioContext)());
      [880, 1175, 1568].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.16;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
      });
    } catch (e) { /* audio blocked until first tap */ }
  }
  function renderBoard() {
    const ready = orders().filter((o) => o.status === 'ready').sort((a, b) => b.statusAt - a.statusAt);
    const making = orders().filter((o) => o.status === 'making').sort((a, b) => a.statusAt - b.statusAt);
    const fresh = ready.filter((o) => !lastReady.has(o.id));
    if (fresh.length && !boardFirst) chime();
    boardFirst = false;
    lastReady = new Set(ready.map((o) => o.id)); LS.set('boardSeen', Array.from(lastReady));
    const MAXR = 7, MAXM = 7;
    const row = (o, isFresh) => '<div class="row' + (isFresh ? ' fresh' : '') + '"><b class="num">' + C.fmtNo(o.no) + '</b><span>' + esc(o.name || '') + '</span></div>';
    $app.innerHTML = '<div class="board"><div class="bhd"><h1>Beans&amp;Beats <small>Order at the counter, collect here</small></h1><div id="net"></div></div><div class="cols">' +
      '<section class="ready-list"><h2>' + ic('bell-ringing') + 'Ready to collect</h2>' + (ready.length ? ready.slice(0, MAXR).map((o) => row(o, fresh.includes(o))).join('') : '<div class="idle">Your number will appear here when your drink is ready.</div>') +
      (ready.length > MAXR ? '<div class="more-count">+ ' + (ready.length - MAXR) + ' more at the counter</div>' : '') + '</section>' +
      '<section class="making"><h2>' + ic('coffee') + 'Making now</h2>' + (making.length ? making.slice(0, MAXM).map((o) => row(o)).join('') : '<div class="idle">Nothing on the bar</div>') +
      (making.length > MAXM ? '<div class="more-count">+ ' + (making.length - MAXM) + ' more</div>' : '') + '</section></div>' +
      '<footer><span>All profits go to Singapore Red Cross Young Hearts</span><span>' + esc(S.view.settings.credit || '') + '</span></footer>' +
      '<button class="exit" data-go="queue">Exit board</button></div>';
    renderNet();
  }
  setInterval(() => { if (S.token && (route === 'queue')) render(); }, 30000);

  // ---- menu controls (lead)
  function viewMenu() {
    const items = menuItems(); const ms = milks();
    let h = '<div class="panel"><h2><span>Drinks</span><button class="btn dark" data-act="addItem">' + ic('plus') + 'Add drink</button></h2><table><thead><tr><th>Name</th><th>Price $</th><th>Hot</th><th>Iced</th><th>Milk choice</th><th>Status</th><th></th></tr></thead><tbody>';
    for (const it of items) {
      h += '<tr><td><input type="text" id="n-' + esc(it.id) + '" value="' + esc(it.name) + '" data-edit="' + esc(it.id) + '" data-field="name"></td>' +
        '<td><input type="number" id="p-' + esc(it.id) + '" step="0.10" min="0" value="' + C.money(it.price) + '" data-edit="' + esc(it.id) + '" data-field="price"></td>' +
        '<td><input type="checkbox" data-edit="' + esc(it.id) + '" data-field="hot"' + ((it.temps || []).includes('hot') ? ' checked' : '') + '></td>' +
        '<td><input type="checkbox" data-edit="' + esc(it.id) + '" data-field="iced"' + ((it.temps || []).includes('iced') ? ' checked' : '') + '></td>' +
        '<td><input type="checkbox" data-edit="' + esc(it.id) + '" data-field="milk"' + (it.milk ? ' checked' : '') + '></td>' +
        '<td><button class="toggle' + (it.soldOut ? ' out' : '') + '" data-sold="' + esc(it.id) + '">' + ic(it.soldOut ? 'prohibit' : 'check') + (it.soldOut ? 'Sold out' : 'Available') + '</button></td>' +
        '<td><button class="chip" data-delitem="' + esc(it.id) + '">Delete</button></td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="panel"><h2><span>Milk &amp; surcharges</span><button class="btn" data-act="addMilk">' + ic('plus') + 'Add milk</button></h2><table><thead><tr><th>Milk</th><th>Surcharge $</th><th>Status</th><th></th></tr></thead><tbody>';
    for (const m of ms) {
      h += '<tr><td><input type="text" id="mn-' + esc(m.id) + '" value="' + esc(m.name) + '" data-medit="' + esc(m.id) + '" data-field="name"></td>' +
        '<td><input type="number" id="ms-' + esc(m.id) + '" step="0.10" min="0" value="' + C.money(m.surcharge || 0) + '" data-medit="' + esc(m.id) + '" data-field="surcharge"></td>' +
        '<td><button class="toggle' + (m.soldOut ? ' out' : '') + '" data-msold="' + esc(m.id) + '">' + ic(m.soldOut ? 'prohibit' : 'check') + (m.soldOut ? 'Sold out' : 'Available') + '</button></td>' +
        '<td><button class="chip" data-delmilk="' + esc(m.id) + '">Delete</button></td></tr>';
    }
    h += '<tr><td><b>Iced surcharge</b></td><td><input type="number" id="iceS" step="0.10" min="0" value="' + C.money(S.view.settings.icedSurcharge || 0) + '" data-setting="icedSurcharge"></td><td colspan="2" class="mute">added to any iced drink</td></tr>';
    h += '</tbody></table></div>';
    h += '<div class="panel"><h2>Ready board credit line</h2><input type="text" id="creditIn" style="width:100%;padding:10px;border:2px solid var(--ink);border-radius:10px;font-size:16px" value="' + esc(S.view.settings.credit || '') + '" data-setting="credit"></div>';
    h += '<p class="mute">Changes apply on every tablet as soon as they sync, and are saved offline in the meantime. Price changes only affect new orders.</p>';
    return h;
  }
  function upsertItem(id, data) {
    const cur = S.view.menu.items[id] || {};
    const clean = { name: cur.name, price: cur.price, temps: cur.temps, milk: cur.milk, sort: cur.sort, soldOut: cur.soldOut };
    dispatch('menu.upsert', { kind: 'item', id, data: Object.assign(clean, data) });
  }
  function upsertMilk(id, data) {
    const cur = S.view.menu.milks[id] || {};
    dispatch('menu.upsert', { kind: 'milk', id, data: Object.assign({ name: cur.name, surcharge: cur.surcharge, sort: cur.sort, soldOut: cur.soldOut }, data) });
  }

  // ---- report (lead)
  let reportDay = null;
  function viewReport() {
    const days = Array.from(new Set(orders().map((o) => o.day).concat([today()]))).sort().reverse();
    if (!reportDay || !days.includes(reportDay)) reportDay = today();
    const r = C.report(S.view, reportDay);
    const closed = S.view.closedDays[reportDay];
    let h = '<div class="panel"><h2><span>Daily sales · ' + esc(reportDay) + (closed ? ' · closed' : '') + '</span><select id="daySel" style="padding:8px;border-radius:8px;font-size:16px">' +
      days.map((d) => '<option' + (d === reportDay ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></h2>';
    h += '<div class="kpis"><div class="kpi hero"><small>' + ic('coins') + 'Total sales (SGD)</small><b class="num">$' + C.money(r.total) + '</b></div>' +
      '<div class="kpi"><small>' + ic('coffee') + 'Cups</small><b class="num">' + r.cups + '</b></div><div class="kpi"><small>' + ic('receipt') + 'Orders</small><b class="num">' + r.orders + '</b></div>' +
      '<div class="kpi"><small>' + ic('qr-code') + 'PayNow</small><b class="num">$' + C.money(r.byPay.paynow.total) + '</b></div>' +
      '<div class="kpi"><small>' + ic('credit-card') + 'Card</small><b class="num">$' + C.money(r.byPay.card.total) + '</b></div></div>' +
      (r.cancelled ? '<p class="mute" style="margin-top:-8px">' + r.cancelled + ' cancelled order(s) excluded.</p>' : '');
    h += '<table><thead><tr><th>Drink</th><th>Hot</th><th>Iced</th><th>Oat/alt</th><th>Cups</th><th>Total $</th></tr></thead><tbody>' +
      (r.byItem.length ? r.byItem.map((i) => '<tr><td>' + esc(i.name) + '</td><td class="num">' + i.hot + '</td><td class="num">' + i.iced + '</td><td class="num">' + i.oat + '</td><td class="num"><b>' + i.cups + '</b></td><td class="num">' + C.money(i.total) + '</td></tr>').join('') : '<tr><td colspan="6" class="mute">No sales yet</td></tr>') +
      '</tbody></table>';
    const hours = Object.keys(r.byHour).map(Number).sort((a, b) => a - b);
    const maxC = Math.max(1, ...hours.map((x) => r.byHour[x].cups));
    if (hours.length) h += '<h3 style="margin:18px 0 8px">Cups by hour (SGT)</h3><div class="bars">' + hours.map((x) => '<div class="bar"><span class="num">' + String(x).padStart(2, '0') + ':00</span><div style="width:' + (100 * r.byHour[x].cups / maxC) + '%"></div><span class="num">' + r.byHour[x].cups + ' · $' + C.money(r.byHour[x].total) + '</span></div>').join('') + '</div>';
    h += '<div class="row-actions" style="margin-top:18px"><button class="btn dark" data-act="csv">' + ic('download-simple') + 'Download CSV for ' + esc(reportDay) + '</button><button class="btn line" data-act="csvAll">' + ic('calendar') + 'All days summary</button></div>';
    h += '<p class="mute" style="font-size:13px">The CSV lists one row per order (match each against a POS transaction by time and amount), then every drink line and a summary. It contains no names or phone numbers. It is generated on this tablet, so it works offline.</p></div>';
    h += '<div class="panel"><h2>End of day</h2><p>Close <b>' + esc(reportDay) + '</b> after the last drink is handed over. This marks any leftover orders collected, permanently deletes guest names and mobiles for that day on every device and on the server, and keeps the sales figures. Order numbers restart at 001 automatically each new day.</p>' +
      (closed ? '<p><b>Closed at ' + C.sgTime(closed) + '.</b></p>' : '<button class="btn warn" data-act="closeDay">' + ic('lock-key') + 'Close ' + esc(reportDay) + ' and wipe guest data</button>') + '</div>';
    return h;
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---- guest-facing display (second screen at the counter, paperless)
  function renderDisplay() {
    const st = Number(S.station) || 1;
    const latest = orders().filter((o) => o.station === st && o.status !== 'cancelled' && now() - o.createdAt < 90000).sort((a, b) => b.createdAt - a.createdAt)[0];
    let inner;
    if (latest) {
      inner = '<div class="display-hero"><div><div style="font-size:2.2vw;color:#8a8a83;font-weight:600">Thanks, ' + esc(latest.name || '') + '. Your order number</div>' +
        '<div class="big num">' + C.fmtNo(latest.no) + '</div><div style="font-size:2.4vw;font-weight:750;margin-top:3vh;display:flex;gap:1vw;align-items:center">' + ic('device-mobile') + 'Scan to follow your drink live</div>' +
        '<div style="font-size:1.5vw;color:#8a8a83;margin-top:1vh">We\'ll alert you when it\'s ready. Show the page at pickup.</div></div>' +
        '<div class="qrbox">' + qrSvg(guestUrl(latest)) + '</div></div>';
    } else {
      const items = menuItems();
      inner = '<div><h2 style="font-size:2.2vw;color:#bdbdbd;margin-bottom:3vh">Today\'s menu</h2>' + items.map((it) => '<div class="row"><b style="font-size:3.6vw;min-width:auto;flex:1' + (it.soldOut ? ';text-decoration:line-through;color:#555' : '') + '">' + esc(it.name) + '</b><span class="num">' + (it.soldOut ? 'Sold out' : '$' + C.money(it.price)) + '</span></div>').join('') +
        '<p style="color:#8c8c8c;font-size:1.6vw">Iced +$' + C.money(S.view.settings.icedSurcharge || 0) + ' · ' + milks().filter((m) => m.surcharge).map((m) => esc(m.name) + ' milk +$' + C.money(m.surcharge)).join(' · ') + '</p></div>';
    }
    $app.innerHTML = '<div class="board"><div class="bhd"><h1>Beans&amp;Beats</h1><div id="net"></div></div>' + inner +
      '<footer><span>All profits go to Singapore Red Cross Young Hearts</span><span>' + esc(S.view.settings.credit || '') + '</span></footer><button class="exit" data-go="order">Exit display</button></div>';
    renderNet();
    clearTimeout(renderDisplay.t);
    if (latest) renderDisplay.t = setTimeout(() => { if (route === 'display') render(); }, 90000 - (now() - latest.createdAt) + 200);
  }
  function guestUrl(o) {
    // The fragment (#...) carries enough to render the guest page before this
    // tablet has synced. Browsers never send fragments to the server.
    const snap = btoa(unescape(encodeURIComponent(JSON.stringify({ no: C.fmtNo(o.no), name: o.name, items: C.describeItems(o) })))).replace(/=+$/, '');
    return location.origin + '/o/' + o.token + '#' + snap;
  }

  // ---- camera scanner for collection (BarcodeDetector, jsQR fallback)
  const scan = { el: null, stream: null, raf: null, detector: null, busy: false, pause: 0 };
  function loadJsQR() {
    return window.jsQR ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = '/vendor/jsqr.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  }
  async function openScanner() {
    closeScanner();
    const el = document.createElement('div');
    el.className = 'modal'; el.style.zIndex = 60;
    el.innerHTML = '<div class="sheet"><h2>Scan to collect</h2><video playsinline muted style="width:100%;max-height:50vh;border-radius:12px;background:#000;object-fit:cover"></video>' +
      '<div class="scan-out" style="min-height:120px;display:grid;gap:8px;align-content:center"><div class="mute">Point the camera at the QR on the guest\'s phone.</div></div>' +
      '<button class="btn" data-x="close">Close</button></div>';
    document.body.appendChild(el); scan.el = el;
    el.addEventListener('click', onScanClick);
    const video = el.querySelector('video');
    try {
      scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      scanMsg('<b>Camera not available.</b><div class="mute">Allow camera access for this site (needs https), or mark the order collected from the Queue.</div>'); return;
    }
    if (!scan.el) { scan.stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = scan.stream; await video.play().catch(() => {});
    if (!scan.detector && 'BarcodeDetector' in window) {
      try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) scan.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { /* fall back */ }
    }
    if (!scan.detector) await loadJsQR().catch(() => scanMsg('Scanner library failed to load.'));
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!scan.el) return;
      if (!scan.busy && Date.now() > scan.pause && video.readyState >= 2) {
        scan.busy = true;
        try {
          let text = null;
          if (scan.detector) { const r = await scan.detector.detect(video); if (r[0]) text = r[0].rawValue; }
          else if (window.jsQR) {
            const w = 480, h = Math.round(480 * video.videoHeight / video.videoWidth) || 360;
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' }); if (r) text = r.data;
          }
          if (text) onScanned(text);
        } catch (e) { /* keep scanning */ }
        scan.busy = false;
      }
      scan.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function scanMsg(html) { if (scan.el) scan.el.querySelector('.scan-out').innerHTML = html; }
  function closeScanner() {
    if (scan.raf) cancelAnimationFrame(scan.raf);
    if (scan.stream) scan.stream.getTracks().forEach((t) => t.stop());
    if (scan.el) scan.el.remove();
    scan.el = scan.stream = scan.raf = null;
  }
  function onScanned(text) {
    const m = String(text).match(/(?:\/o\/|BB:)([A-Za-z0-9_-]{16,64})/);
    scan.pause = Date.now() + 2500;
    if (!m) { scanMsg('<b>Not a Beans&amp;Beats order QR.</b>'); return; }
    const o = orders().find((x) => x.token === m[1]);
    if (!o) { scanMsg('<b>Order not found on this tablet yet.</b><div class="mute">It may still be syncing from the order tablet. Check the number on the guest\'s screen.</div>'); return; }
    if (navigator.vibrate) navigator.vibrate(60);
    const head = '<div style="font-size:64px;font-weight:900;line-height:1" class="num">' + C.fmtNo(o.no) + '</div><div style="font-size:22px;font-weight:700">' + esc(o.name || '') + '</div><div>' + o.items.map(lineDesc).join('<br>') + '</div>';
    const box = (bg, fg, txt) => '<div style="background:' + bg + ';color:' + fg + ';font-weight:800;padding:12px;border-radius:10px">' + txt + '</div>';
    if (o.status === 'ready') {
      dispatch('order.status', { id: o.id, status: 'collected' });
      scanMsg(head + box('#ecfdf3', '#067647', 'Collected. Hand over the drink.') + '<button class="btn line" data-x="undo" data-id="' + o.id + '">Undo</button>');
      chime();
    } else if (o.status === 'collected') {
      scanMsg(head + box('#fef3f2', 'var(--warn)', 'Already collected at ' + C.sgTime(o.statusAt)));
    } else if (o.status === 'cancelled') {
      scanMsg(head + box('#fef3f2', 'var(--warn)', 'This order was cancelled.'));
    } else {
      scan.pause = Date.now() + 5000;
      scanMsg(head + box('#fffaeb', 'var(--amber)', 'Not ready yet (' + (o.status === 'making' ? 'making' : 'in queue') + ')') + '<button class="btn dark" data-x="force" data-id="' + o.id + '">Hand over anyway</button>');
    }
  }
  function onScanClick(e) {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'close') return closeScanner();
    if (b.dataset.x === 'undo') { dispatch('order.status', { id: b.dataset.id, status: 'ready' }); scanMsg('<b>Undone. Order is back on the ready list.</b>'); }
    if (b.dataset.x === 'force') { dispatch('order.status', { id: b.dataset.id, status: 'collected' }); scanMsg('<b>Collected.</b>'); scan.pause = Date.now() + 1500; }
  }

  // ---- device settings
  function settingsModal() {
    modal = '<div class="modal" data-act="closeModal"><div class="sheet" style="text-align:left"><h2>This device</h2><div class="settings-grid">' +
      '<label>Order station number<select id="stSel">' + [1, 2, 3, 4].map((n) => '<option' + (n == S.station ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<label>Order stations at the booth<select id="stsSel">' + [1, 2, 3, 4].map((n) => '<option' + (n == S.stations ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<p class="mute" style="margin:0;font-size:13px">With 2 order tablets, tablet 1 issues odd numbers and tablet 2 even numbers, so they never clash even while offline. Set this before the first order of the day.</p>' +
      '<label class="switch"><input type="checkbox" id="simOff"' + (S.simOffline ? ' checked' : '') + '> ' + ic('wifi-slash') + 'Simulate wifi drop on this device</label>' +
      '<p class="mute" style="margin:0;font-size:13px">Signed in as <b>' + esc(S.role === 'lead' ? 'Booth lead' : 'Barista') + '</b>. Device ' + esc(S.device) + '. ' + S.outbox.length + ' change(s) waiting to sync.</p>' +
      '<button class="btn dark" data-act="saveSettings">Save</button>' +
      '<button class="btn" data-act="logout"' + (S.outbox.length ? ' disabled title="Sync pending changes first"' : '') + '>Log out' + (S.outbox.length ? ' (sync first)' : '') + '</button></div></div></div>';
    render();
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'loginForm') { e.preventDefault(); doLogin(pinBuf); }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'fName') { draft.name = t.value.replace(/[^\p{L}\p{M}' .-]/gu, ''); saveCart(); refreshPay(); }
    if (t.id === 'fMobile') { const had = !!draft.mobile; draft.mobile = t.value.replace(/[^\d+ ]/g, ''); saveCart(); if (had !== !!draft.mobile) render(); else refreshPay(); }
  });
  function refreshPay() { const keep = document.activeElement && document.activeElement.id; render(); if (keep) { const el = document.getElementById(keep); if (el) el.focus(); } }
  document.addEventListener('change', (e) => {
    const t = e.target, d = t.dataset;
    if (t.id === 'fConsent') { draft.consent = t.checked; saveCart(); render(); }
    if (t.id === 'daySel') { reportDay = t.value; render(); }
    if (d.edit) {
      const cur = S.view.menu.items[d.edit];
      if (d.field === 'name' && t.value.trim()) upsertItem(d.edit, { name: t.value.trim() });
      if (d.field === 'price') { const c = Math.round(parseFloat(t.value) * 100); if (c >= 0) upsertItem(d.edit, { price: c }); }
      if (d.field === 'hot' || d.field === 'iced') {
        let temps = (cur.temps || []).filter((x) => x !== d.field); if (t.checked) temps.push(d.field);
        if (!temps.length) { toast('A drink needs hot or iced'); render(); return; }
        upsertItem(d.edit, { temps: ['hot', 'iced'].filter((x) => temps.includes(x)) });
      }
      if (d.field === 'milk') upsertItem(d.edit, { milk: t.checked });
      toast('Saved');
    }
    if (d.medit) {
      if (d.field === 'name' && t.value.trim()) upsertMilk(d.medit, { name: t.value.trim() });
      if (d.field === 'surcharge') { const c = Math.round(parseFloat(t.value) * 100); if (c >= 0) upsertMilk(d.medit, { surcharge: c }); }
      toast('Saved');
    }
    if (d.setting) {
      const v = d.setting === 'icedSurcharge' ? Math.max(0, Math.round(parseFloat(t.value) * 100) || 0) : t.value.slice(0, 120);
      dispatch('settings.update', { [d.setting]: v }); toast('Saved');
    }
  });
  document.addEventListener('click', (e) => {
    const k = e.target.closest('[data-key]'); if (k) { pinKey(k.dataset.key); return; }
    const t = e.target.closest('[data-go],[data-act],[data-add],[data-line],[data-pay],[data-st],[data-more],[data-sold],[data-msold],[data-delitem],[data-delmilk],[data-reprint],[data-call]');
    if (!t) return;
    const d = t.dataset;
    if (d.go) { e.preventDefault(); modal = ''; go(d.go); if (d.go === 'board') { chime.ctx || chime(); } return; }
    if (d.add) return addDrink(d.add);
    if (d.line != null) {
      const l = cart[Number(d.line)]; if (!l) return;
      if (d.temp) l.temp = d.temp;
      if (d.milk) l.milkId = d.milk;
      if (d.q) l.qty = Math.max(1, Math.min(20, l.qty + Number(d.q)));
      if (d.rm) cart.splice(Number(d.line), 1);
      saveCart(); return render();
    }
    if (d.pay) return placeOrder(d.pay);
    if (d.st) {
      if (d.confirm && !confirm(d.confirm)) return;
      modal = '';
      dispatch('order.status', { id: d.id, status: d.st });
      return;
    }
    if (d.more) return moreMenu(d.more);
    if (d.reprint) { const o = S.view.orders[d.reprint]; modal = ''; return showConfirm(o); }
    if (d.call) { const o = S.view.orders[d.call]; if (o && o.mobile) alert(o.name + ': ' + o.mobile); return; }
    if (d.sold) { const it = S.view.menu.items[d.sold]; upsertItem(d.sold, { soldOut: !it.soldOut }); return; }
    if (d.msold) { const m = S.view.menu.milks[d.msold]; upsertMilk(d.msold, { soldOut: !m.soldOut }); return; }
    if (d.delitem) { if (confirm('Delete ' + S.view.menu.items[d.delitem].name + ' from the menu?')) dispatch('menu.delete', { kind: 'item', id: d.delitem }); return; }
    if (d.delmilk) { if (confirm('Delete this milk option?')) dispatch('menu.delete', { kind: 'milk', id: d.delmilk }); return; }
    switch (d.act) {
      case 'closeModal': if (e.target === t || t.tagName === 'BUTTON') { modal = ''; clearTimeout(modalTimer); render(); } break;
      case 'scan': openScanner(); break;
      case 'clearCart': cart = []; saveCart(); render(); break;
      case 'settings': settingsModal(); break;
      case 'saveSettings': {
        S.station = Number($('#stSel').value); S.stations = Number($('#stsSel').value);
        if (S.station > S.stations) S.stations = S.station;
        const sim = $('#simOff').checked;
        LS.set('station', S.station); LS.set('stations', S.stations);
        if (sim !== S.simOffline) { S.simOffline = sim; LS.set('simOffline', sim); if (sim) { closeStream(); S.online = false; } else syncSoon(0); }
        modal = ''; render(); toast(sim ? 'Wifi drop simulated: changes stay on this device' : 'Saved'); break;
      }
      case 'logout': modal = ''; logout(); break;
      case 'addItem': { const name = prompt('Drink name'); if (!name) return; const price = Math.round(parseFloat(prompt('Price in $ (hot)', '8') || '0') * 100);
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + rid(3);
        dispatch('menu.upsert', { kind: 'item', id, data: { name: name.trim(), price: price || 0, temps: ['hot', 'iced'], milk: true, sort: menuItems().length + 1, soldOut: false } }); break; }
      case 'addMilk': { const name = prompt('Milk name (e.g. Soy)'); if (!name) return;
        dispatch('menu.upsert', { kind: 'milk', id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + rid(3), data: { name: name.trim(), surcharge: 100, sort: milks().length + 1, soldOut: false } }); break; }
      case 'csv': download('beansbeats-sales-' + reportDay + '.csv', C.reportCsv(S.view, reportDay)); break;
      case 'csvAll': download('beansbeats-all-days.csv', C.daysCsv(S.view)); break;
      case 'closeDay': {
        const open = orders().filter((o) => o.day === reportDay && ['queued', 'making', 'ready'].includes(o.status)).length;
        if (!confirm('Close ' + reportDay + '?' + (open ? '\n' + open + ' order(s) are still open and will be marked collected.' : '') + '\nGuest names and mobiles for this day will be permanently deleted. Download the CSV first if you need it.')) return;
        dispatch('day.close', { day: reportDay }); toast('Day closed'); break;
      }
    }
  });

  // ------------------------------------------------------------------ boot
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (!S.token) { route = 'login'; render(); }
  else { rebuild(); if (route === 'login') route = 'order'; render(); sync(); }
  window.__bb = S; // debugging aid
  window.__bbScan = onScanned; // lets tests feed a decoded QR without a camera
})();
