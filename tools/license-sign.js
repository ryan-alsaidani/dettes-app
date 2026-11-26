// توقيع مفتاح تجديد. يستعمله «مولّد المفاتيح» (صفحة HTML). لا يحوي أي مفتاح خاص: يستلمه معاملًا.
import { parseDeviceCode, licensePayload, signingBytes, encodeLicense } from '../app/src/main/assets/www/js/license-codec.js';

/** يعيد { shop:{name,phone}, key } لرمز جهاز وعدد أيام. */
export async function signLicense(privateJwk, deviceCodeText, days, subtle = globalThis.crypto.subtle) {
  const dev = parseDeviceCode(deviceCodeText);
  const payload = licensePayload(dev.nonce, days);
  const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingBytes(payload)));
  return { shop: { name: dev.name, phone: dev.phone }, key: encodeLicense(payload, sig) };
}
