// The Great Dragon's body. One continuous skinned hide from the tip of the tail to the back of the skull (lofted
// along the spine, so there are no seams between parts), a long wedge of a skull with a separate jaw, rows of
// teeth, swept-back ridged horns, blade-like dorsal plates, heavy hind legs on taloned feet, wing-arms with long
// finger bones, and leathery wing membranes with veins that glow faintly red when the light is behind them.
// Joint names and rest positions are the ones the Dragon's animation and hit spheres already use.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTemplate, instantiate } from './demons.js';
import { normalFromHeight } from './textures.js';
import { clamp, lerp, smooth, rng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const S = (x, y, z) => [x, y, z];
const SCALE = 0, HORN = 1, MOUTH = 3, TOOTH = 4, CLAW = 5;

export const DRAGON_JOINTS = (() => {
  const sym = (fn) => [fn(-1, 'R'), fn(1, 'L')].flat();
  return [
    { name: 'hips', parent: null, pos: S(0, 3.6, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.25, 1.5) }, { name: 'chest', parent: 'spine', pos: S(0, 0.2, 1.4) },
    { name: 'neck1', parent: 'chest', pos: S(0, 0.5, 1.3) }, { name: 'neck2', parent: 'neck1', pos: S(0, 0.5, 0.75) }, { name: 'neck3', parent: 'neck2', pos: S(0, 0.45, 0.75) },
    { name: 'neck4', parent: 'neck3', pos: S(0, 0.4, 0.75) }, { name: 'neck5', parent: 'neck4', pos: S(0, 0.3, 0.75) }, { name: 'head', parent: 'neck5', pos: S(0, 0.25, 0.7) }, { name: 'jaw', parent: 'head', pos: S(0, -0.22, 0.35) },
    { name: 'tail1', parent: 'hips', pos: S(0, -0.1, -1.5) },
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ name: 'tail' + i, parent: 'tail' + (i - 1), pos: S(0, -0.04, -1.35) })),
    ...sym((s, k) => [
      { name: 'thigh' + k, parent: 'hips', pos: S(s * 1.05, -0.3, 0.3) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -1.6, 0.55) }, { name: 'foot' + k, parent: 'shin' + k, pos: S(0, -1.45, -0.65) },
      { name: 'wing1' + k, parent: 'chest', pos: S(s * 0.95, 0.7, 0.1) }, { name: 'wing2' + k, parent: 'wing1' + k, pos: S(s * 2.6, 0.2, -0.3) }, { name: 'wing3' + k, parent: 'wing2' + k, pos: S(s * 3.4, 0, -0.6) },
      { name: 'f1' + k, parent: 'wing3' + k, pos: S(0, 0, 0) }, { name: 'f2' + k, parent: 'wing3' + k, pos: S(0, 0, 0) }, { name: 'f3' + k, parent: 'wing3' + k, pos: S(0, 0, 0) },
    ]),
  ];
})();
export const FINGERS = { f1: [5.4, 0, 1.6], f2: [6.2, 0, -1.2], f3: [3.6, 0, -4.4] };

// rest-pose world positions of every joint
function jointWorld() {
  const W = {};
  for (const j of DRAGON_JOINTS) W[j.name] = (j.parent ? W[j.parent].clone() : V(0, 0, 0)).add(V(...j.pos));
  return W;
}

