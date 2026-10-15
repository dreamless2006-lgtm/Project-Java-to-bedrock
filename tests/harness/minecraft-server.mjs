// Headless mock of the parts of @minecraft/server this pack uses. Not the real engine:
// a flat world (grass at y=63, stone below), entities as plain objects, commands recorded.
export const TicksPerSecond = 20;
export const EntityComponentTypes = { Health: "minecraft:health", Inventory: "minecraft:inventory", Equippable: "minecraft:equippable", OnFire: "minecraft:onfire", Breathable: "minecraft:breathable", Item: "minecraft:item", Tameable: "minecraft:tameable", TypeFamily: "minecraft:type_family", Movement: "minecraft:movement", Rideable: "minecraft:rideable", Projectile: "minecraft:projectile", Variant: "minecraft:variant" };
export const EquipmentSlot = { Mainhand: "Mainhand", Offhand: "Offhand", Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Body: "Body", Saddle: "Saddle" };
export const EntityDamageCause = { entityAttack: "entityAttack", fall: "fall", lava: "lava", fire: "fire", drowning: "drowning", projectile: "projectile", explosion: "entityExplosion", magic: "magic", none: "none", void: "void", starve: "starve" };
export const GameMode = { Survival: "Survival", Creative: "Creative", Adventure: "Adventure", Spectator: "Spectator" };
export const InputPermissionCategory = { Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6 };
export const WeatherType = { Clear: "Clear", Rain: "Rain", Thunder: "Thunder" };
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const CustomCommandParamType = { Boolean: "Boolean", Integer: "Integer", Float: "Float", String: "String", EntitySelector: "EntitySelector", PlayerSelector: "PlayerSelector", Location: "Location", BlockType: "BlockType", ItemType: "ItemType", Enum: "Enum", EntityType: "EntityType" };
export const CustomCommandStatus = { Success: 0, Failure: 1 };
export class EffectType { constructor(id) { this.id = id; } }
export class BlockPermutation {
    constructor(type, states = {}) { this.type = { id: type }; this.states = states; }
    static resolve(type, states) { return new BlockPermutation(type, states || {}); }
    getState(k) { return this.states[k]; }
    withState(k, v) { return new BlockPermutation(this.type.id, { ...this.states, [k]: v }); }
    getItemStack(n = 1) { return new ItemStack(this.type.id, n); }
}

// ---------------------------------------------------------------- items ---
const FOOD = new Set(["minecraft:bread", "minecraft:apple", "minecraft:cooked_beef", "minecraft:cooked_porkchop", "minecraft:carrot", "minecraft:baked_potato", "minecraft:sweet_berries", "mymod:jerky"]);
export class ItemStack {
    constructor(typeId, amount = 1) { if (typeof typeId !== "string") throw new TypeError("bad item id"); this.typeId = typeId; this.amount = amount; this.nameTag = undefined; this._lore = []; }
    getComponent(id) { if (id === "minecraft:food" && FOOD.has(this.typeId)) return { nutrition: 4 }; return undefined; }
    clone() { const s = new ItemStack(this.typeId, this.amount); s.nameTag = this.nameTag; return s; }
    getLore() { return this._lore; }
    setLore(l) { this._lore = l || []; }
    isStackableWith(o) { return o.typeId === this.typeId; }
}
export class Container {
    constructor(size) { this.size = size; this.slots = new Array(size).fill(undefined); }
    get emptySlotsCount() { return this.slots.filter(s => !s).length; }
    getItem(i) { return this.slots[i]; }
    setItem(i, s) { this.slots[i] = s || undefined; }
    addItem(stack) {
        let left = stack.amount;
        for (let i = 0; i < this.size && left > 0; i++) { const s = this.slots[i]; if (s && s.typeId === stack.typeId && s.amount < 64) { const take = Math.min(64 - s.amount, left); s.amount += take; left -= take; } }
        for (let i = 0; i < this.size && left > 0; i++) { if (!this.slots[i]) { const take = Math.min(64, left); this.slots[i] = new ItemStack(stack.typeId, take); left -= take; } }
        return left > 0 ? new ItemStack(stack.typeId, left) : undefined;
    }
    transferItem(i, to) { const s = this.slots[i]; if (!s) return undefined; const r = to.addItem(s); this.slots[i] = r; return r; }
}
export class EntityInventoryComponent { constructor(size) { this.container = new Container(size); this.inventorySize = size; } }
export class EntityHealthComponent { constructor(max) { this.currentValue = max; this.effectiveMax = max; this.defaultValue = max; this.effectiveMin = 0; } setCurrentValue(v) { this.currentValue = Math.max(0, Math.min(this.effectiveMax, v)); return true; } resetToMaxValue() { this.currentValue = this.effectiveMax; } }
export class EntityEquippableComponent { constructor() { this.slots = {}; } getEquipment(slot) { return this.slots[slot]; } setEquipment(slot, s) { this.slots[slot] = s; return true; } }

