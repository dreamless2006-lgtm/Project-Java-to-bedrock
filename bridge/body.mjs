// The bridge account's body, as the Realm sees it.
//
// Bedrock movement is server-authoritative: a player only moves when its own client sends
// player_auth_input every tick (50 ms) with the inputs it holds and where it predicts it is. The
// server simulates the same inputs, compares, and corrects the client when they diverge. A client
// that never sends input is never simulated: it stands frozen at spawn however a script moves it.
//
// This class keeps the body's position from the server's own packets (start_game, move_player,
// correct_player_move_prediction, respawn, change_dimension), walks it towards the footing points
// the addon sends using the vanilla movement model (acceleration, friction, gravity, step-up,
// jump), and builds one player_auth_input per tick. Pure: no sockets, no timers.
//
// Positions inside this class are FEET positions. On the wire, player_auth_input, move_player,
// correct_player_move_prediction and respawn carry the EYE position (feet + 1.62); start_game and
// change_dimension carry feet (as the BDS-facing implementations read them).

export const EYE_HEIGHT = 1.62;
// Vanilla player physics per tick (what the server simulates from the same inputs).
export const PHYS = { gravity: 0.08, gravityMul: 0.98, airFriction: 0.91, blockFriction: 0.6, groundSpeed: 0.1, airSpeed: 0.02, sprintMul: 1.3, sprintAirSpeed: 0.026, impulse: 0.98, jump: 0.42, sprintJumpBoost: 0.2, jumpDelay: 10, stepHeight: 0.5625 };
// Steady-state speeds the model converges to (blocks per tick), for reference.
export const SPEED = { walk: 0.2158, sprint: 0.2806, sneak: 0.0648 };
export const ARRIVE = 0.3;                 // the key is released this close to the target; friction stops the body
export const GROUND_DELTA_Y = -(PHYS.gravity * PHYS.gravityMul);   // what a standing client reports every tick
const DEG = 180 / Math.PI;

// InputData ordinals (protocol 1.26.51); flags are sent as a list in ascending order like a real client.
export const INPUT_ORDINAL = { ascend: 0, descend: 1, north_jump: 2, jump_down: 3, sprint_down: 4, change_height: 5, jumping: 6, auto_jumping_in_water: 7, sneaking: 8, sneak_down: 9, up: 10, down: 11, left: 12, right: 13, up_left: 14, up_right: 15, want_up: 16, want_down: 17, want_down_slow: 18, want_up_slow: 19, sprinting: 20, ascend_block: 21, descend_block: 22, sneak_toggle_down: 23, persist_sneak: 24, start_sprinting: 25, stop_sprinting: 26, start_sneaking: 27, stop_sneaking: 28, start_swimming: 29, stop_swimming: 30, start_jumping: 31, start_gliding: 32, stop_gliding: 33, item_interact: 34, block_action: 35, item_stack_request: 36, handled_teleport: 37, emoting: 38, missed_swing: 39, start_crawling: 40, stop_crawling: 41, start_flying: 42, stop_flying: 43, received_server_data: 44, client_predicted_vehicle: 45, paddling_left: 46, paddling_right: 47, block_breaking_delay_enabled: 48, horizontal_collision: 49, vertical_collision: 50, down_left: 51, down_right: 52, start_using_item: 53, camera_relative_movement_enabled: 54, rot_controlled_by_move_direction: 55, start_spin_attack: 56, stop_spin_attack: 57, hotbar_only_touch: 58, jump_released_raw: 59, jump_pressed_raw: 60, jump_current_raw: 61, sneak_released_raw: 62, sneak_pressed_raw: 63, sneak_current_raw: 64, internal_update: 65 };
export const FLAG_ORDER = Object.keys(INPUT_ORDINAL).sort((a, b) => INPUT_ORDINAL[a] - INPUT_ORDINAL[b]);
const sortFlags = (set) => [...set].sort((a, b) => (INPUT_ORDINAL[a] ?? 999) - (INPUT_ORDINAL[b] ?? 999));

