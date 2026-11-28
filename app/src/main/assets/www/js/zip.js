// ZIP بسيط بلا مكتبات: كتابة (مخزَّن أو deflate) وقراءة (مخزَّن/deflate). أسماء UTF-8. بلا ZIP64.
import { crc32 } from './crc32.js';
import { deflateRaw, inflateRaw, hasCompression } from './compress.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function dosParts(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** files: [{name, data: Uint8Array}] → Uint8Array لملف ZIP. */
export async function makeZip(files, { now = new Date(), compress = true } = {}) {
  const { time, date } = dosParts(now);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let method = 0;
    let body = f.data;
    if (compress && hasCompression() && f.data.length > 64) {
      const z = await deflateRaw(f.data);
      if (z.length < f.data.length) { method = 8; body = z; }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);          // أسماء UTF-8
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, body);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/** يقرأ ZIP ويعيد [{name, data}] بعد التحقق من CRC. يرمي Error('zip-...') عند الفساد/عدم الدعم. */
export async function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip-format');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip-format');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const loff = dv.getUint32(p + 42, true);
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || loff === 0xFFFFFFFF) throw new Error('zip-64');
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (loff + 30 > bytes.length || dv.getUint32(loff, true) !== 0x04034b50) throw new Error('zip-format');
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    const body = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = body.slice();
    else if (method === 8) data = await inflateRaw(body);
    else throw new Error('zip-method');
    if (data.length !== usize || crc32(data) !== crc) throw new Error('zip-crc');
    out.push({ name, data });
  }
  return out;
}
