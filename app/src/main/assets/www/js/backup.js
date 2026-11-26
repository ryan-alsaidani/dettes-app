// النسخ الاحتياطي: بناء/تحقق (نقيّان) + تصدير/استيراد IndexedDB.
import { openDB } from './db.js';
import { requireActive, isLicenseRecord } from './license.js';

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

/** يستبدل كل البيانات بمحتوى النسخة (معاملة واحدة: إما الكل أو لا شيء). يفترض أن validateBackup نجح. */
export async function importAll(backup) {
  requireActive();
  const db = await openDB();
  // حالة الترخيص تخص الجهاز: لا تدخل النسخة ولا تُستبدل بالاسترجاع (وإلا أمكن إعادة استعمال مفتاح قديم)
  const keep = await new Promise((resolve, reject) => {
    const req = db.transaction('settings', 'readonly').objectStore('settings').getAll();
    req.onsuccess = () => resolve(req.result.filter(isLicenseRecord));
    req.onerror = () => reject(req.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    for (const name of STORES) {
      const store = tx.objectStore(name);
      store.clear();
      const records = name === 'settings' ? stripLicense(backup.stores[name]) : backup.stores[name];
      for (const rec of records) store.put(rec);
    }
    const settingsStore = tx.objectStore('settings');
    for (const rec of keep) settingsStore.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('فشل الاستيراد'));
  });
}

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
