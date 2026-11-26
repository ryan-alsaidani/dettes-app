import assert from 'node:assert/strict';
import { statusOf, summarize, filterByStatus, sortDebts, groupByOrder, debtHaystack, distributePaid } from '../app/src/main/assets/www/js/debtlogic.js';
import { todayISO, formatDate } from '../app/src/main/assets/www/js/dates.js';
import { productHaystack } from '../app/src/main/assets/www/js/products.js';
import { normalize, matches } from '../app/src/main/assets/www/js/search.js';

const D = (id, orderId, date, unitPrice, qty, paid = 0, name = 'بند' + id) =>
  ({ id, orderId, date, unitPrice, qty, paid, remaining: unitPrice * qty - paid, nameSnapshot: name });

// الحالة
assert.equal(statusOf(D(1, 1, '2026-01-01', 1000, 1)), 'unpaid');
assert.equal(statusOf(D(1, 1, '2026-01-01', 1000, 1, 400)), 'partial');
assert.equal(statusOf(D(1, 1, '2026-01-01', 1000, 1, 1000)), 'paid');

const debts = [
  D(1, 10, '2026-03-01', 1500, 2, 0, 'قلم حبر'),       // 3000 غير مسدد
  D(2, 10, '2026-03-01', 500, 1, 500, 'ممحاة'),         // 500 مسدد
  D(3, 11, '2026-01-15', 4000, 1, 1000, 'دفتر كبير'),   // 4000 جزئي (بقي 3000)
  D(4, 12, '2026-02-10', 250, 4, 0, 'مسطرة'),           // 1000 غير مسدد
];
const orders = new Map([
  [10, { id: 10, date: '2026-03-01', note: 'الدخول المدرسي' }],
  [11, { id: 11, date: '2026-01-15', note: null }],
  [12, { id: 12, date: '2026-02-10', note: null }],
]);

// الملخص
assert.deepEqual(summarize(debts), { total: 8500, paid: 1500, remaining: 7000, open: 3 });
assert.deepEqual(summarize([]), { total: 0, paid: 0, remaining: 0, open: 0 });

// الفلاتر
assert.deepEqual(filterByStatus(debts, 'unpaid').map(d => d.id), [1, 3, 4]);
assert.deepEqual(filterByStatus(debts, 'paid').map(d => d.id), [2]);
assert.equal(filterByStatus(debts, 'all').length, 4);

// الترتيب (التعادل بالتاريخ ثم المعرّف: الأحدث أولًا)
assert.deepEqual(sortDebts(debts, 'newest').map(d => d.id), [2, 1, 4, 3]);
assert.deepEqual(sortDebts(debts, 'oldest').map(d => d.id), [3, 4, 1, 2]);
assert.deepEqual(sortDebts(debts, 'highest').map(d => d.id), [3, 1, 4, 2]);
const before = debts.map(d => d.id);
sortDebts(debts, 'oldest');
assert.deepEqual(debts.map(d => d.id), before); // لا يعدّل المصفوفة الأصلية

// التجميع
const gNew = groupByOrder(debts, orders, 'newest');
assert.deepEqual(gNew.map(x => x.order.id), [10, 12, 11]);
assert.equal(gNew[0].total, 3500);
assert.equal(gNew[0].remaining, 3000);
assert.deepEqual(gNew[0].items.map(d => d.id), [1, 2]);
assert.deepEqual(groupByOrder(debts, orders, 'oldest').map(x => x.order.id), [11, 12, 10]);
assert.deepEqual(groupByOrder(debts, orders, 'highest').map(x => x.order.id), [11, 10, 12]);
// «الأعلى ثمنًا» داخل العرض المجمَّع: الفاتورة تُرتَّب بأغلى بند فيها لا بمجموعها، والبنود داخلها بالأغلى أولًا
{
  const ds = [
    D(21, 20, '2026-04-01', 1000, 1, 0, 'أ'), D(22, 20, '2026-04-01', 1000, 1, 0, 'ب'), D(23, 20, '2026-04-01', 1000, 1, 0, 'ج'), // مجموع 3000، أغلى بند 1000
    D(24, 21, '2026-04-02', 2500, 1, 0, 'د'),                                                                                   // مجموع 2500، أغلى بند 2500
    D(25, 20, '2026-04-01', 1800, 1, 0, 'هـ'),                                                                                  // يرفع الفاتورة 20: مجموع 4800، أغلى بند 1800
  ];
  const os = new Map([[20, { id: 20, date: '2026-04-01', note: null }], [21, { id: 21, date: '2026-04-02', note: null }]]);
  const g = groupByOrder(ds, os, 'highest');
  assert.deepEqual(g.map(x => x.order.id), [21, 20]);               // 2500 > 1800 رغم أن مجموع 20 أكبر
  assert.deepEqual(g[1].items.map(d => d.id), [25, 21, 22, 23]);    // بنود الفاتورة 20 بالأغلى أولًا
  assert.deepEqual(sortDebts(ds, 'highest').map(d => d.id), [24, 25, 23, 22, 21]); // التعادل: الأحدث أولًا
}
// فاتورة غير موجودة في الخريطة لا تكسر التجميع
assert.equal(groupByOrder([D(9, 99, '2026-05-05', 100, 1)], new Map(), 'newest')[0].order.date, '2026-05-05');

