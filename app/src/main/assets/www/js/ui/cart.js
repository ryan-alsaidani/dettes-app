// السلة السريعة: جمع المنتجات بالكاميرا الحيّة أو البحث، ثم إنهاء السلة على زبون (دين / مدفوعة / دفعة جزئية).
import { h, toast, messageDialog, itemForm, customerForm, field, fill } from './dom.js';
import * as P from '../products.js';
import { listCustomersWithTotals, saveCustomer } from '../customers.js';
import { createOrder, loadCustomerData } from '../debts.js';
import { listPayments } from '../payments.js';
import { getSetting } from '../settings.js';
import { buildStatementHtml } from '../invoice.js';
import { matches } from '../search.js';
import { formatMillimes, parseDinars } from '../money.js';
import { todayISO } from '../dates.js';
import { hasLiveScan, liveScanStart, liveScanStop, liveScanTorch, liveScanResetLast, hasPrint, printHtml } from '../bridge.js';
import { needActive, licenseActive, licenseCard } from './licensecard.js';
import { productForm } from './product.js';

const newCart = () => ({ items: [], unknown: [], stage: 'collect', customerId: null, mode: 'debt', partial: '', date: todayISO(), note: '', last: '' });

// مسودة السلة تبقى طوال الجلسة (إن خرجتَ مؤقتًا لا يضيع ما جمعتَه) وتُفرَّغ عند الحفظ
let state = newCart();

const sumTotal = () => state.items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
const step = (label, fn) => h('button', { class: 'step', type: 'button', onClick: fn }, label);

export async function renderCart(root) {
  if (state.stage === 'checkout' && state.items.length) return renderCheckout(root);
  state.stage = 'collect';
  return renderCollect(root);
}

// ====================================================================== مرحلة الجمع

