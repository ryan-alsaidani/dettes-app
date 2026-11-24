import { h } from './dom.js';

export function renderSettings(root) {
  root.replaceChildren(
    h('h1', { class: 'title' }, 'الإعدادات'),
    h('div', { class: 'card empty' }, 'اسم المكتبة والنسخ الاحتياطي يأتيان في المرحلة 6.'));
}
