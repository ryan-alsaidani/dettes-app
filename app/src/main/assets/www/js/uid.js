// معرّفات فريدة للسجلات (uid): تلزم لدمج التحديثات بين جهازين، فالأرقام المحلية (id) تتصادم بين الأجهزة.
import { b32encode } from './license-codec.js';

/** معرّف عشوائي جديد (80 بتًّا، 16 حرفًا). */
export const newUid = () => b32encode(globalThis.crypto.getRandomValues(new Uint8Array(10)));

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * معرّف «قديم» حتمي للسجلات التي أُنشئت قبل نظام المعرّفات: يُحسب من محتواها،
 * فإذا كان جهازان قد نُسخا من نفس النسخة الاحتياطية خرجا بنفس المعرّفات (فلا يتكرر شيء عند أول تبادل).
 */
export function legacyUid(kind, rec) {
  const s = [kind, rec.id, rec.createdAt ?? '', rec.name ?? rec.nameSnapshot ?? '', rec.date ?? '',
    rec.unitPrice ?? '', rec.qty ?? '', rec.amount ?? '', rec.customerId ?? '', rec.orderId ?? ''].join('|');
  return 'L' + cyrb53(s, 1).toString(32).padStart(11, '0') + cyrb53(s, 2).toString(32).padStart(11, '0');
}

export const ensureUid = (kind, rec) => rec.uid || legacyUid(kind, rec);
