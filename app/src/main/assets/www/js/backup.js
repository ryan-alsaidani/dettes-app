// النسخ الاحتياطي: بناء/تحقق (نقيّان) + تصدير/استيراد IndexedDB.
import { openDB } from './db.js';
import { requireActive, isLicenseRecord } from './license.js';
import { normalize } from './search.js';

export const BACKUP_APP = 'dettes-app';
export const BACKUP_VERSION = 1;
export const STORES = ['products', 'brands', 'customers', 'orders', 'debts', 'payments', 'settings'];

export function buildBackup(data, now = Date.now()) {
  const stores = {};
  for (const s of STORES) stores[s] = data[s] || [];
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now, stores };
}

const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** يفحص ملف نسخة احتياطية. يعيد {ok:true, counts} أو {ok:false, error} (رسالة عربية). */
export function validateBackup(b) {
  const fail = (error) => ({ ok: false, error });
  if (!isObj(b) || b.app !== BACKUP_APP) return fail('هذا الملف ليس نسخة احتياطية من «دفتر الديون».');
  if (!isInt(b.version) || b.version < 1) return fail('رقم إصدار النسخة غير صالح.');
  if (b.version > BACKUP_VERSION) return fail('النسخة من إصدار أحدث من التطبيق. حدّث التطبيق أولًا.');
  if (!isObj(b.stores)) return fail('بنية الملف ناقصة.');
  for (const s of STORES) if (!Array.isArray(b.stores[s])) return fail('بنية الملف ناقصة: ' + s);
  const st = b.stores;

  const ids = {};
  const checkIds = (name) => {
    const seen = new Set();
    for (const r of st[name]) {
      if (!isObj(r) || !isInt(r.id) || r.id < 1) return 'سجل غير صالح في ' + name;
      if (seen.has(r.id)) return 'معرّف مكرَّر في ' + name;
      seen.add(r.id);
    }
    ids[name] = seen;
    return null;
  };
  for (const n of ['products', 'customers', 'orders', 'debts', 'payments']) {
    const e = checkIds(n);
    if (e) return fail(e);
  }

  for (const r of st.customers) if (!nonEmpty(r.name)) return fail('زبون بلا اسم.');
  for (const r of st.products) {
    if (!nonEmpty(r.name)) return fail('منتج بلا اسم.');
    if (!isInt(r.price) || r.price < 0) return fail('سعر منتج غير صالح.');
  }
  for (const r of st.brands) if (!isObj(r) || !nonEmpty(r.name)) return fail('علامة غير صالحة.');
  for (const r of st.settings) if (!isObj(r) || !nonEmpty(r.key)) return fail('إعداد غير صالح.');

  for (const r of st.orders) if (!ids.customers.has(r.customerId)) return fail('فاتورة تشير إلى زبون غير موجود.');
  for (const d of st.debts) {
    if (!ids.customers.has(d.customerId)) return fail('دين يشير إلى زبون غير موجود.');
    if (!ids.orders.has(d.orderId)) return fail('دين يشير إلى فاتورة غير موجودة.');
    if (!nonEmpty(d.nameSnapshot)) return fail('دين بلا اسم بند.');
    if (!isInt(d.unitPrice) || d.unitPrice < 0 || !isInt(d.qty) || d.qty < 1) return fail('دين بسعر أو كمية غير صالحة.');
    if (!isInt(d.paid) || d.paid < 0 || !isInt(d.remaining) || d.remaining < 0) return fail('دين بمبلغ غير صالح.');
    if (d.remaining !== d.unitPrice * d.qty - d.paid) return fail('أرصدة دين لا تتطابق (الملف تالف).');
  }
  for (const p of st.payments) {
    if (!ids.customers.has(p.customerId)) return fail('دفعة تشير إلى زبون غير موجود.');
    if (!isInt(p.amount) || p.amount <= 0) return fail('دفعة بمبلغ غير صالح.');
    if (!Array.isArray(p.allocations)) return fail('دفعة بلا تفاصيل تخصيص.');
  }

  const counts = {};
  for (const s of STORES) counts[s] = st[s].length;
  return { ok: true, counts };
}

