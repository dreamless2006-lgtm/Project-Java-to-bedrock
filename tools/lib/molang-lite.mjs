// A small Molang evaluator for the preview renders and tests, so animations whose channels are
// Molang strings (the crowning slide, flair trembles, belly pulses) can be posed and measured
// outside the game. It parses the expression itself instead of handing it to JavaScript, because
// the Jenny packs' Molang is third-party input and must not run as code.
//
// What it covers is what our packs use: numbers and strings, v./variable., q./query. (values or
// functions), t./temp., c./context., math.* (angles in degrees, as in the game), + - * /, the
// comparisons, ! && || (they give 1.0 or 0.0, as in the game), ?: and the one-sided `a ? b`,
// ??, assignments, `{ ...; }` blocks and `return`. Names are case-insensitive, as in the game.
// Anything it cannot read evaluates to 0, the way the game treats an unknown variable.

/** @typedef {number | string | undefined} MolangValue undefined: an unset variable (?? sees it) */
/** @typedef {Record<string, any>} MolangScope */
/**
 * Where a Molang expression reads and writes: v (variable.), q (query.: a value, or a function
 * called with the evaluated arguments), t (temp.), c (context.).
 * @typedef {{ v?: MolangScope, q?: MolangScope, t?: MolangScope, c?: MolangScope }} MolangEnv
 */

const DEG = Math.PI / 180;

/**
 * math.* as the game defines it. random picks the middle of its range, so a preview is the same
 * every time it is drawn.
 * @type {Record<string, number | ((...args: number[]) => number)>}
 */
export const MATH = {
  pi: Math.PI,
  abs: Math.abs,
  acos: (x) => Math.acos(x) / DEG,
  asin: (x) => Math.asin(x) / DEG,
  atan: (x) => Math.atan(x) / DEG,
  atan2: (y, x) => Math.atan2(y, x) / DEG,
  ceil: Math.ceil,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  copy_sign: (a, b) => (b < 0 ? -Math.abs(a) : Math.abs(a)),
  cos: (x) => Math.cos(x * DEG),
  die_roll: (n, lo, hi) => (n * (lo + hi)) / 2,
  die_roll_integer: (n, lo, hi) => Math.round((n * (lo + hi)) / 2),
  exp: Math.exp,
  floor: Math.floor,
  hermite_blend: (t) => 3 * t * t - 2 * t * t * t,
  inverse_lerp: (a, b, v) => (b === a ? 0 : (v - a) / (b - a)),
  lerp: (a, b, t) => a + (b - a) * t,
  lerprotate: (a, b, t) => {
    const d = ((((b - a) % 360) + 540) % 360) - 180;
    return a + d * t;
  },
  ln: Math.log,
  max: Math.max,
  min: Math.min,
  min_angle: (a) => ((((a + 180) % 360) + 360) % 360) - 180,
  mod: (a, b) => a % b,
  pow: Math.pow,
  random: (lo, hi) => (lo + hi) / 2,
  random_integer: (lo, hi) => Math.round((lo + hi) / 2),
  round: Math.round,
  sign: (x) => (x < 0 ? -1 : 1),
  sin: (x) => Math.sin(x * DEG),
  sqrt: Math.sqrt,
  trunc: Math.trunc,
};

// ---- tokens ----

/** @typedef {{ kind: 'num', value: number } | { kind: 'str', value: string } | { kind: 'name', value: string } | { kind: 'op', value: string }} Token */

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '??', '->', '<', '>', '+', '-', '*', '/', '!', '?', ':', '(', ')', '{', '}', '[', ']', ',', ';', '='];

