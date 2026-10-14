// Minimal stand-in for @minecraft/server so the pregnancy engine can run under `node --test`.
// Only what the engine touches is modelled; anything else throws loudly.

const signal = () => {
  const listeners = [];
  return { listeners, subscribe: (fn) => (listeners.push(fn), fn), unsubscribe() {} };
};

/** Scheduled jobs of system.runTimeout / runInterval; `system.tick()` advances the clock and runs them. */
const jobs = new Map();
let nextJobId = 1;

export const system = {
  currentTick: 0,
  run: (fn) => fn(),
  runTimeout(fn, delay = 0) {
    const id = nextJobId++;
    jobs.set(id, { fn, at: system.currentTick + Math.max(1, delay), every: 0 });
    return id;
  },
  runInterval(fn, every = 1) {
    const id = nextJobId++;
    jobs.set(id, { fn, at: system.currentTick + Math.max(1, every), every: Math.max(1, every) });
    return id;
  },
  clearRun(id) {
    jobs.delete(id);
  },
  /** Advances `ticks` game ticks, running every due job like the game would. */
  tick(ticks = 1) {
    for (let i = 0; i < ticks; i++) {
      system.currentTick++;
      for (const [id, job] of [...jobs]) {
        if (job.at > system.currentTick) continue;
        if (job.every) job.at = system.currentTick + job.every;
        else jobs.delete(id);
        job.fn();
      }
    }
  },
  jobs,
  beforeEvents: { startup: signal() },
  afterEvents: { scriptEventReceive: signal() },
};

/** Fires an event signal: every listener is called with `event`. */
export const emit = (sig, event) => sig.listeners.forEach((fn) => fn(event));

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PACK = new URL('../../packs/behavior/', import.meta.url).pathname;
function* jsonFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* jsonFiles(path);
    else if (name.endsWith('.json')) yield JSON.parse(readFileSync(path, 'utf8'));
  }
}
const idsOf = (folder, key) => new Set([...jsonFiles(join(PACK, folder))].map((j) => j[key]?.description?.identifier).filter(Boolean));
const registry = (ids) => ({ get: (id) => (ids.has(id) ? { id } : undefined), getAll: () => [...ids].map((id) => ({ id })) });
export const EntityTypes = registry(idsOf('entities', 'minecraft:entity'));
export const ItemTypes = registry(idsOf('items', 'minecraft:item'));
export const BlockTypes = registry(idsOf('blocks', 'minecraft:block'));

/** What system.beforeEvents.startup registered (custom item/block components). */
export const customComponents = { items: new Map(), blocks: new Map() };
export function startup() {
  emit(system.beforeEvents.startup, {
    itemComponentRegistry: { registerCustomComponent: (id, c) => customComponents.items.set(id, c) },
    blockComponentRegistry: { registerCustomComponent: (id, c) => customComponents.blocks.set(id, c) },
  });
}

let absoluteTime = 0;
export const world = {
  players: [],
  getPlayers: () => world.players,
  getAbsoluteTime: () => absoluteTime,
  getTimeOfDay: () => absoluteTime % 24000,
  setAbsoluteTime: (t) => (absoluteTime = t),
  afterEvents: new Proxy({}, { get: (t, k) => (t[k] ??= signal()) }),
  beforeEvents: new Proxy({}, { get: (t, k) => (t[k] ??= signal()) }),
};

export const EntityDamageCause = { magic: 'magic', entityExplosion: 'entityExplosion', blockExplosion: 'blockExplosion' };
export const EquipmentSlot = { Mainhand: 'Mainhand', Offhand: 'Offhand', Chest: 'Chest' };
export const GameMode = { Survival: 'Survival', Creative: 'Creative', Adventure: 'Adventure', Spectator: 'Spectator' };
export const InputButton = { Jump: 'Jump', Sneak: 'Sneak' };
export const ButtonState = { Pressed: 'Pressed', Released: 'Released' };

