import { h, toast, messageDialog } from './dom.js';
import { getCustomer } from '../customers.js';
import { loadCustomerData } from '../debts.js';
import { applyPayment } from '../payments.js';
import { allocatePayment } from '../allocation.js';
import { parseDinars, formatMillimes, toInputString } from '../money.js';
import { formatDate } from '../dates.js';

export async function renderPayment(root, customerId) {
  const customer = await getCustomer(customerId);
  if (!customer) { location.hash = '#/'; return; }
  const { debts } = await loadCustomerData(customerId);
  const open = debts.filter(d => d.remaining > 0);
  const byId = new Map(open.map(d => [d.id, d]));
  const remaining = open.reduce((s, d) => s + d.remaining, 0);

  const header = [
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, 'تسديد مبلغ'),
    h('p', { class: 'dim' }, customer.name + (customer.note ? ' — ' + customer.note : '')),
  ];

  if (!open.length) {
    root.replaceChildren(...header, h('div', { class: 'card empty' }, 'لا ديون مفتوحة على هذا الزبون.'));
    return;
  }

  const amountInput = h('input', { class: 'input big-input', inputmode: 'decimal', placeholder: 'المبلغ بالدينار، مثال: 12.5' });
  const preview = h('div', null);
  const confirmBtn = h('button', { class: 'btn savebtn' }, 'تأكيد التسديد');
  confirmBtn.disabled = true;
  let current = null;   // { res, received }
  let selected = 0;

  function line(it) {
    const d = byId.get(it.debtId);
    const dim = d ? `${d.qty} × ${formatMillimes(d.unitPrice)} • ${formatDate(d.date)}` : '';
    return h('div', { class: 'pay-line' },
      h('div', null,
        h('div', { class: 'item-name' }, d ? d.nameSnapshot : '؟'),
        h('div', { class: 'dim small' }, dim)),
      it.full
        ? h('span', { class: 'badge paid' }, 'كاملًا ' + formatMillimes(it.pay))
        : h('span', { class: 'badge partial' }, 'جزئيًا ' + formatMillimes(it.pay) + ' • يبقى ' + formatMillimes(d.remaining - it.pay)));
  }

  function drawOptions() {
    preview.replaceChildren();
    const { res, received } = current;
    const many = res.options.length > 1;
    const exact = res.options[0].items.every(i => i.full);
    preview.append(h('p', { class: 'dim' },
      exact && res.change === 0
        ? (many ? 'وُجدت ' + res.options.length + ' تركيبات تطابق المبلغ تمامًا. اختر واحدة:' : 'تركيبة تطابق المبلغ تمامًا:')
        : res.change > 0
          ? 'المبلغ يغطي كل الديون المفتوحة:'
          : (many ? 'لا تركيبة تطابق المبلغ تمامًا. الباقي يُدفع جزئيًا على بند. اختر خطة:' : 'لا تركيبة تطابق المبلغ تمامًا. الباقي يُدفع جزئيًا على بند:')));
    res.options.forEach((opt, i) => {
      preview.append(h('div', { class: 'card opt' + (i === selected ? ' on' : ''), onClick: () => { selected = i; drawOptions(); } },
        opt.items.map(line)));
    });
    if (res.change > 0) {
      preview.append(h('div', { class: 'card alt' },
        h('div', { class: 'dim' }, 'الباقي للزبون'),
        h('div', { class: 'big' }, formatMillimes(res.change))));
    }
    confirmBtn.disabled = false;
  }

  function recompute() {
    preview.replaceChildren();
    confirmBtn.disabled = true;
    current = null;
    if (!amountInput.value.trim()) return;
    const m = parseDinars(amountInput.value);
    if (m === null || m <= 0) {
      preview.append(h('p', { class: 'err' }, 'أدخل مبلغًا صحيحًا، مثال: 12.5'));
      return;
    }
    const res = allocatePayment(open.map(d => ({ id: d.id, remaining: d.remaining, date: d.date })), m);
    if (!res.options.length) return;
    current = { res, received: m };
    selected = 0;
    drawOptions();
  }

  amountInput.addEventListener('input', recompute);

  confirmBtn.addEventListener('click', async () => {
    if (!current) return;
    confirmBtn.disabled = true;
    const opt = current.res.options[selected];
    try {
      await applyPayment({ customerId, items: opt.items.map(i => ({ debtId: i.debtId, pay: i.pay })), received: current.received });
    } catch (e) {
      await messageDialog(e.message || 'تعذّر التسديد');
      confirmBtn.disabled = false;
      return;
    }
    toast('تم التسديد');
    history.back();
  });

  root.replaceChildren(
    ...header,
    h('div', { class: 'card alt' },
      h('div', { class: 'dim' }, 'المتبقي على الزبون'),
      h('div', { class: 'big' }, formatMillimes(remaining))),
    amountInput,
    h('button', { class: 'btn ghost', onClick: () => { amountInput.value = toInputString(remaining); recompute(); } }, 'تسديد كل المتبقي'),
    preview,
    h('div', { class: 'savebar' },
      h('div', { class: 'dim small' }, 'اختر ثم أكّد'),
      confirmBtn));
  setTimeout(() => amountInput.focus(), 50);
}
