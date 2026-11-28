// مجلد النسخ الاحتياطية: حفظ ملف مؤرَّخ + latest.json (يشير لآخر ملف)، و«استيراد الأحدث».
import { exportAll } from './backup.js';
import { backupCounts } from './zipbackup.js';
import { folderPick, folderWrite, folderRead, folderList } from './bridge.js';
import { getBackupFolder } from './devstate.js';
import { setSetting } from './settings.js';

export const MANIFEST_NAME = 'latest.json';
const enc = new TextEncoder();
const dec = new TextDecoder();
const p2 = (n) => String(n).padStart(2, '0');

export const stampOf = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
export const backupFileNameAt = (d) => `dettes-backup-${stampOf(d)}.json`;
export const backupFolderNameAt = (d) => `dettes-backup-${stampOf(d)}`;

export function buildManifest(fileName, backup, now = Date.now()) {
  return { app: 'dettes-app', kind: 'latest', file: fileName, createdAt: now, exportedAt: backup.exportedAt || now, counts: backupCounts(backup) };
}

/** يقبل manifest سليمًا فقط: اسم ملف بسيط بلا مسارات. */
export function parseManifest(text) {
  try {
    const m = JSON.parse(text);
    if (m && m.app === 'dettes-app' && typeof m.file === 'string' && m.file && !/[\\/]/.test(m.file)) return m;
  } catch (e) { /* غير صالح */ }
  return null;
}

/** أحدث ملف نسخة في قائمة محتويات المجلد (بحسب وقت التعديل ثم الاسم). */
export function pickNewest(list) {
  const files = (list || []).filter(f => !f.dir && /^dettes-backup-.*\.json$/.test(f.name));
  files.sort((a, b) => (b.modified - a.modified) || (a.name < b.name ? 1 : -1));
  return files[0] || null;
}

async function writeBackupInto(folderUri, subDir, backup, now) {
  const fileName = backupFileNameAt(now);
  await folderWrite(folderUri, subDir, fileName, 'application/json', enc.encode(JSON.stringify(backup)));
  await folderWrite(folderUri, subDir, MANIFEST_NAME, 'application/json', enc.encode(JSON.stringify(buildManifest(fileName, backup, now.getTime()))));
  await setSetting('lastBackupAt', now.getTime());
  return fileName;
}

/** يحفظ في مجلد الاستيراد المحدَّد: ملف مؤرَّخ + تحديث latest.json. يرمي Error('no-folder') إن لم يُحدَّد. */
export async function saveToImportFolder() {
  const folder = getBackupFolder();
  if (!folder) throw new Error('no-folder');
  const now = new Date();
  const backup = await exportAll(now.getTime());
  const fileName = await writeBackupInto(folder.uri, '', backup, now);
  return { fileName, folderName: folder.name };
}

/** يحفظ في مكان آخر: يولّد مجلدًا جديدًا (باسم التاريخ) داخل ما تختاره ويكتب فيه الملف وlatest.json. null عند الإلغاء. */
export async function saveToNewFolder() {
  const picked = await folderPick();
  if (!picked) return null;
  const now = new Date();
  const backup = await exportAll(now.getTime());
  const subDir = backupFolderNameAt(now);
  const fileName = await writeBackupInto(picked.uri, subDir, backup, now);
  return { fileName, folderName: picked.name + ' / ' + subDir };
}

/** «اختصار الأحدث»: يقرأ latest.json ثم الملف الذي يشير إليه؛ وإلا يفحص المجلد عن أحدث ملف. */
export async function readLatest() {
  const folder = getBackupFolder();
  if (!folder) throw new Error('no-folder');
  let fileName = null;
  let via = 'manifest';
  const mBytes = await folderRead(folder.uri, '', MANIFEST_NAME);
  const manifest = mBytes ? parseManifest(dec.decode(mBytes)) : null;
  if (manifest) fileName = manifest.file;
  let bytes = fileName ? await folderRead(folder.uri, '', fileName) : null;
  if (!bytes) {
    via = 'scan';
    const newest = pickNewest(await folderList(folder.uri, ''));
    if (!newest) throw new Error('no-backup');
    fileName = newest.name;
    bytes = await folderRead(folder.uri, '', fileName);
    if (!bytes) throw new Error('no-backup');
  }
  let backup;
  try { backup = JSON.parse(dec.decode(bytes)); } catch (e) { throw new Error('bad-json'); }
  return { backup, fileName, via, folderName: folder.name };
}
