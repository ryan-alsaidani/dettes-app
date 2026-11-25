import assert from 'node:assert/strict';
import { allocatePayment } from '../app/src/main/assets/www/js/allocation.js';

const m = (d) => Math.round(d * 1000); // دينار → مليم
const mk = (list) => list.map(([id, d, date]) => ({ id, remaining: m(d), date: date || '2026-01-' + String(id).padStart(2, '0') }));
const ids = (opt) => opt.items.map(i => i.debtId);
const sumPay = (opt) => opt.items.reduce((s, i) => s + i.pay, 0);

// مثال 1: 1 و3 و1 و2 والمبلغ 5 ⇒ {3+2} ثم {1+1+3}
{
  const r = allocatePayment(mk([[1, 1], [2, 3], [3, 1], [4, 2]]), m(5));
  assert.equal(r.change, 0);
  assert.equal(r.options.length, 2);
  assert.deepEqual(ids(r.options[0]), [2, 4]);
  assert.deepEqual(ids(r.options[1]), [1, 2, 3]);
  assert.ok(r.options.every(o => o.items.every(i => i.full) && sumPay(o) === m(5) && o.total === m(5)));
}

// مثال 2: 3 و4 والمبلغ 5 (لا تركيبة مطابقة).
// الخطة الأولى بقاعدة «أكبر مجموع»: 4 كاملًا + 1 جزئيًا على الـ3. والثانية (مثال الملف): 3 كاملًا + 2 جزئيًا على الـ4.
{
  const r = allocatePayment(mk([[1, 3], [2, 4]]), m(5));
  assert.equal(r.options.length, 2);
  assert.deepEqual(r.options[0].items, [{ debtId: 2, pay: m(4), full: true }, { debtId: 1, pay: m(1), full: false }]);
  assert.deepEqual(r.options[1].items, [{ debtId: 1, pay: m(3), full: true }, { debtId: 2, pay: m(2), full: false }]);
  assert.ok(r.options.every(o => sumPay(o) === m(5)));
}

// المبلغ أكبر من المجموع أو مساوٍ له
{
  const r = allocatePayment(mk([[1, 2], [2, 3]]), m(8));
  assert.equal(r.change, m(3));
  assert.equal(r.options.length, 1);
  assert.deepEqual(r.options[0].items.map(i => [i.debtId, i.pay, i.full]), [[1, m(2), true], [2, m(3), true]]);
  assert.equal(r.options[0].total, m(5));
  const eq = allocatePayment(mk([[1, 2], [2, 3]]), m(5));
  assert.equal(eq.change, 0);
  assert.equal(eq.options[0].items.length, 2);
}

// حالات حدّية
assert.deepEqual(allocatePayment(mk([[1, 2]]), 0), { options: [], change: 0 });
assert.deepEqual(allocatePayment(mk([[1, 2]]), -5), { options: [], change: 0 });
assert.deepEqual(allocatePayment([], m(5)), { options: [], change: 0 });
assert.deepEqual(allocatePayment(mk([[1, 2]]), 1.5), { options: [], change: 0 });
{
  const one = mk([[1, 4]]);
  assert.deepEqual(allocatePayment(one, m(4)).options[0].items, [{ debtId: 1, pay: m(4), full: true }]);
  assert.deepEqual(allocatePayment(one, m(1.5)).options[0].items, [{ debtId: 1, pay: m(1.5), full: false }]);
  assert.equal(allocatePayment(one, m(9)).change, m(5));
  // المسدَّدة تُهمَل
  assert.deepEqual(allocatePayment([{ id: 1, remaining: 0, date: '2026-01-01' }], m(3)), { options: [], change: 0 });
}

// كل الديون أكبر من المبلغ: دفعة جزئية على الأقل متبقيًا (الأقدم عند التساوي)
{
  const r = allocatePayment(mk([[1, 10], [2, 12], [3, 10]]), m(5));
  assert.equal(r.options.length, 1);
  assert.deepEqual(r.options[0].items, [{ debtId: 1, pay: m(5), full: false }]);
}

// تعادل: ثلاثة ديون متساوية (2) والمبلغ 3 ⇒ الأقدم كاملًا والجزئي على التالي
{
  const r = allocatePayment(mk([[1, 2], [2, 2], [3, 2]]), m(3));
  assert.deepEqual(r.options[0].items, [{ debtId: 1, pay: m(2), full: true }, { debtId: 2, pay: m(1), full: false }]);
}

