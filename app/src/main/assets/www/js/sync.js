// تبادل التحديثات بين جهازين (نقي: بلا قاعدة بيانات ولا واجهة).
//
// الحزمة تحمل سجلات بمعرّفات فريدة (uid) وتواريخ تعديل (t). الأرقام المحلية (id) لا تنتقل أبدًا.
//   c زبائن | p منتجات | o فواتير | d ديون | y دفعات | b أسماء العلامات | t قبور الحذف [النوع، uid، وقت]
//
// قواعد الدمج على المستلِم:
//  • سجل جديد (uid غير موجود) يُضاف. سجل موجود يُحدَّث فقط إن كان القادم أحدث (آخر تعديل يفوز).
//  • أرصدة الدين (المدفوع/المتبقي) لا تؤخذ من الدين القادم إن كان موجودًا عندك، بل تُجمع عليها الدفعات الجديدة
//    القادمة؛ فتسديدان سُجّلا من جهازين على نفس الدين يجتمعان بدل أن يطمس أحدهما الآخر.
//  • إن زادت الدفعات عن ثمن الدين: يُثبَّت الدين مسدَّدًا ويُولَّد «تنبيه» (قد تكون أخذتَ المبلغ مرتين).
//  • الحذف ينتقل بقبور؛ والسجل المعدَّل بعد حذفه في مكان آخر يبقى.
import { normalize } from './search.js';
import { ensureUid } from './uid.js';
import { customerKey } from './keys.js';
import { formatMillimes } from './money.js';
import { formatDate } from './dates.js';

export const UPDATE_APP = 'dettes-updates';
export const UPDATE_VERSION = 1;
export const KINDS = ['customers', 'products', 'orders', 'debts', 'payments'];
export const UPDATE_SCOPES = {
  all: KINDS,
  customers: ['customers', 'orders', 'debts', 'payments'],
  products: ['products'],
};

const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

// ====================================================================== بناء الحزمة

/** local: {customers, products, orders, debts, payments, brands, tombstones} (كل ما في الجهاز). */
export function buildUpdates(local, { since = null, scope = 'all', device = {}, now = Date.now() } = {}) {
  const kinds = UPDATE_SCOPES[scope];
  if (!kinds) throw new Error('نطاق غير معروف');

  const data = {};
  const byId = {};
  for (const k of KINDS) {
    data[k] = (local[k] || []).map(r => ({ ...r, uid: ensureUid(k, r), updatedAt: r.updatedAt ?? r.createdAt ?? 0 }));
    byId[k] = new Map(data[k].map(r => [r.id, r]));
  }
  const pick = {};
  for (const k of KINDS) pick[k] = new Map();
  const changed = (r) => since == null || r.updatedAt > since;
  for (const k of kinds) for (const r of data[k]) if (changed(r)) pick[k].set(r.uid, r);

  // أصول السجلات المختارة تُضمَّن دائمًا (ليتمكن المستلِم من إنشائها إن لم تكن عنده)
  for (const p of [...pick.payments.values()]) {
    for (const a of p.allocations || []) { const d = byId.debts.get(a.debtId); if (d) pick.debts.set(d.uid, d); }
  }
  for (const d of [...pick.debts.values()]) {
    const o = byId.orders.get(d.orderId); if (o) pick.orders.set(o.uid, o);
    const c = byId.customers.get(d.customerId); if (c) pick.customers.set(c.uid, c);
  }
  for (const o of [...pick.orders.values()]) { const c = byId.customers.get(o.customerId); if (c) pick.customers.set(c.uid, c); }
  for (const p of [...pick.payments.values()]) { const c = byId.customers.get(p.customerId); if (c) pick.customers.set(c.uid, c); }

  const uidOf = (k, id) => { const r = byId[k].get(id); return r ? r.uid : null; };
  const out = {
    app: UPDATE_APP, v: UPDATE_VERSION,
    dev: { id: device.id || '', name: device.name || '' },
    at: now, since, scope,
    c: [...pick.customers.values()].map(r => ({ u: r.uid, t: r.updatedAt, k: r.createdAt || r.updatedAt, n: r.name, p: r.phone || null, o: r.note || null })),
    p: [...pick.products.values()].map(r => ({ u: r.uid, t: r.updatedAt, k: r.createdAt || r.updatedAt, n: r.name, b: r.barcode || null, br: r.brand || null, pr: r.price, w: r.weight || null, d: r.description || null })),
    o: [...pick.orders.values()].map(r => ({ u: r.uid, t: r.updatedAt, k: r.createdAt || r.updatedAt, c: uidOf('customers', r.customerId), d: r.date, o: r.note || null })),
    d: [...pick.debts.values()].map(r => ({
      u: r.uid, t: r.updatedAt, k: r.createdAt || r.updatedAt,
      o: uidOf('orders', r.orderId), c: uidOf('customers', r.customerId), p: r.productId != null ? uidOf('products', r.productId) : null,
      n: r.nameSnapshot, up: r.unitPrice, q: r.qty, d: r.date, pd: r.paid, r: r.remaining,
    })),
    y: [...pick.payments.values()].map(r => ({
      u: r.uid, t: r.updatedAt, k: r.createdAt || r.updatedAt, c: uidOf('customers', r.customerId),
      a: r.amount, ch: r.change || 0, d: r.date,
      al: (r.allocations || []).map(a => [uidOf('debts', a.debtId), a.amount]).filter(a => a[0]),
    })),
    b: kinds.includes('products') ? (local.brands || []).map(b => b.name) : [],
    t: (local.tombstones || []).filter(t => kinds.includes(t.kind) && (since == null || t.at > since)).map(t => [t.kind, t.uid, t.at]),
  };
  return out;
}