export class Body {
    constructor(opts = {}) {
        this.eye = typeof opts.eyeHeight === "number" ? opts.eyeHeight : EYE_HEIGHT;
        // Where start_game (and change_dimension) put the player: "eye" (PocketMine, Dragonfly), "feet"
        // (what ViaBedrock and Oomph read from BDS) or "auto": servers that keep a rewind history are
        // read as BDS (feet), the others as eye. The first correction or addon report that is about
        // 1.62 blocks off in height flips a wrong guess (see calibrate), so this only shapes the first moments.
        this.startConvention = opts.startConvention === "eye" || opts.startGameEyeLevel === true ? "eye" : opts.startConvention === "feet" ? "feet" : "auto";
        this.startIsEye = this.startConvention === "eye";
        this.calibrated = this.startConvention !== "auto";
        this.runtimeId = 0n;
        this.pos = null;             // feet {x, y, z}; null until start_game
        this.vel = { x: 0, y: 0, z: 0 };
        this.yaw = 0;
        this.pitch = 0;
        this.onGround = true;
        this.floor = 0;              // height of the ground under the body (from the addon's footing points)
        this.tick = 0n;              // our own simulation frame counter: 0 at start_game, +1 per packet, never reset
        this.rewindSize = 40;
        this.target = null;          // {x, y, z} feet point to walk to, or null
        this.mode = "walk";
        this.sprinting = false;
        this.jumping = false;
        this.sneaking = false;
        this.intentTicks = 0;        // ticks in which a move key was down (for the bridge's "pressing but not moving" check)
        this.truthMoved = 0;         // blocks the addon says the body really moved (sum over its position reports)
        this.lastTruth = null;
        this.keys = null;            // raw keys held on the AI's say-so: {f, s, sprint, sneak, jump, left, floor}; expires on its own
        this.jumpRequested = false;
        this.jumpDelay = 0;
        this.pendingTeleport = false;
        this.teleportFeet = null;
        this.teleportTick = -1n;
        this.dimensionChange = null;
        this.anchorGaps = 0;
        this.corrections = 0;
        this.teleports = 0;
        this.moves = 0;
        this.resyncs = 0;
        this.ready = false;          // start_game seen
        this.alive = true;
        this.gameMode = null;
    }

    // ---- what the server tells us ----
    onStartGame(p) {
        try { this.runtimeId = BigInt(p.runtime_entity_id ?? 0); } catch (e) { this.runtimeId = 0n; }
        const v = p.player_position || { x: 0, y: 64, z: 0 };
        this.rewindSize = Math.max(1, Number(p.rewind_history_size) || 40);
        if (this.startConvention === "auto" && !this.calibrated) this.startIsEye = !(Number(p.rewind_history_size) > 0);
        this.pos = { x: Number(v.x) || 0, y: (Number(v.y) || 0) - (this.startIsEye ? this.eye : 0), z: Number(v.z) || 0 };
        if (p.rotation) { this.pitch = Number(p.rotation.x) || 0; this.yaw = Number(p.rotation.z) || 0; }
        this.gameMode = p.player_gamemode ?? null;
        this.tick = 0n;
        this.vel = { x: 0, y: 0, z: 0 };
        this.onGround = true;
        this.floor = this.pos.y;
        this.target = null;
        this.pendingTeleport = false;
        this.teleportTick = -1n;
        this.dimensionChange = null;
        this.ready = true;
        this.alive = true;
        return true;
    }

