// Player movement reference, so bot locomotion is not a pile of magic numbers.
//
// Source figures (1 block = 1 metre, 20 ticks per second):
//   walk 4.317 b/s, sprint 5.612 b/s (x1.30), sneak 1.3 b/s,
//   swim 2.2 b/s, sprint-swim 3.918 b/s,
//   jump: Bedrock's documented jump_power default 0.42 blocks/tick upward,
//         which clears 1.249 blocks - that is the player jump.
//   Bedrock interaction distance: 5 blocks for blocks, 3 blocks for entities
//   (touch input uses 6 / 12 instead).
//
// Velocity and impulse are treated as blocks/tick: Microsoft documents
// jump_power and flying_speed per tick, and 0.42 reproduces the published
// 1.249 block jump height, so the same unit is used throughout.

const TICKS_PER_SECOND = 20;

function perTick(blocksPerSecond) {
    return blocksPerSecond / TICKS_PER_SECOND;
}

export const PLAYER = {
    WALK: perTick(4.317),          // 0.2159
    SPRINT: perTick(5.612),        // 0.2806
    SNEAK: perTick(1.3),           // 0.0650
    SWIM: perTick(2.2),            // 0.1100
    SPRINT_SWIM: perTick(3.918),   // 0.1959
    JUMP: 0.45,                    // matches an entity jump_power of 0.5, the
                                   // published player jump of 1.25 blocks
    JUMP_HEIGHT: 1.249,
    REACH_BLOCK: 5,
    REACH_ENTITY: 3,
    WALK_SPRINT_RATIO: 1.3,
    PANIC: perTick(7)              // fleeing an attack: just above the engine's
                                   // chase speed so the bot actually gets away
};

// The engine's own movement system drags scripted velocity back toward its own
// goal every tick, so a push sized exactly to the target speed settles below
// it. The compensation has to grow with how fast he is already going: applied
// at full strength from rest it kicked a bot from 0 to 10 blocks/s in one tick,
// which is the "he teleports" look.
const LAND_ENGINE_FIGHT = 2.4;

// A player does not accelerate forever: friction holds them near the target
// speed, so scripted movement tops up to a ceiling instead of stacking.
export function speedFor(mode, inWater) {
    if (inWater) {
        if (mode === "sprint") return PLAYER.SPRINT_SWIM;
        if (mode === "sneak") return PLAYER.SNEAK;
        return PLAYER.SWIM;
    }
    if (mode === "panic") return PLAYER.PANIC;
    if (mode === "sprint") return PLAYER.SPRINT;
    if (mode === "sneak") return PLAYER.SNEAK;
    return PLAYER.WALK;
}

// Rotation hysteresis. Every caller used to snap the head to a freshly computed
// angle, so a few centimetres of movement made the bot swing back and forth
// while standing still. A bot now only turns when the heading really changed.
const lastTurn = new Map();
export const ROT_DEADZONE = 8;   // degrees

// Records the heading itself: asking twice about the same angle must give the
// same answer, otherwise every caller has to remember what it applied.
export function shouldTurn(id, yaw) {
    const prev = lastTurn.get(id);
    let turn = true;

    if (prev !== undefined) {
        let diff = Math.abs(yaw - prev);
        if (diff > 180) diff = 360 - diff;
        turn = diff >= ROT_DEADZONE;
    }

    if (turn) lastTurn.set(id, yaw);
    return turn;
}

export function forgetTurn(id) {
    lastTurn.delete(id);
}

export function faceBlock(entity, target) {
    try {
        const bx = target.x + 0.5 - entity.location.x;
        const by = target.y + 0.5 - (entity.location.y + 1.62);
        const bz = target.z + 0.5 - entity.location.z;
        const yaw = Math.atan2(-bx, bz) * (180 / Math.PI);
        const hDist = Math.sqrt(bx * bx + bz * bz);
        const pitch = hDist === 0 ? 0 : -Math.atan2(by, hDist) * (180 / Math.PI);

        if (shouldTurn(entity.id, yaw)) {
            entity.setRotation({ x: pitch, y: yaw });
        }
        return { dx: bx, dz: bz, hDist: hDist };
    } catch (e) {
        return null;
    }
}

/**
 * A player jogs to cover ground and walks once they are on top of the thing
 * they are working on, so travel speed should follow distance.
 */
export function travelMode(entity, target, near = 1.2) {
    const dx = target.x - entity.location.x;
    const dz = target.z - entity.location.z;
    return dx * dx + dz * dz > near * near ? "sprint" : "walk";
}

// Water a bot should walk around rather than wade into. Bots cannot path: the
// only steering they have is this.
const WATER_BLOCKS = ["minecraft:water", "minecraft:flowing_water"];

