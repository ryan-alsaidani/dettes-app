import assert from 'node:assert/strict';
import { b32encode, b32decode, encodeDeviceCode, parseDeviceCode, extractCode, crc8, licensePayload, parseLicense, toHex, fromHex } from '../app/src/main/assets/www/js/license-codec.js';
import { checkKey, statusFromState, DAY_MS, isLicenseRecord, LicenseError, formatRemaining } from '../app/src/main/assets/www/js/license.js';
import { signLicense } from '../tools/license-sign.js';

const subtle = globalThis.crypto.subtle;
const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// ---- Base32 ----
for (let n = 0; n <= 60; n++) {
  const b = rnd(n);
  assert.deepEqual(Array.from(b32decode(b32encode(b))), Array.from(b), 'len ' + n);
}
assert.deepEqual(Array.from(b32decode('0o1il')), Array.from(b32decode('00111')));      // التباسات الحروف
assert.deepEqual(Array.from(b32decode('ab-cd ef')), Array.from(b32decode('ABCDEF')));  // فواصل وحالة الأحرف
assert.throws(() => b32decode('AB$CD'), e => e.code === 'chars');
assert.equal(crc8(new Uint8Array([])), 0);
assert.notEqual(crc8(new Uint8Array([1, 2, 3])), crc8(new Uint8Array([1, 2, 4])));

// ---- رمز الجهاز ----
const nonce = rnd(10);
const code = encodeDeviceCode({ nonce, name: 'مكتبة النور', phone: '71 000 000' });
assert.match(code, /^[0-9A-Z-]+$/);
const dev = parseDeviceCode(code);
assert.equal(dev.name, 'مكتبة النور');
assert.equal(dev.phone, '71 000 000');
assert.equal(dev.nonceHex, toHex(nonce));
// بلا بيانات مكتبة
const bare = parseDeviceCode(encodeDeviceCode({ nonce, name: '', phone: '' }));
assert.equal(bare.name, ''); assert.equal(bare.phone, '');
// اسم بلا هاتف، وهاتف بلا اسم
assert.deepEqual([parseDeviceCode(encodeDeviceCode({ nonce, name: 'س' })).name, parseDeviceCode(encodeDeviceCode({ nonce, name: 'س' })).phone], ['س', '']);
assert.equal(parseDeviceCode(encodeDeviceCode({ nonce, phone: '55' })).phone, '55');
// الاقتطاع وسطر جديد داخل الاسم
const long = parseDeviceCode(encodeDeviceCode({ nonce, name: 'ا'.repeat(100) + '\nx', phone: '9'.repeat(50) }));
assert.equal(Array.from(long.name).length, 40);
assert.equal(long.phone.length, 20);
assert.ok(!long.name.includes('\n'));
// كلام عربي حول الرمز (رسالة واتساب)
assert.equal(parseDeviceCode('رمز جهازي لتجديد دفتر الديون:\n' + code + '\nشكرًا').nonceHex, toHex(nonce));
assert.equal(extractCode('abc def-ghi'), 'ABC DEF-GHI');
assert.throws(() => extractCode('لا رمز هنا'), e => e.code === 'empty');
// أي تغيير في حرف واحد: إما يُكشف أو لا يغيّر المحتوى (بتات الحشو الأخيرة)
{
  const chars = code.replace(/-/g, '');
  for (let i = 0; i < chars.length; i++) {
    const swap = chars[i] === 'A' ? 'B' : 'A';
    const bad = chars.slice(0, i) + swap + chars.slice(i + 1);
    try {
      const p = parseDeviceCode(bad);
      assert.deepEqual([p.nonceHex, p.name, p.phone], [dev.nonceHex, dev.name, dev.phone], 'تغيير صامت عند ' + i);
    } catch (e) { assert.ok(['crc', 'chars', 'short', 'version'].includes(e.code)); }
  }
  assert.throws(() => parseDeviceCode(chars.slice(0, 10)), e => ['short', 'crc'].includes(e.code)); // رمز ناقص
}

// ---- التوقيع والتحقق ----
const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const toJwk = async (k, priv) => { const j = await subtle.exportKey('jwk', k); const o = { kty: j.kty, crv: j.crv, x: j.x, y: j.y }; if (priv) o.d = j.d; return o; };
const PRIV = await toJwk(kp.privateKey, true);
const PUB = await toJwk(kp.publicKey, false);
const kp2 = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const PRIV2 = await toJwk(kp2.privateKey, true);

const NOW = Date.UTC(2026, 5, 1, 12);
const state = (over = {}) => ({ nonce: toHex(nonce), expiresAt: NOW + 5 * DAY_MS, lastSeen: NOW, trial: true, ...over });
const issue = async (days, priv = PRIV, text = code) => (await signLicense(priv, text, days)).key;
const expectCode = async (p, c) => { try { await p; assert.fail('كان يجب أن يفشل'); } catch (e) { assert.ok(e instanceof LicenseError, String(e)); assert.equal(e.code, c); } };

