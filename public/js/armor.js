// Articulated plate harness, built piece by piece around the rig.
// Three period styles (c. 1480–1530):
//   gothic     — German Gothic: rippled flutes, sallet & bevor, pointed sabatons
//   maximilian — fluted "Maximilian": bellows-visor armet, haute-pieces, bear-paw toes
//   milanese   — smooth Italian: armet with rondel, large asymmetric pauldrons
// Lames that cross a joint are mounted on "followers" which take a fraction
// of the next joint's rotation, so they fan and slide like real articulations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { armorTextures, mailTextures, clothTextures, leatherTextures, featherTexture, FINISHES } from './textures.js';
import { clamp, lerp, smooth } from './util.js';
import { field } from './body.js';

const PI = Math.PI;

export const STYLES = {
  gothic:     { name: 'Gothic',     desc: 'Light, rippled steel. Fast footwork, quick recovery.', speed: 1.08, armor: 0.85, stamina: 1.18, flutes: 22, fluteDepth: 0.0045, pointedToe: true, helm: 'sallet', pauldron: 0.95, haute: false },
  maximilian: { name: 'Maximilian', desc: 'Fluted plate, balanced protection and pace.', speed: 1.0, armor: 1.0, stamina: 1.0, flutes: 30, fluteDepth: 0.003, bearPaw: true, helm: 'bellows', pauldron: 1.05, haute: true },
  milanese:   { name: 'Milanese',   desc: 'Smooth, heavy Italian plate. Slow, nearly unbreakable.', speed: 0.92, armor: 1.22, stamina: 0.9, flutes: 0, fluteDepth: 0, roundToe: true, helm: 'armet', pauldron: 1.2, haute: true, grandGuard: true },
};

