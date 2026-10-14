// The bridge account's body, as the Realm sees it.
//
// Bedrock movement is server-authoritative: a player only moves when its own client sends
// player_auth_input every tick (50 ms) with where it claims to be and which inputs are held.
// A client that never sends it stands frozen at spawn, however the server or a script moves it.
// This class keeps the body's position from the server's own packets (start_game, move_player,
// correct_player_move_prediction, respawn), walks it towards targets the addon sends, and builds
// one player_auth_input per tick. Pure: no sockets, no timers, so it can be tested headless.
//
// Positions inside this class are FEET positions; the protocol carries the eye position
// (feet + EYE_HEIGHT) in player_auth_input, move_player and start_game, which is converted here.

export const EYE_HEIGHT = 1.62;
export const SPEED = { walk: 0.2158, sprint: 0.2806, sneak: 0.065 };   // blocks per tick, vanilla player speeds
export const ARRIVE = 0.25;                                              // closer than this is "there"
const DEG = 180 / Math.PI;

export class Body {
    constructor(opts = {}) {
        this.eye = typeof opts.eyeHeight === "number" ? opts.eyeHeight : EYE_HEIGHT;
        this.runtimeId = 0n;
        this.pos = null;            // feet {x, y, z}; null until start_game
        this.yaw = 0;
        this.pitch = 0;
        this.onGround = true;
        this.tick = 0n;
        this.target = null;         // {x, y, z} feet position to walk to, or null
        this.mode = "walk";
        this.sprinting = false;
        this.pendingTeleport = false;
        this.corrections = 0;
        this.teleports = 0;
        this.moves = 0;
        this.ready = false;         // start_game seen
        this.alive = true;
        this.lastTarget = null;
        this.jumpTicks = 0;
    }

    // ---- what the server tells us ----
    onStartGame(p) {
        try { this.runtimeId = BigInt(p.runtime_entity_id ?? 0); } catch (e) { this.runtimeId = 0n; }
        this.pos = this.fromPacket(p.player_position);
        if (p.rotation) { this.pitch = Number(p.rotation.x) || 0; this.yaw = Number(p.rotation.z) || 0; }
        try { this.tick = BigInt(p.current_tick ?? 0); } catch (e) { this.tick = 0n; }
        this.ready = true;
        this.alive = true;
        return true;
    }

    /** move_player for our own runtime id: the server moved us (teleport, correction after lag, respawn). */
    onMovePlayer(p) {
        if (!this.isMe(p.runtime_id)) return false;
        this.pos = this.fromPacket(p.position);
        if (typeof p.yaw === "number") this.yaw = p.yaw;
        if (typeof p.pitch === "number") this.pitch = p.pitch;
        if (typeof p.on_ground === "boolean") this.onGround = p.on_ground;
        if (p.mode === "teleport" || p.mode === "reset") { this.pendingTeleport = true; this.teleports++; }
        this.moves++;
        return true;
    }

    /** The server disagreed with where we said we were: adopt its position. */
    onCorrection(p) {
        if (p.prediction_type && p.prediction_type !== "player") return false;
        this.pos = this.fromPacket(p.position);
        if (typeof p.on_ground === "boolean") this.onGround = p.on_ground;
        this.corrections++;
        return true;
    }

    /**
     * Respawn handshake. The server sends state 0 (searching for spawn) and then state 1 (ready to
     * spawn) with the spawn position; the client answers with state 2 (client ready) and a
     * player_action "respawn". Returns the packets to send as [{name, params}].
     */
    onRespawn(p) {
        if (!this.isMe(p.runtime_entity_id)) return [];
        const state = Number(p.state);
        if (state === 0) { this.alive = false; this.target = null; return []; }
        if (state !== 1) return [];
        this.pos = this.fromPacket(p.position);
        this.alive = true;
        this.target = null;
        this.pendingTeleport = true;
        const rid = this.runtimeId;
        return [
            { name: "respawn", params: { position: p.position, state: 2, runtime_entity_id: rid } },
            { name: "player_action", params: { runtime_entity_id: rid, action: "respawn", position: { x: 0, y: 0, z: 0 }, result_position: { x: 0, y: 0, z: 0 }, face: 0 } },
        ];
    }

    // ---- what the addon asks for ----
    walkTo(target, mode = "walk") {
        if (!target || typeof target.x !== "number" || typeof target.z !== "number") return false;
        this.target = { x: target.x, y: typeof target.y === "number" ? target.y : (this.pos ? this.pos.y : 0), z: target.z };
        this.mode = mode === "sprint" || mode === "panic" ? "sprint" : "walk";
        this.lastTarget = this.target;
        return true;
    }

    stop() { this.target = null; }

    /** Hop over the next block edge: the server simulates the jump from these flags. */
    jump() { if (this.alive && this.jumpTicks <= 0) this.jumpTicks = 6; }

