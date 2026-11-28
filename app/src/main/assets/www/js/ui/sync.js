// التحديثات: إرسال واستلام بين جهازين برموز QR متتابعة (التالي/السابق) أو بنص يُرسل عبر أي تطبيق مراسلة.
import { h, toast, messageDialog, sheet, fill } from './dom.js';
import { buildPacket, previewUpdates, applyUpdates } from '../syncio.js';
import { countUpdates, reportLines, validateUpdates } from '../sync.js';
import { packJson, unpackJson, makeFrames, FrameCollector, parseFrame, extractFrames } from '../qrframes.js';
import { qrMatrix, hasShare, shareText, keepAwake, hasLiveScan, liveScanStart, liveScanStop, liveScanTorch } from '../bridge.js';
import { getDevice, setDeviceName, markSent, getAlerts, dismissAlert, clearAlerts } from '../devstate.js';
import { formatDate, todayISO } from '../dates.js';
import { needActive, copyText } from './licensecard.js';

const COUNT_LABELS = { customers: 'زبون', products: 'منتج', orders: 'فاتورة', debts: 'دين', payments: 'دفعة', deletions: 'حذف' };
const describeCounts = (c) => Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => n + ' ' + COUNT_LABELS[k]).join('، ');
const dateOf = (ms) => formatDate(todayISO(new Date(ms)));

function chips(box, options, current, onPick) {
  fill(box, options.map(([k, label]) =>
    h('button', { class: 'chip' + (k === current ? ' on' : ''), type: 'button', onClick: () => onPick(k) }, label)));
}

// ====================================================================== الرئيسية

export function renderSync(root) {
  const alertsBox = h('div', null);
  const devLine = h('div', { class: 'item-name' });

  function drawDevice() { devLine.textContent = getDevice().name; }

  function drawAlerts() {
    const list = getAlerts();
    fill(alertsBox, list.length ? h('div', { class: 'card alertcard' },
      h('div', { class: 'debt-top' },
        h('div', { class: 'item-name' }, 'التنبيهات (' + list.length + ')'),
        h('button', { class: 'link', type: 'button', onClick: () => { clearAlerts(); drawAlerts(); } }, 'مسح الكل')),
      list.map(a => h('div', { class: 'alert-item' },
        h('p', { class: 'alert-text' }, a.text),
        h('div', { class: 'debt-top' },
          h('span', { class: 'dim small' }, (a.from ? 'من ' + a.from + ' • ' : '') + dateOf(a.at)),
          h('button', { class: 'link', type: 'button', onClick: () => { dismissAlert(a.id); drawAlerts(); } }, 'تم'))))) : null);
  }

  function renameDevice() {
    const input = h('input', { class: 'input', value: getDevice().name, placeholder: 'مثال: هاتف الصندوق' });
    const s = sheet([
      h('h2', { class: 'sheet-title' }, 'اسم هذا الجهاز'),
      h('p', { class: 'dim small' }, 'يظهر في تنبيهات الجهاز الآخر (مثل: «وصلت دفعة من هاتف الصندوق»).'),
      input,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onClick: () => { setDeviceName(input.value); s.close(); drawDevice(); } }, 'حفظ'),
        h('button', { class: 'btn ghost', onClick: () => s.close() }, 'إلغاء')),
    ]);
  }

  fill(root,
    h('h1', { class: 'title' }, 'التحديثات'),
    h('div', { class: 'card alt' },
      h('div', { class: 'debt-top' },
        h('div', null, h('div', { class: 'dim small' }, 'هذا الجهاز'), devLine),
        h('button', { class: 'btn ghost inline', onClick: renameDevice }, 'تغيير الاسم'))),
    alertsBox,
    h('button', { class: 'btn', onClick: () => { location.hash = '#/sync/send'; } }, 'إرسال تحديثات'),
    h('button', { class: 'btn ok', onClick: () => { location.hash = '#/sync/receive'; } }, 'استلام تحديثات'),
    h('p', { class: 'dim small' }, 'لنقل ما سجّلتَه إلى جهازك الآخر دون إنترنت: يعرض أحدهما رموز QR متتابعة ويمسحها الآخر، أو يُرسل النص عبر واتساب وغيره ويُلصق في «استلام». لا يُنقل إلا الجديد، ولا يتكرر شيء.'));
  drawDevice();
  drawAlerts();
}

