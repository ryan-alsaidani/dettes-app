import { openDB } from './db.js';
import { h } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderCustomer } from './ui/customer.js';
import { renderProducts } from './ui/product.js';
import { renderSettings } from './ui/settings.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

function route() {
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/customer\/(\d+)$/);
  let active = 'home';
  nav.hidden = false;
  window.scrollTo(0, 0);

  if (m) {
    nav.hidden = true;
    return renderCustomer(view, Number(m[1]));
  }
  if (hash === '#/products') { active = 'products'; renderProducts(view); }
  else if (hash === '#/settings') { active = 'settings'; renderSettings(view); }
  else renderHome(view);

  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === active));
}

async function start() {
  try {
    await openDB();
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    view.replaceChildren(h('div', { class: 'card empty' }, 'تعذّر فتح قاعدة البيانات: ' + (e && e.message || e)));
  }
}
start();