// ---------------------------------------------------------------- geometry helpers
function surf(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv; const p = fn(u, v);
    pos.push(p[0], p[1], p[2]); uv.push(u, v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // UVs in real-world scale (one texture tile = 0.5 m) so etching and polish keep their size on every plate
  const len = (f) => { let L = 0, q = f(0); for (let k = 1; k <= 8; k++) { const r = f(k / 8); L += Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]); q = r; } return L; };
  const Lu = len((t) => fn(t, 0.5)) / 0.5, Lv = len((t) => fn(0.5, t)) / 0.5;
  for (let i = 0; i < uv.length; i += 2) { uv[i] *= Lu; uv[i + 1] *= Lv; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Rolled edge along one boundary of a surface
function edge(fn, which, r = 0.0055, n = 32) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n; const p = which === 'v0' ? fn(t, 0) : which === 'v1' ? fn(t, 1) : which === 'u0' ? fn(0, t) : fn(1, t);
    pts.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, r, 5, false);
}
function tubeAlong(points, r, seg = 24, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), seg, r, radial, false);
}
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), new THREE.Vector3(...s));
  g.applyMatrix4(m); return g;
}
function rivet(p, r = 0.0055) { return xf(new THREE.SphereGeometry(r, 6, 4, 0, PI * 2, 0, PI / 2), { p, r: [0, 0, 0] }); }
// rivet placed on a surface point, oriented along local normal (approx using provided outward dir)
function rivetOut(p, dir, r = 0.0055) {
  const g = new THREE.SphereGeometry(r, 6, 4, 0, PI * 2, 0, PI / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// Generic elliptical shell around a vertical axis (local y), front at +Z.
//  a0..a1: angle range (radians, 0 = front), y0..y1: height range,
//  rx(v), rz(v): radii, extra(theta, v): radial offset (ridges, flutes)
function shell({ a0, a1, y0, y1, rx, rz, extra, nu = 40, nv = 16, cx = 0, cz = 0, aOfV, yOfU }) {
  const fn = (u, v) => {
    let A0 = a0, A1 = a1;
    if (aOfV) [A0, A1] = aOfV(v);
    const th = lerp(A0, A1, u);
    let y = lerp(y0, y1, v); if (yOfU) y += yOfU(th, v);
    const ex = extra ? extra(th, v) : 0;
    const X = (rx(v) + ex) * Math.sin(th), Z = (rz(v) + ex) * Math.cos(th);
    return [cx + X, y, cz + Z];
  };
  return { fn, geo: surf(fn, nu, nv) };
}
function flute(style, scale = 1) {
  if (!style.flutes) return null;
  return (th, v) => {
    const f = Math.sin(th * style.flutes * scale) * style.fluteDepth;
    const fade = smooth(clamp(v * 3, 0, 1)) * smooth(clamp((1 - v) * 3, 0, 1));
    return f * fade;
  };
}

// ---------------------------------------------------------------- body-fitted surfaces
// Plates are shaped from the MakeHuman body's cross-sections (body.js), so every
// piece sits where a real armourer would have fitted it. If the body asset is
// missing, plain ellipses of similar size stand in.
function ellipseField(rx, rz, cz = 0) {
  return {
    r: (th, y) => { const a = rx(y), b = rz(y); return (a * b) / Math.hypot(b * Math.sin(th), a * Math.cos(th)); },
    centre: () => [0, cz],
    at(th, y, off = 0) { const r = this.r(th, y) + off; return [Math.sin(th) * r, cz + Math.cos(th) * r]; },
  };
}
const FALLBACK = {
  torso: ellipseField((y) => lerp(0.14, 0.17, smooth(clamp((y + 0.2) / 0.3, 0, 1))), (y) => lerp(0.1, 0.12, smooth(clamp((y + 0.2) / 0.3, 0, 1))), 0.04),
  neck: ellipseField(() => 0.05, () => 0.045, 0.01),
  uArm: ellipseField(() => 0.05, () => 0.05), fArm: ellipseField((y) => lerp(0.028, 0.042, (y + 0.27) / 0.27), (y) => lerp(0.026, 0.04, (y + 0.27) / 0.27)),
  thigh: ellipseField((y) => lerp(0.06, 0.088, (y + 0.45) / 0.45), (y) => lerp(0.06, 0.088, (y + 0.45) / 0.45)),
  shin: ellipseField((y) => lerp(0.035, 0.055, smooth((y + 0.43) / 0.43)), (y) => lerp(0.035, 0.06, smooth((y + 0.43) / 0.43))),
};
function F(name) { return field(name) || FALLBACK[name.replace(/[RL]$/, '')]; }
// radius averaged over a small height window: plate is raised smooth, not wrapped over every muscle
function rSmooth(f, th, y, w) { if (!w) return f.r(th, y); return (f.r(th, y - w) + 2 * f.r(th, y) + f.r(th, y + w)) * 0.25; }
// A plate on the body: u sweeps the angle, v the height. Coordinates are in the
// mounting joint's frame; the field is sampled at (y + dy) and its z shifted by dz,
// x by dx (for pieces hung from a parent joint).
function fshell(f, { a0, a1, y0, y1, off, aOfV, yOfU, nu = 32, nv = 12, dy = 0, dz = 0, dx = 0, yLo = -9, yHi = 9, win = 0.025, rMax = 0, slope = 0 }) {
  const fn = (u, v) => {
    let A0 = a0, A1 = a1; if (aOfV) [A0, A1] = aOfV(v);
    const th = lerp(A0, A1, u);
    let y = lerp(y0, y1, v); if (yOfU) y += yOfU(th, v);
    const yf = clamp(y + dy, yLo, yHi);
    const c = f.centre(yf);
    let r = rSmooth(f, th, yf, win);
    if (slope) { for (let k = -6; k <= 6; k++) { if (!k) continue; const y2 = clamp(yf + k * 0.03, Math.max(yLo, y0 + dy), Math.min(yHi, y1 + dy)); r = Math.max(r, rSmooth(f, th, y2, win) - slope * Math.abs(y2 - yf)); } }
    if (rMax) { for (let k = 1; k <= 4; k++) r = Math.max(r, rSmooth(f, th, clamp(yf + k * rMax / 4, yLo, yHi), win)); }
    r += typeof off === 'function' ? off(th, v, y) : off;
    return [dx + c[0] + Math.sin(th) * r, y, dz + c[1] + Math.cos(th) * r];
  };
  return { fn, geo: surf(fn, nu, nv) };
}

// ---------------------------------------------------------------- the harness
// Each part: { joint, follow?: {joint, k, pivot}, mat, geo }
// Joint offsets used to move between frames (keep in sync with rig.js SKEL)
const SPINE_TO_CHEST = 0.22, HIPS_TO_SPINE = [0.10, -0.01], CLAV_TO_SHOULDER = 0.165, HIP_X = 0.10, HIP_Y = -0.06;
// ---------------------------------------------------------------- gauntlets
// Proportioned on the MakeHuman hand (measured in the hand bone's frame: palm ~0.09 long and ~0.1 across at the
// knuckles, four fingers ~0.022 apart, index toward +z, the back of the hand on the side sx, the thumb on the palm
// side). The weapon's grip runs along the hand's z axis through (0, -LEN.grip, 0) (see rig.gripArm), so in the 'grip'
// set each finger curls round that line in a circle; the 'open' set has the fingers straight and together (the
// sign of the cross). Each finger: a leather glove finger, and three overlapping plates (proximal, middle, a capped
// fingertip) with a raised medial ridge; the thumb the same in two plates; over the back of the hand three lames
// and a knuckle plate with bosses over each knuckle; a flared cuff with a rolled edge; rivets.
const GRIP_Y = -0.08, GRIP_R = 0.0272;
const FINGERS = [   // z of each finger, radius of the glove finger, how far it curls (index, middle, ring, little)
  { z: 0.027, r: 0.0088, k: 0.95 }, { z: 0.005, r: 0.0092, k: 1.0 }, { z: -0.017, r: 0.0088, k: 0.96 }, { z: -0.038, r: 0.0078, k: 0.84 },
];
// a plate round part of a finger: fn(s) gives the finger's centreline point and its 'back' direction at s (0 at the
// knuckle, 1 at the tip); the plate covers s0..s1, wrapping phi = ±wrap round the back; cap closes the tip
function fingerPlate(fn, s0, s1, rp, { wrap = 1.75, cap = false, flare = 0.08 } = {}) {
  const V3 = THREE.Vector3;
  const frame = (sv) => {
    const [c, n] = fn(sv), [c2] = fn(Math.min(1, sv + 0.01)), [c1] = fn(Math.max(0, sv - 0.01));
    const t = new V3(...c2).sub(new V3(...c1)).normalize(), nn = new V3(...n); nn.addScaledVector(t, -nn.dot(t)).normalize();
    return { c: new V3(...c), t, n: nn, b: new V3().crossVectors(t, nn) };
  };
  return surf((u, v) => {
    const sv = lerp(s0, s1, v), F = frame(sv), ph = lerp(-wrap, wrap, u);
    let r = rp * (1 + flare * (1 - v)) + 0.0011 * Math.exp(-((ph / 0.35) ** 2));   // the proximal edge stands proud over the plate behind; a ridge down the middle
    const p = F.c.clone();
    if (cap && v > 0.7) { const k = (v - 0.7) / 0.3; r *= Math.sqrt(Math.max(0.02, 1 - k * k)); p.addScaledVector(F.t, rp * 0.9 * Math.sin(k * PI / 2)); }
    p.addScaledVector(F.n, Math.cos(ph) * r).addScaledVector(F.b, Math.sin(ph) * r);
    return [p.x, p.y, p.z];
  }, 12, cap ? 8 : 5);
}
function fingerTube(fn, r, n = 12) {
  const pts = []; for (let i = 0; i <= n; i++) { const [c] = fn(i / n); pts.push(new THREE.Vector3(...c)); }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, r, 8, false);
  const tip = xf(new THREE.SphereGeometry(r, 8, 6), { p: pts[n].toArray() });
  return mergeGeometries([tube, tip].map((g) => { for (const a in g.attributes) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a); return g.index ? g : g; }));
}
function gauntlet(add, s, sx, S) {
  const H = 'hand' + s;
  // the hand's centrelines, grip and open
  const dirA = (a) => [sx * Math.cos(a), -Math.sin(a)];   // a = 0: toward the back of the hand; increasing: round under the grip
  const gripFinger = (f) => (sv) => { const a = 0.18 + sv * 4.0 * f.k, d = dirA(a); return [[d[0] * GRIP_R, GRIP_Y + d[1] * GRIP_R, f.z], [d[0], d[1], 0]]; };
  const openFinger = (f, i) => (sv) => { const L = 0.088 * f.k * (i === 1 ? 1.04 : 1); return [[sx * (0.0255 - 0.014 * sv * sv), GRIP_Y - 0.004 - sv * L, f.z * (1 - 0.06 * sv)], [sx, 0.12 * sv, 0]]; };
  const segs = [[0, 0.43], [0.38, 0.72], [0.67, 1]];
  for (const [tag, mk] of [['grip', gripFinger], ['open', openFinger]]) {
    const plates = [], glove = [];
    FINGERS.forEach((f, i) => {
      const fn = mk(f, i), rp = f.r + 0.0024;
      glove.push(fingerTube(fn, f.r));
      segs.forEach(([s0, s1], j) => plates.push(fingerPlate(fn, s0, s1, rp + j * 0.0004 * 0, { cap: j === 2, wrap: j === 2 ? 1.95 : 1.75 })));
    });
    // the thumb: from its root in the palm, round over the top of the grip and down beside the index finger
    const thumbPts = tag === 'grip'
      ? [[sx * 0.016, -0.02, 0.036], [-sx * 0.006, -0.042, 0.047], [-sx * 0.036, -0.058, 0.044], [-sx * 0.05, -0.078, 0.026]]
      : [[sx * 0.016, -0.02, 0.036], [sx * 0.006, -0.05, 0.05], [sx * 0.0, -0.08, 0.052], [-sx * 0.004, -0.105, 0.046]];
    const tc = new THREE.CatmullRomCurve3(thumbPts.map((q) => new THREE.Vector3(...q)));
    const thumbFn = (sv) => { const p = tc.getPoint(sv), t = tc.getTangent(sv); const out = new THREE.Vector3(tag === 'grip' ? 0 : sx, tag === 'grip' ? 1 : 0, tag === 'grip' ? 0.35 : 0.6).normalize(); out.addScaledVector(t, -out.dot(t)).normalize(); return [p.toArray(), out.toArray()]; };
    glove.push(fingerTube(thumbFn, 0.0098));
    plates.push(fingerPlate((sv) => thumbFn(0.3 + sv * 0.38), 0, 1, 0.0122, { wrap: 1.8 }), fingerPlate((sv) => thumbFn(0.64 + sv * 0.36), 0, 1, 0.0122, { cap: true, wrap: 1.95 }));
    add(H, 'plate', mergeGeometries(plates), null, tag); add(H, 'leather', mergeGeometries(glove), null, tag);
  }
  // the back of the hand: three overlapping lames from the cuff to the knuckles, curved over the hand and round its edges
  const zc = -0.006;
  for (let i = 0; i < 3; i++) {
    const y0 = lerp(0.002, -0.066, i / 3) + 0.004, y1 = lerp(0.002, -0.066, (i + 1) / 3) - 0.003;
    add(H, 'plate', surf((u, v) => {
      const y = lerp(y0, y1, v), t = clamp(-y / 0.07, 0, 1), half = lerp(0.04, 0.054, t);
      const zz = lerp(-1, 1, u), w = Math.sin(zz * 1.25);
      const x = 0.026 + 0.009 * t + 0.009 * Math.cos(zz * 1.25) - 0.004 + 0.0012 * (1 - v);   // lower edge of each lame tucks under the next
      return [sx * (x - (1 - Math.cos(zz * 1.25)) * 0.014), y, zc + w / Math.sin(1.25) * half];
    }, 14, 3));
    add(H, 'brass', mergeGeometries([-1, 1].map((e) => rivetOut([sx * 0.024, (y0 + y1) / 2, zc + e * lerp(0.036, 0.05, i / 3)], [sx, 0, e * 0.8], 0.0028))));
  }
  // knuckle plate: following the curl over the knuckles, a boss over each one, a rolled top edge
  const kfn = (u, v) => {
    const z = lerp(0.04, -0.051, u), a = lerp(-0.38, 0.3, v), d = dirA(a);
    let boss = 0; for (const f of FINGERS) boss = Math.max(boss, Math.cos(clamp((z - f.z) / 0.012, -1, 1) * PI / 2));
    const R = GRIP_R + 0.0128 + 0.0032 * boss * Math.sin(v * PI);
    return [d[0] * R, GRIP_Y + d[1] * R, z];
  };
  add(H, 'plate', surf(kfn, 24, 6)); add(H, 'trim', edge(kfn, 'v0', 0.0022, 20));
  // the glove's palm and the leather between plates: the hand itself, from the wrist to the knuckles
  const palm = surf((u, v) => {
    const a = u * PI * 2, y = lerp(0.006, -0.074, v), t = clamp(-y / 0.074, 0, 1);
    const cx = sx * lerp(0.012, 0.02, t), rx = lerp(0.017, 0.014, t), rz = lerp(0.036, 0.05, t);
    return [cx + Math.cos(a) * rx, y, zc + Math.sin(a) * rz];
  }, 18, 4);
  add(H, 'leather', palm);
  // the cuff: flared over the vambrace, a second lame below it, rolled edge, rivets
  const cuff = new THREE.LatheGeometry([new THREE.Vector2(0.04, -0.012), new THREE.Vector2(0.043, 0.012), new THREE.Vector2(0.048, 0.038), new THREE.Vector2(0.058, 0.074)], 22);
  add(H, 'plate', xf(cuff, { p: [0, -0.012, 0], s: [1, 1, 1.12] }));
  add(H, 'trim', xf(new THREE.TorusGeometry(0.058, 0.0035, 5, 24), { p: [0, 0.062, 0], r: [PI / 2, 0, 0], s: [1, 1.12, 1] }));
  add(H, 'plate', xf(new THREE.LatheGeometry([new THREE.Vector2(0.041, -0.02), new THREE.Vector2(0.044, 0.0)], 20), { p: [0, -0.01, 0], s: [1, 1, 1.12] }));
  if (S.flutes) for (let k = -2; k <= 2; k++) add(H, 'trim', tubeAlong([[sx * 0.044 * Math.cos(k * 0.22), 0.0, Math.sin(k * 0.22) * 0.049], [sx * 0.055 * Math.cos(k * 0.22), 0.055, Math.sin(k * 0.22) * 0.062]], 0.0016, 4, 4));
  add(H, 'brass', mergeGeometries([[1, 0], [0, 1], [0, -1]].map(([cx, cz]) => rivetOut([sx * 0.046 * cx, 0.024, 0.052 * cz], [sx * cx, 0, cz], 0.003))));
}

