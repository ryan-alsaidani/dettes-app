import { h, toast, customerForm, fill, field } from './dom.js';
import { listCustomersWithTotals, saveCustomer } from '../customers.js';
import { listAllDebts } from '../debts.js';
import { summarize, rangeBounds, filterByDateRange, addMonthsISO } from '../debtlogic.js';
import { todayISO, formatDate } from '../dates.js';
import { getAlerts } from '../devstate.js';
import { matches } from '../search.js';
import { formatMillimes } from '../money.js';
import { getSetting, setSetting } from '../settings.js';
import { daysSince } from '../backup.js';
import { needActive, licenseCard } from './licensecard.js';

export async function renderHome(root) {
  let all = await listCustomersWithTotals();
  const allDebts = await listAllDebts();
  const alertCount = getAlerts().length;
  const lastBackup = await getSetting('lastBackupAt', 0);
  const snoozeUntil = await getSetting('backupSnoozeUntil', 0);
  const staleDays = daysSince(lastBackup);
  const showReminder = all.length > 0 && Date.now() > snoozeUntil && (staleDays === null || staleDays >= 7);
  const reminder = showReminder ? h('div', { class: 'card remind' },
    h('div', { class: 'item-name' }, 'احفظ نسخة احتياطية'),
    h('p', { class: 'dim small' }, staleDays === null
      ? 'لم تحفظ أي نسخة بعد. إن مُسحت بيانات التطبيق ضاع كل شيء.'
      : 'مضى ' + staleDays + ' يومًا على آخر نسخة احتياطية.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onClick: () => { location.hash = '#/settings'; } }, 'حفظ الآن'),
      h('button', { class: 'btn ghost', onClick: async () => {
        await setSetting('backupSnoozeUntil', Date.now() + 86400000);
        reminder.remove();
      } }, 'لاحقًا'))) : null;
  // ---------- بطاقة المعاملات مع نطاق التاريخ ----------
  const RANGES = [['all', 'الكل'], ['m1', 'آخر شهر'], ['m2', 'آخر شهرين'], ['custom', 'من تاريخ إلى تاريخ']];
  const loadRange = () => {
    try {
      const r = JSON.parse(localStorage.getItem('statsRange') || 'null');
      if (r && RANGES.some(([k]) => k === r.key)) return { key: r.key, from: r.from || '', to: r.to || '' };
    } catch (e) { /* افتراضي */ }
    return { key: 'all', from: '', to: '' };
  };
  const range = loadRange();
  const saveRange = () => { try { localStorage.setItem('statsRange', JSON.stringify(range)); } catch (e) { /* اختياري */ } };

  const tile = (label, value, cls, wide) => h('div', { class: 'tile' + (wide ? ' wide' : '') },
    h('div', { class: 'tile-lbl' }, label),
    h('div', { class: 'tile-val' + (cls ? ' ' + cls : '') }, formatMillimes(value)));
  const rangeChips = h('div', { class: 'chips seg' });
  const fromInput = h('input', { class: 'input', type: 'date', value: range.from });
  const toInput = h('input', { class: 'input', type: 'date', value: range.to });
  const customRow = h('div', { class: 'range-row' }, field('من', fromInput), field('إلى', toInput));
  const grid = h('div', { class: 'stats-grid' });
  const caption = h('p', { class: 'dim small' });

  function drawStats() {
    fill(rangeChips, RANGES.map(([k, label]) =>
      h('button', { class: 'chip' + (range.key === k ? ' on' : ''), type: 'button', onClick: () => {
        range.key = k;
        if (k === 'custom' && !range.from) { range.from = addMonthsISO(todayISO(), -1); fromInput.value = range.from; }
        saveRange();
        drawStats();
      } }, label)));
    customRow.hidden = range.key !== 'custom';
    const b = rangeBounds(range.key, todayISO(), range.from, range.to);
    const rows = filterByDateRange(allDebts, b.from, b.to);
    const st = summarize(rows);
    fill(grid,
      tile('إجمالي ما تم تسديده', st.paid, 'ok'),
      tile('إجمالي غير المسدَّد', st.remaining, 'warn'),
      tile('مجموع المسدَّد مع غير المسدَّد', st.total, '', true));
    const span = !b.from && !b.to ? 'كل الديون المسجَّلة'
      : b.from && b.to ? 'الديون المسجَّلة من ' + formatDate(b.from) + ' إلى ' + formatDate(b.to)
      : b.from ? 'الديون المسجَّلة من ' + formatDate(b.from) + ' حتى اليوم'
      : 'الديون المسجَّلة حتى ' + formatDate(b.to);
    caption.textContent = span + ' (' + rows.length + ' بند)';
  }
  fromInput.addEventListener('change', () => { range.from = fromInput.value; saveRange(); drawStats(); });
  toInput.addEventListener('change', () => { range.to = toInput.value; saveRange(); drawStats(); });

  const statsCard = all.length ? h('div', { class: 'card' },
    h('h2', { class: 'stats-title' }, 'المعاملات المتأتية من توفير خدمة الدفع المؤجل'),
    rangeChips, customRow, grid, caption) : null;
  if (statsCard) drawStats();
  const list = h('div', { class: 'list' });
  const count = h('p', { class: 'dim small' });
  const search = h('input', { class: 'input', type: 'search',
    placeholder: 'ابحث: اسم، هاتف، وصف، أو ما اشتراه...' });

  function draw() {
    const shown = all.filter(c => matches(search.value, c.hay));
    list.replaceChildren();
    count.textContent = all.length ? `${shown.length} من ${all.length} زبون` : '';
    if (!all.length) {
      list.append(h('div', { class: 'card empty' }, 'لا يوجد زبائن بعد. اضغط «زبون جديد» للبدء.'));
      return;
    }
    if (!shown.length) {
      list.append(h('div', { class: 'card empty' }, 'لا نتائج لهذا البحث.'));
      return;
    }
    for (const c of shown) {
      list.append(h('a', { class: 'card item', href: '#/customer/' + c.id },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-name' }, c.name),
          c.note ? h('div', { class: 'dim small clamp2' }, c.note) : null,
          c.phone ? h('div', { class: 'dim small' }, c.phone) : null,
          c.open ? h('div', { class: 'dim small' }, c.open + (c.open === 1 ? ' دين مفتوح' : ' ديون مفتوحة')) : null),
        h('span', { class: 'badge ' + (c.remaining > 0 ? 'warn' : 'ok') }, formatMillimes(c.remaining))));
    }
  }

  search.addEventListener('input', draw);

  const addBtn = h('button', { class: 'btn', onClick: async () => {
    if (!(await needActive())) return;
    const v = await customerForm({}, all);
    if (!v) return;
    await saveCustomer(v);
    all = await listCustomersWithTotals();
    search.value = '';
    draw();
    toast('تمت إضافة الزبون');
  } }, '+ زبون جديد');

  fill(root, 
    h('h1', { class: 'title' }, 'الزبائن'),
    licenseCard(),
    reminder,
    alertCount ? h('div', { class: 'card alertcard' },
      h('div', { class: 'item-name' }, 'لديك ' + alertCount + (alertCount === 1 ? ' تنبيه' : ' تنبيهات') + ' من التحديثات'),
      h('button', { class: 'btn mini', onClick: () => { location.hash = '#/sync'; } }, 'عرض التنبيهات')) : null,
    h('button', { class: 'btn cartbtn', onClick: () => { location.hash = '#/cart'; } }, '🛒 سلة جديدة (مسح المنتجات)'),
    statsCard,
    search, addBtn, count, list);
  draw();
}
