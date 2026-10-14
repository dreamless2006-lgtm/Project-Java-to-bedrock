import { world, system, EntityComponentTypes, EntityDamageCause } from "@minecraft/server";
import { ALL_AI_CACHE } from "./greeting.js";
import { REAL_PLAYERS_CACHE } from "./rgstart.js";
import { botSay } from "./ai_conversations.js";
import { getSettings } from "./ai_settings.js";
import { hasJob } from "./ai_task_worker.js";

import { brainActive } from "./brain/gate.js";
const WATCH_GAP = 10;
const FEUD_SCAN_GAP = 200;
const DUEL_TICKS = 20 * 30;          // 30 seconds of swinging
const CEASEFIRE_HP = 8;              // stop before it gets lethal
const HURT_GRUDGE = -30;             // affinity that turns into a challenge
const DUEL_WITH_KEY = "rg:duel_with";
const DUEL_UNTIL_KEY = "rg:duel_until";

const SAY = {
    challenge: "{p}, you and me. Right here. Now.",
    feud: "{p} you and me, no friends involved",
    start: "3... 2... 1... FIGHT",
    lose: "gg {p}, you got me",
    truce: "ok that's enough, truce?",
    interrupted: "not like this, we'll call it off"
};

const duels = new Map();   // key -> { botId, playerId, rivalId, until, kind }

function line(template, who) {
    return template.replace(/\{p\}/g, who || "you");
}

function health(entity) {
    try {
        const hp = entity.getComponent(EntityComponentTypes.Health);
        return hp ? hp.currentValue : 0;
    } catch (e) {
        return 0;
    }
}

function botById(botId) {
    return (ALL_AI_CACHE || []).find(b => b.isValid && b.id === botId) || null;
}

function playerById(playerId) {
    const found = (REAL_PLAYERS_CACHE || []).find(p => p.isValid && p.id === playerId);
    if (found) return found;
    try { return world.getEntity(playerId) || null; } catch (e) { return null; }
}

function protect(entity) {
    try {
        entity.addEffect("resistance", DUEL_TICKS_SAFE(), { amplifier: 2, showParticles: false });
    } catch (e) { /* not fatal */ }
}

function DUEL_TICKS_SAFE() {
    return DUEL_TICKS + 40;
}

function countDown(ai, opponentName, kind) {
    if (!ai?.isValid) return;
    botSay(ai, line(kind === "feud" ? SAY.feud : SAY.challenge, opponentName));

    system.runTimeout(() => {
        if (!ai.isValid) return;
        botSay(ai, SAY.start);
    }, 40);
}

function endDuel(key, reason) {
    const duel = duels.get(key);
    duels.delete(key);
    if (!duel) return;

    const ai = botById(duel.botId);
    if (ai) {
        ai.setDynamicProperty(DUEL_WITH_KEY, null);
        ai.setDynamicProperty(DUEL_UNTIL_KEY, null);
        try { ai.removeEffect("resistance"); } catch (e) { /* none applied */ }

        if (reason === "lose") botSay(ai, line(SAY.lose, duel.opponentName));
        else if (reason === "interrupted") botSay(ai, SAY.interrupted);
        else botSay(ai, SAY.truce);
    }

    // A duel burns off some of the bad blood. Affinity is keyed by the account
    // name everywhere else in the pack, so it has to be relieved by that key -
    // with a nameTag it never matched and the bot re-challenged forever.
    if (reason !== "interrupted" && duel.opponentKey && ai) {
        try {
            const affinity = (ai.getDynamicProperty("rg:affinity_" + duel.opponentKey) || 0) + 15;
            ai.setDynamicProperty("rg:affinity_" + duel.opponentKey, Math.min(0, affinity));
        } catch (e) { console.warn(e, e.stack); }
    }
}

/**
 * Player challenges a bot (or a bot dares a player back). Consensual, time
 * boxed, and damped with resistance so it should not end in a death.
 */
export function challengeToDuel(player, ai) {
    if (!player?.isValid || !ai?.isValid) return false;
    if (!getSettings().duels) {
        player.sendMessage("§8Duels are switched off in the behaviour settings.");
        return false;
    }
    if (ai.getDynamicProperty(DUEL_WITH_KEY)) return false;

    const key = ai.id + "|" + player.id;
    if (duels.has(key)) return false;

    ai.setDynamicProperty(DUEL_WITH_KEY, player.id);
    ai.setDynamicProperty(DUEL_UNTIL_KEY, system.currentTick + DUEL_TICKS);

    duels.set(key, {
        botId: ai.id,
        playerId: player.id,
        opponentName: player.nameTag,
        opponentKey: player.name,
        until: system.currentTick + DUEL_TICKS,
        kind: "duel"
    });

    protect(ai);
    protect(player);
    countDown(ai, player.nameTag, "duel");

    // Make the bot actually pick the opponent up, the same way grudges do
    try {
        ai.applyDamage(0, { cause: EntityDamageCause.entityAttack, damagingEntity: player });
    } catch (e) { console.warn(e, e.stack); }

    return true;
}

function watchDuels() {
    for (const [key, duel] of duels) {
        const ai = botById(duel.botId);
        const opponent = duel.playerId ? playerById(duel.playerId) : botById(duel.rivalId);

        if (!ai || !ai.isValid) {
            endDuel(key, "interrupted");
            continue;
        }

        if (system.currentTick > duel.until) {
            endDuel(key, "truce");
            continue;
        }

        if (!opponent || !opponent.isValid) {
            endDuel(key, "interrupted");
            continue;
        }

        if (health(opponent) <= CEASEFIRE_HP) {
            endDuel(key, "truce");     // opponent is nearly out, stop before it kills
            continue;
        }
        if (health(ai) <= CEASEFIRE_HP) {
            endDuel(key, "lose");
        }
    }
}

function scanForFeuds() {
    if (!getSettings().duels) return;

    for (const ai of ALL_AI_CACHE || []) {
        if (!ai.isValid || ai.getDynamicProperty(DUEL_WITH_KEY)) continue;
        if (brainActive(ai)) continue;   // the model challenges people with the duel action
        if (ai.getDynamicProperty("rg:current_target") || ai.hasTag("is_sleeping")) continue;
        // A duel pulls him away from a job he was hired for; feud after
        if (hasJob(ai)) continue;

        for (const player of REAL_PLAYERS_CACHE || []) {
            if (!player.isValid || player.dimension !== ai.dimension) continue;

            const dx = player.location.x - ai.location.x;
            const dz = player.location.z - ai.location.z;
            if (dx * dx + dz * dz > 64) continue;   // within 8 blocks

            const affinity = ai.getDynamicProperty("rg:affinity_" + player.name) || 0;
            if (affinity > HURT_GRUDGE) continue;

            challengeToDuel(player, ai);
            break;
        }
    }
}

export function startDuels() {
    system.runInterval(watchDuels, WATCH_GAP);
    system.runInterval(scanForFeuds, FEUD_SCAN_GAP);
}
