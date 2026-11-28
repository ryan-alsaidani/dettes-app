import assert from 'node:assert/strict';
import { encode41, decode41, makeFrames, parseFrame, extractFrames, FrameCollector, packJson, unpackJson, FRAME_RE } from '../app/src/main/assets/www/js/qrframes.js';
import { crc32 } from '../app/src/main/assets/www/js/crc32.js';
import { legacyUid, newUid, ensureUid } from '../app/src/main/assets/www/js/uid.js';

const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// CRC32 (قيمة معيارية)
assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
assert.equal(crc32(new Uint8Array([])), 0);

// Base41: ذهابًا وإيابًا لكل الأطوال، وكل القيم 0..255
for (let n = 0; n <= 200; n++) { const b = rnd(n); assert.deepEqual(Array.from(decode41(encode41(b))), Array.from(b), 'len ' + n); }
{ const all = Uint8Array.from({ length: 256 }, (_, i) => i); assert.deepEqual(Array.from(decode41(encode41(all))), Array.from(all)); }
{ const mx = new Uint8Array([255, 255, 255]); assert.deepEqual(Array.from(decode41(encode41(mx))), [255, 255, 255]); }   // أكبر قيمة
assert.equal(encode41(new Uint8Array(6)).length, 9);               // 3 رموز لكل بايتين
assert.throws(() => decode41('A'), /b41-length/);
assert.throws(() => decode41('abc'), /b41-char/);                  // حروف صغيرة غير مقبولة
assert.throws(() => decode41(':::'), /b41-range/);                 // خارج النطاق

// أبجدية الإطار كلها ضمن وضع QR الأبجدي الرقمي (لا مسافة ولا حروف صغيرة)
const QR_ALNUM = /^[0-9A-Z $%*+\-./:]+$/;

// تقطيع وتجميع
{
  const bytes = rnd(5000);
  const frames = makeFrames(bytes, { chunk: 600, sid: 'AB12' });
  assert.equal(frames.length, Math.ceil(encode41(bytes).length / 600));
  for (const f of frames) { assert.match(f, QR_ALNUM); assert.ok(FRAME_RE.test(f)); assert.ok(f.length <= 600 + 30); }
  const p = parseFrame(frames[2]);
  assert.deepEqual([p.sid, p.i, p.n], ['AB12', 3, frames.length]);

  // وصول بترتيب عشوائي مع تكرار
  const col = new FrameCollector();
  const order = [...frames.keys()].sort(() => Math.random() - 0.5);
  for (const i of order) { assert.equal(col.add(frames[i]).status, 'new'); assert.equal(col.add(frames[i]).status, 'dup'); }
  assert.ok(col.complete());
  assert.deepEqual(Array.from(col.assemble()), Array.from(bytes));
}

// «فاتك رمز»: تجاوز المستخدم إطارات
{
  const frames = makeFrames(rnd(4000), { chunk: 500, sid: 'ZZ99' });
  assert.ok(frames.length >= 8);
  const col = new FrameCollector();
  col.add(frames[0]); col.add(frames[1]);
  assert.deepEqual(col.skipped(), []);
  col.add(frames[4]);                                   // قفز من 2 إلى 5
  assert.deepEqual(col.skipped(), [3, 4]);
  assert.deepEqual(col.missing().slice(0, 2), [3, 4]);
  assert.ok(!col.complete());
  assert.throws(() => col.assemble(), /incomplete/);
  col.add(frames[2]);
  assert.deepEqual(col.skipped(), [4]);
  col.add(frames[3]);
  assert.deepEqual(col.skipped(), []);
  for (let i = 5; i < frames.length; i++) col.add(frames[i]);
  assert.ok(col.complete());
  assert.equal(col.skipped().length, 0);
}

// عمليتا إرسال مختلفتان: لا تُخلطان
{
  const a = makeFrames(rnd(2000), { chunk: 400, sid: 'AAAA' });
  const b = makeFrames(rnd(2000), { chunk: 400, sid: 'BBBB' });
  const col = new FrameCollector();
  assert.equal(col.add(a[0]).status, 'new');
  assert.deepEqual(col.add(b[1]), { status: 'other', sid: 'BBBB' });
  assert.equal(col.have, 1);
  col.reset();
  assert.equal(col.add(b[1]).status, 'new');
}

// إطار تالف: CRC الكلي يكشفه
{
  const bytes = rnd(1500);
  const frames = makeFrames(bytes, { chunk: 300, sid: 'CRC1' });
  const bad = frames.slice();
  const f = parseFrame(bad[1]);
  const flipped = f.data[0] === 'A' ? 'B' : 'A';
  bad[1] = bad[1].replace(':' + f.data, ':' + flipped + f.data.slice(1));
  const col = new FrameCollector();
  for (const x of bad) col.add(x);
  assert.ok(col.complete());
  assert.throws(() => col.assemble(), /crc/);
}

// نص ملصوق من تطبيق مراسلة: كلام عربي وأسطر وإطارات متفرقة
{
  const bytes = rnd(3000);
  const frames = makeFrames(bytes, { chunk: 700, sid: 'TXT1' });
  const msg1 = 'تحديثات دفتر الديون — الصق في «استلام تحديثات»\n' + frames.slice(0, 3).join('\n') + '\nشكرًا';
  const msg2 = frames.slice(3).join('  \n  ') + '\n';
  const col = new FrameCollector();
  for (const f of extractFrames(msg1 + '\n' + msg2)) col.add(f);
  assert.ok(col.complete());
  assert.deepEqual(Array.from(col.assemble()), Array.from(bytes));
  assert.deepEqual(extractFrames('لا شيء هنا'), []);
  assert.equal(parseFrame('DQ1:ABCD:0:5:00000000:XYZ'), null);          // رقم 0
  assert.equal(parseFrame('DQ1:ABCD:6:5:00000000:XYZ'), null);          // أكبر من العدد
  assert.equal(parseFrame('DQ1:abcd:1:5:00000000:XYZ'), null);          // معرّف بحروف صغيرة
}

// ضغط وفك JSON عربي كبير
{
  const obj = { app: 'x', rows: Array.from({ length: 800 }, (_, i) => ({ name: 'زبون رقم ' + i, note: 'ابن الجيران', n: i * 7 })) };
  const packed = await packJson(obj);
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  assert.ok(packed.length < raw.length / 3, 'الضغط ضعيف: ' + packed.length + '/' + raw.length);
  assert.deepEqual(await unpackJson(packed), obj);
  // بلا ضغط (راية 0)
  const manual = new Uint8Array(raw.length + 1); manual[0] = 0; manual.set(raw, 1);
  assert.deepEqual(await unpackJson(manual), obj);
}

// المعرّفات
assert.equal(newUid().length, 16);
assert.notEqual(newUid(), newUid());
const rec = { id: 5, createdAt: 1700000000000, name: 'أحمد' };
assert.equal(legacyUid('customers', rec), legacyUid('customers', { ...rec }));           // حتمي
assert.notEqual(legacyUid('customers', rec), legacyUid('customers', { ...rec, id: 6 }));
assert.notEqual(legacyUid('customers', rec), legacyUid('products', rec));
assert.match(legacyUid('debts', rec), /^L[0-9a-v]{22}$/);
assert.equal(ensureUid('customers', { ...rec, uid: 'ABC' }), 'ABC');
assert.equal(ensureUid('customers', rec), legacyUid('customers', rec));

console.log('qrframes tests OK');