// ---------------------------------------------------------------- geometry builders (template world space)
// A loft: rings of `seg` vertices along a smooth path. section(i, u) -> { rx, ry, yo, shape(theta) -> [sx, sy] }.
// Returns the geometry and, per vertex, the ring parameter (0..1 along the path) so the caller can skin it.
function loft(points, nRings, seg, section, upHint = V(0, 1, 0), uvScale = [1, 1]) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos = [], uv = [], idx = [], ringT = [];
  let arc = 0, prev = null;
  for (let i = 0; i <= nRings; i++) {
    const u = i / nRings; const C = curve.getPoint(u), T = curve.getTangent(u).normalize();
    if (prev) arc += prev.distanceTo(C); prev = C.clone();
    let up = upHint.clone().sub(T.clone().multiplyScalar(upHint.dot(T))); if (up.lengthSq() < 1e-6) up = V(1, 0, 0); up.normalize();
    const side = new THREE.Vector3().crossVectors(up, T).normalize();   // +x on the left of a creature facing +z
    const sec = section(u, C);
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2; const [sx, sy] = sec.shape(th);
      const p = C.clone().addScaledVector(side, sx * sec.rx).addScaledVector(up, sy * sec.ry + (sec.yo || 0));
      pos.push(p.x, p.y, p.z); uv.push((k / seg) * uvScale[0], arc * uvScale[1]); ringT.push(u);
    }
  }
  for (let i = 0; i < nRings; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return { g, ringT, curve };
}
const se = (p, q = p) => (th) => { const c = Math.cos(th), s = Math.sin(th); return [Math.sign(s) * Math.abs(s) ** (2 / p), Math.sign(c) * Math.abs(c) ** (2 / (c < 0 ? q : p))]; };
// a limb as one unbroken tube through its joints, each stretch skinned to its own bone and blended across the
// joints, so a bent knee or elbow folds the hide rather than opening a gap
function chainLoft(points, owners, radii, { rings = 40, seg = 18, up = V(0, 1, 0), rootBone = null, shape = se(2.3) } = {}) {
  const nP = points.length;
  const at = (u) => { const f = u * (nP - 1), i = Math.min(nP - 2, Math.floor(f)), t = smooth(f - i); const a = radii[i], b = radii[i + 1]; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; };
  const L = loft(points, rings, seg, (u) => { const [rx, ry] = at(u); const f = u * (nP - 1), t = f - Math.floor(f); const bulge = Math.sin(t * Math.PI) * 0.12; return { rx: rx * (1 + bulge), ry: ry * (1 + bulge * 1.4), shape }; }, up, [2, 1]);
  const w = L.ringT.map((u) => {
    const f = u * (nP - 1), k = Math.min(nP - 2, Math.floor(f)), t = f - k; const o = owners[k];
    if (k === 0 && rootBone && t < 0.35) return [o, 0.5 + t / 0.7, rootBone, 0.5 - t / 0.7];
    if (t < 0.5 && k > 0 && owners[k - 1] !== o) return [o, 0.5 + t, owners[k - 1], 0.5 - t];
    if (t >= 0.5 && k < nP - 2 && owners[k + 1] !== o) return [o, 1.5 - t, owners[k + 1], t - 0.5];
    return [o, 1, o, 0];
  });
  return { geo: reg(L.g, SCALE), weights: w };
}
// a tapering, ridged horn or claw along a curve
function tube(points, r0, r1, seg = 8, rings = 24, ridge = 0) {
  const { g } = loft(points, rings, seg, (u) => { const r = lerp(r0, r1, Math.pow(u, 0.8)) * (1 + ridge * Math.sin(u * 46) * (1 - u)); return { rx: r, ry: r, shape: se(2) }; }, V(0, 1, 0.3).normalize());
  return g;
}
// a flattened, raked blade (dorsal plate or spike)
function blade(base, h, thick, rake) {
  const g = new THREE.ConeGeometry(base, h, 6, 3); g.translate(0, h / 2, 0); g.scale(thick, 1, 1);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setZ(i, p.getZ(i) - rake * y * y * h); }
  g.computeVertexNormals(); return g;
}
const reg = (g, r) => { g.setAttribute('region', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(r), 1)); return g; };
const nonIdx = (g) => (g.index ? g : g);