/** @returns {Token[]} */
function tokenize(/** @type {string} */ source) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?f?/i.exec(source.slice(i));
      if (m) {
        tokens.push({ kind: 'num', value: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "'" || ch === '"') {
      const end = source.indexOf(ch, i + 1);
      if (end < 0) throw new Error(`unclosed string in ${source}`);
      tokens.push({ kind: 'str', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: 'name', value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new Error(`unexpected '${ch}' in ${source}`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

// ---- compiling into closures (parsed once per source string, then cheap to run) ----

/** @typedef {(env: Frame) => MolangValue} Node */
/** @typedef {{ v: MolangScope, q: MolangScope, t: MolangScope, c: MolangScope }} Frame */

/** Thrown by `return` to leave the program with a value. */
class Return {
  constructor(/** @type {MolangValue} */ value) {
    this.value = value;
  }
}

const toNumber = (/** @type {MolangValue} */ v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : 0) : 0);
const truthy = (/** @type {MolangValue} */ v) => (typeof v === 'string' ? v.length > 0 : toNumber(v) !== 0);
const bool = (/** @type {boolean} */ b) => (b ? 1 : 0);

/** The scope a name prefix reads from, and the name inside it. */
function scopeOf(/** @type {string} */ path) {
  const dot = path.indexOf('.');
  const head = dot < 0 ? path : path.slice(0, dot);
  const rest = dot < 0 ? '' : path.slice(dot + 1);
  const scope = { v: 'v', variable: 'v', q: 'q', query: 'q', t: 't', temp: 't', c: 'c', context: 'c' }[head];
  return { scope: /** @type {'v' | 'q' | 't' | 'c' | undefined} */ (scope), head, rest };
}

class Parser {
  constructor(/** @type {Token[]} */ tokens, /** @type {string} */ source) {
    this.tokens = tokens;
    this.source = source;
    this.at = 0;
  }
  peek(offset = 0) {
    return this.tokens[this.at + offset];
  }
  isOp(/** @type {string} */ value, offset = 0) {
    const t = this.peek(offset);
    return !!t && t.kind === 'op' && t.value === value;
  }
  take(/** @type {string} */ value) {
    if (!this.isOp(value)) throw new Error(`expected '${value}' in ${this.source}`);
    this.at++;
  }

  /** statements separated by ';' until the end or a closing brace */
  program() {
    /** @type {Node[]} */
    const statements = [];
    while (this.at < this.tokens.length && !this.isOp('}')) {
      if (this.isOp(';')) {
        this.at++;
        continue;
      }
      statements.push(this.statement());
      if (this.at < this.tokens.length && !this.isOp('}')) this.take(';');
    }
    return statements;
  }

  /** @returns {Node} */
  statement() {
    const t = this.peek();
    if (t?.kind === 'name' && t.value === 'return') {
      this.at++;
      const value = this.expression();
      return (env) => {
        throw new Return(value(env));
      };
    }
    // assignment: a writable name, then '=' (not '==')
    if (t?.kind === 'name' && this.isOp('=', 1)) {
      const { scope, rest } = scopeOf(t.value);
      if (!scope || scope === 'q' || !rest) throw new Error(`cannot assign to ${t.value} in ${this.source}`);
      this.at += 2;
      const value = this.expression();
      return (env) => {
        const v = value(env);
        env[scope][rest] = v;
        return v;
      };
    }
    return this.expression();
  }

  /** @returns {Node} */
  expression() {
    return this.ternary();
  }

  /** @returns {Node} */
  ternary() {
    const cond = this.coalesce();
    if (!this.isOp('?')) return cond;
    this.at++;
    const yes = this.ternary();
    if (!this.isOp(':')) return (env) => (truthy(cond(env)) ? yes(env) : 0);
    this.at++;
    const no = this.ternary();
    return (env) => (truthy(cond(env)) ? yes(env) : no(env));
  }

  /** @returns {Node} */
  coalesce() {
    let left = this.or();
    while (this.isOp('??')) {
      this.at++;
      const a = left, b = this.or();
      left = (env) => a(env) ?? b(env);
    }
    return left;
  }

  /** @returns {Node} */
  or() {
    let left = this.and();
    while (this.isOp('||')) {
      this.at++;
      const a = left, b = this.and();
      left = (env) => bool(truthy(a(env)) || truthy(b(env)));
    }
    return left;
  }

  /** @returns {Node} */
  and() {
    let left = this.equality();
    while (this.isOp('&&')) {
      this.at++;
      const a = left, b = this.equality();
      left = (env) => bool(truthy(a(env)) && truthy(b(env)));
    }
    return left;
  }

  /** @returns {Node} */
  equality() {
    let left = this.comparison();
    while (this.isOp('==') || this.isOp('!=')) {
      const negate = /** @type {Token} */ (this.peek()).value === '!=';
      this.at++;
      const a = left, b = this.comparison();
      left = (env) => {
        const x = a(env), y = b(env);
        const same = typeof x === 'string' || typeof y === 'string' ? x === y : toNumber(x) === toNumber(y);
        return bool(same !== negate);
      };
    }
    return left;
  }

  /** @returns {Node} */
  comparison() {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || !['<', '<=', '>', '>='].includes(t.value)) return left;
      this.at++;
      const a = left, b = this.additive(), op = t.value;
      left = (env) => {
        const x = toNumber(a(env)), y = toNumber(b(env));
        return bool(op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y);
      };
    }
  }

  /** @returns {Node} */
  additive() {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const minus = /** @type {Token} */ (this.peek()).value === '-';
      this.at++;
      const a = left, b = this.multiplicative();
      left = minus ? (env) => toNumber(a(env)) - toNumber(b(env)) : (env) => toNumber(a(env)) + toNumber(b(env));
    }
    return left;
  }

  /** @returns {Node} */
  multiplicative() {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const divide = /** @type {Token} */ (this.peek()).value === '/';
      this.at++;
      const a = left, b = this.unary();
      left = divide
        ? (env) => {
            const d = toNumber(b(env));
            return d === 0 ? 0 : toNumber(a(env)) / d;
          }
        : (env) => toNumber(a(env)) * toNumber(b(env));
    }
    return left;
  }

  /** @returns {Node} */
  unary() {
    if (this.isOp('!')) {
      this.at++;
      const a = this.unary();
      return (env) => bool(!truthy(a(env)));
    }
    if (this.isOp('-')) {
      this.at++;
      const a = this.unary();
      return (env) => -toNumber(a(env));
    }
    if (this.isOp('+')) {
      this.at++;
      return this.unary();
    }
    return this.primary();
  }

  /** @returns {Node} */
  primary() {
    const t = this.peek();
    if (!t) throw new Error(`unexpected end of ${this.source}`);
    this.at++;
    if (t.kind === 'num' || t.kind === 'str') {
      const value = t.value;
      return () => value;
    }
    if (t.kind === 'op' && t.value === '(') {
      const inner = this.expression();
      this.take(')');
      return inner;
    }
    if (t.kind === 'op' && t.value === '{') {
      // a block of statements: runs them, is worth 0 (a `return` inside leaves the program)
      const statements = this.program();
      this.take('}');
      return (env) => {
        for (const s of statements) s(env);
        return 0;
      };
    }
    if (t.kind === 'name') {
      /** @type {Node[] | undefined} */
      let args;
      if (this.isOp('(')) {
        this.at++;
        args = [];
        while (!this.isOp(')')) {
          args.push(this.expression());
          if (!this.isOp(')')) this.take(',');
        }
        this.take(')');
      }
      return this.name(t.value, args);
    }
    throw new Error(`unexpected '${t.value}' in ${this.source}`);
  }

  /** @returns {Node} */
  name(/** @type {string} */ path, /** @type {Node[] | undefined} */ args) {
    if (path === 'this' || path === 'true' || path === 'false') {
      const value = path === 'true' ? 1 : 0;
      return () => value;
    }
    const { scope, head, rest } = scopeOf(path);
    if (head === 'math') {
      const fn = MATH[rest];
      if (fn === undefined) throw new Error(`unknown math.${rest} in ${this.source}`);
      if (typeof fn === 'number') return () => fn;
      const list = args ?? [];
      return (env) => fn(...list.map((a) => toNumber(a(env))));
    }
    if (!scope) {
      // geometry.x, texture.x, material.x and the like: their own name, as a render controller reads them
      return () => path;
    }
    const list = args ?? [];
    if (scope === 'q') {
      return (env) => {
        const q = env.q[rest];
        const value = typeof q === 'function' ? q(...list.map((a) => a(env))) : q;
        return value === undefined || value === null ? 0 : typeof value === 'boolean' ? bool(value) : value;
      };
    }
    return (env) => {
      const v = env[scope][rest];
      return typeof v === 'boolean' ? bool(v) : v;
    };
  }
}

/** @type {Map<string, Node>} */
const compiled = new Map();

/**
 * Parses a Molang expression or program once (cached by its text).
 * @param {string} source
 * @returns {Node}
 */
export function compileMolang(source) {
  let fn = compiled.get(source);
  if (fn) return fn;
  const parser = new Parser(tokenize(source), source);
  const statements = parser.program();
  if (parser.at < parser.tokens.length) throw new Error(`unexpected '${parser.peek()?.value}' in ${source}`);
  // a single expression is worth its value; a program of statements is worth its `return` (else 0)
  const single = statements.length === 1 && !/;\s*\S/.test(source) && !/\breturn\b/i.test(source) ? statements[0] : undefined;
  fn = (env) => {
    try {
      if (single) return single(env);
      for (const s of statements) s(env);
      return 0;
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    }
  };
  compiled.set(source, fn);
  return fn;
}

/** Fills in the scopes a caller left out (the objects themselves are used, so writes land in them). */
const frameOf = (/** @type {MolangEnv} */ env) => /** @type {Frame} */ ({ v: env.v ?? {}, q: env.q ?? {}, t: env.t ?? {}, c: env.c ?? {} });

/**
 * The raw value of a Molang expression: a number, a string, or undefined for an unset variable.
 * Numbers and booleans pass through (booleans as 1/0).
 * @param {unknown} expr
 * @param {MolangEnv} [env]
 * @returns {MolangValue}
 */
export function evaluate(expr, env = {}) {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'boolean') return bool(expr);
  if (typeof expr !== 'string') return undefined;
  return compileMolang(expr)(frameOf(env));
}

