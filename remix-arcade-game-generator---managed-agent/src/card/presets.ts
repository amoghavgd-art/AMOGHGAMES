import type { VibeName } from "./vibes";

export type GenreName = "runner" | "shooter" | "maze" | "breakout" | "platformer" | "dodger";

export const GENRE_LIST: GenreName[] = [
  "runner",
  "shooter",
  "maze",
  "breakout",
  "platformer",
  "dodger",
];

export interface GenrePreset {
  genre: GenreName;
  defaultTitle: string;
  defaultTagline: string;
  defaultHero: { description: string; short: string };
  defaultEnemy: { description: string; behaviour: string };
  defaultEnemies: Array<{ description: string; behaviour: string }>;
  defaultCollectible: string;
  defaultTwist: string;
  defaultMechanics: string[];
  defaultWinLose: string;
  defaultArt: { scene: string; hero_pose: string };
  defaultVibe: VibeName;
}

export const GENRE_PRESETS: Record<GenreName, GenrePreset> = {
  runner: {
    genre: "runner",
    defaultTitle: "FOXFIRE RUN",
    defaultTagline: "outrun the dusk, grab every star",
    defaultHero: {
      description: "a small orange fox in a tiny blue scarf with white-tipped tail",
      short: "fox",
    },
    defaultEnemy: {
      description: "rolling boulders",
      behaviour: "roll in from the right, faster over time",
    },
    defaultEnemies: [
      {
        description: "rolling boulders",
        behaviour: "roll in from the right, faster over time",
      },
      {
        description: "swooper drones",
        behaviour: "dive at mid-air height to test jump timing",
      },
    ],
    defaultCollectible: "stars",
    defaultTwist: "double jump",
    defaultMechanics: ["double jump + fast-fall slam", "B: scarf surge dash"],
    defaultWinLose: "3 hits and you're out; score = distance + stars",
    defaultArt: {
      scene: "sunset dither sky, pine ridge silhouettes, starlit turf",
      hero_pose: "mid-leap, scarf flying",
    },
    defaultVibe: "sunset",
  },
  shooter: {
    genre: "shooter",
    defaultTitle: "COMET POP",
    defaultTagline: "blast through the jelly nebula",
    defaultHero: {
      description: "a stubby retro starfighter with glowing wings and twin thrusters",
      short: "starfighter",
    },
    defaultEnemy: {
      description: "wobbly space jellies",
      behaviour: "swoop down in sine-wave formations and fire sparks",
    },
    defaultEnemies: [
      {
        description: "wobbly space jellies",
        behaviour: "swoop down in sine-wave formations and fire sparks",
      },
      {
        description: "armored dreadnoughts",
        behaviour: "cruise across top lane taking 5 hits and firing 3-way bursts",
      },
    ],
    defaultCollectible: "power cells",
    defaultTwist: "spread shot",
    defaultMechanics: ["spread shot waves", "B: nova pulse clears enemy shots"],
    defaultWinLose: "3 hits and you're out; clear waves for bonus points",
    defaultArt: {
      scene: "deep nebula sky, ringed planets, drifting starfield",
      hero_pose: "banking upwards, lasers firing",
    },
    defaultVibe: "cosmic",
  },
  maze: {
    genre: "maze",
    defaultTitle: "MOTH MAZE",
    defaultTagline: "chase the glow, dodge the ghosts",
    defaultHero: {
      description: "a fluffy lunar moth with glowing antennae and patterned wings",
      short: "moth",
    },
    defaultEnemy: {
      description: "grumpy ghosts",
      behaviour: "patrol intersections and chase when close",
    },
    defaultEnemies: [
      {
        description: "grumpy ghosts",
        behaviour: "patrol intersections and chase when close",
      },
      {
        description: "ambusher phantoms",
        behaviour: "cut ahead of your corridor path to pincer you",
      },
    ],
    defaultCollectible: "glow dots",
    defaultTwist: "power pellet",
    defaultMechanics: ["warp-tunnel power pellets", "B: wing-flutter phase dash"],
    defaultWinLose: "collect all glow dots; power pellet lets you tag ghosts",
    defaultArt: {
      scene: "moonlit night sky, neon hedge arches, glowing floor grid",
      hero_pose: "wings spread, dashing around a corner",
    },
    defaultVibe: "mint",
  },
  breakout: {
    genre: "breakout",
    defaultTitle: "BRICK BAKERY",
    defaultTagline: "smash the stack, catch the crumbs",
    defaultHero: {
      description: "a bouncy frosted cupcake with a bright cherry on top",
      short: "cupcake",
    },
    defaultEnemy: {
      description: "stubborn candy bricks",
      behaviour: "layered candy walls that drop coins when smashed",
    },
    defaultEnemies: [
      {
        description: "stubborn candy bricks",
        behaviour: "layered candy walls that drop coins when smashed",
      },
      {
        description: "armored frosting bricks",
        behaviour: "silver top-row blocks that require 2 hits to crack",
      },
    ],
    defaultCollectible: "coins from bricks",
    defaultTwist: "multiball",
    defaultMechanics: ["multiball + wide paddle", "B: cherry power-smash pierce"],
    defaultWinLose: "3 balls to clear the wall; score per brick and coin",
    defaultArt: {
      scene: "pastel bakery sky, tiered cake silhouettes, falling sprinkles",
      hero_pose: "ricocheting upward in a burst of sprinkles",
    },
    defaultVibe: "candy",
  },
  platformer: {
    genre: "platformer",
    defaultTitle: "SLIME HOP",
    defaultTagline: "hop high before the lava rises",
    defaultHero: {
      description: "a cheerful bouncy green slime with big glossy eyes and crown",
      short: "slime",
    },
    defaultEnemy: {
      description: "patrolling horned beetles",
      behaviour: "march back and forth across ledges",
    },
    defaultEnemies: [
      {
        description: "patrolling horned beetles",
        behaviour: "march back and forth across ledges",
      },
      {
        description: "bubbling temple lava",
        behaviour: "surges along the floor to punish missed jumps",
      },
    ],
    defaultCollectible: "gems",
    defaultTwist: "wall jump",
    defaultMechanics: ["temple pillar wall-jump", "B: slime shockwave stomp"],
    defaultWinLose: "climb to the top flag and grab gems before lava catches you",
    defaultArt: {
      scene: "twilight temple sky, mossy stone pillars, bubbling lava glow",
      hero_pose: "mid-hop between stone platforms",
    },
    defaultVibe: "mint",
  },
  dodger: {
    genre: "dodger",
    defaultTitle: "METEOR DODGE",
    defaultTagline: "weave through the falling sky",
    defaultHero: {
      description: "a tiny golden arcade coin character in red sneakers",
      short: "pip",
    },
    defaultEnemy: {
      description: "falling flaming meteors",
      behaviour: "rain down from above at increasing speed",
    },
    defaultEnemies: [
      {
        description: "falling flaming meteors",
        behaviour: "rain down from above at increasing speed",
      },
      {
        description: "diagonal seeker orbs",
        behaviour: "drift toward your lane and telegraph giant crushers",
      },
    ],
    defaultCollectible: "shields",
    defaultTwist: "dash",
    defaultMechanics: ["near-miss graze bonus", "B: sneaker phase-dash"],
    defaultWinLose: "3 hits and you're squashed; survive for high score",
    defaultArt: {
      scene: "fiery volcano sky, jagged canyon ridges, glowing ash embers",
      hero_pose: "sidestepping a giant falling boulder",
    },
    defaultVibe: "sunset",
  },
};
