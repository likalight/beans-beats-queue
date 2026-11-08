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

  return { TZ, STATUSES, ROLE_OPS, sgDay, sgTime, fmtNo, money, emptyState, apply, report, reportCsv, daysCsv,
    orderTotal, orderCups, describeItems };
});
