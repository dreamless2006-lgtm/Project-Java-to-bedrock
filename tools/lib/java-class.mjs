// A minimal Java class-file reader and bytecode interpreter, just enough to run the static
// "create...Layer()" methods of the mod's entity models and the static initializers of its
// keyframe animation classes. Those only build trees of parts, cubes and keyframes through a
// handful of vanilla builder calls, so the vanilla side is supplied by the caller as plain JS
// functions (see java-models.mjs) and everything else is refused.
//
// Spec: https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-4.html (class file format)
// and https://docs.oracle.com/javase/specs/jvms/se17/html/jvms-6.html (instructions).

/**
 * @typedef {{ tag: number, value?: any, a?: number, b?: number }} CpEntry
 * @typedef {{ name: string, descriptor: string, access: number, code: Uint8Array | null, maxLocals: number }} MethodInfo
 * @typedef {{ name: string, superName: string | null, cp: CpEntry[], methods: MethodInfo[] }} ClassFile
 */

const ACC_STATIC = 0x0008;

/** @param {Uint8Array} bytes @returns {ClassFile} */
export function parseClass(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const u1 = () => view.getUint8(pos++);
  const u2 = () => { const v = view.getUint16(pos); pos += 2; return v; };
  const u4 = () => { const v = view.getUint32(pos); pos += 4; return v; };
  if (u4() !== 0xcafebabe) throw new Error('not a class file');
  pos += 4; // minor, major version

  /** @type {CpEntry[]} */
  const cp = [];
  const count = u2();
  for (let i = 1; i < count; i++) {
    const tag = u1();
    switch (tag) {
      case 1: { // Utf8 (modified UTF-8; identifiers in this jar are plain ASCII)
        const len = u2();
        cp[i] = { tag, value: new TextDecoder().decode(bytes.subarray(pos, pos + len)) };
        pos += len;
        break;
      }
      case 3: cp[i] = { tag, value: view.getInt32(pos) }; pos += 4; break;
      case 4: cp[i] = { tag, value: view.getFloat32(pos) }; pos += 4; break;
      case 5: cp[i] = { tag, value: Number(view.getBigInt64(pos)) }; pos += 8; i++; break;
      case 6: cp[i] = { tag, value: view.getFloat64(pos) }; pos += 8; i++; break;
      case 7: case 8: case 16: case 19: case 20: cp[i] = { tag, a: u2() }; break;
      case 9: case 10: case 11: case 12: case 17: case 18: cp[i] = { tag, a: u2(), b: u2() }; break;
      case 15: cp[i] = { tag, a: u1(), b: u2() }; break;
      default: throw new Error(`unknown constant pool tag ${tag}`);
    }
  }
  const utf8 = (/** @type {number} */ i) => cp[i].value;
  const className = (/** @type {number} */ i) => (i ? utf8(/** @type {number} */ (cp[i].a)) : null);

  pos += 2; // access flags
  const name = className(u2());
  const superName = className(u2());
  const interfaces = u2();
  pos += 2 * interfaces;

  const skipAttributes = () => {
    for (let n = u2(); n > 0; n--) {
      pos += 2;
      const len = u4();
      pos += len;
    }
  };
  for (let n = u2(); n > 0; n--) { pos += 6; skipAttributes(); } // fields

  /** @type {MethodInfo[]} */
  const methods = [];
  for (let n = u2(); n > 0; n--) {
    const access = u2();
    const methodName = utf8(u2());
    const descriptor = utf8(u2());
    let code = null;
    let maxLocals = 0;
    for (let a = u2(); a > 0; a--) {
      const attrName = utf8(u2());
      const len = u4();
      if (attrName === 'Code') {
        maxLocals = view.getUint16(pos + 2);
        const codeLen = view.getUint32(pos + 4);
        code = bytes.subarray(pos + 8, pos + 8 + codeLen);
      }
      pos += len;
    }
    methods.push({ name: methodName, descriptor, access, code, maxLocals });
  }
  return { name: /** @type {string} */ (name), superName, cp, methods };
}

/** Splits a method descriptor into its parameter types, e.g. "(FLjava/lang/String;[I)V" -> ["F", "Ljava/lang/String;", "[I"]. */
export function parameterTypes(descriptor) {
  const types = [];
  const params = descriptor.slice(1, descriptor.indexOf(')'));
  for (let i = 0; i < params.length;) {
    let j = i;
    while (params[j] === '[') j++;
    j = params[j] === 'L' ? params.indexOf(';', j) + 1 : j + 1;
    types.push(params.slice(i, j));
    i = j;
  }
  return types;
}

