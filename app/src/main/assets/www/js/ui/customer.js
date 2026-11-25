import { h, toast, confirmDialog, messageDialog, customerForm, itemForm, sheet } from './dom.js';
import { getCustomer, saveCustomer, deleteCustomer, customerDebtCount, listCustomerNames } from '../customers.js';
import { loadCustomerData, markPaid, updateDebt, deleteDebt } from '../debts.js';
import { getLastPayment, undoPayment } from '../payments.js';
import { statusOf, STATUS_LABEL, totalOf, summarize, filterByStatus, sortDebts, groupByOrder, debtHaystack } from '../debtlogic.js';
import { matches } from '../search.js';
import { formatMillimes } from '../money.js';
import { formatDate } from '../dates.js';

const FILTERS = [['unpaid', 'غير المدفوع'], ['paid', 'المدفوع'], ['all', 'الكل']];
const SORTS = [['newest', 'الأحدث'], ['oldest', 'الأقدم'], ['highest', 'الأعلى ثمنًا']];
const VIEWS = [['grouped', 'حسب الفاتورة'], ['flat', 'كل البنود']];

// تفضيلات العرض تبقى طوال الجلسة.
const view = { filter: 'unpaid', sort: 'newest', mode: 'grouped' };

function segmented(options, current, onPick) {
  return h('div', { class: 'chips seg' }, options.map(([key, label]) =>
    h('button', { class: 'chip' + (key === current ? ' on' : ''), type: 'button', onClick: () => onPick(key) }, label)));
}

