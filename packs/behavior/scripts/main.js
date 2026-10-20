// Entry point of the behavior pack's script module (see manifest.json).
import './blocks/crop.js';
import './blocks/kobold_egg.js';
import './items/food_effects.js';
import './world/leaf_lemons.js';
import './world/banner.js';
import './world/brains.js';
import './world/guide.js';
import './world/debug.js';
import './player/gender.js';
import './player/body.js';
import './pregnancy/index.js';
import './pregnancy/items.js';
import './pregnancy/species.js';
import './pregnancy/attacks.js';
import './pregnancy/commands.js';
import './mobs/index.js';
import './mobs/commands.js';
import './jenny/port.js';
import './jenny/scenes.js';
import './jenny/bed.js';
import './mca/villagers.js';
import './jenny/belly_scenes.js';
import './jenny/kobold_eggs.js';
import './player/compat.js';
import './items/babies.js';

// The Jenny Mod Java Port's own scripts, merged into this pack by tools/import-jenny.mjs when its
// packs are in vendor/jenny/ (a build without them simply has no Jenny girls).
const PORT_SCRIPTS = './jenny_port/main.js';
import(PORT_SCRIPTS).catch((error) => console.warn(`[minepreggo] Jenny Mod Java Port scripts not loaded: ${error}`));
