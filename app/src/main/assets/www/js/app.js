import { openDB } from './db.js';
import { h, fill } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderCustomer } from './ui/customer.js';
import { renderCart } from './ui/cart.js';
import { liveScanStop, keepAwake } from './bridge.js';
import { renderSync, renderSend, renderReceive } from './ui/sync.js';
import { renderPayment } from './ui/payment.js';
import { renderNewDebt } from './ui/debt.js';
import { renderProducts } from "./ui/product.js";
import { renderSettings } from './ui/settings.js';
import { refreshLicense } from './license.js';
import { getTheme, applyTheme } from './theme.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');

function route() {
  const hash = location.hash || '#/';
  if (!hash.startsWith('#/cart') && hash !== '#/sync/receive') liveScanStop(); // الكاميرا تعمل في السلة واستلام التحديثات فقط
  if (hash !== '#/sync/send' && hash !== '#/sync/receive') keepAwake(false);
  refreshLicense().catch(() => {}); // يحدّث «آخر زمن رُئي» (منع الغش بتأخير ساعة الهاتف)
  const m = hash.match(/^#\/customer\/(\d+)$/);
  let active = 'home';
  nav.hidden = false;
  window.scrollTo(0, 0);

  if (m) {
    nav.hidden = true;
    return renderCustomer(view, Number(m[1]));
  }
  const pm = hash.match(/^#\/pay\/(\d+)$/);
  if (pm) {
    nav.hidden = true;
    return renderPayment(view, Number(pm[1]));
  }
  if (hash === '#/cart') {
    nav.hidden = true;
    return renderCart(view);
  }
  const dm = hash.match(/^#\/debt\/(\d+)$/);
  if (dm) {
    nav.hidden = true;
    return renderNewDebt(view, Number(dm[1]));
  }
  if (hash === '#/sync/send') { nav.hidden = true; return renderSend(view); }
  if (hash === '#/sync/receive') { nav.hidden = true; return renderReceive(view); }
  if (hash === '#/sync') { active = 'sync'; renderSync(view); }
  else if (hash === '#/products') { active = 'products'; renderProducts(view); }
  else if (hash === '#/settings') { active = 'settings'; renderSettings(view); }
  else renderHome(view);

  nav.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === active));
}

applyTheme(getTheme()); // يزامن شريطي أندرويد مع المظهر المحفوظ

async function start() {
  try {
    await openDB();
    await refreshLicense();
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    fill(view, h('div', { class: 'card empty' }, 'تعذّر فتح قاعدة البيانات: ' + (e && e.message || e)));
  }
}
start();