export function countUpdates(p) {
  return { customers: p.c.length, products: p.p.length, orders: p.o.length, debts: p.d.length, payments: p.y.length, deletions: p.t.length };
}

export function validateUpdates(p) {
  const fail = (error) => ({ ok: false, error });
  if (!p || typeof p !== 'object' || p.app !== UPDATE_APP) return fail('هذه ليست حزمة تحديثات من «دفتر الديون».');
  if (!isInt(p.v) || p.v < 1) return fail('رقم إصدار الحزمة غير صالح.');
  if (p.v > UPDATE_VERSION) return fail('الحزمة من إصدار أحدث من التطبيق. حدّث التطبيق أولًا.');
  for (const k of ['c', 'p', 'o', 'd', 'y', 'b', 't']) if (!Array.isArray(p[k])) return fail('الحزمة ناقصة.');
  const base = (r) => r && isStr(r.u) && Number.isFinite(r.t);
  for (const r of p.c) if (!base(r) || !isStr(r.n)) return fail('زبون غير صالح في الحزمة.');
  for (const r of p.p) if (!base(r) || !isStr(r.n) || !isInt(r.pr) || r.pr < 0) return fail('منتج غير صالح في الحزمة.');
  for (const r of p.o) if (!base(r) || !isStr(r.c) || !isStr(r.d)) return fail('فاتورة غير صالحة في الحزمة.');
  for (const r of p.d) {
    if (!base(r) || !isStr(r.o) || !isStr(r.c) || !isStr(r.n) || !isStr(r.d)) return fail('دين غير صالح في الحزمة.');
    if (!isInt(r.up) || r.up < 0 || !isInt(r.q) || r.q < 1 || !isInt(r.pd) || r.pd < 0 || !isInt(r.r) || r.r < 0) return fail('أرقام دين غير صالحة في الحزمة.');
  }
  for (const r of p.y) {
    if (!base(r) || !isStr(r.c) || !isInt(r.a) || r.a <= 0 || !Array.isArray(r.al)) return fail('دفعة غير صالحة في الحزمة.');
    for (const a of r.al) if (!Array.isArray(a) || !isStr(a[0]) || !isInt(a[1]) || a[1] <= 0) return fail('تخصيص دفعة غير صالح.');
  }
  for (const n of p.b) if (typeof n !== 'string') return fail('علامة غير صالحة.');
  for (const t of p.t) if (!Array.isArray(t) || !KINDS.includes(t[0]) || !isStr(t[1]) || !Number.isFinite(t[2])) return fail('سجل حذف غير صالح.');
  return { ok: true, counts: countUpdates(p) };
}

// ====================================================================== الدمج