/**
 * A Molang expression as a number, as an animation channel reads it: strings, unset variables,
 * NaN and anything that fails to parse count as 0.
 * @param {unknown} expr
 * @param {MolangEnv} [env]
 */
export function evalMolang(expr, env = {}) {
  try {
    return toNumber(evaluate(expr, env));
  } catch {
    return 0;
  }
}

/**
 * Runs lines of Molang statements in order (an entity's pre_animation), writing into env.v; lines
 * that fail to parse are skipped. Run it a number of frames to let eased variables settle.
 * @param {string[]} lines
 * @param {MolangEnv} env
 * @param {{ frames?: number }} [options]
 */
export function runMolang(lines, env, { frames = 1 } = {}) {
  const frame = frameOf(env);
  const programs = lines.flatMap((line) => {
    try {
      return [compileMolang(line)];
    } catch {
      return [];
    }
  });
  for (let n = 0; n < frames; n++) {
    for (const program of programs) {
      frame.t = {};
      try {
        program(frame);
      } catch {
        // a line that reads something the preview does not model is left as it was
      }
    }
  }
  return frame.v;
}

/**
 * An evaluator for poseAt's `evaluate` option: Molang strings in channels are read against env,
 * with q.anim_time set to the animation's time.
 * @param {MolangEnv} env
 * @returns {(expr: string, time: number) => number}
 */
export function molangEvaluator(env) {
  return (expr, time) => {
    // her own queries, seen through an object that only adds the animation's time
    const q = Object.create(env.q ?? null);
    q.anim_time = time;
    return evalMolang(expr, { ...env, q });
  };
}
