// خوارزمية التسديد: دالة نقية (بلا قاعدة بيانات ولا واجهة).
//
// allocatePayment(debts, amount)
//   debts : [{id, remaining, date}]  غير المسدَّدة (المسدَّدة تُهمَل)، المبالغ أعداد صحيحة بالمليم
//   amount: عدد صحيح موجب بالمليم
//   تعيد: { options: [{ items: [{debtId, pay, full}], total }], change }   (حتى 5 خيارات)
//
// 1) المبلغ ≥ مجموع المتبقيات: سداد الكل والباقي change.
// 2) تركيبات مجموعها يساوي المبلغ تمامًا (كل بند كاملًا): الأقل بنودًا أولًا ثم الأقدم.
// 3) لا تركيبة مطابقة: خطط «بنود كاملة + دفعة جزئية على البند غير المختار الأقل متبقيًا»
//    مرتبة بأكبر مجموع للبنود الكاملة أولًا (ثم الأقدم).

export const MAX_OPTIONS = 5;
const STEP_LIMIT = 200000;
const TABLE_LIMIT = 8000000; // حدّ حجم جدول إمكانية المجاميع (بايت)

function gcd(a, b) {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// suf[i][s] = 1 إن أمكن تكوين المجموع s من البنود i..n-1
function buildTable(r, A) {
  const n = r.length;
  if ((n + 1) * (A + 1) > TABLE_LIMIT) return null;
  const suf = new Array(n + 1);
  suf[n] = new Uint8Array(A + 1);
  suf[n][0] = 1;
  for (let i = n - 1; i >= 0; i--) {
    const prev = suf[i + 1];
    const cur = prev.slice();
    const v = r[i];
    for (let s = v; s <= A; s++) if (prev[s - v]) cur[s] = 1;
    suf[i] = cur;
  }
  return suf;
}

// بحث بالتراجع بترتيب العمر (الأقدم أولًا) فيخرج الحل الأقدم معجميًا أولًا.
function findSubsets(ctx, target, kExact, wanted) {
  const { r, n, sufSum, table } = ctx;
  const out = [];
  const chosen = [];
  function dfs(i, rem) {
    if (out.length >= wanted || ctx.steps > STEP_LIMIT) return;
    if (rem === 0) {
      if (kExact === null || chosen.length === kExact) out.push(chosen.slice());
      return;
    }
    if (i >= n || rem > sufSum[i]) return;
    if (kExact !== null) {
      if (chosen.length >= kExact) return;
      if (n - i < kExact - chosen.length) return;
    }
    if (table && !table[i][rem]) return;
    ctx.steps++;
    if (r[i] <= rem) {
      chosen.push(i);
      dfs(i + 1, rem - r[i]);
      chosen.pop();
    }
    dfs(i + 1, rem);
  }
  dfs(0, target);
  return out;
}

// احتياط عند المبالغ الكبيرة جدًا: الأقدم أولًا حتى ينفد المبلغ.
function oldestFirst(list, amount) {
  let left = amount;
  const items = [];
  for (const d of list) {
    if (left <= 0) break;
    if (d.remaining <= left) { items.push({ debtId: d.id, pay: d.remaining, full: true }); left -= d.remaining; }
    else { items.push({ debtId: d.id, pay: left, full: false }); left = 0; }
  }
  return { options: [{ items, total: amount }], change: 0 };
}

export function allocatePayment(debts, amount) {
  const none = { options: [], change: 0 };
  if (!Number.isInteger(amount) || amount <= 0) return none;

  const list = (debts || [])
    .filter(d => d && Number.isInteger(d.remaining) && d.remaining > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  if (!list.length) return none;

  const total = list.reduce((s, d) => s + d.remaining, 0);

  // 1) المبلغ يغطي كل شيء
  if (amount >= total) {
    return {
      options: [{ items: list.map(d => ({ debtId: d.id, pay: d.remaining, full: true })), total }],
      change: amount - total,
    };
  }

  // اختزال بالقاسم المشترك الأكبر
  let g = amount;
  for (const d of list) g = gcd(g, d.remaining);
  const r = list.map(d => d.remaining / g);
  const A = amount / g;
  const n = r.length;
  const sufSum = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) sufSum[i] = sufSum[i + 1] + r[i];
  const table = buildTable(r, A);
  const ctx = { r, n, sufSum, table, steps: 0 };
  const fullItem = (i) => ({ debtId: list[i].id, pay: r[i] * g, full: true });

  // 2) تركيبات مطابقة تمامًا: الأقل بنودًا أولًا
  if (!table || table[0][A]) {
    const maxR = Math.max(...r);
    const minR = Math.min(...r);
    const kStart = Math.max(1, Math.ceil(A / maxR));
    const kEnd = Math.min(n, Math.floor(A / minR));
    const options = [];
    for (let k = kStart; k <= kEnd && options.length < MAX_OPTIONS && ctx.steps <= STEP_LIMIT; k++) {
      for (const idxs of findSubsets(ctx, A, k, MAX_OPTIONS - options.length)) {
        options.push({ items: idxs.map(fullItem), total: amount });
      }
    }
    if (options.length) return { options, change: 0 };
  }

  // 3) لا تركيبة مطابقة
  if (!table) return oldestFirst(list, amount);
  const plans = [];
  let tried = 0;
  for (let s = A - 1; s >= 0 && plans.length < MAX_OPTIONS && tried < 400 && ctx.steps <= STEP_LIMIT; s--) {
    if (!table[0][s]) continue;
    tried++;
    const L = A - s;
    for (const idxs of findSubsets(ctx, s, null, 20)) {
      const chosen = new Set(idxs);
      let target = -1;
      let valid = true;
      for (let i = 0; i < n; i++) {
        if (chosen.has(i)) continue;
        if (r[i] <= L) { valid = false; break; } // كان سيُسدَّد كاملًا: تغطّيه خطة بمجموع أكبر
        if (target === -1 || r[i] < r[target]) target = i; // الأقل متبقيًا، والأقدم عند التساوي
      }
      if (valid && target >= 0) {
        plans.push({
          items: [...idxs.map(fullItem), { debtId: list[target].id, pay: L * g, full: false }],
          total: amount,
        });
        break;
      }
    }
  }
  if (plans.length) return { options: plans, change: 0 };
  return oldestFirst(list, amount);
}
