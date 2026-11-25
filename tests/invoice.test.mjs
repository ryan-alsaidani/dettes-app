import assert from 'node:assert/strict';
import { buildStatementHtml, esc } from '../app/src/main/assets/www/js/invoice.js';

assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
assert.equal(esc(null), '');

const D = (id, orderId, date, unitPrice, qty, paid, name) =>
  ({ id, orderId, date, unitPrice, qty, paid, remaining: unitPrice * qty - paid, nameSnapshot: name });
const debts = [
  D(2, 1, '2026-03-05', 1500, 2, 0, 'قلم <b>حبر</b>'),
  D(1, 1, '2026-03-05', 500, 1, 500, 'ممحاة'),
];
const html = buildStatementHtml({
  title: 'كشف حساب',
  shop: { name: 'مكتبة النور', phone: '71 000 000' },
  customer: { name: 'أحمد <script>', note: 'ابن الجيران', phone: '55 123 456' },
  debts, orders: new Map([[1, { id: 1, date: '2026-03-05', note: 'دخول مدرسي' }]]),
  payments: [{ id: 1, date: '2026-03-06', amount: 500, change: 250 }],
  overallRemaining: 3000, today: '2026-04-01',
});
assert.ok(html.includes('dir="rtl"'));
assert.ok(html.includes('مكتبة النور') && html.includes('71 000 000'));
assert.ok(html.includes('أحمد &lt;script&gt;') && !html.includes('<script>'));  // لا حقن
assert.ok(html.includes('قلم &lt;b&gt;حبر&lt;/b&gt;'));
assert.ok(html.includes('ابن الجيران') && html.includes('دخول مدرسي'));
assert.ok(html.includes('05/03/2026') && html.includes('01/04/2026'));
assert.ok(html.includes('3.000 د'));
assert.ok(html.includes('مسدَّد'));
assert.ok(html.includes('أُرجع للزبون 0.250 د'));
assert.ok(html.indexOf('ممحاة') < html.indexOf('قلم'));   // ترتيب بالتاريخ ثم المعرّف
assert.ok(buildStatementHtml({ customer: { name: 'س' }, debts: [], overallRemaining: 0 }).includes('المكتبة'));
console.log('invoice tests OK');
