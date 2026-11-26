import assert from 'node:assert/strict';
import { buildBackup, validateBackup, STORES, backupFileName, daysSince, stripLicense, mergeData, customerKey, productKey, SCOPES } from '../app/src/main/assets/www/js/backup.js';

const good = () => buildBackup({
  customers: [{ id: 1, name: 'أحمد', nameNorm: 'احمد' }, { id: 2, name: 'سالم' }],
  products: [{ id: 1, name: 'قلم', price: 800 }],
  brands: [{ name: 'بيك' }],
  orders: [{ id: 1, customerId: 1, date: '2026-03-01', note: null }],
  debts: [
    { id: 1, orderId: 1, customerId: 1, nameSnapshot: 'قلم', unitPrice: 800, qty: 2, date: '2026-03-01', paid: 600, remaining: 1000 },
    { id: 2, orderId: 1, customerId: 1, nameSnapshot: 'دفتر', unitPrice: 1500, qty: 1, date: '2026-03-01', paid: 1500, remaining: 0 },
  ],
  payments: [{ id: 1, customerId: 1, amount: 600, date: '2026-03-02', allocations: [{ debtId: 1, amount: 600 }] }],
  settings: [{ key: 'shopName', value: 'مكتبة النور' }],
}, 1700000000000);

// صالحة، وتمرّ عبر JSON ذهابًا وإيابًا
const b = good();
assert.deepEqual(STORES.slice().sort(), Object.keys(b.stores).sort());
const rt = JSON.parse(JSON.stringify(b));
const v = validateBackup(rt);
assert.ok(v.ok, v.error);
assert.deepEqual(v.counts, { products: 1, brands: 1, customers: 2, orders: 1, debts: 2, payments: 1, settings: 1 });

// نسخة فارغة صالحة
assert.ok(validateBackup(buildBackup({})).ok);

// أخطاء
const bad = (mut, part) => {
  const x = good(); mut(x);
  const r = validateBackup(x);
  assert.equal(r.ok, false, part);
  assert.ok(r.error.includes(part) || part === '', r.error + ' ← ' + part);
};
assert.equal(validateBackup(null).ok, false);
assert.equal(validateBackup([]).ok, false);
assert.equal(validateBackup({ app: 'other' }).ok, false);
bad(x => { x.app = 'x'; }, 'ليس نسخة');
bad(x => { x.version = 99; }, 'أحدث');
bad(x => { x.version = 0; }, 'غير صالح');
bad(x => { delete x.stores.debts; }, 'ناقصة');
bad(x => { x.stores.customers.push({ id: 1, name: 'مكرر' }); }, 'مكرَّر');
bad(x => { x.stores.customers[0].name = ' '; }, 'بلا اسم');
bad(x => { x.stores.debts[0].customerId = 77; }, 'زبون غير موجود');
bad(x => { x.stores.debts[0].orderId = 77; }, 'فاتورة غير موجودة');
bad(x => { x.stores.debts[0].remaining = 5; }, 'تتطابق');
bad(x => { x.stores.debts[0].qty = 0; }, 'كمية');
bad(x => { x.stores.debts[0].unitPrice = 1.5; }, 'سعر');
bad(x => { x.stores.products[0].price = -1; }, 'سعر');
bad(x => { x.stores.orders[0].customerId = 9; }, 'زبون غير موجود');
bad(x => { x.stores.payments[0].amount = 0; }, 'دفعة');
bad(x => { delete x.stores.payments[0].allocations; }, 'تخصيص');
bad(x => { x.stores.settings.push({ value: 1 }); }, 'إعداد');
bad(x => { x.stores.brands.push({ name: '' }); }, 'علامة');

// اسم الملف وعدّاد الأيام
assert.equal(backupFileName(new Date(2026, 10, 5)), 'dettes-backup-2026-11-05.json');
assert.equal(daysSince(0), null);
assert.equal(daysSince(null), null);
assert.equal(daysSince(1000, 1000 + 86400000 * 3 + 5), 3);
assert.equal(daysSince(5000, 5000), 0);

// حالة الترخيص لا تدخل النسخ الاحتياطي
assert.deepEqual(stripLicense([{ key: 'shopName', value: 'أ' }, { key: 'lic_state', value: { nonce: 'x' } }, { key: 'lastBackupAt', value: 1 }]),
  [{ key: 'shopName', value: 'أ' }, { key: 'lastBackupAt', value: 1 }]);
