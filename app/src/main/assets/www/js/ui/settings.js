import { h, toast, confirmDialog, messageDialog, fill, sheet } from './dom.js';
import { getSetting, setSetting } from '../settings.js';
import { exportAll, importBackup, previewImport, validateBackup, daysSince } from '../backup.js';
import { saveFileBytes, hasFolder, folderPick } from '../bridge.js';
import { getBackupFolder, setBackupFolder } from '../devstate.js';
import { saveToImportFolder, saveToNewFolder, readLatest, MANIFEST_NAME } from '../backupfolder.js';
import { buildBackupZip, backupFromZip, zipFileName } from '../zipbackup.js';
import { THEMES, getTheme, setTheme } from '../theme.js';
import { formatDate, todayISO } from '../dates.js';
import { needActive, licenseCard } from './licensecard.js';

function lastBackupText(ts) {
  const d = daysSince(ts);
  if (d === null) return 'لم تُحفظ أي نسخة احتياطية بعد.';
  const date = formatDate(todayISO(new Date(ts)));
  return d === 0 ? 'آخر نسخة: اليوم (' + date + ')' : 'آخر نسخة: قبل ' + d + ' يوم (' + date + ')';
}

const COUNT_LABELS = { customers: 'زبون', orders: 'فاتورة', debts: 'دين', payments: 'دفعة', products: 'منتج', brands: 'علامة' };
const SCOPE_OPTIONS = [['all', 'كل شيء'], ['customers', 'الزبائن فقط'], ['products', 'المنتجات فقط']];
const MODE_OPTIONS = [['merge', 'إضافة الناقص فقط'], ['replace', 'استبدال الموجود']];

const describe = (counts) => Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => n + ' ' + COUNT_LABELS[k]).join('، ');

/** نافذة خيارات الاستيراد: ماذا نستورد (الكل/الزبائن/المنتجات) وكيف (إضافة الناقص أم استبدال الموجود). */
function askImportOptions(backup, label = '') {
  return new Promise(resolve => {
    let scope = 'all';
    let mode = 'merge';
    let seq = 0;
    const scopeBox = h('div', { class: 'chips seg' });
    const modeBox = h('div', { class: 'chips seg' });
    const info = h('p', { class: 'dim', style: 'line-height:1.9' });
    const go = h('button', { class: 'btn' }, 'تنفيذ');

    function chips(box, options, current, onPick) {
      fill(box, options.map(([k, label]) =>
        h('button', { class: 'chip' + (k === current ? ' on' : ''), type: 'button', onClick: () => onPick(k) }, label)));
    }
    async function refresh() {
      chips(scopeBox, SCOPE_OPTIONS, scope, k => { scope = k; refresh(); });
      chips(modeBox, MODE_OPTIONS, mode, k => { mode = k; refresh(); });
      go.className = 'btn' + (mode === 'replace' ? ' danger' : '');
      go.disabled = true;
      const my = ++seq;
      info.textContent = '...';
      let p;
      try { p = await previewImport(backup, { scope, mode }); } catch (e) { info.textContent = 'تعذّرت المعاينة.'; return; }
      if (my !== seq) return;
      if (mode === 'merge') {
        const add = describe(p.add);
        const skip = [p.skipped.customers ? p.skipped.customers + ' زبون' : '', p.skipped.products ? p.skipped.products + ' منتج' : ''].filter(Boolean).join(' و');
        info.textContent = (add ? 'سيُضاف: ' + add + '.' : 'لا شيء جديد لإضافته.')
          + (skip ? ' يُتخطّى الموجود أصلًا: ' + skip + ' (الزبون بنفس الاسم والهاتف والوصف يُتخطّى مع ديونه).' : '')
          + ' لا يُلمس شيء من بياناتك الحالية.';
        go.disabled = !add;
      } else {
        info.textContent = 'عندك الآن: ' + (describe(p.current) || 'لا شيء') + '. سيُستبدل بما في الملف: ' + (describe(p.incoming) || 'لا شيء') + '.';
        go.disabled = false;
      }
    }
    go.addEventListener('click', () => { s.close(); resolve({ scope, mode }); });

    const s = sheet([
      h('h2', { class: 'sheet-title' }, 'استيراد من نسخة'),
      label ? h('p', { class: 'dim small' }, label) : null,
      h('p', { class: 'dim small' }, 'ماذا تستورد؟'), scopeBox,
      h('p', { class: 'dim small' }, 'كيف؟'), modeBox,
      info,
      h('div', { class: 'btn-row' }, go, h('button', { class: 'btn ghost', onClick: () => { s.close(); resolve(null); } }, 'إلغاء')),
    ]);
    refresh();
  });
}

