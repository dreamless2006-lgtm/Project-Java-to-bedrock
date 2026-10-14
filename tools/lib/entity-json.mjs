// Bedrock loads actor properties with a typed parser: a float property whose default (or range) is
// written as "0", which is what JSON.stringify makes of 0.0, fails with "'default' value does not
// match the specified type 'float'", and with it every property of the entity is dropped. Every
// behavior entity file is written through this, which keeps float literals float.
import { writeFileSync } from 'node:fs';

/** @param {unknown} doc */
export function stringifyEntity(doc) {
  /** @type {string[]} */
  const marks = [];
  const clone = JSON.parse(JSON.stringify(doc));
  const mark = (/** @type {number} */ n) => `__FLOAT_${marks.push(Number.isInteger(n) ? `${n}.0` : String(n)) - 1}__`;
  const properties = clone?.['minecraft:entity']?.description?.properties ?? {};
  for (const property of Object.values(properties)) {
    if (property.type !== 'float') continue;
    if (typeof property.default === 'number') property.default = mark(property.default);
    if (Array.isArray(property.range)) property.range = property.range.map((/** @type {unknown} */ n) => (typeof n === 'number' ? mark(n) : n));
  }
  return JSON.stringify(clone, null, 2).replace(/"__FLOAT_(\d+)__"/g, (m, i) => marks[Number(i)]) + '\n';
}

/** @param {string} path @param {unknown} doc */
export const writeEntityJson = (path, doc) => writeFileSync(path, stringifyEntity(doc));

/**
 * The float literals of a behavior entity file as the game's parser sees them: every float
 * property's default and range must carry a decimal point. Returns the offending property names.
 * @param {string} text
 */
export function integerFloatLiterals(text) {
  const bad = [];
  for (const block of text.matchAll(/"([a-z_]+:[a-z_]+)":\s*\{[^{}]*"type":\s*"float"[^{}]*\}/g)) {
    const numbers = [...block[0].matchAll(/"(?:default|range)":\s*(\[[^\]]*\]|-?\d+(?:\.\d+)?)/g)].flatMap((m) => m[1].match(/-?\d+(?:\.\d+)?/g) ?? []);
    if (numbers.some((n) => !n.includes('.'))) bad.push(block[1]);
  }
  return bad;
}
