import { h, toast, confirmDialog, messageDialog, customerForm } from './dom.js';
import { getCustomer, saveCustomer, deleteCustomer, customerDebtCount } from '../customers.js';
import * as db from '../db.js';
import { formatMillimes } from '../money.js';

export async function renderCustomer(root, id) {
  const c = await getCustomer(id);
  if (!c) { location.hash = '#/'; return; }
  const debts = await db.getAllByIndex('debts', 'customerId', id);
  const remaining = debts.reduce((s, d) => s + (d.remaining || 0), 0);

  root.replaceChildren(
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, c.name),
    h('div', { class: 'card alt' },
      c.phone ? h('p', { class: 'dim' }, 'الهاتف: ' + c.phone) : null,
      c.note ? h('p', { class: 'dim' }, c.note) : null,
      h('p', { class: 'dim' }, 'المتبقي على الزبون'),
      h('div', { class: 'big' }, formatMillimes(remaining))),
    h('div', { class: 'card empty' }, 'تسجيل الديون وعرضها يأتي في المرحلة 3.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onClick: async () => {
        const v = await customerForm(c);
        if (!v) return;
        await saveCustomer({ ...v, id });
        toast('تم الحفظ');
        renderCustomer(root, id);
      } }, 'تعديل'),
      h('button', { class: 'btn danger', onClick: async () => {
        if (await customerDebtCount(id)) {
          await messageDialog('لا يمكن حذف زبون لديه ديون مسجَّلة.');
          return;
        }
        if (await confirmDialog('حذف الزبون «' + c.name + '» نهائيًا؟', 'حذف', true)) {
          await deleteCustomer(id);
          location.hash = '#/';
        }
      } }, 'حذف')));
}
