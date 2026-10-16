// Renders every mother in her birth pose with the baby crowning at a few depths (tools/lib/crowning.mjs),
// so the crowning geometry can be checked against her body: `node tools/render-crowning.mjs`.
// The picture goes to dist/preview/crowning.png (git-ignored: it shows the mod's textures).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contactSheet, mergePoses, poseAt, renderParts } from './lib/geo-render.mjs';
import { decodePng, encodePng } from './lib/png.mjs';
import { FAMILY_CROWNING, FETUS_SCALE } from './lib/crowning.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const RP = join(ROOT, 'packs/resource');
const MODELS = join(RP, 'models/entity/minepreggo');
const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
const geometryOf = (/** @type {string} */ file) => read(file)['minecraft:geometry'][0];
const png = (/** @type {string} */ path) => decodePng(new Uint8Array(readFileSync(join(RP, `${path}.png`))));
const DEPTHS = [0.6, 2.4, 6];
const PHASE = 7;

/** @type {{ name: string, body: any, texture: any, crown: any, fetus: any, birth: any }[]} */
const mothers = [];
for (const [family, spec] of Object.entries(FAMILY_CROWNING)) {
  const entity = read(join(RP, 'entity', `${family}.entity.json`))['minecraft:client_entity'].description;
  const base = String(entity.textures.default);
  const birthFile = join(RP, 'animations/minepreggo', `${family}.animation.json`);
  const birth = existsSync(birthFile) ? read(birthFile).animations[entity.animations.birth] : undefined;
  mothers.push({
    name: family,
    body: geometryOf(join(MODELS, `${family}_p${PHASE}.geo.json`)),
    texture: png(`${base}_p${PHASE}`),
    crown: geometryOf(join(MODELS, 'crowning', spec.opening === 'navel' ? `${family}_crowning_p${PHASE}.geo.json` : `${family}_crowning.geo.json`)),
    fetus: png(`textures/minepreggo/entity/fetus/${spec.texture}`),
    birth,
  });
}
mothers.push({
  name: 'player',
  body: geometryOf(join(RP, 'models/entity/player_labor.geo.json')),
  texture: png('textures/minepreggo/entity/player/predefined/alex/alex'),
  crown: geometryOf(join(MODELS, 'crowning/player_crowning_humanoid.geo.json')),
  fetus: png('textures/minepreggo/entity/fetus/human_fetus'),
  birth: read(join(RP, 'animations/minepreggo/player_labor.animation.json')).animations['animation.minepreggo.player.labor_birth'],
});

const images = [];
for (const mother of mothers) {
  for (const depth of DEPTHS) {
    const pose = mergePoses([mother.birth ? poseAt(mother.birth, 0.5) : {}, { crowning: { scale: [FETUS_SCALE, FETUS_SCALE, FETUS_SCALE] }, crowning_slide: { position: [0, -depth, 0] } }]);
    images.push(renderParts([
      { geometry: mother.body, texture: mother.texture },
      { geometry: mother.crown, texture: mother.fetus },
    ], pose, { yaw: Number(process.env.YAW ?? 15), pitch: Number(process.env.PITCH ?? 50), scale: 7 }, { width: 240, height: 220 }));
  }
}
mkdirSync(join(ROOT, 'dist/preview'), { recursive: true });
const out = join(ROOT, 'dist/preview/crowning.png');
writeFileSync(out, encodePng(contactSheet(images, DEPTHS.length)));
console.log(`wrote ${out} (${mothers.map((m) => m.name).join(', ')}; depths ${DEPTHS.join(', ')})`);