// ====================================================================== الإرسال

const SEND = { scope: 'all', mode: 'delta', chunk: 600 };
const SCOPES = [['all', 'كل شيء'], ['customers', 'الزبائن وديونهم'], ['products', 'المنتجات فقط']];
const MODES = [['delta', 'الجديد منذ آخر إرسال'], ['all', 'كل البيانات']];
const SIZES = [[350, 'مريح'], [600, 'متوسط'], [900, 'مضغوط']];
const MAX_TEXT = 18000;

function drawQr(canvas, rows) {
  const n = rows.length;
  const quiet = 4;
  const total = n + quiet * 2;
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.min(window.innerWidth - 64, 440);
  const scale = Math.max(1, Math.floor((cssW * dpr) / total));
  const px = scale * total;
  canvas.width = px; canvas.height = px;
  canvas.style.width = px / dpr + 'px';
  canvas.style.height = px / dpr + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < n; y++) {
    const row = rows[y];
    for (let x = 0; x < n; x++) if (row[x] === '1') ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  }
}

function textParts(frames) {
  const parts = [];
  let cur = [];
  let len = 0;
  for (const f of frames) {
    if (cur.length && len + f.length + 1 > MAX_TEXT) { parts.push(cur); cur = []; len = 0; }
    cur.push(f); len += f.length + 1;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

export async function renderSend(root) {
  keepAwake(true);
  let built = null;
  let idx = 0;
  const scopeBox = h('div', { class: 'chips seg' });
  const modeBox = h('div', { class: 'chips seg' });
  const sizeBox = h('div', { class: 'chips seg' });
  const out = h('div', null);
  const makeBtn = h('button', { class: 'btn' }, 'إنشاء الرموز');

  function drawOpts() {
    chips(scopeBox, SCOPES, SEND.scope, k => { SEND.scope = k; drawOpts(); });
    chips(modeBox, MODES, SEND.mode, k => { SEND.mode = k; drawOpts(); });
    chips(sizeBox, SIZES, SEND.chunk, k => { SEND.chunk = k; drawOpts(); });
  }

  async function build() {
    built = null;
    fill(out, h('p', { class: 'dim' }, 'جارٍ التجهيز...'));
    let packet;
    let frames;
    try {
      packet = await buildPacket({ scope: SEND.scope, mode: SEND.mode });
      const counts = countUpdates(packet);
      if (!Object.values(counts).some(n => n > 0) && !packet.b.length) {
        fill(out, h('div', { class: 'card empty' }, SEND.mode === 'delta' ? 'لا جديد منذ آخر إرسال مؤكَّد. اختر «كل البيانات» إن أردت إرسال كل شيء.' : 'لا بيانات للإرسال.'));
        return;
      }
      const bytes = await packJson(packet);
      frames = makeFrames(bytes, { chunk: SEND.chunk });
      built = { packet, frames, bytes: bytes.length, counts };
    } catch (e) {
      fill(out, h('div', { class: 'card empty' }, 'تعذّر التجهيز: ' + (e.message || e)));
      return;
    }
    idx = 0;
    drawResult();
  }

  function drawResult() {
    const { frames, packet, counts, bytes } = built;
    const canvas = h('canvas', { class: 'qrcanvas' });
    const counter = h('div', { class: 'qr-counter' });
    const warn = h('p', { class: 'err' });
    const slider = h('input', { class: 'slider', type: 'range', min: '1', max: String(frames.length), value: '1' });
    const prev = h('button', { class: 'btn ghost', type: 'button' }, '→ السابق');
    const next = h('button', { class: 'btn', type: 'button' }, 'التالي ←');

    function show() {
      counter.textContent = 'رمز ' + (idx + 1) + ' من ' + frames.length;
      slider.value = String(idx + 1);
      prev.disabled = idx === 0;
      next.disabled = idx === frames.length - 1;
      const rows = qrMatrix(frames[idx], 'M');
      if (rows) { drawQr(canvas, rows); warn.textContent = ''; }
      else warn.textContent = 'تعذّر رسم الرمز. اختر حجمًا «مريح» ثم أنشئ الرموز من جديد.';
    }
    const go = (i) => { idx = Math.max(0, Math.min(frames.length - 1, i)); show(); };
    prev.addEventListener('click', () => go(idx - 1));
    next.addEventListener('click', () => go(idx + 1));
    slider.addEventListener('input', () => go(Number(slider.value) - 1));

    const parts = textParts(frames);
    const textCards = parts.map((part, k) => {
      const body = 'تحديثات دفتر الديون (' + (k + 1) + '/' + parts.length + ') — الصقها في «استلام تحديثات»\n' + part.join('\n');
      return h('div', { class: 'pay-line' },
        h('div', null, h('div', { class: 'item-name' }, 'الرسالة ' + (k + 1) + ' من ' + parts.length), h('div', { class: 'dim small' }, part.length + ' رمزًا')),
        h('div', { class: 'btn-row' },
          hasShare() ? h('button', { class: 'btn mini', onClick: () => shareText(body) }, 'إرسال') : null,
          h('button', { class: 'btn ghost mini', onClick: async () => toast((await copyText(body)) ? 'تم النسخ' : 'تعذّر النسخ') }, 'نسخ')));
    });

    fill(out,
      h('div', { class: 'card alt' },
        h('div', { class: 'item-name' }, frames.length + (frames.length === 1 ? ' رمز' : ' رمزًا') + ' جاهزة'),
        h('p', { class: 'dim small' }, 'يحتوي: ' + (describeCounts(counts) || 'علامات فقط') + ' • الحجم ' + (bytes / 1024).toFixed(1) + ' ك.ب • من ' + dateOf(packet.at))),
      h('div', { class: 'card' },
        h('div', { class: 'qrbox' }, canvas),
        counter, warn,
        slider,
        h('div', { class: 'btn-row spaced-top' }, prev, next),
        h('p', { class: 'dim small' }, 'امسح الرموز بالترتيب بالجهاز الآخر. إن فات جهازَ الاستلام رمز سيخبرك برقمه، فارجع إليه بزر «السابق».')),
      h('div', { class: 'card' },
        h('h2', { class: 'sheet-title' }, 'أو أرسلها كنص'),
        h('p', { class: 'dim small' }, 'أرسل الرسائل عبر واتساب أو أي تطبيق، وألصقها في خانة «استلام تحديثات» بالجهاز الآخر (بأي ترتيب).'),
        textCards),
      h('button', { class: 'btn ok', onClick: () => { markSent(SEND.scope, packet.at); toast('سُجّل الإرسال: المرة القادمة يُرسل الجديد فقط'); } }, 'استلم الجهاز الآخر كل شيء ✓'));
    show();
  }

  makeBtn.addEventListener('click', build);
  fill(root,
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, 'إرسال تحديثات'),
    h('div', { class: 'card' },
      h('p', { class: 'dim small' }, 'ماذا ترسل؟'), scopeBox,
      h('p', { class: 'dim small' }, 'كم؟'), modeBox,
      h('p', { class: 'dim small' }, 'حجم الرمز (المريح: رموز أكثر وأسهل مسحًا)'), sizeBox,
      makeBtn),
    out);
  drawOpts();
}

// ====================================================================== الاستلام

const rx = { col: new FrameCollector(), packet: null, stage: 'collect', note: '' };
function resetRx() { rx.col.reset(); rx.packet = null; rx.stage = 'collect'; rx.note = ''; }

export async function renderReceive(root) {
  keepAwake(true);
  if (rx.stage === 'preview' && rx.packet) return renderPreview(root);
  return renderCollect(root);
}

function renderCollect(root) {
  const live = hasLiveScan();
  let camOn = false;
  let torchOn = false;
  const camRow = h('div', { class: 'btn-row' });
  const status = h('div', { class: 'card' });
  const warn = h('div', null);
  const area = h('textarea', { class: 'input area', dir: 'ltr', spellcheck: 'false', placeholder: 'ألصق هنا النص المستلم (يمكن لصق عدة رسائل)' });

  function onState(st) {
    camOn = st === 'started';
    if (st === 'denied') toast('لم تُمنح صلاحية الكاميرا. الصق النص بدلًا من ذلك.');
    if (st !== 'started') torchOn = false;
    drawCam();
  }
  const onCode = (code) => {
    const f = parseFrame(code);
    if (f) handle(f); else toast('هذا الرمز ليس من تحديثات التطبيق');
  };
  const startCam = () => { if (live) liveScanStart(onCode, onState); };
  const stopCam = () => { if (live) { liveScanStop(); camOn = false; torchOn = false; drawCam(); } };

  function drawCam() {
    fill(camRow, !live ? null : [
      h('button', { class: 'btn ghost mini', onClick: () => (camOn ? stopCam() : startCam()) }, camOn ? 'إغلاق الكاميرا' : 'تشغيل الكاميرا'),
      camOn ? h('button', { class: 'btn ghost mini', onClick: () => { torchOn = !torchOn; liveScanTorch(torchOn); drawCam(); } }, torchOn ? 'إطفاء الفلاش' : 'الفلاش') : null,
    ]);
  }

  function drawStatus() {
    const col = rx.col;
    if (col.sid === null) {
      fill(status, h('p', { class: 'dim' }, 'وجّه الكاميرا نحو أول رمز يعرضه الجهاز الآخر (من «إرسال تحديثات»)، أو ألصق النص أدناه.'));
      fill(warn, null);
      return;
    }
    const skipped = new Set(col.skipped());
    const cells = [];
    for (let i = 1; i <= col.n; i++) {
      cells.push(h('div', { class: 'rxcell' + (col.parts.has(i) ? ' got' : skipped.has(i) ? ' miss' : '') }, String(i)));
    }
    fill(status,
      h('div', { class: 'debt-top' },
        h('div', { class: 'item-name' }, 'استُلم ' + col.have + ' من ' + col.n),
        h('button', { class: 'link', type: 'button', onClick: () => { resetRx(); stopCam(); renderReceive(root); } }, 'بدء من جديد')),
      h('div', { class: 'rxgrid' }, cells));
    const sk = col.skipped();
    fill(warn,
      sk.length ? h('div', { class: 'card alertcard' },
        h('div', { class: 'item-name' }, 'فاتك ' + sk.length + (sk.length === 1 ? ' رمز' : ' رموز')),
        h('p', { class: 'alert-text' }, 'الرقم: ' + sk.join('، ') + '. ارجع بالجهاز الآخر إلى الرمز رقم ' + sk[0] + ' (زر «السابق») وامسحه مجددًا.')) : null,
      rx.note ? h('div', { class: 'card alertcard' }, h('p', { class: 'alert-text' }, rx.note)) : null);
  }

  async function handle(input) {
    const r = rx.col.add(input);
    if (r.status === 'other') { rx.note = 'هذا الرمز من عملية إرسال مختلفة، فتجاهلتُه. إن أردت الانتقال إليها اضغط «بدء من جديد».'; drawStatus(); return; }
    if (r.status !== 'new') return;
    rx.note = '';
    drawStatus();
    if (rx.col.complete()) await finish();
  }

  async function finish() {
    stopCam();
    let packet;
    try {
      packet = await unpackJson(rx.col.assemble());
    } catch (e) {
      await messageDialog('تعذّرت قراءة الحزمة: وصلت الرموز لكنها تالفة. ابدأ من جديد.');
      resetRx(); renderReceive(root);
      return;
    }
    const v = validateUpdates(packet);
    if (!v.ok) { await messageDialog(v.error); resetRx(); renderReceive(root); return; }
    rx.packet = packet;
    rx.stage = 'preview';
    renderReceive(root);
  }

  const pasteBtn = h('button', { class: 'btn ghost', onClick: async () => {
    const frames = extractFrames(area.value);
    if (!frames.length) { toast('لم أجد رموز تحديثات في هذا النص'); return; }
    area.value = '';
    for (const f of frames) { if (rx.stage !== 'collect') break; await handle(f); }
    drawStatus();
  } }, 'استخراج من النص');

  fill(root,
    h('button', { class: 'back', onClick: () => history.back() }, '→ رجوع'),
    h('h1', { class: 'title' }, 'استلام تحديثات'),
    camRow,
    status, warn,
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'أو الصق النص'),
      area, pasteBtn));
  drawCam();
  drawStatus();
  startCam();
}

