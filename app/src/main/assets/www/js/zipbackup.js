// نسخة احتياطية داخل ZIP: manifest.json + backup.json.
import { makeZip, readZip } from './zip.js';
import { STORES } from './backup.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function backupCounts(backup) {
  const counts = {};
  for (const s of STORES) counts[s] = (backup.stores && backup.stores[s] || []).length;
  return counts;
}

export async function buildBackupZip(backup, now = new Date()) {
  const manifest = { app: 'dettes-app', kind: 'zip', createdAt: now.getTime(), counts: backupCounts(backup) };
  return makeZip([
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest)) },
    { name: 'backup.json', data: enc.encode(JSON.stringify(backup)) },
  ], { now });
}

/** يستخرج كائن النسخة من ZIP (يرمي Error برسالة عربية). */
export async function backupFromZip(bytes) {
  let files;
  try { files = await readZip(bytes); } catch (e) {
    const m = String(e && e.message);
    if (m === 'zip-method') throw new Error('طريقة الضغط في هذا الملف غير مدعومة.');
    if (m === 'zip-crc') throw new Error('الملف تالف (فشل فحص السلامة).');
    if (m.includes('Decompression') || m.includes('not defined')) throw new Error('هذا الجهاز لا يدعم فك الضغط.');
    throw new Error('هذا الملف ليس ZIP صالحًا.');
  }
  const byName = (n) => files.find(f => f.name === n || f.name.endsWith('/' + n));
  const entry = byName('backup.json') || files.find(f => f.name.toLowerCase().endsWith('.json') && !f.name.endsWith('manifest.json'));
  if (!entry) throw new Error('لا يوجد ملف نسخة احتياطية (backup.json) داخل الـZIP.');
  try { return JSON.parse(dec.decode(entry.data)); } catch (e) { throw new Error('ملف النسخة داخل الـZIP ليس JSON صالحًا.'); }
}

export function zipFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `dettes-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}.zip`;
}
