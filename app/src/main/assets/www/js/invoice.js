// بناء صفحة HTML لكشف الحساب/الفاتورة (نقية: بلا قاعدة بيانات). تُطبع عبر الغلاف الأصلي.
import { formatMillimes } from './money.js';
import { formatDate, todayISO } from './dates.js';
import { totalOf, summarize } from './debtlogic.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const FONT_URL = 'https://appassets.androidplatform.net/assets/www/fonts/Cairo.ttf';

const CSS = `
@font-face { font-family: "Cairo"; src: url("${FONT_URL}") format("truetype"); font-weight: 200 1000; }
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { font-family: "Cairo", "Noto Naskh Arabic", "Droid Arabic Naskh", sans-serif; color: #111; background: #fff; font-size: 13px; line-height: 1.7; margin: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #333; padding-bottom: 10px; margin-bottom: 14px; }
.shop { font-size: 22px; font-weight: 700; }
.doc { text-align: left; font-size: 18px; font-weight: 700; }
.muted { color: #555; font-size: 12px; }
.cust { border: 1px solid #999; border-radius: 10px; padding: 8px 12px; margin-bottom: 14px; }
.cust b { font-size: 16px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
th, td { border: 1px solid #999; padding: 5px 7px; text-align: right; vertical-align: top; }
th { background: #eee; font-size: 12px; }
td.n, th.n { text-align: left; white-space: nowrap; }
tr { page-break-inside: avoid; }
.note { color: #555; font-size: 11px; }
.paidrow td { color: #555; }
h3 { margin: 16px 0 6px; font-size: 15px; }
.sum { margin-inline-start: auto; width: 62%; }
.sum td { font-size: 13px; }
.sum tr.main td { font-size: 17px; font-weight: 700; background: #eee; }
.foot { margin-top: 18px; text-align: center; }
`;

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

/**
 * title: 'كشف حساب' | 'فاتورة'
 * shop: {name, phone}   customer: {name, phone, note}
 * debts: الديون المطلوب طباعتها   orders: Map(id → order)   payments: دفعات (اختياري)
 * overallRemaining: المتبقي الإجمالي على الزبون (يُعرض دائمًا)
 */
export function buildStatementHtml({ title = 'كشف حساب', shop = {}, customer, debts, orders = new Map(), payments = [], overallRemaining = 0, today = todayISO() }) {
  const rows = debts.slice().sort(byDate);
  const sum = summarize(rows);

  const body = rows.map(d => {
    const note = (orders.get(d.orderId) || {}).note;
    return `<tr class="${d.remaining <= 0 ? 'paidrow' : ''}">
      <td class="n">${esc(formatDate(d.date))}</td>
      <td>${esc(d.nameSnapshot)}${note ? `<div class="note">${esc(note)}</div>` : ''}</td>
      <td class="n">${esc(d.qty)}</td>
      <td class="n">${esc(formatMillimes(d.unitPrice))}</td>
      <td class="n">${esc(formatMillimes(totalOf(d)))}</td>
      <td class="n">${esc(formatMillimes(d.paid))}</td>
      <td class="n">${d.remaining > 0 ? esc(formatMillimes(d.remaining)) : 'مسدَّد'}</td>
    </tr>`;
  }).join('');

  const pays = payments.slice().sort(byDate);
  const paysHtml = pays.length ? `
    <h3>الدفعات</h3>
    <table>
      <tr><th>التاريخ</th><th class="n">المبلغ</th><th>ملاحظة</th></tr>
      ${pays.map(p => `<tr><td>${esc(formatDate(p.date))}</td><td class="n">${esc(formatMillimes(p.amount))}</td><td>${p.change ? 'أُرجع للزبون ' + esc(formatMillimes(p.change)) : ''}</td></tr>`).join('')}
    </table>` : '';

  const custLine = [customer.note, customer.phone ? 'الهاتف: ' + customer.phone : ''].filter(Boolean).map(esc).join(' • ');

  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>
  <div class="head">
    <div><div class="shop">${esc(shop.name || 'المكتبة')}</div>${shop.phone ? `<div class="muted">${esc(shop.phone)}</div>` : ''}</div>
    <div class="doc">${esc(title)}<div class="muted">${esc(formatDate(today))}</div></div>
  </div>
  <div class="cust"><b>${esc(customer.name)}</b>${custLine ? `<div class="muted">${custLine}</div>` : ''}</div>
  <table>
    <tr><th>التاريخ</th><th>البند</th><th class="n">الكمية</th><th class="n">سعر الوحدة</th><th class="n">الإجمالي</th><th class="n">المدفوع</th><th class="n">المتبقي</th></tr>
    ${body || '<tr><td colspan="7">لا بنود</td></tr>'}
  </table>
  <table class="sum">
    <tr><td>إجمالي البنود المعروضة</td><td class="n">${esc(formatMillimes(sum.total))}</td></tr>
    <tr><td>المدفوع منها</td><td class="n">${esc(formatMillimes(sum.paid))}</td></tr>
    <tr class="main"><td>المتبقي على الزبون</td><td class="n">${esc(formatMillimes(overallRemaining))}</td></tr>
  </table>
  ${paysHtml}
  <div class="foot muted">${esc(shop.name || 'المكتبة')}${shop.phone ? ' • ' + esc(shop.phone) : ''}</div>
</body></html>`;
}