// المدخلات لا تُعدَّل، والترتيب بالتاريخ لا بترتيب المصفوفة
{
  const input = [
    { id: 7, remaining: m(2), date: '2026-05-01' },
    { id: 8, remaining: m(2), date: '2026-01-01' },
    { id: 9, remaining: m(5), date: '2026-03-01' },
  ];
  const copy = JSON.parse(JSON.stringify(input));
  const r = allocatePayment(input, m(2));
  assert.deepEqual(input, copy);
  assert.deepEqual(ids(r.options[0]), [8]);   // الأقدم أولًا بين المتساويين
  assert.deepEqual(ids(r.options[1]), [7]);
}

// مقارنة عشوائية مع القوة الغاشمة (n ≤ 10)
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let iter = 0; iter < 400; iter++) {
  const n = 1 + Math.floor(rnd() * 9);
  const debts = [];
  for (let i = 1; i <= n; i++) debts.push({ id: i, remaining: (1 + Math.floor(rnd() * 12)) * 250, date: '2026-01-' + String(1 + Math.floor(rnd() * 5)).padStart(2, '0') });
  const sorted = debts.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const total = sorted.reduce((s, d) => s + d.remaining, 0);
  const amount = (1 + Math.floor(rnd() * (total / 250 + 2))) * 250;
  const res = allocatePayment(debts, amount);

  if (amount >= total) {
    assert.equal(res.change, amount - total);
    assert.equal(res.options[0].items.length, n);
    continue;
  }
  assert.equal(res.change, 0);

  // كل التراكيب المطابقة، مرتبة (الأقل بنودًا ثم الأقدم معجميًا)
  const exact = [];
  let bestInexact = -1;
  for (let mask = 1; mask < (1 << n); mask++) {
    const idx = []; let s = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { idx.push(i); s += sorted[i].remaining; }
    if (s === amount) exact.push(idx);
    else if (s < amount) bestInexact = Math.max(bestInexact, s);
  }
  exact.sort((a, b) => a.length - b.length || (() => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; })());
  if (exact.length) {
    const want = exact.slice(0, 5).map(idx => idx.map(i => sorted[i].id));
    assert.deepEqual(res.options.map(ids), want, JSON.stringify({ debts, amount }));
    assert.ok(res.options.every(o => o.items.every(i => i.full) && sumPay(o) === amount));
  } else {
    // أفضل خطة: مجموع البنود الكاملة = أكبر مجموع ممكن دون المبلغ
    const best = res.options[0];
    const fullSum = best.items.filter(i => i.full).reduce((s, i) => s + i.pay, 0);
    assert.equal(fullSum, Math.max(bestInexact, 0), JSON.stringify({ debts, amount }));
    for (const o of res.options) {
      assert.equal(sumPay(o), amount);
      const partial = o.items.filter(i => !i.full);
      assert.equal(partial.length, 1);
      const d = debts.find(x => x.id === partial[0].debtId);
      assert.ok(partial[0].pay > 0 && partial[0].pay < d.remaining);
      for (const it of o.items) assert.ok(it.pay <= debts.find(x => x.id === it.debtId).remaining);
      assert.equal(new Set(o.items.map(i => i.debtId)).size, o.items.length);
    }
  }
}

// الأداء: 200 دين وعشرات البنود
{
  const debts = [];
  for (let i = 1; i <= 200; i++) debts.push({ id: i, remaining: (1 + ((i * 37) % 40)) * 500, date: '2026-0' + (1 + (i % 9)) + '-' + String(1 + (i % 28)).padStart(2, '0') });
  const t0 = Date.now();
  for (const amount of [5000, 12500, 33000, 77777, 150000, 1000000]) {
    const r = allocatePayment(debts, amount);
    assert.ok(r.options.length >= 1 && r.options.length <= 5);
    for (const o of r.options) assert.equal(sumPay(o), Math.min(amount, debts.reduce((s, d) => s + d.remaining, 0)));
  }
  const dt = Date.now() - t0;
  console.log('200 debts × 6 amounts:', dt, 'ms');
  assert.ok(dt < 3000, 'بطيء: ' + dt);
}

// مبلغ كبير بقاسم مشترك صغير (يتجاوز جدول الإمكانية): الاحتياط الأقدم أولًا يبقى صحيحًا
{
  const debts = [];
  for (let i = 1; i <= 120; i++) debts.push({ id: i, remaining: 1000001 + i, date: '2026-01-01' });
  const amount = 50000123;
  const r = allocatePayment(debts, amount);
  assert.ok(r.options.length >= 1);
  assert.equal(sumPay(r.options[0]), amount);
}

console.log('allocation tests OK');