const ITEM_JSON = new Map([...jsonFiles(join(PACK, 'items'))].map((j) => [j['minecraft:item'].description.identifier, j['minecraft:item']]));
/** The pack's custom components (with their JSON parameters) of an item. */
export const customComponentsOf = (typeId) => Object.entries(ITEM_JSON.get(typeId)?.components ?? {}).filter(([k]) => k.startsWith('minepreggo:'));

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
  getComponent(id) {
    if (id === 'minecraft:food') {
      const food = ITEM_JSON.get(this.typeId)?.components?.['minecraft:food'];
      return food ? { nutrition: food.nutrition ?? 0, saturationModifier: food.saturation_modifier ?? 0.6, canAlwaysEat: !!food.can_always_eat } : undefined;
    }
    return undefined;
  }
}

const attribute = (value, max = 20) => ({
  currentValue: value,
  effectiveMax: max,
  setCurrentValue(v) {
    this.currentValue = v;
    return true;
  },
});

export class Player {
  constructor(name = 'Alex') {
    this.name = name;
    this.id = `player-${name}`;
    this.typeId = 'minecraft:player';
    this.isValid = true;
    /** entity properties of packs/behavior/entities/player.json */
    this.entityProperties = new Map([['minepreggo:phase', -1], ['minepreggo:pose', 'none'], ['minepreggo:kick', 0], ['minepreggo:growth', 0], ['minepreggo:gender', 'unset'], ['minepreggo:skin', 'custom']]);
    /** what the player picks on the next form (undefined = closes it) */
    this.formSelection = undefined;
    /** @type {ItemStack | undefined} */
    this.held = undefined;
    this.isSneaking = false;
    this.isSprinting = false;
    this.isOnGround = true;
    this.isSleeping = false;
    this.location = { x: 0, y: 64, z: 0 };
    this.properties = new Map();
    this.messages = [];
    this.effects = new Map();
    this.dropped = [];
    this.inventory = [];
    this.gameMode = GameMode.Survival;
    const self = this;
    this.components = {
      'minecraft:health': attribute(20),
      'minecraft:player.exhaustion': attribute(0, 20),
      'minecraft:player.hunger': attribute(20),
      'minecraft:player.saturation': attribute(5),
      'minecraft:inventory': { container: { addItem: (stack) => void self.inventory.push(stack.typeId) } },
      'minecraft:equippable': {
        getEquipment: (slot) => (slot === EquipmentSlot.Mainhand ? self.held : undefined),
        setEquipment: (slot, stack) => (slot === EquipmentSlot.Mainhand ? ((self.held = stack), true) : true),
      },
    };
    this.dimension = {
      id: 'minecraft:overworld',
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => self.dropped.push(stack.typeId),
      getEntities: (options) => world.getDimension('minecraft:overworld').getEntities(options),
    };
    this.onScreenDisplay = { setActionBar: (m) => self.messages.push(m) };
  }
  getComponent(id) {
    return this.components[id];
  }
  getDynamicProperty(key) {
    return this.properties.get(key);
  }
  setDynamicProperty(key, value) {
    if (value === undefined) this.properties.delete(key);
    else this.properties.set(key, value);
  }
  getProperty(id) {
    if (!this.entityProperties.has(id)) throw new Error(`Unknown property ${id}`);
    return this.entityProperties.get(id);
  }
  setProperty(id, value) {
    if (!this.entityProperties.has(id)) throw new Error(`Unknown property ${id}`);
    this.entityProperties.set(id, value);
  }
  sendMessage(m) {
    this.messages.push(m);
  }
  getGameMode() {
    return this.gameMode;
  }
  applyDamage(amount) {
    const health = this.components['minecraft:health'];
    health.currentValue = Math.max(0, health.currentValue - amount);
    return true;
  }
  addEffect(id, duration, options = {}) {
    this.effects.set(id, { typeId: id, duration, amplifier: options.amplifier ?? 0 });
  }
  getEffect(id) {
    return this.effects.get(id);
  }
  getEffects() {
    return [...this.effects.values()];
  }
  removeEffect(id) {
    return this.effects.delete(id);
  }
  getRotation() {
    return { x: 0, y: 0 };
  }
  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }
}

