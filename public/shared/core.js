/*
 * Shared, deterministic state core. Loaded by the Node server (require) and by
 * every browser client (<script>). Server and clients apply the SAME ops with
 * the SAME reducer, so every device converges on the same state no matter
 * what order ops arrive in after an offline period.
 *
 * Conflict rules
 *  - order.create  : first write wins (ids are client-generated UUIDs)
 *  - order.status  : last-writer-wins on the op timestamp (ties -> opId)
 *  - menu.upsert   : last-writer-wins per item / milk
 *  - day.close     : wipes personal data (name, mobile) for that SG day
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TZ = 'Asia/Singapore';
  const STATUSES = ['queued', 'making', 'ready', 'collected', 'cancelled'];

  // Ops each role may submit. Guests never submit ops.
  const ROLE_OPS = {
    barista: ['order.create', 'order.status'],
    lead: ['order.create', 'order.status', 'menu.upsert', 'menu.delete', 'day.close', 'settings.update'],
  };

  function sgDay(ts) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ts == null ? Date.now() : ts));
  }
  function sgTime(ts) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(ts));
  }
  function sgHour(ts) {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date(ts))) % 24;
  }
  function fmtNo(n) { return String(n).padStart(3, '0'); }
  function money(cents) { return (cents / 100).toFixed(2); }

  function emptyState() {
    return { orders: {}, menu: { items: {}, milks: {} }, settings: { credit: '', icedSurcharge: 100 }, closedDays: {} };
  }

  function newer(op, prevAt, prevId) {
    if (prevAt == null) return true;
    if (op.at !== prevAt) return op.at > prevAt;
    return String(op.opId) > String(prevId || '');
  }

  function orderTotal(o) {
    return (o.items || []).reduce((s, it) => s + (it.price || 0) * (it.qty || 1), 0);
  }
  function orderCups(o) {
    return (o.items || []).reduce((s, it) => s + (it.qty || 1), 0);
  }
  function describeItems(o) {
    return (o.items || []).map((it) => {
      const bits = [];
      if (it.qty > 1) bits.push(it.qty + '×');
      if (it.temp === 'iced') bits.push('iced');
      if (it.milkName && it.milkName !== 'Milk') bits.push(it.milkName.toLowerCase());
      bits.push(it.name.toLowerCase());
      return bits.join(' ');
    }).join(', ');
  }

  function apply(state, op) {
    const p = op.payload || {};
    switch (op.type) {
      case 'order.create': {
        if (state.orders[p.id]) return false;
        const day = sgDay(op.at);
        state.orders[p.id] = {
          id: p.id,
          no: p.no,
          token: p.token,
          station: p.station || 1,
          name: state.closedDays[day] ? null : String(p.name || '').slice(0, 40),
          mobile: state.closedDays[day] ? null : (p.mobile || null),
          items: (p.items || []).map((it) => ({
            itemId: it.itemId, name: String(it.name).slice(0, 60), price: Math.max(0, Math.round(it.price || 0)),
            qty: Math.max(1, Math.min(20, it.qty | 0 || 1)), temp: it.temp === 'iced' ? 'iced' : 'hot',
            milkId: it.milkId || null, milkName: it.milkName || null,
          })),
          note: p.note ? String(p.note).slice(0, 80) : '',
          pay: p.pay === 'card' ? 'card' : 'paynow',
          day,
          createdAt: op.at,
          status: 'queued',
          statusAt: op.at,
          statusOp: op.opId,
          times: { queued: op.at },
        };
        return true;
      }
      case 'order.status': {
        const o = state.orders[p.id];
        if (!o || STATUSES.indexOf(p.status) < 0) return false;
        if (!newer(op, o.statusAt, o.statusOp)) return false;
        o.status = p.status;
        o.statusAt = op.at;
        o.statusOp = op.opId;
        o.times = Object.assign({}, o.times, { [p.status]: op.at });
        if (p.status === 'collected' || p.status === 'cancelled') o.mobile = null; // PDPA: drop once done
        return true;
      }
      case 'menu.upsert': {
        const bucket = p.kind === 'milk' ? state.menu.milks : state.menu.items;
        const prev = bucket[p.id];
        if (prev && !newer(op, prev._at, prev._op)) return false;
        bucket[p.id] = Object.assign({}, prev || {}, p.data, { id: p.id, _at: op.at, _op: op.opId, deleted: false });
        return true;
      }
      case 'menu.delete': {
        const bucket = p.kind === 'milk' ? state.menu.milks : state.menu.items;
        const prev = bucket[p.id];
        if (!prev || !newer(op, prev._at, prev._op)) return false;
        prev.deleted = true; prev._at = op.at; prev._op = op.opId;
        return true;
      }
      case 'settings.update': {
        Object.assign(state.settings, p);
        return true;
      }
      case 'day.close': {
        state.closedDays[p.day] = op.at;
        for (const id in state.orders) {
          const o = state.orders[id];
          if (o.day !== p.day) continue;
          o.name = null; o.mobile = null;
          if (o.status === 'queued' || o.status === 'making' || o.status === 'ready') {
            o.status = 'collected'; o.statusAt = op.at; o.statusOp = op.opId;
          }
        }
        return true;
      }
    }
    return false;
  }

  // Sales summary for one SG day. Personal data never enters the report.
  function report(state, day) {
    const orders = Object.values(state.orders).filter((o) => o.day === day && o.status !== 'cancelled');
    const byItem = {};
    const byHour = {};
    const byPay = { paynow: { orders: 0, total: 0 }, card: { orders: 0, total: 0 } };
    let cups = 0, total = 0;
    for (const o of orders) {
      for (const it of o.items) {
        const key = it.name;
        byItem[key] = byItem[key] || { name: it.name, cups: 0, total: 0, hot: 0, iced: 0, oat: 0 };
        byItem[key].cups += it.qty; byItem[key].total += it.qty * it.price; byItem[key][it.temp] += it.qty;
        if (it.milkName && it.milkName !== 'Milk') byItem[key].oat += it.qty;
        cups += it.qty; total += it.qty * it.price;
      }
      const pm = byPay[o.pay] || byPay.paynow; pm.orders += 1; pm.total += orderTotal(o);
      const h = sgHour(o.createdAt);
      byHour[h] = byHour[h] || { cups: 0, total: 0 };
      byHour[h].cups += orderCups(o); byHour[h].total += orderTotal(o);
    }
    const cancelled = Object.values(state.orders).filter((o) => o.day === day && o.status === 'cancelled').length;
    return { day, orders: orders.length, cups, total, cancelled, byPay, byItem: Object.values(byItem).sort((a, b) => b.cups - a.cups), byHour };
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

  // CSV for POS reconciliation. Section 1 = one row per order (= one POS
  // transaction: the POS operator keys in only the order total). Section 2 =
  // drink lines. Section 3 = summary. No names or mobiles are ever exported.
  function reportCsv(state, day) {
    const orders = Object.values(state.orders).filter((o) => o.day === day).sort((a, b) => a.createdAt - b.createdAt);
    const rows = [['ORDERS (one row per POS transaction)', day],
      ['date', 'time_sgt', 'order_no', 'payment', 'cups', 'amount_sgd', 'status']];
    for (const o of orders) rows.push([day, sgTime(o.createdAt), fmtNo(o.no), o.pay === 'card' ? 'Card' : 'PayNow',
      orderCups(o), money(o.status === 'cancelled' ? 0 : orderTotal(o)), o.status]);
    rows.push([]);
    rows.push(['DRINK LINES']);
    rows.push(['date', 'time_sgt', 'order_no', 'item', 'temp', 'milk', 'qty', 'unit_price_sgd', 'line_total_sgd', 'status']);
    for (const o of orders) for (const it of o.items) {
      rows.push([day, sgTime(o.createdAt), fmtNo(o.no), it.name, it.temp, it.milkName || '', it.qty, money(it.price),
        money(o.status === 'cancelled' ? 0 : it.price * it.qty), o.status]);
    }
    const r = report(state, day);
    rows.push([]);
    rows.push(['SUMMARY', day]);
    rows.push(['item', 'hot', 'iced', 'alt_milk', 'cups', 'total_sgd']);
    for (const i of r.byItem) rows.push([i.name, i.hot, i.iced, i.oat, i.cups, money(i.total)]);
    rows.push(['TOTAL', '', '', '', r.cups, money(r.total)]);
    rows.push([]);
    rows.push(['payment', 'orders', 'total_sgd']);
    rows.push(['PayNow', r.byPay.paynow.orders, money(r.byPay.paynow.total)]);
    rows.push(['Card', r.byPay.card.orders, money(r.byPay.card.total)]);
    rows.push(['cancelled_orders', r.cancelled]);
    return toCsv(rows);
  }

  function daysCsv(state) {
    const days = Array.from(new Set(Object.values(state.orders).map((o) => o.day))).sort();
    const rows = [['date', 'orders', 'cups', 'total_sgd', 'paynow_sgd', 'card_sgd', 'cancelled_orders']];
    for (const d of days) { const r = report(state, d); rows.push([d, r.orders, r.cups, money(r.total), money(r.byPay.paynow.total), money(r.byPay.card.total), r.cancelled]); }
    return toCsv(rows);
  }

  // ---------------------------------------------------------------- live intelligence
  // Pace = ms per cup, measured from what the bar actually finished in the last 45 min.
  function pace(state, nowTs) {
    const day = sgDay(nowTs);
    const done = Object.values(state.orders).filter((o) => o.day === day && o.times && o.times.ready && o.times.ready > nowTs - 45 * 60000)
      .sort((a, b) => a.times.ready - b.times.ready);
    let perCup = 90000; // sensible default: 1.5 min per cup on one machine
    if (done.length >= 3) {
      const cups = done.slice(1).reduce((s, o) => s + orderCups(o), 0);
      const span = done[done.length - 1].times.ready - done[0].times.ready;
      if (span > 60000 && cups) perCup = Math.min(300000, Math.max(25000, span / cups));
    }
    return perCup;
  }
  const OPEN = (o) => o.status === 'queued' || o.status === 'making';
  // Estimated ms until this order is ready.
  function eta(state, o, nowTs) {
    if (!OPEN(o)) return 0;
    const perCup = pace(state, nowTs);
    const ahead = Object.values(state.orders).filter((x) => OPEN(x) && x.createdAt < o.createdAt);
    let ms = (ahead.reduce((s, x) => s + orderCups(x), 0) + orderCups(o)) * perCup;
    // Work already in progress on the bar is partly done.
    for (const x of ahead.concat([o])) if (x.status === 'making') ms -= Math.min(perCup * orderCups(x) * 0.8, nowTs - x.statusAt);
    return Math.max(30000, ms);
  }
  // Charity impact: every dollar goes to Singapore Red Cross Young Hearts.
  function impact(state, nowTs) {
    const day = sgDay(nowTs);
    let cups = 0, total = 0, cupsToday = 0, totalToday = 0;
    for (const o of Object.values(state.orders)) {
      if (o.status === 'cancelled') continue;
      const c = orderCups(o), t = orderTotal(o);
      cups += c; total += t;
      if (o.day === day) { cupsToday += c; totalToday += t; }
    }
    return { cups, total, cupsToday, totalToday, goal: state.settings.goal || 500000 };
  }
  const STOCK = [
    { key: 'oat', label: 'Oat milk', uses: (it) => !!(it.milkName && it.milkName !== 'Milk') },
    { key: 'milk', label: 'Fresh milk', uses: (it) => it.milkName === 'Milk' },
    { key: 'beans', label: 'Coffee beans', uses: () => true },
    { key: 'cups', label: 'Iced cups', uses: (it) => it.temp === 'iced' },
  ];
  function stockLevels(state, nowTs) {
    const stock = state.settings.stock || {};
    const all = Object.values(state.orders).filter((o) => o.status !== 'cancelled');
    return STOCK.filter((k) => stock[k.key] && stock[k.key].left != null).map((k) => {
      const s = stock[k.key];
      let used = 0, recent = 0;
      for (const o of all) {
        if (o.createdAt < s.at) continue;
        const n = o.items.reduce((a, it) => a + (k.uses(it) ? it.qty : 0), 0);
        used += n; if (o.createdAt > nowTs - 30 * 60000) recent += n;
      }
      const left = Math.max(0, s.left - used);
      const perMin = recent / 30;
      const mins = perMin > 0 ? left / perMin : null;
      return { key: k.key, label: k.label, start: s.left, left, perMin, outAt: mins == null ? null : nowTs + mins * 60000, mins };
    });
  }
  // Plain-language advice for the booth lead, most urgent first.
  function insights(state, nowTs) {
    const out = [];
    const open = Object.values(state.orders).filter(OPEN);
    const perCup = pace(state, nowTs);
    const openCups = open.reduce((s, o) => s + orderCups(o), 0);
    const waitMin = Math.round(openCups * perCup / 60000);
    const win = nowTs - 15 * 60000;
    const day = sgDay(nowTs);
    const todays = Object.values(state.orders).filter((o) => o.day === day && o.status !== 'cancelled');
    const cin = todays.filter((o) => o.createdAt > win).reduce((s, o) => s + orderCups(o), 0);
    const cout = todays.filter((o) => o.times && o.times.ready > win).reduce((s, o) => s + orderCups(o), 0);
    if (waitMin >= 12) out.push({ level: 'warn', icon: 'hourglass-high', text: 'Wait is about ' + waitMin + ' min (' + openCups + ' cups open). Put a second barista on the bar or pause big orders.' });
    else if (cin >= 4 && cin > cout * 1.4) out.push({ level: 'amber', icon: 'trend-up', text: 'Rush building: ' + cin + ' cups in vs ' + cout + ' out in the last 15 min. Wait will grow past ' + Math.max(waitMin + 3, 6) + ' min.' });
    const stale = Object.values(state.orders).filter((o) => o.status === 'ready' && nowTs - o.statusAt > 5 * 60000);
    if (stale.length) out.push({ level: 'amber', icon: 'megaphone', text: stale.length + ' drink' + (stale.length > 1 ? 's' : '') + ' waiting over 5 min at pickup: call out ' + stale.slice(0, 4).map((o) => fmtNo(o.no) + (o.name ? ' ' + o.name : '')).join(', ') + '.' });
    for (const s of stockLevels(state, nowTs)) {
      if (s.left <= 0) out.push({ level: 'warn', icon: 'warning', text: s.label + ' should be out by now (' + s.start + ' cups’ worth used). Mark it sold out or restock.' });
      else if (s.mins != null && s.mins < 120) out.push({ level: s.mins < 45 ? 'warn' : 'amber', icon: 'drop-half-bottom', text: s.label + ' runs out around ' + sgTime(s.outAt) + ' at this pace (about ' + s.left + ' cups left).' });
      else if (s.left / s.start < 0.2) out.push({ level: 'amber', icon: 'drop-half-bottom', text: s.label + ' is low: about ' + s.left + ' cups left.' });
    }
    const hour = todays.filter((o) => o.createdAt > nowTs - 60 * 60000);
    if (hour.length >= 5) {
      const by = {}; let n = 0;
      for (const o of hour) for (const it of o.items) { const k = (it.temp === 'iced' ? 'iced ' : '') + (it.milkName && it.milkName !== 'Milk' ? it.milkName.toLowerCase() + ' ' : '') + it.name.toLowerCase(); by[k] = (by[k] || 0) + it.qty; n += it.qty; }
      const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] / n >= 0.3) out.push({ level: 'info', icon: 'fire', text: 'Hot seller: ' + top[0] + ' is ' + Math.round(100 * top[1] / n) + '% of cups this hour. Pre-chill or batch accordingly.' });
    }
    if (!out.length) out.push({ level: 'ok', icon: 'check-circle', text: open.length ? 'Flowing nicely: about ' + Math.max(1, waitMin) + ' min wait, ' + (perCup / 60000).toFixed(1) + ' min per cup on the bar.' : 'All clear. Bar is idle and every drink has been collected.' });
    return out;
  }

  return { TZ, STATUSES, ROLE_OPS, sgDay, sgTime, fmtNo, money, emptyState, apply, report, reportCsv, daysCsv,
    orderTotal, orderCups, describeItems, pace, eta, impact, stockLevels, insights };
});
