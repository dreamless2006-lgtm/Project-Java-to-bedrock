// The vanilla sound events and particle effects the add-on's client entities may map (their
// description.sound_effects / particle_effects, played from animation timelines), checked against
// Mojang's bedrock-samples 1.26.50.4 (resource_pack/sounds/sound_definitions.json and
// resource_pack/particles/*.json, read with `git show` because that checkout is sparse).
// tools/validate.mjs allows a mapped id when it is one of ours (packs/resource/sounds) or listed here.
//
// Particles are listed only when they work from an animation: they emit at once (rate instant or
// steady), stop by themselves (lifetime once or expression) and need no variables set by the caller.
// Looping emitters (oozing_*) and manual ones (white_smoke, heart, endrod, water_drip, ...) either
// never emit or never stop when an animation starts them, and electric_spark, mob_portal,
// portal_reverse_particle and the nectar and honey drips read variables an animation cannot set.
// Add an id only after checking it the same way.

/** The bedrock-samples version the lists were checked against. */
export const VANILLA_SOURCE = 'bedrock-samples 1.26.50.4';

/** Vanilla sound events (sound_definitions.json keys). */
export const VANILLA_SOUNDS = /** @type {ReadonlySet<string>} */ (
  new Set([
    'mob.bee.loop', // Bee: the buzz
    'mob.breeze.idle_air', // Allie: gusts
    'mob.cat.hiss', // Luna: at the push peak
    'mob.endermen.idle', // ender woman: at the first push
    'mob.endermen.portal', // ender woman: the portal sound when she throws herself back
    'mob.frog.lay_spawn', // Kobold: laying the egg
    'mob.phantom.flap', // Galath: wing beats
    'mob.slime.big', // slime girls: big squelch (also the humanoid slime girl's and the Jenny Slime's own)
    'mob.slime.jump', // the monster slime girl's jump and the Jenny Slime's own
    'mob.slime.small', // slime girls: small squelch
    'mob.slime.squish', // slime girls: squish (also the monster slime girl's own squish)
    'mob.zombie.say', // zombie girl: her groan at each push
    'random.fuse', // creeper girls: the fuse hiss at each push
    'step.grass', // the Jenny stage's own footsteps
  ])
);

/** Vanilla particle effects that are safe to start from an animation (particle_effect identifiers). */
export const VANILLA_PARTICLES = /** @type {ReadonlySet<string>} */ (
  new Set([
    'minecraft:basic_portal_particle', // ender woman: portal sparks (basic_portal.json: rate instant x1, lifetime expression)
    'minecraft:cauldron_bubble_particle', // humanoid slime girl: bubbles (cauldron_bubble.json: rate instant x1, lifetime once)
    'minecraft:dust_plume', // monster slime girl: dust at each landing (dust_plume.json: rate instant x7, lifetime once)
    'minecraft:falling_dust_sand_particle', // Kobold: nest scratching (falling_dust_sand.json: rate instant x1, lifetime once)
    'minecraft:wind_charged_ambient', // Allie: gusts (wind_charged_ambient.json: rate instant x2, lifetime once)
  ])
);