export function buildHarness(style, opts = {}) {
  const S = STYLES[style];
  const parts = [];
  const add = (joint, mat, geo, follow, tag) => parts.push({ joint, mat, geo, follow, tag });
  const fl = flute(S);
  const torso = F('torso');
  const HD = -(SPINE_TO_CHEST + HIPS_TO_SPINE[0]), HZ = HIPS_TO_SPINE[1]; // hips frame -> torso field

  // ---------------- under-layer: the body (body.js) is the arming doublet and hose.
  // Mail skirt: four panels, each swinging with its thigh so the legs never cut through.
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    for (const back of [0, 1]) {
      const a0 = back ? (sx > 0 ? PI * 0.5 : PI) : (sx > 0 ? 0.04 : -PI * 0.5);
      const a1 = back ? (sx > 0 ? PI : PI * 1.5) : (sx > 0 ? PI * 0.5 : -0.04);
      const sk = fshell(torso, { a0, a1, y0: back ? -0.25 : -0.175, y1: back ? 0.08 : 0.02, dy: HD, dz: HZ, yLo: -0.34, rMax: 0.05, off: (th, v) => 0.016 + (1 - v) * 0.026, nu: 14, nv: 6 });
      add('hips', 'mail', sk.geo, { joint: 'thigh' + s, k: back ? 0.35 : 0.55, pivot: [sx * HIP_X, HIP_Y, 0] });
    }
  }
  // sword belt + rondel dagger on the right hip
  const belt = fshell(torso, { a0: 0, a1: PI * 2, y0: -0.02, y1: 0.012, dy: HD, dz: HZ, yLo: -0.34, off: 0.05, nu: 40, nv: 1 });
  add('hips', 'leather', belt.geo);
  const dag = [];
  dag.push(xf(new THREE.CylinderGeometry(0.012, 0.01, 0.22, 6), { p: [0, -0.11, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 12), { p: [0, 0.0, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6), { p: [0, 0.05, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12), { p: [0, 0.10, 0] }));
  const dp = torso.at(-PI * 0.62, -0.32, 0.06);
  add('hips', 'leather', xf(mergeGeometries(dag), { p: [dp[0], -0.1, dp[1] + HZ], r: [0.25, 0, 0.15] }));

  // ---------------- cuirass: breastplate (chest joint)
  const bp = fshell(torso, {
    a0: -1.85, a1: 1.85, y0: -0.25, y1: 0.165,
    aOfV: (v) => { const m = lerp(1.85, 1.2, smooth(clamp((v - 0.55) / 0.45, 0, 1))); return [-m, m]; },
    off: (th, v) => {
      const keel = 0.016 * Math.exp(-((th / 0.4) ** 2)) * smooth(clamp(v * 2, 0, 1)) * (1 - smooth(clamp((v - 0.85) * 6, 0, 1)));
      const globe = style === 'maximilian' ? 0.012 * Math.sin(v * PI) * Math.cos(th * 0.5) : style === 'gothic' ? 0.006 * Math.sin(v * PI) : 0.016 * Math.sin(v * PI) * Math.cos(th * 0.6);
      const waist = 0.012 * (1 - smooth(clamp(v * 3, 0, 1)));   // the waist flares out over the plackart
      return 0.016 + keel + globe + waist + (fl ? fl(th, v) : 0);
    },
    yOfU: (th, v) => v > 0.82 ? -0.06 * Math.pow(Math.cos(th * 0.95), 6) * (v - 0.82) / 0.18 : 0, // neck scoop
    nu: 56, nv: 22, win: 0.03, slope: 0.22,
  });
  add('chest', 'plate', bp.geo);
  add('chest', 'trim', edge(bp.fn, 'v1', 0.0075, 48));
  add('chest', 'trim', edge(bp.fn, 'u0', 0.006, 28)); add('chest', 'trim', edge(bp.fn, 'u1', 0.006, 28));
  // backplate, overlapped by the breast at the sides
  const bk = fshell(torso, {
    a0: 1.62, a1: PI * 2 - 1.62, y0: -0.25, y1: 0.15,
    off: (th, v) => 0.012 + (fl ? fl(th, v) * 0.7 : 0) + 0.004 * Math.sin(v * PI),
    nu: 40, nv: 16, win: 0.03, slope: 0.15,
  });
  add('chest', 'plate', bk.geo); add('chest', 'trim', edge(bk.fn, 'v1', 0.0065, 32));
  // shoulder straps & buckles
  for (const s of [-1, 1]) {
    const f0 = torso.at(s * 0.55, 0.13, 0.03), f1 = torso.at(s * PI * 0.5, 0.2, 0.03), f2 = torso.at(s * 2.6, 0.13, 0.03);
    add('chest', 'leather', tubeAlong([[f0[0], 0.13, f0[1]], [f1[0] * 0.75, 0.2, (f0[1] + f2[1]) / 2], [f2[0], 0.13, f2[1]]], 0.006, 12, 4));
    add('chest', 'brass', rivetOut([f0[0], 0.125, f0[1]], [Math.sin(s * 0.55), 0.3, Math.cos(s * 0.55)], 0.009));
  }
  // rivets along the breastplate's waist
  for (let i = -5; i <= 5; i++) { const th = i * 0.3; const p = torso.at(th, -0.235, 0.032); add('chest', 'brass', rivetOut([p[0], -0.235, p[1]], [Math.sin(th), 0, Math.cos(th)], 0.0055)); }
  // lance rest (arrêt) on the right breast
  { const p = torso.at(-0.75, -0.04, 0.035); add('chest', 'plate', xf(new THREE.BoxGeometry(0.012, 0.03, 0.06), { p: [p[0], -0.04, p[1]], r: [0, -0.75, 0] })); }

  // plackart (spine joint): over the belly, slides under the breastplate as the torso bends
  const pk = fshell(torso, {
    a0: -1.3, a1: 1.3, y0: -0.07, y1: 0.12, dy: -SPINE_TO_CHEST,
    aOfV: (v) => { const m = lerp(1.35, style === 'gothic' ? 0.22 : 0.7, smooth(clamp((v - 0.35) / 0.65, 0, 1))); return [-m, m]; },
    off: (th, v) => 0.03 + (fl ? fl(th, v) : 0) + 0.008 * (1 - v), nu: 32, nv: 10, win: 0.04,
  });
  add('spine', 'plate', pk.geo); add('spine', 'trim', edge(pk.fn, 'v1', 0.005, 28));
  // culet lames over the small of the back
  for (let i = 0; i < 2; i++) {
    const c = fshell(torso, { a0: 1.75, a1: PI * 2 - 1.75, y0: -0.07 - i * 0.045, y1: -0.01 - i * 0.045, dy: -SPINE_TO_CHEST, off: 0.034 + i * 0.008, slope: 0.15, nu: 20, nv: 3 });
    add('spine', 'plate', c.geo); add('spine', 'trim', edge(c.fn, 'v0', 0.004, 18));
  }

  // fauld: three hooped lames below the waist (hips joint)
  for (let i = 0; i < 3; i++) {
    const y1 = 0.075 - i * 0.038;
    // the lowest lame is arched over the groin
    const arch = i === 2 ? (th, v) => (v < 0.5 ? 0.03 * Math.exp(-((th / 0.45) ** 2)) : 0) : null;
    const f = fshell(torso, { a0: -1.95, a1: 1.95, y0: y1 - 0.05, y1, dy: HD, dz: HZ, yLo: -0.33, rMax: 0.05, yOfU: arch, off: (th, v) => 0.034 + i * 0.01 + (1 - v) * 0.008 + (fl ? fl(th, 0.5) * 0.6 : 0), nu: 36, nv: 3, win: 0.04 });
    add('hips', 'plate', f.geo); add('hips', 'trim', edge(f.fn, 'v0', 0.0045, 28));
    if (i === 0) for (const s of [-1, 1]) { const p = f.fn(s > 0 ? 0.98 : 0.02, 0.6); add('hips', 'brass', rivetOut(p, [s, 0, 0.2], 0.006)); }
  }
  // tassets: four lames each, hung from the fauld over the thigh, following it by degrees
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    const th = F('thigh' + s);
    for (let i = 0; i < 4; i++) {
      const top = -0.04 - i * 0.05;
      const t = fshell(th, {
        a0: -0.62 + sx * 0.38, a1: 0.62 + sx * 0.38, y0: top - 0.062, y1: top, dx: sx * HIP_X, dy: -HIP_Y, yHi: -0.1, yLo: -0.12,
        off: (a, v) => 0.07 - i * 0.004 + (fl ? fl(a * 1.5, 0.5) * 0.5 : 0) + Math.sin(v * PI) * 0.006 + (1 - v) * 0.004, nu: 16, nv: 4, win: 0,
        yOfU: (a, v) => (v < 0.5 ? -0.012 * Math.cos((a - sx * 0.38) * 2.4) : 0),   // lower edge rounded
      });
      const fol = { joint: 'thigh' + s, k: 0.3 + i * 0.13, pivot: [sx * HIP_X, HIP_Y, 0] };
      add('hips', 'plate', t.geo, fol);
      add('hips', 'trim', edge(t.fn, 'v0', 0.004, 16), fol);
    }
  }

  // ---------------- gorget: two lames on the chest, the top one turning with the neck
  const neck = F('neck');
  for (let i = 0; i < 3; i++) {
    const y0 = 0.135 + i * 0.03, y1 = y0 + 0.042;
    const g = fshell(neck, { a0: 0, a1: PI * 2, y0, y1, dy: -0.20, dz: -0.01, yLo: -0.03, off: (th, v) => 0.024 + (2 - i) * 0.01 + (1 - v) * (i === 0 ? 0.045 * Math.abs(Math.cos(th)) : 0.01), nu: 32, nv: 3, win: 0 });
    if (i < 2) { add('chest', 'plate', g.geo); add('chest', 'trim', edge(g.fn, 'v1', 0.0045, 28)); }
    else { const fol = { joint: 'neck', k: 0.5, pivot: [0, 0.2, -0.01] }; add('chest', 'plate', g.geo, fol); add('chest', 'trim', edge(g.fn, 'v1', 0.0045, 28), fol); }
  }

  // ---------------- helmet (head joint; skull centre ~ +0.11)
  buildHelm(S, style, add, opts);

  // ---------------- arms
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    const ua = F('uArm' + s), fa = F('fArm' + s);
    const big = S.grandGuard && s === 'L' ? 1.18 : 1;
    const ps = S.pauldron * big;
    const SX = sx * CLAV_TO_SHOULDER;
    // pauldron cap on the clavicle joint, domed over the shoulder ball
    const capR = 0.112 * ps;
    // a full dome over the shoulder: hangs low on the outside, rests on the gorget inside
    const rxo = capR * 1.04, rxi = capR * 0.62, rzc = capR * 1.12, ryc = capR * 0.82, CX = SX - sx * 0.018, CY = -0.01;
    const capFn = (u, v) => {
      const t = lerp(-PI, PI, u);                      // around the vertical; t = 0 points outward
      const out = Math.cos(t);
      const phMax = lerp(1.1, 1.62, (out + 1) / 2);
      const ph = v * phMax;
      const flt = S.flutes ? Math.sin(t * 7) * 0.003 * Math.sin(v * PI) : 0;
      const rx = (out > 0 ? rxo : rxi) + flt;
      return [CX + sx * out * Math.sin(ph) * rx, CY + Math.cos(ph) * ryc, Math.sin(t) * Math.sin(ph) * (rzc + flt) - 0.006];
    };
    const capFol = { joint: 'uArm' + s, k: 0.3, pivot: [SX, 0, 0] };
    add('clav' + s, 'plate', surf(capFn, 30, 14), capFol);
    add('clav' + s, 'trim', edge(capFn, 'v1', 0.0055, 30), capFol);
    for (let i = 0; i < 3; i++) {
      // lames hang from the cap and follow the upper arm progressively
      const lfn = (u, v) => {
        const th = lerp(-2.05, 2.05, u); const R = (0.106 + i * 0.003) * ps;
        const y = -0.01 - i * 0.036 - v * 0.044;
        return [SX + sx * Math.abs(Math.cos(th * 0.5)) * R * 0.98 * (1 + v * 0.05) - sx * 0.004, y, Math.sin(th) * R * 1.1 * (1 + v * 0.04) - 0.006];
      };
      const fol = { joint: 'uArm' + s, k: 0.42 + i * 0.14, pivot: [SX, 0, 0] };
      add('clav' + s, 'plate', surf(lfn, 24, 3), fol);
      add('clav' + s, 'trim', edge(lfn, 'v1', 0.004, 20), fol);
    }
    if (S.haute) { // haute-piece: upstanding flange guarding the neck
      const hx = CX - sx * rxi * 0.62;
      const hfn = (u, v) => { const t = lerp(-0.95, 0.95, u); return [hx + sx * 0.012 * v, 0.07 * ps + v * 0.075, Math.sin(t) * 0.1 * ps]; };
      add('clav' + s, 'plate', surf(hfn, 12, 3), capFol); add('clav' + s, 'trim', edge(hfn, 'v1', 0.005, 12), capFol);
    }
    add('clav' + s, 'brass', rivetOut([SX + sx * 0.07 * ps, 0.085, 0.0], [sx, 0.6, 0], 0.008), capFol);
    // rerebrace (upper arm), closed, shaped to the arm
    const rr = fshell(ua, { a0: 0, a1: PI * 2, y0: -0.25, y1: -0.07, off: (th, v) => 0.013 + (S.flutes ? Math.sin(th * 9) * 0.0018 : 0), nu: 24, nv: 8, win: 0.03 });
    add('uArm' + s, 'plate', rr.geo); add('uArm' + s, 'trim', edge(rr.fn, 'v1', 0.004, 22)); add('uArm' + s, 'trim', edge(rr.fn, 'v0', 0.0035, 22));
    // couter: elbow cop with a fan-shaped side wing; follows the forearm by half
    const er = Math.max(ua.r(PI, -0.28), fa.r(PI, -0.02)) + 0.03;
    const cop = xf(new THREE.SphereGeometry(er, 18, 10, 0, PI * 2, 0, PI * 0.5), { r: [-PI / 2, 0, 0], p: [0, 0, -0.006], s: [1, 0.65, 1.05] });
    const wing = surf((u, v) => { const a = lerp(-1.35, 1.35, u); const r = 0.084 * (0.15 + 0.85 * v) * (0.62 + 0.38 * Math.cos(a * 1.2)); return [sx * (er * 0.8 + (1 - v) * 0.012), Math.sin(a) * r, -Math.cos(a) * r * 0.55 - 0.012]; }, 14, 5);
    const elbowFol = { joint: 'fArm' + s, k: 0.5, pivot: [0, -0.30, 0] };
    add('uArm' + s, 'plate', xf(mergeGeometries([cop, wing]), { p: [0, -0.30, 0] }), elbowFol);
    add('uArm' + s, 'brass', rivetOut([0, -0.30, -er - 0.004], [0, 0, -1], 0.007), elbowFol);
    for (let i = 0; i < 2; i++) { // couter lames above & below
      const l = fshell(i ? fa : ua, { a0: 1.4, a1: PI * 2 - 1.4, y0: i ? -0.055 : -0.27, y1: i ? -0.03 : -0.245, dy: i ? 0 : 0, off: 0.022, nu: 14, nv: 2, win: 0 });
      if (i) add('fArm' + s, 'plate', l.geo); else add('uArm' + s, 'plate', l.geo, { joint: 'fArm' + s, k: 0.25, pivot: [0, -0.30, 0] });
    }
    // vambrace (forearm), closed, tapering to the wrist
    const vb = fshell(fa, { a0: 0, a1: PI * 2, y0: -0.235, y1: -0.05, off: 0.012, nu: 22, nv: 8, win: 0.02 });
    add('fArm' + s, 'plate', vb.geo); add('fArm' + s, 'trim', edge(vb.fn, 'v0', 0.0038, 20)); add('fArm' + s, 'trim', edge(vb.fn, 'v1', 0.0035, 20));
    // gauntlet: articulated plate over a leather glove, after the MakeHuman hand (see gauntlet())
    gauntlet(add, s, sx, S);
  }

  // ---------------- legs
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    const th = F('thigh' + s), sh = F('shin' + s);
    // cuisse: front and outer thigh, open behind as real cuisses were
    const cu = fshell(th, { a0: -2.05, a1: 2.05, y0: -0.38, y1: -0.04, yHi: -0.08, off: (a, v) => 0.016 + (fl ? fl(a * 0.6, v) : 0) + 0.008 * smooth(clamp((v - 0.8) * 5, 0, 1)), nu: 28, nv: 12, win: 0.03 });
    add('thigh' + s, 'plate', cu.geo); add('thigh' + s, 'trim', edge(cu.fn, 'v1', 0.005, 24));
    add('thigh' + s, 'trim', edge(cu.fn, 'u0', 0.004, 14)); add('thigh' + s, 'trim', edge(cu.fn, 'u1', 0.004, 14));
    // straps around the back of the thigh
    for (const y of [-0.12, -0.3]) add('thigh' + s, 'leather', fshell(th, { a0: 2.0, a1: PI * 2 - 2.0, y0: y, y1: y + 0.018, off: 0.01, nu: 10, nv: 1, win: 0 }).geo);
    // poleyn: knee cop + outer wing, following the shin by half
    const kr = Math.max(th.r(0, -0.42), sh.r(0, -0.03)) + 0.03;
    const kc = xf(new THREE.SphereGeometry(kr, 18, 10, 0, PI * 2, 0, PI * 0.5), { r: [PI / 2, 0, 0], p: [0, 0, 0.012], s: [1, 0.62, 1.05] });
    const kw = surf((u, v) => { const a = lerp(-1.4, 1.4, u); const r = 0.088 * (0.15 + 0.85 * v) * (0.58 + 0.42 * Math.cos(a)); return [sx * (kr * 0.85 + (1 - v) * 0.014), Math.sin(a) * r, Math.cos(a) * r * 0.5]; }, 14, 5);
    const kneeFol = { joint: 'shin' + s, k: 0.5, pivot: [0, -0.45, 0] };
    add('thigh' + s, 'plate', xf(mergeGeometries([kc, kw]), { p: [0, -0.45, 0] }), kneeFol);
    add('thigh' + s, 'brass', rivetOut([0, -0.45, kr + 0.016], [0, 0, 1], 0.008), kneeFol);
    for (let i = 0; i < 2; i++) {
      const l = fshell(i ? sh : th, { a0: -1.55, a1: 1.55, y0: i ? -0.06 : -0.41, y1: i ? -0.035 : -0.385, off: 0.024, nu: 14, nv: 2, win: 0 });
      if (i) add('shin' + s, 'plate', l.geo); else add('thigh' + s, 'plate', l.geo, { joint: 'shin' + s, k: 0.2, pivot: [0, -0.45, 0] });
    }
    // greave: closed, shaped to the calf
    const gr = fshell(sh, { a0: 0, a1: PI * 2, y0: -0.405, y1: -0.07, off: (a) => 0.012 + Math.max(0, Math.cos(a)) * 0.003 * Math.exp(-((a / 0.3) ** 2)), nu: 28, nv: 14, win: 0.03 });
    add('shin' + s, 'plate', gr.geo); add('shin' + s, 'trim', edge(gr.fn, 'v1', 0.0045, 26)); add('shin' + s, 'trim', edge(gr.fn, 'v0', 0.004, 26));
    // sabaton: overlapping lames from instep to toe
    const toeLen = S.pointedToe ? 0.25 : S.bearPaw ? 0.19 : 0.21;
    const lames = 6;
    for (let i = 0; i < lames; i++) {
      const t0 = i / lames, t1 = (i + 1.25) / lames;
      const z0 = lerp(-0.02, toeLen, t0), z1 = lerp(-0.02, toeLen, Math.min(1, t1));
      const width = (t) => {
        if (S.bearPaw) return lerp(0.052, 0.074, smooth(t));
        if (S.pointedToe) return lerp(0.052, 0.008, Math.pow(t, 1.6));
        return lerp(0.052, 0.042, t);
      };
      const height = (t) => lerp(0.064, S.pointedToe ? 0.012 : 0.026, smooth(t));
      const sab = surf((u, v) => {
        const a = lerp(-1.6, 1.6, u); const z = lerp(z0, z1, v); const t = clamp((z + 0.02) / (toeLen + 0.02), 0, 1);
        return [Math.sin(a) * width(t), -0.078 + Math.cos(a) * height(t) * (1 - t * 0.2), z];
      }, 12, 2);
      add('foot' + s, 'plate', sab);
    }
    add('foot' + s, 'leather', xf(new THREE.BoxGeometry(0.108, 0.02, toeLen + 0.09), { p: [0, -0.075, toeLen / 2 - 0.035] })); // sole
    const heel = shell({ a0: 1.9, a1: PI * 2 - 1.9, y0: -0.075, y1: 0.0, rx: () => 0.05, rz: () => 0.056, nu: 12, nv: 2 });
    add('foot' + s, 'plate', heel.geo);
    // ankle lames joining greave and sabaton
    const ank = shell({ a0: 0, a1: PI * 2, y0: -0.01, y1: 0.03, rx: () => 0.052, rz: () => 0.058, cz: 0.004, nu: 18, nv: 2 });
    add('foot' + s, 'plate', ank.geo);
    add('foot' + s, 'plate', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 4), { p: [0, -0.06, -0.08], r: [PI / 2, 0, 0] })); // spur stub
  }
  return parts;
}

