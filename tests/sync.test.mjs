import assert from 'node:assert/strict';
import { buildUpdates, mergeUpdates, applyPlanToData, validateUpdates, countUpdates, reportLines } from '../app/src/main/assets/www/js/sync.js';
import { distributePaid } from '../app/src/main/assets/www/js/debtlogic.js';
import { normalize } from '../app/src/main/assets/www/js/search.js';
import { packJson, unpackJson, makeFrames, FrameCollector } from '../app/src/main/assets/www/js/qrframes.js';

// ---------- محاكاة أجهزة ----------
let T = 1_000_000;
const tick = () => (T += 1000);
let U = 0;
const mk = (name) => ({ name, data: { customers: [], products: [], orders: [], debts: [], payments: [], brands: [], tombstones: [] }, ids: {}, lastSent: null });
const nid = (d, k) => (d.ids[k] = (d.ids[k] || 0) + 1);
const uid = (d) => d.name + '-' + (++U);

function addCustomer(d, name, note = null, phone = null) {
  const t = tick();
  const r = { id: nid(d, 'c'), uid: uid(d), name, nameNorm: normalize(name), phone, note, createdAt: t, updatedAt: t };
  d.data.customers.push(r); return r;
}
function addProduct(d, name, price, barcode = null, brand = null) {
  const t = tick();
  const r = { id: nid(d, 'p'), uid: uid(d), name, nameNorm: normalize(name), barcode, brand, price, createdAt: t, updatedAt: t };
  d.data.products.push(r); if (brand && !d.data.brands.some(b => b.name === brand)) d.data.brands.push({ name: brand }); return r;
}
function addOrder(d, cust, items, paidNow = 0, date = '2026-03-01') {
  const t = tick();
  const o = { id: nid(d, 'o'), uid: uid(d), customerId: cust.id, date, note: null, createdAt: t, updatedAt: t };
  d.data.orders.push(o);
  const { applied, change, pays } = distributePaid(items, paidNow);
  const debts = items.map((it, i) => {
    const total = it.unitPrice * it.qty;
    const r = { id: nid(d, 'd'), uid: uid(d), orderId: o.id, customerId: cust.id, productId: it.productId ?? null, nameSnapshot: it.name, unitPrice: it.unitPrice, qty: it.qty, date, paid: pays[i], remaining: total - pays[i], createdAt: t, updatedAt: t };
    d.data.debts.push(r); return r;
  });
  let pay = null;
  if (applied > 0) {
    pay = { id: nid(d, 'y'), uid: uid(d), customerId: cust.id, amount: applied, change, date, createdAt: t, updatedAt: t, allocations: debts.map((x, i) => ({ debtId: x.id, amount: pays[i] })).filter(a => a.amount > 0) };
    d.data.payments.push(pay);
  }
  return { order: o, debts, pay };
}
function pay(d, debt, amount, date = '2026-03-05') {
  const t = tick();
  const cur = d.data.debts.find(x => x.id === debt.id);
  cur.paid += amount; cur.remaining -= amount; cur.updatedAt = t;
  const p = { id: nid(d, 'y'), uid: uid(d), customerId: cur.customerId, amount, change: 0, date, createdAt: t, updatedAt: t, allocations: [{ debtId: cur.id, amount }] };
  d.data.payments.push(p); return p;
}
function undo(d, p) {
  const t = tick();
  for (const a of p.allocations) { const x = d.data.debts.find(y => y.id === a.debtId); x.paid -= a.amount; x.remaining += a.amount; x.updatedAt = t; }
  d.data.payments = d.data.payments.filter(y => y.id !== p.id);
  d.data.tombstones.push({ uid: p.uid, kind: 'payments', at: t });
}
function delDebt(d, debt) {
  const t = tick();
  d.data.debts = d.data.debts.filter(x => x.id !== debt.id);
  d.data.tombstones.push({ uid: debt.uid, kind: 'debts', at: t });
}
const byUidOf = (d, k) => new Map(d.data[k].map(r => [r.id, r.uid]));
function view(d) {
  const cu = byUidOf(d, 'customers'), du = byUidOf(d, 'debts');
  return {
    customers: d.data.customers.map(c => [c.uid, c.name, c.note]).sort(),
    debts: d.data.debts.map(x => [x.uid, x.nameSnapshot, x.unitPrice * x.qty, x.paid, x.remaining, cu.get(x.customerId)]).sort(),
    payments: d.data.payments.map(p => [p.uid, p.amount, cu.get(p.customerId), p.allocations.map(a => [du.get(a.debtId), a.amount]).sort()]).sort(),
    products: d.data.products.map(p => [p.uid, p.name, p.price]).sort(),
  };
}
function exchange(from, to, { since = null, scope = 'all' } = {}) {
  const t = tick();
  const packet = JSON.parse(JSON.stringify(buildUpdates(from.data, { since, scope, device: { id: from.name, name: from.name }, now: t })));
  const v = validateUpdates(packet);
  assert.ok(v.ok, v.error);
  const plan = mergeUpdates(to.data, packet, { now: t });
  to.data = applyPlanToData(to.data, plan);
  from.lastSent = t;
  return plan;
}
const sane = (d) => {   // الأرصدة متّسقة: remaining = total - paid ≥ 0، والدفعات تشير لما هو موجود
  for (const x of d.data.debts) { assert.equal(x.remaining, x.unitPrice * x.qty - x.paid, 'رصيد غير متّسق'); assert.ok(x.remaining >= 0 && x.paid >= 0); }
  const ids = new Set(d.data.debts.map(x => x.id));
  for (const p of d.data.payments) for (const a of p.allocations) assert.ok(ids.has(a.debtId), 'دفعة تشير لدين غير موجود');
  for (const k of ['customers', 'orders', 'debts', 'payments', 'products']) assert.equal(new Set(d.data[k].map(r => r.id)).size, d.data[k].length, 'معرّف مكرر في ' + k);
};