    /** move_player for our own runtime id: the server moved us (teleport, respawn, a reset after lag). */
    onMovePlayer(p) {
        if (!this.isMe(p.runtime_id)) return false;
        if (p.mode === "rotation") { if (typeof p.pitch === "number") this.pitch = p.pitch; return true; }
        const feet = this.fromEye(p.position);
        const moved = this.pos ? Math.hypot(feet.x - this.pos.x, feet.y - this.pos.y, feet.z - this.pos.z) : 0;
        this.pos = feet;
        this.vel = { x: 0, y: 0, z: 0 };
        this.floor = feet.y;
        if (typeof p.yaw === "number") this.yaw = p.yaw;
        if (typeof p.pitch === "number") this.pitch = p.pitch;
        if (typeof p.on_ground === "boolean") this.onGround = p.on_ground;
        if (p.mode === "teleport") { this.pendingTeleport = true; this.teleportFeet = { ...feet }; this.teleports++; }
        if (moved > 2) this.target = null;   // a stale target would walk straight out of the teleport
        this.moves++;
        return true;
    }

    /** The server disagreed with where we said we were: adopt its position and velocity. */
    onCorrection(p) {
        if (p.prediction_type && p.prediction_type !== "player") return false;
        let t = null; try { t = BigInt(p.tick); } catch (e) { t = null; }
        if (t !== null && (t > this.tick || t < this.tick - BigInt(this.rewindSize) || t < this.teleportTick)) return false;
        const fixed = this.fromEye(p.position);
        this.calibrate(fixed);
        this.pos = fixed;
        if (p.delta) this.vel = { x: Number(p.delta.x) || 0, y: Number(p.delta.y) || 0, z: Number(p.delta.z) || 0 };
        if (typeof p.on_ground === "boolean") { this.onGround = p.on_ground; if (p.on_ground) this.floor = this.pos.y; }
        this.jumpDelay = 0;
        this.corrections++;
        return true;
    }