async function renderPreview(root) {
  const pkt = rx.packet;
  keepAwake(false);
  let pv;
  try { pv = await previewUpdates(pkt); } catch (e) { await messageDialog(e.message || 'تعذّرت معاينة الحزمة.'); resetRx(); return renderReceive(root); }
  const lines = reportLines(pv.report);
  const merge = h('button', { class: 'btn' }, 'دمج الآن');
  const cancel = h('button', { class: 'btn ghost' }, 'إلغاء');

  merge.addEventListener('click', async () => {
    if (!(await needActive())) return;
    merge.disabled = true; cancel.disabled = true;
    let res;
    try { res = await applyUpdates(pkt); } catch (e) {
      await messageDialog('فشل الدمج، لم يتغيّر شيء: ' + (e.message || e));
      merge.disabled = false; cancel.disabled = false;
      return;
    }
    resetRx();
    fill(root,
      h('h1', { class: 'title' }, 'تم الدمج'),
      h('div', { class: 'card alt' }, reportLines(res.report).map(l => h('p', { class: 'dim' }, l))),
      res.alerts.length ? h('div', { class: 'card alertcard' },
        h('div', { class: 'item-name' }, res.alerts.length + (res.alerts.length === 1 ? ' تنبيه' : ' تنبيهات')),
        res.alerts.map(a => h('p', { class: 'alert-text' }, a.text)),
        h('p', { class: 'dim small' }, 'محفوظة أيضًا في صفحة التحديثات.')) : null,
      h('button', { class: 'btn', onClick: () => { location.hash = '#/sync'; } }, 'تم'));
  });
  cancel.addEventListener('click', () => { resetRx(); renderReceive(root); });

  fill(root,
    h('h1', { class: 'title' }, 'تم استلام الحزمة'),
    h('div', { class: 'card alt' },
      h('div', { class: 'item-name' }, 'من: ' + (pkt.dev.name || 'جهاز آخر')),
      h('p', { class: 'dim small' }, 'بتاريخ ' + dateOf(pkt.at) + ' • تحتوي: ' + (describeCounts(countUpdates(pkt)) || 'علامات فقط'))),
    h('div', { class: 'card' },
      h('h2', { class: 'sheet-title' }, 'ما سيحدث'),
      lines.map(l => h('p', { class: 'dim' }, l)),
      h('p', { class: 'dim small' }, 'لا يُحذف شيء من بياناتك إلا ما حُذف عند الجهاز الآخر. وتُجمع الدفعات الجديدة على الديون دون استبدال أرصدتك.')),
    pv.alerts.length ? h('div', { class: 'card alertcard' },
      h('div', { class: 'item-name' }, 'انتبه: ' + pv.alerts.length + (pv.alerts.length === 1 ? ' تنبيه متوقَّع' : ' تنبيهات متوقَّعة')),
      pv.alerts.map(a => h('p', { class: 'alert-text' }, a.text))) : null,
    merge, cancel);
}