const isWide = (/** @type {string} */ type) => type === 'J' || type === 'D';

/**
 * @typedef {(args: any[], self?: any) => any} NativeMethod
 * @typedef {{
 *   loadClass: (internalName: string) => ClassFile | null,
 *   natives: Record<string, NativeMethod>,
 *   staticFields?: Record<string, any>,
 *   newObject?: (internalName: string) => any,
 *   maxSteps?: number,
 * }} InterpreterOptions
 */

/**
 * Creates an interpreter for static methods. Calls into classes that `loadClass` can provide are
 * interpreted; every other call must be covered by `natives`, keyed "Owner.name" where Owner is the
 * simple class name (e.g. "CubeListBuilder.m_171514_", constructors as "CubeDeformation.<init>").
 * @param {InterpreterOptions} options
 */
export function createInterpreter({ loadClass, natives, staticFields = {}, newObject = () => ({}), maxSteps = 1_000_000 }) {
  const simpleName = (/** @type {string} */ internal) => internal.slice(internal.lastIndexOf('/') + 1);
  let steps = 0;
  /** Static fields of interpreted classes, filled by running their <clinit> on first use. */
  const classStatics = new Map();

  function staticsOf(/** @type {string} */ owner) {
    let statics = classStatics.get(owner);
    if (!statics) {
      statics = {};
      classStatics.set(owner, statics);
      const init = loadClass(owner)?.methods.find((m) => m.name === '<clinit>');
      if (init?.code) execute(/** @type {ClassFile} */ (loadClass(owner)), init, []);
    }
    return statics;
  }

  /** Finds a method in a loadable class or its loadable superclasses. */
  function findMethod(owner, name, descriptor) {
    for (let cls = loadClass(owner); cls; cls = cls.superName ? loadClass(cls.superName) : null) {
      const method = cls.methods.find((m) => m.name === name && m.descriptor === descriptor);
      if (method) return { cls, method };
    }
    return null;
  }

  function call(owner, name, descriptor, args, self) {
    const found = findMethod(owner, name, descriptor);
    if (found?.method.code) return execute(found.cls, found.method, self === undefined ? args : [self, ...args]);
    const native = natives[`${simpleName(owner)}.${name}`];
    if (!native) throw new Error(`unsupported call ${owner}.${name}${descriptor}`);
    return native(args, self);
  }

  /**
   * @param {ClassFile} cls
   * @param {MethodInfo} method
   * @param {any[]} args
   */
  function execute(cls, method, args) {
    const code = /** @type {Uint8Array} */ (method.code);
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const { cp } = cls;
    const locals = new Array(method.maxLocals).fill(undefined);
    {
      let slot = 0;
      const types = parameterTypes(method.descriptor);
      if (!(method.access & ACC_STATIC)) locals[slot++] = args.shift();
      types.forEach((type, i) => { locals[slot] = args[i]; slot += isWide(type) ? 2 : 1; });
    }
    /** @type {any[]} */
    const stack = [];
    const pop = () => stack.pop();
    const popN = (/** @type {number} */ n) => stack.splice(stack.length - n, n);
    const f = Math.fround;
    const utf8 = (/** @type {number} */ i) => cp[i].value;
    const memberRef = (/** @type {number} */ i) => {
      const ref = cp[i];
      const nat = cp[/** @type {number} */ (ref.b)];
      return {
        owner: utf8(/** @type {number} */ (cp[/** @type {number} */ (ref.a)].a)),
        name: utf8(/** @type {number} */ (nat.a)),
        descriptor: utf8(/** @type {number} */ (nat.b)),
      };
    };
    const constant = (/** @type {number} */ i) => {
      const entry = cp[i];
      if (entry.tag === 8) return utf8(/** @type {number} */ (entry.a));
      if (entry.tag === 3 || entry.tag === 4 || entry.tag === 5 || entry.tag === 6) return entry.value;
      throw new Error(`unsupported ldc constant tag ${entry.tag}`);
    };
    const invoke = (/** @type {number} */ index, /** @type {boolean} */ isStatic) => {
      const ref = memberRef(index);
      const args = popN(parameterTypes(ref.descriptor).length);
      const self = isStatic ? undefined : pop();
      const result = call(ref.owner, ref.name, ref.descriptor, args, self);
      if (!ref.descriptor.endsWith(')V')) stack.push(result);
    };
    const branch = (/** @type {number} */ at, /** @type {boolean} */ taken) => (taken ? at + view.getInt16(at + 1) : at + 3);

    let pc = 0;
    for (;;) {
      if (++steps > maxSteps) throw new Error(`gave up after ${maxSteps} instructions in ${cls.name}.${method.name}`);
      const op = code[pc];
      switch (op) {
        case 0x00: pc++; break; // nop
        case 0x01: stack.push(null); pc++; break; // aconst_null
        case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08:
          stack.push(op - 0x03); pc++; break; // iconst_<n>
        case 0x09: case 0x0a: stack.push(op - 0x09); pc++; break; // lconst_<n>
        case 0x0b: case 0x0c: case 0x0d: stack.push(op - 0x0b); pc++; break; // fconst_<n>
        case 0x0e: case 0x0f: stack.push(op - 0x0e); pc++; break; // dconst_<n>
        case 0x10: stack.push(view.getInt8(pc + 1)); pc += 2; break; // bipush
        case 0x11: stack.push(view.getInt16(pc + 1)); pc += 3; break; // sipush
        case 0x12: stack.push(constant(code[pc + 1])); pc += 2; break; // ldc
        case 0x13: case 0x14: stack.push(constant(view.getUint16(pc + 1))); pc += 3; break; // ldc_w, ldc2_w
        case 0x15: case 0x16: case 0x17: case 0x18: case 0x19: stack.push(locals[code[pc + 1]]); pc += 2; break; // <t>load
        case 0x36: case 0x37: case 0x38: case 0x39: case 0x3a: locals[code[pc + 1]] = pop(); pc += 2; break; // <t>store
        default:
          if (op >= 0x1a && op <= 0x2d) { stack.push(locals[(op - 0x1a) % 4]); pc++; break; } // <t>load_<n>
          if (op >= 0x3b && op <= 0x4e) { locals[(op - 0x3b) % 4] = pop(); pc++; break; } // <t>store_<n>
          pc = other(op, pc);
          if (pc < 0) return pc === -1 ? undefined : stack.pop();
      }
    }

    /** Less common instructions. Returns the next pc, -1 for `return` or -2 for a value return. */
    function other(/** @type {number} */ op, /** @type {number} */ at) {
      switch (op) {
        case 0x57: pop(); return at + 1; // pop
        case 0x59: stack.push(stack[stack.length - 1]); return at + 1; // dup
        case 0x60: { const b = pop(); stack.push((pop() + b) | 0); return at + 1; } // iadd
        case 0x64: { const b = pop(); stack.push((pop() - b) | 0); return at + 1; } // isub
        case 0x68: { const b = pop(); stack.push(Math.imul(pop(), b)); return at + 1; } // imul
        case 0x62: { const b = pop(); stack.push(f(pop() + b)); return at + 1; } // fadd
        case 0x66: { const b = pop(); stack.push(f(pop() - b)); return at + 1; } // fsub
        case 0x6a: { const b = pop(); stack.push(f(pop() * b)); return at + 1; } // fmul
        case 0x6e: { const b = pop(); stack.push(f(pop() / b)); return at + 1; } // fdiv
        case 0x63: { const b = pop(); stack.push(pop() + b); return at + 1; } // dadd
        case 0x67: { const b = pop(); stack.push(pop() - b); return at + 1; } // dsub
        case 0x6b: { const b = pop(); stack.push(pop() * b); return at + 1; } // dmul
        case 0x6f: { const b = pop(); stack.push(pop() / b); return at + 1; } // ddiv
        case 0x74: stack.push(-pop() | 0); return at + 1; // ineg
        case 0x76: stack.push(f(-pop())); return at + 1; // fneg
        case 0x77: stack.push(-pop()); return at + 1; // dneg
        case 0x84: locals[code[at + 1]] = (locals[code[at + 1]] + view.getInt8(at + 2)) | 0; return at + 3; // iinc
        case 0x86: stack.push(f(pop())); return at + 1; // i2f
        case 0x87: case 0x8d: return at + 1; // i2d, f2d
        case 0x8b: case 0x8e: stack.push(Math.trunc(pop()) | 0); return at + 1; // f2i, d2i
        case 0x90: stack.push(f(pop())); return at + 1; // d2f
        case 0x95: case 0x96: case 0x97: case 0x98: { // fcmpl, fcmpg, dcmpl, dcmpg
          const b = pop(); const a = pop();
          stack.push(Number.isNaN(a) || Number.isNaN(b) ? (op % 2 ? -1 : 1) : Math.sign(a - b));
          return at + 1;
        }
        case 0x99: return branch(at, pop() === 0); // ifeq
        case 0x9a: return branch(at, pop() !== 0); // ifne
        case 0x9b: return branch(at, pop() < 0); // iflt
        case 0x9c: return branch(at, pop() >= 0); // ifge
        case 0x9d: return branch(at, pop() > 0); // ifgt
        case 0x9e: return branch(at, pop() <= 0); // ifle
        case 0x9f: case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: { // if_icmp<cond>
          const b = pop(); const a = pop();
          const taken = [a === b, a !== b, a < b, a >= b, a > b, a <= b][op - 0x9f];
          return branch(at, taken);
        }
        case 0xa5: { const b = pop(); return branch(at, pop() === b); } // if_acmpeq
        case 0xa6: { const b = pop(); return branch(at, pop() !== b); } // if_acmpne
        case 0xc6: return branch(at, pop() == null); // ifnull
        case 0xc7: return branch(at, pop() != null); // ifnonnull
        case 0xa7: return branch(at, true); // goto
        case 0xac: case 0xad: case 0xae: case 0xaf: case 0xb0: return -2; // <t>return
        case 0xb1: return -1; // return
        case 0xb2: { // getstatic
          const ref = memberRef(view.getUint16(at + 1));
          if (loadClass(ref.owner)) {
            stack.push(staticsOf(ref.owner)[ref.name]);
            return at + 3;
          }
          const key = `${simpleName(ref.owner)}.${ref.name}`;
          if (!(key in staticFields)) throw new Error(`unsupported static field ${ref.owner}.${ref.name}`);
          stack.push(staticFields[key]);
          return at + 3;
        }
        case 0xb3: { // putstatic
          const ref = memberRef(view.getUint16(at + 1));
          if (!loadClass(ref.owner)) throw new Error(`cannot assign static field ${ref.owner}.${ref.name}`);
          staticsOf(ref.owner)[ref.name] = pop();
          return at + 3;
        }
        case 0xb4: { const ref = memberRef(view.getUint16(at + 1)); stack.push(pop()[ref.name]); return at + 3; } // getfield
        case 0xb5: { const ref = memberRef(view.getUint16(at + 1)); const v = pop(); pop()[ref.name] = v; return at + 3; } // putfield
        case 0xb6: case 0xb9: invoke(view.getUint16(at + 1), false); return at + (op === 0xb9 ? 5 : 3); // invokevirtual, invokeinterface
        case 0xb7: { // invokespecial: constructors of native objects
          const ref = memberRef(view.getUint16(at + 1));
          const args = popN(parameterTypes(ref.descriptor).length);
          const self = pop();
          call(ref.owner, ref.name, ref.descriptor, args, self);
          return at + 3;
        }
        case 0xb8: invoke(view.getUint16(at + 1), true); return at + 3; // invokestatic
        case 0xbb: { // new
          const owner = utf8(/** @type {number} */ (cp[view.getUint16(at + 1)].a));
          stack.push(newObject(owner));
          return at + 3;
        }
        case 0xbc: case 0xbd: stack.push(new Array(pop()).fill(op === 0xbc ? 0 : null)); return at + (op === 0xbc ? 2 : 3); // newarray, anewarray
        case 0xbe: stack.push(pop().length); return at + 1; // arraylength
        case 0x2e: case 0x30: case 0x32: { const i = pop(); stack.push(pop()[i]); return at + 1; } // iaload, faload, aaload
        case 0x4f: case 0x51: case 0x53: { const v = pop(); const i = pop(); pop()[i] = v; return at + 1; } // iastore, fastore, aastore
        case 0xc0: return at + 3; // checkcast
        default: throw new Error(`unsupported opcode 0x${op.toString(16)} at ${at} in ${cls.name}.${method.name}`);
      }
    }
  }

  return {
    /** Runs a class's static initializer (once) and returns its static fields by name. */
    staticFields: staticsOf,
    /** Runs a static method and returns its result. */
    runStatic(/** @type {string} */ owner, /** @type {string} */ name, /** @type {string} */ descriptor, /** @type {any[]} */ args = []) {
      const found = findMethod(owner, name, descriptor);
      if (!found?.method.code) throw new Error(`method ${owner}.${name}${descriptor} not found`);
      return execute(found.cls, found.method, args);
    },
  };
}
