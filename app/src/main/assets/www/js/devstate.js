// حالة خاصة بهذا الجهاز (localStorage): لا تدخل النسخ الاحتياطية ولا تنتقل بين الأجهزة.
import { newUid } from './uid.js';

const get = (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* اختياري */ } };

export function getDevice() {
  let id = get('dev_id');
  if (!id) { id = newUid(); set('dev_id', id); }
  const name = get('dev_name') || ('جهاز-' + id.slice(-4));
  return { id, name };
}
export const setDeviceName = (n) => set('dev_name', String(n || '').trim().slice(0, 30));

// آخر إرسال مؤكَّد لكل نطاق: «الجديد منذ آخر إرسال» يعتمد عليه
export const getLastSent = (scope) => get('sync_last_sent_' + scope, null);
export function markSent(scope, at) {
  for (const s of scope === 'all' ? ['all', 'customers', 'products'] : [scope]) set('sync_last_sent_' + s, at);
}

// تنبيهات الدمج (تسديد مزدوج وتكرار...)
export const getAlerts = () => get('sync_alerts', []);
export function addAlerts(list, at, from) {
  const cur = getAlerts();
  const add = list.map((a, i) => ({ id: at + '-' + i + '-' + Math.random().toString(36).slice(2, 6), at, from: from || '', type: a.type, text: a.text }));
  set('sync_alerts', [...add, ...cur].slice(0, 200));
}
export const dismissAlert = (id) => set('sync_alerts', getAlerts().filter(a => a.id !== id));
export const clearAlerts = () => set('sync_alerts', []);

// مجلد النسخ الاحتياطية (مجلد الاستيراد): {uri, name}
export const getBackupFolder = () => get('backup_folder', null);
export const setBackupFolder = (f) => set('backup_folder', f);
