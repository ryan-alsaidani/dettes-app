import { h, toast, customerForm } from './dom.js';
import { listCustomersWithTotals, saveCustomer } from '../customers.js';
import { matches } from '../search.js';
import { formatMillimes } from '../money.js';
import { getSetting, setSetting } from '../settings.js';
import { daysSince } from '../backup.js';
import { needActive, licenseCard } from './licensecard.js';

export async function renderHome(root) {
  let all = await listCustomersWithTotals();
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

  root.replaceChildren(
    h('h1', { class: 'title' }, 'الزبائن'),
    licenseCard(),
    reminder,
    search, addBtn, count, list);
  draw();
}
