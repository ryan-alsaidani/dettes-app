import { h, toast, confirmDialog, messageDialog, fill, sheet } from './dom.js';
import { getSetting, setSetting } from '../settings.js';
import { exportAll, importBackup, previewImport, validateBackup, backupFileName, daysSince } from '../backup.js';
import { hasSave, saveFile } from '../bridge.js';
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
function askImportOptions(backup) {
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

  async function doExport() {
    if (!hasSave()) { await messageDialog('الحفظ متاح داخل التطبيق فقط.'); return; }
    const backup = await exportAll();
    let res;
    try {
      res = await saveFile(backupFileName(), 'application/json', JSON.stringify(backup));
    } catch (e) {
      await messageDialog('تعذّر فتح نافذة الحفظ.');
      return;
    }
    if (res.ok) {
      const now = Date.now();
      await setSetting('lastBackupAt', now);
      lastTxt.textContent = lastBackupText(now);
      toast('تم حفظ النسخة الاحتياطية');
    } else if (res.message) {
      await messageDialog('فشل الحفظ: ' + res.message);
    }
  }

  const fileInput = h('input', { type: 'file', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let text;
    try {
      text = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsText(file, 'utf-8');
      });
    } catch (e) { await messageDialog('تعذّرت قراءة الملف.'); return; }

    let backup;
    try { backup = JSON.parse(text); } catch (e) { await messageDialog('الملف ليس بصيغة JSON صالحة.'); return; }
    const v = validateBackup(backup);
    if (!v.ok) { await messageDialog(v.error); return; }

    const opt = await askImportOptions(backup);
    if (!opt) return;
    if (opt.mode === 'replace' && !(await confirmDialog('سيُحذف ما عندك الآن في النطاق المختار ويُستبدل بما في الملف، ولا يمكن التراجع. متابعة؟', 'استبدال', true))) return;
    let r;
    try {
      r = await importBackup(backup, opt);
    } catch (e) { await messageDialog(e && e.message && e.code === 'expired' ? e.message : 'فشل الاستيراد. لم يتغيّر شيء.'); return; }
    toast(opt.mode === 'merge' ? 'تمت إضافة الناقص' : 'تم الاستبدال');
    location.hash = '#/';
    location.reload();
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
      h('p', { class: 'dim small' }, 'بيانات التطبيق محفوظة داخل الهاتف فقط. مسح بيانات التطبيق أو حذفه يمسح كل شيء، فاحفظ نسخة بانتظام في مكان آمن (التنزيلات أو Drive أو أرسلها لنفسك).'),
      lastTxt,
      h('button', { class: 'btn', onClick: doExport }, 'حفظ نسخة احتياطية'),
      h('button', { class: 'btn ghost', onClick: async () => { if (await needActive()) fileInput.click(); } }, 'استيراد من نسخة'),
      fileInput));
}