let nextEntityId = 1;
const dimensions = new Map();
world.getDimension = (id) => {
  if (!dimensions.has(id)) {
    const dimension = {
      id,
      entities: [],
      spawned: [],
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => dimension.spawned.push(stack.typeId),
      /** Supports the query options the scripts use: type, location + maxDistance, closest. */
      getEntities(options = {}) {
        let found = dimension.entities.filter((e) => e.isValid);
        if (options.type) found = found.filter((e) => e.typeId === options.type);
        if (options.location && options.maxDistance !== undefined) {
          const d = (e) => Math.hypot(e.location.x - options.location.x, e.location.y - options.location.y, e.location.z - options.location.z);
          found = found.filter((e) => d(e) <= options.maxDistance).sort((a, b) => d(a) - d(b));
        }
        if (options.closest !== undefined) found = found.slice(0, options.closest);
        return found;
      },
    };
    dimensions.set(id, dimension);
  }
  return dimensions.get(id);
};
world.getEntity = (id) => [...world.players, ...[...dimensions.values()].flatMap((d) => d.entities)].find((e) => e.id === id);

/**
 * A preggo mob: entity properties, dynamic properties, the components the scripts read, and the
 * events of DESIGN.md (only their effect on properties and tamed state is modelled).
 */
export class Mob {
  constructor(typeId = 'minepreggo:zombie_girl', { tamed = false, phase = -1 } = {}) {
    this.typeId = typeId;
    this.id = `mob-${nextEntityId++}`;
    this.isValid = true;
    this.isOnGround = true;
    this.isInWater = false;
    this.nameTag = '';
    this.location = { x: 0, y: 64, z: 0 };
    this.properties = new Map([['minepreggo:phase', phase], ['minepreggo:pose', 'none'], ['minepreggo:kick', 0], ['minepreggo:growth', 0], ['minepreggo:savage', false]]);
    this.dynamic = new Map();
    this.events = [];
    this.effects = new Map();
    this.dropped = [];
    this.tamed = tamed;
    const self = this;
    this.components = { 'minecraft:health': attribute(26, 26) };
    this.dimension = {
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => self.dropped.push(stack.typeId),
    };
  }
  getComponent(id) {
    if (id === 'minecraft:is_tamed') return this.tamed ? {} : undefined;
    return this.components[id];
  }
  getProperty(id) {
    return this.properties.get(id);
  }
  setProperty(id, value) {
    this.properties.set(id, value);
  }
  getDynamicProperty(key) {
    return this.dynamic.get(key);
  }
  setDynamicProperty(key, value) {
    if (value === undefined) this.dynamic.delete(key);
    else this.dynamic.set(key, value);
  }
  triggerEvent(name) {
    this.events.push(name);
    const phase = name.match(/^minepreggo:set_phase_(\d)$/);
    if (phase) this.properties.set('minepreggo:phase', Number(phase[1]));
    if (name === 'minepreggo:set_not_pregnant') this.properties.set('minepreggo:phase', -1);
    if (name === 'minepreggo:on_tame') this.tamed = true;
    if (name === 'minepreggo:become_savage') this.properties.set('minepreggo:savage', true);
    if (name === 'minepreggo:calm_down') this.properties.set('minepreggo:savage', false);
  }
  applyDamage(amount) {
    const health = this.components['minecraft:health'];
    health.currentValue = Math.max(0, health.currentValue - amount);
    return true;
  }
  addEffect(id, duration, options = {}) {
    this.effects.set(id, { typeId: id, duration, amplifier: options.amplifier ?? 0 });
  }
  getViewDirection() {
    return { x: 0, y: 0, z: 1 };
  }
}
