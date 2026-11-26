// الترخيص: تجربة مجانية ثم اشتراك بمفاتيح موقَّعة (ECDSA P-256) لا يمكن تزويرها دون المفتاح الخاص.
// الحالة تُحفظ في settings تحت المفتاح lic_state (ولا تدخل النسخ الاحتياطي ولا تتأثر بالاسترجاع).
import * as db from './db.js';
import { PUBLIC_JWK } from './license-key.js';
import { parseLicense, signingBytes, encodeDeviceCode, toHex, fromHex, NONCE_BYTES } from './license-codec.js';

export const TRIAL_DAYS = 14;
export const DAY_MS = 86400000;
export const LICENSE_PREFIX = 'lic_';
const STATE_KEY = 'lic_state';

export class LicenseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const EXPIRED_MESSAGE = 'انتهى الاشتراك. يمكنك عرض بياناتك وتسجيل ديون جديدة فقط حتى تجدّد.';

const KEY_MESSAGES = {
  format: 'المفتاح غير مفهوم. تأكد من نسخه كاملًا كما وصلك.',
  signature: 'المفتاح غير صالح.',
  device: 'هذا المفتاح لا يخص رمز هذا الجهاز الحالي، أو سبق استعماله.',
  nocrypto: 'هذا الجهاز لا يدعم التحقق من المفاتيح.',
};
const keyError = (code) => new LicenseError(code, KEY_MESSAGES[code]);

export const newNonceHex = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));

/** المدة المتبقية للعرض: أيام حتى سنة، وما فوقها بالسنوات (مثل 100 سنة). */
export function formatRemaining(daysLeft) {
  if (daysLeft > 365) {
    const years = Math.round((daysLeft / 365.25) * 10) / 10;
    return { num: String(years).replace(/\.0$/, ''), unit: 'سنة متبقية' };
  }
  return { num: String(daysLeft), unit: daysLeft === 1 ? 'يوم متبقٍ' : 'أيام متبقية' };
}

/** حالة نقية من الحالة المخزَّنة. الزمن لا يرجع للوراء: now الفعلي = الأكبر بين الآن وآخر زمن رُئي. */
export function statusFromState(state, now = Date.now()) {
  const eff = Math.max(now, state.lastSeen || 0);
  const msLeft = state.expiresAt - eff;
  const active = msLeft > 0;
  return {
    active,
    trial: !!state.trial,
    expiresAt: state.expiresAt,
    msLeft: Math.max(0, msLeft),
    daysLeft: active ? Math.ceil(msLeft / DAY_MS) : 0,
  };
}

export async function verifyToken(parsed, publicJwk, subtle) {
  const key = await subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, parsed.sig, signingBytes(parsed.payload));
}

/**
 * يفحص مفتاحًا ويحسب الحالة الجديدة (دون كتابة). يرمي LicenseError عند الفشل.
 * المدة تُضاف إلى ما بقي من الاشتراك (أو إلى الآن إن انتهى)، ويتبدّل رمز الجهاز.
 */
export async function checkKey({ text, state, publicJwk = PUBLIC_JWK, subtle = globalThis.crypto && globalThis.crypto.subtle, now = Date.now() }) {
  if (!subtle) throw keyError('nocrypto');
  let parsed;
  try { parsed = parseLicense(text); } catch (e) { throw keyError('format'); }
  let ok = false;
  try { ok = await verifyToken(parsed, publicJwk, subtle); } catch (e) { ok = false; }
  if (!ok) throw keyError('signature');
  if (parsed.nonceHex !== state.nonce) throw keyError('device');
  const eff = Math.max(now, state.lastSeen || 0);
  const base = Math.max(eff, state.expiresAt);
  return {
    days: parsed.days,
    state: { nonce: newNonceHex(), expiresAt: base + parsed.days * DAY_MS, lastSeen: eff, trial: false },
  };
}

// ---------- الحالة في قاعدة البيانات ----------
let cache = null;
let loading = null;

export function loadLicense() {
  if (!loading) {
    loading = (async () => {
      const rec = await db.get('settings', STATE_KEY);
      const now = Date.now();
      let st = rec && rec.value;
      if (!st || typeof st.nonce !== 'string' || !Number.isFinite(st.expiresAt)) {
        st = { nonce: newNonceHex(), expiresAt: now + TRIAL_DAYS * DAY_MS, lastSeen: now, trial: true };
        await db.put('settings', { key: STATE_KEY, value: st });
      }
      cache = st;
      return statusFromState(st, now);
    })();
  }
  return loading;
}

/** حالة متزامنة من الذاكرة (تُحسب مع الزمن الحالي، فينتهي الاشتراك فورًا عند حلول موعده). */
export function licenseStatus() {
  if (!cache) return { active: false, trial: false, expiresAt: 0, msLeft: 0, daysLeft: 0 };
  return statusFromState(cache, Date.now());
}

/** يحدّث «آخر زمن رُئي» (لمنع الغش بإرجاع ساعة الهاتف) ويعيد الحالة. */
export async function refreshLicense() {
  await loadLicense();
  const now = Date.now();
  if (now - (cache.lastSeen || 0) > 60000) {
    cache = { ...cache, lastSeen: now };
    await db.put('settings', { key: STATE_KEY, value: cache });
  }
  return licenseStatus();
}

/** يرمي إن انتهى الاشتراك. تُستدعى في كل عملية كتابة غير مسموحة بعد الانتهاء. */
export function requireActive() {
  if (!licenseStatus().active) throw new LicenseError('expired', EXPIRED_MESSAGE);
}

/** رمز الجهاز الحالي (يحمل اسم المكتبة وهاتفها من الإعدادات وقت العرض). */
export async function getDeviceCode() {
  await loadLicense();
  const [name, phone] = await Promise.all([db.get('settings', 'shopName'), db.get('settings', 'shopPhone')]);
  return encodeDeviceCode({
    nonce: fromHex(cache.nonce),
    name: (name && name.value) || '',
    phone: (phone && phone.value) || '',
  });
}

/** يفعّل مفتاحًا: يتحقق، يمدّد الاشتراك، ويبدّل رمز الجهاز. يعيد {days, status}. */
export async function applyKey(text) {
  await loadLicense();
  const res = await checkKey({ text, state: cache });
  await db.put('settings', { key: STATE_KEY, value: res.state });
  cache = res.state;
  return { days: res.days, status: licenseStatus() };
}

export const isLicenseRecord = (rec) => !!rec && typeof rec.key === 'string' && rec.key.startsWith(LICENSE_PREFIX);
