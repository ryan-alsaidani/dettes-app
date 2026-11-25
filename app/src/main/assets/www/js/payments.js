import * as db from './db.js';
import { openDB } from './db.js';
import { todayISO } from './dates.js';

/**
 * يطبّق تسديدًا في معاملة واحدة: يحدّث الديون ويسجّل الدفعة مع تفاصيل التخصيص (للتراجع).
 * items: [{debtId, pay}]  received: المبلغ المستلم (الفرق عن المجموع المطبَّق = الباقي للزبون)
 */
export async function applyPayment({ customerId, items, received }) {
  if (!items || !items.length) throw new Error('لا شيء لتسديده');
  const dbx = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(['debts', 'payments'], 'readwrite');
    const ds = tx.objectStore('debts');
    const ps = tx.objectStore('payments');
    const loaded = [];
    let pending = items.length;
    let failed = null;

    function commit() {
      for (const [it, d] of loaded) {
        if (!d || !Number.isInteger(it.pay) || it.pay <= 0 || it.pay > d.remaining) {
          failed = new Error('تغيّرت أرصدة الديون. أعد المحاولة.');
          tx.abort();
          return;
        }
      }
      let applied = 0;
      for (const [it, d] of loaded) {
        ds.put({ ...d, paid: d.paid + it.pay, remaining: d.remaining - it.pay });
        applied += it.pay;
      }
      ps.add({
        customerId, amount: applied,
        change: Math.max(0, (received || applied) - applied),
        date: todayISO(), createdAt: Date.now(),
        allocations: items.map(it => ({ debtId: it.debtId, amount: it.pay })),
      });
    }

    for (const it of items) {
      const g = ds.get(it.debtId);
      g.onsuccess = () => { loaded.push([it, g.result]); if (--pending === 0) commit(); };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(failed || tx.error || new Error('تعذّر التسديد'));
  });
}

export async function getLastPayment(customerId) {
  const all = await db.getAllByIndex('payments', 'customerId', customerId);
  return all.reduce((best, p) => (!best || p.id > best.id ? p : best), null);
}

/** يعيد المبالغ إلى الديون ويحذف سجل الدفعة. الديون المحذوفة تُتجاهل. */
export async function undoPayment(paymentId) {
  const dbx = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(['debts', 'payments'], 'readwrite');
    const ds = tx.objectStore('debts');
    const ps = tx.objectStore('payments');
    const gp = ps.get(paymentId);
    gp.onsuccess = () => {
      const p = gp.result;
      if (!p) return;
      for (const a of p.allocations || []) {
        const gd = ds.get(a.debtId);
        gd.onsuccess = () => {
          const d = gd.result;
          if (!d) return;
          const paid = Math.max(0, d.paid - a.amount);
          ds.put({ ...d, paid, remaining: d.unitPrice * d.qty - paid });
        };
      }
      ps.delete(paymentId);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
