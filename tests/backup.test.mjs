import assert from 'node:assert/strict';
import { buildBackup, validateBackup, STORES, backupFileName, daysSince, stripLicense } from '../app/src/main/assets/www/js/backup.js';

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
console.log('backup tests OK');
