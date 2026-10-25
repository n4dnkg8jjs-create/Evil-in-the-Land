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
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// a lathe from [radius, y] pairs, upright along +Y
function lathe(pts, seg = 12) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
// a blade (or sleeve) from a half-width profile w(t) and half-thickness th(t), t = 0..1 along +Y.
// Bevelled edges, an optional fuller [t0, t1] or raised midrib, an optional sideways wave(t) for flame blades.
function shapedBlade(len, w, th, { fuller = null, rib = 0, wave = null, segs = 64, point = true, ring = 'blade' } = {}) {
  const pos = [], uv = [], ind = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, y = t * len; const W = Math.max(point && i === segs ? 0.0004 : 0.0006, w(t)), T = Math.max(0.0005, th(t)), dx = wave ? wave(t) : 0;
    let c = T; if (fuller && t > fuller[0] && t < fuller[1]) { const e = Math.min(1, (t - fuller[0]) * 40, (fuller[1] - t) * 40); c = T * (1 - 0.55 * e); } if (rib) c = T * rib;
    const R = ring === 'flat'
      ? [[W, 0], [W * 0.9, T * 0.8], [W * 0.5, T], [0, T], [-W * 0.5, T], [-W * 0.9, T * 0.8], [-W, 0], [-W * 0.9, -T * 0.8], [-W * 0.5, -T], [0, -T], [W * 0.5, -T], [W * 0.9, -T * 0.8]]
      : [[W, 0], [W * 0.7, T * 0.55], [W * 0.3, T], [0, c], [-W * 0.3, T], [-W * 0.7, T * 0.55], [-W, 0], [-W * 0.7, -T * 0.55], [-W * 0.3, -T], [0, -c], [W * 0.3, -T], [W * 0.7, -T * 0.55]];
    for (let k = 0; k < R.length; k++) { pos.push(R[k][0] + dx, y, R[k][1]); uv.push(k / R.length, t); }
  }
  const N = 12;
  for (let i = 0; i < segs; i++) for (let k = 0; k < N; k++) { const a = i * N + k, b = i * N + (k + 1) % N, c = a + N, d = b + N; ind.push(a, c, b, b, c, d); }
  if (!point) { // close both ends
    const base = pos.length / 3; pos.push(0, 0, 0, 0, len, 0); uv.push(0.5, 0, 0.5, 1);
    for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; ind.push(base, k, k1); ind.push(base + 1, segs * N + k1, segs * N + k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
  g.computeVertexNormals(); return g;
}
// a tube swept along points with a tapering radius r(t); sz squashes it across the curve's binormal
function sweep(pts, r, { seg = 8, n = 0, sz = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts); const steps = n || Math.max(8, pts.length * 8);
  const fr = curve.computeFrenetFrames(steps, false); const pos = [], uv = [], ind = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, P = curve.getPointAt(t), N = fr.normals[i], B = fr.binormals[i], rr = r(t);
    for (let k = 0; k < seg; k++) { const a = k / seg * PI * 2; const cx = Math.cos(a) * rr, cy = Math.sin(a) * rr * sz; pos.push(P.x + N.x * cx + B.x * cy, P.y + N.y * cx + B.y * cy, P.z + N.z * cx + B.z * cy); uv.push(k / seg, t); }
  }
  for (let i = 0; i < steps; i++) for (let k = 0; k < seg; k++) { const a = i * seg + k, b = i * seg + (k + 1) % seg, c = a + seg, d = b + seg; ind.push(a, b, c, b, d, c); }
  // caps
  const P0 = curve.getPointAt(0), P1 = curve.getPointAt(1), base = pos.length / 3; pos.push(P0.x, P0.y, P0.z, P1.x, P1.y, P1.z); uv.push(0, 0, 0, 1);
  for (let k = 0; k < seg; k++) { const k1 = (k + 1) % seg; ind.push(base, k1, k); ind.push(base + 1, steps * seg + k, steps * seg + k1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind);
  g.computeVertexNormals(); return g;
}

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
    // the relics: real gilt (warm, a little worn), silver, the old dark steel of the Lance, blackened steel with gilt
    gold: new THREE.MeshStandardMaterial({ color: 0xd8b062, metalness: 1, roughness: 0.3, roughnessMap: steel.roughnessMap, normalMap: steel.normalMap, normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.5 }),
    silver: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.26, roughnessMap: steel.roughnessMap, normalMap: steel.normalMap, normalScale: new THREE.Vector2(0.2, 0.2), envMapIntensity: 1.4 }),
    oldsteel: new THREE.MeshStandardMaterial({ map: steel.map, normalMap: steel.normalMap, roughnessMap: steel.roughnessMap, color: 0xb0a89e, metalness: 0.75, roughness: 0.62, envMapIntensity: 1.6, normalScale: new THREE.Vector2(0.5, 0.5) }),
    black: new THREE.MeshStandardMaterial({ map: steel.map, normalMap: steel.normalMap, roughnessMap: steel.roughnessMap, color: 0x4a4644, metalness: 1, roughness: 0.6, envMapIntensity: 1.4, normalScale: new THREE.Vector2(0.4, 0.4) }),
    relic: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffd890, emissiveIntensity: 1.2, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.9 }),
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
  // The Holy Lance, after the one kept in Vienna: a long, slender leaf of old dark steel with a raised midrib and two
  // small wings at its foot; across the middle, where it once broke, a silver sleeve and a shorter gold one over it;
  // a nail of the Passion laid along the face under the sleeves, bound with gold wire; a wire-bound socket on ash.
  lance() {
    const wood = [], oldsteel = [], gold = [], silver = [], dark = [], leather = [];
    wood.push(xf(cyl(0.0195, 0.0172, 2.3, 14), [0, 0.53, 0]));
    oldsteel.push(xf(lathe([[0, -0.07], [0.012, -0.065], [0.019, -0.04], [0.02, 0]], 12), [0, -0.62, 0]));      // butt shoe
    leather.push(xf(cyl(0.0212, 0.0212, 0.3, 14), [0, 0.02, 0]));
    for (const y of [-0.13, 0.17]) gold.push(xf(new THREE.TorusGeometry(0.0212, 0.0026, 5, 16), [0, y, 0], [PI / 2, 0, 0]));
    // socket: a tapering octagonal iron tube, bound in gold wire top and bottom
    oldsteel.push(xf(lathe([[0.0205, 0], [0.0198, 0.06], [0.0165, 0.13], [0.0125, 0.17], [0.009, 0.185]], 8), [0, 1.6, 0]));
    for (let i = 0; i < 6; i++) gold.push(xf(new THREE.TorusGeometry(0.0204 - i * 0.0002, 0.0013, 4, 14), [0, 1.605 + i * 0.0045, 0], [PI / 2, 0, 0]));
    for (let i = 0; i < 5; i++) gold.push(xf(new THREE.TorusGeometry(0.0158 - i * 0.0004, 0.0012, 4, 12), [0, 1.735 + i * 0.004, 0], [PI / 2, 0, 0]));
    // the leaf: narrow neck, widest a third of the way up, a long fine point
    const Y0 = 1.78, LEN = 0.52;
    const lw = (t) => t < 0.36 ? 0.007 + 0.025 * Math.sin((t / 0.36) * PI / 2) : 0.032 * Math.pow((1 - t) / 0.64, 0.9);
    oldsteel.push(xf(shapedBlade(LEN, lw, (t) => 0.0034 * (1 - 0.5 * t), { rib: 1.9 }), [0, Y0, 0]));
    // the two little wings at its foot, flattened in the blade's plane
    for (const sd of [-1, 1]) {
      const w = new THREE.Shape(); w.moveTo(0, 0); w.quadraticCurveTo(sd * 0.03, -0.004, sd * 0.034, -0.026); w.quadraticCurveTo(sd * 0.018, -0.006, 0, 0.018);
      oldsteel.push(xf(new THREE.ExtrudeGeometry(w, { depth: 0.0036, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 }), [sd * 0.006, Y0 + 0.05, -0.0018]));
    }
    // the nail, square in section, laid along the front face below the sleeves and bound in gold wire
    const nail = new THREE.CylinderGeometry(0.0021, 0.0034, 0.17, 4); nail.rotateY(PI / 4);
    dark.push(xf(nail, [0, Y0 + 0.13, 0.0072]));
    dark.push(xf(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0025, 10), [0, Y0 + 0.045, 0.0072]));
    for (let i = 0; i < 4; i++) gold.push(xf(new THREE.TorusGeometry(0.0045, 0.0009, 3, 10), [0, Y0 + 0.07 + i * 0.026, 0.0062], [PI / 2, 0, 0], [1, 1, 0.9]));
    // the sleeves: flat lozenge tubes that hug the blade where it broke; silver beneath, a narrower gold band over it
    const sy0 = 0.37, sy1 = 0.6;
    silver.push(xf(shapedBlade(LEN * (sy1 - sy0), (u) => lw(sy0 + u * (sy1 - sy0)) + 0.0032, () => 0.0105, { point: false, segs: 10, ring: 'flat' }), [0, Y0 + LEN * sy0, 0]));
    const gy0 = 0.43, gy1 = 0.54;
    gold.push(xf(shapedBlade(LEN * (gy1 - gy0), (u) => lw(gy0 + u * (gy1 - gy0)) + 0.0058, () => 0.0126, { point: false, segs: 6, ring: 'flat' }), [0, Y0 + LEN * gy0, 0]));
    for (const u of [gy0, gy1]) gold.push(xf(shapedBlade(0.004, () => lw(u) + 0.0068, () => 0.0136, { point: false, segs: 1, ring: 'flat' }), [0, Y0 + LEN * u - 0.002, 0]));
    // little crosses chased into the steel above the sleeves
    for (const z of [0.0049, -0.0049]) { gold.push(xf(new THREE.BoxGeometry(0.0022, 0.014, 0.0008), [0, Y0 + LEN * 0.66, z])); gold.push(xf(new THREE.BoxGeometry(0.009, 0.0022, 0.0008), [0, Y0 + LEN * 0.66 + 0.003, z])); }
    return { wood, oldsteel, gold, silver, dark, leather };
  },
  // Joyeuse, after the sword in the Louvre: a gilt cross whose arms sweep toward the blade and end in little beast
  // heads, a grip bound in a lattice of gold wire, and a two-lobed pommel with a crystal over a relic of the Lance.
  joyeuse() {
    const steel = [], gold = [], leather = [], relic = [];
    steel.push(xf(shapedBlade(0.94, (t) => THREE.MathUtils.lerp(0.025, 0.012, t) * (t > 0.88 ? Math.sqrt((1 - t) / 0.12) : 1), (t) => 0.0062 * (1 - 0.5 * t), { fuller: [0.03, 0.7] }), [0, 0.07, 0]));
    // the cross: two tapering arms bending up toward the blade, each ending in a small head with an open mouth
    for (const sd of [-1, 1]) {
      const pts = [V3(0, 0.062, 0), V3(sd * 0.045, 0.064, 0), V3(sd * 0.085, 0.074, 0), V3(sd * 0.112, 0.094, 0)];
      gold.push(sweep(pts, (t) => 0.0105 - 0.004 * t, { seg: 8, sz: 0.85 }));
      gold.push(xf(new THREE.SphereGeometry(0.0105, 12, 8), [sd * 0.116, 0.1, 0], [0, 0, -sd * 0.6], [1, 1.35, 0.85]));
      gold.push(xf(new THREE.ConeGeometry(0.0065, 0.02, 8), [sd * 0.124, 0.115, 0], [0, 0, -sd * 0.55]));
      for (const z of [-1, 1]) relic.push(xf(new THREE.SphereGeometry(0.0022, 6, 4), [sd * 0.118, 0.104, z * 0.0075]));
    }
    // the écusson over the blade's root
    gold.push(xf(lathe([[0, 0], [0.024, 0.003], [0.02, 0.026], [0.0, 0.036]], 4), [0, 0.056, 0], [0, PI / 4, 0], [1, 1, 0.45]));
    leather.push(xf(cyl(0.0198, 0.0186, 0.235, 14), [0, -0.075, 0]));
    // gold wire lattice over the grip: two counter-wound helices
    for (const dir of [-1, 1]) { const pts = []; for (let i = 0; i <= 60; i++) { const t = i / 60, a = dir * t * PI * 2 * 5; pts.push(V3(Math.cos(a) * 0.0202, -0.19 + t * 0.23, Math.sin(a) * 0.0202)); } gold.push(sweep(pts, () => 0.0011, { seg: 4 })); }
    for (const y of [-0.19, 0.042]) gold.push(xf(new THREE.TorusGeometry(0.0205, 0.0026, 5, 16), [0, y, 0], [PI / 2, 0, 0]));
    // the pommel: a neck, two lobes like folded wings, a crystal boss on each face over the glowing relic
    gold.push(xf(lathe([[0.016, 0], [0.02, -0.008], [0.013, -0.016]], 12), [0, -0.192, 0]));
    gold.push(xf(new THREE.SphereGeometry(0.03, 18, 12), [0, -0.24, 0], [0, 0, 0], [1.25, 0.92, 0.52]));
    for (const sd of [-1, 1]) gold.push(xf(new THREE.SphereGeometry(0.017, 12, 8), [sd * 0.03, -0.25, 0], [0, 0, 0], [1, 1.2, 0.75]));
    relic.push(xf(new THREE.SphereGeometry(0.012, 14, 10), [0, -0.24, 0], [0, 0, 0], [1, 1, 1.45]));
    gold.push(xf(new THREE.TorusGeometry(0.0128, 0.0018, 5, 16), [0, -0.24, 0.0135])); gold.push(xf(new THREE.TorusGeometry(0.0128, 0.0018, 5, 16), [0, -0.24, -0.0135]));
    gold.push(xf(new THREE.SphereGeometry(0.006, 8, 6), [0, -0.276, 0]));
    return { steel, gold, leather, relic };
  },
  // the Flamberge of Saint Michael: a two-hander whose blade waves like a flame; blackened guard with gilt,
  // long S-curved quillons, side rings, parrying hooks at the ricasso, and a long grip with a pear pommel
  flamberge() {
    const steel = [], leather = [], gold = [], black = [];
    const fw = (t) => { const y = t * 1.22; let w = y < 0.26 ? 0.019 : THREE.MathUtils.lerp(0.031, 0.016, (y - 0.26) / 0.96); if (t > 0.9) w *= Math.sqrt((1 - t) / 0.1); return w; };
    const wave = (t) => { const y = t * 1.22; if (y < 0.29) return 0; const f = Math.min(1, (y - 0.29) / 0.05) * (1 - Math.max(0, (t - 0.84) / 0.16)); return Math.sin((y - 0.29) * 46) * 0.0072 * f; };
    steel.push(xf(shapedBlade(1.22, fw, (t) => 0.0068 * (1 - 0.45 * t), { fuller: [0.28, 0.62], wave, segs: 120 }), [0, 0.07, 0]));
    leather.push(xf(cyl(0.0205, 0.0205, 0.15, 14), [0, 0.17, 0]));                                                     // leather-bound ricasso
    for (const y of [0.093, 0.247]) gold.push(xf(new THREE.TorusGeometry(0.021, 0.0022, 5, 16), [0, y, 0], [PI / 2, 0, 0]));
    // the guard
    black.push(xf(lathe([[0, -0.012], [0.03, -0.01], [0.034, 0.0], [0.03, 0.012], [0, 0.014]], 8), [0, 0.062, 0], [0, PI / 8, 0], [1, 1, 0.75]));
    for (const sd of [-1, 1]) {
      const q = [V3(0, 0.062, 0), V3(sd * 0.09, 0.06, 0), V3(sd * 0.17, 0.07, 0), V3(sd * 0.215, 0.1, 0), V3(sd * 0.226, 0.135, 0)];
      black.push(sweep(q, (t) => 0.0115 - 0.0045 * t, { seg: 8 }));
      gold.push(xf(new THREE.SphereGeometry(0.0125, 12, 8), [sd * 0.226, 0.142, 0], [0, 0, 0], [1, 1.3, 1]));
      gold.push(xf(new THREE.TorusGeometry(0.0118, 0.0018, 4, 14), [sd * 0.226, 0.13, 0], [PI / 2, 0, 0]));
      // side rings, standing out from the faces of the guard
      black.push(xf(new THREE.TorusGeometry(0.036, 0.0058, 6, 22), [0, 0.07, sd * 0.038], [0, PI / 2, 0]));
      // parrying hooks at the top of the ricasso, curling back toward the hands
      const h = [V3(sd * 0.018, 0.255, 0), V3(sd * 0.05, 0.262, 0), V3(sd * 0.075, 0.245, 0), V3(sd * 0.078, 0.22, 0)];
      black.push(sweep(h, (t) => 0.0068 - 0.0045 * t, { seg: 6 }));
    }
    leather.push(xf(lathe([[0.0195, 0], [0.0225, 0.12], [0.023, 0.21], [0.0215, 0.3], [0.019, 0.42]], 14), [0, -0.36, 0]));
    for (let i = 0; i < 5; i++) gold.push(xf(new THREE.TorusGeometry(0.0222, 0.0016, 4, 14), [0, -0.33 + i * 0.075, 0], [PI / 2, 0, 0]));
    black.push(xf(lathe([[0.012, 0.0], [0.03, -0.03], [0.034, -0.06], [0.024, -0.085], [0.006, -0.1], [0, -0.104]], 16), [0, -0.355, 0]));
    gold.push(xf(new THREE.TorusGeometry(0.033, 0.0028, 5, 20), [0, -0.405, 0], [PI / 2, 0, 0]));
    return { steel, leather, gold, black };
  },
  // the Hammer of Saint Eligius, patron of smiths: a horseman's war hammer, its octagonal face crowned with four
  // teeth, a long curved beak behind, a square spike above, steel langets down an iron haft, gilt bands and crosses
  hammer() {
    const steel = [], leather = [], gold = [], black = [];
    steel.push(xf(cyl(0.0125, 0.0145, 0.56, 8), [0, 0.15, 0], [0, PI / 8, 0]));
    for (const sd of [-1, 1]) steel.push(xf(new THREE.BoxGeometry(0.0045, 0.2, 0.012), [0, 0.33, sd * 0.0145]));
    leather.push(xf(lathe([[0.019, 0], [0.0212, 0.07], [0.0198, 0.15]], 14), [0, -0.105, 0]));
    steel.push(xf(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 20), [0, 0.06, 0]));                                    // rondel over the hand
    gold.push(xf(new THREE.TorusGeometry(0.036, 0.002, 4, 24), [0, 0.06, 0], [PI / 2, 0, 0]));
    steel.push(xf(lathe([[0, 0], [0.022, -0.005], [0.024, -0.02], [0.012, -0.034], [0, -0.038]], 12), [0, -0.105, 0]));
    // the socket block with chamfered corners
    steel.push(xf(lathe([[0.02, -0.042], [0.026, -0.036], [0.026, 0.036], [0.02, 0.042]], 8), [0, 0.43, 0], [0, PI / 8, 0]));
    // the hammer: an octagonal neck widening to a face crowned with four pyramids
    const hm = lathe([[0.017, 0], [0.019, 0.03], [0.026, 0.058], [0.026, 0.066]], 8); hm.rotateY(PI / 8);
    steel.push(xf(hm, [0.02, 0.43, 0], [0, 0, -PI / 2]));
    for (let a = 0; a < 4; a++) steel.push(xf(new THREE.ConeGeometry(0.011, 0.016, 4), [0.093, 0.43 + (a < 2 ? 0.011 : -0.011), (a % 2 ? 0.011 : -0.011)], [0, 0, -PI / 2]));
    // the beak: long, square-ish, curving down to a point
    steel.push(sweep([V3(-0.02, 0.43, 0), V3(-0.07, 0.428, 0), V3(-0.12, 0.41, 0), V3(-0.16, 0.37, 0)], (t) => 0.016 * Math.pow(1 - t, 0.8) + 0.0012, { seg: 4, sz: 0.8 }));
    // the top spike, square in section
    const sp = new THREE.ConeGeometry(0.014, 0.12, 4); sp.rotateY(PI / 4); steel.push(xf(sp, [0, 0.532, 0]));
    // gilt bands and a cross on each face of the socket
    for (const y of [0.39, 0.47]) gold.push(xf(lathe([[0.0272, -0.003], [0.0272, 0.003]], 8), [0, y, 0], [0, PI / 8, 0]));
    for (const sd of [-1, 1]) { gold.push(xf(new THREE.BoxGeometry(0.0035, 0.032, 0.0016), [0, 0.43, sd * 0.0245])); gold.push(xf(new THREE.BoxGeometry(0.016, 0.0035, 0.0016), [0, 0.437, sd * 0.0245])); }
    return { steel, leather, gold, black };
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