    /** set_entity_motion for our id: knockback, explosions, water; the server simulates from this. */
    onMotion(p) {
        if (!this.isMe(p.runtime_entity_id)) return false;
        const v = p.velocity || {};
        this.vel = { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
        if (this.vel.y > 0) this.onGround = false;
        return true;
    }

    /** Dead: the death screen is up. No input is sent until the server has respawned us. */
    markDead() {
        this.alive = false; this.target = null; this.vel = { x: 0, y: 0, z: 0 };
        this.jumping = false; this.jumpRequested = false; this.sprinting = false; this.sneaking = false; this.keys = null; this.pendingTeleport = false;
        this.deaths = (this.deaths || 0) + 1;
    }

    /** The packets that press the Respawn button; attempt 1 is the vanilla click, later ones also say "ready" for servers that never answer the click. */
    respawnPackets(attempt = 1) {
        const rid = this.runtimeId;
        const out = [{ name: "player_action", params: { runtime_entity_id: rid, action: "respawn", position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 } }];
        if (attempt >= 2) out.push({ name: "respawn", params: { position: { x: 0, y: 0, z: 0 }, state: 2, runtime_entity_id: rid } });
        return out;
    }

    /**
     * The server's side of the respawn exchange: state 0 (searching for a spawn) and state 1 (ready,
     * with the spawn position). The client starts the exchange by pressing Respawn (respawnPackets)
     * and closes it with state 2 once the server says it is ready. Returns packets to send.
     */
    onRespawn(p) {
        if (!this.isMe(p.runtime_entity_id)) return [];
        const state = Number(p.state);
        if (state === 0) { if (this.alive) this.markDead(); return []; }
        if (state !== 1) return [];
        this.pos = this.fromEye(p.position);
        this.vel = { x: 0, y: 0, z: 0 };
        this.floor = this.pos.y;
        this.onGround = true;
        this.alive = true;
        this.target = null;
        this.pendingTeleport = true;       // the server also teleports us to the spawn: acknowledge it
        this.teleportFeet = { ...this.pos };
        return [{ name: "respawn", params: { position: { x: 0, y: 0, z: 0 }, state: 2, runtime_entity_id: this.runtimeId } }];
    }

    /** change_dimension: the server moves us to another dimension; the client shows a loading screen. */
    onChangeDimension(p) {
        const v = p.position || {};
        this.pos = { x: Number(v.x) || 0, y: (Number(v.y) || 0) - (this.startIsEye ? this.eye : 0), z: Number(v.z) || 0 };
        this.vel = { x: 0, y: 0, z: 0 };
        this.floor = this.pos.y;
        this.target = null;
        this.dimensionChange = { id: p.loading_screen_id ?? null };
        const params = { type: 1 };
        if (p.loading_screen_id !== undefined && p.loading_screen_id !== null) params.loading_screen_id = p.loading_screen_id;
        return [{ name: "serverbound_loading_screen", params }];
    }

    /** A clientbound player_action: the server acknowledges the dimension change; we close the loading screen. */
    onPlayerAction(p) {
        if (!this.dimensionChange || p.action !== "dimension_change_ack") return [];
        const id = this.dimensionChange.id;
        this.dimensionChange = null;
        const end = { type: 2 };
        if (id !== null && id !== undefined) end.loading_screen_id = id;
        return [
            { name: "player_action", params: { runtime_entity_id: this.runtimeId, action: "dimension_change_ack", position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 } },
            { name: "serverbound_loading_screen", params: end },
        ];
    }

    /**
     * The addon's view of where the server keeps this body (feet). Corrections are the primary
     * sync; this catches a body that drifted away without any (a wrong start position, a server
     * that never corrected). Two consecutive gaps over 1.5 blocks resync.
     */
    anchorFrom(feet) {
        if (feet && typeof feet.x === "number" && typeof feet.z === "number") {
            if (this.lastTruth) { const d = Math.hypot(feet.x - this.lastTruth.x, feet.z - this.lastTruth.z); if (d < 5) this.truthMoved += d; }   // a jump of 5+ is a teleport, not walking
            this.lastTruth = { x: feet.x, y: typeof feet.y === "number" ? feet.y : 0, z: feet.z };
        }
        if (!this.pos || !feet || typeof feet.x !== "number" || this.pendingTeleport || this.dimensionChange) return false;
        this.calibrate(feet);
        const gap = Math.hypot(feet.x - this.pos.x, (typeof feet.y === "number" ? feet.y : this.pos.y) - this.pos.y, feet.z - this.pos.z);
        if (gap <= 1.5) { this.anchorGaps = 0; return false; }
        if (++this.anchorGaps < 2) return false;
        this.anchorGaps = 0;
        this.pos = { x: feet.x, y: typeof feet.y === "number" ? feet.y : this.pos.y, z: feet.z };
        this.vel = { x: 0, y: 0, z: 0 };
        this.floor = this.pos.y;
        this.onGround = true;
        this.resyncs++;
        return true;
    }

    /**
     * The server's own idea of where our feet are, against ours: a height gap of about 1.62 blocks
     * with the same horizontal position is the signature of the wrong start_game convention. Flip the
     * guess once (it also decides how change_dimension is read) and report it.
     */
    calibrate(truthFeet) {
        if (this.calibrated || !this.pos || !truthFeet || typeof truthFeet.y !== "number") return false;
        const flat = Math.hypot(truthFeet.x - this.pos.x, truthFeet.z - this.pos.z);
        const dy = truthFeet.y - this.pos.y;
        if (flat > 0.6) return false;
        if (Math.abs(Math.abs(dy) - this.eye) > 0.3) { if (Math.abs(dy) < 0.3) this.calibrated = true; return false; }
        this.startIsEye = dy < 0 ? true : false;      // we were 1.62 too high: the server meant eye level; too low: it meant feet
        this.calibrated = true;
        this.convention = this.startIsEye ? "eye" : "feet";
        return true;
    }

    // ---- what the addon asks for ----
    walkTo(target, mode = "walk") {
        if (!target || typeof target.x !== "number" || typeof target.z !== "number") return false;
        this.target = { x: target.x, y: typeof target.y === "number" && Number.isFinite(target.y) ? target.y : (this.pos ? this.floor : 0), z: target.z };
        this.mode = mode === "sprint" || mode === "panic" ? "sprint" : "walk";
        return true;
    }

    stop() { this.target = null; this.keys = null; }

    /**
     * Hold keys, as a player's fingers do: f = +1 forward / -1 back, s = +1 strafe left / -1 right, plus
     * sprint (forward only), sneak and jump. The keys stay down for `ms` and then let go by themselves,
     * so a body whose addon went quiet stops instead of running on; refresh them to keep walking.
     * `floor` is the height of the ground a step ahead (the addon reads it from the world), which is how a
     * body without eyes knows to hop up a ledge or drop down one.
     */
    press({ f = 0, s = 0, sprint = false, sneak = false, jump = false, ms = 300, floor } = {}) {
        if (!this.ready || !this.alive) return false;
        const axis = (v) => (v > 0.1 ? 1 : v < -0.1 ? -1 : 0);
        f = axis(Number(f)); s = axis(Number(s));
        if (!f && !s && !jump && !sneak) { this.keys = null; return true; }
        this.target = null;
        this.keys = { f, s, sprint: !!sprint && f > 0 && !sneak, sneak: !!sneak, jump: !!jump, left: Math.max(1, Math.min(200, Math.ceil((Number(ms) || 300) / 50))), floor: typeof floor === "number" && Number.isFinite(floor) ? floor : null };
        return true;
    }

    release() { this.keys = null; }

    /** Turn the head to an absolute yaw and pitch (degrees, Bedrock convention: yaw 0 south, negative pitch up). */
    setLook(yaw, pitch) {
        if (typeof yaw === "number" && Number.isFinite(yaw)) this.yaw = ((yaw + 180) % 360 + 360) % 360 - 180;
        if (typeof pitch === "number" && Number.isFinite(pitch)) this.pitch = Math.max(-90, Math.min(90, pitch));
    }

    /** Hop over the next block edge: the server simulates the jump from the flags. */
    jump() { if (this.alive) this.jumpRequested = true; }

    /** Face a point (yaw/pitch from the eyes), without moving. */
    lookAt(point) {
        if (!this.pos || !point) return;
        const dx = point.x - this.pos.x, dz = point.z - this.pos.z;
        const dy = (typeof point.y === "number" ? point.y : this.pos.y + this.eye) - (this.pos.y + this.eye);
        const flat = Math.hypot(dx, dz);
        if (flat > 1e-6) { this.yaw = Math.atan2(-dx, dz) * DEG; this.pitch = -Math.atan2(dy, flat) * DEG; }
        else if (Math.abs(dy) > 1e-6) this.pitch = dy > 0 ? -90 : 90;
    }

    /**
     * One tick. Returns the player_auth_input params to send, or null before start_game or while
     * dead (the tick still counts). Mirrors what the server simulates from the same inputs, so
     * the predicted positions stay inside the server's acceptance threshold.
     */
    step() {
        if (!this.ready || !this.pos) return null;
        this.tick += 1n;
        if (!this.alive) return null;
        const flags = new Set(["block_breaking_delay_enabled"]);
        let move = { x: 0, z: 0 };
        // 1. a teleport is answered first: report its position exactly, no impulse, and the flag
        if (this.pendingTeleport) {
            this.pos = { ...this.teleportFeet };
            this.vel = { x: 0, y: 0, z: 0 };
            this.jumpDelay = 0;
            this.pendingTeleport = false;
            this.teleportTick = this.tick;
            flags.add("handled_teleport");
            if (this.onGround) flags.add("vertical_collision");
            return this.packet(flags, move, { x: 0, y: GROUND_DELTA_Y, z: 0 });
        }
        // 2. what the fingers do: raw keys the AI is holding, or the walk to a target (face it, hold forward)
        let keyUp = false, mf = 0, ms = 0, wantSprint = false, wantSneak = false;
        if (this.keys) {
            if (this.keys.left-- <= 0) this.keys = null;
        }
        if (this.keys) {
            mf = this.keys.f; ms = this.keys.s; wantSprint = this.keys.sprint; wantSneak = this.keys.sneak;
            if (this.keys.jump) this.jumpRequested = true;
            keyUp = mf !== 0 || ms !== 0;
        } else if (this.target) {
            const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
            const flat = Math.hypot(dx, dz);
            if (flat <= ARRIVE) { this.floor = this.target.y; this.target = null; }
            else { this.yaw = Math.atan2(-dx, dz) * DEG; keyUp = true; mf = 1; wantSprint = this.mode === "sprint"; }
        }
        if (keyUp) this.intentTicks++;
        // 3. sprint and sneak edges and state
        if (keyUp && wantSprint && mf > 0) {
            if (!this.sprinting) { flags.add("start_sprinting"); this.sprinting = true; }
            flags.add("sprint_down"); flags.add("sprinting");
        } else if (this.sprinting) { flags.add("stop_sprinting"); this.sprinting = false; }
        if (wantSneak) {
            if (!this.sneaking) { flags.add("start_sneaking"); this.sneaking = true; }
            flags.add("sneaking"); flags.add("sneak_down"); flags.add("persist_sneak"); flags.add("sneak_current_raw");
        } else if (this.sneaking) { flags.add("stop_sneaking"); this.sneaking = false; flags.add("sneak_released_raw"); }
        // 4. the impulse: forward and strafe keys together, never faster than one key (vanilla moveRelative)
        const yawRad = this.yaw / DEG;
        const fwd = { x: -Math.sin(yawRad), z: Math.cos(yawRad) };
        const left = { x: Math.cos(yawRad), z: Math.sin(yawRad) };
        if (keyUp) {
            let speed = this.onGround ? PHYS.groundSpeed * (this.sprinting ? PHYS.sprintMul : 1) : (this.sprinting ? PHYS.sprintAirSpeed : PHYS.airSpeed);
            if (this.sneaking && this.onGround) speed *= 0.3;
            const ix = ms * PHYS.impulse, iz = mf * PHYS.impulse;
            const norm = Math.max(Math.hypot(ix, iz), 1);
            const ax = ix / norm * speed, az = iz / norm * speed;
            this.vel.x += fwd.x * az + left.x * ax;
            this.vel.z += fwd.z * az + left.z * ax;
            if (mf > 0) flags.add("up"); else if (mf < 0) flags.add("down");
            if (ms > 0) flags.add("left"); else if (ms < 0) flags.add("right");
            if (mf > 0 && ms > 0) flags.add("up_left"); else if (mf > 0 && ms < 0) flags.add("up_right"); else if (mf < 0 && ms > 0) flags.add("down_left"); else if (mf < 0 && ms < 0) flags.add("down_right");
            move = { x: ms, z: mf };
        }
        // 5. jump (only from the ground, with the vanilla cooldown)
        const prevGround = this.onGround;
        if (this.jumpRequested && this.onGround && this.jumpDelay === 0) {
            this.vel.y = PHYS.jump;
            if (this.sprinting && keyUp) { this.vel.x += fwd.x * PHYS.sprintJumpBoost; this.vel.z += fwd.z * PHYS.sprintJumpBoost; }
            this.jumpDelay = PHYS.jumpDelay;
            this.onGround = false;
            this.jumping = true;
            this.jumpRequested = false;
            flags.add("start_jumping"); flags.add("jump_pressed_raw");
        }
        if (this.jumping) { flags.add("jump_down"); flags.add("jumping"); flags.add("want_up"); flags.add("jump_current_raw"); }
        if (this.jumpDelay > 0) this.jumpDelay--;
        // 6. integrate against the ground the addon described
        const prevY = this.pos.y;
        this.pos.x += this.vel.x; this.pos.y += this.vel.y; this.pos.z += this.vel.z;
        const near = this.target ? Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 1.2 : false;
        const floorY = this.keys && this.keys.floor !== null ? this.keys.floor : (this.target && near) ? this.target.y : this.floor;
        if (this.pos.y <= floorY + 1e-9) {
            if (prevY >= floorY - 1e-9 || (prevGround && floorY - prevY <= PHYS.stepHeight)) {
                // landed on it, or stepped up onto it (a slab, a stair)
                this.pos.y = floorY; this.vel.y = 0; this.onGround = true; this.floor = floorY;
            } else {
                // a full block up that we have not jumped over yet: stay on our own ground and jump
                if (this.pos.y <= this.floor + 1e-9) { this.pos.y = this.floor; this.vel.y = 0; this.onGround = true; }
                else this.onGround = false;
                if (this.onGround && !this.jumping && this.jumpDelay === 0) this.jumpRequested = true;
            }
        } else this.onGround = false;
        if (this.onGround) flags.add("vertical_collision");
        if (this.jumping && this.onGround && !prevGround) { /* landed this tick: key released next */ }
        if (this.jumping && this.onGround && this.vel.y === 0 && this.jumpDelay < PHYS.jumpDelay) { this.jumping = false; flags.add("jump_released_raw"); flags.delete("jump_down"); flags.delete("jumping"); flags.delete("want_up"); flags.delete("jump_current_raw"); }
        // 7. end of frame: gravity and friction, as the client reports its velocity
        this.vel.y = (this.vel.y - PHYS.gravity) * PHYS.gravityMul;
        const fr = PHYS.airFriction * (this.onGround ? PHYS.blockFriction : 1);
        this.vel.x *= fr; this.vel.z *= fr;
        if (Math.abs(this.vel.x) < 1e-5) this.vel.x = 0;
        if (Math.abs(this.vel.z) < 1e-5) this.vel.z = 0;
        return this.packet(flags, move, { x: this.vel.x, y: this.vel.y, z: this.vel.z });
    }

    packet(flags, move, delta) {
        const yawRad = this.yaw / DEG, pitchRad = this.pitch / DEG;
        return {
            pitch: this.pitch,
            yaw: this.yaw,
            position: this.toEye(this.pos),
            move_vector: move,
            head_yaw: this.yaw,
            input_data: sortFlags(flags),
            input_mode: "mouse",
            play_mode: "screen",
            interaction_model: "touch",
            interact_rotation: { x: this.pitch, z: this.yaw },
            tick: this.tick,
            delta,
            analogue_move_vector: { x: 0, z: 0 },
            camera_orientation: { x: -Math.sin(yawRad) * Math.cos(pitchRad), y: -Math.sin(pitchRad), z: Math.cos(yawRad) * Math.cos(pitchRad) },
            raw_move_vector: move,
        };
    }

    /** Where the body is, for logs and the addon. */
    status() {
        const r2 = (n) => +Number(n).toFixed(2);
        return { ready: this.ready, alive: this.alive, startIsEye: this.startIsEye, calibrated: this.calibrated, pos: this.pos ? { x: r2(this.pos.x), y: r2(this.pos.y), z: r2(this.pos.z) } : null, vel: { x: r2(this.vel.x), y: r2(this.vel.y), z: r2(this.vel.z) }, floor: r2(this.floor), yaw: Math.round(this.yaw), onGround: this.onGround, walking: !!this.target, keys: this.keys ? { f: this.keys.f, s: this.keys.s, sprint: this.keys.sprint, sneak: this.keys.sneak, jump: this.keys.jump } : null, pitch: Math.round(this.pitch), target: this.target ? { x: r2(this.target.x), y: r2(this.target.y), z: r2(this.target.z) } : null, sprinting: this.sprinting, jumping: this.jumping, pendingTeleport: this.pendingTeleport, dimensionChange: !!this.dimensionChange, tick: Number(this.tick), corrections: this.corrections, teleports: this.teleports, resyncs: this.resyncs, gameMode: this.gameMode };
    }

    // ---- helpers ----
    isMe(id) { try { return this.runtimeId !== 0n && BigInt(id) === this.runtimeId; } catch (e) { return false; } }
    fromEye(v) { return v ? { x: Number(v.x) || 0, y: (Number(v.y) || 0) - this.eye, z: Number(v.z) || 0 } : { ...this.pos }; }
    toEye(feet) { return { x: feet.x, y: feet.y + this.eye, z: feet.z }; }
}