/** يقرأ كل المخازن من IndexedDB ويبني كائن النسخة. */
export async function exportAll(now = Date.now()) {
  const db = await openDB();
  const data = {};
  await Promise.all(STORES.map(name => new Promise((resolve, reject) => {
    const req = db.transaction(name, 'readonly').objectStore(name).getAll();
    req.onsuccess = () => { data[name] = name === 'settings' ? stripLicense(req.result) : req.result; resolve(); };
    req.onerror = () => reject(req.error);
  })));
  return buildBackup(data, now);
}

// نطاقات الاستيراد. «كل شيء» يشمل الإعدادات في الاستبدال الكامل فقط (دون حالة الترخيص).
export const SCOPES = {
  all: ['products', 'brands', 'customers', 'orders', 'debts', 'payments'],
  customers: ['customers', 'orders', 'debts', 'payments'],
  products: ['products', 'brands'],
};

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** هوية الزبون عند الدمج: الاسم الموحَّد + أرقام الهاتف + الوصف (فأحمدان بوصفين مختلفين زبونان مختلفان). */
export const customerKey = (c) => [c.nameNorm || normalize(c.name), digits(c.phone), normalize(c.note || '')].join('|');

/** هوية المنتج عند الدمج: الباركود إن وُجد، وإلا الاسم + العلامة. */
export const productKey = (p) => (p.barcode
  ? 'b:' + String(p.barcode).trim()
  : 'n:' + [p.nameNorm || normalize(p.name), p.brandNorm || normalize(p.brand || '')].join('|'));

const maxId = (arr) => (arr || []).reduce((m, r) => Math.max(m, r.id || 0), 0);

/**
 * دمج «إضافة الناقص فقط» (نقي): يحسب ما يُضاف دون لمس الموجود.
 * المعرّفات المحلية تُعاد ترقيمها بعد أكبر معرّف عندك فلا تتصادم مع معرّفات الجهاز الآخر.
 * الزبون الموجود (نفس الاسم والهاتف والوصف) يُتخطّى مع ديونه، والجديد يُضاف مع فواتيره وديونه ودفعاته.
 * local: {products, brands, customers, orders, debts, payments} (ما في النطاق فقط)   backup: stores الملف
 * يعيد {add:{...}, counts:{...}, skipped:{customers, products}}
 */
export function mergeData(local, backup, scope) {
  const L = (n) => (local && local[n]) || [];
  const B = (n) => (backup && backup[n]) || [];
  const add = { products: [], brands: [], customers: [], orders: [], debts: [], payments: [] };
  const skipped = { customers: 0, products: 0 };
  const productMap = new Map();

  if (scope === 'all' || scope === 'products') {
    const have = new Map(L('products').map(p => [productKey(p), p]));
    let next = maxId(L('products')) + 1;
    for (const p of B('products')) {
      const k = productKey(p);
      const ex = have.get(k);
      if (ex) { productMap.set(p.id, ex.id); skipped.products++; continue; }
      const rec = { ...p, id: next++ };
      add.products.push(rec);
      have.set(k, rec);
      productMap.set(p.id, rec.id);
    }
    const haveBrands = new Set(L('brands').map(b => normalize(b.name)));
    for (const b of B('brands')) {
      const n = normalize(b.name);
      if (!haveBrands.has(n)) { add.brands.push({ name: b.name }); haveBrands.add(n); }
    }
  }

  if (scope === 'all' || scope === 'customers') {
    const have = new Set(L('customers').map(customerKey));
    let nextC = maxId(L('customers')) + 1;
    let nextO = maxId(L('orders')) + 1;
    let nextD = maxId(L('debts')) + 1;
    let nextP = maxId(L('payments')) + 1;
    const custMap = new Map();
    for (const c of B('customers')) {
      const k = customerKey(c);
      if (have.has(k)) { skipped.customers++; continue; }
      have.add(k);
      const rec = { ...c, id: nextC++ };
      add.customers.push(rec);
      custMap.set(c.id, rec.id);
    }
    const orderMap = new Map();
    for (const o of B('orders')) {
      if (!custMap.has(o.customerId)) continue;
      const rec = { ...o, id: nextO++, customerId: custMap.get(o.customerId) };
      add.orders.push(rec);
      orderMap.set(o.id, rec.id);
    }
    const debtMap = new Map();
    for (const d of B('debts')) {
      if (!custMap.has(d.customerId) || !orderMap.has(d.orderId)) continue;
      const rec = {
        ...d, id: nextD++,
        customerId: custMap.get(d.customerId),
        orderId: orderMap.get(d.orderId),
        // ربط المنتج يُحفظ فقط إن دُمجت المنتجات أيضًا (لقطة الاسم والسعر داخل الدين تكفي)
        productId: d.productId != null && productMap.has(d.productId) ? productMap.get(d.productId) : null,
      };
      add.debts.push(rec);
      debtMap.set(d.id, rec.id);
    }
    for (const p of B('payments')) {
      if (!custMap.has(p.customerId)) continue;
      add.payments.push({
        ...p, id: nextP++, customerId: custMap.get(p.customerId),
        allocations: (p.allocations || []).filter(a => debtMap.has(a.debtId)).map(a => ({ ...a, debtId: debtMap.get(a.debtId) })),
      });
    }
  }

  const counts = {};
  for (const n of Object.keys(add)) counts[n] = add[n].length;
  return { add, counts, skipped };
}

