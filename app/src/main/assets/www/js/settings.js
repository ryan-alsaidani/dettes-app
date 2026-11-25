import * as db from './db.js';

// settings: مخزن مفاتيح/قيم ({key, value}): shopName, shopPhone, lastBackupAt ...
export async function getSetting(key, fallback = '') {
  const rec = await db.get('settings', key);
  return rec && rec.value !== undefined && rec.value !== null ? rec.value : fallback;
}

export function setSetting(key, value) {
  return db.put('settings', { key, value });
}