async function renderCollect(root) {
  const products = await P.listProducts();
  products.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const byCode = new Map();
  for (const p of products) if (p.barcode) byCode.set(String(p.barcode).trim(), p);
  const hay = new WeakMap();
  const hayOf = (p) => { let v = hay.get(p); if (v === undefined) { v = P.productHaystack(p); hay.set(p, v); } return v; };

  let camOn = false;
  let torchOn = false;
  const live = hasLiveScan();

  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث: اسم، علامة، باركود، وصف... (بدون كاميرا)' });
  const results = h('div', null);
  const unknownBox = h('div', null);
  const lastBox = h('div', { class: 'last-added' });
  const list = h('div', null);
  const camRow = h('div', { class: 'btn-row' });
  const totalEl = h('div', { class: 'item-name' });
  const finishBtn = h('button', { class: 'btn savebtn' }, 'إنهاء السلة ←');

  // ---------- إضافة ----------
  function addProduct(p) {
    const ex = state.items.find(i => i.productId === p.id);
    if (ex) ex.qty++;
    else state.items.push({ productId: p.id, name: p.name, unitPrice: p.price, qty: 1 });
    state.last = p.name;
    drawList();
  }

  function onCode(code) {
    const c = String(code || '').trim();
    if (!c) return;
    const p = byCode.get(c);
    if (p) { addProduct(p); return; }
    if (!state.unknown.includes(c)) state.unknown.push(c);
    toast('باركود غير معروف');
    drawUnknown();
  }

  // ---------- الكاميرا ----------
  function onState(st) {
    camOn = st === 'started';
    if (st === 'denied') toast('لم تُمنح صلاحية الكاميرا. استعمل البحث.');
    if (st !== 'started') torchOn = false;
    drawCam();
  }
  function startCam() { if (live) liveScanStart(onCode, onState); }
  function stopCam() { if (live) { liveScanStop(); camOn = false; torchOn = false; drawCam(); } }

  /** يوقف الكاميرا مؤقتًا أثناء نافذة تحتاج الكاميرا أو الانتباه ثم يعيدها. */
  async function withCameraPaused(fn) {
    const was = camOn;
    if (was) stopCam();
    try { return await fn(); } finally { if (was) startCam(); }
  }

  function drawCam() {
    camRow.replaceChildren();
    if (!live) return;
    camRow.append(h('button', { class: 'btn ghost mini', onClick: () => (camOn ? stopCam() : startCam()) }, camOn ? 'إغلاق الكاميرا' : 'تشغيل الكاميرا'));
    if (camOn) {
      camRow.append(h('button', { class: 'btn ghost mini', onClick: () => { torchOn = !torchOn; liveScanTorch(torchOn); drawCam(); } }, torchOn ? 'إطفاء الفلاش' : 'الفلاش'));
    }
  }

  // ---------- باركودات غير معروفة ----------
  async function newProductFor(code) {
    if (!(await needActive())) return;
    const res = await withCameraPaused(async () => productForm({ barcode: code }, await P.listBrands()));
    if (res && res.id) {
      const np = await P.getProduct(res.id);
      if (np) {
        products.push(np);
        byCode.set(code, np);
        state.unknown = state.unknown.filter(c => c !== code);
        drawUnknown();
        addProduct(np);
      }
    }
  }
  async function freeFor(code) {
    const v = await withCameraPaused(() => itemForm({ name: '' }, 'بند حر'));
    if (!v) return;
    state.items.push({ productId: null, name: v.name, unitPrice: v.unitPrice, qty: v.qty });
    state.unknown = state.unknown.filter(c => c !== code);
    state.last = v.name;
    drawUnknown();
    drawList();
  }
  function drawUnknown() {
    unknownBox.replaceChildren();
    for (const c of state.unknown) {
      unknownBox.append(h('div', { class: 'card unk' },
        h('div', { class: 'debt-top' },
          h('div', null, h('div', { class: 'item-name' }, 'باركود غير معروف'), h('div', { class: 'dim small codeln' }, c)),
          h('button', { class: 'x', type: 'button', onClick: () => { state.unknown = state.unknown.filter(x => x !== c); drawUnknown(); } }, '×')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn mini', onClick: () => newProductFor(c) }, 'منتج جديد'),
          h('button', { class: 'btn ghost mini', onClick: () => freeFor(c) }, 'بند حر'))));
    }
  }

  // ---------- البحث ----------
  function drawResults() {
    const q = search.value.trim();
    results.replaceChildren();
    if (!q) return;
    const found = products.filter(p => matches(q, hayOf(p))).slice(0, 6);
    for (const p of found) {
      results.append(h('div', { class: 'card item', onClick: () => { addProduct(p); search.value = ''; drawResults(); } },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-name' }, p.name),
          (p.brand || p.barcode) ? h('div', { class: 'dim small' }, [p.brand, p.barcode].filter(Boolean).join(' • ')) : null),
        h('span', { class: 'badge' }, formatMillimes(p.price))));
    }
    if (!found.length) {
      results.append(h('div', { class: 'card item', onClick: async () => {
        const name = q; search.value = ''; drawResults();
        const v = await withCameraPaused(() => itemForm({ name }, 'بند حر'));
        if (v) { state.items.push({ productId: null, name: v.name, unitPrice: v.unitPrice, qty: v.qty }); state.last = v.name; drawList(); }
      } }, h('div', { class: 'item-main' }, 'لا نتائج — إضافة بند حر «' + q + '»')));
    }
  }
  search.addEventListener('input', drawResults);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && /^\d{4,}$/.test(search.value.trim())) { const c = search.value.trim(); search.value = ''; drawResults(); onCode(c); } // قارئ USB/بلوتوث
  });

  // ---------- القائمة ----------
  function drawList() {
    list.replaceChildren();
    lastBox.textContent = state.last ? 'آخر ما أُضيف: ' + state.last : '';
    lastBox.hidden = !state.last;
    if (!state.items.length) {
      list.append(h('div', { class: 'card empty' }, 'السلة فارغة. امسح باركودًا أو ابحث عن منتج.'));
    }
    state.items.forEach((it, i) => {
      list.append(h('div', { class: 'card' },
        h('div', { class: 'debt-top' },
          h('div', { class: 'item-name' }, it.name),
          h('button', { class: 'x', type: 'button', onClick: () => { state.items.splice(i, 1); liveScanResetLast(); drawList(); } }, '×')),
        h('div', { class: 'debt-top' },
          h('div', { class: 'stepper' },
            step('−', () => { if (it.qty > 1) { it.qty--; drawList(); } }),
            h('span', { class: 'qty' }, String(it.qty)),
            step('+', () => { it.qty++; drawList(); })),
          h('div', null,
            h('div', { class: 'dim small' }, formatMillimes(it.unitPrice) + ' للوحدة'),
            h('div', { class: 'item-name' }, formatMillimes(it.unitPrice * it.qty))))));
    });
    totalEl.textContent = formatMillimes(sumTotal());
    finishBtn.disabled = !state.items.length;
  }

  finishBtn.addEventListener('click', () => {
    if (!state.items.length) return;
    stopCam();
    state.stage = 'checkout';
    renderCart(root);
  });

  fill(root, 
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, 'سلة جديدة'),
    camRow,
    lastBox,
    search, results,
    h('button', { class: 'btn ghost', onClick: async () => {
      const v = await withCameraPaused(() => itemForm({}, 'بند حر'));
      if (v) { state.items.push({ productId: null, name: v.name, unitPrice: v.unitPrice, qty: v.qty }); state.last = v.name; drawList(); }
    } }, '+ بند حر (اسم وسعر)'),
    unknownBox,
    list,
    state.items.length ? h('button', { class: 'link', type: 'button', onClick: () => { state = newCart(); stopCam(); renderCart(root); } }, 'تفريغ السلة') : null,
    h('div', { class: 'savebar' },
      h('div', null, h('div', { class: 'dim small' }, 'المجموع'), totalEl),
      finishBtn));

  drawCam();
  drawUnknown();
  drawList();
  startCam(); // «عند الضغط تبدأ في ملء السلة»: الكاميرا تعمل فور فتح الشاشة
}