function readStores(db, names) {
  const out = {};
  return Promise.all(names.map(name => new Promise((resolve, reject) => {
    const req = db.transaction(name, 'readonly').objectStore(name).getAll();
    req.onsuccess = () => { out[name] = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  }))).then(() => out);
}

/** معاينة ما سيحدث (دون كتابة). */
export async function previewImport(backup, { scope = 'all', mode = 'replace' } = {}) {
  const names = SCOPES[scope];
  if (!names) throw new Error('نطاق غير معروف');
  const db = await openDB();
  const local = await readStores(db, names);
  if (mode === 'merge') {
    const plan = mergeData(local, backup.stores, scope);
    return { mode, add: plan.counts, skipped: plan.skipped };
  }
  const incoming = {};
  const current = {};
  for (const n of names) { incoming[n] = backup.stores[n].length; current[n] = local[n].length; }
  return { mode, incoming, current };
}

/**
 * يستورد من نسخة (يفترض أن validateBackup نجح) في معاملة واحدة: إما الكل أو لا شيء.
 * scope: all | customers | products     mode: replace (استبدال الموجود في النطاق) | merge (إضافة الناقص فقط)
 * حالة الترخيص تخص الجهاز ولا تتأثر أبدًا.
 */
export async function importBackup(backup, { scope = 'all', mode = 'replace' } = {}) {
  requireActive();
  const scoped = SCOPES[scope];
  if (!scoped) throw new Error('نطاق غير معروف');
  const db = await openDB();

  if (mode === 'merge') {
    const local = await readStores(db, scoped);
    const plan = mergeData(local, backup.stores, scope);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(scoped, 'readwrite');
      for (const name of scoped) {
        const store = tx.objectStore(name);
        for (const rec of plan.add[name] || []) store.put(rec);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('فشل الاستيراد'));
    });
    return { counts: plan.counts, skipped: plan.skipped };
  }

  const names = scope === 'all' ? STORES : scoped;
  const keep = scope === 'all'
    ? (await readStores(db, ['settings'])).settings.filter(isLicenseRecord)
    : [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) {
      const store = tx.objectStore(name);
      store.clear();
      const records = name === 'settings' ? stripLicense(backup.stores[name]) : backup.stores[name];
      for (const rec of records) store.put(rec);
    }
    if (scope === 'all') {
      const settingsStore = tx.objectStore('settings');
      for (const rec of keep) settingsStore.put(rec);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('فشل الاستيراد'));
  });
  const counts = {};
  for (const n of names) counts[n] = (backup.stores[n] || []).length;
  return { counts, skipped: null };
}

/** استبدال كامل (للتوافق مع الاسم القديم). */
export const importAll = (backup) => importBackup(backup, { scope: 'all', mode: 'replace' });

/** يحذف سجلات الترخيص (lic_*) من قائمة الإعدادات. */
export function stripLicense(settings) {
  return (settings || []).filter(r => !isLicenseRecord(r));
}

export function backupFileName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `dettes-backup-${y}-${m}-${d}.json`;
}

/** كم يومًا مضى منذ ts (مللي ثانية)؟ null إن لم تكن هناك نسخة. */
export function daysSince(ts, now = Date.now()) {
  if (!ts) return null;
  return Math.floor((now - ts) / 86400000);
}
