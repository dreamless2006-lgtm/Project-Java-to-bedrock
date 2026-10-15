// Minimal stand-in for @minecraft/server so the pregnancy engine can run under `node --test`.
// Only what the engine touches is modelled; anything else throws loudly.

/** An event signal. `subscribe(fn, { entityTypes })` filters like the game does. */
const signal = () => {
  const listeners = [];
  const filters = new Map();
  return {
    listeners,
    filters,
    subscribe(fn, options) {
      listeners.push(fn);
      if (options?.entityTypes) filters.set(fn, options.entityTypes);
      return fn;
    },
    unsubscribe() {},
  };
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

/** Fires an event signal: every listener whose entity-type filter matches is called with `event`. */
export const emit = (sig, event) =>
  sig.listeners.forEach((fn) => {
    const types = sig.filters?.get(fn);
    const entity = event?.deadEntity ?? event?.hurtEntity ?? event?.entity ?? event?.target;
    if (types && entity && !types.includes(entity.typeId)) return;
    fn(event);
  });

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
/** Each behavior entity's minecraft:type_family (spawnEntity gives a mob its families). */
const ENTITY_FAMILIES = new Map([...jsonFiles(join(PACK, 'entities'))].map((j) => {
  const e = j['minecraft:entity'];
  return [e?.description?.identifier, e?.components?.['minecraft:type_family']?.family];
}).filter(([id, f]) => id && f));
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
/** World dynamic properties. */
const worldDynamic = new Map();
export const world = {
  players: [],
  getDynamicProperty: (key) => worldDynamic.get(key),
  setDynamicProperty: (key, value) => (value === undefined ? worldDynamic.delete(key) : worldDynamic.set(key, value)),
  getPlayers: () => world.players,
  getAbsoluteTime: () => absoluteTime,
  getTimeOfDay: () => absoluteTime % 24000,
  setAbsoluteTime: (t) => (absoluteTime = t),
  afterEvents: new Proxy({}, { get: (t, k) => (t[k] ??= signal()) }),
  beforeEvents: new Proxy({}, { get: (t, k) => (t[k] ??= signal()) }),
};

export const EntityDamageCause = { magic: 'magic', entityExplosion: 'entityExplosion', blockExplosion: 'blockExplosion', fall: 'fall', entityAttack: 'entityAttack' };
export const EquipmentSlot = { Mainhand: 'Mainhand', Offhand: 'Offhand', Chest: 'Chest' };
export const ItemLockMode = { none: 'none', inventory: 'inventory', slot: 'slot' };
export const GameMode = { Survival: 'Survival', Creative: 'Creative', Adventure: 'Adventure', Spectator: 'Spectator' };
export const InputButton = { Jump: 'Jump', Sneak: 'Sneak' };
export const InputPermissionCategory = { Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8, MoveForward: 9, MoveBackward: 10, MoveLeft: 11, MoveRight: 12 };
export const EasingType = { InOutSine: 'InOutSine', Linear: 'Linear', InOutQuad: 'InOutQuad' };
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
    this.entityProperties = new Map([['minepreggo:phase', -1], ['minepreggo:belly', 'none'], ['minepreggo:pose', 'none'], ['minepreggo:kick', 0], ['minepreggo:growth', 0], ['minepreggo:gender', 'unset'], ['minepreggo:skin', 'custom'], ['minepreggo:navel', false], ['minepreggo:baby', 'none']]);
    /** what the player picks on the next form (undefined = closes it) */
    this.formSelection = undefined;
    /** choices for a run of forms, used up one per form before formSelection */
    this.formSelections = [];
    /** every form shown to the player: { title, body, buttons } */
    this.forms = [];
    /** CommandPermissionLevel: operators can use the debug tools */
    this.commandPermissionLevel = 1;
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
      'minecraft:inventory': {
        container: {
          size: 36,
          addItem: (stack) => void self.inventory.push(stack.typeId),
          /** inventory slots hold one item each (their typeId) */
          getItem: (slot) => (self.inventory[slot] ? new ItemStack(self.inventory[slot], 1) : undefined),
          setItem: (slot, stack) => {
            self.inventory[slot] = stack ? stack.typeId : undefined;
          },
        },
      },
      'minecraft:equippable': {
        getEquipment: (slot) => (slot === EquipmentSlot.Mainhand ? self.held : slot === EquipmentSlot.Offhand ? self.offhand : undefined),
        setEquipment: (slot, stack) => (slot === EquipmentSlot.Mainhand ? ((self.held = stack), true) : slot === EquipmentSlot.Offhand ? ((self.offhand = stack), true) : true),
      },
    };
    /** @type {ItemStack | undefined} */
    this.offhand = undefined;
    this.isInWater = false;
    this.fireSeconds = 0;
    this.teleports = [];
    this.dimension = {
      id: 'minecraft:overworld',
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => self.dropped.push(stack.typeId),
      getEntities: (options) => world.getDimension('minecraft:overworld').getEntities(options),
      getPlayers: (options) => world.getDimension('minecraft:overworld').getPlayers(options),
      getBlock: (location) => world.getDimension('minecraft:overworld').getBlock(location),
      createExplosion: (location, radius, options) => world.getDimension('minecraft:overworld').createExplosion(location, radius, options),
    };
    this.onScreenDisplay = { setActionBar: (m) => self.messages.push(m) };
    /** playAnimation calls: { name, options } */
    this.animations = [];
    /** InputPermissionCategory -> enabled, as set through inputPermissions */
    this.permissions = new Map();
    this.inputPermissions = { setPermissionCategory: (category, enabled) => void self.permissions.set(category, enabled) };
    /** camera.setCamera / clear calls: { preset, options } or 'clear' */
    this.cameras = [];
    this.camera = { setCamera: (preset, options) => void self.cameras.push({ preset, options }), clear: () => void self.cameras.push('clear') };
  }
  playAnimation(name, options = {}) {
    this.animations.push({ name, options });
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
  addTag(tag) {
    (this.tags ??= new Set()).add(tag);
    return true;
  }
  removeTag(tag) {
    return (this.tags ??= new Set()).delete(tag);
  }
  hasTag(tag) {
    return (this.tags ??= new Set()).has(tag);
  }
  getTags() {
    return [...(this.tags ??= new Set())];
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
  setOnFire(seconds) {
    this.fireSeconds = seconds;
    return true;
  }
  teleport(location) {
    this.teleports.push(location);
    this.location = { ...location };
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
      /** Spawns a Mob of the type (its families from the behavior pack's JSON). */
      spawnEntity(typeId, location) {
        const mob = new Mob(typeId, { families: ENTITY_FAMILIES.get(typeId) ?? ['mob'] });
        mob.location = { ...location };
        mob.dimension = { ...mob.dimension, id };
        dimension.entities.push(mob);
        return mob;
      },
      explosions: [],
      createExplosion: (location, radius, options) => dimension.explosions.push({ location, radius, options }),
      /** A flat world: solid ground at y < 64, air above, full skylight. */
      getBlock: ({ x, y, z }) => ({ x, y, z, isAir: y >= 64, isLiquid: false, typeId: y >= 64 ? 'minecraft:air' : 'minecraft:stone', getSkyLightLevel: () => 15, getLightLevel: () => 15 }),
      /** Supports the query options the scripts use: type, families, location + maxDistance, closest. */
      getEntities(options = {}) {
        let found = dimension.entities.filter((e) => e.isValid);
        if (options.type) found = found.filter((e) => e.typeId === options.type);
        if (options.families) found = found.filter((e) => options.families.some((f) => (e.families ?? []).includes(f)));
        if (options.location && options.maxDistance !== undefined) {
          const d = (e) => Math.hypot(e.location.x - options.location.x, e.location.y - options.location.y, e.location.z - options.location.z);
          found = found.filter((e) => d(e) <= options.maxDistance).sort((a, b) => d(a) - d(b));
        }
        if (options.closest !== undefined) found = found.slice(0, options.closest);
        return found;
      },
      getPlayers(options = {}) {
        let found = world.players.filter((p) => p.isValid);
        if (options.location && options.maxDistance !== undefined) {
          const d = (e) => Math.hypot(e.location.x - options.location.x, e.location.y - options.location.y, e.location.z - options.location.z);
          found = found.filter((e) => d(e) <= options.maxDistance).sort((a, b) => d(a) - d(b));
        }
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
  constructor(typeId = 'minepreggo:zombie_girl', { tamed = false, phase = -1, variant = undefined, families = ['minepreggo_preggo_mob', 'mob'] } = {}) {
    /** minecraft:variant of the phase component groups (phase + 1); a spawn event's property may or may not be visible */
    this.variant = variant ?? phase + 1;
    this.typeId = typeId;
    /** minecraft:type_family, which getEntities({ families }) matches */
    this.families = families;
    this.teleports = [];
    this.animations = [];
    this.id = `mob-${nextEntityId++}`;
    this.isValid = true;
    this.isOnGround = true;
    this.isInWater = false;
    this.nameTag = '';
    this.location = { x: 0, y: 64, z: 0 };
    this.properties = new Map([['minepreggo:phase', phase], ['minepreggo:belly', phase < 0 ? 'none' : `p${phase}`], ['minepreggo:pose', 'none'], ['minepreggo:kick', 0], ['minepreggo:growth', 0], ['minepreggo:savage', false]]);
    this.dynamic = new Map();
    this.events = [];
    this.effects = new Map();
    this.dropped = [];
    this.tamed = tamed;
    const self = this;
    this.components = { 'minecraft:health': attribute(26, 26) };
    this.dimension = {
      id: 'minecraft:overworld',
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => self.dropped.push(stack.typeId),
      getEntities: (options) => world.getDimension('minecraft:overworld').getEntities(options),
      getPlayers: (options) => world.getDimension('minecraft:overworld').getPlayers(options),
      getBlock: (location) => world.getDimension('minecraft:overworld').getBlock(location),
    };
  }
  teleport(location, options = {}) {
    this.teleports.push({ location, options });
    this.location = { ...location };
  }
  getRotation() {
    return { x: 0, y: 0 };
  }
  playAnimation(name, options = {}) {
    this.animations.push({ name, options });
  }
  getComponent(id) {
    if (id === 'minecraft:is_tamed') return this.tamed ? {} : undefined;
    if (id === 'minecraft:variant') return { value: this.variant };
    if (id === 'minecraft:tameable') {
      const self = this;
      return {
        get isTamed() {
          return self.tamed;
        },
        get tamedToPlayerId() {
          return self.ownerId;
        },
        tame(player) {
          self.tamed = true;
          self.ownerId = player.id;
          return true;
        },
      };
    }
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
    // Events change the component groups (the variant); the property itself is written by the script.
    const phase = name.match(/^minepreggo:set_phase_(\d)$/);
    if (phase) this.variant = Number(phase[1]) + 1;
    if (name === 'minepreggo:set_not_pregnant') this.variant = 0;
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
  addTag(tag) {
    (this.tags ??= new Set()).add(tag);
    return true;
  }
  removeTag(tag) {
    return (this.tags ??= new Set()).delete(tag);
  }
  hasTag(tag) {
    return (this.tags ??= new Set()).has(tag);
  }
  getTags() {
    return [...(this.tags ??= new Set())];
  }
  remove() {
    this.isValid = false;
  }
}
