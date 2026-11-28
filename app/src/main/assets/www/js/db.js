// طبقة IndexedDB.
// الإصدار 2: لكل سجل uid (معرّف فريد) وupdatedAt، ومخزن tombstones لتسجيل الحذف (لنقله بين الأجهزة).
import { legacyUid } from './uid.js';

const DB_NAME = 'dettes';
const DB_VERSION = 2;
const UID_STORES = ['products', 'customers', 'orders', 'debts', 'payments'];
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const auto = (name, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const st = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        indexes.forEach(([n, kp]) => st.createIndex(n, kp));
      };
      auto('products', [['barcode', 'barcode'], ['nameNorm', 'nameNorm']]);
      auto('customers', [['nameNorm', 'nameNorm']]);
      auto('orders', [['customerId', 'customerId']]);
      auto('debts', [['customerId', 'customerId'], ['orderId', 'orderId']]);
      auto('payments', [['customerId', 'customerId']]);
      if (!db.objectStoreNames.contains('brands')) db.createObjectStore('brands', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('tombstones')) db.createObjectStore('tombstones', { keyPath: 'uid' });

      // ترحيل من الإصدار 1: يُعطى كل سجل قديم uid حتميًّا وupdatedAt (بنفس معاملة الترقية)
      if (ev.oldVersion >= 1 && ev.oldVersion < 2) {
        const tx = req.transaction;
        for (const name of UID_STORES) {
          tx.objectStore(name).openCursor().onsuccess = (e) => {
            const cur = e.target.result;
            if (!cur) return;
            const v = cur.value;
            if (!v.uid) {
              v.uid = legacyUid(name, v);
              v.updatedAt = v.createdAt || Date.now();
              cur.update(v);
            }
            cur.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    let result;
    const r = fn(st);
    if (r) r.onsuccess = () => { result = r.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const getAll = (store) => run(store, 'readonly', st => st.getAll());
export const get = (store, key) => run(store, 'readonly', st => st.get(key));
export const put = (store, obj) => run(store, 'readwrite', st => st.put(obj));
export const del = (store, key) => run(store, 'readwrite', st => st.delete(key));
export const getAllByIndex = (store, index, value) =>
  run(store, 'readonly', st => st.index(index).getAll(value));

/** يسجّل حذف سجل (ليصل الحذف إلى الجهاز الآخر عند التبادل). */
export const putTombstone = (kind, uid, at = Date.now()) => put('tombstones', { uid, kind, at });