function buildHelm(S, style, add, opts) {
  const plume = opts.plume ?? true;
  if (S.helm === 'sallet') {
    // German sallet: rounded skull flowing into a long tail, with a slit visor; bevor covers the jaw
    const sk = surf((u, v) => {
      const th = lerp(-PI, PI, u); const ph = lerp(0, PI * 0.62, v);
      const back = Math.max(0, -Math.cos(th));
      const R = 0.128;
      let y = 0.115 + Math.cos(ph) * R * 1.02; let r = Math.sin(ph) * R;
      // tail sweeps out and down at the back
      if (v > 0.7) { const t = (v - 0.7) / 0.3; y -= back * t * 0.06; r += back * t * 0.05; }
      const comb = Math.exp(-((th / 0.12) ** 2 + (th - PI) ** 2 / 0.02)) * 0;
      return [Math.sin(th) * r, y + comb, Math.cos(th) * r * 1.08 + 0.01];
    }, 36, 16);
    add('head', 'plate', sk);
    // low comb ridge
    add('head', 'plate', tubeAlong([[0, 0.2, 0.11], [0, 0.247, 0.02], [0, 0.235, -0.07], [0, 0.18, -0.12]], 0.007, 16, 5));
    // visor slit
    add('head', 'dark', xf(new THREE.BoxGeometry(0.15, 0.012, 0.03), { p: [0, 0.115, 0.122], s: [1, 1, 1] }));
    add('head', 'trim', edge((u, v) => { const th = lerp(-1.3, 1.3, u); return [Math.sin(th) * 0.13, 0.105, Math.cos(th) * 0.13 * 1.08 + 0.01]; }, 'u0', 0.005, 16));
    // bevor: chin/throat defence strapped to the breastplate (chest joint)
    const bv = shell({ a0: -1.8, a1: 1.8, y0: 0.2, y1: 0.33, rx: (v) => lerp(0.11, 0.135, v), rz: (v) => lerp(0.1, 0.14, v), cz: 0.03, nu: 24, nv: 6, extra: (th, v) => 0.015 * Math.exp(-((th / 0.4) ** 2)) * v });
    add('chest', 'plate', bv.geo, { joint: 'neck', k: 0.35, pivot: [0, 0.2, 0] });
    add('chest', 'trim', edge(bv.fn, 'v1', 0.006, 22), { joint: 'neck', k: 0.35, pivot: [0, 0.2, 0] });
  } else {
    // armet / close helmet: rounded bowl with comb, articulated visor, bevor and neck lames
    const sk = surf((u, v) => {
      const th = lerp(-PI, PI, u); const ph = lerp(0, PI * 0.82, v); const R = 0.122;
      const flt = style === 'maximilian' ? Math.sin(th * 12) * 0.0035 * Math.sin(ph * 2) : 0;
      return [Math.sin(th) * Math.sin(ph) * (R + flt), 0.12 + Math.cos(ph) * R * 1.05, Math.cos(th) * Math.sin(ph) * (R + flt) * 1.05];
    }, 36, 16);
    add('head', 'plate', sk);
    add('head', 'plate', tubeAlong([[0, 0.23, 0.08], [0, 0.262, 0.0], [0, 0.25, -0.08], [0, 0.2, -0.13]], 0.006, 16, 5));
    if (style === 'maximilian') {
      // bellows visor: horizontal ridges with sight slits
      const vis = surf((u, v) => { const th = lerp(-1.4, 1.4, u); const y = lerp(0.05, 0.17, v); const rid = Math.abs(Math.sin(v * PI * 5)) * 0.012; const r = 0.13 + rid + 0.02 * Math.cos(th); return [Math.sin(th) * r * 0.95, y, Math.cos(th) * r * 1.05 + 0.005]; }, 24, 20);
      add('head', 'plate', vis);
      for (const y of [0.115, 0.137]) add('head', 'dark', xf(new THREE.BoxGeometry(0.15, 0.006, 0.03), { p: [0, y, 0.155] }));
    } else {
      // Milanese armet visor: pointed "sparrow beak" with a single sight
      const vis = surf((u, v) => { const th = lerp(-1.4, 1.4, u); const y = lerp(0.05, 0.17, v); const beak = Math.exp(-((th / 0.5) ** 2)) * 0.04 * Math.sin(v * PI); const r = 0.13 + beak; return [Math.sin(th) * r * 0.95, y, Math.cos(th) * r * 1.03 + 0.004]; }, 24, 12);
      add('head', 'plate', vis);
      add('head', 'dark', xf(new THREE.BoxGeometry(0.14, 0.011, 0.04), { p: [0, 0.128, 0.16] }));
      // rondel on the back of the helmet
      add('head', 'plate', xf(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 20), { p: [0, 0.07, -0.135], r: [PI / 2, 0, 0] }));
      add('head', 'plate', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), { p: [0, 0.07, -0.11], r: [PI / 2, 0, 0] }));
    }
    // breaths (ventilation holes) on the right of the lower visor
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) add('head', 'dark', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 5), { p: [-0.07 - k * 0.012, 0.055 + i * 0.012, 0.11 - k * 0.02], r: [0, 0, PI / 2 + 0.4] }));
    // visor pivots
    for (const s of [-1, 1]) add('head', 'brass', rivetOut([s * 0.125, 0.13, 0.0], [s, 0, 0], 0.011));
    // bevor + chin
    const bv = shell({ a0: -2.0, a1: 2.0, y0: -0.02, y1: 0.07, rx: (v) => lerp(0.1, 0.122, v), rz: (v) => lerp(0.1, 0.13, v), cz: 0.01, nu: 24, nv: 5 });
    add('head', 'plate', bv.geo); add('head', 'trim', edge(bv.fn, 'v0', 0.005, 20));
    for (let i = 0; i < 2; i++) { const nl = shell({ a0: 0, a1: PI * 2, y0: -0.06 - i * 0.03, y1: -0.025 - i * 0.03, rx: () => 0.1 + i * 0.006, rz: () => 0.1 + i * 0.006, nu: 24, nv: 2 }); add('head', 'plate', nl.geo); }
  }
  if (plume) {
    // ostrich plume: long feathers rising from a socket at the back of the skull and
    // arching back over the helmet, each a curved ribbon carrying a feather texture
    const feathers = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const spread = (i - (N - 1) / 2) / ((N - 1) / 2);
      const len = 0.5 + (1 - Math.abs(spread)) * 0.16 + (i % 2) * 0.04;
      const yaw = spread * 0.55, rise = 0.55 - Math.abs(spread) * 0.25, wid = 0.085 + (1 - Math.abs(spread)) * 0.03;
      const g = surf((u, v) => {
        const s = v * len;
        // the quill rises, arches over and droops behind
        const ang = rise - v * 1.9 * (0.85 + 0.15 * (i % 3) / 2);
        let px = 0, py = 0, pz = 0, a = rise;
        const steps = 12; for (let k = 0; k < steps; k++) { const t = (k + 0.5) / steps * v; a = rise - t * 2.0; px += Math.sin(yaw) * Math.cos(a) * s / steps; py += Math.sin(a) * s / steps; pz -= Math.cos(yaw) * Math.cos(a) * s / steps; }
        const w = (u - 0.5) * wid * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.95 + 0.15);
        // the barbs hang: offset sideways, curled a little downward
        return [px + Math.cos(yaw) * w, py - Math.abs(w) * 0.35, pz + Math.sin(yaw) * w];
      }, 4, 14);
      feathers.push(g);
    }
    add('head', 'plume', xf(mergeGeometries(feathers), { p: [0, 0.2, -0.12] }));
    add('head', 'brass', xf(new THREE.CylinderGeometry(0.014, 0.009, 0.06, 10), { p: [0, 0.2, -0.125], r: [-0.6, 0, 0] }));
  }
}

