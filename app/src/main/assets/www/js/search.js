// توحيد النص العربي للبحث: بلا تشكيل، أ/إ/آ→ا، ة→ه، ى→ي.

export function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // التشكيل
    .replace(/\u0640/g, '')                              // التطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ٟ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** كل كلمات الاستعلام يجب أن تظهر (كجزء) في الاسم الموحّد. */
export function matches(query, nameNorm) {
  const q = normalize(query);
  if (!q) return true;
  const hay = nameNorm ?? '';
  return q.split(' ').every(t => hay.includes(t));
}
