// المظهر: داكن (الافتراضي) / فاتح / متباين (خلفية داكنة وحواف فاتحة). يُحفظ على الجهاز نفسه.
export const THEMES = [
  ['dark', 'داكن'],
  ['light', 'فاتح'],
  ['contrast', 'متباين'],
];

// لون شريطي الحالة والتنقل في أندرويد + هل أيقوناتهما داكنة (للخلفية الفاتحة)
const BARS = {
  dark: ['#0D0D12', false],
  light: ['#F3F2F9', true],
  contrast: ['#000000', false],
};

export function getTheme() {
  try {
    const t = localStorage.getItem('theme');
    return BARS[t] ? t : 'dark';
  } catch (e) { return 'dark'; }
}

export function applyTheme(theme) {
  const t = BARS[theme] ? theme : 'dark';
  if (t === 'dark') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    if (window.Android && typeof window.Android.setBarColors === 'function') {
      window.Android.setBarColors(BARS[t][0], BARS[t][1]);
    }
  } catch (e) { /* خارج التطبيق */ }
}

export function setTheme(theme) {
  try { localStorage.setItem('theme', theme); } catch (e) { /* الحفظ اختياري */ }
  applyTheme(theme);
}
