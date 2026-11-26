import { h, toast, itemForm, field } from './dom.js';
import * as P from '../products.js';
import { getCustomer } from '../customers.js';
import { createOrder } from '../debts.js';
import { matches } from '../search.js';
import { formatMillimes } from '../money.js';
import { todayISO } from '../dates.js';
import { scanBarcode } from '../bridge.js';
import { productForm } from './product.js';
import { licenseActive } from './licensecard.js';

// مسودة كل زبون تبقى طوال الجلسة، فلا يضيع ما أُدخل إن خرج مؤقتًا.
const drafts = new Map();

export async function renderNewDebt(root, customerId) {
  const customer = await getCustomer(customerId);
  if (!customer) { location.hash = '#/'; return; }
  const products = await P.listProducts();
  products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const hay = new WeakMap();
  const hayOf = (p) => { let v = hay.get(p); if (v === undefined) { v = P.productHaystack(p); hay.set(p, v); } return v; };

  let draft = drafts.get(customerId);
  if (!draft) { draft = { items: [], date: todayISO(), note: '' }; drafts.set(customerId, draft); }

  const search = h('input', { class: 'input grow', type: 'search', placeholder: 'ابحث عن منتج، أو اكتب/امسح الباركود...' });
  const results = h('div', null);
  const cart = h('div', null);
  const totalEl = h('div', { class: 'item-name' });
  const saveBtn = h('button', { class: 'btn savebtn' }, 'حفظ الدين');

  function addProduct(p) {
    const ex = draft.items.find(it => it.productId === p.id);
    if (ex) ex.qty++;
    else draft.items.push({ productId: p.id, name: p.name, unitPrice: p.price, qty: 1 });
    drawCart();
    toast('أُضيف: ' + p.name);
  }

  async function handleUnknownCode(code) {
    toast('باركود غير معروف: ' + code);
    if (!licenseActive()) { toast('أضفه كبند حر (اسم وسعر)'); return; } // إضافة منتج جديد تحتاج اشتراكًا فعّالًا
    const res = await productForm({ barcode: code }, await P.listBrands());
    if (res && res.id) {
      const np = await P.getProduct(res.id);
      if (np) { products.push(np); addProduct(np); }
    }
  }

  async function handleCode(code) {
    const c = String(code || '').trim();
    if (!c) return;
    const found = await P.findByBarcode(c);
    if (found) addProduct(found); else await handleUnknownCode(c);
  }

  async function freeItem(prefill = '') {
    const v = await itemForm({ name: prefill }, 'بند حر');
    if (!v) return;
    draft.items.push({ productId: null, name: v.name, unitPrice: v.unitPrice, qty: v.qty });
    drawCart();
  }

  async function editItem(i) {
    const it = draft.items[i];
    const v = await itemForm({ name: it.name, unitPrice: it.unitPrice, qty: it.qty }, 'تعديل البند');
    if (!v) return;
    Object.assign(it, { name: v.name, unitPrice: v.unitPrice, qty: v.qty });
    drawCart();
  }

  function drawResults() {
    const q = search.value.trim();
    results.replaceChildren();
    if (!q) return;
    const found = products.filter(p => matches(q, hayOf(p))).slice(0, 8);
    for (const p of found) {
      results.append(h('div', { class: 'card item', onClick: () => { addProduct(p); search.value = ''; drawResults(); search.focus(); } },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-name' }, p.name),
          (p.brand || p.barcode) ? h('div', { class: 'dim small' }, [p.brand, p.barcode].filter(Boolean).join(' • ')) : null),
        h('span', { class: 'badge' }, formatMillimes(p.price))));
    }
    if (!found.length) {
      results.append(h('div', { class: 'card item', onClick: () => { const q2 = q; search.value = ''; drawResults(); freeItem(q2); } },
        h('div', { class: 'item-main' }, 'لا نتائج — إضافة بند حر «' + q + '»')));
    }
  }

  const step = (label, fn) => h('button', { class: 'step', type: 'button', onClick: fn }, label);

  function drawCart() {
    cart.replaceChildren();
    if (!draft.items.length) {
      cart.append(h('div', { class: 'card empty' }, 'لم تُضف بنودًا بعد. ابحث عن منتج، أو امسح باركودًا، أو أضف بندًا حرًّا.'));
    }
    draft.items.forEach((it, i) => {
      cart.append(h('div', { class: 'card' },
        h('div', { class: 'debt-top' },
          h('div', { class: 'item-name' }, it.name),
          h('button', { class: 'x', type: 'button', onClick: () => { draft.items.splice(i, 1); drawCart(); } }, '×')),
        h('div', { class: 'debt-top' },
          h('div', { class: 'stepper' },
            step('−', () => { if (it.qty > 1) { it.qty--; drawCart(); } }),
            h('span', { class: 'qty' }, String(it.qty)),
            step('+', () => { it.qty++; drawCart(); })),
          h('div', null,
            h('div', { class: 'dim small' }, formatMillimes(it.unitPrice) + ' للوحدة'),
            h('div', { class: 'item-name' }, formatMillimes(it.unitPrice * it.qty)))),
        h('button', { class: 'link', type: 'button', onClick: () => editItem(i) }, 'تعديل الاسم/السعر')));
    });
    const total = draft.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    totalEl.textContent = formatMillimes(total);
    saveBtn.disabled = !draft.items.length;
  }

  search.addEventListener('input', drawResults);
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = search.value.trim();
    if (/^\d{4,}$/.test(q)) { search.value = ''; drawResults(); handleCode(q); } // قارئ USB/بلوتوث
  });

  const scanBtn = h('button', { class: 'btn ghost inline', type: 'button', onClick: async () => {
    try { const code = await scanBarcode(); if (code) await handleCode(code); }
    catch (e) { toast('الماسح غير متاح هنا'); }
  } }, 'مسح');

  const dateInput = h('input', { class: 'input', type: 'date', value: draft.date });
  dateInput.addEventListener('change', () => { draft.date = dateInput.value || todayISO(); });
  const noteInput = h('input', { class: 'input', placeholder: 'اختياري', value: draft.note });
  noteInput.addEventListener('input', () => { draft.note = noteInput.value; });

  saveBtn.addEventListener('click', async () => {
    if (!draft.items.length) return;
    saveBtn.disabled = true;
    try {
      await createOrder({
        customerId, date: draft.date || todayISO(), note: draft.note,
        items: draft.items.map(it => ({ productId: it.productId, nameSnapshot: it.name, unitPrice: it.unitPrice, qty: it.qty })),
      });
    } catch (e) {
      toast(e.message || 'تعذّر الحفظ');
      saveBtn.disabled = false;
      return;
    }
    drafts.delete(customerId);
    toast('تم تسجيل الدين');
    history.back();
  });

  root.replaceChildren(
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, 'دين جديد'),
    h('p', { class: 'dim' }, customer.name + (customer.note ? ' — ' + customer.note : '')),
    h('div', { class: 'row-inline' }, search, scanBtn),
    results,
    h('button', { class: 'btn ghost', onClick: () => freeItem() }, '+ بند حر (اسم وسعر)'),
    cart,
    h('div', { class: 'card alt' },
      field('تاريخ الدين', dateInput),
      field('ملاحظة (اختياري)', noteInput)),
    h('div', { class: 'savebar' },
      h('div', null, h('div', { class: 'dim small' }, 'المجموع'), totalEl),
      saveBtn));
  drawCart();
}
