import * as db from './db.js';
import { normalize } from './search.js';

export async function saveCustomer({ id, name, phone, note }) {
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

/** كل الزبائن مع المتبقي الإجمالي لكل زبون (مجموع remaining في الديون). */
export async function listCustomersWithTotals() {
  const [customers, debts] = await Promise.all([db.getAll('customers'), db.getAll('debts')]);
  const totals = new Map();
  for (const d of debts) totals.set(d.customerId, (totals.get(d.customerId) || 0) + (d.remaining || 0));
  return customers
    .map(c => ({ ...c, remaining: totals.get(c.id) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export async function customerDebtCount(id) {
  return (await db.getAllByIndex('debts', 'customerId', id)).length;
}

export const deleteCustomer = (id) => db.del('customers', id);
