import { h, toast } from './dom.js';
import { getSetting, setSetting } from '../settings.js';

export async function renderSettings(root) {
  const name = h('input', { class: 'input', placeholder: 'مثال: مكتبة النور', value: await getSetting('shopName', '') });
  const phone = h('input', { class: 'input', inputmode: 'tel', placeholder: 'اختياري', value: await getSetting('shopPhone', '') });
  root.replaceChildren(
    h('h1', { class: 'title' }, 'الإعدادات'),
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
    h('div', { class: 'card empty' }, 'النسخ الاحتياطي والاستيراد يأتيان في المرحلة 6.'));
}
