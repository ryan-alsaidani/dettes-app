// ترميز رمز الجهاز ومفتاح التجديد. دوال نقية بلا اعتماد على المتصفح (تُنسخ حرفيًا داخل صفحة المولّد).
//
// رمز الجهاز  : [1 بايت إصدار][10 بايت عشوائي][UTF-8: «اسم المكتبة\nهاتفها»][1 بايت CRC8]  ← Base32 مجمَّع
// مفتاح التجديد: [1 بايت إصدار][10 بايت عشوائي الجهاز][2 بايت عدد الأيام] + توقيع ECDSA (64 بايت) ← Base32 مجمَّع

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford
export const LICENSE_CONTEXT = 'dettes-license-v1';
export const NONCE_BYTES = 10;
export const PAYLOAD_BYTES = 13;
export const SIG_BYTES = 64;

export class CodecError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function b32encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function b32decode(str) {
  const map = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
  map.O = 0; map.I = 1; map.L = 1;
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase()) {
    if (ch === '-' || /\s/.test(ch)) continue;
    const v = map[ch];
    if (v === undefined) throw new CodecError('chars');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

export const group = (s, n = 5) => (s.match(new RegExp('.{1,' + n + '}', 'g')) || []).join('-');

/** أطول مقطع من الحروف اللاتينية/الأرقام (مع - ومسافات) داخل نص قد يحوي كلامًا عربيًا حوله. */
export function extractCode(text) {
  const runs = String(text ?? '').toUpperCase().match(/[0-9A-Z]+(?:[\s-]+[0-9A-Z]+)*/g) || [];
  let best = '';
  for (const r of runs) if (r.replace(/[\s-]/g, '').length > best.replace(/[\s-]/g, '').length) best = r;
  if (!best) throw new CodecError('empty');
  return best;
}

export function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
  }
  return c;
}

export const toHex = (bytes) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex) => Uint8Array.from((hex.match(/../g) || []).map(h => parseInt(h, 16)));

const clip = (s, n) => Array.from(String(s ?? '').replace(/[\r\n]+/g, ' ').trim()).slice(0, n).join('');

/** رمز الجهاز: يحمل رقمًا عشوائيًا خاصًّا بالجهاز + اسم المكتبة وهاتفها (إن وُجدا). */
export function encodeDeviceCode({ nonce, name = '', phone = '' }) {
  const body = new TextEncoder().encode(clip(name, 40) + '\n' + clip(phone, 20));
  const bytes = new Uint8Array(1 + NONCE_BYTES + body.length + 1);
  bytes[0] = 1;
  bytes.set(nonce, 1);
  bytes.set(body, 1 + NONCE_BYTES);
  bytes[bytes.length - 1] = crc8(bytes.subarray(0, bytes.length - 1));
  return group(b32encode(bytes));
}

export function parseDeviceCode(text) {
  const bytes = b32decode(extractCode(text));
  if (bytes.length < 1 + NONCE_BYTES + 1 + 1) throw new CodecError('short');
  if (crc8(bytes.subarray(0, bytes.length - 1)) !== bytes[bytes.length - 1]) throw new CodecError('crc');
  if (bytes[0] !== 1) throw new CodecError('version');
  const nonce = bytes.slice(1, 1 + NONCE_BYTES);
  const info = new TextDecoder().decode(bytes.slice(1 + NONCE_BYTES, bytes.length - 1));
  const i = info.indexOf('\n');
  return { nonce, nonceHex: toHex(nonce), name: (i < 0 ? info : info.slice(0, i)).trim(), phone: (i < 0 ? '' : info.slice(i + 1)).trim() };
}

export function licensePayload(nonce, days) {
  if (!Number.isInteger(days) || days < 1 || days > 65535) throw new CodecError('days');
  const p = new Uint8Array(PAYLOAD_BYTES);
  p[0] = 1;
  p.set(nonce, 1);
  p[11] = days >> 8;
  p[12] = days & 255;
  return p;
}

/** البايتات الموقَّعة فعليًا: سياق ثابت + الحمولة (يمنع إعادة استعمال توقيع لغرض آخر). */
export function signingBytes(payload) {
  const ctx = new TextEncoder().encode(LICENSE_CONTEXT);
  const out = new Uint8Array(ctx.length + payload.length);
  out.set(ctx);
  out.set(payload, ctx.length);
  return out;
}

export function encodeLicense(payload, sig) {
  const all = new Uint8Array(payload.length + sig.length);
  all.set(payload);
  all.set(sig, payload.length);
  return group(b32encode(all), 6);
}

export function parseLicense(text) {
  const bytes = b32decode(extractCode(text));
  if (bytes.length !== PAYLOAD_BYTES + SIG_BYTES) throw new CodecError('length');
  const payload = bytes.slice(0, PAYLOAD_BYTES);
  if (payload[0] !== 1) throw new CodecError('version');
  return {
    payload,
    sig: bytes.slice(PAYLOAD_BYTES),
    nonceHex: toHex(payload.slice(1, 1 + NONCE_BYTES)),
    days: (payload[11] << 8) | payload[12],
  };
}