// ---------------------------------------------------------------- the model
export function buildDragonModel() {
  const W = jointWorld(); const r = rng(6660);
  const parts = [];   // { geo (world coords), weights: [[a, wa, b, wb] per vertex] }
  const rigid = (geo, joint, region = SCALE) => { reg(geo, region); parts.push({ geo, weights: new Array(geo.attributes.position.count).fill([joint, 1, joint, 0]) }); };
  const toWorld = (geo, joint, extra) => { if (extra) geo.applyMatrix4(extra); geo.translate(W[joint].x, W[joint].y, W[joint].z); return geo; };

  // ---- the hide: tail tip -> skull, skinned along the chain
  const chain = ['tail9', 'tail8', 'tail7', 'tail6', 'tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'neck3', 'neck4', 'neck5', 'head'];
  const pts = [W.tail9.clone().add(V(0, -0.08, -1.5)), ...chain.map((n) => W[n].clone()), W.head.clone().add(V(0, 0.02, 0.3))];
  // owner bone of the stretch from pts[k] to pts[k+1]
  const owner = ['tail9', 'tail8', 'tail7', 'tail6', 'tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'hips', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'neck3', 'neck4', 'neck5', 'head'];
  //            rx     ry    yo   (one per point)
  const prof = [[0.05, 0.05, 0], [0.13, 0.15, 0], [0.19, 0.21, 0], [0.25, 0.27, 0], [0.31, 0.33, 0], [0.37, 0.4, 0], [0.44, 0.47, 0], [0.52, 0.55, 0], [0.61, 0.65, 0], [0.73, 0.8, -0.05],
    [1.02, 1.12, -0.1], [1.12, 1.3, -0.22], [1.2, 1.42, -0.28], [0.74, 0.86, -0.12], [0.58, 0.67, -0.06], [0.49, 0.57, -0.03], [0.43, 0.5, 0], [0.39, 0.46, 0], [0.36, 0.43, 0], [0.3, 0.36, 0]];
  const nP = pts.length;
  const at = (u) => { const f = u * (nP - 1), i = Math.min(nP - 2, Math.floor(f)), t = f - i, s = smooth(t); const a = prof[i], b = prof[i + 1]; return [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)]; };
  const hide = loft(pts, 230, 28, (u) => {
    const [rx, ry, yo] = at(u);
    return { rx, ry, yo, shape: (th) => {
      const c = Math.cos(th), s = Math.sin(th);
      let sx = Math.sign(s) * Math.abs(s) ** (2 / 2.4), sy = Math.sign(c) * Math.abs(c) ** (2 / (c < 0 ? 3.2 : 2.2));
      sy += Math.max(0, c) ** 14 * 0.16;                       // the ridge of the spine
      const hump = Math.exp(-(((u - 0.635) / 0.035) ** 2)) * 0.16 + Math.exp(-(((u - 0.53) / 0.035) ** 2)) * 0.12;   // shoulders, haunches
      sx *= 1 + hump * Math.max(0, c + 0.2) * Math.abs(s);
      if (c < 0) sy *= 0.9;                                     // a flatter, plated belly
      return [sx, sy];
    } };
  }, V(0, 1, 0), [3, 0.9]);
  { const wts = hide.ringT.map((u) => {
      const f = u * (nP - 1), k = Math.min(nP - 2, Math.floor(f)), t = f - k; const o = owner[k];
      if (t < 0.5 && k > 0 && owner[k - 1] !== o) return [o, 0.5 + t, owner[k - 1], 0.5 - t];
      if (t >= 0.5 && k < nP - 2 && owner[k + 1] !== o) return [o, 1.5 - t, owner[k + 1], t - 0.5];
      return [o, 1, o, 0];
    });
    reg(hide.g, SCALE); parts.push({ geo: hide.g, weights: wts });
    // dorsal plates down the neck, back and tail: big over the shoulders, shrinking to the tail and the skull
    for (let i = 0; i < 46; i++) {
      const u = lerp(0.1, 0.9, i / 45); const C = hide.curve.getPoint(u), T = hide.curve.getTangent(u).normalize(); const [, ry, yo] = at(u);
      const big = Math.exp(-(((u - 0.62) / 0.22) ** 2)) * 0.75 + 0.25;
      const h = (0.18 + ry * 0.5) * big * (0.85 + r() * 0.3);
      const g = blade(h * 0.42, h, 0.28, 0.55);
      const yaw = Math.atan2(T.x, T.z), pitch = -Math.asin(clamp(T.y, -1, 1));
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
      g.translate(C.x, C.y + yo + ry * 1.1 - 0.05, C.z);
      reg(g, HORN);
      const f = u * (nP - 1), k = Math.min(nP - 2, Math.floor(f)); parts.push({ geo: g, weights: new Array(g.attributes.position.count).fill([owner[k], 1, owner[k], 0]) });
    }
    // the tail ends in a spray of spikes, not a cartoon spade
    for (let i = 0; i < 6; i++) { const s = i % 2 ? 1 : -1; const g = blade(0.09, 0.7 - i * 0.07, 0.4, 0.5); g.rotateZ(s * (0.9 + i * 0.05)); g.rotateX(-0.6); g.translate(W.tail9.x, W.tail9.y, W.tail9.z - 0.3 - i * 0.22); reg(g, HORN); parts.push({ geo: g, weights: new Array(g.attributes.position.count).fill(['tail9', 1, 'tail9', 0]) }); }
  }

  // ---- the skull (head-local, +z forward)
  {
    const sec = [[-0.5, 0.38, 0.4, -0.36], [-0.2, 0.48, 0.5, -0.3], [0.12, 0.52, 0.5, -0.24], [0.42, 0.47, 0.46, -0.19], [0.75, 0.37, 0.32, -0.15], [1.15, 0.3, 0.25, -0.12],
      [1.55, 0.27, 0.22, -0.1], [1.9, 0.23, 0.19, -0.085], [2.12, 0.15, 0.12, -0.06], [2.24, 0.03, 0.03, -0.04]];
    const zs = sec.map((s) => V(0, 0, s[0]));
    const L = loft(zs, 60, 32, (u) => {
      const f = u * (sec.length - 1), i = Math.min(sec.length - 2, Math.floor(f)), t = smooth(f - i); const a = sec[i], b = sec[i + 1];
      const w = lerp(a[1], b[1], t), top = lerp(a[2], b[2], t), bot = lerp(a[3], b[3], t), z = lerp(a[0], b[0], t);
      return { rx: w, ry: 1, shape: (th) => {
        const c = Math.cos(th), s = Math.sin(th);
        let x = Math.sign(s) * Math.abs(s) ** (2 / 2.6);
        let y = c >= 0 ? top * Math.abs(c) ** (2 / 2.4) : bot * Math.abs(c) ** (2 / 5);
        // the heavy brow over each eye, the ridge of the nose, flaring nostrils
        y += c > 0 ? Math.exp(-(((z - 0.42) / 0.16) ** 2)) * Math.exp(-(((Math.abs(x) - 0.62) / 0.22) ** 2)) * 0.12 : 0;
        y += c > 0 ? Math.exp(-((x / 0.18) ** 2)) * 0.03 * smooth(clamp((z - 0.6) / 0.4, 0, 1)) : 0;
        x *= 1 + Math.exp(-(((z - 1.95) / 0.12) ** 2)) * 0.12 * (c > 0 ? 1 : 0);
        return [x, y];
      } };
    }, V(0, 1, 0), [2, 1.4]);
    const g = L.g; const R = new Float32Array(g.attributes.position.count); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < -0.05 && z > 0.1 && Math.abs(x) < 0.22 + 0.0) R[i] = MOUTH;                         // the palate
      if (Math.hypot(Math.abs(x) - 0.36, y - 0.25, z - 0.5) < 0.12) R[i] = MOUTH;                   // deep eye sockets
      if (Math.hypot(Math.abs(x) - 0.13, y - 0.17, z - 2.02) < 0.045) R[i] = MOUTH;                 // nostrils
    }
    g.setAttribute('region', new THREE.BufferAttribute(R, 1)); toWorld(g, 'head');
    parts.push({ geo: g, weights: new Array(p.count).fill(['head', 1, 'head', 0]) });
    const H = (geo, region = HORN) => rigid(toWorld(geo, 'head'), 'head', region);
    for (const s of [-1, 1]) {
      // the great horns: back from the crown, out and down, ringed with growth ridges
      H(tube([V(s * 0.3, 0.36, -0.2), V(s * 0.42, 0.62, -0.75), V(s * 0.62, 0.66, -1.5), V(s * 0.9, 0.38, -2.25), V(s * 1.0, -0.06, -2.75)], 0.19, 0.012, 9, 32, 0.06));
      // a second, smaller pair below them, and a crown of spikes along the back of the skull
      H(tube([V(s * 0.44, 0.18, -0.25), V(s * 0.66, 0.24, -0.7), V(s * 0.86, 0.12, -1.15)], 0.1, 0.008, 7, 16, 0.05));
      for (let i = 0; i < 3; i++) H(tube([V(s * (0.18 + i * 0.12), 0.44 - i * 0.06, -0.35 - i * 0.05), V(s * (0.22 + i * 0.16), 0.6 - i * 0.08, -0.75 - i * 0.05)], 0.05, 0.005, 6, 8));
      // short horns over the brow
      H(tube([V(s * 0.42, 0.42, 0.42), V(s * 0.5, 0.56, 0.18), V(s * 0.56, 0.6, -0.05)], 0.055, 0.006, 6, 10));
      // spikes along the cheek
      for (let i = 0; i < 4; i++) H(tube([V(s * 0.46, -0.05 - i * 0.04, 0.2 - i * 0.2), V(s * (0.62 + i * 0.03), -0.1 - i * 0.05, -0.12 - i * 0.22)], 0.04, 0.004, 5, 6));
      // teeth along the upper jaw, a long fang near the front
      for (let i = 0; i < 11; i++) {
        const z = 0.45 + i * 0.15, w = lerp(0.42, 0.2, (z - 0.45) / 1.6) * 0.86; const fang = i === 8 ? 2.1 : 1;
        const len = (0.1 + r() * 0.06) * fang; const t = tube([V(0, 0, 0), V(0, -len * 0.6, len * 0.12), V(0, -len, len * 0.05)], 0.035 * Math.sqrt(fang), 0.003, 5, 6);
        t.translate(s * w, lerp(-0.18, -0.09, (z - 0.45) / 1.6) + 0.02, z); H(t, TOOTH);
      }
    }
    // the jaw (jaw-local)
    const jsec = [[-0.8, 0.36, 0.06, -0.24], [-0.35, 0.39, 0.08, -0.3], [0.25, 0.32, 0.07, -0.25], [0.85, 0.26, 0.06, -0.18], [1.35, 0.22, 0.05, -0.13], [1.75, 0.15, 0.045, -0.09], [1.9, 0.03, 0.03, -0.04]];
    const JL = loft(jsec.map((s) => V(0, 0, s[0])), 44, 24, (u) => {
      const f = u * (jsec.length - 1), i = Math.min(jsec.length - 2, Math.floor(f)), t = smooth(f - i); const a = jsec[i], b = jsec[i + 1];
      const w = lerp(a[1], b[1], t), top = lerp(a[2], b[2], t), bot = lerp(a[3], b[3], t);
      return { rx: w, ry: 1, shape: (th) => { const c = Math.cos(th), s = Math.sin(th); return [Math.sign(s) * Math.abs(s) ** (2 / 3), c >= 0 ? top * Math.abs(c) ** 0.3 : bot * Math.abs(c) ** (2 / 1.7)]; } };
    }, V(0, 1, 0), [2, 1.4]);
    const jp = JL.g.attributes.position; const JR = new Float32Array(jp.count);
    for (let i = 0; i < jp.count; i++) if (jp.getY(i) > 0.02 && Math.abs(jp.getX(i)) < 0.2 && jp.getZ(i) > -0.2) JR[i] = MOUTH;
    JL.g.setAttribute('region', new THREE.BufferAttribute(JR, 1)); toWorld(JL.g, 'jaw');
    parts.push({ geo: JL.g, weights: new Array(jp.count).fill(['jaw', 1, 'jaw', 0]) });
    for (const s of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const z = 0.15 + i * 0.16, w = lerp(0.32, 0.15, z / 1.7) * 0.84; const fang = i === 8 ? 1.8 : 1; const len = (0.09 + r() * 0.05) * fang;
        const t = tube([V(0, 0, 0), V(0, len * 0.6, len * 0.1), V(0, len, 0.0)], 0.03 * Math.sqrt(fang), 0.003, 5, 6); t.translate(s * w, 0.05, z);
        rigid(toWorld(t, 'jaw'), 'jaw', TOOTH);
      }
      // a beard of spikes under the chin
      for (let i = 0; i < 3; i++) rigid(toWorld(tube([V(s * (0.06 + i * 0.05), -0.2 + i * 0.03, 1.1 - i * 0.35), V(s * (0.09 + i * 0.07), -0.42 + i * 0.03, 0.85 - i * 0.4)], 0.035, 0.003, 5, 6), 'jaw'), 'jaw', HORN);
      // a frill of spikes from the back of the jaw
      for (let i = 0; i < 3; i++) rigid(toWorld(tube([V(s * 0.34, -0.12 - i * 0.07, -0.55 - i * 0.05), V(s * (0.5 + i * 0.05), -0.25 - i * 0.12, -1.05 - i * 0.1)], 0.05, 0.004, 5, 8), 'jaw'), 'jaw', HORN);
    }
  }

  // ---- hind legs: heavy thighs, a backward knee, taloned feet
  for (const [s, k] of [[-1, 'R'], [1, 'L']]) {
    const hip = V(s * 0.72, 3.75, 0.05), knee = W['shin' + k], ankle = W['foot' + k];
    const leg = chainLoft([hip, hip.clone().lerp(knee, 0.5).add(V(s * 0.12, 0, 0.14)), knee, knee.clone().lerp(ankle, 0.5).add(V(0, 0, -0.14)), ankle, ankle.clone().add(V(0, -0.08, 0.2))],
      ['thigh' + k, 'thigh' + k, 'shin' + k, 'shin' + k, 'foot' + k], [[0.66, 0.82], [0.56, 0.7], [0.3, 0.34], [0.24, 0.28], [0.15, 0.17], [0.16, 0.12]], { rings: 54, seg: 20, up: V(0, 0, 1), rootBone: 'hips' });
    parts.push(leg);
    // the foot: three long toes forward, one back, each ending in a hooked talon
    const toes = [[-0.3, 1.0], [0, 1.15], [0.3, 0.95], [Math.PI, 0.5]];
    for (const [ang, len] of toes) {
      const d = V(Math.sin(ang) * s, 0, Math.cos(ang)); const a = ankle.clone().add(V(0, -0.05, 0));
      const mid = a.clone().addScaledVector(d, len * 0.5).add(V(0, -0.02, 0)), end = a.clone().addScaledVector(d, len).add(V(0, -0.12, 0));
      rigid(tube([a, mid, end], 0.12, 0.07, 10, 10), 'foot' + k, SCALE);
      rigid(tube([end, end.clone().addScaledVector(d, 0.2).add(V(0, 0.02, 0)), end.clone().addScaledVector(d, 0.34).add(V(0, -0.2, 0))], 0.065, 0.004, 7, 10), 'foot' + k, CLAW);
    }
  }

  // ---- wing arms and finger bones
  for (const [s, k] of [[-1, 'R'], [1, 'L']]) {
    const sh = V(s * 0.55, 4.7, 3.1), el = W['wing2' + k], wr = W['wing3' + k];
    const arm = chainLoft([sh, sh.clone().lerp(el, 0.5).add(V(0, 0.15, 0)), el, el.clone().lerp(wr, 0.5).add(V(0, 0.08, 0)), wr, wr.clone().add(V(s * 0.25, 0.02, -0.04))],
      ['wing1' + k, 'wing1' + k, 'wing2' + k, 'wing2' + k, 'wing3' + k], [[0.44, 0.52], [0.34, 0.4], [0.2, 0.22], [0.16, 0.17], [0.15, 0.15], [0.1, 0.1]], { rings: 50, seg: 14, rootBone: 'chest' });
    parts.push(arm);
    ['f1', 'f2', 'f3'].forEach((f, i) => {
      const tip = wr.clone().add(V(s * FINGERS[f][0], FINGERS[f][1], FINGERS[f][2]));
      rigid(tube([wr, wr.clone().lerp(tip, 0.5).add(V(0, 0.12, 0)), tip], 0.12 - i * 0.015, 0.02, 7, 18, 0.03), f + k, SCALE);
      const dir = tip.clone().sub(wr).normalize(); rigid(tube([tip.clone().addScaledVector(dir, -0.05), tip.clone().addScaledVector(dir, 0.18).add(V(0, 0.03, 0)), tip.clone().addScaledVector(dir, 0.3).add(V(0, -0.08, 0))], 0.035, 0.003, 6, 8), f + k, CLAW);
    });
    // the thumb: a hooked claw at the wrist
    rigid(tube([wr.clone().add(V(0, 0.05, 0.05)), wr.clone().add(V(s * 0.15, 0.25, 0.45)), wr.clone().add(V(s * 0.1, 0.05, 0.75))], 0.09, 0.006, 7, 10), 'wing3' + k, CLAW);
  }

  // ---- assemble the hide
  const hipsW = W.hips;
  const tplParts = parts.map((p) => { p.geo.translate(-hipsW.x, -hipsW.y, -hipsW.z); return { joint: 'hips', geo: p.geo, weights: p.weights }; });
  const body = buildTemplate(DRAGON_JOINTS, tplParts);
  const wings = buildTemplate(DRAGON_JOINTS, [membrane(-1, 'R', W), membrane(1, 'L', W)]);
  return { body, wings };
}

