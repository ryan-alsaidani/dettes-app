import { h, toast, confirmDialog, messageDialog } from './dom.js';
import { getSetting, setSetting } from '../settings.js';
import { exportAll, importAll, validateBackup, backupFileName, daysSince } from '../backup.js';
import { hasSave, saveFile } from '../bridge.js';
import { formatDate, todayISO } from '../dates.js';
import { needActive, licenseCard } from './licensecard.js';

function lastBackupText(ts) {
  const d = daysSince(ts);
  if (d === null) return 'لم تُحفظ أي نسخة احتياطية بعد.';
  const date = formatDate(todayISO(new Date(ts)));
  return d === 0 ? 'آخر نسخة: اليوم (' + date + ')' : 'آخر نسخة: قبل ' + d + ' يوم (' + date + ')';
}

export async function renderSettings(root) {
  const name = h('input', { class: 'input', placeholder: 'مثال: مكتبة النور', value: await getSetting('shopName', '') });
  const phone = h('input', { class: 'input', inputmode: 'tel', placeholder: 'اختياري', value: await getSetting('shopPhone', '') });
  const lastTxt = h('p', { class: 'dim' }, lastBackupText(await getSetting('lastBackupAt', 0)));

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

    const c = v.counts;
    const msg = `النسخة تحوي ${c.customers} زبون و${c.debts} دين و${c.products} منتج و${c.payments} دفعة. سيُستبدل بها كل ما في التطبيق الآن ولا يمكن التراجع. متابعة؟`;
    if (!(await confirmDialog(msg, 'استرجاع', true))) return;
    try {
      await importAll(backup);
    } catch (e) { await messageDialog('فشل الاسترجاع. لم يتغيّر شيء.'); return; }
    toast('تم الاسترجاع');
    location.hash = '#/';
    location.reload();
  });

  root.replaceChildren(
    h('h1', { class: 'title' }, 'الإعدادات'),
    licenseCard(),
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
      h('button', { class: 'btn ghost', onClick: async () => { if (await needActive()) fileInput.click(); } }, 'استرجاع من نسخة'),
      fileInput));
}