// ---------------------------------------------------------------- events ---
export class Signal { constructor(name) { this.name = name; this.subs = new Set(); } subscribe(cb, opts) { this.subs.add(cb); return cb; } unsubscribe(cb) { this.subs.delete(cb); } emit(ev) { for (const cb of [...this.subs]) { try { cb(ev); } catch (e) { log.errors.push(`${this.name}: ${e?.stack || e}`); } } } }
function signalBag(prefix) { return new Proxy({}, { get(t, k) { if (typeof k !== "string") return undefined; if (!t[k]) t[k] = new Signal(prefix + "." + k); return t[k]; } }); }
export const log = { commands: [], messages: [], warnings: [], errors: [], chat: [] };
const realWarn = console.warn;
console.warn = (...a) => { log.warnings.push(a.map(x => (x && x.stack) || String(x)).join(" ")); };

// ---------------------------------------------------------------- system ---
let tick = 0;
let nextRunId = 1;
const timers = new Map();   // id -> {cb, at, every}
export const system = {
    get currentTick() { return tick; },
    afterEvents: { scriptEventReceive: new Signal("system.scriptEventReceive") },
    beforeEvents: { startup: new Signal("system.startup"), watchdogTerminate: new Signal("system.watchdogTerminate") },
    run(cb) { const id = nextRunId++; timers.set(id, { cb, at: tick + 1, every: 0 }); return id; },
    runTimeout(cb, d = 1) { const id = nextRunId++; timers.set(id, { cb, at: tick + Math.max(1, d), every: 0 }); return id; },
    runInterval(cb, d = 1) { const id = nextRunId++; timers.set(id, { cb, at: tick + Math.max(1, d), every: Math.max(1, d) }); return id; },
    clearRun(id) { timers.delete(id); },
    runJob(gen) { const id = nextRunId++; timers.set(id, { cb: () => { const r = gen.next(); if (r.done) timers.delete(id); }, at: tick + 1, every: 1 }); return id; },
    clearJob(id) { timers.delete(id); },
    waitTicks(n) { return new Promise(r => this.runTimeout(r, n)); },
    sendScriptEvent(id, message) { this.afterEvents.scriptEventReceive.emit({ id, message, sourceType: "Server" }); },
};
const pendingAfter = [];   // after-events the engine fires at the end of the tick
export function queueAfter(fn) { pendingAfter.push(fn); }
function flushAfter() { while (pendingAfter.length) { const fn = pendingAfter.shift(); try { fn(); } catch (e) { log.errors.push(`afterEvent: ${e?.stack || e}`); } } }
function physics() {
    for (const e of world._all.values()) {
        if (!e.isValid || !e.velocity) continue;
        const v = e.velocity;
        if (Math.abs(v.x) < 1e-4 && Math.abs(v.z) < 1e-4) { e.velocity = { x: 0, y: 0, z: 0 }; continue; }
        e.location = { x: e.location.x + v.x, y: e.location.y, z: e.location.z + v.z };
        e.velocity = { x: v.x * 0.6, y: 0, z: v.z * 0.6 };
    }
}
export function advanceTicks(n) {
    for (let i = 0; i < n; i++) {
        tick++;
        flushAfter();
        for (const [id, t] of [...timers]) {
            if (t.at !== tick) continue;
            if (t.every) t.at = tick + t.every; else timers.delete(id);
            try { t.cb(); } catch (e) { log.errors.push(`timer: ${e?.stack || e}`); }
        }
        physics();
        flushAfter();
    }
}
export async function advanceTicksAsync(n) { for (let i = 0; i < n; i++) { advanceTicks(1); await Promise.resolve(); await new Promise(r => setImmediate(r)); } }

