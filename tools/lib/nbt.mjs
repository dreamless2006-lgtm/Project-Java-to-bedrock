// Little-endian NBT, the format of .mcstructure files: parsed into a plain tree and written back
// byte for byte. Used to take the entity out of an imported structure and to rename block and
// entity identifiers in it.

const TAG = { End: 0, Byte: 1, Short: 2, Int: 3, Long: 4, Float: 5, Double: 6, ByteArray: 7, String: 8, List: 9, Compound: 10, IntArray: 11, LongArray: 12 };

/** @typedef {{ type: number, value: any }} Tag */
/** @typedef {[string, Tag][]} Compound named tags in file order */

class Reader {
  constructor(/** @type {Uint8Array} */ bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  u8() { return this.bytes[this.pos++]; }
  i8() { return this.view.getInt8(this.pos++); }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  i64() { const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return v; }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  string() {
    const length = this.u16();
    const text = Buffer.from(this.bytes.buffer, this.bytes.byteOffset + this.pos, length).toString('utf8');
    this.pos += length;
    return text;
  }
}

function readPayload(/** @type {Reader} */ r, /** @type {number} */ type) {
  switch (type) {
    case TAG.Byte: return r.i8();
    case TAG.Short: return r.i16();
    case TAG.Int: return r.i32();
    case TAG.Long: return r.i64();
    case TAG.Float: return r.f32();
    case TAG.Double: return r.f64();
    case TAG.ByteArray: { const n = r.i32(); const out = Array.from({ length: n }, () => r.i8()); return out; }
    case TAG.String: return r.string();
    case TAG.List: {
      const itemType = r.u8();
      const n = r.i32();
      return { itemType, items: Array.from({ length: n }, () => readPayload(r, itemType)) };
    }
    case TAG.Compound: {
      /** @type {Compound} */
      const entries = [];
      for (;;) {
        const t = r.u8();
        if (t === TAG.End) break;
        const name = r.string();
        entries.push([name, { type: t, value: readPayload(r, t) }]);
      }
      return entries;
    }
    case TAG.IntArray: { const n = r.i32(); return Array.from({ length: n }, () => r.i32()); }
    case TAG.LongArray: { const n = r.i32(); return Array.from({ length: n }, () => r.i64()); }
    default: throw new Error(`unknown NBT tag type ${type} at ${r.pos}`);
  }
}

/** The named root tags of a file (a .mcstructure has one unnamed compound). @returns {Compound} */
export function parseNbt(/** @type {Uint8Array} */ bytes) {
  const r = new Reader(bytes);
  /** @type {Compound} */
  const roots = [];
  while (r.pos < bytes.length) {
    const t = r.u8();
    if (t === TAG.End) break;
    const name = r.string();
    roots.push([name, { type: t, value: readPayload(r, t) }]);
  }
  return roots;
}

class Writer {
  constructor() { /** @type {Buffer[]} */ this.chunks = []; }
  push(/** @type {Buffer} */ b) { this.chunks.push(b); }
  u8(/** @type {number} */ v) { this.push(Buffer.from([v & 0xff])); }
  i8(/** @type {number} */ v) { const b = Buffer.alloc(1); b.writeInt8(v); this.push(b); }
  i16(/** @type {number} */ v) { const b = Buffer.alloc(2); b.writeInt16LE(v); this.push(b); }
  u16(/** @type {number} */ v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); this.push(b); }
  i32(/** @type {number} */ v) { const b = Buffer.alloc(4); b.writeInt32LE(v); this.push(b); }
  i64(/** @type {bigint} */ v) { const b = Buffer.alloc(8); b.writeBigInt64LE(v); this.push(b); }
  f32(/** @type {number} */ v) { const b = Buffer.alloc(4); b.writeFloatLE(v); this.push(b); }
  f64(/** @type {number} */ v) { const b = Buffer.alloc(8); b.writeDoubleLE(v); this.push(b); }
  string(/** @type {string} */ s) { const b = Buffer.from(s, 'utf8'); this.u16(b.length); this.push(b); }
  bytes() { return Buffer.concat(this.chunks); }
}

function writePayload(/** @type {Writer} */ w, /** @type {number} */ type, /** @type {any} */ value) {
  switch (type) {
    case TAG.Byte: return w.i8(value);
    case TAG.Short: return w.i16(value);
    case TAG.Int: return w.i32(value);
    case TAG.Long: return w.i64(value);
    case TAG.Float: return w.f32(value);
    case TAG.Double: return w.f64(value);
    case TAG.ByteArray: { w.i32(value.length); for (const v of value) w.i8(v); return; }
    case TAG.String: return w.string(value);
    case TAG.List: { w.u8(value.itemType); w.i32(value.items.length); for (const item of value.items) writePayload(w, value.itemType, item); return; }
    case TAG.Compound: {
      for (const [name, tag] of value) { w.u8(tag.type); w.string(name); writePayload(w, tag.type, tag.value); }
      w.u8(TAG.End);
      return;
    }
    case TAG.IntArray: { w.i32(value.length); for (const v of value) w.i32(v); return; }
    case TAG.LongArray: { w.i32(value.length); for (const v of value) w.i64(v); return; }
    default: throw new Error(`unknown NBT tag type ${type}`);
  }
}

export function writeNbt(/** @type {Compound} */ roots) {
  const w = new Writer();
  for (const [name, tag] of roots) { w.u8(tag.type); w.string(name); writePayload(w, tag.type, tag.value); }
  return w.bytes();
}

/** A compound's entry by name. */
export const get = (/** @type {Compound} */ compound, /** @type {string} */ name) => compound.find(([n]) => n === name)?.[1];

/** Takes every entity out of a structure (its blocks stay); returns how many were removed. */
export function dropStructureEntities(/** @type {Compound} */ roots) {
  const structure = get(roots[0]?.[1].value ?? [], 'structure');
  const entities = structure ? get(structure.value, 'entities') : undefined;
  if (!entities || entities.type !== TAG.List) return 0;
  const count = entities.value.items.length;
  entities.value.items = [];
  return count;
}

/**
 * Renames string values and compound keys throughout a tree (block names, block state names,
 * entity identifiers); returns how many were renamed per key.
 * @param {Compound} roots @param {Record<string, string>} map
 */
export function renameStrings(roots, map) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(Object.keys(map).map((k) => [k, 0]));
  const visit = (/** @type {Tag} */ tag) => {
    if (tag.type === TAG.String && tag.value in map) { counts[tag.value]++; tag.value = map[tag.value]; }
    else if (tag.type === TAG.List) for (const item of tag.value.items) visit({ type: tag.value.itemType, value: item });
    else if (tag.type === TAG.Compound) {
      for (const entry of /** @type {Compound} */ (tag.value)) {
        if (entry[0] in map) { counts[entry[0]]++; entry[0] = map[entry[0]]; }
        visit(entry[1]);
      }
    }
  };
  for (const [, tag] of roots) visit(tag);
  return counts;
}

export { TAG };
