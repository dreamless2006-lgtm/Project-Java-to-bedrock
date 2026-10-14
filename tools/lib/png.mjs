// Minimal PNG reader/writer (8-bit, non-interlaced) for compositing textures at import time.
import { unzlibSync, zlibSync } from 'fflate';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (/** @type {Uint8Array} */ bytes) => {
  let c = -1;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

/** @typedef {{ width: number, height: number, data: Uint8Array }} Image RGBA, row-major */

/** @param {Uint8Array} bytes @returns {Image} */
export function decodePng(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null;
  while (pos < bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const chunk = bytes.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      const header = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      depth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'PLTE') {
      palette = chunk;
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const total = idat.reduce((n, c) => n + c.length, 0);
  const compressed = new Uint8Array(total);
  let offset = 0;
  for (const c of idat) {
    compressed.set(c, offset);
    offset += c.length;
  }
  const raw = unzlibSync(compressed);
  const stride = width * channels;
  const data = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride);
    p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const i = x * channels;
      if (colorType === 6) data.set(line.subarray(i, i + 4), o);
      else if (colorType === 2) { data[o] = line[i]; data[o + 1] = line[i + 1]; data[o + 2] = line[i + 2]; data[o + 3] = 255; }
      else if (colorType === 0) { data[o] = data[o + 1] = data[o + 2] = line[i]; data[o + 3] = 255; }
      else if (colorType === 4) { data[o] = data[o + 1] = data[o + 2] = line[i]; data[o + 3] = line[i + 1]; }
      else if (colorType === 3 && palette) { const k = line[i] * 3; data[o] = palette[k]; data[o + 1] = palette[k + 1]; data[o + 2] = palette[k + 2]; data[o + 3] = 255; }
    }
    prev = line;
  }
  return { width, height, data };
}

/** @param {Image} image @returns {Uint8Array} */
export function encodePng({ width, height, data }) {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (/** @type {string} */ type, /** @type {Uint8Array} */ body) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** A transparent RGBA canvas. */
export const blank = (/** @type {number} */ width, /** @type {number} */ height) => ({ width, height, data: new Uint8Array(width * height * 4) });

/** Copies a rectangle between images (clipped to both). */
export function blit(/** @type {Image} */ src, /** @type {number} */ sx, /** @type {number} */ sy, /** @type {number} */ w, /** @type {number} */ h, /** @type {Image} */ dst, /** @type {number} */ dx, /** @type {number} */ dy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = sx + x, fy = sy + y, tx = dx + x, ty = dy + y;
      if (fx < 0 || fy < 0 || fx >= src.width || fy >= src.height || tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue;
      dst.data.set(src.data.subarray((fy * src.width + fx) * 4, (fy * src.width + fx) * 4 + 4), (ty * dst.width + tx) * 4);
    }
  }
}
