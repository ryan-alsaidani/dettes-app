let TABLE = null;

/** CRC-32 (IEEE 802.3) كما في ZIP: crc32(بايتات) → عدد صحيح موجب 32 بت. */
export function crc32(bytes) {
  if (!TABLE) {
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