    /** Face a point (yaw/pitch from the eyes), without moving. */
    lookAt(point) {
        if (!this.pos || !point) return;
        const dx = point.x - this.pos.x, dz = point.z - this.pos.z;
        const dy = (typeof point.y === "number" ? point.y : this.pos.y + this.eye) - (this.pos.y + this.eye);
        const flat = Math.hypot(dx, dz);
        if (flat > 1e-6 || Math.abs(dy) > 1e-6) {
            if (flat > 1e-6) this.yaw = Math.atan2(-dx, dz) * DEG;
            this.pitch = flat > 1e-6 ? -Math.atan2(dy, flat) * DEG : (dy > 0 ? -90 : 90);
        }
    }

    /**
     * One tick: advance towards the target at walking speed and return the player_auth_input
     * params to send (or null before start_game). The claimed position moves along the ground
     * the server told us about; whenever the server disagrees it corrects us and we adopt it.
     */
    step() {
        if (!this.ready || !this.pos) return null;
        this.tick += 1n;
        const flags = [];
        if (this.pendingTeleport) { flags.push("handled_teleport"); this.pendingTeleport = false; }
        let move = { x: 0, z: 0 };
        const delta = { x: 0, y: 0, z: 0 };
        if (this.jumpTicks > 0) {
            // a jump: pressed on the first tick, held for a few more; the claimed height follows a short arc
            if (this.jumpTicks === 6) flags.push("start_jumping", "jump_down", "jump_pressed_raw", "north_jump");
            flags.push("jumping", "jump_current_raw");
            const rise = [0.42, 0.33, 0.25, 0.17, 0.09, 0][6 - this.jumpTicks] || 0;
            delta.y += rise; this.pos.y += rise; this.onGround = false;
            this.jumpTicks--;
            if (this.jumpTicks === 0) this.onGround = true;
        }
        if (this.target && this.alive) {
            const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
            const flat = Math.hypot(dx, dz);
            if (flat <= ARRIVE) {
                this.target = null;
                if (this.sprinting) { flags.push("stop_sprinting"); this.sprinting = false; }
            } else {
                this.yaw = Math.atan2(-dx, dz) * DEG;
                const speed = this.mode === "sprint" ? SPEED.sprint : SPEED.walk;
                const s = Math.min(speed, flat);
                const nx = this.pos.x + dx / flat * s, nz = this.pos.z + dz / flat * s;
                delta.x = nx - this.pos.x; delta.z = nz - this.pos.z;
                // a step up or down the addon already checked: follow the target's height gently
                if (typeof this.target.y === "number" && Math.abs(this.target.y - this.pos.y) > 0.01 && flat < 1.2) {
                    const ny = this.target.y > this.pos.y ? Math.min(this.target.y, this.pos.y + 0.6) : Math.max(this.target.y, this.pos.y - 0.6);
                    delta.y = ny - this.pos.y; this.pos.y = ny;
                }
                this.pos.x = nx; this.pos.z = nz;
                move = { x: 0, z: 1 };
                flags.push("up");
                if (this.mode === "sprint") {
                    if (!this.sprinting) { flags.push("start_sprinting"); this.sprinting = true; }
                    flags.push("sprinting");
                }
            }
        } else if (this.sprinting) { flags.push("stop_sprinting"); this.sprinting = false; }
        const yawRad = this.yaw / DEG, pitchRad = this.pitch / DEG;
        return {
            pitch: this.pitch,
            yaw: this.yaw,
            position: this.toPacket(this.pos),
            move_vector: move,
            head_yaw: this.yaw,
            input_data: flags,
            input_mode: "mouse",
            play_mode: "normal",
            interaction_model: "crosshair",
            interact_rotation: { x: this.pitch, z: this.yaw },
            tick: this.tick,
            delta,
            analogue_move_vector: move,
            camera_orientation: { x: -Math.sin(yawRad) * Math.cos(pitchRad), y: -Math.sin(pitchRad), z: Math.cos(yawRad) * Math.cos(pitchRad) },
            raw_move_vector: move,
        };
    }

    /** Where the body is, for logs and the addon. */
    status() {
        return { ready: this.ready, alive: this.alive, pos: this.pos ? { x: +this.pos.x.toFixed(2), y: +this.pos.y.toFixed(2), z: +this.pos.z.toFixed(2) } : null, yaw: Math.round(this.yaw), walking: !!this.target, tick: Number(this.tick), corrections: this.corrections, teleports: this.teleports };
    }

    // ---- helpers ----
    isMe(id) { try { return this.runtimeId !== 0n && BigInt(id) === this.runtimeId; } catch (e) { return false; } }
    fromPacket(v) { return v ? { x: Number(v.x) || 0, y: (Number(v.y) || 0) - this.eye, z: Number(v.z) || 0 } : this.pos; }
    toPacket(feet) { return { x: feet.x, y: feet.y + this.eye, z: feet.z }; }
}
