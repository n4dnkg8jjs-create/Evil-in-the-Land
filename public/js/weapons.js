// Weapon models. Each is built along +Y (toward the business end) with its
// edge / blade facing +X; y = 0 is where the right hand grips.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { armorTextures, woodTextures, leatherTextures } from './textures.js';

const PI = Math.PI;
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
  return g.index ? g : g;
}
function idx(g) { if (!g.index) { const n = g.attributes.position.count; const a = []; for (let i = 0; i < n; i++) a.push(i); g.setIndex(a); } return g; }

// Lozenge / diamond-section blade with a fuller, tapering to a point
function blade(len, w0, w1, thick, { fuller = 0.45, ricasso = 0, point = 0.12 } = {}) {
  const segs = 24; const pos = [], uv = [], ind = [];
  // cross-section ring of 6 points: edge+, flat-front-fuller, flat-front, edge-, flat-back...
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; const y = t * len;
    let w = THREE.MathUtils.lerp(w0, w1, t);
    if (t > 1 - point) w *= Math.sqrt(Math.max(0, (1 - t) / point));
    if (y < ricasso) w = w0 * 0.85;
    const th = thick * (1 - t * 0.55) * (t > 1 - point ? Math.sqrt(Math.max(0.05, (1 - t) / point)) : 1);
    const inFuller = t < fuller && y > ricasso + 0.02 ? 1 : 0;
    const f = inFuller ? th * 0.45 : th;
    const ring = [[w, 0], [w * 0.35, th], [0, f], [-w * 0.35, th], [-w, 0], [-w * 0.35, -th], [0, -f], [w * 0.35, -th]];
    for (let k = 0; k < ring.length; k++) { pos.push(ring[k][0], y, ring[k][1]); uv.push(k / 8, t); }
  }
  const R = 8;
  for (let i = 0; i < segs; i++) for (let k = 0; k < R; k++) {
    const a = i * R + k, b = i * R + (k + 1) % R, c = a + R, d = b + R;
    ind.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(ind);
  g.computeVertexNormals();
  return g;
}

function cyl(r0, r1, h, seg = 10) { return new THREE.CylinderGeometry(r1, r0, h, seg); }

function weaponMats(q) {
  const steel = armorTextures('bright', q.tex);
  const wood = woodTextures(256, [88, 60, 36]);
  const lt = leatherTextures();
  return {
    steel: new THREE.MeshStandardMaterial({ map: steel.map, normalMap: steel.normalMap, roughnessMap: steel.roughnessMap, metalnessMap: steel.metalnessMap, metalness: 1, roughness: 0.8, envMapIntensity: 1.4, normalScale: new THREE.Vector2(0.3, 0.3) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, metalness: 1, roughness: 0.45 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, roughnessMap: wood.roughnessMap, roughness: 0.85, metalness: 0 }),
    leather: new THREE.MeshStandardMaterial({ map: lt.map, normalMap: lt.normalMap, roughnessMap: lt.roughnessMap, roughness: 1, metalness: 0 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.9, side: THREE.DoubleSide }),
    // the relics: gold that holds a little light of its own, silver, and the old iron of the lance
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a845, metalness: 1, roughness: 0.28, emissive: 0x3a2400, emissiveIntensity: 0.6 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.32 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x4a4440, metalness: 0.85, roughness: 0.62 }),
    relic: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd890, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.85 }),
  };
}