// ---------------------------------------------------------------- world ---
const dynWorld = new Map();
function dynProps(target) {
    target._dyn = new Map();
    target.getDynamicProperty = k => target._dyn.get(k);
    target.setDynamicProperty = (k, v) => { if (v === undefined || v === null) target._dyn.delete(k); else { if (typeof v === "string" && v.length > 32767) throw new Error("dynamic property too long"); target._dyn.set(k, v); } };
    target.getDynamicPropertyIds = () => [...target._dyn.keys()];
    target.getDynamicPropertyTotalByteCount = () => [...target._dyn.values()].reduce((a, v) => a + String(v).length, 0);
    target.clearDynamicProperties = () => target._dyn.clear();
}
export class Block {
    constructor(dim, x, y, z, typeId) { this.dimension = dim; this.x = x; this.y = y; this.z = z; this.typeId = typeId; this.permutation = new BlockPermutation(typeId); this.location = { x, y, z }; this.isValid = true; }
    get isAir() { return this.typeId === "minecraft:air"; }
    get isLiquid() { return /water|lava/.test(this.typeId); }
    setType(id) { this.dimension._set(this.x, this.y, this.z, typeof id === "string" ? id : id.id); }
    setPermutation(p) { this.dimension._set(this.x, this.y, this.z, p.type.id, p.states); }
    getComponent(id) { if (id === "minecraft:inventory" && /chest|barrel/.test(this.typeId)) { if (!this._inv) this._inv = { container: new Container(27) }; return this._inv; } return undefined; }
    getItemStack(n = 1) { return new ItemStack(this.typeId, n); }
    hasTag() { return false; }
    getTags() { return []; }
    above(n = 1) { return this.dimension.getBlock({ x: this.x, y: this.y + n, z: this.z }); }
    below(n = 1) { return this.dimension.getBlock({ x: this.x, y: this.y - n, z: this.z }); }
}
export class Dimension {
    constructor(id) { this.id = id; this.blocks = new Map(); this.entities = new Map(); this.heightRange = { min: -64, max: 320 }; }
    _key(x, y, z) { return `${x},${y},${z}`; }
    _set(x, y, z, id, states) { const b = new Block(this, x, y, z, id); if (states) b.permutation = new BlockPermutation(id, states); this.blocks.set(this._key(x, y, z), b); }
    getBlock(loc) {
        const x = Math.floor(loc.x), y = Math.floor(loc.y), z = Math.floor(loc.z);
        if (y < -64 || y > 319) return undefined;
        const b = this.blocks.get(this._key(x, y, z));
        if (b) return b;
        const id = y < 60 ? "minecraft:stone" : y < 63 ? "minecraft:dirt" : y === 63 ? "minecraft:grass_block" : "minecraft:air";
        return new Block(this, x, y, z, id);
    }
    getTopmostBlock(xz) { for (let y = 319; y >= -64; y--) { const b = this.getBlock({ x: xz.x, y, z: xz.z }); if (!b.isAir) return b; } return undefined; }
    getBiome() { return { id: "minecraft:plains", getTags: () => [], hasTags: () => false }; }
    isChunkLoaded() { return true; }
    getEntities(opts = {}) {
        let out = [...this.entities.values()].filter(e => e.isValid);
        if (opts.type) out = out.filter(e => e.typeId === opts.type);
        if (opts.excludeTypes) out = out.filter(e => !opts.excludeTypes.includes(e.typeId));
        if (opts.families) out = out.filter(e => opts.families.some(f => e.families.has(f)));
        if (opts.excludeFamilies) out = out.filter(e => !opts.excludeFamilies.some(f => e.families.has(f)));
        if (opts.tags) out = out.filter(e => opts.tags.every(t => e.hasTag(t)));
        if (opts.location && opts.maxDistance !== undefined) out = out.filter(e => dist(e.location, opts.location) <= opts.maxDistance);
        if (opts.location && opts.closest) out = out.sort((a, b) => dist(a.location, opts.location) - dist(b.location, opts.location)).slice(0, opts.closest);
        return out;
    }
    getPlayers(opts = {}) { return this.getEntities({ ...opts, type: "minecraft:player" }); }
    spawnEntity(typeId, loc) { const e = new Entity(typeId, this, { x: loc.x, y: loc.y, z: loc.z }); this.entities.set(e.id, e); world._all.set(e.id, e); queueAfter(() => { if (e.isValid) world.afterEvents.entitySpawn.emit({ entity: e, cause: "Spawned" }); }); return e; }
    spawnItem(stack, loc) { const e = this.spawnEntity("minecraft:item", loc); e._item = stack; return e; }
    runCommand(cmd) { log.commands.push(cmd); if (/^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)/.test(cmd)) { const m = cmd.match(/^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)/); this._set(+m[1], +m[2], +m[3], m[4].includes(":") ? m[4].replace(/\[.*$/, "") : "minecraft:" + m[4].replace(/\[.*$/, "")); } return { successCount: 1 }; }
    playSound() {}
    spawnParticle() {}
    setWeather() {}
    getLightLevel() { return 15; }
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
let nextEntityId = 1000;
export class Entity {
    constructor(typeId, dimension, location) {
        this.id = String(nextEntityId++); this.typeId = typeId; this.dimension = dimension; this.location = location; this.isValid = true;
        this.nameTag = ""; this.tags = new Set(); this.families = new Set(typeId === "rg:bot" ? ["player", "mob", "bot"] : typeId.startsWith("mymod:") && /goblin|wyvern/.test(typeId) ? ["mymod", "hostile", "monster", "mob"] : /zombie|skeleton|creeper|spider/.test(typeId) ? ["monster", "mob"] : /cow|pig|sheep|chicken|wolf/.test(typeId) ? ["animal", "mob"] : []);
        this.rotation = { x: 0, y: 0 }; this.velocity = { x: 0, y: 0, z: 0 }; this.isOnGround = true; this.isInWater = false; this.isFalling = false; this.isSneaking = false; this.isSleeping = false; this.isClimbing = false; this.isSwimming = false; this.isSprinting = false;
        this.components = { "minecraft:health": new EntityHealthComponent(20), "minecraft:type_family": { hasTypeFamily: f => this.families.has(f), getTypeFamilies: () => [...this.families] } };
        if (typeId === "rg:bot" || typeId === "minecraft:player") { this.components["minecraft:inventory"] = new EntityInventoryComponent(typeId === "rg:bot" ? 24 : 36); this.components["minecraft:equippable"] = new EntityEquippableComponent(); }
        if (/wolf|cat|parrot/.test(typeId)) this.components["minecraft:tameable"] = { isTamed: false, tame: () => true };
        dynProps(this);
        this.events = []; this.effects = [];
    }
    getComponent(id) { if (id === "minecraft:item") return this._item ? { itemStack: this._item } : undefined; return this.components[id]; }
    getComponents() { return Object.values(this.components); }
    hasComponent(id) { return !!this.getComponent(id); }
    addTag(t) { this.tags.add(t); return true; } removeTag(t) { return this.tags.delete(t); } hasTag(t) { return this.tags.has(t); } getTags() { return [...this.tags]; }
    triggerEvent(name) { this.events.push(name); }
    runCommand(cmd) { log.commands.push(`[${this.nameTag || this.typeId}] ${cmd}`); return { successCount: 1 }; }
    teleport(loc, opts = {}) { this.location = { x: loc.x, y: loc.y, z: loc.z }; if (opts.rotation) this.rotation = { x: opts.rotation.x, y: opts.rotation.y }; this.teleports = (this.teleports || 0) + 1; if (opts.dimension && opts.dimension !== this.dimension) { this.dimension.entities.delete(this.id); this.dimension = opts.dimension; this.dimension.entities.set(this.id, this); } }
    tryTeleport(loc, opts) { this.teleport(loc, opts); return true; }
    applyImpulse(v) { this.velocity = { x: this.velocity.x + v.x, y: 0, z: this.velocity.z + v.z }; }
    applyKnockback() {} clearVelocity() { this.velocity = { x: 0, y: 0, z: 0 }; } getVelocity() { return this.velocity; }
    setRotation(r) { this.rotation = { x: r.x, y: r.y }; } getRotation() { return this.rotation; }
    getViewDirection() { const yaw = this.rotation.y * Math.PI / 180; return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }; }
    getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z }; }
    lookAt(loc) { this.rotation = { x: 0, y: Math.atan2(-(loc.x - this.location.x), loc.z - this.location.z) * 180 / Math.PI }; }
    playAnimation(name) { this.lastAnimation = name; }
    addEffect(type, duration, opts) { this.effects.push({ type, duration, opts }); return {}; } getEffect() { return undefined; } removeEffect() {} getEffects() { return []; }
    applyDamage(n, opts) { const h = this.components["minecraft:health"]; h.setCurrentValue(h.currentValue - n); world.afterEvents.entityHurt.emit({ hurtEntity: this, damage: n, damageSource: { cause: opts?.cause || "none", damagingEntity: opts?.damagingEntity } }); if (h.currentValue <= 0) this.kill(opts); return true; }
    kill(opts) { if (!this.isValid) return; world.afterEvents.entityDie.emit({ deadEntity: this, damageSource: { cause: opts?.cause || "none", damagingEntity: opts?.damagingEntity } }); this.remove(); return true; }
    remove() { this.isValid = false; this.dimension.entities.delete(this.id); world._all.delete(this.id); world.afterEvents.entityRemove.emit({ removedEntityId: this.id, typeId: this.typeId }); }
    setOnFire() { return true; } extinguishFire() { return true; }
    matches() { return true; }
    getBlockFromViewDirection() { return undefined; }
    getProperty() { return undefined; } setProperty() {}
}
export class Player extends Entity {
    constructor(name, dimension, location) { super("minecraft:player", dimension, location); this.name = name; this.nameTag = name; this.commandPermissionLevel = 1; this.playerPermissionLevel = 1; this.messages = []; this.families = new Set(["player", "mob"]); this.selectedSlotIndex = 0; this.components["minecraft:player.hunger"] = { currentValue: 20, effectiveMax: 20, setCurrentValue(v) { this.currentValue = Math.max(0, Math.min(20, v)); return true; } }; this.components["minecraft:player.saturation"] = { currentValue: 5, effectiveMax: 20, setCurrentValue(v) { this.currentValue = Math.max(0, Math.min(20, v)); return true; } }; }
    sendMessage(m) { const text = typeof m === "string" ? m : JSON.stringify(m); this.messages.push(text); log.messages.push(`[to ${this.name}] ${text}`); }
    getGameMode() { return this._gm || "Survival"; }
    setGameMode(m) { this._gm = m; this.gameModeChanges = (this.gameModeChanges || 0) + 1; }
    // the camera and input-permission API: calls are recorded so a test can read them back
    get camera() {
        if (!this._camera) {
            const p = this;
            this._camera = { calls: [], cleared: 0, broken: false, isValid: true, setCamera(preset, opts) { if (this.broken) throw new Error("camera not available"); this.calls.push({ preset, ...opts }); }, clear() { this.cleared++; this.calls.push({ cleared: true }); } };
            void p;
        }
        return this._camera;
    }
    get inputPermissions() {
        if (!this._perm) { const on = new Map(); this._perm = { set: on, isPermissionCategoryEnabled: c => on.get(c) !== false, setPermissionCategory: (c, v) => { on.set(c, v); } }; }
        return this._perm;
    }
    // a player's death does not remove the entity: it waits on the death screen and respawns
    kill(opts) { if (!this.isValid || this.dead) return false; this.dead = true; world.afterEvents.entityDie.emit({ deadEntity: this, damageSource: { cause: opts?.cause || "none", damagingEntity: opts?.damagingEntity } }); return true; }
    respawn(loc) { this.dead = false; this.components["minecraft:health"].resetToMaxValue(); if (loc) this.location = { x: loc.x, y: loc.y, z: loc.z }; world.afterEvents.playerSpawn.emit({ player: this, initialSpawn: false }); }
    playSound() {}
    get onScreenDisplay() { const p = this; return { setActionBar(t) { p.actionBar = t; }, setTitle() {}, updateSubtitle() {} }; }
}
export class ScoreboardObjective { constructor(id) { this.id = id; this.displayName = id; this.scores = new Map(); } getScore(p) { return this.scores.get(typeof p === "string" ? p : p.id); } setScore(p, v) { this.scores.set(typeof p === "string" ? p : p.id, v); } addScore(p, v) { this.setScore(p, (this.getScore(p) || 0) + v); return this.getScore(p); } }
const objectives = new Map();
const dims = { "minecraft:overworld": new Dimension("minecraft:overworld"), "minecraft:nether": new Dimension("minecraft:nether"), "minecraft:the_end": new Dimension("minecraft:the_end") };
export const world = {
    _all: new Map(),
    afterEvents: signalBag("world.after"),
    beforeEvents: signalBag("world.before"),
    getDimension(id) { const key = id.includes(":") ? id : "minecraft:" + id; const d = dims[key]; if (!d) throw new Error("unknown dimension " + id); return d; },
    getAllPlayers() { return [...this._all.values()].filter(e => e.typeId === "minecraft:player" && e.isValid); },
    getPlayers(opts) { return this.getAllPlayers(); },
    getEntity(id) { const e = this._all.get(id); return e && e.isValid ? e : undefined; },
    getTimeOfDay() { return this._time ?? 6000; },
    setTimeOfDay(t) { this._time = t; },
    getAbsoluteTime() { return tick; },
    getDay() { return 0; },
    getMoonPhase() { return 0; },
    sendMessage(m) { const text = typeof m === "string" ? m : JSON.stringify(m); log.chat.push(text); },
    scoreboard: { getObjective: id => objectives.get(id), addObjective: id => { const o = new ScoreboardObjective(id); objectives.set(id, o); return o; }, getObjectives: () => [...objectives.values()] },
    gameRules: { mobGriefing: true, keepInventory: false },
    tickingAreaManager: { areas: new Map(), chunkCount: 0, maxChunkCount: 100, hasTickingArea(n) { return this.areas.has(n); }, removeTickingArea(n) { this.areas.delete(n); }, hasCapacity() { return true; }, createTickingArea(n, o) { this.areas.set(n, o); return Promise.resolve(); }, getAllTickingAreas() { return [...this.areas.values()]; }, removeAllTickingAreas() { this.areas.clear(); } },
    structureManager: { place() {}, get() { return undefined; } },
    getDefaultSpawnLocation() { return { x: 0, y: 64, z: 0 }; },
};
dynProps(world);
export const BlockTypes = { getAll: () => ["minecraft:stone", "minecraft:dirt", "minecraft:oak_log", "mymod:glow_stone", "mymod:crystal_block", "other:magic_block"].map(id => ({ id })), get: id => ({ id }) };
export const ItemTypes = { getAll: () => ["minecraft:stick", "minecraft:bread", "mymod:flame_sword", "mymod:jerky", "other:wand"].map(id => ({ id })), get: id => ({ id }) };
export const EntityTypes = { getAll: () => ["minecraft:zombie", "minecraft:cow", "rg:bot", "mymod:goblin", "mymod:wyvern", "other:dragon"].map(id => ({ id })), get: id => ({ id }) };
export const BiomeTypes = { getAll: () => [] };

// helpers for tests
export function spawnPlayer(name, loc = { x: 0, y: 64, z: 0 }) { const p = new Player(name, dims["minecraft:overworld"], loc); dims["minecraft:overworld"].entities.set(p.id, p); world._all.set(p.id, p); world.afterEvents.playerSpawn.emit({ player: p, initialSpawn: true }); return p; }
export function worldLoad() { world.afterEvents.worldLoad.emit({}); }
export { dist as _dist };
