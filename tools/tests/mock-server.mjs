// Minimal stand-in for @minecraft/server so the pregnancy engine can run under `node --test`.
// Only what the engine touches is modelled; anything else throws loudly.

const signal = () => {
  const listeners = [];
  return { listeners, subscribe: (fn) => (listeners.push(fn), fn), unsubscribe() {} };
};

export const system = {
  currentTick: 0,
  run: (fn) => fn(),
  runTimeout: () => 0,
  runInterval: () => 0,
  beforeEvents: { startup: signal() },
  afterEvents: { scriptEventReceive: signal() },
};

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

export class ItemStack {
  constructor(typeId, amount = 1) {
    this.typeId = typeId;
    this.amount = amount;
  }
  getComponent() {
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
    this.isValid = true;
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
      'minecraft:equippable': { getEquipment: () => undefined, setEquipment: () => true },
    };
    this.dimension = {
      playSound: () => {},
      spawnParticle: () => {},
      spawnItem: (stack) => self.dropped.push(stack.typeId),
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
