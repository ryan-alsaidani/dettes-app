import { requireActive } from './license.js';

// جسر الواجهة ↔ الغلاف الأصلي. الدوال التي تحتاج أندرويد تُرفض بخطأ 'no-bridge' خارج التطبيق.

let pendingScan = null;

// يستدعيها الغلاف الأصلي بعد انتهاء الماسح: النص المقروء أو null عند الإلغاء.
window.__onBarcode = (code) => {
  if (pendingScan) {
    const resolve = pendingScan;
    pendingScan = null;
    resolve(code);
  }
};

export function hasBridge() {
  return !!(window.Android && typeof window.Android.scanBarcode === 'function');
}

/** يفتح الماسح ويعيد نص الباركود، أو null إن ألغى المستخدم. */
export function scanBarcode() {
  return new Promise((resolve, reject) => {
    if (!hasBridge()) { reject(new Error('no-bridge')); return; }
    pendingScan = resolve;
    window.Android.scanBarcode();
  });
}

export function hasPrint() {
  return !!(window.Android && typeof window.Android.printHtml === 'function');
}

/** يفتح حوار الطباعة الأصلي لصفحة HTML كاملة. */
export function printHtml(html) {
  requireActive(); // الطباعة متاحة للاشتراك الفعّال فقط
  if (!hasPrint()) throw new Error('no-bridge');
  window.Android.printHtml(html);
}

let pendingSave = null;

// يستدعيها الغلاف الأصلي بعد «حفظ ملف»: (true) نجح، (false, رسالة|null) فشل أو أُلغي.
window.__onSaved = (ok, msg) => {
  if (pendingSave) {
    const resolve = pendingSave;
    pendingSave = null;
    resolve({ ok: !!ok, message: msg || null });
  }
};

export function hasSave() {
  return !!(window.Android && typeof window.Android.saveFile === 'function');
}

/** يفتح نافذة حفظ ملف. يعيد {ok, message}. ok=false مع message=null يعني أن المستخدم ألغى. */
export function saveFile(name, mime, text) {
  return new Promise((resolve, reject) => {
    if (!hasSave()) { reject(new Error('no-bridge')); return; }
    pendingSave = resolve;
    window.Android.saveFile(name, mime, text);
  });
}

export function hasShare() {
  return !!(window.Android && typeof window.Android.shareText === 'function');
}

/** يفتح قائمة المشاركة الأصلية (واتساب، رسائل...) بنص معيّن. */
export function shareText(text) {
  if (!hasShare()) throw new Error('no-bridge');
  window.Android.shareText(text);
}

// ---------- الماسح الحيّ (السلة السريعة) ----------
let scanCodeHandler = null;
let scanStateHandler = null;

// يستدعيهما الغلاف الأصلي: كل باركود جديد (دون تكرار متتالٍ)، وحالة الكاميرا (started|stopped|denied)
window.__onScanCode = (code) => { if (scanCodeHandler) scanCodeHandler(code); };
window.__onScanState = (state) => { if (scanStateHandler) scanStateHandler(state); };

export function hasLiveScan() {
  return !!(window.Android && typeof window.Android.scanStart === 'function');
}

export function liveScanStart(onCode, onState) {
  if (!hasLiveScan()) return;
  scanCodeHandler = onCode;
  scanStateHandler = onState || null;
  window.Android.scanStart();
}

export function liveScanStop() {
  scanCodeHandler = null;
  scanStateHandler = null;
  if (hasLiveScan()) window.Android.scanStop();
}

export function liveScanTorch(on) {
  if (hasLiveScan()) window.Android.scanTorch(!!on);
}

export function liveScanResetLast() {
  if (hasLiveScan()) window.Android.scanResetLast();
}