// ---------------------------------------------------------------- materials
export function harnessMaterials(finish, quality, colors = {}) {
  const size = quality.tex;
  const at = armorTextures(finish, size);
  const F = FINISHES[finish];
  const plate = new THREE.MeshStandardMaterial({
    map: at.map, normalMap: at.normalMap, roughnessMap: at.roughnessMap, metalnessMap: at.metalnessMap, metalness: 1, roughness: 1,   // metal where bare, not where rusted or grimy
    normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, envMapIntensity: 1.0,
  });
  const gilt = F.gilt;
  const trim = gilt
    ? new THREE.MeshStandardMaterial({ color: 0xc8962e, metalness: 1, roughness: 0.32, envMapIntensity: 1.3 })
    : plate;
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.35, envMapIntensity: 1.2 });
  const mt = mailTextures(512);
  const mail = new THREE.MeshStandardMaterial({ map: mt.map, normalMap: mt.normalMap, roughnessMap: mt.roughnessMap, metalness: 1, roughness: 1, side: THREE.DoubleSide });
  mail.map.repeat.set(4, 3); mail.normalMap.repeat.set(4, 3); mail.roughnessMap.repeat.set(4, 3);
  const ct = clothTextures(colors.cloth || [92, 22, 24], true, 512, 'doublet');
  const cloth = new THREE.MeshStandardMaterial({ map: ct.map, normalMap: ct.normalMap, roughnessMap: ct.roughnessMap, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const lt = leatherTextures();
  const leather = new THREE.MeshStandardMaterial({ map: lt.map, normalMap: lt.normalMap, roughnessMap: lt.roughnessMap, roughness: 1, metalness: 0 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const plume = new THREE.MeshStandardMaterial({ color: new THREE.Color(...(colors.plume || [0.85, 0.82, 0.78])), map: featherTexture(256), alphaTest: 0.32, roughness: 0.85, side: THREE.DoubleSide });
  return { plate, trim, brass, mail, cloth, leather, dark, plume };
}

// Assemble the harness onto a rig. Static parts are merged per joint+material;
// articulated lames get their own follower nodes.
export function dressRig(rig, style, finish, quality, colors) {
  const mats = harnessMaterials(finish, quality, colors);
  const parts = buildHarness(style, { plume: colors?.plume !== null });
  const groups = new Map();
  for (const p of parts) {
    const key = (p.follow ? `${p.joint}|${p.follow.joint}|${p.follow.k}|${p.follow.pivot.join(',')}|${p.mat}` : `${p.joint}||${p.mat}`) + (p.tag ? '|' + p.tag : '');
    if (!groups.has(key)) groups.set(key, { joint: p.joint, follow: p.follow, mat: p.mat, tag: p.tag, geos: [] });
    groups.get(key).geos.push(p.geo);
  }
  const followers = [];
  const meshes = [];
  const followerNodes = new Map();
  const handSets = { R: { grip: [], open: [] }, L: { grip: [], open: [] } };
  for (const g of groups.values()) {
    for (const geo of g.geos) { if (geo.index === null) console.warn('non-indexed armour part'); for (const n in geo.attributes) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n); }
    const geo = mergeGeometries(g.geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats[g.mat]);
    mesh.castShadow = g.mat !== 'dark'; mesh.receiveShadow = true;
    if (g.mat === 'plume') mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mats.plume.map, alphaTest: 0.32 });
    if (g.follow) {
      const fk = `${g.joint}|${g.follow.joint}|${g.follow.k}|${g.follow.pivot.join(',')}`;
      let node = followerNodes.get(fk);
      if (!node) {
        node = new THREE.Group(); node.position.set(...g.follow.pivot);
        rig.j[g.joint].add(node);
        followers.push({ node, src: rig.j[g.follow.joint], k: g.follow.k });
        followerNodes.set(fk, node);
      }
      mesh.position.set(-g.follow.pivot[0], -g.follow.pivot[1], -g.follow.pivot[2]);
      node.add(mesh);
    } else {
      rig.j[g.joint].add(mesh);
    }
    if (g.tag) { handSets[g.joint.slice(-1)][g.tag].push(mesh); mesh.visible = g.tag === 'grip'; }
    meshes.push(mesh);
  }
  const _id = new THREE.Quaternion();
  function updateFollowers() {
    for (const f of followers) f.node.quaternion.slerpQuaternions(_id, f.src.quaternion, f.k);
  }
  // open or close a gauntlet (the fingers are posed geometry: a fist round the grip, or straight)
  const handOpen = { R: false, L: false };
  function setHandOpen(side, open) {
    if (handOpen[side] === open) return; handOpen[side] = open;
    for (const m of handSets[side].grip) m.visible = !open; for (const m of handSets[side].open) m.visible = open;
  }
  return { mats, meshes, updateFollowers, setHandOpen };
}
