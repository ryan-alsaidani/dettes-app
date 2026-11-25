import { h, toast, customerForm } from './dom.js';
import { listCustomersWithTotals, saveCustomer } from '../customers.js';
import { matches } from '../search.js';
import { formatMillimes } from '../money.js';

export async function renderHome(root) {
  let all = await listCustomersWithTotals();
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
    search, addBtn, count, list);
  draw();
}
