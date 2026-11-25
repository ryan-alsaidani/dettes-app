import * as db from './db.js';
import { normalize } from './search.js';
import { formatMillimes, toInputString } from './money.js';

export const listProducts = () => db.getAll('products');
export const getProduct = (id) => db.get('products', id);
export const deleteProduct = (id) => db.del('products', id);

export async function listBrands() {
  const brands = await db.getAll('brands');
  return brands.map(b => b.name).sort((a, b) => a.localeCompare(b, 'ar'));
}

export async function findByBarcode(code) {
  const c = String(code ?? '').trim();
  if (!c) return null;
  const hits = await db.getAllByIndex('products', 'barcode', c);
  return hits[0] || null;
}

/** price بالمليم (عدد صحيح). يرمي Error برسالة عربية عند خطأ في المدخلات. */
export async function saveProduct({ id, name, barcode, brand, price, weight, description }) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('الاسم مطلوب');
  if (!Number.isInteger(price) || price < 0) throw new Error('السعر غير صالح');

  const code = String(barcode ?? '').trim() || null;
  if (code) {
    const same = (await db.getAllByIndex('products', 'barcode', code)).find(p => p.id !== id);
    if (same) throw new Error('هذا الباركود مسجَّل للمنتج: ' + same.name);
  }

  // العلامة: إن وُجدت علامة بنفس الصيغة الموحَّدة نعيد استعمالها، وإلا تُضاف للاقتراحات.
  let b = String(brand ?? '').trim() || null;
  if (b) {
    const existing = (await db.getAll('brands')).find(x => normalize(x.name) === normalize(b));
    if (existing) b = existing.name;
    else await db.put('brands', { name: b });
  }

  const old = id ? await db.get('products', id) : null;
  const obj = {
    ...(old || {}),
    name: clean,
    nameNorm: normalize(clean),
    barcode: code,
    brand: b,
    brandNorm: b ? normalize(b) : '',
    price,
    weight: String(weight ?? '').trim() || null,
    description: String(description ?? '').trim() || null,
    createdAt: old ? old.createdAt : Date.now(),
  };
  if (id) obj.id = id;
  return db.put('products', obj);
}

/** نص البحث الموحَّد لمنتج: الاسم والعلامة والباركود والوزن والوصف والسعر. */
export function productHaystack(p) {
  return normalize([
    p.name, p.brand, p.barcode, p.weight, p.description,
    toInputString(p.price), formatMillimes(p.price),
  ].filter(Boolean).join(' '));
}
