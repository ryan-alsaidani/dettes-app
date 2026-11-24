import { h } from './dom.js';

export function renderProducts(root) {
  root.replaceChildren(
    h('h1', { class: 'title' }, 'المنتجات'),
    h('div', { class: 'card empty' }, 'إدارة المنتجات والباركود تأتي في المرحلة 2.'));
}