// ---------------------------------------------------------------- models
const BUILD = {
  longsword() {
    const steel = [], leather = [], dark = [];
    steel.push(xf(blade(0.96, 0.024, 0.012, 0.0065, { fuller: 0.55, point: 0.1 }), [0, 0.07, 0]));
    steel.push(xf(new THREE.BoxGeometry(0.24, 0.016, 0.018), [0, 0.06, 0])); // crossguard
    steel.push(xf(new THREE.SphereGeometry(0.014, 8, 6), [0.12, 0.06, 0])); steel.push(xf(new THREE.SphereGeometry(0.014, 8, 6), [-0.12, 0.06, 0]));
    steel.push(xf(cyl(0.018, 0.024, 0.02, 12), [0, 0.065, 0]));
    leather.push(xf(cyl(0.0205, 0.019, 0.28, 12), [0, -0.08, 0]));
    dark.push(xf(new THREE.TorusGeometry(0.0205, 0.0025, 4, 12), [0, 0.02, 0], [PI / 2, 0, 0]));
    dark.push(xf(new THREE.TorusGeometry(0.0195, 0.0025, 4, 12), [0, -0.12, 0], [PI / 2, 0, 0]));
    steel.push(xf(new THREE.SphereGeometry(0.03, 12, 8), [0, -0.245, 0], [0, 0, 0], [1, 1.25, 0.65])); // wheel pommel
    return { steel, leather, dark };
  },
  zweihander() {
    const steel = [], leather = [], dark = [];
    steel.push(xf(blade(1.22, 0.028, 0.014, 0.007, { fuller: 0.45, ricasso: 0.26, point: 0.08 }), [0, 0.07, 0]));
    leather.push(xf(cyl(0.02, 0.02, 0.16, 12), [0, 0.17, 0])); // leather-wrapped ricasso
    steel.push(xf(new THREE.BoxGeometry(0.42, 0.02, 0.02), [0, 0.06, 0]));
    for (const s of [-1, 1]) {
      steel.push(xf(new THREE.TorusGeometry(0.04, 0.008, 5, 12, PI), [s * 0.2, 0.09, 0], [0, 0, s > 0 ? -PI / 2 : PI / 2]));
      steel.push(xf(new THREE.ConeGeometry(0.01, 0.06, 6), [s * 0.065, 0.32, 0], [0, 0, -s * 1.1])); // parrierhaken
      steel.push(xf(new THREE.SphereGeometry(0.016, 8, 6), [s * 0.21, 0.06, 0]));
    }
    leather.push(xf(cyl(0.0215, 0.02, 0.42, 12), [0, -0.15, 0]));
    steel.push(xf(new THREE.SphereGeometry(0.034, 12, 8), [0, -0.38, 0], [0, 0, 0], [1, 1.4, 1]));
    return { steel, leather, dark };
  },
  mace() {
    const steel = [], leather = [], dark = [];
    steel.push(xf(cyl(0.013, 0.015, 0.5, 10), [0, 0.13, 0]));
    leather.push(xf(cyl(0.0205, 0.0195, 0.14, 12), [0, -0.02, 0]));
    steel.push(xf(cyl(0.022, 0.02, 0.03, 10), [0, -0.1, 0]));
    // seven flanges, each a pointed gothic leaf
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * PI * 2;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.quadraticCurveTo(0.055, 0.03, 0.045, 0.1); shape.lineTo(0.012, 0.15); shape.lineTo(0, 0.15); shape.lineTo(0, 0);
      const fl = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
      xf(fl, [0, 0, -0.003]); xf(fl, [0, 0.36, 0], [0, a, 0]);
      steel.push(fl);
    }
    steel.push(xf(new THREE.ConeGeometry(0.018, 0.05, 8), [0, 0.53, 0]));
    return { steel, leather, dark };
  },
  buckler() {
    const steel = [], leather = [], dark = [];
    const prof = []; for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(t * 0.17, Math.cos(t * PI / 2) * 0.04 + (t > 0.92 ? -(t - 0.92) * 0.2 : 0))); }
    const shield = new THREE.LatheGeometry(prof, 28);
    steel.push(shield);
    steel.push(xf(new THREE.SphereGeometry(0.05, 14, 8, 0, PI * 2, 0, PI / 2), [0, 0.035, 0])); // boss
    steel.push(xf(new THREE.ConeGeometry(0.014, 0.05, 8), [0, 0.1, 0]));
    for (let i = 0; i < 8; i++) { const a = i / 8 * PI * 2; steel.push(xf(new THREE.SphereGeometry(0.007, 6, 4), [Math.cos(a) * 0.14, 0.012, Math.sin(a) * 0.14])); }
    steel.push(xf(new THREE.TorusGeometry(0.17, 0.006, 5, 32), [0, 0.0, 0], [PI / 2, 0, 0]));
    leather.push(xf(new THREE.BoxGeometry(0.12, 0.02, 0.024), [0, -0.035, 0]));
    // turn so the boss faces +Y? Buckler face normal must point along hand -Y (knuckles):
    const all = [...steel, ...leather];
    for (const g of all) xf(g, [0, -0.055, 0], [PI, 0, 0]);
    return { steel, leather, dark };
  },
  halberd() {
    const steel = [], wood = [], leather = [];
    wood.push(xf(cyl(0.0205, 0.019, 1.95, 12), [0, 0.38, 0]));
    // langets running down the shaft
    for (const s of [-1, 1]) steel.push(xf(new THREE.BoxGeometry(0.006, 0.36, 0.018), [0, 1.18, s * 0.018]));
    // axe blade (facing +X), back fluke (-X), top spike
    const ax = new THREE.Shape();
    ax.moveTo(0, -0.05); ax.lineTo(0.06, -0.09); ax.quadraticCurveTo(0.2, -0.06, 0.2, 0.06); ax.quadraticCurveTo(0.21, 0.14, 0.17, 0.2); ax.lineTo(0.05, 0.14); ax.lineTo(0, 0.14);
    const axe = new THREE.ExtrudeGeometry(ax, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1 });
    steel.push(xf(axe, [0.012, 1.38, -0.004]));
    const fk = new THREE.Shape(); fk.moveTo(0, 0); fk.lineTo(-0.14, -0.04); fk.lineTo(-0.02, 0.06); fk.lineTo(0, 0.06);
    steel.push(xf(new THREE.ExtrudeGeometry(fk, { depth: 0.012, bevelEnabled: false }), [-0.012, 1.44, -0.006]));
    steel.push(xf(blade(0.3, 0.02, 0.008, 0.008, { fuller: 0, point: 0.3 }), [0, 1.58, 0]));
    steel.push(xf(cyl(0.022, 0.02, 0.24, 10), [0, 1.46, 0]));
    leather.push(xf(new THREE.CylinderGeometry(0.05, 0.03, 0.06, 10, 1, true), [0, 1.3, 0])); // fringe/rondel cloth
    steel.push(xf(new THREE.ConeGeometry(0.02, 0.06, 8), [0, -0.62, 0], [PI, 0, 0])); // butt cap
    return { steel, wood, leather };
  },
  pike() {
    const steel = [], wood = [];
    wood.push(xf(cyl(0.02, 0.016, 4.1, 10), [0, 0.75, 0]));
    for (const s of [-1, 1]) steel.push(xf(new THREE.BoxGeometry(0.006, 0.5, 0.02), [0, 2.65, s * 0.017]));
    steel.push(xf(blade(0.24, 0.026, 0.01, 0.01, { fuller: 0, point: 0.55 }), [0, 2.82, 0]));
    steel.push(xf(cyl(0.02, 0.016, 0.06, 8), [0, 2.82, 0]));
    steel.push(xf(new THREE.ConeGeometry(0.02, 0.05, 8), [0, -1.32, 0], [PI, 0, 0]));
    return { steel, wood };
  },
  pollaxe() {
    const steel = [], wood = [], brass = [];
    wood.push(xf(cyl(0.021, 0.0195, 1.55, 12), [0, 0.3, 0]));
    for (const s of [-1, 1]) steel.push(xf(new THREE.BoxGeometry(0.006, 0.32, 0.02), [0, 0.96, s * 0.019]));
    // hammer head (+X face crowned with four teeth), fluke (-X), top spike
    steel.push(xf(new THREE.BoxGeometry(0.1, 0.06, 0.06), [0.05, 1.12, 0]));
    for (let a = 0; a < 4; a++) steel.push(xf(new THREE.ConeGeometry(0.014, 0.025, 4), [0.11, 1.12 + (a < 2 ? 0.015 : -0.015), (a % 2 ? 0.015 : -0.015)], [0, 0, -PI / 2]));
    steel.push(xf(new THREE.ConeGeometry(0.025, 0.16, 4), [-0.08, 1.11, 0], [0, 0, PI / 2 + 0.25]));
    steel.push(xf(blade(0.24, 0.018, 0.008, 0.009, { fuller: 0, point: 0.5 }), [0, 1.16, 0]));
    // rondels guarding the hand
    for (const y of [0.18, -0.06]) brass.push(xf(cyl(0.05, 0.05, 0.006, 16), [0, y, 0]));
    steel.push(xf(new THREE.ConeGeometry(0.018, 0.08, 6), [0, -0.5, 0], [PI, 0, 0]));
    return { steel, wood, brass };
  },
  // ---------------------------------------------------------------- the relics (bought dear from the sutler)
  // The Holy Lance: an old leaf-bladed iron spearhead, broken across the middle and bound again with a silver
  // sleeve and a gold one over it; a nail of the Passion is set into the slot down its centre with gold wire,
  // and little brass crosses are hammered into the blade. On a new ash shaft with a gilt socket.
  lance() {
    const wood = [], steel = [], iron = [], gold = [], silver = [], dark = [];
    wood.push(xf(cyl(0.0195, 0.017, 2.34, 12), [0, 0.55, 0]));
    steel.push(xf(new THREE.ConeGeometry(0.02, 0.06, 8), [0, -0.645, 0], [PI, 0, 0]));
    for (const y of [-0.5, 1.45, 1.58]) gold.push(xf(new THREE.TorusGeometry(0.02, 0.0035, 5, 14), [0, y, 0], [PI / 2, 0, 0]));
    // silver wire wound round the hand-hold
    for (let i = 0; i < 18; i++) silver.push(xf(new THREE.TorusGeometry(0.0198, 0.0016, 4, 12), [0, -0.12 + i * 0.016, 0], [PI / 2 + 0.06, 0, 0]));
    // the socket: a gilt collar flaring up into the iron
    gold.push(xf(cyl(0.021, 0.017, 0.14, 12), [0, 1.69, 0]));
    gold.push(xf(new THREE.TorusGeometry(0.019, 0.004, 5, 14), [0, 1.76, 0], [PI / 2, 0, 0]));
    // the leaf blade, dark old iron, with two little wings at its foot
    const leaf = blade(0.4, 0.016, 0.05, 0.007, { fuller: 0, point: 0.5 });
    iron.push(xf(leaf, [0, 1.76, 0]));
    for (const sd of [-1, 1]) { const w = new THREE.Shape(); w.moveTo(0, 0); w.lineTo(sd * 0.042, -0.012); w.lineTo(sd * 0.03, 0.03); w.lineTo(0, 0.05);
      iron.push(xf(new THREE.ExtrudeGeometry(w, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 }), [0, 1.79, -0.003])); }
    // the break, bound: silver sleeve beneath, gold sleeve over it, both flattened to the blade
    silver.push(xf(cyl(0.05, 0.048, 0.1, 18), [0, 1.93, 0], [0, 0, 0], [1, 1, 0.26]));
    gold.push(xf(cyl(0.054, 0.052, 0.07, 18), [0, 1.935, 0], [0, 0, 0], [1, 1, 0.3]));
    for (const y of [1.905, 1.965]) gold.push(xf(new THREE.TorusGeometry(0.053, 0.0025, 4, 20), [0, y, 0], [PI / 2, 0, 0], [1, 0.3, 1]));
    // the nail in its slot, held by turns of gold wire
    dark.push(xf(cyl(0.0042, 0.0032, 0.2, 6), [0, 1.86, 0.0055]));
    dark.push(xf(new THREE.SphereGeometry(0.0075, 8, 6), [0, 1.765, 0.0055], [0, 0, 0], [1, 0.5, 1]));
    for (let i = 0; i < 7; i++) gold.push(xf(new THREE.TorusGeometry(0.0062, 0.0011, 3, 8), [0, 1.8 + i * 0.012, 0.0055], [PI / 2, 0, 0]));
    // brass crosses hammered into the iron, either side of the nail
    for (const sd of [-1, 1]) for (const z of [0.0072, -0.0072]) { gold.push(xf(new THREE.BoxGeometry(0.004, 0.016, 0.0012), [sd * 0.022, 1.86, z])); gold.push(xf(new THREE.BoxGeometry(0.011, 0.004, 0.0012), [sd * 0.022, 1.864, z])); }
    return { wood, steel, iron, gold, silver, dark };
  },
  // Joyeuse: Charlemagne's sword, they say, with a sliver of the Lance in a crystal set into its gold pommel
  joyeuse() {
    const steel = [], gold = [], leather = [], relic = [];
    steel.push(xf(blade(0.94, 0.025, 0.013, 0.0065, { fuller: 0.7, point: 0.1 }), [0, 0.07, 0]));
    // a gold cross with arms bent down toward the blade, ending in knobs
    for (const sd of [-1, 1]) {
      gold.push(xf(new THREE.BoxGeometry(0.1, 0.016, 0.02), [sd * 0.05, 0.062, 0], [0, 0, sd * -0.12]));
      gold.push(xf(new THREE.BoxGeometry(0.03, 0.014, 0.018), [sd * 0.108, 0.078, 0], [0, 0, sd * -0.5]));
      gold.push(xf(new THREE.SphereGeometry(0.014, 10, 8), [sd * 0.122, 0.09, 0]));
    }
    gold.push(xf(cyl(0.02, 0.026, 0.03, 12), [0, 0.065, 0]));
    leather.push(xf(cyl(0.0205, 0.019, 0.24, 12), [0, -0.075, 0]));
    for (let i = 0; i < 13; i++) gold.push(xf(new THREE.TorusGeometry(0.0205, 0.0014, 4, 12), [0, -0.18 + i * 0.018, 0], [PI / 2 + 0.08, 0, 0]));
    // the reliquary pommel: a gold disc, a crystal window front and back, the relic glowing within
    gold.push(xf(cyl(0.038, 0.038, 0.026, 20), [0, -0.235, 0], [PI / 2, 0, 0]));
    gold.push(xf(new THREE.TorusGeometry(0.038, 0.005, 6, 20), [0, -0.235, 0]));
    relic.push(xf(cyl(0.02, 0.02, 0.03, 16), [0, -0.235, 0], [PI / 2, 0, 0]));
    gold.push(xf(new THREE.ConeGeometry(0.01, 0.024, 8), [0, -0.284, 0], [PI, 0, 0]));
    return { steel, gold, leather, relic };
  },
  // the Flamberge of Saint Michael: a two-hander whose blade waves like a flame, the archangel's sword
  flamberge() {
    const steel = [], leather = [], gold = [];
    const bl = blade(1.2, 0.03, 0.015, 0.007, { fuller: 0.35, ricasso: 0.26, point: 0.08 });
    const P = bl.attributes.position;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y < 0.28) continue; const f = Math.min(1, (y - 0.28) / 0.08) * (1 - Math.max(0, (y - 1.05) / 0.15)); P.setX(i, P.getX(i) + Math.sin((y - 0.28) * 34) * 0.0085 * f); }
    bl.computeVertexNormals(); steel.push(xf(bl, [0, 0.07, 0]));
    leather.push(xf(cyl(0.02, 0.02, 0.16, 12), [0, 0.17, 0]));
    gold.push(xf(new THREE.BoxGeometry(0.44, 0.02, 0.022), [0, 0.06, 0]));
    for (const sd of [-1, 1]) {
      gold.push(xf(new THREE.TorusGeometry(0.04, 0.008, 5, 12, PI), [sd * 0.2, 0.09, 0], [0, 0, sd > 0 ? -PI / 2 : PI / 2]));
      gold.push(xf(new THREE.ConeGeometry(0.011, 0.07, 6), [sd * 0.07, 0.33, 0], [0, 0, -sd * 1.1]));
      gold.push(xf(new THREE.SphereGeometry(0.018, 10, 8), [sd * 0.22, 0.06, 0]));
      gold.push(xf(new THREE.TorusGeometry(0.03, 0.005, 5, 14), [sd * 0.0, 0.06, sd * 0.03], [0, 0, 0]));   // side rings
    }
    leather.push(xf(cyl(0.0215, 0.02, 0.42, 12), [0, -0.15, 0]));
    for (let i = 0; i < 4; i++) gold.push(xf(new THREE.TorusGeometry(0.0215, 0.002, 4, 12), [0, -0.33 + i * 0.12, 0], [PI / 2, 0, 0]));
    gold.push(xf(new THREE.SphereGeometry(0.036, 14, 10), [0, -0.385, 0], [0, 0, 0], [1, 1.3, 1]));
    return { steel, leather, gold };
  },
  // the Hammer of Saint Eligius, patron of smiths: a war hammer forged and blessed at his shrine, crowned face and beak
  hammer() {
    const steel = [], leather = [], gold = [], dark = [];
    steel.push(xf(cyl(0.014, 0.016, 0.56, 10), [0, 0.15, 0]));
    for (const sd of [-1, 1]) steel.push(xf(new THREE.BoxGeometry(0.005, 0.22, 0.016), [0, 0.34, sd * 0.016]));
    leather.push(xf(cyl(0.0205, 0.0195, 0.15, 12), [0, -0.03, 0]));
    gold.push(xf(cyl(0.022, 0.02, 0.025, 12), [0, -0.115, 0]));
    gold.push(xf(new THREE.SphereGeometry(0.02, 10, 8), [0, -0.135, 0]));
    // the head: a square hammer crowned with four teeth, a curved beak behind, a spike on top
    steel.push(xf(new THREE.BoxGeometry(0.05, 0.07, 0.05), [0, 0.43, 0]));
    steel.push(xf(new THREE.BoxGeometry(0.06, 0.055, 0.055), [0.055, 0.43, 0]));
    for (let a = 0; a < 4; a++) steel.push(xf(new THREE.ConeGeometry(0.013, 0.022, 4), [0.093, 0.43 + (a < 2 ? 0.014 : -0.014), (a % 2 ? 0.014 : -0.014)], [0, 0, -PI / 2]));
    const bk = new THREE.Shape(); bk.moveTo(0, -0.025); bk.quadraticCurveTo(-0.08, -0.02, -0.13, -0.07); bk.quadraticCurveTo(-0.07, 0.0, 0, 0.025);
    steel.push(xf(new THREE.ExtrudeGeometry(bk, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1 }), [-0.02, 0.43, -0.007]));
    steel.push(xf(new THREE.ConeGeometry(0.016, 0.1, 4), [0, 0.51, 0]));
    // gilt bands with a cross on each face of the socket
    for (const y of [0.395, 0.465]) gold.push(xf(new THREE.BoxGeometry(0.054, 0.006, 0.054), [0, y, 0]));
    for (const sd of [-1, 1]) { gold.push(xf(new THREE.BoxGeometry(0.004, 0.03, 0.002), [0, 0.43, sd * 0.026])); gold.push(xf(new THREE.BoxGeometry(0.018, 0.004, 0.002), [0, 0.436, sd * 0.026])); }
    return { steel, leather, gold, dark };
  },
};

