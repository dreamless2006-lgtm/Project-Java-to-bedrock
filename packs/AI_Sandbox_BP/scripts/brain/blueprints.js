// Structure presets the model can ask for. Pure: dx/dz are relative to the
// build origin and rotated to the bot's facing by the actuator.
export function presetBlueprint(preset, material, size = {}) {
    const w = Math.max(3, Math.min(16, size.width || 5)), d = Math.max(3, Math.min(16, size.depth || 5)), h = Math.max(2, Math.min(12, size.height || 3));
    const bp = [];
    const put = (dx, dy, dz, block = material) => bp.push({ dx, dy, dz, block });
    const hx = Math.floor(w / 2), hz = Math.floor(d / 2);
    switch (preset) {
        case "house": {
            for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
                const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
                for (let y = 0; y < h; y++) {
                    const isDoor = z === 0 && x === hx && y < 2;
                    if (edge && !isDoor) {
                        const window = y === 1 && !isDoor && ((x === 0 || x === w - 1) ? (z % 2 === 1 && z !== 0 && z !== d - 1) : (x % 2 === 1 && x !== 0 && x !== w - 1 && z === d - 1));
                        put(x - hx, y, z, window ? "minecraft:glass" : material);
                    }
                }
                put(x - hx, h, z, material);                       // flat roof
                if (!edge) put(x - hx, -1, z, material);           // floor
            }
            put(1 - hx, 1, 1, "minecraft:torch"); put(w - 2 - hx, 1, d - 2, "minecraft:torch");
            put(w - 2 - hx, 0, d - 2, "minecraft:crafting_table"); put(1 - hx, 0, d - 2, "minecraft:chest");
            break;
        }
        case "shelter": {
            for (let x = -1; x <= 1; x++) for (let z = 0; z <= 2; z++) for (let y = 0; y <= 2; y++) {
                const edge = x === -1 || x === 1 || z === 0 || z === 2 || y === 2;
                const door = z === 0 && x === 0 && y < 2;
                if (edge && !door) put(x, y, z, material);
            }
            put(0, 1, 1, "minecraft:torch");
            break;
        }
        case "wall": for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) put(x - hx, y, 1); break;
        case "tower": {
            for (let y = 0; y < h; y++) for (let x = -1; x <= 1; x++) for (let z = 0; z <= 2; z++) {
                const edge = x === -1 || x === 1 || z === 0 || z === 2;
                if (edge && !(y < 2 && z === 0 && x === 0)) put(x, y, z);
                if (!edge && y === h - 1) put(x, y, z);
            }
            for (let y = 0; y < h - 1; y++) put(0, y, 2, "minecraft:ladder");
            break;
        }
        case "bridge": for (let z = 1; z <= Math.max(4, w); z++) for (let x = -1; x <= 1; x++) put(x, -1, z); break;
        case "pillar": for (let y = 0; y < h; y++) put(1, y, 1); break;
        case "farm": {
            for (let x = -2; x <= 2; x++) for (let z = 0; z <= 4; z++) {
                if (x === 0 && z === 2) { put(x, -1, z, "minecraft:water"); continue; }
                put(x, -1, z, "minecraft:farmland"); put(x, 0, z, "minecraft:wheat");
            }
            break;
        }
        default: return null;
    }
    return bp;
}

