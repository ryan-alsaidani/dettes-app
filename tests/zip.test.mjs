import assert from 'node:assert/strict';
import { makeZip, readZip } from '../app/src/main/assets/www/js/zip.js';
import { bytesToBase64, base64ToBytes } from '../app/src/main/assets/www/js/compress.js';

const enc = new TextEncoder();
const rnd = (n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(o.subarray(i, Math.min(n, i + 65536))); return o; };
const files = [
  { name: 'manifest.json', data: enc.encode('{"app":"dettes-app"}') },
  { name: 'backup.json', data: enc.encode(JSON.stringify({ rows: Array.from({ length: 3000 }, (_, i) => 'زبون ' + i) })) },
  { name: 'ثنائي.bin', data: rnd(5000) },
  { name: 'فارغ.txt', data: new Uint8Array(0) },
];

for (const compress of [true, false]) {
  const zip = await makeZip(files, { compress });
  const back = await readZip(zip);
  assert.equal(back.length, files.length);
  for (let i = 0; i < files.length; i++) {
    assert.equal(back[i].name, files[i].name);
    assert.deepEqual(Array.from(back[i].data), Array.from(files[i].data));
  }
  if (compress) assert.ok(zip.length < files.reduce((s, f) => s + f.data.length, 0) / 2, 'ضغط ضعيف');
}

// تلف: بايت واحد في البيانات يكشفه CRC
{
  const zip = await makeZip([{ name: 'a.txt', data: enc.encode('x'.repeat(500)) }], { compress: false });
  const bad = zip.slice(); bad[60] ^= 0xFF;
  await assert.rejects(readZip(bad), /zip-crc/);
}
await assert.rejects(readZip(new Uint8Array(10)), /zip-format/);
await assert.rejects(readZip(enc.encode('هذا ليس ملف zip إطلاقًا ' + 'x'.repeat(100))), /zip-format/);

// base64
for (const n of [0, 1, 2, 3, 100, 100000]) { const b = rnd(n); assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(b))), Array.from(b)); }

console.log('zip tests OK');
