// هوية الزبون/المنتج للمطابقة (نقية).
import { normalize } from './search.js';

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** الاسم الموحَّد + أرقام الهاتف + الوصف (فأحمدان بوصفين مختلفين زبونان مختلفان). */
export const customerKey = (c) => [c.nameNorm || normalize(c.name), digits(c.phone), normalize(c.note || '')].join('|');

/** الباركود إن وُجد، وإلا الاسم + العلامة. */
export const productKey = (p) => (p.barcode
  ? 'b:' + String(p.barcode).trim()
  : 'n:' + [p.nameNorm || normalize(p.name), p.brandNorm || normalize(p.brand || '')].join('|'));