assert.deepEqual(stripLicense(undefined), []);
// ---------- الدمج: إضافة الناقص فقط ----------
{
  const local = {
    customers: [{ id: 1, name: 'أحمد', nameNorm: 'احمد', phone: '55 123 456', note: 'ابن الجيران' }, { id: 2, name: 'سالم', nameNorm: 'سالم', phone: null, note: null }],
    orders: [{ id: 5, customerId: 1, date: '2026-01-01' }],
    debts: [{ id: 9, orderId: 5, customerId: 1, nameSnapshot: 'قلم', unitPrice: 800, qty: 1, paid: 0, remaining: 800, date: '2026-01-01', productId: 1 }],
    payments: [{ id: 3, customerId: 1, amount: 100, allocations: [{ debtId: 9, amount: 100 }] }],
    products: [{ id: 1, name: 'قلم', nameNorm: 'قلم', barcode: '111', brand: null, price: 800 }, { id: 2, name: 'مسطرة', nameNorm: 'مسطره', barcode: null, brand: 'بيك', brandNorm: 'بيك', price: 500 }],
    brands: [{ name: 'بيك' }],
  };
  const file = {
    // نفس المعرّفات (1،2) لكن لأشخاص مختلفين: لا تصادم
    customers: [
      { id: 1, name: 'أحمد', nameNorm: 'احمد', phone: '55123456', note: 'ابن الجيران' },   // موجود (الهاتف بلا مسافات)
      { id: 2, name: 'أحمد', nameNorm: 'احمد', phone: null, note: 'صاحب المخبزة' },      // أحمد آخر: جديد
      { id: 3, name: 'نور', nameNorm: 'نور', phone: '99', note: null },                  // جديد
    ],
    orders: [{ id: 5, customerId: 2, date: '2026-02-01', note: 'ن' }, { id: 6, customerId: 3, date: '2026-02-02' }, { id: 7, customerId: 1, date: '2026-02-03' }],
    debts: [
      { id: 9, orderId: 5, customerId: 2, nameSnapshot: 'خبز', unitPrice: 300, qty: 2, paid: 100, remaining: 500, date: '2026-02-01', productId: 2 },
      { id: 10, orderId: 6, customerId: 3, nameSnapshot: 'مسطرة', unitPrice: 500, qty: 1, paid: 0, remaining: 500, date: '2026-02-02', productId: 7 },
      { id: 11, orderId: 7, customerId: 1, nameSnapshot: 'دفتر', unitPrice: 900, qty: 1, paid: 0, remaining: 900, date: '2026-02-03', productId: null },
    ],
    payments: [{ id: 3, customerId: 2, amount: 100, allocations: [{ debtId: 9, amount: 100 }] }, { id: 4, customerId: 1, amount: 50, allocations: [{ debtId: 11, amount: 50 }] }],
    products: [
      { id: 1, name: 'قلم', nameNorm: 'قلم', barcode: '111', price: 999 },                // موجود (نفس الباركود): يُتخطّى ولا يُستبدل سعره
      { id: 2, name: 'خبز', nameNorm: 'خبز', barcode: null, brand: null, price: 300 },    // جديد
      { id: 7, name: 'مسطرة', nameNorm: 'مسطره', barcode: null, brand: 'بيك', brandNorm: 'بيك', price: 500 }, // موجود (الاسم+العلامة)
    ],
    brands: [{ name: 'بيك' }, { name: 'ستابيلو' }],
  };
  const r = mergeData(local, file, 'all');
  assert.deepEqual(r.counts, { products: 1, brands: 1, customers: 2, orders: 2, debts: 2, payments: 1 });
  assert.deepEqual(r.skipped, { customers: 1, products: 2 });
  // أرقام جديدة بعد أكبر معرّف محلي
  assert.deepEqual(r.add.customers.map(c => [c.id, c.name, c.note]), [[3, 'أحمد', 'صاحب المخبزة'], [4, 'نور', null]]);
  assert.deepEqual(r.add.orders.map(o => [o.id, o.customerId]), [[6, 3], [7, 4]]);
  assert.deepEqual(r.add.debts.map(d => [d.id, d.orderId, d.customerId, d.productId]), [[10, 6, 3, 3], [11, 7, 4, 2]]); // «خبز» جديد (id 3)، و«مسطرة» موجودة عندك (id 2)
  assert.deepEqual(r.add.payments.map(p => [p.id, p.customerId, p.allocations[0].debtId]), [[4, 3, 10]]);
  assert.equal(r.add.products[0].id, 3);
  assert.deepEqual(r.add.brands, [{ name: 'ستابيلو' }]);
  // لا يُمسّ الموجود: الدين (11) للزبون الموجود أحمد وفاتورته (7) لم يُضافا
  assert.ok(!r.add.debts.some(d => d.nameSnapshot === 'دفتر'));

  // تطبيق الإضافة ثم الدمج مرة ثانية: لا شيء جديد (idempotent)
  const merged = { ...local };
  for (const k of Object.keys(r.add)) merged[k] = [...(local[k] || []), ...r.add[k]];
  const r2 = mergeData(merged, file, 'all');
  assert.deepEqual(r2.counts, { products: 0, brands: 0, customers: 0, orders: 0, debts: 0, payments: 0 });

  // نطاق الزبائن فقط: لا منتجات، وربط المنتج في الدين يُصفَّر
  const rc = mergeData(local, file, 'customers');
  assert.equal(rc.counts.products, 0);
  assert.equal(rc.counts.customers, 2);
  assert.ok(rc.add.debts.every(d => d.productId === null));
  // نطاق المنتجات فقط
  const rp = mergeData(local, file, 'products');
  assert.deepEqual([rp.counts.products, rp.counts.customers, rp.counts.debts], [1, 0, 0]);
  // ملف فارغ ومحلي فارغ
  assert.deepEqual(mergeData({}, { customers: [], products: [] }, 'all').counts, { products: 0, brands: 0, customers: 0, orders: 0, debts: 0, payments: 0 });
  // من محلي فارغ: كل شيء يُضاف بمعرّفات تبدأ من 1
  const fresh = mergeData({}, file, 'all');
  assert.equal(fresh.counts.customers, 3);
  assert.deepEqual(fresh.add.customers.map(c => c.id), [1, 2, 3]);
}
// هوية الزبون والمنتج
assert.equal(customerKey({ name: 'أحمد', phone: '55 123', note: 'س' }), customerKey({ name: 'أحمد', nameNorm: 'احمد', phone: '55-123', note: ' س ' }));
assert.notEqual(customerKey({ name: 'أحمد', note: 'أ' }), customerKey({ name: 'أحمد', note: 'ب' }));
assert.equal(productKey({ name: 'x', barcode: ' 123 ' }), productKey({ name: 'y', barcode: '123' }));
assert.deepEqual(SCOPES.customers, ['customers', 'orders', 'debts', 'payments']);
assert.deepEqual(SCOPES.products, ['products', 'brands']);

console.log('backup tests OK');