export async function renderCustomer(root, id) {
  const customer = await getCustomer(id);
  if (!customer) { location.hash = '#/'; return; }
  const { debts, orders } = await loadCustomerData(id);
  const sum = summarize(debts);
  const last = await getLastPayment(id);
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث في الديون: بند، ملاحظة، تاريخ، مبلغ...' });
  const controls = h('div', null);
  const list = h('div', { class: 'list' });

  const reload = () => renderCustomer(root, id);

  async function undoLast() {
    if (await confirmDialog('التراجع عن دفعة ' + formatMillimes(last.amount) + ' (' + formatDate(last.date) + ')؟ سيعود المتبقي على الديون التي سُدِّدت بها.', 'تراجع', true)) {
      await undoPayment(last.id);
      toast('تم التراجع عن الدفعة');
      reload();
    }
  }

  async function payFull(d) {
    const what = d.paid > 0 ? 'الباقي ' + formatMillimes(d.remaining) : formatMillimes(d.remaining);
    if (await confirmDialog('تأكيد دفع ' + what + ' عن «' + d.nameSnapshot + '»؟', 'تم الدفع')) {
      await markPaid(d.id);
      toast('تم تسجيل الدفع');
      reload();
    }
  }

  function debtActions(d) {
    const s = sheet([
      h('h2', { class: 'sheet-title' }, d.nameSnapshot),
      h('p', { class: 'dim' }, `${d.qty} × ${formatMillimes(d.unitPrice)} = ${formatMillimes(totalOf(d))} • ${formatDate(d.date)}`),
      d.remaining > 0 ? h('button', { class: 'btn ok', onClick: () => { s.close(); payFull(d); } }, 'تم دفع الثمن') : null,
      h('button', { class: 'btn', onClick: async () => {
        s.close();
        const v = await itemForm({ name: d.nameSnapshot, unitPrice: d.unitPrice, qty: d.qty }, 'تعديل الدين');
        if (!v) return;
        try { await updateDebt(d.id, v); } catch (e) { await messageDialog(e.message); return; }
        toast('تم التعديل'); reload();
      } }, 'تعديل'),
      h('button', { class: 'btn danger', onClick: async () => {
        s.close();
        const warn = d.paid > 0 ? ' (دُفع منه ' + formatMillimes(d.paid) + ')' : '';
        if (await confirmDialog('حذف «' + d.nameSnapshot + '» نهائيًا' + warn + '؟', 'حذف', true)) {
          await deleteDebt(d.id); toast('تم الحذف'); reload();
        }
      } }, 'حذف'),
      h('button', { class: 'btn ghost', onClick: () => s.close() }, 'إغلاق'),
    ]);
  }

  function debtCard(d) {
    const st = statusOf(d);
    return h('div', { class: 'card debt ' + st, onClick: () => debtActions(d) },
      h('div', { class: 'debt-top' },
        h('div', { class: 'item-name' }, d.nameSnapshot),
        h('span', { class: 'badge ' + st }, STATUS_LABEL[st])),
      h('div', { class: 'dim small' }, `${d.qty} × ${formatMillimes(d.unitPrice)} = ${formatMillimes(totalOf(d))} • ${formatDate(d.date)}`),
      st === 'partial' ? h('div', { class: 'partial-note' }, `تم دفع ${formatMillimes(d.paid)}، بقي ${formatMillimes(d.remaining)}`) : null,
      st !== 'paid' ? h('button', { class: 'btn small-btn', onClick: (e) => { e.stopPropagation(); payFull(d); } }, 'تم دفع الثمن') : null);
  }

  function drawControls() {
    controls.replaceChildren(
      segmented(FILTERS, view.filter, k => { view.filter = k; drawControls(); drawList(); }),
      segmented(SORTS, view.sort, k => { view.sort = k; drawControls(); drawList(); }),
      segmented(VIEWS, view.mode, k => { view.mode = k; drawControls(); drawList(); }));
  }

  function drawList() {
    list.replaceChildren();
    if (!debts.length) {
      list.append(h('div', { class: 'card empty' }, 'لا ديون مسجَّلة بعد. اضغط «+ تسجيل دين».'));
      return;
    }
    const items = filterByStatus(debts, view.filter)
      .filter(d => matches(search.value, debtHaystack(d, orders.get(d.orderId))));
    if (!items.length) {
      list.append(h('div', { class: 'card empty' }, 'لا بنود مطابقة.'));
      return;
    }
    if (view.mode === 'flat') {
      sortDebts(items, view.sort).forEach(d => list.append(debtCard(d)));
      return;
    }
    for (const g of groupByOrder(items, orders, view.sort)) {
      list.append(h('div', { class: 'group-head' },
        h('div', null,
          h('div', { class: 'item-name' }, formatDate(g.order.date)),
          g.order.note ? h('div', { class: 'dim small' }, g.order.note) : null),
        h('div', { class: 'dim small' }, 'الإجمالي ' + formatMillimes(g.total) + ' • المتبقي ' + formatMillimes(g.remaining))));
      g.items.forEach(d => list.append(debtCard(d)));
    }
  }

  search.addEventListener('input', drawList);

  root.replaceChildren(
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, customer.name),
    h('div', { class: 'card alt' },
      customer.note ? h('p', { class: 'dim' }, customer.note) : null,
      customer.phone ? h('p', { class: 'dim' }, 'الهاتف: ' + customer.phone) : null,
      h('p', { class: 'dim' }, 'المجموع المتبقي'),
      h('div', { class: 'big' }, formatMillimes(sum.remaining)),
      debts.length ? h('p', { class: 'dim small' },
        `${sum.open} ديون مفتوحة • الإجمالي ${formatMillimes(sum.total)} • المدفوع ${formatMillimes(sum.paid)}`) : null),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn', onClick: () => { location.hash = '#/debt/' + id; } }, '+ تسجيل دين'),
      h('button', { class: 'btn ok', onClick: () => { location.hash = '#/pay/' + id; } }, 'تسديد مبلغ')),
    last ? h('div', { class: 'card' },
      h('div', { class: 'debt-top' },
        h('div', null,
          h('div', { class: 'item-name' }, 'آخر دفعة: ' + formatMillimes(last.amount)),
          h('div', { class: 'dim small' }, formatDate(last.date) + (last.change ? ' • أُرجع للزبون ' + formatMillimes(last.change) : ''))),
        h('button', { class: 'btn ghost inline', onClick: undoLast }, 'تراجع'))) : null,
    search, controls, list,
    h('div', { class: 'btn-row spaced' },
      h('button', { class: 'btn ghost', onClick: async () => {
        const v = await customerForm(customer, await listCustomerNames());
        if (!v) return;
        await saveCustomer({ ...v, id });
        toast('تم الحفظ'); reload();
      } }, 'تعديل الزبون'),
      h('button', { class: 'btn ghost', onClick: async () => {
        if (await customerDebtCount(id)) { await messageDialog('لا يمكن حذف زبون لديه ديون مسجَّلة.'); return; }
        if (await confirmDialog('حذف الزبون «' + customer.name + '» نهائيًا؟', 'حذف', true)) {
          await deleteCustomer(id);
          location.hash = '#/';
        }
      } }, 'حذف الزبون')));

  drawControls();
  drawList();
}
