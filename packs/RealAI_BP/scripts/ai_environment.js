import { world, system, WeatherType } from "@minecraft/server";
import { requestMove, NAV } from "./ai_navigation.js";

import { brainActive } from "./brain/gate.js";
const WEATHER_SOURCE = "weather";

const ai_player_id = "rg:bot";
const BlastAvoidRadius = 8;
const ShelterFindRadius = 10;
const Checkgaptime = 20;

// Track current weather state
let currentWeather = WeatherType.Clear;
let weatherstartd = false;
let isReady = false; // ✅ Track if system is ready

/**
 * Check if a location is exposed to sky (no solid blocks above)
 */
function isExposedToSky(dimension, location) {
    const startY = Math.floor(location.y);
    const worldHeight = 320; // Max build height

    // Scan upward from the given location
    for (let y = startY + 1; y <= worldHeight; y++) {
        try {
            const block = dimension.getBlock({
                x: Math.floor(location.x),
                y: y,
                z: Math.floor(location.z)
            });

            // If we find a solid block, location is covered
            if (block && !block.isAir && block.isSolid) {
                return false; // Has cover above
            }
        } catch (e) {
            // If we can't get block, assume exposed
            return true;
        }
    }

    return true; // No solid blocks found - exposed to sky
}

/**
 * Check if a location has tree leaves or logs above it
 */
function isTreeCovered(dimension, location) {
    const startY = Math.floor(location.y);
    // Scan up to 10 blocks above for leaves or wood
    for (let checkY = startY + 1; checkY <= startY + 10; checkY++) {
        try {
            const blockAbove = dimension.getBlock({
                x: Math.floor(location.x),
                y: checkY,
                z: Math.floor(location.z)
            });

            if (blockAbove && (blockAbove.typeId.includes("leaves") || blockAbove.typeId.includes("log") || blockAbove.typeId.includes("cherry_leaves") || blockAbove.typeId.includes("mangrove_leaves") || blockAbove.typeId.includes("azalea_leaves"))) {
                return true;
            }
        } catch (e) { console.warn(e, e.stack); }
    }
    return false;
}

/**
 * start weather tracking by querying current weather
 */
async function startWeatherTracking() {
    try {
        const overworld = world.getDimension("overworld");
        const result = await overworld.runCommand("weather query");
        const output = (result.statusMessage || "").toLowerCase();

        if (output.includes("clear")) currentWeather = WeatherType.Clear;
        else if (output.includes("rain")) currentWeather = WeatherType.Rain;
        else if (output.includes("thunder")) currentWeather = WeatherType.Thunder;

        weatherstartd = true;
        console.warn(`[Environment] Weather startd: ${currentWeather}`);
    } catch (e) {
        console.warn(`[Environment] Failed to start weather: ${e}`);
        currentWeather = WeatherType.Clear;
        weatherstartd = true;
    }
}

/**
 * Listen for weather change events to keep weather state updated
 */
function setupWeatherListener() {
    world.afterEvents.weatherChange.subscribe(event => {
        currentWeather = event.newWeather;
        console.warn(`[Environment] Weather changed to: ${currentWeather}`);
    });
}

/**
 * Check if it's currently raining or thundering
 */
function isRaining() {
    return currentWeather === WeatherType.Rain || currentWeather === WeatherType.Thunder;
}

/**
 * Seek shelter from rain by finding a covered location
 */
function seekShelter(bot, dimension) {
    const startLoc = bot.location;
    let foundShelter = false;
    let bestLoc = null;

    // Scan nearby blocks to find a location that is covered
    for (let x = -ShelterFindRadius; x <= ShelterFindRadius; x += 2) {
        for (let z = -ShelterFindRadius; z <= ShelterFindRadius; z += 2) {
            for (let y = -2; y <= 2; y++) {
                const checkLoc = {
                    x: Math.floor(startLoc.x + x),
                    y: Math.floor(startLoc.y + y),
                    z: Math.floor(startLoc.z + z)
                };

                try {
                    // Check if this location has a tree above it (cover)
                    if (isTreeCovered(dimension, checkLoc)) {
                        foundShelter = true;
                        bestLoc = checkLoc;
                        break;
                    }
                } catch (e) {
                    // Silent fail
                }
            }
            if (foundShelter) break;
        }
        if (foundShelter) break;
    }

    if (foundShelter && bestLoc) {
        // jog to the tree cover. This used to be a raw impulse with a fixed
        // upward shove, so the bot hopped along and could be thrown into water.
        try {
            requestMove(bot, bestLoc, { priority: NAV.SURVIVAL, source: WEATHER_SOURCE, mode: "sprint" });
        } catch (e) { console.warn(e, e.stack); }
    }
}

/**
 * start the environment behavior system
 * Handles explosive avoidance and weather sheltering for AI bots
 */
export function startEnvironmentBehavior() {
    // ✅ Delayed initialization to avoid early execution errors
    const initAttempt = () => {
        try {
            // Test if world is ready
            const testDim = world.getDimension("overworld");
            if (!testDim) {
                system.runTimeout(initAttempt, 40); // Retry in 2 seconds
                return;
            }

            // start weather tracking
            startWeatherTracking().then(() => {
                setupWeatherListener();
                isReady = true;
                console.warn("[Environment] Environment behavior system startd with weather detection");
            }).catch(() => {
                weatherstartd = true;
                isReady = true;
            });

        } catch (e) {
            // Early execution - retry later
            console.warn(`[Environment] Waiting for world to be ready...`);
            system.runTimeout(initAttempt, 40); // Retry in 2 seconds
        }
    };

    // Start main interval (will only do work when ready)
    system.runInterval(() => {
        if (!isReady) return;

        try {
            const overworld = world.getDimension("overworld");

            const bots = overworld.getEntities({ type: ai_player_id });

            for (const bot of bots) {
                if (!bot.isValid) continue;

                const botLoc = bot.location;

                // 1. Explosive Danger Avoidance (Priority 1)
                const nearbyExplosives = overworld.getEntities({
                    location: botLoc,
                    maxDistance: BlastAvoidRadius,
                    type: "minecraft:tnt"
                });

                if (nearbyExplosives.length > 0) {
                    const nearestTnt = nearbyExplosives[0];
                    const tntLoc = nearestTnt.location;

                    const dx = botLoc.x - tntLoc.x;
                    const dz = botLoc.z - tntLoc.z;
                    const distanceXY = Math.sqrt(dx * dx + dz * dz);

                    if (distanceXY > 0.1) {
                        // Sprint away like a player. This used to be a raw
                        // impulse every second with a upward shove on it, which
                        // launched bots into the air and into water.
                        const away = {
                            x: botLoc.x + (dx / distanceXY) * 3,
                            y: botLoc.y,
                            z: botLoc.z + (dz / distanceXY) * 3
                        };
                        try {
                            requestMove(bot, away, { priority: NAV.SURVIVAL, source: WEATHER_SOURCE, mode: "sprint" });
                        } catch (e) { console.warn(e, e.stack); }
                    }
                    continue;
                }

                // 2. Weather Sheltering (the model decides for brain-driven bots)
                if (!brainActive(bot) && isRaining() && weatherstartd) {
                    // Check if bot is exposed to sky using manual scan
                    const isExposed = isExposedToSky(overworld, botLoc);

                    // 20% chance per check to seek shelter if exposed
                    if (isExposed && Math.random() < 0.2) {
                        seekShelter(bot, overworld);
                    }
                }
            }
        } catch (e) {
            // Silent fail for dimension errors
        }
    }, Checkgaptime);

    // Start initialization
    initAttempt();
}