// How far ahead of the bot the ground is dry, in steps of about one block
function waterAt(entity, ux, uz, dist) {
    const loc = entity.location;
    const feet = Math.floor(loc.y);
    try {
        const x = Math.floor(loc.x + ux * dist);
        const z = Math.floor(loc.z + uz * dist);
        for (const y of [feet, feet - 1]) {
            const block = entity.dimension.getBlock({ x: x, y: y, z: z });
            if (block && WATER_BLOCKS.includes(block.typeId)) return true;
        }
        return false;
    } catch (e) {
        return false;   // unloaded: assume dry
    }
}

// 0, 1, 2 or 3: how many steps he can take that way before hitting water again
function dryRoom(entity, ux, uz) {
    let room = 0;
    for (const dist of [1.2, 2.4, 3.6]) {
        if (waterAt(entity, ux, uz, dist)) break;
        room++;
    }
    return room;
}

// Which way a bot is going round a pond. Both perpendiculars are exactly as
// good as each other against the destination, so a tie has to be remembered
// instead of recomputed - otherwise he hugs the edge and never gets round.
const sideLatch = new Map();

/**
 * Drive an entity toward a point at a player's speed. Uses the velocity delta
 * rather than a fixed shove, so the bot holds that speed instead of building up.
 *
 * Walking into a pond means the water escape pulls him straight back out, and
 * the two fight until he never arrives, so a step ahead that is water becomes a
 * slide along the bank instead. Pass { enterWater: true } when the water is the
 * destination (putting out a fire, swimming to a shore).
 */
export function moveToward(entity, target, mode = "walk", options = {}) {
    if (!entity?.isValid) return false;

    const aim = faceBlock(entity, target);
    if (!aim) return false;

    const dx = aim.dx;
    const dz = aim.dz;
    const flat = Math.sqrt(dx * dx + dz * dz);
    // Already on top of it: pushing toward a point under his own feet is what
    // made a bot twitch in place instead of just working
    if (flat < 0.4) return false;

    let ux = dx / flat;
    let uz = dz / flat;

    if (!options.enterWater && !entity.isInWater && waterAt(entity, ux, uz, 1.2)) {
        const left = { x: -uz, z: ux };
        const right = { x: uz, z: -ux };
        const leftRoom = dryRoom(entity, left.x, left.z);
        const rightRoom = dryRoom(entity, right.x, right.z);

        if (leftRoom > 0 || rightRoom > 0) {
            let goLeft;
            if (leftRoom !== rightRoom) goLeft = leftRoom > rightRoom;
            else goLeft = sideLatch.get(entity.id) !== "right";

            sideLatch.set(entity.id, goLeft ? "left" : "right");
            const side = goLeft ? left : right;
            ux = side.x;
            uz = side.z;
        }
        // No dry ground either way (a narrow spit, or boxed in): carry on into
        // the water rather than freeze on the bank.
    }

    const wanted = speedFor(mode, entity.isInWater);
    const vx = ux * wanted;
    const vz = uz * wanted;

    let current;
    try {
        current = entity.getVelocity();
    } catch (e) {
        current = { x: 0, z: 0 };
    }

    try {
        const dxv = vx - current.x;
        const dzv = vz - current.z;

        if (entity.isInWater) {
            entity.applyImpulse({ x: dxv, y: 0, z: dzv });
            return true;
        }

        // Compensate engine drag only on the accelerating part of the push and
        // only in proportion to the speed he already carries. At rest a plain
        // player-speed push; near full speed a stronger one, so he settles on
        // the player's numbers instead of crawling - and never kicks, because
        // the first tick is never boosted.
        const curAlong = current.x * ux + current.z * uz;
        const along = dxv * ux + dzv * uz;

        let boostAlong = along;
        if (along > 0) {
            const mix = Math.max(0, Math.min(1, curAlong / wanted));
            boostAlong = along * (1 + (LAND_ENGINE_FIGHT - 1) * mix);
        }

        const perpX = dxv - ux * along;
        const perpZ = dzv - uz * along;

        entity.applyImpulse({ x: ux * boostAlong + perpX, y: 0, z: uz * boostAlong + perpZ });
    } catch (e) {
        return false;
    }
    return true;
}

// A player's jump, not a rocket: 0.42 blocks/tick from the ground.
export function jump(entity) {
    if (!entity?.isValid || !entity.isOnGround) return false;

    try {
        const v = entity.getVelocity();
        entity.applyImpulse({ x: 0, y: PLAYER.JUMP - Math.max(0, v.y), z: 0 });
    } catch (e) {
        return false;
    }
    return true;
}

// Keep knockback and lunges inside something a player could actually be dealt.
// A sprint hit plus airtime tops out near this in vanilla terms.
export const MAX_LAUNCH = perTick(9);

export function clampLaunch(vector) {
    const flat = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
    const cap = MAX_LAUNCH;
    if (flat <= cap && Math.abs(vector.y) <= cap) return vector;

    const scale = flat > cap ? cap / flat : 1;
    return {
        x: vector.x * scale,
        y: Math.max(-cap, Math.min(cap, vector.y)),
        z: vector.z * scale
    };
}
