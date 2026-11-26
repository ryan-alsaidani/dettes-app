import * as db from './db.js';
import { normalize } from './search.js';
import { requireActive } from './license.js';

export async function saveCustomer({ id, name, phone, note }) {
  requireActive();
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('الاسم مطلوب');
  const old = id ? await db.get('customers', id) : null;
  const obj = {
    ...(old || {}),
    name: clean,
    nameNorm: normalize(clean),
    phone: String(phone ?? '').trim() || null,
    note: String(note ?? '').trim() || null,
    createdAt: old ? old.createdAt : Date.now(),
  };
  if (id) obj.id = id;
  return db.put('customers', obj);
}

export const getCustomer = (id) => db.get('customers', id);

/** أسماء موحَّدة فقط (للتنبيه إلى تكرار الاسم). */
export async function listCustomerNames() {
  return (await db.getAll('customers')).map(c => ({ id: c.id, nameNorm: c.nameNorm }));
}

/**
 * كل الزبائن مع المتبقي وعدد الديون المفتوحة ونص بحث شامل:
 * الاسم + الهاتف + الوصف + أسماء بنود ديونه + ملاحظات فواتيره.
 */
export async function listCustomersWithTotals() {
  const [customers, debts, orders] = await Promise.all([
    db.getAll('customers'), db.getAll('debts'), db.getAll('orders')]);
  const orderNote = new Map(orders.map(o => [o.id, o.note]));
  const agg = new Map();
  for (const d of debts) {
    let a = agg.get(d.customerId);
    if (!a) { a = { remaining: 0, open: 0, words: [] }; agg.set(d.customerId, a); }
    a.remaining += d.remaining || 0;
    if (d.remaining > 0) a.open++;
    a.words.push(d.nameSnapshot);
    const n = orderNote.get(d.orderId);
    if (n) a.words.push(n);
  }
  return customers
    .map(c => {
      const a = agg.get(c.id) || { remaining: 0, open: 0, words: [] };
      const phone = normalize(c.phone || '');
      const hay = [c.nameNorm, phone, phone.replace(/\s+/g, ''), normalize(c.note || ''), normalize(a.words.join(' '))].join(' ');
      return { ...c, remaining: a.remaining, open: a.open, hay };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function customerDebtCount(id) {
  return (await db.getAllByIndex('debts', 'customerId', id)).length;
}

export async function deleteCustomer(id) {
  requireActive();
  await db.del('customers', id);
  for (const p of await db.getAllByIndex('payments', 'customerId', id)) await db.del('payments', p.id);
  for (const o of await db.getAllByIndex('orders', 'customerId', id)) await db.del('orders', o.id);
}
