import assert from 'node:assert/strict';
import { statusOf, summarize, filterByStatus, sortDebts, groupByOrder, debtHaystack } from '../app/src/main/assets/www/js/debtlogic.js';
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

console.log('debts tests OK');
