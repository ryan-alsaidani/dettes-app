import { h, toast, confirmDialog, sheet } from './dom.js';
import * as P from '../products.js';
import { matches, suggestBrands } from '../search.js';
import { formatMillimes, parseDinars, toInputString } from '../money.js';
import { scanBarcode } from '../bridge.js';

const MAX_SHOWN = 100;

function field(label, input) {
  return h('div', { class: 'field' }, h('label', { class: 'lbl' }, label), input);
}

/** نموذج منتج (جديد أو تعديل). يحفظ بنفسه. يعيد true إن تغيّر شيء، وإلا false. */
function productForm(initial = {}, brands = []) {
  return new Promise(resolve => {
    const isEdit = !!initial.id;
    const name = h('input', { class: 'input', value: initial.name || '', placeholder: 'مثال: قلم حبر أزرق' });
    const price = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'بالدينار، مثال: 1.5',
      value: initial.price !== undefined ? toInputString(initial.price) : '' });
    const brand = h('input', { class: 'input', value: initial.brand || '', placeholder: 'اختياري' });
    const chips = h('div', { class: 'chips' });
    const barcode = h('input', { class: 'input grow', inputmode: 'numeric', value: initial.barcode || '', placeholder: 'اختياري — أو اكتبه/امسحه' });
    const weight = h('input', { class: 'input', value: initial.weight || '', placeholder: 'اختياري، مثال: 500 غ' });
    const desc = h('textarea', { class: 'input area', placeholder: 'اختياري' });
    desc.value = initial.description || '';
    const err = h('p', { class: 'err' });

    function drawChips() {
      chips.replaceChildren();
      for (const n of suggestBrands(brands, brand.value)) {
        chips.append(h('button', { class: 'chip', type: 'button', onClick: () => { brand.value = n; drawChips(); } }, n));
      }
    }
    brand.addEventListener('input', drawChips);
    drawChips();

    const scanBtn = h('button', { class: 'btn ghost inline', type: 'button', onClick: async () => {
      try {
        const code = await scanBarcode();
        if (code) { barcode.value = code; err.textContent = ''; }
      } catch (e) {
        toast('الماسح غير متاح هنا');
      }
    } }, 'مسح');

    const s = sheet([
      h('h2', { class: 'sheet-title' }, isEdit ? 'تعديل المنتج' : 'منتج جديد'),
      field('الاسم', name),
      field('السعر (د)', price),
      field('العلامة', brand), chips,
      field('الباركود', h('div', { class: 'row-inline' }, barcode, scanBtn)),
      field('الوزن', weight),
      field('الوصف', desc),
      err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: async () => {
          err.textContent = '';
          const p = parseDinars(price.value);
          if (p === null) { err.textContent = 'السعر غير صالح (مثال: 1.5 أو 2.250)'; return; }
          try {
            await P.saveProduct({ id: initial.id, name: name.value, barcode: barcode.value, brand: brand.value,
              price: p, weight: weight.value, description: desc.value });
          } catch (e) { err.textContent = e.message; return; }
          s.close(); resolve(true);
        } }, 'حفظ'),
        h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(false); } }, 'إلغاء')),
      isEdit ? h('button', { class: 'btn danger', onClick: async () => {
        if (await confirmDialog('حذف المنتج «' + initial.name + '»؟ الديون المسجَّلة سابقًا لا تتأثر.', 'حذف', true)) {
          await P.deleteProduct(initial.id);
          s.close(); resolve(true);
        }
      } }, 'حذف المنتج') : null,
    ]);
    if (!isEdit) setTimeout(() => name.focus(), 50);
  });
}

export async function renderProducts(root) {
  let all = await P.listProducts();
  let brands = await P.listBrands();
  all.sort((a, b) => a.name.localeCompare(b.name, 'ar'));

  const list = h('div', { class: 'list' });
  const count = h('p', { class: 'dim small' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'ابحث بالاسم أو العلامة أو الباركود...' });

  async function reload() {
    all = await P.listProducts();
    brands = await P.listBrands();
    all.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    draw();
  }

  async function openForm(initial) {
    if (await productForm(initial, brands)) {
      await reload();
      toast('تم الحفظ');
    }
  }

  function draw() {
    const q = search.value.trim();
    const digits = /^\d{3,}$/.test(q);
    const shown = all.filter(p =>
      matches(q, p.nameNorm + ' ' + (p.brandNorm || '')) || (digits && p.barcode && p.barcode.includes(q)));
    list.replaceChildren();
    count.textContent = all.length ? `${shown.length} من ${all.length} منتج` : '';
    if (!all.length) {
      list.append(h('div', { class: 'card empty' }, 'لا توجد منتجات بعد. أضف منتجًا مرة واحدة ثم أعد استعماله في كل دين.'));
      return;
    }
    if (!shown.length) {
      list.append(h('div', { class: 'card empty' }, 'لا نتائج لهذا البحث.'));
      return;
    }
    for (const p of shown.slice(0, MAX_SHOWN)) {
      list.append(h('div', { class: 'card item', onClick: () => openForm(p) },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-name' }, p.name),
          (p.brand || p.barcode) ? h('div', { class: 'dim small' }, [p.brand, p.barcode].filter(Boolean).join(' • ')) : null),
        h('span', { class: 'badge' }, formatMillimes(p.price))));
    }
    if (shown.length > MAX_SHOWN) {
      list.append(h('p', { class: 'dim small center' }, 'يُعرض أول ' + MAX_SHOWN + ' فقط، حدّد البحث لرؤية الباقي.'));
    }
  }

  search.addEventListener('input', draw);
  // قارئ USB/بلوتوث يكتب الباركود ثم Enter: افتح المنتج مباشرة.
  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = search.value.trim();
    if (!code) return;
    const found = await P.findByBarcode(code);
    if (found) { search.value = ''; draw(); openForm(found); }
    else if (/^\d{4,}$/.test(code)) { search.value = ''; draw(); openForm({ barcode: code }); }
  });

  const addBtn = h('button', { class: 'btn', onClick: () => openForm({}) }, '+ منتج جديد');
  const scanBtn = h('button', { class: 'btn ghost', onClick: async () => {
    let code;
    try { code = await scanBarcode(); } catch (e) { toast('الماسح غير متاح هنا'); return; }
    if (!code) return;
    const found = await P.findByBarcode(code);
    openForm(found || { barcode: code });
  } }, 'مسح باركود');

  root.replaceChildren(
    h('h1', { class: 'title' }, 'المنتجات'),
    search,
    h('div', { class: 'btn-row' }, addBtn, scanBtn),
    count, list);
  draw();
}