export function mergeUpdates(local, packet, { now = Date.now() } = {}) {
  const devName = (packet.dev && packet.dev.name) || 'جهاز آخر';
  const cur = {};
  const puts = {};
  const dels = {};
  for (const k of KINDS) {
    const byUid = new Map();
    const byId = new Map();
    let max = 0;
    for (const r0 of local[k] || []) {
      const r = { ...r0, uid: ensureUid(k, r0), updatedAt: r0.updatedAt ?? r0.createdAt ?? 0 };
      byUid.set(r.uid, r); byId.set(r.id, r); max = Math.max(max, r.id || 0);
    }
    cur[k] = { byUid, byId, max };
    puts[k] = new Map();
    dels[k] = new Set();
  }
  const report = { added: {}, updated: {}, deleted: {}, brands: 0, orphans: 0, unchanged: 0 };
  for (const k of KINDS) { report.added[k] = 0; report.updated[k] = 0; report.deleted[k] = 0; }
  const alerts = [];

  const touch = (k, rec) => { cur[k].byUid.set(rec.uid, rec); cur[k].byId.set(rec.id, rec); puts[k].set(rec.id, rec); };
  const remove = (k, rec) => { cur[k].byUid.delete(rec.uid); cur[k].byId.delete(rec.id); puts[k].delete(rec.id); dels[k].add(rec.id); };
  const addNew = (k, fields) => { const rec = { id: ++cur[k].max, ...fields }; touch(k, rec); report.added[k]++; return rec; };

  const tombs = new Map((local.tombstones || []).map(t => [t.uid, t]));
  const tombPuts = new Map();
  const tombDels = new Set();
  // سجل ميت (محذوف بتاريخ أحدث أو مساوٍ) لا يعود. وإن عُدِّل بعد حذفه يُبعث من جديد.
  const dead = (uid, t) => {
    const tomb = tombs.get(uid);
    if (!tomb) return false;
    if (tomb.at >= t) return true;
    tombs.delete(uid); tombPuts.delete(uid); tombDels.add(uid);
    return false;
  };

  const revertPayment = (p) => {
    for (const a of p.allocations || []) {
      const d = cur.debts.byId.get(a.debtId);
      if (!d) continue;
      const paid = Math.max(0, d.paid - a.amount);
      touch('debts', { ...d, paid, remaining: d.unitPrice * d.qty - paid, updatedAt: now });
    }
  };

  // ---------- 1) الحذف ----------
  for (const [kind, uid, at] of packet.t) {
    const prev = tombs.get(uid);
    if (!prev || prev.at < at) { const t = { uid, kind, at }; tombs.set(uid, t); tombPuts.set(uid, t); tombDels.delete(uid); }
    const rec = cur[kind].byUid.get(uid);
    if (rec && rec.updatedAt <= at) {
      if (kind === 'payments') revertPayment(rec);
      remove(kind, rec);
      report.deleted[kind]++;
    } else if (rec) {
      tombs.delete(uid); tombPuts.delete(uid); tombDels.add(uid); // عُدِّل هنا بعد الحذف: يبقى
    }
  }

  // ---------- 2) الزبائن ----------
  const addedCustomers = [];
  for (const c of packet.c) {
    if (dead(c.u, c.t)) { report.unchanged++; continue; }
    const ex = cur.customers.byUid.get(c.u);
    if (!ex) {
      addedCustomers.push(addNew('customers', { uid: c.u, name: c.n, nameNorm: normalize(c.n), phone: c.p || null, note: c.o || null, createdAt: c.k || c.t, updatedAt: c.t }));
    } else if (c.t > ex.updatedAt) {
      touch('customers', { ...ex, name: c.n, nameNorm: normalize(c.n), phone: c.p || null, note: c.o || null, updatedAt: c.t });
      report.updated.customers++;
    } else report.unchanged++;
  }
  if (addedCustomers.length) {
    const byKey = new Map();
    for (const c of cur.customers.byUid.values()) { const k = customerKey(c); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(c); }
    const said = new Set();
    for (const c of addedCustomers) {
      const k = customerKey(c);
      if (byKey.get(k).length > 1 && !said.has(k)) {
        said.add(k);
        alerts.push({ type: 'duplicate', text: 'يوجد الآن زبونان بنفس الاسم والهاتف والوصف: «' + c.name + '». غالبًا هو زبون واحد سُجّل على الجهازين. راجعهما وانقل ديون أحدهما يدويًا ثم احذفه، أو غيّر وصف أحدهما.' });
      }
    }
  }

  // ---------- 3) المنتجات والعلامات ----------
  for (const p of packet.p) {
    if (dead(p.u, p.t)) { report.unchanged++; continue; }
    const ex = cur.products.byUid.get(p.u);
    const fields = { name: p.n, nameNorm: normalize(p.n), barcode: p.b || null, brand: p.br || null, brandNorm: p.br ? normalize(p.br) : '', price: p.pr, weight: p.w || null, description: p.d || null };
    if (!ex) {
      const rec = addNew('products', { uid: p.u, ...fields, createdAt: p.k || p.t, updatedAt: p.t });
      if (rec.barcode) {
        const twin = [...cur.products.byUid.values()].find(x => x.uid !== rec.uid && x.barcode === rec.barcode);
        if (twin) alerts.push({ type: 'duplicate', text: 'الباركود ' + rec.barcode + ' مسجَّل لمنتجين: «' + twin.name + '» و«' + rec.name + '». راجعهما واحذف المكرر.' });
      }
    } else if (p.t > ex.updatedAt) {
      touch('products', { ...ex, ...fields, updatedAt: p.t });
      report.updated.products++;
    } else report.unchanged++;
  }
  const haveBrands = new Set((local.brands || []).map(b => normalize(b.name)));
  const brandsAdd = [];
  const wantBrands = [...packet.b, ...[...puts.products.values()].map(p => p.brand).filter(Boolean)];
  for (const name of wantBrands) {
    const n = normalize(name);
    if (n && !haveBrands.has(n)) { haveBrands.add(n); brandsAdd.push({ name }); }
  }
  report.brands = brandsAdd.length;

  // ---------- 4) الفواتير ----------
  for (const o of packet.o) {
    if (dead(o.u, o.t)) { report.unchanged++; continue; }
    const cust = cur.customers.byUid.get(o.c);
    if (!cust) { report.orphans++; continue; }
    const ex = cur.orders.byUid.get(o.u);
    if (!ex) addNew('orders', { uid: o.u, customerId: cust.id, date: o.d, note: o.o || null, createdAt: o.k || o.t, updatedAt: o.t });
    else if (o.t > ex.updatedAt) { touch('orders', { ...ex, date: o.d, note: o.o || null, updatedAt: o.t }); report.updated.orders++; }
    else report.unchanged++;
  }

  // ---------- 5) الديون (الحقول فقط؛ الأرصدة للدفعات) ----------
  const newDebtUids = new Set();
  for (const d of packet.d) {
    if (dead(d.u, d.t)) { report.unchanged++; continue; }
    const order = cur.orders.byUid.get(d.o);
    const cust = cur.customers.byUid.get(d.c);
    if (!order || !cust) { report.orphans++; continue; }
    const ex = cur.debts.byUid.get(d.u);
    if (!ex) {
      const total = d.up * d.q;
      const paid = Math.min(d.pd, total);
      const prod = d.p ? cur.products.byUid.get(d.p) : null;
      addNew('debts', {
        uid: d.u, orderId: order.id, customerId: cust.id, productId: prod ? prod.id : null,
        nameSnapshot: d.n, unitPrice: d.up, qty: d.q, date: d.d, paid, remaining: total - paid,
        createdAt: d.k || d.t, updatedAt: d.t,
      });
      newDebtUids.add(d.u);
    } else if (d.t > ex.updatedAt) {
      const total = d.up * d.q;
      let paid = ex.paid;
      if (total < paid) {
        alerts.push({ type: 'edit', text: 'تعديل وصل من «' + devName + '» جعل ثمن «' + ex.nameSnapshot + '» (' + formatMillimes(total) + ') أقل مما دُفع فعلًا (' + formatMillimes(paid) + '). راجع حساب الزبون.' });
        paid = total;
      }
      touch('debts', { ...ex, nameSnapshot: d.n, unitPrice: d.up, qty: d.q, date: d.d, paid, remaining: total - paid, updatedAt: d.t });
      report.updated.debts++;
    } else report.unchanged++;
  }

  // ---------- 6) الدفعات (تُجمع على أرصدة الديون الموجودة) ----------
  for (const y of packet.y) {
    if (dead(y.u, y.t)) { report.unchanged++; continue; }
    if (cur.payments.byUid.has(y.u)) { report.unchanged++; continue; }
    const cust = cur.customers.byUid.get(y.c);
    if (!cust) { report.orphans++; continue; }
    const allocations = [];
    for (const [debtUid, amount] of y.al) {
      const debt = cur.debts.byUid.get(debtUid);
      if (!debt) { report.orphans++; continue; }
      allocations.push({ debtId: debt.id, amount });
      if (newDebtUids.has(debtUid)) continue; // رصيده القادم يشمل هذه الدفعة أصلًا
      const total = debt.unitPrice * debt.qty;
      let paid = debt.paid + amount;
      if (paid > total) {
        alerts.push({
          type: 'overpaid',
          text: 'دين «' + debt.nameSnapshot + '» للزبون «' + cust.name + '» دُفع منه أكثر من ثمنه بمقدار ' + formatMillimes(paid - total)
            + '. وصلت دفعة بتاريخ ' + formatDate(y.d) + ' (' + formatMillimes(amount) + ') من «' + devName + '» بينما سُدِّد الدين أيضًا من هنا. قد تكون أخذتَ المبلغ مرتين: أعد الفرق للزبون.',
        });
        paid = total;
      }
      touch('debts', { ...debt, paid, remaining: total - paid, updatedAt: now });
    }
    addNew('payments', { uid: y.u, customerId: cust.id, amount: y.a, change: y.ch || 0, date: y.d, createdAt: y.k || y.t, updatedAt: y.t, allocations });
  }

  if (report.orphans) {
    alerts.push({ type: 'orphans', text: 'تعذّر ربط ' + report.orphans + ' سجل بسبب نقص بيانات عندك (زبون أو فاتورة أو دين غير موجود). اطلب من الجهاز الآخر إرسال «كل البيانات».' });
  }

  const plan = { puts: {}, dels: {}, tombPuts: [...tombPuts.values()], tombDels: [...tombDels], brandsAdd, report, alerts };
  for (const k of KINDS) { plan.puts[k] = [...puts[k].values()]; plan.dels[k] = [...dels[k]]; }
  return plan;
}

