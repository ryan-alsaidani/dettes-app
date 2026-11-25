// المبالغ أعداد صحيحة بالمليم (1 دينار = 1000 مليم).

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** يحوّل نص بالدينار ("1.5" أو "1,500" أو "١٫٥") إلى مليم. يعيد null إن كان غير صالح. */
export function parseDinars(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim()
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
    .replace(/[,،٫]/g, '.')
    .replace(/\s+/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return parseInt(i, 10) * 1000 + parseInt((f + '000').slice(0, 3), 10);
}

/** يعرض مبلغًا بالمليم على شكل "1.500 د". */
export function formatMillimes(m) {
  const n = Math.round(Number(m) || 0);
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')} د`;
}

/** مليم → نص لحقل الإدخال: 1500 → "1.5" ، 2000 → "2" ، 250 → "0.25". */
export function toInputString(m) {
  const n = Math.round(Number(m) || 0);
  const a = Math.abs(n);
  let s = `${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`.replace(/\.?0+$/, '');
  if (s === '') s = '0';
  return (n < 0 ? '-' : '') + s;
}