{
  const { shop, key } = await signLicense(PRIV, code, 30);
  assert.deepEqual(shop, { name: 'مكتبة النور', phone: '71 000 000' });
  assert.match(key, /^[0-9A-Z-]+$/);
  const parsed = parseLicense(key);
  assert.equal(parsed.days, 30);
  assert.equal(parsed.nonceHex, toHex(nonce));
  assert.equal(parsed.sig.length, 64);
  assert.ok(key.replace(/-/g, '').length === 124);        // 77 بايت

  // نجاح: يُضاف 30 يومًا إلى ما بقي (5 أيام)، ويتبدّل رمز الجهاز، وتنتهي التجربة
  const r = await checkKey({ text: key, state: state(), publicJwk: PUB, subtle, now: NOW });
  assert.equal(r.days, 30);
  assert.equal(r.state.expiresAt, NOW + 35 * DAY_MS);
  assert.equal(r.state.trial, false);
  assert.notEqual(r.state.nonce, toHex(nonce));
  assert.equal(r.state.nonce.length, 20);
  // إعادة استعمال المفتاح نفسه بعد النجاح تفشل (الرمز تبدّل)
  await expectCode(checkKey({ text: key, state: r.state, publicJwk: PUB, subtle, now: NOW }), 'device');
  // وتجاهل التنسيق: حروف صغيرة ومسافات وكلام حوله
  const messy = 'المفتاح:\n' + key.toLowerCase().replace(/-/g, ' ') + '\nمع الشكر';
  assert.equal((await checkKey({ text: messy, state: state(), publicJwk: PUB, subtle, now: NOW })).days, 30);
}

// اشتراك منتهٍ: المدة تُحسب من الآن لا من الماضي
{
  const r = await checkKey({ text: await issue(30), state: state({ expiresAt: NOW - 10 * DAY_MS }), publicJwk: PUB, subtle, now: NOW });
  assert.equal(r.state.expiresAt, NOW + 30 * DAY_MS);
}
// إرجاع ساعة الهاتف للخلف لا يفيد: lastSeen يمنع
{
  const r = await checkKey({ text: await issue(10), state: state({ lastSeen: NOW + 3 * DAY_MS, expiresAt: NOW + 1 * DAY_MS }), publicJwk: PUB, subtle, now: NOW });
  assert.equal(r.state.expiresAt, NOW + 3 * DAY_MS + 10 * DAY_MS);
  assert.equal(statusFromState({ expiresAt: NOW + DAY_MS, lastSeen: NOW + 3 * DAY_MS }, NOW).active, false);
}
// جهاز آخر
await expectCode(checkKey({ text: await issue(30), state: state({ nonce: toHex(rnd(10)) }), publicJwk: PUB, subtle, now: NOW }), 'device');
// مفتاح موقَّع بمفتاح خاص آخر (مزوَّر)
await expectCode(checkKey({ text: await issue(30, PRIV2), state: state(), publicJwk: PUB, subtle, now: NOW }), 'signature');
// تغيير عدد الأيام داخل المفتاح (محاولة رفع المدة) يُبطل التوقيع
{
  const p = parseLicense(await issue(1));
  const forged = new Uint8Array(p.payload); forged[11] = 0x0F; forged[12] = 0xFF; // 4095 يومًا
  const bytes = new Uint8Array(77); bytes.set(forged); bytes.set(p.sig, 13);
  const text = (await import('../app/src/main/assets/www/js/license-codec.js')).b32encode(bytes);
  await expectCode(checkKey({ text, state: state(), publicJwk: PUB, subtle, now: NOW }), 'signature');
}
// مفتاح تالف/ناقص/غير مفهوم
{
  const k = (await issue(30)).replace(/-/g, '');
  await expectCode(checkKey({ text: k.slice(0, 80), state: state(), publicJwk: PUB, subtle, now: NOW }), 'format');
  await expectCode(checkKey({ text: 'مرحبا', state: state(), publicJwk: PUB, subtle, now: NOW }), 'format');
  const flip = k.slice(0, 40) + (k[40] === 'A' ? 'B' : 'A') + k.slice(41);
  await expectCode(checkKey({ text: flip, state: state(), publicJwk: PUB, subtle, now: NOW }), 'signature');
}
// حدود المدة
assert.equal(parseLicense((await signLicense(PRIV, code, 1)).key).days, 1);
assert.equal(parseLicense((await signLicense(PRIV, code, 65535)).key).days, 65535);
await assert.rejects(signLicense(PRIV, code, 0));
await assert.rejects(signLicense(PRIV, code, 65536));
await assert.rejects(signLicense(PRIV, code, 1.5));
await assert.rejects(signLicense(PRIV, 'رمز غير صالح', 30));

// ---- الحالة ----
{
  const s = statusFromState({ expiresAt: NOW + 2.2 * DAY_MS, lastSeen: NOW, trial: false }, NOW);
  assert.deepEqual([s.active, s.daysLeft, s.trial], [true, 3, false]);
  assert.equal(statusFromState({ expiresAt: NOW, lastSeen: NOW }, NOW).active, false);       // لحظة الانتهاء
  assert.equal(statusFromState({ expiresAt: NOW - 1, lastSeen: NOW }, NOW).daysLeft, 0);
  assert.equal(statusFromState({ expiresAt: NOW + 1, lastSeen: NOW }, NOW).daysLeft, 1);
}
assert.equal(isLicenseRecord({ key: 'lic_state', value: {} }), true);
assert.equal(isLicenseRecord({ key: 'shopName' }), false);
assert.equal(isLicenseRecord(null), false);

// تنسيق المدة المتبقية
assert.deepEqual(formatRemaining(1), { num: '1', unit: 'يوم متبقٍ' });
assert.deepEqual(formatRemaining(5), { num: '5', unit: 'أيام متبقية' });
assert.deepEqual(formatRemaining(365), { num: '365', unit: 'أيام متبقية' });
assert.deepEqual(formatRemaining(730), { num: '2', unit: 'سنة متبقية' });
assert.deepEqual(formatRemaining(36524), { num: '100', unit: 'سنة متبقية' });
assert.deepEqual(formatRemaining(548), { num: '1.5', unit: 'سنة متبقية' });

console.log('license tests OK');