// البحث داخل الديون: بند، ملاحظة الفاتورة، تاريخ، مبلغ، كمية
const hay = (d) => debtHaystack(d, orders.get(d.orderId));
assert.ok(matches('قلم', hay(debts[0])));
assert.ok(matches('المدرسي', hay(debts[0])));          // ملاحظة الفاتورة
assert.ok(matches('01/03/2026', hay(debts[0])));        // تاريخ معروض
assert.ok(matches('2026-03', hay(debts[0])));
assert.ok(matches('3', hay(debts[0])));                 // الإجمالي 3
assert.ok(matches('1.5', hay(debts[0])));               // سعر الوحدة
assert.ok(!matches('مسطرة', hay(debts[0])));

// بحث المنتج الموسّع
const prod = { name: 'قلم حبر', brand: 'بيك', barcode: '6191234567890', weight: '12 غ', description: 'أزرق ناعم للمدرسة', price: 800 };
const ph = productHaystack(prod);
for (const q of ['قلم', 'بيك', '6191234', 'ازرق', 'للمدرسه', '12', '0.8', 'ناعم مدرسه']) assert.ok(matches(q, ph), q);
assert.ok(!matches('احمر', ph));

// أرقام عربية في البحث
assert.equal(normalize('٠٦١٩١'), '06191');
assert.ok(matches('٦١٩١٢٣', ph));

// التواريخ
assert.equal(todayISO(new Date(2026, 10, 5)), '2026-11-05');
assert.equal(formatDate('2026-11-05'), '05/11/2026');
assert.equal(formatDate(''), '');
assert.equal(formatDate(null), '');

// توزيع ما يُدفع الآن على بنود السلة
{
  const items = [{ unitPrice: 1000, qty: 1 }, { unitPrice: 1500, qty: 2 }]; // 1000 و3000
  assert.deepEqual(distributePaid(items, 0), { total: 4000, applied: 0, change: 0, pays: [0, 0] });
  assert.deepEqual(distributePaid(items, 4000), { total: 4000, applied: 4000, change: 0, pays: [1000, 3000] });   // دفع كامل
  assert.deepEqual(distributePaid(items, 5000), { total: 4000, applied: 4000, change: 1000, pays: [1000, 3000] }); // الباقي للزبون
  assert.deepEqual(distributePaid(items, 3000), { total: 4000, applied: 3000, change: 0, pays: [0, 3000] });      // تركيبة مطابقة
  const part = distributePaid(items, 2000);                                                                        // لا مطابقة: كامل + جزئي
  assert.equal(part.applied, 2000);
  assert.equal(part.pays.reduce((a, b) => a + b, 0), 2000);
  assert.ok(part.pays[0] <= 1000 && part.pays[1] <= 3000);
  assert.deepEqual(distributePaid(items, -5).pays, [0, 0]);
  // عشوائيًا: المجموع المطبَّق = المدفوع (أو المجموع)، ولا بند يتجاوز ثمنه
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 300; k++) {
    const its = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ({ unitPrice: (1 + Math.floor(rnd() * 20)) * 250, qty: 1 + Math.floor(rnd() * 3) }));
    const total = its.reduce((a, i) => a + i.unitPrice * i.qty, 0);
    const paid = Math.floor(rnd() * (total + 3000));
    const r = distributePaid(its, paid);
    assert.equal(r.applied + r.change, paid);
    assert.equal(r.pays.reduce((a, b) => a + b, 0), r.applied);
    r.pays.forEach((p, i) => assert.ok(p >= 0 && p <= its[i].unitPrice * its[i].qty));
  }
}

console.log('debts tests OK');