/** يطبّق الخطة على نسخة من البيانات (للاختبار وللمعاينة). تطبيق IndexedDB الفعلي في syncio.js. */
export function applyPlanToData(local, plan) {
  const out = {};
  for (const k of KINDS) {
    const m = new Map((local[k] || []).map(r => [r.id, r]));
    for (const id of plan.dels[k] || []) m.delete(id);
    for (const r of plan.puts[k] || []) m.set(r.id, r);
    out[k] = [...m.values()];
  }
  const bs = new Map((local.brands || []).map(b => [b.name, b]));
  for (const b of plan.brandsAdd || []) bs.set(b.name, b);
  out.brands = [...bs.values()];
  const ts = new Map((local.tombstones || []).map(t => [t.uid, t]));
  for (const u of plan.tombDels || []) ts.delete(u);
  for (const t of plan.tombPuts || []) ts.set(t.uid, t);
  out.tombstones = [...ts.values()];
  return out;
}

const KIND_LABEL = { customers: 'زبون', products: 'منتج', orders: 'فاتورة', debts: 'دين', payments: 'دفعة' };

/** أسطر عربية تلخّص نتيجة الدمج. */
export function reportLines(report) {
  const line = (label, obj) => {
    const parts = Object.entries(obj).filter(([, n]) => n > 0).map(([k, n]) => n + ' ' + KIND_LABEL[k]);
    return parts.length ? label + ': ' + parts.join('، ') : null;
  };
  const lines = [line('أُضيف', report.added), line('حُدِّث', report.updated), line('حُذف', report.deleted)].filter(Boolean);
  if (report.brands) lines.push('علامات جديدة: ' + report.brands);
  if (!lines.length) lines.push('لا جديد: كل ما في الحزمة موجود عندك.');
  return lines;
}