export async function renderSettings(root) {
  const name = h('input', { class: 'input', placeholder: 'مثال: مكتبة النور', value: await getSetting('shopName', '') });
  const phone = h('input', { class: 'input', inputmode: 'tel', placeholder: 'اختياري', value: await getSetting('shopPhone', '') });
  const lastTxt = h('p', { class: 'dim' }, lastBackupText(await getSetting('lastBackupAt', 0)));

  const themeBox = h('div', { class: 'chips seg' });
  function drawThemes() {
    const cur = getTheme();
    themeBox.replaceChildren(...THEMES.map(([key, label]) =>
      h('button', { class: 'chip' + (key === cur ? ' on' : ''), type: 'button', onClick: () => { setTheme(key); drawThemes(); } }, label)));
  }
  drawThemes();

  const folderTxt = h('p', { class: 'dim' });
  function drawFolder() {
    const f = getBackupFolder();
    folderTxt.textContent = f ? 'مجلد النسخ (الاستيراد): ' + f.name : 'لم يُحدَّد مجلد للنسخ بعد.';
  }
  drawFolder();

  const errText = (e) => ({
    'no-folder': 'حدّد مجلد النسخ أولًا.',
    'no-backup': 'لا توجد نسخة احتياطية في هذا المجلد.',
    'bad-json': 'ملف النسخة تالف أو ليس JSON.',
    'no-bridge': 'هذه الميزة متاحة داخل التطبيق فقط.',
  }[e && e.message] || ('تعذّرت العملية: ' + ((e && e.message) || e)));

  async function pickFolder() {
    let f;
    try { f = await folderPick(); } catch (e) { await messageDialog(errText(e)); return null; }
    if (f) { setBackupFolder(f); drawFolder(); }
    return f;
  }

  /** مسار الاستيراد الموحَّد: فحص الملف ثم خيارات (ماذا/كيف) ثم التنفيذ. */
  async function runImportFlow(backup, label) {
    const v = validateBackup(backup);
    if (!v.ok) { await messageDialog(v.error); return; }
    const opt = await askImportOptions(backup, label);
    if (!opt) return;
    if (opt.mode === 'replace' && !(await confirmDialog('سيُحذف ما عندك الآن في النطاق المختار ويُستبدل بما في الملف، ولا يمكن التراجع. متابعة؟', 'استبدال', true))) return;
    try {
      await importBackup(backup, opt);
    } catch (e) { await messageDialog(e && e.code === 'expired' ? e.message : 'فشل الاستيراد. لم يتغيّر شيء.'); return; }
    toast(opt.mode === 'merge' ? 'تمت إضافة الناقص' : 'تم الاستبدال');
    location.hash = '#/';
    location.reload();
  }

  async function doSave() {
    if (!hasFolder()) { await messageDialog(errText({ message: 'no-bridge' })); return; }
    if (!getBackupFolder() && !(await pickFolder())) return;
    try {
      const r = await saveToImportFolder();
      lastTxt.textContent = lastBackupText(Date.now());
      toast('تم الحفظ: ' + r.fileName);
    } catch (e) { await messageDialog(errText(e)); }
  }

  async function doSaveElsewhere() {
    if (!hasFolder()) { await messageDialog(errText({ message: 'no-bridge' })); return; }
    try {
      const r = await saveToNewFolder();
      if (!r) return;
      lastTxt.textContent = lastBackupText(Date.now());
      await messageDialog('حُفظت النسخة في مجلد جديد: ' + r.folderName + '\nلاستيراد منه لاحقًا بزر «الأحدث» اجعله مجلد النسخ من «تحديد/تغيير المجلد».');
    } catch (e) { await messageDialog(errText(e)); }
  }

  async function doLatest() {
    if (!(await needActive())) return;
    let r;
    try { r = await readLatest(); } catch (e) { await messageDialog(errText(e)); return; }
    await runImportFlow(r.backup, 'الأحدث: ' + r.fileName + (r.via === 'scan' ? ' (وُجد بفحص المجلد لغياب ' + MANIFEST_NAME + ')' : ''));
  }

  async function doZip() {
    let res;
    try {
      const zip = await buildBackupZip(await exportAll());
      res = await saveFileBytes(zipFileName(), 'application/zip', zip);
    } catch (e) { await messageDialog(errText(e)); return; }
    if (res.ok) {
      await setSetting('lastBackupAt', Date.now());
      lastTxt.textContent = lastBackupText(Date.now());
      toast('تم إنشاء ملف ZIP');
    } else if (res.message) await messageDialog('فشل الحفظ: ' + res.message);
  }

  const readFile = (file, as) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    if (as === 'text') fr.readAsText(file, 'utf-8'); else fr.readAsArrayBuffer(file);
  });

  const fileInput = h('input', { type: 'file', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let text;
    try { text = String(await readFile(file, 'text')); } catch (e) { await messageDialog('تعذّرت قراءة الملف.'); return; }
    let backup;
    try { backup = JSON.parse(text); } catch (e) { await messageDialog('الملف ليس بصيغة JSON صالحة.'); return; }
    await runImportFlow(backup, 'الملف: ' + file.name);
  });

  const zipInput = h('input', { type: 'file', hidden: true });
  zipInput.addEventListener('change', async () => {
    const file = zipInput.files && zipInput.files[0];
    zipInput.value = '';
    if (!file) return;
    let backup;
    try { backup = await backupFromZip(new Uint8Array(await readFile(file, 'buffer'))); } catch (e) { await messageDialog(e.message || 'تعذّرت قراءة الملف.'); return; }
    await runImportFlow(backup, 'ZIP: ' + file.name);
  });

  fill(root,
    h('h1', { class: 'title' }, 'الإعدادات'),
    licenseCard(),
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'المظهر'),
      h('p', { class: 'dim small' }, 'داكن، أو فاتح، أو متباين (خلفية داكنة وحواف فاتحة لوضوح أعلى).'),
      themeBox),
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'بيانات المكتبة'),
      h('p', { class: 'dim small' }, 'تظهر في ترويسة كشف الحساب والفاتورة المطبوعة.'),
      h('label', { class: 'lbl' }, 'اسم المكتبة'), name,
      h('label', { class: 'lbl' }, 'هاتف المكتبة'), phone,
      h('button', { class: 'btn', onClick: async () => {
        await setSetting('shopName', name.value.trim());
        await setSetting('shopPhone', phone.value.trim());
        toast('تم الحفظ');
      } }, 'حفظ')),
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'النسخ الاحتياطي'),
      h('p', { class: 'dim small' }, 'بيانات التطبيق محفوظة داخل الهاتف فقط. مسح بيانات التطبيق أو حذفه يمسح كل شيء، فاحفظ نسخة بانتظام.'),
      lastTxt,
      folderTxt,
      h('button', { class: 'btn ghost', onClick: pickFolder }, 'تحديد / تغيير مجلد النسخ'),
      h('button', { class: 'btn', onClick: doSave }, 'حفظ نسخة احتياطية'),
      h('button', { class: 'btn ghost', onClick: doSaveElsewhere }, 'حفظ في مكان آخر (مجلد جديد)'),
      h('p', { class: 'dim small' }, 'الحفظ في مجلد النسخ يكتب ملفًا مؤرَّخًا ويحدّث ' + MANIFEST_NAME + ' ليشير إلى آخر ملف. «حفظ في مكان آخر» يُنشئ مجلدًا جديدًا باسم التاريخ داخل ما تختاره.'),
      h('button', { class: 'btn ok', onClick: doLatest }, '⚡ استيراد الأحدث'),
      h('button', { class: 'btn ghost', onClick: async () => { if (await needActive()) fileInput.click(); } }, 'استيراد من ملف JSON'),
      fileInput),
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'ملف ZIP'),
      h('p', { class: 'dim small' }, 'ZIP واحد يحوي كل بياناتك (manifest.json وbackup.json)، سهل الإرسال والحفظ.'),
      h('button', { class: 'btn', onClick: doZip }, 'إنشاء ملف ZIP بالبيانات'),
      h('button', { class: 'btn ghost', onClick: async () => { if (await needActive()) zipInput.click(); } }, 'استيراد من ملف ZIP'),
      zipInput));
}
