// طبقة IndexedDB. كل المخازن تُنشأ الآن حتى لا تلزم هجرة لاحقًا.

const DB_NAME = 'dettes';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const auto = (name, indexes = []) => {
        const st = db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        indexes.forEach(([n, kp]) => st.createIndex(n, kp));
      };
      auto('products', [['barcode', 'barcode'], ['nameNorm', 'nameNorm']]);
      auto('customers', [['nameNorm', 'nameNorm']]);
      auto('orders', [['customerId', 'customerId']]);
      auto('debts', [['customerId', 'customerId'], ['orderId', 'orderId']]);
      auto('payments', [['customerId', 'customerId']]);
      db.createObjectStore('brands', { keyPath: 'name' });
      db.createObjectStore('settings', { keyPath: 'key' });
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
