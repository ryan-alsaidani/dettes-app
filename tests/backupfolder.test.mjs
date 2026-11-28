import assert from 'node:assert/strict';
globalThis.window = globalThis.window || {};   // الجسر يلمس window عند التحميل
const { stampOf, backupFileNameAt, backupFolderNameAt, buildManifest, parseManifest, pickNewest } = await import('../app/src/main/assets/www/js/backupfolder.js');
import { buildBackupZip, backupFromZip, backupCounts, zipFileName } from '../app/src/main/assets/www/js/zipbackup.js';
import { buildBackup, validateBackup } from '../app/src/main/assets/www/js/backup.js';

const d = new Date(2026, 10, 5, 9, 7);
assert.equal(stampOf(d), '2026-11-05_0907');
assert.equal(backupFileNameAt(d), 'dettes-backup-2026-11-05_0907.json');
assert.equal(backupFolderNameAt(d), 'dettes-backup-2026-11-05_0907');
assert.equal(zipFileName(d), 'dettes-backup-2026-11-05.zip');

const backup = buildBackup({
  customers: [{ id: 1, name: 'أحمد' }], products: [{ id: 1, name: 'قلم', price: 800 }], brands: [], orders: [{ id: 1, customerId: 1 }],
  debts: [{ id: 1, orderId: 1, customerId: 1, nameSnapshot: 'قلم', unitPrice: 800, qty: 1, paid: 0, remaining: 800 }], payments: [], settings: [],
}, 1700000000000);

// manifest
const m = buildManifest('dettes-backup-2026-11-05_0907.json', backup, 1700000001000);
assert.deepEqual(m.counts, { products: 1, brands: 0, customers: 1, orders: 1, debts: 1, payments: 0, settings: 0 });
assert.equal(m.file, 'dettes-backup-2026-11-05_0907.json');
assert.deepEqual(parseManifest(JSON.stringify(m)), m);
assert.equal(parseManifest('ليس json'), null);
assert.equal(parseManifest(JSON.stringify({ app: 'other', file: 'a.json' })), null);
assert.equal(parseManifest(JSON.stringify({ app: 'dettes-app', file: '../../etc/passwd' })), null);   // لا مسارات
assert.equal(parseManifest(JSON.stringify({ app: 'dettes-app', file: 'a\\b.json' })), null);
assert.equal(parseManifest(JSON.stringify({ app: 'dettes-app', file: '' })), null);

// أحدث ملف
const list = [
  { name: 'latest.json', dir: false, modified: 900 },
  { name: 'dettes-backup-2026-11-01_1000.json', dir: false, modified: 100 },
  { name: 'dettes-backup-2026-11-03_1000.json', dir: false, modified: 300 },
  { name: 'dettes-backup-2026-11-02_1000.json', dir: false, modified: 200 },
  { name: 'dettes-backup-2026-11-09', dir: true, modified: 999 },        // مجلد: يُتجاهل
  { name: 'صورة.jpg', dir: false, modified: 1000 },
  { name: 'notes.txt', dir: false, modified: 1001 },
];
assert.equal(pickNewest(list).name, 'dettes-backup-2026-11-03_1000.json');
assert.equal(pickNewest([{ name: 'a.json', dir: false, modified: 1 }]), null);
assert.equal(pickNewest([]), null);
assert.equal(pickNewest(null), null);
// تعادل الوقت: الاسم الأحدث
assert.equal(pickNewest([{ name: 'dettes-backup-a.json', dir: false, modified: 5 }, { name: 'dettes-backup-b.json', dir: false, modified: 5 }]).name, 'dettes-backup-b.json');

// ZIP النسخة: ذهابًا وإيابًا، والنتيجة صالحة للاستيراد
const zip = await buildBackupZip(backup, d);
const back = await backupFromZip(zip);
assert.deepEqual(back, backup);
assert.ok(validateBackup(back).ok);
assert.deepEqual(backupCounts(back), m.counts);
await assert.rejects(backupFromZip(new Uint8Array([1, 2, 3])), /ليس ZIP/);
const { makeZip } = await import('../app/src/main/assets/www/js/zip.js');
await assert.rejects(backupFromZip(await makeZip([{ name: 'x.txt', data: new Uint8Array([65]) }])), /backup\.json/);
await assert.rejects(backupFromZip(await makeZip([{ name: 'backup.json', data: new TextEncoder().encode('{مكسور') }])), /JSON/);
// ZIP فيه ملف json باسم آخر (من برنامج آخر)
const alt = await backupFromZip(await makeZip([{ name: 'folder/my.json', data: new TextEncoder().encode(JSON.stringify(backup)) }]));
assert.deepEqual(alt, backup);

console.log('backupfolder tests OK');
