import { requireActive } from './license.js';
import { bytesToBase64, base64ToBytes } from './compress.js';

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


// ---------- QR، ملفات ثنائية، مجلد النسخ، إبقاء الشاشة ----------
export const hasQr = () => !!(window.Android && typeof window.Android.qrMatrix === 'function');

/** مصفوفة QR كأسطر من 0/1، أو null إن تعذّر (النص أطول من سعة الرمز). */
export function qrMatrix(text, level = 'M') {
  if (!hasQr()) return null;
  const s = window.Android.qrMatrix(text, level);
  return s ? s.split('\n') : null;
}

export function keepAwake(on) {
  try { if (window.Android && typeof window.Android.keepAwake === 'function') window.Android.keepAwake(!!on); } catch (e) { /* اختياري */ }
}

/** يحفظ بايتات (مثل ZIP) عبر نافذة «حفظ ملف». يعيد {ok, message} كما saveFile. */
export function saveFileBytes(name, mime, bytes) {
  return new Promise((resolve, reject) => {
    if (!(window.Android && typeof window.Android.saveFileB64 === 'function')) { reject(new Error('no-bridge')); return; }
    pendingSave = resolve;
    window.Android.saveFileB64(name, mime, bytesToBase64(bytes));
  });
}

let pendingFolderPick = null;
window.__onFolderPicked = (uri, name) => {
  if (pendingFolderPick) {
    const resolve = pendingFolderPick;
    pendingFolderPick = null;
    resolve(uri ? { uri, name } : null);
  }
};

export const hasFolder = () => !!(window.Android && typeof window.Android.folderPick === 'function');

/** منتقي مجلد النظام. يعيد {uri, name} أو null عند الإلغاء. */
export function folderPick() {
  return new Promise((resolve, reject) => {
    if (!hasFolder()) { reject(new Error('no-bridge')); return; }
    pendingFolderPick = resolve;
    window.Android.folderPick();
  });
}

const folderOps = new Map();
let folderSeq = 0;
window.__onFolderOp = (id, ok, result, error) => {
  const h = folderOps.get(id);
  if (!h) return;
  folderOps.delete(id);
  if (ok) h.resolve(result); else h.reject(new Error(error || 'folder'));
};

function folderOp(op, tree, subDir, name, mime, b64) {
  return new Promise((resolve, reject) => {
    if (!hasFolder()) { reject(new Error('no-bridge')); return; }
    const id = 'f' + (++folderSeq);
    folderOps.set(id, { resolve, reject });
    window.Android.folderOp(id, op, tree, subDir || '', name || '', mime || '', b64 || '');
  });
}

export const folderWrite = (tree, subDir, name, mime, bytes) => folderOp('write', tree, subDir, name, mime, bytesToBase64(bytes));
export async function folderRead(tree, subDir, name) {
  const b64 = await folderOp('read', tree, subDir, name);
  return b64 === null ? null : base64ToBytes(b64);
}
export async function folderList(tree, subDir = '') { return JSON.parse(await folderOp('list', tree, subDir, '')); }
