// ربط محرك الدمج (sync.js) بقاعدة البيانات.
import { openDB } from './db.js';
import { requireActive } from './license.js';
import { buildUpdates, mergeUpdates, validateUpdates, KINDS } from './sync.js';
import { getDevice, getLastSent, addAlerts } from './devstate.js';

const ALL = [...KINDS, 'brands', 'tombstones'];

export async function readLocal() {
  const db = await openDB();
  const out = {};
  await Promise.all(ALL.map(name => new Promise((resolve, reject) => {
    const req = db.transaction(name, 'readonly').objectStore(name).getAll();
    req.onsuccess = () => { out[name] = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  })));
  return out;
}

/** mode: 'delta' (الجديد منذ آخر إرسال مؤكَّد) أو 'all'. */
export async function buildPacket({ scope = 'all', mode = 'delta' } = {}) {
  const local = await readLocal();
  const since = mode === 'delta' ? getLastSent(scope) : null;
  return buildUpdates(local, { since, scope, device: getDevice(), now: Date.now() });
}

/** معاينة الدمج دون كتابة: {report, alerts}. */
export async function previewUpdates(packet) {
  const v = validateUpdates(packet);
  if (!v.ok) throw new Error(v.error);
  const plan = mergeUpdates(await readLocal(), packet, { now: Date.now() });
  return { report: plan.report, alerts: plan.alerts };
}

/** يدمج حزمة في قاعدة البيانات (معاملة واحدة: إما الكل أو لا شيء) ويحفظ التنبيهات. */
export async function applyUpdates(packet) {
  requireActive();
  const v = validateUpdates(packet);
  if (!v.ok) throw new Error(v.error);
  const now = Date.now();
  const plan = mergeUpdates(await readLocal(), packet, { now });
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([...KINDS, 'brands', 'tombstones'], 'readwrite');
    for (const k of KINDS) {
      const st = tx.objectStore(k);
      for (const id of plan.dels[k]) st.delete(id);
      for (const r of plan.puts[k]) st.put(r);
    }
    const bs = tx.objectStore('brands');
    for (const b of plan.brandsAdd) bs.put(b);
    const ts = tx.objectStore('tombstones');
    for (const u of plan.tombDels) ts.delete(u);
    for (const t of plan.tombPuts) ts.put(t);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('فشل الدمج'));
  });
  if (plan.alerts.length) addAlerts(plan.alerts, now, packet.dev && packet.dev.name);
  return { report: plan.report, alerts: plan.alerts };
}
