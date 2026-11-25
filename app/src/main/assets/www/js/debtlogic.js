// منطق نقي (بلا قاعدة بيانات) لعرض الديون: الحالة، الفلاتر، الترتيب، التجميع، البحث.
import { normalize } from './search.js';
import { formatDate } from './dates.js';
import { toInputString } from './money.js';

export const STATUS_LABEL = { unpaid: 'غير مسدَّد', partial: 'مسدَّد جزئيًا', paid: 'مسدَّد' };

export const totalOf = (d) => d.unitPrice * d.qty;

export function statusOf(d) {
  if (d.remaining <= 0) return 'paid';
  if (d.paid <= 0) return 'unpaid';
  return 'partial';
}

export function summarize(debts) {
  let total = 0, paid = 0, remaining = 0, open = 0;
  for (const d of debts) {
    total += totalOf(d);
    paid += d.paid || 0;
    remaining += d.remaining || 0;
    if (d.remaining > 0) open++;
  }
  return { total, paid, remaining, open };
}

/** filter: 'all' | 'unpaid' (ما بقي منه شيء، يشمل الجزئي) | 'paid' */
export function filterByStatus(debts, filter) {
  if (filter === 'unpaid') return debts.filter(d => d.remaining > 0);
  if (filter === 'paid') return debts.filter(d => d.remaining <= 0);
  return debts.slice();
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);
const byDateAsc = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

/** mode: 'newest' | 'oldest' | 'highest' (الأعلى ثمنًا). */
export function sortDebts(debts, mode) {
  const arr = debts.slice();
  if (mode === 'oldest') return arr.sort(byDateAsc);
  if (mode === 'highest') return arr.sort((a, b) => totalOf(b) - totalOf(a) || byDateDesc(a, b));
  return arr.sort(byDateDesc);
}

/** تجميع حسب الفاتورة. orders: Map(id → order). يعيد [{order, items, total, remaining}]. */
export function groupByOrder(debts, orders, mode) {
  const groups = new Map();
  for (const d of debts) {
    let g = groups.get(d.orderId);
    if (!g) {
      const order = orders.get(d.orderId) || { id: d.orderId, date: d.date, note: null };
      g = { order, items: [], total: 0, remaining: 0 };
      groups.set(d.orderId, g);
    }
    g.items.push(d);
    g.total += totalOf(d);
    g.remaining += d.remaining || 0;
  }
  const arr = [...groups.values()];
  for (const g of arr) g.items.sort((a, b) => a.id - b.id);
  const key = (g) => g.order;
  if (mode === 'oldest') arr.sort((a, b) => byDateAsc(key(a), key(b)));
  else if (mode === 'highest') arr.sort((a, b) => b.total - a.total || byDateDesc(key(a), key(b)));
  else arr.sort((a, b) => byDateDesc(key(a), key(b)));
  return arr;
}

/** نص البحث الموحَّد لدين: اسم البند، ملاحظة الفاتورة، التاريخ، الكمية، السعر والإجمالي. */
export function debtHaystack(d, order) {
  return normalize([
    d.nameSnapshot,
    order && order.note,
    formatDate(d.date), d.date,
    String(d.qty),
    toInputString(d.unitPrice),
    toInputString(totalOf(d)),
  ].filter(Boolean).join(' '));
}