// ===== 1) نقل كامل مع تصادم الأرقام المحلية =====
{
  const A = mk('A'), B = mk('B');
  const ahmad = addCustomer(A, 'أحمد', 'ابن الجيران');
  const pen = addProduct(A, 'قلم', 800, '111', 'بيك');
  const o1 = addOrder(A, ahmad, [{ name: 'قلم', unitPrice: 800, qty: 2, productId: pen.id }, { name: 'دفتر', unitPrice: 1500, qty: 1 }], 1600);
  const salem = addCustomer(A, 'سالم');
  addOrder(A, salem, [{ name: 'مسطرة', unitPrice: 500, qty: 1 }]);
  // عند B سجلات خاصة بنفس الأرقام (1) لأشخاص مختلفين
  const other = addCustomer(B, 'نور');
  addOrder(B, other, [{ name: 'ممحاة', unitPrice: 300, qty: 1 }], 300);

  const plan = exchange(A, B);
  assert.equal(B.data.customers.length, 3);
  assert.deepEqual(plan.report.added, { customers: 2, products: 1, orders: 2, debts: 3, payments: 1 });
  sane(B);
  // كل ما عند A موجود عند B بنفس الأرصدة
  for (const row of view(A).debts) assert.ok(view(B).debts.some(r => JSON.stringify(r) === JSON.stringify(row)), 'دين مفقود');
  assert.equal(B.data.products[0].brand, 'بيك');
  assert.ok(B.data.brands.some(b => b.name === 'بيك'));
  // ربط المنتج بالدين عبر uid
  const bPen = B.data.products.find(p => p.name === 'قلم');
  assert.equal(B.data.debts.find(x => x.nameSnapshot === 'قلم').productId, bPen.id);

  // إعادة الإرسال: لا شيء جديد (لا تكرار)
  const again = exchange(A, B);
  assert.deepEqual(again.report.added, { customers: 0, products: 0, orders: 0, debts: 0, payments: 0 });
  assert.equal(B.data.debts.length, 4);
  sane(B);
}

// ===== 2) الجديد منذ آخر إرسال (دلتا) =====
{
  const A = mk('A'), B = mk('B');
  const c = addCustomer(A, 'أحمد', 'x');
  addOrder(A, c, [{ name: 'قلم', unitPrice: 800, qty: 1 }]);
  exchange(A, B);
  const since = A.lastSent;
  const o2 = addOrder(A, c, [{ name: 'كراس', unitPrice: 2000, qty: 1 }]);   // دين جديد لزبون موجود
  const pkt = buildUpdates(A.data, { since, device: { name: 'A' }, now: tick() });
  assert.deepEqual(countUpdates(pkt), { customers: 1, products: 0, orders: 1, debts: 1, payments: 0, deletions: 0 });   // الدين + أصوله فقط
  const plan = exchange(A, B, { since });
  assert.deepEqual(plan.report.added, { customers: 0, products: 0, orders: 1, debts: 1, payments: 0 });   // لا تكرار للزبون
  assert.equal(B.data.customers.length, 1);
  assert.deepEqual(view(A).debts, view(B).debts);
  // لا جديد: دلتا فارغة
  const empty = buildUpdates(A.data, { since: A.lastSent, device: {}, now: tick() });
  assert.deepEqual(countUpdates(empty), { customers: 0, products: 0, orders: 0, debts: 0, payments: 0, deletions: 0 });
  assert.deepEqual(reportLines(mergeUpdates(B.data, empty).report), ['لا جديد: كل ما في الحزمة موجود عندك.']);
}

