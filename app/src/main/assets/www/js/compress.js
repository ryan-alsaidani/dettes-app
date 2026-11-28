// ضغط/فك ضغط deflate-raw عبر CompressionStream (متوفر في WebView الحديث). تُستعمل في الإطارات وZIP.

export const hasCompression = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(stream, bytes) {
  const w = stream.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

export const deflateRaw = (bytes) => pipe(new CompressionStream('deflate-raw'), bytes);
export const inflateRaw = (bytes) => pipe(new DecompressionStream('deflate-raw'), bytes);

export function bytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
