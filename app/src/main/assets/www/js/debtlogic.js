// منطق نقي (بلا قاعدة بيانات) لعرض الديون: الحالة، الفلاتر، الترتيب، التجميع، البحث.
import { normalize } from './search.js';
import { formatDate } from './dates.js';
import { toInputString } from './money.js';
import { allocatePayment } from './allocation.js';

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

/**
 * تجميع حسب الفاتورة. orders: Map(id → order). يعيد [{order, items, total, remaining, maxItem}].
 * في وضع 'highest' تُرتَّب البنود داخل الفاتورة بالأغلى أولًا، وتُرتَّب الفواتير بأغلى بند فيها
 * (لا بمجموعها) حتى يظهر الأغلى ثمنًا في الأعلى فعلًا.
 */
export function groupByOrder(debts, orders, mode) {
  const groups = new Map();
  for (const d of debts) {
    let g = groups.get(d.orderId);
    if (!g) {
      const order = orders.get(d.orderId) || { id: d.orderId, date: d.date, note: null };
      g = { order, items: [], total: 0, remaining: 0, maxItem: 0 };
      groups.set(d.orderId, g);
    }
    g.items.push(d);
    g.total += totalOf(d);
    g.remaining += d.remaining || 0;
    g.maxItem = Math.max(g.maxItem, totalOf(d));
  }
  const arr = [...groups.values()];
  for (const g of arr) {
    g.items.sort(mode === 'highest' ? (a, b) => totalOf(b) - totalOf(a) || a.id - b.id : (a, b) => a.id - b.id);
  }
  const key = (g) => g.order;
  if (mode === 'oldest') arr.sort((a, b) => byDateAsc(key(a), key(b)));
  else if (mode === 'highest') arr.sort((a, b) => b.maxItem - a.maxItem || b.total - a.total || byDateDesc(key(a), key(b)));
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

/**
 * يوزّع مبلغًا مدفوعًا الآن على بنود سلة جديدة (بالخوارزمية الذكية نفسها: تركيبة مطابقة أولًا ثم جزئي).
 * items: [{unitPrice, qty}]  paidNow: مليم. يعيد {total, applied, change, pays[]} (pays بنفس ترتيب البنود).
 */
export function distributePaid(items, paidNow) {
  const lineTotals = items.map(it => it.unitPrice * it.qty);
  const total = lineTotals.reduce((a, b) => a + b, 0);
  const given = Math.max(0, paidNow || 0);
  const applied = Math.min(given, total);
  const pays = items.map(() => 0);
  if (applied > 0) {
    const res = allocatePayment(lineTotals.map((t, i) => ({ id: i + 1, remaining: t, date: '0' })), applied);
    for (const it of res.options[0].items) pays[it.debtId - 1] = it.pay;
  }
  return { total, applied, change: given - applied, pays };
}

// ---------- نطاق التاريخ لبطاقة الإحصاءات ----------

const pad2 = (n) => String(n).padStart(2, '0');

/** يضيف n شهرًا (سالبًا أو موجبًا) إلى تاريخ YYYY-MM-DD مع ضبط آخر يوم في الشهر (31 مارس - شهر = 28 فبراير). */
export function addMonthsISO(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const yy = Math.floor(total / 12);
  const mm = ((total % 12) + 12) % 12;
  const last = new Date(yy, mm + 1, 0).getDate();
  return `${yy}-${pad2(mm + 1)}-${pad2(Math.min(Number(m[3]), last))}`;
}

/** key: all | m1 (آخر شهر) | m2 (آخر شهرين) | custom (من..إلى، أيٌّ منهما اختياري). يعيد {from, to} (null = بلا حدّ). */
export function rangeBounds(key, today, from, to) {
  if (key === 'm1') return { from: addMonthsISO(today, -1), to: null };
  if (key === 'm2') return { from: addMonthsISO(today, -2), to: null };
  if (key === 'custom') {
    let f = from || null;
    let t = to || null;
    if (f && t && f > t) [f, t] = [t, f];
    return { from: f, to: t };
  }
  return { from: null, to: null };
}

/** الديون المسجَّلة (بتاريخ الدين) داخل النطاق، حدّاه شاملان. */
export function filterByDateRange(debts, from, to) {
  return debts.filter(d => (!from || d.date >= from) && (!to || d.date <= to));
}
