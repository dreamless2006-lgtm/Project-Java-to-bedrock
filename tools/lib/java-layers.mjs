// Finds the mod's entity model layers by the names it registers them under, whatever its classes are
// called: newer releases of the mod are obfuscated (its classes and methods renamed to letters), but a
// Forge mod still registers each layer as `event.registerLayerDefinition(LAYER, Model::createLayer)`,
// where LAYER is a ModelLayerLocation built from readable strings ("zombie_girl_p5", "main"). Reading
// that registration and the static initializers of the LAYER fields pairs each name with the static
// method that builds it, which tools/lib/java-models.mjs then runs like any other.
import { parseClass } from './java-class.mjs';

/** Bytes each opcode takes (with its operands); 0 marks the variable-length switches and wide. */
const LENGTH = new Uint8Array(256).fill(1);
for (const [op, n] of [[0x10, 2], [0x11, 3], [0x12, 2], [0x13, 3], [0x14, 3], [0x84, 3], [0xa9, 2], [0xbc, 2], [0xb9, 5], [0xba, 5], [0xc5, 4], [0xc8, 5], [0xc9, 5], [0xaa, 0], [0xab, 0], [0xc4, 0]]) LENGTH[op] = n;
for (let op = 0x15; op <= 0x19; op++) LENGTH[op] = 2;
for (let op = 0x36; op <= 0x3a; op++) LENGTH[op] = 2;
for (let op = 0x99; op <= 0xa8; op++) LENGTH[op] = 3;
for (let op = 0xb2; op <= 0xb8; op++) LENGTH[op] = 3;
for (const op of [0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7]) LENGTH[op] = 3;

/** The instructions of a method's code: opcode, offset and its first 16-bit operand. */
function* instructions(/** @type {Uint8Array} */ code) {
  let pc = 0;
  while (pc < code.length) {
    const op = code[pc];
    const operand = pc + 2 < code.length ? (code[pc + 1] << 8) | code[pc + 2] : 0;
    yield { op, pc, operand, byte: code[pc + 1] };
    let n = LENGTH[op];
    if (op === 0xaa || op === 0xab) {
      const base = (pc + 4) & ~3;
      const word = (/** @type {number} */ at) => (code[at] << 24) | (code[at + 1] << 16) | (code[at + 2] << 8) | code[at + 3];
      n = op === 0xaa ? base - pc + 12 + 4 * (word(base + 8) - word(base + 4) + 1) : base - pc + 8 + 8 * word(base + 4);
    } else if (op === 0xc4) n = code[pc + 1] === 0x84 ? 6 : 4;
    pc += n;
  }
}

/**
 * Every model layer the jar registers: "name" for its main layer, "name#layer" for the others
 * (armor layers), each with the class and static method that builds it.
 * @param {Record<string, Uint8Array>} files the jar's entries
 * @param {string} prefix the mod's package, e.g. "dev/dixmk/minepreggo/"
 * @returns {Map<string, { className: string, method: string }>}
 */
export function registeredLayers(files, prefix) {
  /** @type {Map<string, import('./java-class.mjs').ClassFile>} */
  const cache = new Map();
  const load = (/** @type {string} */ name) => {
    if (!cache.has(name)) {
      const bytes = files[`${name}.class`];
      if (bytes) cache.set(name, parseClass(bytes));
    }
    return cache.get(name);
  };
  const text = new TextDecoder();
  /** @type {Array<{ field: string, method: { className: string, method: string } }>} */
  const registrations = [];
  for (const entry of Object.keys(files)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.class') || !text.decode(files[entry]).includes('registerLayerDefinition')) continue;
    const cls = load(entry.slice(0, -6));
    if (!cls) continue;
    const cp = cls.cp;
    const utf8 = (/** @type {number} */ i) => /** @type {string} */ (cp[i].value);
    const memberRef = (/** @type {number} */ i) => {
      const ref = cp[i];
      const nat = cp[/** @type {number} */ (ref.b)];
      return { owner: utf8(/** @type {number} */ (cp[/** @type {number} */ (ref.a)].a)), name: utf8(/** @type {number} */ (nat.a)), descriptor: utf8(/** @type {number} */ (nat.b)) };
    };
    for (const method of cls.methods) {
      if (!method.code) continue;
      /** @type {string | null} */
      let layerField = null;
      for (const { op, operand } of instructions(method.code)) {
        if (op === 0xb2) {
          const ref = memberRef(operand);
          layerField = ref.descriptor === 'Lnet/minecraft/client/model/geom/ModelLayerLocation;' ? `${ref.owner}.${ref.name}` : layerField;
        } else if (op === 0xba && layerField) {
          // the lambda's target: a static method returning a LayerDefinition
          const bsm = cls.bootstrapMethods?.[/** @type {number} */ (cp[operand].a)];
          for (const arg of bsm?.args ?? []) {
            if (cp[arg]?.tag !== 15) continue;
            const target = memberRef(/** @type {number} */ (cp[arg].b));
            if (target.descriptor.endsWith(')Lnet/minecraft/client/model/geom/builders/LayerDefinition;')) registrations.push({ field: layerField, method: { className: target.owner, method: target.name } });
          }
          layerField = null;
        }
      }
    }
  }
  // the names of the LAYER fields, from the strings their static initializer builds them with
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const owner of new Set(registrations.map((r) => r.field.slice(0, r.field.lastIndexOf('.'))))) {
    const cls = load(owner);
    const clinit = cls?.methods.find((m) => m.name === '<clinit>');
    if (!cls || !clinit?.code) continue;
    const cp = cls.cp;
    /** @type {string[]} */
    let strings = [];
    for (const { op, operand, byte } of instructions(clinit.code)) {
      if (op === 0x12 || op === 0x13) {
        const c = cp[op === 0x12 ? byte : operand];
        if (c?.tag === 8) strings.push(/** @type {string} */ (cp[/** @type {number} */ (c.a)].value));
      } else if (op === 0xb3) {
        const ref = cp[operand];
        const nat = cp[/** @type {number} */ (ref.b)];
        if (cp[/** @type {number} */ (nat.b)].value === 'Lnet/minecraft/client/model/geom/ModelLayerLocation;') {
          const own = strings.filter((s) => s !== 'minepreggo');
          const [path, layer = 'main'] = own.length > 1 ? [own[own.length - 2], own[own.length - 1]] : [own[0], 'main'];
          if (path) names.set(`${owner}.${cp[/** @type {number} */ (nat.a)].value}`, layer === 'main' ? path : `${path}#${layer}`);
        }
        strings = [];
      }
    }
  }
  /** @type {Map<string, { className: string, method: string }>} */
  const out = new Map();
  for (const { field, method } of registrations) {
    const name = names.get(field);
    if (name && !out.has(name)) out.set(name, method);
  }
  return out;
}