// Wing membrane panels (wing1-local), skinned by distance to the wing bones; scalloped between the fingers
function membrane(s, k, Wj) {
  const O = V(0, 0, 0), E = V(s * 2.6, 0.2, -0.3), Wr = E.clone().add(V(s * 3.4, 0, -0.6));
  const T = ['f1', 'f2', 'f3'].map((f) => Wr.clone().add(V(s * FINGERS[f][0], FINGERS[f][1], FINGERS[f][2])));
  const H = V(s * 0.1, -1.0, -3.4);
  const segs = [['wing1' + k, O, E], ['wing2' + k, E, Wr], ['f1' + k, Wr, T[0]], ['f2' + k, Wr, T[1]], ['f3' + k, Wr, T[2]], ['hips', H, H]];
  const segDist = (p, a, b) => { const ab = b.clone().sub(a); const t = ab.lengthSq() ? clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0; return a.clone().addScaledVector(ab, t).distanceTo(p); };
  const pos = [], uv = [], idx = [];
  const tri = (A, B, C, scallop, u0) => {
    const n = 12; const map = {};
    for (let i = 0; i <= n; i++) for (let jj = 0; jj <= n - i; jj++) {
      const a = i / n, b = jj / n, c = 1 - a - b;
      const p = V(0, 0, 0).addScaledVector(A, c).addScaledVector(B, a).addScaledVector(C, b);
      if (scallop && c < 1e-6) p.lerp(A, Math.sin(a * Math.PI) * 0.26);
      p.y -= Math.sin(a * Math.PI) * Math.sin(b * Math.PI) * 0.3 + Math.sin(a * 9 + b * 7) * 0.03;   // billow, and creases in the skin
      map[i + ',' + jj] = pos.length / 3; pos.push(p.x, p.y, p.z); uv.push(u0 + a * 0.5 + b * 0.25, b * 0.8 + a * 0.2);
    }
    for (let i = 0; i < n; i++) for (let jj = 0; jj < n - i; jj++) {
      const a = map[i + ',' + jj], b = map[(i + 1) + ',' + jj], c = map[i + ',' + (jj + 1)]; idx.push(a, b, c);
      if (jj < n - i - 1) { const d = map[(i + 1) + ',' + (jj + 1)]; idx.push(b, d, c); }
    }
  };
  tri(Wr, T[0], T[1], true, 0); tri(Wr, T[1], T[2], true, 0.5); tri(Wr, T[2], H, true, 1); tri(Wr, H, E, false, 1.5); tri(E, H, O, false, 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return {
    joint: 'wing1' + k, geo: g,
    skin: (x, y, z) => {
      const p = V(x, y, z);
      const ws = segs.map(([name, a, b]) => [name, 1 / Math.pow(segDist(p, a, b) + 0.15, 3)]).sort((A, B) => B[1] - A[1]);
      const t = ws[0][1] + ws[1][1]; return [ws[0][0], ws[0][1] / t, ws[1][0], ws[1][1] / t];
    },
  };
}

// ---------------------------------------------------------------- materials
// the hide: near-black scales, bronze-brown at the edges, a paler plated belly; teeth like old ivory, horns and
// talons darkening to black at the tips; deep red mouth. Heat shows through the scales of the throat and chest
// when he draws breath for fire.
export function dragonHideMaterial() {
  const st = dragonScales();
  const u = { uHit: { value: 0 }, uBreath: { value: 0 }, uGlow: { value: 1 }, uDissolve: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), emissive: 0xff4010, emissiveIntensity: 1, roughness: 0.5, metalness: 0.2 });
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nflat varying float vReg;\nvarying vec3 vBindN;\nvarying vec3 vBindP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = region; vBindN = objectNormal; vBindP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vReg; varying vec3 vBindN; varying vec3 vBindP; uniform float uHit, uBreath, uGlow;
        float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `
        vec4 sc = texture2D(map, vMapUv);
        float belly = smoothstep(-0.25, -0.75, normalize(vBindN).y) * step(vReg, 0.5);
        float mott = dn(vBindP * 1.3) * 0.6 + dn(vBindP * 4.0) * 0.4;
        float sh = sc.r, tint = sc.g;   // the scale's height (0 in the gaps, 1 on its keel) and its own shade
        vec3 hide = mix(vec3(0.018, 0.015, 0.015), vec3(0.085, 0.066, 0.056) * (0.7 + 0.6 * tint), smoothstep(0.1, 0.75, sh)) * (0.75 + 0.5 * mott);
        // the belly: broad overlapping plates across it rather than scales
        float plate = fract(vMapUv.y * 0.55); float seam = smoothstep(0.0, 0.08, plate) * smoothstep(1.0, 0.86, plate);
        vec3 bellyC = vec3(0.21, 0.17, 0.12) * (0.55 + 0.45 * seam) * (0.85 + 0.3 * mott);
        hide = mix(hide, bellyC, belly * 0.9);
        float rH = step(abs(vReg - 1.0), 0.4), rM = step(abs(vReg - 3.0), 0.4), rT = step(abs(vReg - 4.0), 0.4), rC = step(abs(vReg - 5.0), 0.4);
        float tipK = clamp(dn(vBindP * 9.0) * 0.4 + 0.3, 0.0, 1.0);
        vec3 horn = mix(vec3(0.16, 0.13, 0.1), vec3(0.03, 0.025, 0.025), tipK) * (0.8 + 0.4 * dn(vBindP * 30.0));
        vec3 tooth = vec3(0.62, 0.56, 0.44) * (0.85 + 0.25 * dn(vBindP * 40.0));
        vec3 claw = vec3(0.04, 0.035, 0.03);
        vec3 mouth = vec3(0.12, 0.02, 0.02);
        diffuseColor.rgb = hide * (1.0 - rH - rM - rT - rC) + horn * rH + mouth * rM + tooth * rT + claw * rC;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.75, 0.32, sh), 0.6, belly) * (1.0 - rH - rT - rC - rM) + 0.5 * rH + 0.3 * rT + 0.25 * rC + 0.35 * rM;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.25 * (1.0 - rH - rT - rC - rM);')
      .replace('#include <emissivemap_fragment>', `
        vec3 em = vec3(1.0 - smoothstep(0.02, 0.12, sc.r));
        // heat in the cracks of the throat and chest, flaring as he breathes fire
        float throat = smoothstep(-0.1, -0.6, normalize(vBindN).y) * smoothstep(1.5, 3.5, vBindP.z) * (1.0 - rH - rT - rC);
        totalEmissiveRadiance = vec3(1.0, 0.28, 0.05) * em.r * (0.015 + throat * 2.6 * uBreath) * uGlow;
        totalEmissiveRadiance += vec3(0.5, 0.05, 0.0) * rM * uBreath * 1.5;
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit;`);
  };
  m.customProgramCacheKey = () => 'dragonHide-v2';
  return m;
}
// overlapping scales, tiling seamlessly: R = height (keel 1, gaps 0), G = each scale's own shade
function dragonScales() {
  const S = 512, cols = 10, rows = 16, w = S / cols, h = S / rows * 1.9;
  const hc = document.createElement('canvas'); hc.width = hc.height = S; const hx = hc.getContext('2d', { willReadFrequently: true });
  const tc = document.createElement('canvas'); tc.width = tc.height = S; const tx = tc.getContext('2d', { willReadFrequently: true });
  hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S); tx.fillStyle = '#808080'; tx.fillRect(0, 0, S, S);
  const r = rng(31);
  for (let row = rows + 1; row >= -1; row--) for (let col = -1; col <= cols; col++) {
    const cx = col * w + (row % 2 ? w / 2 : 0) + (r() - 0.5) * w * 0.08, cy = row * (S / rows) + (r() - 0.5) * 2; const shade = Math.floor(70 + r() * 120);
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const x = cx + ox, y = cy + oy; if (x < -w || x > S + w || y < -h || y > S + h) continue;
      const g = hx.createRadialGradient(x, y - h * 0.15, 1, x, y, h * 0.62);
      g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#b0b0b0'); g.addColorStop(0.9, '#303030'); g.addColorStop(1, '#101010');
      hx.fillStyle = g; hx.beginPath(); hx.moveTo(x - w * 0.52, y - h * 0.25); hx.quadraticCurveTo(x - w * 0.55, y + h * 0.35, x, y + h * 0.55); hx.quadraticCurveTo(x + w * 0.55, y + h * 0.35, x + w * 0.52, y - h * 0.25); hx.lineTo(x, y - h * 0.6); hx.closePath(); hx.fill();
      hx.strokeStyle = 'rgba(255,255,255,0.35)'; hx.lineWidth = 2; hx.beginPath(); hx.moveTo(x, y - h * 0.3); hx.lineTo(x, y + h * 0.45); hx.stroke();   // the keel
      tx.fillStyle = `rgb(${shade},${shade},${shade})`; tx.beginPath(); tx.ellipse(x, y + h * 0.1, w * 0.5, h * 0.42, 0, 0, 7); tx.fill();
    }
  }
  const hd = hx.getImageData(0, 0, S, S).data, td = tx.getImageData(0, 0, S, S).data;
  const H = new Float32Array(S * S); for (let i = 0; i < H.length; i++) H[i] = hd[i * 4] / 255;
  const dc = document.createElement('canvas'); dc.width = dc.height = S; const dx = dc.getContext('2d'); const img = dx.createImageData(S, S);
  for (let i = 0; i < H.length; i++) { img.data[i * 4] = hd[i * 4]; img.data[i * 4 + 1] = td[i * 4]; img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = 255; }
  dx.putImageData(img, 0, 0);
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  return { map: mk(dc), normalMap: mk(normalFromHeight(H, S, S, 2.5)) };
}

// leathery wings: dark, veined, thin enough that light behind them glows through red
export function dragonWingMaterial() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); const r = rng(77);
  x.fillStyle = '#1c0f0d'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1600; i++) { x.fillStyle = `rgba(${40 + r() * 30},${18 + r() * 10},${14 + r() * 8},${0.08 + r() * 0.12})`; x.beginPath(); x.arc(r() * 512, r() * 512, 2 + r() * 14, 0, 7); x.fill(); }
  const vein = (x0, y0, a, w, d) => {
    let px = x0, py = y0; x.lineWidth = w; x.strokeStyle = `rgba(110,30,22,${0.35 + w * 0.08})`; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 18; k++) { a += (r() - 0.5) * 0.5; px += Math.cos(a) * 12; py += Math.sin(a) * 12; x.lineTo(px, py); if (d < 3 && r() < 0.12) { x.stroke(); vein(px, py, a + (r() - 0.5) * 1.6, w * 0.6, d + 1); x.beginPath(); x.moveTo(px, py); } }
    x.stroke();
  };
  for (let i = 0; i < 14; i++) vein(r() * 512, r() * 512, r() * 7, 3, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  const u = { uHit: { value: 0 }, uLightDir: { value: new THREE.Vector3(0, 1, 0) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHit; uniform vec3 uLightDir;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // light through the membrane, seen from the shadowed side: the skin glows red and the veins show dark
        vec3 V = normalize(vViewPosition);
        float back = pow(clamp(dot(-V, normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz)), 0.0, 1.0), 2.0);
        totalEmissiveRadiance += vec3(0.45, 0.08, 0.03) * back * (1.4 - diffuseColor.r * 4.0) * 0.6 + vec3(1.0) * uHit * 0.5;`);
  };
  m.customProgramCacheKey = () => 'dragonWing-v1';
  return m;
}
// eyes: deep-set, burning amber, a black slit
export function dragonEyes() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, '#fff2a0'); g.addColorStop(0.45, '#ffaa20'); g.addColorStop(0.8, '#c03808'); g.addColorStop(1, '#300800');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#000'; x.beginPath(); x.ellipse(64, 64, 7, 54, 0, 0, 7); x.fill();
  for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(90,20,0,${Math.random() * 0.4})`; x.beginPath(); const a = Math.random() * 7; x.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14); x.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false });
  const grp = new THREE.Group();
  for (const s of [-1, 1]) {
    const geo = new THREE.SphereGeometry(0.075, 20, 14); geo.rotateY(-Math.PI / 2);   // the texture's centre (the slit) faces forward
    const e = new THREE.Mesh(geo, mat); e.position.set(s * 0.37, 0.27, 0.5); e.rotation.y = s * 0.55; e.scale.set(1, 0.72, 1); grp.add(e);
  }
  return grp;
}