// ====================================================================== مرحلة الإنهاء

async function renderCheckout(root) {
  const customers = await listCustomersWithTotals();
  const itemsBox = h('div', null);
  const selBox = h('div', null);
  const searchBox = h('div', null);
  const custList = h('div', null);
  const payBox = h('div', null);
  const partialInput = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'المبلغ المدفوع الآن بالدينار', value: state.partial });
  const summary = h('div', { class: 'card alt' });
  const err = h('p', { class: 'err' });
  const totalEl = h('div', { class: 'big' });
  const saveBtn = h('button', { class: 'btn' }, 'حفظ');
  const printBtn = h('button', { class: 'btn ghost' }, 'حفظ وطباعة الفاتورة');
  const custSearch = h('input', { class: 'input', type: 'search', placeholder: 'ابحث عن الزبون: اسم، وصف، هاتف...' });

  const customer = () => customers.find(c => c.id === state.customerId) || null;

  // ---------- حساب ----------
  function calc() {
    const total = sumTotal();
    let given = 0, valid = true, msg = '';
    if (state.mode === 'paid') given = total;
    else if (state.mode === 'partial') {
      const m = parseDinars(state.partial);
      if (!state.partial.trim()) { valid = false; msg = 'أدخل المبلغ المدفوع الآن.'; }
      else if (m === null || m <= 0) { valid = false; msg = 'المبلغ المدفوع غير صالح.'; }
      else given = m;
    }
    const applied = Math.min(given, total);
    const change = given - applied;
    const remainingSale = total - applied;
    const c = customer();
    const before = c ? c.remaining : 0;
    return { total, given, applied, change, remainingSale, before, after: before + remainingSale, valid, msg };
  }

  // ---------- العناصر ----------
  function drawItems() {
    itemsBox.replaceChildren();
    state.items.forEach((it, i) => {
      itemsBox.append(h('div', { class: 'pay-line' },
        h('div', null,
          h('div', { class: 'item-name' }, it.name),
          h('div', { class: 'dim small' }, formatMillimes(it.unitPrice) + ' للوحدة • ' + formatMillimes(it.unitPrice * it.qty)),
          h('button', { class: 'link', type: 'button', onClick: async () => {
            const v = await itemForm({ name: it.name, unitPrice: it.unitPrice, qty: it.qty }, 'تعديل البند');
            if (v) { Object.assign(it, { name: v.name, unitPrice: v.unitPrice, qty: v.qty }); drawAll(); }
          } }, 'تعديل الاسم/السعر')),
        h('div', { class: 'stepper' },
          step('−', () => { if (it.qty > 1) { it.qty--; drawAll(); } }),
          h('span', { class: 'qty' }, String(it.qty)),
          step('+', () => { it.qty++; drawAll(); }),
          h('button', { class: 'x', type: 'button', onClick: () => {
            state.items.splice(i, 1);
            if (!state.items.length) { state.stage = 'collect'; renderCart(root); return; }
            drawAll();
          } }, '×'))));
    });
    totalEl.textContent = formatMillimes(sumTotal());
  }

  // ---------- الزبون ----------
  function drawCustomerList() {
    custList.replaceChildren();
    const q = custSearch.value.trim();
    const shown = customers.filter(c => matches(q, c.hay)).slice(0, 6);
    for (const c of shown) {
      custList.append(h('div', { class: 'card item', onClick: () => { state.customerId = c.id; drawAll(); } },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-name' }, c.name),
          c.note ? h('div', { class: 'dim small clamp2' }, c.note) : null,
          c.phone ? h('div', { class: 'dim small' }, c.phone) : null),
        h('span', { class: 'badge ' + (c.remaining > 0 ? 'warn' : 'ok') }, formatMillimes(c.remaining))));
    }
    if (!shown.length) custList.append(h('div', { class: 'card empty' }, customers.length ? 'لا نتائج.' : 'لا زبائن بعد. أضف زبونًا جديدًا.'));
    if (customers.length > 6 && !q) custList.append(h('p', { class: 'dim small center' }, 'اكتب في البحث لرؤية بقية الزبائن.'));
  }
  function drawCustomer() {
    const c = customer();
    selBox.hidden = !c;
    searchBox.hidden = !!c;
    selBox.replaceChildren();
    if (c) {
      selBox.append(h('div', { class: 'card alt' },
        h('div', { class: 'debt-top' },
          h('div', null,
            h('div', { class: 'item-name' }, c.name),
            c.note ? h('div', { class: 'dim small clamp2' }, c.note) : null,
            h('div', { class: 'dim small' }, 'المتبقي عليه حاليًا: ' + formatMillimes(c.remaining))),
          h('button', { class: 'btn ghost inline', onClick: () => { state.customerId = null; drawAll(); } }, 'تغيير'))));
    }
  }

  // ---------- الدفع ----------
  async function pickMode(m) {
    if (m !== 'debt' && !(await needActive())) return; // التسديد بعد انتهاء الاشتراك غير متاح
    state.mode = m;
    drawAll();
  }
  function drawPay() {
    fill(payBox, 
      h('div', { class: 'chips seg' }, [['debt', 'دين كامل'], ['paid', 'مدفوعة الآن'], ['partial', 'دفعة الآن']].map(([k, label]) =>
        h('button', { class: 'chip' + (state.mode === k ? ' on' : ''), type: 'button', onClick: () => pickMode(k) }, label))),
      state.mode === 'partial' ? partialInput : null);
  }

  function drawSummary() {
    const c = calc();
    fill(summary, 
      h('div', { class: 'pay-line' }, h('span', null, 'مجموع السلة'), h('b', null, formatMillimes(c.total))),
      h('div', { class: 'pay-line' }, h('span', null, 'المدفوع الآن'), h('b', null, formatMillimes(c.applied))),
      c.change > 0 ? h('div', { class: 'pay-line' }, h('span', null, 'الباقي للزبون (يُرجَع)'), h('b', null, formatMillimes(c.change))) : null,
      h('div', { class: 'pay-line' }, h('span', null, 'المتبقي من هذه السلة'), h('b', null, formatMillimes(c.remainingSale))),
      state.customerId
        ? h('div', { class: 'pay-line total' }, h('span', null, 'المتبقي على الزبون بعد الحفظ'), h('b', null, formatMillimes(c.after)))
        : h('p', { class: 'dim small' }, 'اختر الزبون لمعرفة ما يبقى عليه.'));
    err.textContent = state.mode === 'partial' && !c.valid && state.partial.trim() ? c.msg : '';
    const ready = !!state.customerId && c.valid && state.items.length > 0;
    saveBtn.disabled = !ready;
    printBtn.disabled = !ready;
  }

  function drawAll() { drawItems(); drawCustomer(); drawPay(); drawSummary(); }

  // ---------- الحفظ ----------
  async function save(print) {
    const c = calc();
    if (!state.customerId) { toast('اختر الزبون أولًا'); return; }
    if (!c.valid) { toast(c.msg); return; }
    if (state.mode !== 'debt' && !(await needActive())) return;
    if (print) {
      if (!(await needActive())) return;
      if (!hasPrint()) { await messageDialog('الطباعة متاحة داخل التطبيق فقط.'); return; }
    }
    saveBtn.disabled = true; printBtn.disabled = true;
    const cust = customer();
    let res;
    try {
      res = await createOrder({
        customerId: state.customerId, date: state.date || todayISO(), note: state.note,
        items: state.items.map(it => ({ productId: it.productId, nameSnapshot: it.name, unitPrice: it.unitPrice, qty: it.qty })),
        paidNow: c.given,
      });
    } catch (e) {
      toast(e.message || 'تعذّر الحفظ');
      drawSummary();
      return;
    }
    const id = state.customerId;
    state = newCart();
    toast('تم حفظ السلة');
    if (print) {
      try { await printSale(cust, res); } catch (e) { toast('تعذّرت الطباعة. يمكنك طباعتها من حساب الزبون.'); }
    }
    location.replace('#/customer/' + id);
  }

  async function printSale(cust, res) {
    const [shopName, shopPhone] = await Promise.all([getSetting('shopName', ''), getSetting('shopPhone', '')]);
    const { debts, orders } = await loadCustomerData(cust.id);
    const payments = res.paymentId ? (await listPayments(cust.id)).filter(p => p.id === res.paymentId) : [];
    printHtml(buildStatementHtml({
      title: 'فاتورة', shop: { name: shopName, phone: shopPhone },
      customer: { name: cust.name, phone: cust.phone, note: cust.note },
      debts: debts.filter(d => d.orderId === res.orderId), orders, payments,
      overallRemaining: debts.reduce((s, d) => s + d.remaining, 0),
    }));
  }

  // ---------- الأحداث ----------
  custSearch.addEventListener('input', drawCustomerList);
  partialInput.addEventListener('input', () => { state.partial = partialInput.value; drawSummary(); });
  saveBtn.addEventListener('click', () => save(false));
  printBtn.addEventListener('click', () => save(true));

  const dateInput = h('input', { class: 'input', type: 'date', value: state.date });
  dateInput.addEventListener('change', () => { state.date = dateInput.value || todayISO(); });
  const noteInput = h('input', { class: 'input', placeholder: 'اختياري', value: state.note });
  noteInput.addEventListener('input', () => { state.note = noteInput.value; });

  searchBox.append(
    custSearch,
    h('button', { class: 'btn ghost', onClick: async () => {
      if (!(await needActive())) return;
      const v = await customerForm({}, customers);
      if (!v) return;
      try { state.customerId = await saveCustomer(v); } catch (e) { toast(e.message); return; }
      const fresh = await listCustomersWithTotals();
      customers.splice(0, customers.length, ...fresh);
      drawCustomerList();
      drawAll();
    } }, '+ زبون جديد'),
    custList);

  fill(root, 
    h('button', { class: 'back', onClick: () => { state.stage = 'collect'; renderCart(root); } }, '→ تعديل السلة'),
    h('h1', { class: 'title' }, 'إنهاء السلة'),
    licenseActive() ? null : licenseCard(),
    h('div', { class: 'card' }, itemsBox, h('div', { class: 'debt-top spaced-top' }, h('span', { class: 'dim' }, 'المجموع'), totalEl)),
    h('h2', { class: 'section' }, 'الزبون'),
    selBox, searchBox,
    h('h2', { class: 'section' }, 'الدفع'),
    payBox,
    summary,
    err,
    h('div', { class: 'card' }, field('تاريخ السلة', dateInput), field('ملاحظة (اختياري)', noteInput)),
    saveBtn, printBtn);

  drawCustomerList();
  drawAll();
}
