import * as db from './db.js';
import { openDB } from './db.js';
import { todayISO } from './dates.js';
import { requireActive } from './license.js';
import { newUid, ensureUid } from './uid.js';

/**
 * يطبّق تسديدًا في معاملة واحدة: يحدّث الديون ويسجّل الدفعة مع تفاصيل التخصيص (للتراجع).
 * items: [{debtId, pay}]  received: المبلغ المستلم (الفرق عن المجموع المطبَّق = الباقي للزبون)
 */
export async function applyPayment({ customerId, items, received }) {
  requireActive();
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
      const now = Date.now();
      for (const [it, d] of loaded) {
        ds.put({ ...d, uid: ensureUid('debts', d), paid: d.paid + it.pay, remaining: d.remaining - it.pay, updatedAt: now });
        applied += it.pay;
      }
      ps.add({
        uid: newUid(), customerId, amount: applied,
        change: Math.max(0, (received || applied) - applied),
        date: todayISO(), createdAt: now, updatedAt: now,
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
  requireActive();
  const dbx = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbx.transaction(['debts', 'payments', 'tombstones'], 'readwrite');
    const ds = tx.objectStore('debts');
    const ps = tx.objectStore('payments');
    const tombs = tx.objectStore('tombstones');
    const gp = ps.get(paymentId);
    gp.onsuccess = () => {
      const p = gp.result;
      if (!p) return;
      const now = Date.now();
      for (const a of p.allocations || []) {
        const gd = ds.get(a.debtId);
        gd.onsuccess = () => {
          const d = gd.result;
          if (!d) return;
          const paid = Math.max(0, d.paid - a.amount);
          ds.put({ ...d, uid: ensureUid('debts', d), paid, remaining: d.unitPrice * d.qty - paid, updatedAt: now });
        };
      }
      ps.delete(paymentId);
      tombs.put({ uid: ensureUid('payments', p), kind: 'payments', at: now });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listPayments = (customerId) => db.getAllByIndex('payments', 'customerId', customerId);
