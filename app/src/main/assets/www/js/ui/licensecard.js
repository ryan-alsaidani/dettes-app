import { h, toast, sheet } from './dom.js';
import { licenseStatus, getDeviceCode, applyKey, EXPIRED_MESSAGE, LicenseError, formatRemaining } from '../license.js';
import { hasShare, shareText } from '../bridge.js';
import { formatDate, todayISO } from '../dates.js';

export const licenseActive = () => licenseStatus().active;

/** يعيد رسم الشاشة الحالية. */
export const refreshView = () => window.dispatchEvent(new Event('hashchange'));

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* احتياط أدناه */ }
  try {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/** نافذة التجديد: رمز الجهاز (إرسال/نسخ) ثم إدخال المفتاح. */
export async function openRenew(onDone = refreshView) {
  let code;
  try { code = await getDeviceCode(); } catch (e) { toast('تعذّر توليد رمز الجهاز'); return; }
  const keyInput = h('textarea', { class: 'input area', dir: 'ltr', placeholder: 'ألصق المفتاح هنا', spellcheck: 'false' });
  const err = h('p', { class: 'err' });
  const s = sheet([
    h('h2', { class: 'sheet-title' }, 'تجديد الاشتراك'),
    h('p', { class: 'dim small' }, '١) أرسل رمز جهازك إلى المسؤول:'),
    h('div', { class: 'codebox' }, code),
    h('div', { class: 'btn-row' },
      hasShare() ? h('button', { class: 'btn', onClick: () => shareText('رمز جهازي لتجديد دفتر الديون:\n' + code) }, 'إرسال الرمز') : null,
      h('button', { class: 'btn ghost', onClick: async () => toast((await copyText(code)) ? 'تم نسخ الرمز' : 'تعذّر النسخ') }, 'نسخ')),
    h('p', { class: 'dim small' }, '٢) ألصق المفتاح الذي وصلك:'),
    keyInput, err,
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ok', onClick: async () => {
        err.textContent = '';
        if (!keyInput.value.trim()) { err.textContent = 'ألصق المفتاح أولًا.'; return; }
        try {
          const r = await applyKey(keyInput.value);
          s.close();
          toast('تم التجديد: أُضيف ' + r.days + ' يومًا');
          onDone();
        } catch (e) {
          err.textContent = e instanceof LicenseError ? e.message : 'تعذّر التفعيل.';
        }
      } }, 'تفعيل'),
      h('button', { class: 'btn ghost', onClick: () => s.close() }, 'إغلاق')),
  ]);
}

/** يعيد true إن كان الاشتراك فعّالًا. وإلا يعرض نافذة تشرح الوضع مع زر التجديد ويعيد false. */
export function needActive() {
  if (licenseActive()) return Promise.resolve(true);
  return new Promise(resolve => {
    const s = sheet([
      h('p', { class: 'sheet-text' }, EXPIRED_MESSAGE),
      h('button', { class: 'btn', onClick: () => { s.close(); resolve(false); openRenew(); } }, 'التجديد'),
      h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(false); } }, 'حسنًا'),
    ]);
  });
}

/** بطاقة الاشتراك: المدة المتبقية وزر «التجديد». */
export function licenseCard() {
  const st = licenseStatus();
  const low = st.active && st.daysLeft <= 7;
  const title = !st.active ? 'انتهى الاشتراك' : st.trial ? 'فترة تجريبية' : 'الاشتراك';
  const sub = st.active
    ? 'ينتهي في ' + formatDate(todayISO(new Date(st.expiresAt)))
    : 'وضع القراءة وتسجيل الديون فقط';
  return h('div', { class: 'card lic ' + (!st.active ? 'expired' : low ? 'low' : 'okay') },
    h('div', { class: 'lic-main' },
      h('div', null,
        h('div', { class: 'lic-title' }, title),
        h('div', { class: 'dim small' }, sub)),
      st.active ? h('div', { class: 'lic-days' },
        h('span', { class: 'lic-num' }, formatRemaining(st.daysLeft).num),
        h('span', { class: 'dim small' }, formatRemaining(st.daysLeft).unit)) : null),
    h('button', { class: 'btn lic-btn', onClick: () => openRenew() }, 'التجديد'));
}
