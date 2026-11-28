// نقل التحديثات برموز QR أو نص: البيانات → JSON → ضغط → Base41 → إطارات مرقَّمة.
//
// الإطار: DQ1:SID:i:n:CRC:data   (كله حروف كبيرة وأرقام ورموز . - / + : فيدخل في وضع QR «الأبجدي الرقمي» الأكثر كثافة)
//   SID: معرّف عملية الإرسال (4 خانات) | i: رقم الإطار | n: عدد الإطارات | CRC: CRC32 للبيانات كلها
import { crc32 } from './crc32.js';
import { deflateRaw, inflateRaw, hasCompression } from './compress.js';

// 41 رمزًا: كل 3 رموز تحمل بايتين (41³ = 68921 ≥ 65536). بلا مسافة ولا * $ % فلا تفسدها تطبيقات المراسلة.
const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.-/+:';
const INDEX = new Map([...ALPHA].map((c, i) => [c, i]));

export function encode41(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += ALPHA[n % 41] + ALPHA[Math.floor(n / 41) % 41] + ALPHA[Math.floor(n / 1681)];
    } else {
      const n = bytes[i];
      out += ALPHA[n % 41] + ALPHA[Math.floor(n / 41)];
    }
  }
  return out;
}

export function decode41(str) {
  if (str.length % 3 === 1) throw new Error('b41-length');
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    const c = INDEX.get(str[i]), d = INDEX.get(str[i + 1]);
    if (c === undefined || d === undefined) throw new Error('b41-char');
    if (i + 2 < str.length) {
      const e = INDEX.get(str[i + 2]);
      if (e === undefined) throw new Error('b41-char');
      const n = c + d * 41 + e * 1681;
      if (n > 65535) throw new Error('b41-range');
      out.push(n >> 8, n & 255);
    } else {
      const n = c + d * 41;
      if (n > 255) throw new Error('b41-range');
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

export const FRAME_RE = /^DQ1:([0-9A-Z]{4}):(\d{1,4}):(\d{1,4}):([0-9A-F]{8}):([0-9A-Z.\-/+:]*)$/;

export function randomSid() {
  const a = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(a, b => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[b % 36]).join('');
}

/** يقطّع بايتات إلى إطارات نصية. chunk = عدد رموز البيانات في الإطار الواحد. */
export function makeFrames(bytes, { chunk = 600, sid = randomSid() } = {}) {
  const data = encode41(bytes);
  const n = Math.max(1, Math.ceil(data.length / chunk));
  const crc = crc32(bytes).toString(16).toUpperCase().padStart(8, '0');
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(`DQ1:${sid}:${i + 1}:${n}:${crc}:${data.slice(i * chunk, (i + 1) * chunk)}`);
  return frames;
}

export function parseFrame(text) {
  const m = FRAME_RE.exec(String(text || '').trim());
  if (!m) return null;
  const f = { sid: m[1], i: Number(m[2]), n: Number(m[3]), crc: m[4], data: m[5] };
  return f.n >= 1 && f.i >= 1 && f.i <= f.n ? f : null;
}

/** كل الإطارات داخل نص ملصوق (قد يحوي كلامًا آخر وأسطرًا فاصلة). */
export function extractFrames(text) {
  return String(text || '').split(/\s+/).filter(t => t.startsWith('DQ1:')).map(parseFrame).filter(Boolean);
}

/** يجمع الإطارات الواردة بأي ترتيب، ويكشف المفقود والمكرر والغريب. */
export class FrameCollector {
  constructor() { this.reset(); }

  reset() { this.sid = null; this.n = 0; this.crc = null; this.parts = new Map(); }

  /** يعيد {status: new|dup|other|invalid, sid?}. other = إطار من عملية إرسال مختلفة (لا يُخلط). */
  add(input) {
    const f = typeof input === 'string' ? parseFrame(input) : input;
    if (!f) return { status: 'invalid' };
    if (this.sid === null) { this.sid = f.sid; this.n = f.n; this.crc = f.crc; }
    else if (f.sid !== this.sid) return { status: 'other', sid: f.sid };
    else if (f.n !== this.n || f.crc !== this.crc) return { status: 'invalid' };
    if (this.parts.has(f.i)) return { status: 'dup' };
    this.parts.set(f.i, f.data);
    return { status: 'new' };
  }

  get have() { return this.parts.size; }
  get maxIndex() { return this.parts.size ? Math.max(...this.parts.keys()) : 0; }

  /** الأرقام الأقل من أعلى رقم وصل ولم تصل: ما «فات» المستخدم حين تجاوز رمزًا. */
  skipped() {
    const out = [];
    for (let i = 1; i < this.maxIndex; i++) if (!this.parts.has(i)) out.push(i);
    return out;
  }

  /** كل الأرقام الناقصة من 1 إلى n. */
  missing() {
    const out = [];
    for (let i = 1; i <= this.n; i++) if (!this.parts.has(i)) out.push(i);
    return out;
  }

  complete() { return this.sid !== null && this.parts.size === this.n; }

  /** البايتات الأصلية بعد التحقق من CRC. */
  assemble() {
    if (!this.complete()) throw new Error('incomplete');
    let data = '';
    for (let i = 1; i <= this.n; i++) data += this.parts.get(i);
    const bytes = decode41(data);
    if (crc32(bytes).toString(16).toUpperCase().padStart(8, '0') !== this.crc) throw new Error('crc');
    return bytes;
  }
}

/** كائن JSON → بايتات (بايت أول: 1 = مضغوط deflate، 0 = خام). */
export async function packJson(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (hasCompression()) {
    try {
      const z = await deflateRaw(raw);
      const out = new Uint8Array(z.length + 1);
      out[0] = 1; out.set(z, 1);
      return out;
    } catch (e) { /* احتياط: بلا ضغط */ }
  }
  const out = new Uint8Array(raw.length + 1);
  out[0] = 0; out.set(raw, 1);
  return out;
}

export async function unpackJson(bytes) {
  const body = bytes.subarray(1);
  const raw = bytes[0] === 1 ? await inflateRaw(body) : body;
  return JSON.parse(new TextDecoder().decode(raw));
}