// ===== 3) تسديدان على نفس الدين من جهازين: يجتمعان دون تنبيه =====
{
  const A = mk('A'), B = mk('B');
  const c = addCustomer(A, 'أحمد');
  const { debts: [d] } = addOrder(A, c, [{ name: 'جهاز', unitPrice: 1000, qty: 1 }]);
  exchange(A, B);
  const bDebt = B.data.debts[0];
  const sinceA = A.lastSent;
  pay(A, d, 300);        // من A
  pay(B, bDebt, 500);    // من B
  const p1 = exchange(A, B, { since: sinceA });
  const p2 = exchange(B, A, { since: null });
  assert.equal(p1.alerts.length, 0); assert.equal(p2.alerts.length, 0);
  for (const dev of [A, B]) { const x = dev.data.debts[0]; assert.deepEqual([x.paid, x.remaining], [800, 200]); assert.equal(dev.data.payments.length, 2); sane(dev); }
  assert.deepEqual(view(A), view(B));
}

// ===== 4) تسديدان تجاوزا ثمن الدين: تنبيه + تثبيت المسدَّد =====
{
  const A = mk('A'), B = mk('B');
  const c = addCustomer(A, 'أحمد', 'ابن الجيران');
  const { debts: [d] } = addOrder(A, c, [{ name: 'كتاب', unitPrice: 1000, qty: 1 }]);
  exchange(A, B);
  const bDebt = B.data.debts[0];
  pay(A, d, 700);
  pay(B, bDebt, 600);   // مجموعهما 1300 > 1000
  const toB = exchange(A, B);
  const toA = exchange(B, A);
  for (const [plan, dev] of [[toB, B], [toA, A]]) {
    assert.equal(plan.alerts.length, 1);
    assert.equal(plan.alerts[0].type, 'overpaid');
    assert.match(plan.alerts[0].text, /كتاب/); assert.match(plan.alerts[0].text, /أحمد/); assert.match(plan.alerts[0].text, /0\.300/);
    const x = dev.data.debts[0]; assert.deepEqual([x.paid, x.remaining], [1000, 0]); sane(dev);
  }
}

// ===== 5) الحذف والتراجع ينتقلان =====
{
  const A = mk('A'), B = mk('B');
  const c = addCustomer(A, 'أحمد');
  const { debts: [d1, d2], pay: p } = addOrder(A, c, [{ name: 'أ', unitPrice: 1000, qty: 1 }, { name: 'ب', unitPrice: 2000, qty: 1 }], 1000);
  exchange(A, B);
  assert.equal(B.data.payments.length, 1);
  const since = A.lastSent;
  undo(A, p);                       // تراجع عن الدفعة عند A
  delDebt(A, d2);                   // وحذف دين
  const plan = exchange(A, B, { since });
  assert.equal(plan.report.deleted.payments, 1);
  assert.equal(plan.report.deleted.debts, 1);
  assert.equal(B.data.payments.length, 0);
  assert.equal(B.data.debts.length, 1);
  const x = B.data.debts[0]; assert.deepEqual([x.paid, x.remaining], [0, 1000]);   // عاد الرصيد
  sane(B);
  assert.deepEqual(view(A).debts, view(B).debts);
  // الحزمة القديمة لا تُحيي المحذوف عند A (قبر)
  const stale = buildUpdates(B.data, { device: { name: 'B' }, now: tick() });
  assert.equal(stale.d.some(r => r.n === 'ب'), false);
  // إرسال حزمة قديمة فيها المحذوف (من جهاز لم يعلم) لا يُعيده
  const A0 = mk('A0');
  A0.data = JSON.parse(JSON.stringify(B.data));
  const old = buildUpdates({ ...B.data, debts: [...B.data.debts, { ...d2, id: 99 }], tombstones: [] }, { device: { name: 'old' }, now: tick() });
  const back = applyPlanToData(A.data, mergeUpdates(A.data, JSON.parse(JSON.stringify(old)), { now: tick() }));
  assert.equal(back.debts.some(x => x.nameSnapshot === 'ب'), false);
}

// ===== 6) آخر تعديل يفوز، والسجل المعدَّل بعد حذفه يبقى =====
{
  const A = mk('A'), B = mk('B');
  const c = addCustomer(A, 'أحمد', 'قديم');
  exchange(A, B);
  const bc = B.data.customers[0];
  tick(); c.name = 'أحمد (A)'; c.updatedAt = tick();
  bc.name = 'أحمد (B)'; bc.updatedAt = tick();              // B أحدث
  exchange(A, B);
  assert.equal(B.data.customers[0].name, 'أحمد (B)');       // الأحدث عند B لا يُطمس بالأقدم القادم
  exchange(B, A);
  assert.equal(A.data.customers[0].name, 'أحمد (B)');
  // حُذف عند A ثم عُدِّل عند B بعده: يبقى
  const t = tick();
  A.data.customers = []; A.data.tombstones.push({ uid: c.uid, kind: 'customers', at: t });
  B.data.customers[0].note = 'بعد الحذف'; B.data.customers[0].updatedAt = tick();
  exchange(A, B);
  assert.equal(B.data.customers.length, 1);
  assert.equal(B.data.tombstones.some(x => x.uid === c.uid), false);
}

