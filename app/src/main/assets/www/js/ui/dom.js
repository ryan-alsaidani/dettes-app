// أدوات صغيرة لبناء الواجهة بأمان (textContent فقط، بلا innerHTML للبيانات).
import { normalize } from '../search.js';
import { parseDinars, toInputString } from '../money.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * مثل el.replaceChildren(...) لكن يتجاهل null/undefined/false (المتصفح يحوّل null إلى النص «null»).
 */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false));
}

export function field(label, input) {
  return h('div', { class: 'field' }, h('label', { class: 'lbl' }, label), input);
}

export function toast(msg) {
  document.querySelectorAll('.toast').forEach(el => el.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

export function sheet(content) {
  const back = h('div', { class: 'backdrop' });
  const box = h('div', { class: 'sheet' }, content);
  back.append(box);
  document.body.append(back);
  return { close: () => back.remove(), back };
}

/** نافذة تأكيد خاصة (confirm() الأصلية لا تعمل في WebView بلا WebChromeClient). */
export function confirmDialog(message, okText = 'تأكيد', danger = false) {
  return new Promise(resolve => {
    const s = sheet([
      h('p', { class: 'sheet-text' }, message),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ' + (danger ? 'danger' : ''), onClick: () => { s.close(); resolve(true); } }, okText),
        h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(false); } }, 'إلغاء')),
    ]);
  });
}

export function messageDialog(message) {
  return new Promise(resolve => {
    const s = sheet([
      h('p', { class: 'sheet-text' }, message),
      h('button', { class: 'btn', onClick: () => { s.close(); resolve(); } }, 'حسنًا'),
    ]);
  });
}

/**
 * نموذج زبون. existing: [{id, nameNorm}] للتنبيه إلى تكرار الاسم.
 * إن تكرر الاسم بلا وصف يميّزه نُنبّه، والضغط الثاني على «حفظ» يتابع.
 */
export function customerForm(initial = {}, existing = []) {
  return new Promise(resolve => {
    const name = h('input', { class: 'input', placeholder: 'اسم الزبون', value: initial.name || '' });
    const phone = h('input', { class: 'input', placeholder: 'اختياري', inputmode: 'tel', value: initial.phone || '' });
    const note = h('input', { class: 'input', placeholder: 'يميّزه عن غيره: ابن فلان، الحي، مكان العمل...', value: initial.note || '' });
    const hint = h('p', { class: 'warn-text' });
    const err = h('p', { class: 'err' });
    let warned = false;

    const isDup = () => {
      const nn = normalize(name.value);
      return !!nn && existing.some(c => c.id !== initial.id && c.nameNorm === nn);
    };
    name.addEventListener('input', () => {
      hint.textContent = isDup() ? 'يوجد زبون آخر بنفس الاسم. اكتب وصفًا يميّزه عنه.' : '';
    });

    const s = sheet([
      h('h2', { class: 'sheet-title' }, initial.id ? 'تعديل الزبون' : 'زبون جديد'),
      field('الاسم', name), hint,
      field('الهاتف', phone),
      field('وصف الزبون', note),
      err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => {
          if (!name.value.trim()) { err.textContent = 'الاسم مطلوب'; return; }
          if (isDup() && !note.value.trim() && !warned) {
            warned = true;
            err.textContent = 'الاسم مكرَّر ولا وصف يميّزه. أضف وصفًا، أو اضغط «حفظ» مرة ثانية للمتابعة.';
            note.focus();
            return;
          }
          s.close();
          resolve({ name: name.value, phone: phone.value, note: note.value });
        } }, 'حفظ'),
        h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(null); } }, 'إلغاء')),
    ]);
    setTimeout(() => name.focus(), 50);
  });
}

/** نموذج بند: اسم + سعر الوحدة (بالدينار) + كمية. يعيد {name, unitPrice(مليم), qty} أو null. */
export function itemForm(initial = {}, title = 'بند') {
  return new Promise(resolve => {
    const name = h('input', { class: 'input', value: initial.name || '', placeholder: 'اسم البند' });
    const price = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'بالدينار، مثال: 1.5',
      value: initial.unitPrice ? toInputString(initial.unitPrice) : '' });
    const qty = h('input', { class: 'input', inputmode: 'numeric', value: String(initial.qty || 1) });
    const err = h('p', { class: 'err' });
    const s = sheet([
      h('h2', { class: 'sheet-title' }, title),
      field('الاسم', name), field('سعر الوحدة (د)', price), field('الكمية', qty), err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => {
          const p = parseDinars(price.value);
          const q = /^\d+$/.test(qty.value.trim()) ? parseInt(qty.value.trim(), 10) : 0;
          if (!name.value.trim()) { err.textContent = 'الاسم مطلوب'; return; }
          if (!p) { err.textContent = 'السعر غير صالح (يجب أن يكون أكبر من صفر)'; return; }
          if (q < 1) { err.textContent = 'الكمية غير صالحة'; return; }
          s.close();
          resolve({ name: name.value.trim(), unitPrice: p, qty: q });
        } }, 'حفظ'),
        h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(null); } }, 'إلغاء')),
    ]);
    setTimeout(() => (initial.name ? price : name).focus(), 50);
  });
}