export const WEAPONS = {
  longsword: { butt: 0.28, name: 'Longsword', desc: 'Swift two-handed cuts and a lunging thrust. The knight\'s weapon.', twoHanded: true, leftGrip: -0.16, gripRange: [-0.22, -0.09], roll: [90, 90], hitFrom: 0.12, hitTo: 1.03, kind: 'cut', dmg: 1.0, speed: 1.0, stamina: 1.0, hand: 'two' },
  zweihander: { butt: 0.45, name: 'Zweihänder', desc: 'Huge sweeping arcs that cleave whole ranks. Slow to recover.', twoHanded: true, leftGrip: -0.25, gripRange: [-0.36, -0.14], roll: [90, 90], hitFrom: 0.3, hitTo: 1.3, kind: 'cut', dmg: 1.35, speed: 0.82, stamina: 1.3, hand: 'two' },
  mace: { butt: 0.12, name: 'Flanged Mace & Buckler', desc: 'Fast, crushing blows and a buckler for parries.', twoHanded: false, roll: [80, 90], hitFrom: 0.3, hitTo: 0.55, kind: 'blunt', dmg: 0.95, speed: 1.15, stamina: 0.85, hand: 'one', buckler: true },
  halberd: { butt: 0.62, name: 'Halberd', desc: 'Axe, spike and hook on a long haft. Chop, thrust and sweep.', twoHanded: true, leftGrip: 0.5, gripRange: [0.18, 0.95], roll: [150, 150], hitFrom: 1.25, hitTo: 1.88, kind: 'cut', dmg: 1.15, speed: 0.9, stamina: 1.15, hand: 'pole' },
  pike: { butt: 0.62, name: 'Pike', desc: 'Four metres of ash. Thrusts skewer several demons in a line.', twoHanded: true, leftGrip: 0.62, gripRange: [0.28, 1.15], roll: [150, 150], hitFrom: 2.0, hitTo: 3.06, kind: 'pierce', dmg: 0.95, speed: 1.05, stamina: 0.9, hand: 'pole' },
  pollaxe: { butt: 0.62, name: 'Pollaxe', desc: 'Hammer, fluke and spike. Breaks the hide of the great ones.', twoHanded: true, leftGrip: 0.45, gripRange: [0.16, 0.8], roll: [150, 150], hitFrom: 0.95, hitTo: 1.28, kind: 'blunt', dmg: 1.2, speed: 0.92, stamina: 1.1, hand: 'pole', armorBreak: 1.6 },
  // relics: never in the starting armoury, bought only from the sutler for a great deal of silver.
  // 'base' borrows the moves of an ordinary weapon; 'holy' burns demons it strikes; the rest are their own gifts.
  lance: { base: 'pike', legendary: true, price: 3000, name: 'The Holy Lance', lore: 'The hasta of Longinus, that pierced the side of Christ. Broken, bound in silver and gold, a nail of the Passion set in its blade.', desc: 'Thrusts of terrible holy force that set demons burning. A charged thrust runs through every demon in the line. It glows faintly gold.', butt: 0.62, twoHanded: true, leftGrip: 0.55, gripRange: [0.22, 0.95], roll: [150, 150], hitFrom: 1.55, hitTo: 2.17, kind: 'pierce', dmg: 1.5, speed: 1.08, stamina: 0.85, hand: 'pole', holy: 1, pierceAll: true, glow: [1, 0.85, 0.45] },
  joyeuse: { base: 'longsword', legendary: true, price: 1800, name: 'Joyeuse', lore: 'Charlemagne\'s sword, the old songs say, with a sliver of the Lance sealed in the crystal of its pommel.', desc: 'A longsword that cuts true and burns the unholy. Every demon it banishes gives back a little of your strength.', butt: 0.29, twoHanded: true, leftGrip: -0.15, gripRange: [-0.21, -0.09], roll: [90, 90], hitFrom: 0.12, hitTo: 1.01, kind: 'cut', dmg: 1.3, speed: 1.05, stamina: 0.95, hand: 'two', holy: 0.5, lifeSteal: 4, glow: [1, 0.9, 0.6] },
  flamberge: { base: 'zweihander', legendary: true, price: 2400, name: 'Flamberge of St Michael', lore: 'The archangel\'s blade, its edge waved like a flame. It was carried before the host that threw down the Dragon.', desc: 'A flame-bladed two-hander. Its wounds tear and keep burning, and its heavy blows leave holy fire on the ground.', butt: 0.47, twoHanded: true, leftGrip: -0.25, gripRange: [-0.36, -0.14], roll: [90, 90], hitFrom: 0.3, hitTo: 1.28, kind: 'cut', dmg: 1.65, speed: 0.85, stamina: 1.25, hand: 'two', holy: 0.8, fireHeavy: true, glow: [1, 0.6, 0.25] },
  hammer: { base: 'mace', legendary: true, price: 1500, name: 'Hammer of St Eligius', lore: 'Forged at the shrine of the smiths\' saint and blessed on his feast. The great ones break under it.', desc: 'A war hammer with a buckler. Crushes the hides of the great demons, staggers them hard, and each heavy blow rings out in a wave of holy force.', butt: 0.14, twoHanded: false, roll: [80, 90], hitFrom: 0.33, hitTo: 0.56, kind: 'blunt', dmg: 1.25, speed: 1.1, stamina: 0.85, hand: 'one', buckler: true, armorBreak: 2.2, holy: 0.4, shockHeavy: true, glow: [0.9, 0.85, 1] },
};

let _mats = null;
export function buildWeapon(key, quality) {
  if (!_mats) _mats = weaponMats(quality);
  const parts = BUILD[key]();
  const g = new THREE.Group();
  for (const m in parts) {
    if (!parts[m].length) continue;
    for (const geo of parts[m]) for (const n in geo.attributes) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
    const merged = mergeGeometries(parts[m].map(idx));
    const mesh = new THREE.Mesh(merged, _mats[m]); mesh.castShadow = true;
    g.add(mesh);
  }
  return g;
}