// ===== 7) تنبيه تكرار الزبون المسجَّل على الجهازين =====
{
  const A = mk('A'), B = mk('B');
  addCustomer(A, 'أحمد', 'ابن الجيران', '55 123');
  addCustomer(B, 'أحمد', 'ابن الجيران', '55123');
  const plan = exchange(A, B);
  assert.equal(B.data.customers.length, 2);
  assert.equal(plan.alerts.filter(a => a.type === 'duplicate').length, 1);
  // وأحمدان بوصفين مختلفين: لا تنبيه
  const C = mk('C'), D = mk('D');
  addCustomer(C, 'أحمد', 'المخبزة'); addCustomer(D, 'أحمد', 'الجيران');
  assert.equal(exchange(C, D).alerts.length, 0);
}

// ===== 8) نطاقات الإرسال =====
{
  const A = mk('A');
  const c = addCustomer(A, 'أحمد'); addProduct(A, 'قلم', 800, '1', 'بيك');
  addOrder(A, c, [{ name: 'س', unitPrice: 100, qty: 1 }]);
  const all = buildUpdates(A.data, { scope: 'all', device: {}, now: tick() });
  const cust = buildUpdates(A.data, { scope: 'customers', device: {}, now: tick() });
  const prod = buildUpdates(A.data, { scope: 'products', device: {}, now: tick() });
  assert.deepEqual([countUpdates(all).customers, countUpdates(all).products], [1, 1]);
  assert.deepEqual([countUpdates(cust).products, cust.b.length, countUpdates(cust).debts], [0, 0, 1]);
  assert.deepEqual([countUpdates(prod).customers, countUpdates(prod).debts, prod.b], [0, 0, ['بيك']]);
  assert.throws(() => buildUpdates(A.data, { scope: 'x' }));
}

// ===== 9) فحص الحزمة =====
{
  const A = mk('A'); const c = addCustomer(A, 'أ'); addOrder(A, c, [{ name: 'س', unitPrice: 100, qty: 1 }]);
  const good = () => JSON.parse(JSON.stringify(buildUpdates(A.data, { device: {}, now: 1 })));
  assert.ok(validateUpdates(good()).ok);
  const bad = (mut, part) => { const p = good(); mut(p); const r = validateUpdates(p); assert.equal(r.ok, false, part); assert.ok(r.error.includes(part), r.error); };
  assert.equal(validateUpdates(null).ok, false);
  assert.equal(validateUpdates({ app: 'x' }).ok, false);
  bad(p => { p.app = 'x'; }, 'ليست');
  bad(p => { p.v = 9; }, 'أحدث');
  bad(p => { delete p.d; }, 'ناقصة');
  bad(p => { p.d[0].q = 0; }, 'أرقام دين');
  bad(p => { p.d[0].up = 1.5; }, 'أرقام دين');
  bad(p => { p.c[0].n = ''; }, 'زبون');
  bad(p => { p.t.push(['weird', 'x', 1]); }, 'حذف');
  bad(p => { p.y.push({ u: 'x', t: 1, c: 'y', a: 0, al: [] }); }, 'دفعة');
}

// ===== 10) عبر الإطارات (ضغط + QR) من جهاز لآخر، بترتيب مبعثر =====
{
  const A = mk('A'), B = mk('B');
  for (let i = 0; i < 120; i++) {
    const c = addCustomer(A, 'زبون ' + i, 'وصف ' + (i % 7), '55' + String(100000 + i));
    addOrder(A, c, [{ name: 'قلم حبر', unitPrice: 800, qty: 1 + (i % 3) }, { name: 'دفتر', unitPrice: 1500, qty: 1 }], i % 2 ? 1000 : 0);
  }
  const packet = buildUpdates(A.data, { device: { id: 'A', name: 'A' }, now: tick() });
  const frames = makeFrames(await packJson(packet), { chunk: 600 });
  assert.ok(frames.length > 5 && frames.length < 120, 'عدد الإطارات: ' + frames.length);
  const col = new FrameCollector();
  for (const f of [...frames].sort(() => Math.random() - 0.5)) col.add(f);
  assert.ok(col.complete());
  const got = await unpackJson(col.assemble());
  assert.ok(validateUpdates(got).ok);
  B.data = applyPlanToData(B.data, mergeUpdates(B.data, got, { now: tick() }));
  assert.deepEqual(view(A), view(B));
  sane(B);
  console.log('   مثال: 120 زبونًا و360 بندًا ← ' + frames.length + ' رمزًا (600 رمز/إطار)');
}

console.log('sync tests OK');
