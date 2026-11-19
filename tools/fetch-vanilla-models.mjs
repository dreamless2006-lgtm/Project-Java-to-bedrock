// Fetches the vanilla mob models and render controllers World Alliance's peoples borrow (Mojang's
// bedrock-samples) into vendor/vanilla-models/, for tools/compat-addons.mjs: their women's
// models are copies of them. Not committed (vendor/ is not); without them those peoples get no women.
//
// Run: node tools/fetch-vanilla-models.mjs (once; needs the network).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = join(ROOT, 'vendor/vanilla-models');
const BASE = 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack';
const MODELS = ['mobs.json', ...['pillager', 'vindicator', 'evoker', 'witch', 'villager', 'villager_v2', 'zombie', 'husk', 'drowned', 'skeleton', 'wither_skeleton', 'piglin', 'enderman', 'zombie_villager_v2'].map((m) => `entity/${m}.geo.json`)];
const CONTROLLERS = ['default', 'fox', 'wolf', 'cow', 'pig', 'sheep', 'chicken', 'horse', 'spider', 'blaze', 'iron_golem', 'snow_golem', 'creeper', 'enderman_v2', 'drowned', 'enderman', 'evoker', 'husk', 'piglin', 'piglin_brute', 'pillager', 'skeleton', 'villager', 'villager_v2', 'villager_v3', 'vindicator', 'wandering_trader', 'warden', 'witch', 'wither_skeleton', 'zombie', 'zombie_pigman', 'zombie_villager'];

mkdirSync(join(OUT, 'render_controllers'), { recursive: true });
for (const [path, to] of [...MODELS.map((m) => [`models/${m}`, m.replace('entity/', '')]), ...CONTROLLERS.map((c) => [`render_controllers/${c}.render_controllers.json`, `render_controllers/${c}.render_controllers.json`])]) {
  const response = await fetch(`${BASE}/${path}`);
  if (!response.ok) {
    console.warn(`warning: ${path}: ${response.status}`);
    continue;
  }
  writeFileSync(join(OUT, to), await response.text());
}
console.log(`vendor/vanilla-models: ${MODELS.length} model files, ${CONTROLLERS.length} render controller files`);
