// The campaign: seven chapters from the Vale of Ashes to the Peak.
// Each altar is a prayer the party must hold against the swarm.

export const PRAYERS = [
  ['In nomine Patris, et Filii, et Spiritus Sancti.', 'In the name of the Father, and of the Son, and of the Holy Spirit.'],
  ['Qui habitat in adiutorio Altissimi…', 'He that dwelleth in the aid of the Most High…'],
  ['Non timebis a timore nocturno.', 'Thou shalt not be afraid of the terror of the night.'],
  ['Sancte Michael Archangele, defende nos in proelio.', 'Saint Michael the Archangel, defend us in battle.'],
  ['Contra nequitiam et insidias diaboli esto praesidium.', 'Be our protection against the wickedness and snares of the devil.'],
  ['Emitte Spiritum tuum, et renovabis faciem terrae.', 'Send forth thy Spirit, and thou shalt renew the face of the earth.'],
  ['Exsurgat Deus, et dissipentur inimici eius.', 'Let God arise, and let his enemies be scattered.'],
  ['Lux in tenebris lucet.', 'The light shineth in darkness.'],
];

const A = (o) => o;

export const CHAPTERS = [
  {
    id: 'vale', title: 'The Vale of Ashes', latin: 'Vallis Cinerum', seed: 1101, altars: 3, prayer: 48,
    intro: [
      'Anno Domini 1523. The harvest did not come.',
      'A black rot rose out of the earth. Last Lent, twenty knights under Sir Godric rode out to end it. None came home.',
      'Now five more ride north from the city, toward the mountain, along the road the First Company took.',
    ],
    outro: ['Three lights burn in the Vale.', 'On the ridge, something watched you work. Look for the First Company along the road.'],
    terrain: { kind: 'vale', amp: 9, hill: 28, edge: 40 },
    atmos: A({ skyTop: 0x0e0f14, skyMid: 0x3b2a26, skyBottom: 0x160d0b, sunColor: 0xff5a24, cloud: 0x1b1517, cloudLit: 0x7a3a26, glow: 0x5a1a0e, cover: 0.68, sunDir: [0.55, 0.12, -0.83], sunLight: 0xffa070, sunIntensity: 2.2, hemiSky: 0x7a6e70, hemiGround: 0x1a1210, hemiIntensity: 0.55, fog: 0x2b201e, fogDensity: 0.0125, exposure: 1.3, fillColor: 0x5a6a90, fillIntensity: 0.35 }),
    props: { deadTrees: 150, rocks: 80, graves: 36, crosses: 10, farm: 3, fences: 18 },
    pool: { shade: 1.0, crawler: 0.45 }, density: 0.8,
    ambient: 'ash', wind: [1.2, 0.4],
    devil: { watch: 3, finale: true },
  },
  {
    id: 'village', title: "Saint Aldric's", latin: 'Villa Sancti Aldrici', seed: 2207, altars: 4, prayer: 58,
    intro: ['The village of Saint Aldric burned on the night of the Ember Days.', 'No one buried its dead. Something else came for them.', 'Ring the bell again. Take back the churchyard.'],
    outro: ['The bell of Saint Aldric rings over green grass.', 'It was not the only thing listening.'],
    terrain: { kind: 'village', amp: 6, hill: 22, edge: 38 },
    atmos: A({ skyTop: 0x07080d, skyMid: 0x1f1520, skyBottom: 0x120806, sunColor: 0xff7a30, cloud: 0x120d10, cloudLit: 0x5a2618, glow: 0x6a2410, cover: 0.75, sunDir: [-0.4, 0.08, -0.9], sunLight: 0xff8a50, sunIntensity: 1.5, hemiSky: 0x4a4458, hemiGround: 0x1d0f0a, hemiIntensity: 0.5, fog: 0x1c1216, fogDensity: 0.014, exposure: 1.15, fillColor: 0x6070b0, fillIntensity: 0.35 }),
    props: { deadTrees: 70, rocks: 50, graves: 50, crosses: 16, village: true, fences: 30, fires: 14 },
    pool: { shade: 1.0, crawler: 0.5, wretch: 0.35 }, density: 0.9,
    ambient: 'embers', wind: [0.6, 0.8],
    devil: { watch: 4 },
  },
  {
    id: 'fen', title: 'The Weeping Fen', latin: 'Palus Lacrimarum', seed: 3313, altars: 4, prayer: 62,
    intro: ['South of the abbey lie the fens, where the monks once cut peat.', 'The water has turned black. Things bloat in it and do not sink.', 'Do not let them reach you whole.'],
    outro: ['The fen is clear water again. Herons stand in the reeds.', 'A pale shape moved across the water, and was gone.'],
    terrain: { kind: 'fen', amp: 3.5, hill: 16, edge: 30, water: 0.35 },
    atmos: A({ skyTop: 0x1b2026, skyMid: 0x4a4c4c, skyBottom: 0x22231f, sunColor: 0xd8c8a0, cloud: 0x34383a, cloudLit: 0x8a8070, glow: 0x30302a, cover: 0.85, sunDir: [0.3, 0.3, -0.9], sunLight: 0xc8c0b0, sunIntensity: 1.2, hemiSky: 0x8a9098, hemiGround: 0x22261c, hemiIntensity: 0.75, fog: 0x4a4e4c, fogDensity: 0.022, exposure: 1.0, fillColor: 0x707c88, fillIntensity: 0.25 }),
    props: { deadTrees: 90, rocks: 30, reeds: 1600, stumps: 60, boardwalk: true, crosses: 6 },
    pool: { shade: 1.0, crawler: 0.55, wretch: 0.35, husk: 0.4 }, density: 0.95,
    ambient: 'ash', wind: [0.4, 0.2],
    devil: { watch: 4 },
  },
  {
    id: 'wood', title: 'The Hollow Wood', latin: 'Silva Cava', seed: 4421, altars: 4, prayer: 66,
    intro: ['The charcoal-burners fled the wood at Michaelmas.', 'They spoke of a great beast among the trees, and of a tall man who watched.', 'He is closer now.'],
    outro: ['Leaves on the old oaks. Birdsong.', 'The hound is dead. Its master is not.'],
    terrain: { kind: 'wood', amp: 12, hill: 26, edge: 36 },
    atmos: A({ skyTop: 0x0a0c0c, skyMid: 0x262622, skyBottom: 0x0e0c0a, sunColor: 0xc06a30, cloud: 0x161614, cloudLit: 0x5a4028, glow: 0x30200e, cover: 0.8, sunDir: [-0.5, 0.25, -0.8], sunLight: 0xd0a070, sunIntensity: 1.6, hemiSky: 0x58584c, hemiGround: 0x16120c, hemiIntensity: 0.5, fog: 0x1c1c18, fogDensity: 0.02, exposure: 1.15, fillColor: 0x506070, fillIntensity: 0.3 }),
    props: { deadTrees: 650, rocks: 90, stumps: 50, logs: 30 },
    pool: { shade: 1.0, crawler: 0.7, wretch: 0.3, husk: 0.25, brute: 0.08 }, density: 1.0,
    ambient: 'ash', wind: [0.3, 0.1],
    devil: { watch: 5, close: true }, miniboss: 'hound',
  },
  {
    id: 'field', title: 'Field of the Fallen', latin: 'Campus Caesorum', seed: 5531, altars: 5, prayer: 70,
    intro: ['Here the Emperor\'s army met the darkness, and was broken.', 'Their banners still stand. Their bones do not lie still.', 'On the hill above the field, He reviews his legion.'],
    outro: ['The banners stand over a green field.', 'He did not run. He walked away, toward the mountain.'],
    terrain: { kind: 'field', amp: 7, hill: 34, edge: 40 },
    atmos: A({ skyTop: 0x100608, skyMid: 0x4a1a12, skyBottom: 0x1a0804, sunColor: 0xff3a10, cloud: 0x1a0c0c, cloudLit: 0x8a2810, glow: 0x7a1a08, cover: 0.62, sunDir: [0.2, 0.06, -0.98], sunLight: 0xff7040, sunIntensity: 2.4, hemiSky: 0x6a4a48, hemiGround: 0x1a0c08, hemiIntensity: 0.55, fog: 0x2e1612, fogDensity: 0.011, exposure: 1.05, fillColor: 0x6a5a90, fillIntensity: 0.3 }),
    props: { deadTrees: 40, rocks: 70, banners: 60, pikes: 140, graves: 40, cannons: 6, wagons: 8, fallen: 240, fallenKnights: 8 },
    pool: { shade: 1.0, crawler: 0.6, wretch: 0.4, husk: 0.3, brute: 0.12, wraith: 0.12, herald: 0.04 }, density: 1.15,
    ambient: 'embers', wind: [1.4, 0.2],
    devil: { watch: 6, army: true },
  },
  {
    id: 'ascent', title: 'The Ascent', latin: 'Ascensus', seed: 6649, altars: 4, prayer: 74,
    intro: ['The road climbs into the mountain he calls his own.', 'Every crevice has eyes in it.', 'He will not wait at the top. He will come down to meet you.'],
    outro: ['The road behind you is green all the way back to the city walls.', 'Above the clouds, something vast is waking.'],
    terrain: { kind: 'mountain', amp: 22, hill: 0, edge: 34, rise: 120 },
    atmos: A({ skyTop: 0x1a1f2c, skyMid: 0x5a5260, skyBottom: 0x2a2626, sunColor: 0xffb070, cloud: 0x2c2a34, cloudLit: 0xb08070, glow: 0x5a3020, cover: 0.55, sunDir: [0.6, 0.22, -0.76], sunLight: 0xffc8a0, sunIntensity: 2.0, hemiSky: 0x8890a8, hemiGround: 0x2a2424, hemiIntensity: 0.6, fog: 0x4c4a54, fogDensity: 0.012, exposure: 1.0, fillColor: 0x6a7aa0, fillIntensity: 0.3 }),
    props: { deadTrees: 120, rocks: 200, crags: 70, crevices: 22, pines: true },
    pool: { shade: 1.0, crawler: 0.8, wretch: 0.4, husk: 0.3, brute: 0.14, wraith: 0.14, herald: 0.05 }, density: 1.15,
    ambient: 'snow', wind: [2.0, 0.6],
    devil: { watch: 0, crevice: true }, miniboss: ['serpent', 'cryptid'],
  },
  {
    id: 'peak', title: 'The Peak', latin: 'Culmen', seed: 7757, altars: 3, prayer: 30,
    intro: ['Above the clouds, in the heart of the storm.', 'Lucifer, the Old Serpent, the great Dragon.', 'Exsurgat Deus.'],
    outro: [],
    terrain: { kind: 'peak', amp: 6, hill: 0, edge: 0 },
    atmos: A({ skyTop: 0x030407, skyMid: 0x0e1016, skyBottom: 0x241612, sunColor: 0x8a4a30, cloud: 0x0c0d12, cloudLit: 0x2e3040, glow: 0x4a140a, cover: 0.97, sunDir: [-0.45, 0.5, -0.75], sunLight: 0xa0a8c0, sunIntensity: 2.0, hemiSky: 0x5a6378, hemiGround: 0x30201a, hemiIntensity: 1.25, fog: 0x262832, fogDensity: 0.0038, exposure: 1.55, fillColor: 0x8a3018, fillIntensity: 0.35 }),
    props: { rocks: 70, crags: 40 },
    pool: { shade: 1.0, crawler: 0.8, wraith: 0.2, herald: 0.08 }, density: 1.0,
    ambient: 'embers', wind: [2.2, 0.4],
    boss: 'dragon',
  },
];

// Atmosphere after the land is healed (blended in as altars are cleansed)
export const HEALED = {
  skyTop: 0x3a5a8a, skyMid: 0x8a96a2, skyBottom: 0x4a5444, sunColor: 0xffe0a0, cloud: 0x8a8c94, cloudLit: 0xffe8c8, glow: 0xffc890,
  sunLight: 0xfff0d8, hemiSky: 0xb8c8e0, hemiGround: 0x4a5a30, fog: 0x66707a,
};
