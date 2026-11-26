import * as db from './db.js';
import { openDB } from './db.js';
import { todayISO } from './dates.js';
import { requireActive } from './license.js';

function validateLine(it) {
  if (!String(it.nameSnapshot ?? '').trim()) throw new Error('اسم البند مطلوب');
  if (!Number.isInteger(it.unitPrice) || it.unitPrice <= 0) throw new Error('السعر يجب أن يكون أكبر من صفر');
  if (!Number.isInteger(it.qty) || it.qty < 1) throw new Error('الكمية غير صالحة');
}

/** يسجّل «زيارة/فاتورة» وبنودها في معاملة واحدة (إما الكل أو لا شيء). */
export async function createOrder({ customerId, date, note, items }) {
  if (!items || !items.length) throw new Error('أضف بندًا واحدًا على الأقل');
  items.forEach(validateLine);
  const dbx = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(['orders', 'debts'], 'readwrite');
    const orders = tx.objectStore('orders');
    const debts = tx.objectStore('debts');
    const req = orders.add({ customerId, date, note: String(note ?? '').trim() || null, createdAt: Date.now() });
    req.onsuccess = () => {
      const orderId = req.result;
      for (const it of items) {
        debts.add({
          orderId, customerId,
          productId: it.productId || null,
          nameSnapshot: String(it.nameSnapshot).trim(),
          unitPrice: it.unitPrice, qty: it.qty,
          date, paid: 0, remaining: it.unitPrice * it.qty,
          createdAt: Date.now(),
        });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function loadCustomerData(customerId) {
  const [debts, orders] = await Promise.all([
    db.getAllByIndex('debts', 'customerId', customerId),
    db.getAllByIndex('orders', 'customerId', customerId),
  ]);
  return { debts, orders: new Map(orders.map(o => [o.id, o])) };
}

/** «تم دفع الثمن»: يسدّد ما بقي من الدين ويسجّل دفعة (ليظهر في السجل ويمكن التراجع عنها لاحقًا). */
export async function markPaid(debtId) {
  requireActive();
  const dbx = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(['debts', 'payments'], 'readwrite');
    const debts = tx.objectStore('debts');
    const pays = tx.objectStore('payments');
    const g = debts.get(debtId);
    g.onsuccess = () => {
      const d = g.result;
      if (!d || d.remaining <= 0) return;
      const amount = d.remaining;
      pays.add({
        customerId: d.customerId, amount, date: todayISO(), createdAt: Date.now(),
        allocations: [{ debtId: d.id, amount }],
      });
      debts.put({ ...d, paid: d.paid + amount, remaining: 0 });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function updateDebt(id, { name, unitPrice, qty }) {
  requireActive();
  const d = await db.get('debts', id);
  if (!d) throw new Error('الدين غير موجود');
  validateLine({ nameSnapshot: name, unitPrice, qty });
  const total = unitPrice * qty;
  if (total < d.paid) throw new Error('الإجمالي الجديد أقل مما دُفع فعلًا (' + d.paid + ' مليم)');
  return db.put('debts', { ...d, nameSnapshot: String(name).trim(), unitPrice, qty, remaining: total - d.paid });
}

export async function deleteDebt(id) {
  requireActive();
  const d = await db.get('debts', id);
  if (!d) return;
  await db.del('debts', id);
  const rest = await db.getAllByIndex('debts', 'orderId', d.orderId);
  if (!rest.length) await db.del('orders', d.orderId);
}
