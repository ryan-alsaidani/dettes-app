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
  if (!hasPrint()) throw new Error('no-bridge');
  window.Android.printHtml(html);
}
