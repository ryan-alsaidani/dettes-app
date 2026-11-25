// أدوات صغيرة لبناء الواجهة بأمان (textContent فقط، بلا innerHTML للبيانات).

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

export function toast(msg) {
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

/** نموذج زبون. يعيد القيم أو null عند الإلغاء. */
export function customerForm(initial = {}) {
  return new Promise(resolve => {
    const name = h('input', { class: 'input', placeholder: 'اسم الزبون', value: initial.name || '' });
    const phone = h('input', { class: 'input', placeholder: 'الهاتف (اختياري)', inputmode: 'tel', value: initial.phone || '' });
    const note = h('input', { class: 'input', placeholder: 'ملاحظة (اختياري)', value: initial.note || '' });
    const err = h('p', { class: 'err' });
    const s = sheet([
      h('h2', { class: 'sheet-title' }, initial.id ? 'تعديل الزبون' : 'زبون جديد'),
      name, phone, note, err,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => {
          if (!name.value.trim()) { err.textContent = 'الاسم مطلوب'; return; }
          s.close();
          resolve({ name: name.value, phone: phone.value, note: note.value });
        } }, 'حفظ'),
        h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(null); } }, 'إلغاء')),
    ]);
    setTimeout(() => name.focus(), 50);
  });
}
