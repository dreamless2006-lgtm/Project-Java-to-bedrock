import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const PREFIX = "rg:cfg_";

const CHAT_LEVELS = ["Silent", "Quiet", "Normal", "Loud"];
const MISCHIEF_LEVELS = ["Off", "Gentle", "Gremlin"];
const JOB_LENGTHS = [1, 2.5, 5];

const DEFAULTS = {
    chat: 2,
    quests: 1,
    duels: 1,
    mischief: 1,
    jobLength: 1,      // index into JOB_LENGTHS
    proposals: 1
};

function readNumber(key) {
    const value = world.getDynamicProperty(PREFIX + key);
    return typeof value === "number" ? value : DEFAULTS[key];
}

function writeNumber(key, value) {
    try {
        world.setDynamicProperty(PREFIX + key, value);
    } catch (e) { console.warn(e, e.stack); }
}

export function getSettings() {
    return {
        chat: readNumber("chat"),
        quests: readNumber("quests") === 1,
        duels: readNumber("duels") === 1,
        mischief: readNumber("mischief"),
        jobTicks: Math.round(JOB_LENGTHS[readNumber("jobLength")] * 60 * 20),
        proposals: readNumber("proposals") === 1
    };
}

export function jobLengthTicks() {
    return getSettings().jobTicks;
}

/**
 * Single gate for every bot chat line, so the Silent and Quiet settings apply
 * to all talkers instead of just one module.
 */
export function chatAllows() {
    const level = getSettings().chat;
    if (level === 0) return false;
    if (level === 1) return Math.random() < 0.4;
    if (level === 3) return true;
    return Math.random() < 0.85;
}

export function showSettingsForm(player, fromList) {
    if (!player?.isValid) return;

    const s = getSettings();
    const form = new ActionFormData();
    form.title("§b§lAI Behaviour Settings");
    form.body(
        "Changes apply straight away to every bot.\n\n" +
        `Chat volume: ${CHAT_LEVELS[s.chat]}\n` +
        `Bot quests: ${s.quests ? "On" : "Off"}\n` +
        `Duels: ${s.duels ? "On" : "Off"}\n` +
        `Mischief: ${MISCHIEF_LEVELS[s.mischief]}\n` +
        `Job length: ${JOB_LENGTHS[s.jobLength]} min\n` +
        `Friend requests: ${s.proposals ? "On" : "Off"}`
    );

    form.button(`Chat: §a${CHAT_LEVELS[s.chat]}`, "textures/ui/icon_chat");
    form.button(`Quests: §a${s.quests ? "On" : "Off"}`, "textures/items/paper");
    form.button(`Duels: §a${s.duels ? "On" : "Off"}`, "textures/items/iron_sword");
    form.button(`Mischief: §a${MISCHIEF_LEVELS[s.mischief]}`, "textures/items/snowball");
    form.button(`Job length: §a${JOB_LENGTHS[s.jobLength]} min`, "textures/items/clock_item");
    form.button(`Friend requests: §a${s.proposals ? "On" : "Off"}`, "textures/items/friend_request");
    form.button("§cBack");

    form.show(player).then(response => {
        if (response.canceled) return;

        const choice = response.selection;
        if (choice === 0) writeNumber("chat", (s.chat + 1) % CHAT_LEVELS.length);
        else if (choice === 1) writeNumber("quests", s.quests ? 0 : 1);
        else if (choice === 2) writeNumber("duels", s.duels ? 0 : 1);
        else if (choice === 3) writeNumber("mischief", (s.mischief + 1) % MISCHIEF_LEVELS.length);
        else if (choice === 4) writeNumber("jobLength", (s.jobLength + 1) % JOB_LENGTHS.length);
        else if (choice === 5) writeNumber("proposals", s.proposals ? 0 : 1);
        else return;

        player.sendMessage(`§7Settings saved.`);
        system.runTimeout(() => showSettingsForm(player, fromList), 5);
    }).catch(e => console.warn(e, e.stack));
}
