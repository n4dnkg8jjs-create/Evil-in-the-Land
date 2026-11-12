// The Great Dragon's body: a wyvern built over a real skeleton. He goes on four limbs like a bat or a pterosaur: the
// heavy hind legs (thigh, shin, a long hock, taloned feet) and the wrists of the wings. A deep keeled chest for the
// flight muscles, a long neck, a tail as long again as the body to balance it. One continuous skinned hide runs from
// the tip of the tail to the back of the skull (lofted along the spine, so there are no seams between parts); the
// skull is a heavy wedge with brow ridges over sunken eyes, ten horns, a hinged jaw with teeth and a forked tongue,
// and a pouch of loose hide under the throat where the fire is kindled. The wings are an arm, a forearm and four long
// fingers with the membrane stretched between them, back to the flank and forward of the elbow.
//
// Everything here is authored in the model's own space at rest (wings spread, neck raised): +z forward, +x his LEFT,
// y = 0 the ground under his feet, the origin under the middle of the body (between the shoulders and the hips).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, rng } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// what a vertex is made of (the hide shader paints by it)
const HIDE = 0, HORN = 1, LIMB = 2, MOUTH = 3, TOOTH = 4, CLAW = 5, TONGUE = 6, PIT = 7;
const Z0 = 2.0;   // the hips sit this far behind the origin

// ---------------------------------------------------------------- skeleton
const JOINTS = [], AT = {};
const jt = (name, parent, x, y, z) => { JOINTS.push({ name, parent }); AT[name] = V(x, y, z - Z0); };
jt('hips', null, 0, 4.1, 0); jt('spine', 'hips', 0, 4.3, 2.1); jt('chest', 'spine', 0, 4.45, 4.2);
[[4.9, 5.6], [5.55, 6.55], [6.3, 7.4], [7.05, 8.25], [7.65, 9.25], [8.0, 10.35]].forEach(([y, z], i) => jt('neck' + (i + 1), i ? 'neck' + i : 'chest', 0, y, z));
jt('head', 'neck6', 0, 8.1, 11.45); jt('jaw', 'head', 0, 7.8, 11.75);
[4.0, 3.85, 3.62, 3.32, 2.98, 2.62, 2.3, 2.05, 1.88, 1.78].forEach((y, i) => jt('tail' + (i + 1), i ? 'tail' + i : 'hips', 0, y, -1.6 - i * 1.42));
export const DRAGON_FINGERS = { f1: [10.4, -0.25, 0.4], f2: [9.5, -0.5, -4.4], f3: [6.1, -0.55, -8.4], f4: [1.1, -0.45, -8.7] };
for (const [s, k] of [[-1, 'R'], [1, 'L']]) {
  jt('thigh' + k, 'hips', s * 1.3, 4.0, 0.3); jt('shin' + k, 'thigh' + k, s * 2.0, 2.45, 1.7); jt('meta' + k, 'shin' + k, s * 2.0, 1.3, -0.5); jt('foot' + k, 'meta' + k, s * 2.0, 0.25, 0.3);
  jt('wing1' + k, 'chest', s * 1.2, 5.0, 3.9); jt('wing2' + k, 'wing1' + k, s * 4.5, 5.45, 3.4); jt('wing3' + k, 'wing2' + k, s * 8.6, 5.25, 4.4);
  for (const f in DRAGON_FINGERS) jt(f + k, 'wing3' + k, s * 8.6, 5.25, 4.4);
}
export const DRAGON_REST = AT;

// ---------------------------------------------------------------- geometry builders
// A loft: rings of `seg` vertices along a smooth path. section(u, C) -> { rx, ry, yo, shape(theta) -> [sx, sy] }.
// uv: x runs round the ring (uRep times), y runs along it; with `conformal` y advances with the girth, so a scale
// keeps its proportions from the thick of the body to the tip of the tail.
function loft(points, nRings, seg, section, { up = V(0, 1, 0), uRep = 1, vRep = 1, conformal = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos = [], uv = [], idx = [], ringT = [];
  let vv = 0, prev = null;
  for (let i = 0; i <= nRings; i++) {
    const u = i / nRings, C = curve.getPoint(u), T = curve.getTangent(u).normalize();
    const sec = section(u, C);
    if (prev) { const ds = prev.distanceTo(C); vv += conformal ? ds * uRep / Math.max(0.2, Math.PI * (sec.rx + sec.ry)) : ds * vRep; } prev = C.clone();
    let upv = up.clone().sub(T.clone().multiplyScalar(up.dot(T))); if (upv.lengthSq() < 1e-6) upv = V(1, 0, 0); upv.normalize();
    const side = new THREE.Vector3().crossVectors(upv, T).normalize();   // +x on the left of a creature facing +z
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, [sx, sy] = sec.shape(th);
      const p = C.clone().addScaledVector(side, sx * sec.rx).addScaledVector(upv, sy * sec.ry + (sec.yo || 0));
      pos.push(p.x, p.y, p.z); uv.push((k / seg) * uRep, vv); ringT.push(u);
    }
  }
  for (let i = 0; i < nRings; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return { g, ringT, curve };
}
const se = (p, q = p) => (th) => { const c = Math.cos(th), s = Math.sin(th); return [Math.sign(s) * Math.abs(s) ** (2 / p), Math.sign(c) * Math.abs(c) ** (2 / (c < 0 ? q : p))]; };
const fillAttr = (g, name, v) => { g.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); return g; };
// a limb as one unbroken tube through its joints, each stretch skinned to its own bone and blended across the
// joints, so a bent knee or elbow folds the hide rather than opening a gap
function chainLoft(points, owners, radii, { rings = 40, seg = 16, up = V(0, 1, 0), rootBone = null, shape = se(2.3), uRep = 2 } = {}) {
  const nP = points.length;
  const at = (u) => { const f = u * (nP - 1), i = Math.min(nP - 2, Math.floor(f)), t = smooth(f - i); const a = radii[i], b = radii[i + 1]; return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]; };
  const L = loft(points, rings, seg, (u) => { const [rx, ry] = at(u); return { rx, ry, shape }; }, { up, uRep, conformal: true });
  const w = L.ringT.map((u) => {
    const f = u * (nP - 1), k = Math.min(nP - 2, Math.floor(f)), t = f - k, o = owners[k];
    if (k === 0 && rootBone && t < 0.5) return [o, 0.35 + t * 1.3, rootBone, 0.65 - t * 1.3];
    if (t < 0.5 && k > 0 && owners[k - 1] !== o) return [o, 0.5 + t, owners[k - 1], 0.5 - t];
    if (t >= 0.5 && k < nP - 2 && owners[k + 1] !== o) return [o, 1.5 - t, owners[k + 1], t - 0.5];
    return [o, 1];
  });
  return { geo: fillAttr(L.g, 'region', LIMB), weights: w };
}
// a tapering horn, claw, tooth or finger bone along a curve, ringed with growth ridges
function tube(points, r0, r1, seg = 8, rings = 20, ridge = 0, pw = 0.8) {
  const { g } = loft(points, rings, seg, (u) => { const r = lerp(r0, r1, Math.pow(u, pw)) * (1 + ridge * Math.sin(u * 52) * (1 - u)); return { rx: r, ry: r, shape: se(2) }; }, { up: V(0.13, 1, 0.31).normalize(), uRep: 1, vRep: 0.6 });
  return g;
}
// a flattened, raked blade (a dorsal spine)
function blade(base, h, thick, rake) {
  const g = new THREE.ConeGeometry(base, h, 5, 3); g.translate(0, h / 2, 0); g.scale(thick, 1, 1);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) / h; p.setZ(i, p.getZ(i) - rake * y * y * h); }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- the model
// -> { mesh (the hide, with the skeleton), wingMesh, B (bones by name), hideMat, wingMat, eyes, tris }
export function buildDragonModel() {
  const r = rng(6660);
  const parts = [];   // { geo (model space), weights: per vertex [bone, w, bone, w, ...] | bone: name }
  const rigid = (geo, bone, region) => { fillAttr(geo, 'region', region); parts.push({ geo, bone }); return geo; };
  const local = (geo, joint) => geo.translate(AT[joint].x, AT[joint].y, AT[joint].z);

  // ---- the hide: tail tip -> skull, skinned along the chain
  const chain = [['tail10', 0.13, 0.14, 0, 0], ['tail9', 0.21, 0.23, 0, 0], ['tail8', 0.30, 0.33, 0, 0], ['tail7', 0.40, 0.44, 0, 0], ['tail6', 0.50, 0.56, 0, 0], ['tail5', 0.61, 0.68, 0, 0], ['tail4', 0.73, 0.82, 0, 0],
    ['tail3', 0.86, 0.97, -0.02, 0], ['tail2', 1.0, 1.13, -0.05, 0], ['tail1', 1.17, 1.32, -0.08, 0.1], ['hips', 1.46, 1.55, -0.14, 0.12], ['spine', 1.3, 1.55, -0.28, 0.25], ['chest', 1.58, 2.0, -0.66, 0.5],
    ['neck1', 1.1, 1.3, -0.32, 0.3], ['neck2', 0.9, 1.05, -0.13, 0.1], ['neck3', 0.78, 0.9, -0.05, 0], ['neck4', 0.7, 0.8, 0, 0], ['neck5', 0.64, 0.74, -0.02, 0], ['neck6', 0.6, 0.74, -0.09, 0], ['head', 0.56, 0.7, -0.12, 0]];
  const pts = [AT.tail10.clone().add(V(0, -0.06, -1.7)), ...chain.map((c) => AT[c[0]].clone()), AT.head.clone().add(V(0, 0.02, 0.45))];
  const prof = [[0.03, 0.03, 0, 0], ...chain.map((c) => c.slice(1)), [0.42, 0.5, -0.1, 0]];
  // owner bone of the stretch from pts[k] to pts[k+1] (a bone runs from its own joint to the next one out)
  const owner = ['tail10', 'tail9', 'tail8', 'tail7', 'tail6', 'tail5', 'tail4', 'tail3', 'tail2', 'tail1', 'hips', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'neck3', 'neck4', 'neck5', 'neck6', 'head'];
  const nP = pts.length;
  const profAt = (u) => { const f = u * (nP - 1), i = Math.min(nP - 2, Math.floor(f)), s = smooth(f - i), a = prof[i], b = prof[i + 1]; return [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s), lerp(a[3], b[3], s)]; };
  const U_HIPS = 11 / (nP - 1), U_CHEST = 13 / (nP - 1), U_NECK = 14 / (nP - 1);
  const hide = loft(pts, 250, 32, (u) => {
    const [rx, ry, yo, keel] = profAt(u);
    return { rx, ry, yo, shape: (th) => {
      const c = Math.cos(th), s = Math.sin(th);
      let sx = Math.sign(s) * Math.abs(s) ** (2 / 2.4), sy = Math.sign(c) * Math.abs(c) ** (2 / (c < 0 ? 2.9 : 2.2));
      sy += Math.max(0, c) ** 14 * 0.14;                                   // the ridge of the spine
      const hump = Math.exp(-(((u - U_CHEST) / 0.03) ** 2)) * 0.2 + Math.exp(-(((u - U_HIPS) / 0.032) ** 2)) * 0.16;   // shoulders, haunches
      sx *= 1 + hump * Math.max(0, c + 0.25) * Math.abs(s);
      if (c < 0) { sx *= 1 - keel * c * c * 0.75; sy *= 0.94; }            // the keel of the breast: narrow and deep below
      return [sx, sy];
    } };
  }, { uRep: 3, conformal: true });
  {
    const wts = hide.ringT.map((u) => {
      const f = u * (nP - 1), k = Math.min(nP - 2, Math.floor(f)), t = f - k, o = owner[k];
      if (t < 0.5 && k > 0 && owner[k - 1] !== o) return [o, 0.5 + t, owner[k - 1], 0.5 - t];
      if (t >= 0.5 && k < nP - 2 && owner[k + 1] !== o) return [o, 1.5 - t, owner[k + 1], t - 0.5];
      return [o, 1];
    });
    fillAttr(hide.g, 'region', HIDE);
    // where the fire shows through: the underside of the neck and the breast, most of all the pouch under the jaw
    const P = hide.g.attributes.position, N = hide.g.attributes.normal, heat = new Float32Array(P.count);
    for (let i = 0; i < P.count; i++) { const u = hide.ringT[i]; heat[i] = smooth(clamp((-N.getY(i) + 0.15) / 0.8, 0, 1)) * smooth(clamp((u - U_CHEST + 0.03) / 0.06, 0, 1)) * (0.55 + 0.45 * smooth(clamp((u - 0.86) / 0.1, 0, 1))); }
    hide.g.setAttribute('heat', new THREE.Float32BufferAttribute(heat, 1));
    parts.push({ geo: hide.g, weights: wts });
    const top = (u) => { const C = hide.curve.getPoint(u), [, ry, yo] = profAt(u); return { C, T: hide.curve.getTangent(u).normalize(), y: yo + ry * 1.12, ry, k: Math.min(nP - 2, Math.floor(u * (nP - 1))) }; };
    // a crest of spines down the neck, the back and the tail: tallest over the shoulders, raked back
    for (let i = 0; i < 58; i++) {
      const u = lerp(0.07, 0.965, i / 57), q = top(u);
      const big = Math.exp(-(((u - U_CHEST) / 0.2) ** 2)) * 0.8 + 0.28 + (u > U_NECK ? 0.1 : 0);
      const h = (0.22 + q.ry * 0.62) * big * (0.8 + r() * 0.4);
      const g = blade(h * 0.3, h, 0.3, 0.5);
      g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.asin(clamp(q.T.y, -1, 1)), Math.atan2(q.T.x, q.T.z), 0, 'YXZ')));
      g.translate(q.C.x, q.C.y + q.y - 0.07, q.C.z);
      rigid(g, owner[q.k], HORN);
    }
    // two rows of keeled bone plates along the back, either side of the crest
    for (let i = 0; i < 44; i++) for (const s of [-1, 1]) {
      const u = lerp(0.2, 0.9, (i + (s > 0 ? 0.5 : 0)) / 44), q = top(u), [rx, ry, yo] = profAt(u);
      const th = s * 0.52, c = Math.cos(th), sn = Math.sin(th);
      const sz = (0.1 + ry * 0.2) * (0.8 + r() * 0.4);
      const g = new THREE.ConeGeometry(sz, sz * 0.9, 4, 1); g.rotateY(Math.PI / 4); g.scale(0.7, 1, 1.5); g.translate(0, sz * 0.25, 0);
      g.rotateZ(-th * 0.9); g.rotateY(Math.atan2(q.T.x, q.T.z));
      g.translate(q.C.x + Math.abs(sn) ** (2 / 2.4) * s * rx * 0.98, q.C.y + yo + c ** (2 / 2.2) * ry * 0.98, q.C.z);
      rigid(g, owner[q.k], HORN);
    }
    // the tail ends in a spray of long bone spikes
    for (let i = 0; i < 8; i++) {
      const s = i % 2 ? 1 : -1, len = 1.5 - Math.floor(i / 2) * 0.22, z = AT.tail10.z - 0.25 - Math.floor(i / 2) * 0.34, y = AT.tail10.y - 0.04;
      rigid(tube([V(s * 0.08, y, z), V(s * len * 0.55, y + 0.22, z - len * 0.3), V(s * len, y + 0.55, z - len * 0.75)], 0.1, 0.008, 6, 8), 'tail10', HORN);
    }
  }

  // ---- the skull (head-local, +z forward)
  {
    //            z      half-width  top   bottom
    const sec = [[-0.75, 0.44, 0.50, -0.44], [-0.3, 0.66, 0.68, -0.42], [0.2, 0.8, 0.76, -0.38], [0.7, 0.82, 0.74, -0.31], [1.05, 0.72, 0.6, -0.27], [1.5, 0.58, 0.43, -0.23],
      [2.0, 0.49, 0.38, -0.2], [2.45, 0.45, 0.37, -0.18], [2.8, 0.38, 0.32, -0.15], [3.02, 0.2, 0.16, -0.1], [3.1, 0.03, 0.03, -0.05]];
    const secAt = (z) => { let i = 0; while (i < sec.length - 2 && z > sec[i + 1][0]) i++; const a = sec[i], b = sec[i + 1], t = smooth(clamp((z - a[0]) / (b[0] - a[0]), 0, 1)); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]; };
    const L = loft(sec.map((s) => V(0, 0, s[0])), 66, 36, (u, C) => {
      const z = C.z, [w, top, bot] = secAt(z);
      return { rx: 1, ry: 1, shape: (th) => {
        const c = Math.cos(th), s = Math.sin(th), ax = Math.abs(s) ** (2 / 2.5);
        let x = Math.sign(s) * ax * w, y = c >= 0 ? top * Math.abs(c) ** (2 / 2.2) : bot * Math.abs(c) ** (2 / 4.5);
        const g = (v, m, d) => Math.exp(-(((v - m) / d) ** 2));
        if (c > 0) {
          y += g(z, 0.86, 0.3) * g(ax, 0.74, 0.24) * 0.24;                    // the heavy brow over each eye
          y += g(ax, 0, 0.2) * 0.1 * smooth(clamp((0.5 - z) / 0.8, 0, 1));    // a crest down the back of the skull
          y += g(ax, 0, 0.22) * 0.05 * smooth(clamp((z - 1.2) / 0.5, 0, 1));  // the ridge of the nose
          y += g(z, 2.72, 0.16) * g(ax, 0.55, 0.3) * 0.05;                    // the swell of the nostrils
        }
        x *= 1 + g(z, 0.86, 0.3) * g(c, 0.55, 0.3) * 0.1;                     // the brow overhangs
        x *= 1 - g(z, 1.04, 0.2) * g(c, 0.22, 0.2) * 0.26;                    // the orbit, sunk beneath it
        x *= 1 + g(z, 0.25, 0.45) * g(c, -0.05, 0.3) * 0.14;                  // cheekbones
        x *= 1 - g(z, 1.55, 0.35) * g(c, 0.15, 0.4) * 0.1;                    // the cheek falls in before the muzzle
        return [x, y];
      } };
    }, { uRep: 2, vRep: 0.7 });
    const g = L.g, p = g.attributes.position, R = new Float32Array(p.count).fill(LIMB);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), [w, , bot] = secAt(z);
      if (y < bot * 0.55 && z > -0.1 && Math.abs(x) < w * 0.8) R[i] = MOUTH;                              // the palate
      if (Math.hypot((Math.abs(x) - 0.56) * 1.4, y - 0.36, (z - 1.04) * 0.8) < 0.17) R[i] = PIT;         // deep eye sockets
      if (Math.hypot(Math.abs(x) - 0.22, (y - 0.3) * 1.4, z - 2.86) < 0.07) R[i] = PIT;                  // nostrils
    }
    g.setAttribute('region', new THREE.BufferAttribute(R, 1)); parts.push({ geo: local(g, 'head'), bone: 'head' });
    const H = (geo, region = HORN) => rigid(local(geo, 'head'), 'head', region);
    for (const s of [-1, 1]) {
      // ten horns. The two great ones: back from the crown, out, and up again at the tips (the left one broken long ago)
      const main = [V(s * 0.4, 0.6, -0.25), V(s * 0.62, 1.02, -1.0), V(s * 0.88, 1.22, -2.0), V(s * 1.14, 1.14, -3.0), V(s * 1.26, 1.42, -3.75)];
      if (s > 0) { const cut = new THREE.CatmullRomCurve3(main, false, 'centripetal'); H(tube([0, 0.2, 0.4, 0.58, 0.62].map((t) => cut.getPoint(t)), 0.27, 0.115, 9, 22, 0.06, 1.3)); }
      else H(tube(main, 0.27, 0.014, 9, 30, 0.06));
      // a second pair below them, swept back and down along the neck; a pair out of the cheekbones
      H(tube([V(s * 0.6, 0.36, -0.45), V(s * 0.96, 0.42, -1.2), V(s * 1.22, 0.2, -1.95), V(s * 1.3, -0.14, -2.6)], 0.16, 0.01, 8, 18, 0.05));
      H(tube([V(s * 0.74, -0.04, 0.1), V(s * 1.12, -0.1, -0.4), V(s * 1.38, -0.02, -1.05)], 0.125, 0.008, 7, 12, 0.05));
      // short horns over the brows, and a pair on the nose
      H(tube([V(s * 0.6, 0.84, 0.8), V(s * 0.7, 1.08, 0.48), V(s * 0.76, 1.2, 0.05)], 0.09, 0.008, 7, 10, 0.04));
      H(tube([V(s * 0.13, 0.36, 2.52), V(s * 0.15, 0.6, 2.42), V(s * 0.16, 0.76, 2.2)], 0.075, 0.008, 6, 8, 0.04));
      // lesser spikes: along the back of the skull and the cheek
      for (let i = 0; i < 3; i++) H(tube([V(s * (0.2 + i * 0.14), 0.62 - i * 0.07, -0.5 - i * 0.05), V(s * (0.26 + i * 0.2), 0.86 - i * 0.1, -1.05 - i * 0.08)], 0.06, 0.005, 5, 5));
      for (let i = 0; i < 4; i++) H(tube([V(s * 0.72, -0.16 - i * 0.03, -0.1 - i * 0.2), V(s * (0.94 + i * 0.03), -0.24 - i * 0.05, -0.5 - i * 0.22)], 0.05, 0.004, 5, 4));
      // teeth along the upper jaw: uneven, with long fangs toward the front
      for (let i = 0; i < 14; i++) {
        const z = 0.85 + i * 0.158 + (r() - 0.5) * 0.04, [w, , bot] = secAt(z), fang = i === 9 || i === 12 ? 2.3 : i === 11 ? 1.6 : 1;
        const len = (0.08 + r() * r() * 0.16) * fang;
        const t = tube([V(0, 0, 0), V(s * 0.015, -len * 0.55, -len * 0.03), V(0, -len, -len * 0.2)], 0.05 * Math.sqrt(fang), 0.004, 5, 5);
        t.translate(s * w * 0.9, bot + 0.07, z); H(t, TOOTH);
      }
    }
    for (let i = 0; i < 4; i++) { const x = (i - 1.5) * 0.11, len = 0.13 + (i % 2) * 0.04; const t = tube([V(0, 0, 0), V(0, -len * 0.6, 0), V(0, -len, -len * 0.15)], 0.04, 0.004, 5, 4); t.translate(x, -0.06, 3.0 - Math.abs(x) * 0.5); H(t, TOOTH); }

    // the jaw (jaw-local): deep at the hinge where the muscles close it, a hooked chin
    const jsec = [[-0.95, 0.5, 0.2, -0.3], [-0.4, 0.76, 0.17, -0.54], [0.3, 0.72, 0.1, -0.52], [1.0, 0.57, 0.08, -0.37], [1.6, 0.47, 0.07, -0.27], [2.1, 0.42, 0.07, -0.21], [2.42, 0.32, 0.09, -0.18], [2.58, 0.12, 0.07, -0.1], [2.64, 0.02, 0.02, -0.04]];
    const jAt = (z) => { let i = 0; while (i < jsec.length - 2 && z > jsec[i + 1][0]) i++; const a = jsec[i], b = jsec[i + 1], t = smooth(clamp((z - a[0]) / (b[0] - a[0]), 0, 1)); return [lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]; };
    const JL = loft(jsec.map((s) => V(0, 0, s[0])), 44, 26, (u, C) => {
      const [w, top, bot] = jAt(C.z);
      return { rx: 1, ry: 1, shape: (th) => { const c = Math.cos(th), s = Math.sin(th); return [Math.sign(s) * Math.abs(s) ** (2 / 3) * w, c >= 0 ? top * Math.abs(c) ** 0.3 : bot * Math.abs(c) ** (2 / 1.8)]; } };
    }, { uRep: 2, vRep: 0.7 });
    const jp = JL.g.attributes.position, JR = new Float32Array(jp.count).fill(LIMB);
    for (let i = 0; i < jp.count; i++) { const [w, top] = jAt(jp.getZ(i)); if (jp.getY(i) > top * 0.45 && Math.abs(jp.getX(i)) < w * 0.82 && jp.getZ(i) > -0.5) JR[i] = MOUTH; }
    JL.g.setAttribute('region', new THREE.BufferAttribute(JR, 1)); parts.push({ geo: local(JL.g, 'jaw'), bone: 'jaw' });
    const JW = (geo, region) => rigid(local(geo, 'jaw'), 'jaw', region);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 13; i++) {
        const z = 0.45 + i * 0.158 + (r() - 0.5) * 0.04, [w, top] = jAt(z), fang = i === 10 ? 2.0 : i === 12 ? 1.5 : 1, len = (0.07 + r() * r() * 0.15) * fang;
        const t = tube([V(0, 0, 0), V(s * 0.012, len * 0.55, -len * 0.04), V(0, len, -len * 0.14)], 0.05 * Math.sqrt(fang), 0.004, 5, 5); t.translate(s * w * 0.86, top - 0.03, z); JW(t, TOOTH);
      }
      // a beard of spikes under the chin, a frill of them from the angle of the jaw
      for (let i = 0; i < 3; i++) JW(tube([V(s * (0.08 + i * 0.07), -0.2 - i * 0.04, 2.05 - i * 0.5), V(s * (0.12 + i * 0.1), -0.62 - i * 0.03, 1.7 - i * 0.55)], 0.055, 0.004, 5, 5), HORN);
      for (let i = 0; i < 3; i++) JW(tube([V(s * 0.66, -0.2 - i * 0.12, -0.5 - i * 0.05), V(s * (0.9 + i * 0.06), -0.4 - i * 0.18, -1.2 - i * 0.12)], 0.07, 0.005, 5, 6), HORN);
      // the fork of the tongue
      JW(tube([V(s * 0.03, 0.2, 1.9), V(s * 0.09, 0.24, 2.2), V(s * 0.17, 0.2, 2.5)], 0.05, 0.006, 5, 5), TONGUE);
    }
    const tg = loft([V(0, 0.08, -0.2), V(0, 0.15, 0.6), V(0, 0.2, 1.3), V(0, 0.2, 1.95)], 12, 10, (u) => ({ rx: lerp(0.3, 0.07, u * u), ry: lerp(0.1, 0.04, u), shape: se(2.6) })).g;
    JW(tg, TONGUE);
  }

  // ---- hind legs: a great thigh, the shin raked back to the hock, the long foot-bone down to the toes
  for (const [s, k] of [[-1, 'R'], [1, 'L']]) {
    const hip = AT['thigh' + k].clone().add(V(-s * 0.35, 0.1, -0.1)), knee = AT['shin' + k], hock = AT['meta' + k], foot = AT['foot' + k];
    parts.push(chainLoft([hip, hip.clone().lerp(knee, 0.5).add(V(s * 0.16, 0.05, 0.2)), knee, knee.clone().lerp(hock, 0.5).add(V(0, 0, -0.16)), hock, hock.clone().lerp(foot, 0.5).add(V(0, 0, -0.05)), foot, foot.clone().add(V(0, -0.1, 0.3))],
      ['thigh' + k, 'thigh' + k, 'shin' + k, 'shin' + k, 'meta' + k, 'meta' + k, 'foot' + k],
      [[0.95, 1.25], [0.9, 1.12], [0.56, 0.62], [0.48, 0.58], [0.36, 0.42], [0.3, 0.34], [0.36, 0.24], [0.32, 0.15]], { rings: 60, seg: 18, up: V(0, 0, 1), rootBone: 'hips' }));
    // a spur at the hock
    rigid(tube([hock.clone().add(V(0, 0.1, -0.25)), hock.clone().add(V(0, 0.3, -0.75)), hock.clone().add(V(0, 0.62, -1.1))], 0.14, 0.01, 6, 6), 'meta' + k, HORN);
    // the foot: three long toes forward and one back, each ending in a hooked talon
    for (const [ang, len] of [[-0.45, 1.45], [0, 1.7], [0.45, 1.4], [Math.PI, 0.85]]) {
      const d = V(Math.sin(ang) * s, 0, Math.cos(ang)), a = foot.clone().add(V(0, -0.02, 0));
      const mid = a.clone().addScaledVector(d, len * 0.5).add(V(0, 0.08, 0)), end = a.clone().addScaledVector(d, len).add(V(0, -0.1, 0));
      rigid(tube([a, mid, end], 0.27, 0.15, 8, 6, 0, 1), 'foot' + k, LIMB);
      rigid(tube([end.clone().add(V(0, 0.03, 0)).addScaledVector(d, -0.08), end.clone().addScaledVector(d, 0.36).add(V(0, 0.12, 0)), end.clone().addScaledVector(d, 0.7).add(V(0, -0.15, 0))], 0.14, 0.006, 6, 7), 'foot' + k, CLAW);
    }
  }

  // ---- wing arms, the fingers and the claws of the hand
  const FB = {};   // each finger's curve, for the membrane
  for (const [s, k] of [[-1, 'R'], [1, 'L']]) {
    const sh = AT['wing1' + k].clone().add(V(-s * 0.3, -0.25, 0)), el = AT['wing2' + k], wr = AT['wing3' + k];
    parts.push(chainLoft([sh, sh.clone().lerp(el, 0.45).add(V(0, 0.2, -0.1)), el, el.clone().lerp(wr, 0.5).add(V(0, 0.1, 0)), wr, wr.clone().add(V(s * 0.35, -0.03, 0.02))],
      ['wing1' + k, 'wing1' + k, 'wing2' + k, 'wing2' + k, 'wing3' + k], [[0.78, 0.95], [0.6, 0.72], [0.36, 0.4], [0.3, 0.32], [0.26, 0.26], [0.16, 0.16]], { rings: 46, seg: 14, rootBone: 'chest' }));
    // a spur of bone at the elbow
    rigid(tube([el.clone().add(V(-s * 0.1, 0.05, -0.2)), el.clone().add(V(-s * 0.3, 0.15, -0.9)), el.clone().add(V(-s * 0.35, 0.4, -1.5))], 0.15, 0.01, 6, 6), 'wing1' + k, HORN);
    for (const [fi, f] of Object.keys(DRAGON_FINGERS).entries()) {
      const d = V(s * DRAGON_FINGERS[f][0], DRAGON_FINGERS[f][1], DRAGON_FINGERS[f][2]), len = d.length(), back = V(0, 0, -1).addScaledVector(d, d.z / (len * len)).normalize();
      // a finger bows a little back along its length
      const at = (t) => wr.clone().addScaledVector(d, t).addScaledVector(back, Math.sin(t * Math.PI * 0.85) * len * 0.045).add(V(0, -Math.sin(t * Math.PI) * 0.1, 0));
      FB[f + k] = at;
      rigid(tube([0, 0.25, 0.5, 0.75, 1].map(at), 0.15 - fi * 0.012, 0.03, 6, 12, 0, 0.9), f + k, LIMB);
    }
    // the hand he walks on: a thumb and two short claws, hooked
    for (const [ox, oz, len] of [[0.1, 0.5, 1.0], [0.42, 0.3, 0.8], [-0.15, 0.25, 0.7]]) {
      const a = wr.clone().add(V(s * ox * 0.5, -0.05, oz * 0.3));
      rigid(tube([a, a.clone().add(V(s * ox, -0.12, oz + len * 0.45)), a.clone().add(V(s * ox * 1.4, -0.55, oz + len))], 0.13, 0.008, 6, 7), 'wing3' + k, CLAW);
    }
  }

  const { geo, bones, B } = assemble(parts);
  const hideMat = dragonHideMaterial();
  const mesh = new THREE.SkinnedMesh(geo, hideMat); mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const wg = assemble([membrane(-1, 'R', FB), membrane(1, 'L', FB)], false).geo;
  const wingMat = dragonWingMaterial();
  const wingMesh = new THREE.SkinnedMesh(wg, wingMat); wingMesh.castShadow = true; wingMesh.frustumCulled = false; mesh.add(wingMesh); wingMesh.updateMatrixWorld(true); wingMesh.bind(mesh.skeleton, wingMesh.matrixWorld);
  const eyes = dragonEyes(); B.head.add(eyes);
  return { mesh, wingMesh, B, hideMat, wingMat, eyes, tris: (geo.index.count + wg.index.count) / 3 };
}

// parts -> one skinned geometry (up to four bones to a vertex) and, the first time, the skeleton
function assemble(parts, withBones = true) {
  const idx = {}; JOINTS.forEach((j, i) => (idx[j.name] = i));
  const geos = parts.map((p) => {
    const g = p.geo, n = g.attributes.position.count;
    for (const a in g.attributes) if (!['position', 'normal', 'uv', 'region', 'heat'].includes(a)) g.deleteAttribute(a);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.region) fillAttr(g, 'region', p.region || 0);
    if (!g.attributes.heat) fillAttr(g, 'heat', 0);
    if (!g.index) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(a); }
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), one = p.bone ? [p.bone, 1] : null;
    for (let v = 0; v < n; v++) {
      const w = one || p.weights[v]; let tot = 0;
      for (let q = 0; q < 4 && q * 2 < w.length; q++) { si[v * 4 + q] = idx[w[q * 2]]; sw[v * 4 + q] = Math.max(0, w[q * 2 + 1]); tot += sw[v * 4 + q]; }
      for (let q = 0; q < 4; q++) sw[v * 4 + q] /= tot || 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return g;
  });
  const geo = mergeGeometries(geos); geo.computeBoundingSphere();
  if (!withBones) return { geo };
  const bones = JOINTS.map((j) => { const b = new THREE.Bone(); b.name = j.name; b.position.copy(AT[j.name]); if (j.parent) b.position.sub(AT[j.parent]); b.rotation.order = 'YXZ'; b.userData.rest = b.position.clone(); return b; });
  const B = {}; JOINTS.forEach((j, i) => { B[j.name] = bones[i]; if (j.parent) bones[idx[j.parent]].add(bones[i]); });
  return { geo, bones, B };
}

// The wing's skin. Between each pair of fingers a panel hangs from the two bones (each vertex rides both, by how far
// across it lies), scalloped along the trailing edge and bellied by the air; behind the last finger the membrane runs
// back to the flank and the root of the tail; before the elbow a narrow web joins the shoulder to the wrist.
function membrane(s, k, FB) {
  const pos = [], uv = [], idx = [], wts = [], reg = [];
  const grid = (nu, nv, fn) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const o = fn(i / nu, j / nv); pos.push(o.p.x, o.p.y, o.p.z); uv.push(o.uv[0], o.uv[1]); wts.push(o.w); reg.push(o.edge || 0); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j, b = a + nv + 1; if (s > 0) idx.push(a, b, a + 1, a + 1, b, b + 1); else idx.push(a, a + 1, b, a + 1, b + 1, b); }
  };
  const fs = Object.keys(DRAGON_FINGERS), O = AT['wing1' + k], E = AT['wing2' + k], Wr = AT['wing3' + k];
  // between the fingers (a: out along the bones, b: across from one to the next)
  for (let f = 0; f < fs.length - 1; f++) {
    const A = FB[fs[f] + k], Bf = FB[fs[f + 1] + k];
    grid(16, 9, (a, b) => {
      const sc = Math.sin(b * Math.PI), aa = a * (1 - 0.2 * sc * a);   // the trailing edge is drawn in between the tips
      const p = A(aa).lerp(Bf(aa), b); p.y += sc * Math.sin(a * Math.PI * 0.9) * 0.34 + Math.sin(a * 13 + b * 5 + f) * 0.03 * sc;
      return { p, uv: [(f + b) / 5, a], w: [fs[f] + k, 1 - b, fs[f + 1] + k, b], edge: a };
    });
  }
  // behind the last finger: the forearm on one side; on the other the flank and the root of the tail, out to the tip
  // of the last finger. (Each vertex rides the forearm, the hips and the finger by where it lies between them.)
  const F4 = FB['f4' + k], Hp = V(s * 1.15, 3.75, AT.hips.z - 0.9), T4 = F4(1), sm = (t) => smooth(clamp(t, 0, 1));
  grid(14, 12, (a, b) => {
    const arm = E.clone().lerp(Wr, a), sc = Math.sin(a * Math.PI);
    const out = Hp.clone().lerp(T4, a).add(V(0, 0, sc * 1.6));   // (the trailing edge is drawn in toward the elbow)
    const p = a > 0.999 ? F4(b) : arm.lerp(out, b); p.y += sc * Math.sin(b * Math.PI) * 0.4 + Math.sin(a * 9 + b * 7) * 0.03 * sc;
    const wf = a * a * (b + (1 - b) * a ** 6), sa = sm(a / 0.35);
    return { p, uv: [(3 + a) / 5, b], w: ['wing2' + k, (1 - wf) * (1 - b) * sa, 'wing1' + k, (1 - wf) * (1 - b) * (1 - sa), 'hips', (1 - wf) * b, 'f4' + k, wf], edge: b };
  });
  // between the upper arm and the body
  const Sp = V(s * 1.3, 4.2, AT.chest.z - 0.7);
  grid(8, 8, (a, b) => {
    const p = O.clone().lerp(E, a).lerp(Sp.clone().lerp(Hp, a), b); p.y += Math.sin(a * Math.PI) * Math.sin(b * Math.PI) * 0.25;
    return { p, uv: [(4 + a * 0.5) / 5, b], w: ['wing1' + k, 1 - b, 'chest', b * (1 - a), 'hips', b * a], edge: b * 0.5 };
  });
  // the web before the elbow, from the root of the neck to the wrist
  const Nk = V(s * 1.0, 5.2, AT.chest.z + 1.0);
  grid(10, 5, (a, b) => {
    const lead = Nk.clone().lerp(Wr, a).add(V(0, -Math.sin(a * Math.PI) * 0.2, -Math.sin(a * Math.PI) * 0.8));
    const arm = a < 0.5 ? O.clone().lerp(E, a * 2) : E.clone().lerp(Wr, a * 2 - 1);
    return { p: lead.lerp(arm, b), uv: [(4.5 + a * 0.5) / 5, b], w: [a < 0.5 ? 'wing1' + k : 'wing2' + k, b, 'chest', (1 - b) * (1 - a), 'wing2' + k, (1 - b) * a], edge: 0.35 + 0.5 * (1 - b) };
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('region', new THREE.Float32BufferAttribute(reg, 1)); g.setIndex(idx); g.computeVertexNormals();
  return { geo: g, weights: wts };
}

// ---------------------------------------------------------------- materials
// The hide. Painted in the shader from what each part is (the `region` of its vertices), where it lies on the body
// at rest, and two tiling patterns (overlapping scales; broad keeled scutes): big scutes down the back, scales on
// the flanks, small ones on the limbs and the face, plates across the belly. Dark oxblood going to soot along the
// spine and to a stained bone colour beneath; old scars cut pale across it. Heat shows in the gaps of the throat
// and the breast as he draws breath for fire (uBreath), and the mouth glows with it.
let HIDE_TEX = null;
export function dragonHideMaterial() {
  HIDE_TEX ||= [scalePattern(10, 16, 31, 1.9), scalePattern(5, 6, 57, 1.25, true)];
  const u = { uHit: { value: 0 }, uBreath: { value: 0 }, uGlow: { value: 1 }, uScaleTex: { value: HIDE_TEX[0] }, uScuteTex: { value: HIDE_TEX[1] } };
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 1 });
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region; attribute float heat;\nflat varying float vReg; varying float vHeat; varying vec3 vBindN; varying vec3 vBindP; varying vec2 vDUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = region; vHeat = heat; vBindN = normal; vBindP = position; vDUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vReg; varying float vHeat; varying vec3 vBindN; varying vec3 vBindP; varying vec2 vDUv;
        uniform float uHit, uBreath, uGlow; uniform sampler2D uScaleTex, uScuteTex;
        float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }
        vec4 dPat; float dScale, dScar, dBelly, dRough; vec3 dEm;`)
      .replace('#include <map_fragment>', `
        vec3 bn = normalize(vBindN);
        float rHide = step(vReg, 0.5), rLimb = step(abs(vReg - 2.0), 0.4), rH = step(abs(vReg - 1.0), 0.4), rM = step(abs(vReg - 3.0), 0.4), rT = step(abs(vReg - 4.0), 0.4), rC = step(abs(vReg - 5.0), 0.4), rG = step(abs(vReg - 6.0), 0.4), rP = step(abs(vReg - 7.0), 0.4);
        dScale = rHide + rLimb;
        float back = smoothstep(0.3, 0.75, bn.y) * rHide;
        dBelly = smoothstep(-0.45, -0.82, bn.y) * rHide;
        vec4 pA = texture2D(uScaleTex, vDUv), pB = texture2D(uScuteTex, vDUv * vec2(1.0, 0.5)), pC = texture2D(uScaleTex, vDUv * 2.0 + 0.37);
        dPat = mix(mix(pA, pB, back), pC, rLimb);
        // broad plates across the belly, each lapping the next
        float pl = fract(vDUv.y * 1.6), seam = smoothstep(0.0, 0.1, pl) * smoothstep(1.0, 0.8, pl);
        dPat = mix(dPat, vec4(0.5, 0.5 + (smoothstep(0.1, 0.0, pl) - smoothstep(0.8, 1.0, pl)) * 0.45, seam, 0.5 + 0.3 * dn(vec3(floor(vDUv.y * 1.6), 3.0, 7.0))), dBelly);
        float ht = dPat.b, tint = dPat.a;                // the scale's height (0 in the gaps, 1 on its keel) and its own shade
        float mott = dn(vBindP * 0.9) * 0.6 + dn(vBindP * 3.1) * 0.4;
        vec3 red = mix(vec3(0.05, 0.011, 0.008), vec3(0.125, 0.03, 0.015), tint);
        vec3 soot = vec3(0.02, 0.017, 0.016);
        float low = rLimb * smoothstep(2.6, 0.2, vBindP.y) * 0.55;                    // the feet and the hands, dark with ash
        vec3 hide = mix(red, soot, clamp(back * 0.9 + (mott - 0.42) * 1.2 + rLimb * 0.15 + low, 0.0, 1.0));
        hide = mix(hide, vec3(0.24, 0.17, 0.1) * (0.55 + 0.5 * tint), dBelly * 0.92);
        hide *= mix(0.12, 1.0, smoothstep(0.08, 0.6, ht)) * (0.75 + 0.5 * mott);
        hide += vec3(0.045, 0.03, 0.022) * smoothstep(0.82, 1.0, ht) * (1.0 - dBelly);   // the keels worn pale
        // old scars: long pale seams where the scales never grew back
        float sl = dn(vec3(vBindP.x * 0.45 + vBindP.y * 0.3, vBindP.y * 0.5 - vBindP.z * 0.16, vBindP.z * 0.22 + vBindP.x * 0.2) + 11.0);
        dScar = (1.0 - smoothstep(0.0, 0.016, abs(sl - 0.5))) * smoothstep(0.6, 0.72, dn(vBindP * 0.23 + 4.0)) * dScale;
        hide = mix(hide, vec3(0.2, 0.11, 0.09), dScar * 0.8);
        float tipK = clamp(dn(vBindP * 2.2) * 0.5 + 0.25, 0.0, 1.0);
        vec3 horn = mix(vec3(0.12, 0.09, 0.06), vec3(0.016, 0.014, 0.013), tipK) * (0.7 + 0.6 * dn(vBindP * vec3(9.0, 9.0, 30.0)));
        vec3 tooth = vec3(0.46, 0.38, 0.23) * (0.55 + 0.5 * dn(vBindP * 14.0));
        vec3 mouth = vec3(0.15, 0.025, 0.03) * (0.7 + 0.6 * dn(vBindP * 6.0));
        diffuseColor.rgb = hide * dScale + horn * rH + mouth * rM + tooth * rT + vec3(0.035, 0.03, 0.027) * rC + vec3(0.085, 0.022, 0.03) * rG + vec3(0.008) * rP;
        dRough = mix(0.86, 0.4, smoothstep(0.1, 0.7, ht)) * dScale + 0.45 * rH + 0.3 * rT + 0.28 * rC + 0.3 * (rM + rG) + 0.8 * rP;
        dRough = mix(dRough, 0.9, dScar);
        float gap = (1.0 - smoothstep(0.03, 0.2, ht)) * dScale;
        float pulse = 0.65 + 0.35 * dn(vec3(vBindP.x * 2.0, vBindP.y * 2.0, vBindP.z * 0.9 - uBreath * 3.0));
        dEm = vec3(1.0, 0.3, 0.05) * gap * (0.01 + vHeat * (0.04 + 2.2 * uBreath * pulse)) + vec3(1.0, 0.4, 0.08) * vHeat * uBreath * 0.03 * dScale;
        dEm += vec3(1.0, 0.36, 0.06) * (rM + rG * 0.5) * uBreath * 1.6;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = dRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.12 * dScale;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 st0 = dFdx(vDUv), st1 = dFdy(vDUv);
          vec3 q1p = cross(q1, normal), q0p = cross(normal, q0);
          vec3 tT = q1p * st0.x + q0p * st1.x, tB = q1p * st0.y + q0p * st1.y;
          float det = max(dot(tT, tT), dot(tB, tB)), sc = det == 0.0 ? 0.0 : inversesqrt(det);
          vec2 nxy = (dPat.rg * 2.0 - 1.0) * 1.5 * dScale * (1.0 - dScar);
          normal = normalize(tT * (nxy.x * sc) + tB * (nxy.y * sc) + normal);
        }`)
      .replace('#include <emissivemap_fragment>', `totalEmissiveRadiance = dEm * uGlow + vec3(1.0, 0.9, 0.8) * uHit;
        // the sky on the scales where they turn away: enough that he never goes to a flat black shape against the storm
        totalEmissiveRadiance += vec3(0.05, 0.058, 0.075) * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 2.5) * (0.35 + 0.65 * dPat.b) * dScale;`);
  };
  m.customProgramCacheKey = () => 'dragonHide-v3';
  return m;
}
// A tiling pattern of lapped scales (or broad keeled scutes), packed for the shader: RG = the surface normal's lean,
// B = height (0 in the gaps, 1 on the keel), A = each scale's own shade.
function scalePattern(cols, rows, seed, lap, scute = false) {
  const S = 512, w = S / cols, h = S / rows * lap;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d', { willReadFrequently: true })]; };
  const [, hx] = mk(), [, tx] = mk();
  hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S); tx.fillStyle = '#808080'; tx.fillRect(0, 0, S, S);
  const r = rng(seed);
  for (let row = rows + 1; row >= -1; row--) for (let col = -1; col <= cols; col++) {
    const cx = col * w + (row % 2 ? w / 2 : 0) + (r() - 0.5) * w * 0.1, cy = row * (S / rows) + (r() - 0.5) * 3, shade = Math.floor(50 + r() * 160), kx = (r() - 0.5) * w * 0.12;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const x = cx + ox, y = cy + oy; if (x < -w || x > S + w || y < -h || y > S + h) continue;
      const g = hx.createRadialGradient(x + kx, y - h * 0.12, 1, x, y, h * (scute ? 0.7 : 0.62));
      g.addColorStop(0, '#fff'); g.addColorStop(scute ? 0.7 : 0.55, '#b4b4b4'); g.addColorStop(0.9, '#383838'); g.addColorStop(1, '#0c0c0c');
      hx.fillStyle = g; hx.beginPath();
      if (scute) { const a = w * 0.47, b = h * 0.45, c = w * 0.16; hx.moveTo(x - a + c, y - b); hx.lineTo(x + a - c, y - b); hx.quadraticCurveTo(x + a, y - b, x + a, y - b + c); hx.lineTo(x + a, y + b * 0.6); hx.quadraticCurveTo(x + a * 0.8, y + b, x, y + b * 1.08); hx.quadraticCurveTo(x - a * 0.8, y + b, x - a, y + b * 0.6); hx.lineTo(x - a, y - b + c); hx.quadraticCurveTo(x - a, y - b, x - a + c, y - b); }
      else { hx.moveTo(x - w * 0.52, y - h * 0.25); hx.quadraticCurveTo(x - w * 0.55, y + h * 0.35, x, y + h * 0.55); hx.quadraticCurveTo(x + w * 0.55, y + h * 0.35, x + w * 0.52, y - h * 0.25); hx.lineTo(x, y - h * 0.6); }
      hx.closePath(); hx.fill();
      hx.strokeStyle = scute ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.35)'; hx.lineWidth = scute ? 5 : 2; hx.beginPath(); hx.moveTo(x + kx, y - h * 0.3); hx.lineTo(x + kx, y + h * 0.42); hx.stroke();   // the keel
      tx.fillStyle = `rgb(${shade},${shade},${shade})`; tx.beginPath(); tx.ellipse(x, y + h * 0.1, w * 0.52, h * 0.46, 0, 0, 7); tx.fill();
    }
  }
  const hd = hx.getImageData(0, 0, S, S).data, td = tx.getImageData(0, 0, S, S).data, out = new Uint8Array(S * S * 4);
  const at = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = at(x + 1, y) - at(x - 1, y) + 0.5 * (at(x + 1, y - 1) - at(x - 1, y - 1) + at(x + 1, y + 1) - at(x - 1, y + 1)), dy = at(x, y + 1) - at(x, y - 1) + 0.5 * (at(x - 1, y + 1) - at(x - 1, y - 1) + at(x + 1, y + 1) - at(x + 1, y - 1));
    const i = (y * S + x) * 4; out[i] = clamp(128 - dx * 150, 0, 255); out[i + 1] = clamp(128 - dy * 150, 0, 255); out[i + 2] = hd[i]; out[i + 3] = td[i];
  }
  const t = new THREE.DataTexture(out, S, S, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

// The wing's skin: thin dark leather, darker and thicker along the bones and where it joins the body, veined; old
// tears along the trailing edge. Seen with the light behind it, it glows through (blood-warm), the veins and the
// shadow of the bones showing dark.
export function dragonWingMaterial() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'), r = rng(77);
  x.fillStyle = '#231210'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(${36 + r() * 36},${16 + r() * 12},${12 + r() * 10},${0.06 + r() * 0.12})`; x.beginPath(); x.arc(r() * 512, r() * 512, 2 + r() * 16, 0, 7); x.fill(); }
  // long creases running out along the wing, as the skin folds when it closes
  for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(8,4,4,${0.1 + r() * 0.18})`; x.lineWidth = 1 + r() * 2; const x0 = r() * 512; x.beginPath(); x.moveTo(x0, 0); x.bezierCurveTo(x0 + (r() - 0.5) * 30, 170, x0 + (r() - 0.5) * 30, 340, x0 + (r() - 0.5) * 20, 512); x.stroke(); }
  const vein = (x0, y0, a, w, d) => {
    let px = x0, py = y0; x.lineWidth = w; x.strokeStyle = `rgba(96,22,18,${0.4 + w * 0.08})`; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 20; k++) { a += (r() - 0.5) * 0.5; px += Math.cos(a) * 12; py += Math.sin(a) * 12; x.lineTo(px, py); if (d < 3 && r() < 0.14) { x.stroke(); vein(px, py, a + (r() - 0.5) * 1.6, w * 0.6, d + 1); x.beginPath(); x.moveTo(px, py); } }
    x.stroke();
  };
  for (let i = 0; i < 16; i++) vein(r() * 512, r() * 512, 1.57 + (r() - 0.5), 3.2, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.66, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  const u = { uHit: { value: 0 }, uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uFire: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region; varying float vEdge; varying vec2 vWUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = region; vWUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform float uHit, uFire; uniform vec3 uLightDir; varying float vEdge; varying vec2 vWUv;
        float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(wh(i), wh(i+vec2(1,0)), f.x), mix(wh(i+vec2(0,1)), wh(i+vec2(1,1)), f.x), f.y); }
        float wThick;`)
      .replace('#include <map_fragment>', `
        vec4 wt = texture2D(map, vWUv * vec2(5.0, 2.0));
        float panel = fract(vWUv.x * 5.0), bone = smoothstep(0.12, 0.0, min(panel, 1.0 - panel)) * step(vWUv.x, 0.6);   // thicker skin along the fingers
        wThick = clamp(bone + smoothstep(0.3, 0.0, vEdge) * 0.7, 0.0, 1.0);
        diffuseColor.rgb = wt.rgb * mix(1.0, 0.55, wThick);
        // old tears: ragged bites out of the trailing edge, a few holes
        float rag = wn(vWUv * vec2(60.0, 9.0)) * 0.6 + wn(vWUv * vec2(23.0, 5.0)) * 0.4;
        float tear = smoothstep(0.93, 1.0, vEdge + (rag - 0.5) * 0.11) + step(0.985, wn(vWUv * vec2(34.0, 13.0) + 5.0) * smoothstep(0.35, 0.6, vEdge));
        diffuseColor.a = 1.0 - step(0.5, tear) * step(vWUv.x, 0.8);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // light through the membrane, seen from the shadowed side
        vec3 Vd = normalize(vViewPosition), Ld = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
        float thru = clamp(dot(-normal, Ld), 0.0, 1.0) * (0.35 + 0.65 * pow(clamp(dot(-Vd, Ld), 0.0, 1.0), 2.0));
        vec3 glowC = vec3(0.34, 0.055, 0.02) * (1.25 - wt.r * 3.2) * (1.0 - wThick * 0.85);
        totalEmissiveRadiance += max(vec3(0.0), glowC) * (thru * 0.07 + uFire * 0.1) + vec3(1.0) * uHit * 0.5;`);
  };
  m.customProgramCacheKey = () => 'dragonWing-v2';
  return m;
}
// eyes: deep-set under the brow, pale amber, a black slit; they catch the light rather than burn
export function dragonEyes() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), r = rng(5);
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 64); g.addColorStop(0, '#f4e3a0'); g.addColorStop(0.4, '#d49a28'); g.addColorStop(0.78, '#7a4a10'); g.addColorStop(1, '#1c1004');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(60,30,4,${r() * 0.45})`; x.beginPath(); const a = r() * 7; x.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12); x.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60); x.stroke(); }
  x.fillStyle = '#000'; x.beginPath(); x.ellipse(64, 64, 8, 52, 0, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.12, metalness: 0 });
  const grp = new THREE.Group();
  for (const s of [-1, 1]) {
    const geo = new THREE.SphereGeometry(0.115, 18, 12); geo.rotateY(-Math.PI / 2);   // the texture's centre (the slit) faces forward
    const e = new THREE.Mesh(geo, mat); e.position.set(s * 0.52, 0.37, 1.04); e.rotation.y = s * 1.0; e.scale.set(1, 0.8, 1); grp.add(e);
  }
  grp.userData.mat = mat;
  return grp;
}

// ---------------------------------------------------------------- his fire
// Everything the Dragon's fire draws, in three draw calls and no lights: the jet of his breath (a ragged cone of
// burning gas, bending behind the sweep of his head), tongues of flame standing on the ground he has set alight
// (camera-facing sheets, one instanced mesh), and the char he leaves behind (patches draped on the terrain that
// glow for a while and then lie black). Built with the Dragon at chapter load; nothing is allocated in a fight.
const FIRE_NOISE = `
  float fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * fn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
  vec3 fireCol(float heat){ vec3 c = mix(vec3(0.45, 0.04, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.08, 0.4, heat)); c = mix(c, vec3(1.0, 0.6, 0.18), smoothstep(0.42, 0.75, heat)); return mix(c, vec3(1.0, 0.88, 0.62), smoothstep(0.88, 1.0, heat)); }`;
const N_FLAME = 200, N_SCORCH = 28, SG = 6;
export class DragonFire {
  constructor(scene) {
    this.scene = scene; this.group = new THREE.Group(); scene.add(this.group); this.time = 0;
    // ---- the jet: two shells (a broad ragged one, a white-hot core) along +z from the mouth
    const cone = new THREE.CylinderGeometry(1, 0.16, 1, 22, 20, true); cone.translate(0, 0.5, 0); cone.rotateX(Math.PI / 2);
    this.jets = [0, 1].map((i) => {
      const u = { uTime: { value: 0 }, uLen: { value: 14 }, uRad: { value: i ? 1.3 : 2.9 }, uBend: { value: new THREE.Vector3() }, uInt: { value: 0 }, uSeed: { value: i * 3.7 }, uGrow: { value: 0 }, uCore: { value: i } };
      const m = new THREE.Mesh(cone, new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
        vertexShader: `uniform float uLen, uRad, uTime; uniform vec3 uBend; varying float vT; varying float vA; varying vec3 vN; varying vec3 vV;
          void main(){ vT = position.z; vA = atan(position.x, position.y);
            float wob = 1.0 + 0.14 * sin(vT * 11.0 - uTime * 13.0 + vA * 2.0) * vT;
            vec3 p = vec3(position.xy * uRad * wob * (0.7 + 0.3 * vT), position.z * uLen) + uBend * vT * vT;
            vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * vec3(position.xy, -0.12)); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uTime, uInt, uSeed, uGrow, uCore; varying float vT; varying float vA; varying vec3 vN; varying vec3 vV;${FIRE_NOISE}
          void main(){
            float t = vT / max(uGrow, 0.001); if (t > 1.0 || uInt < 0.003) discard;
            float run = vT * 5.5 - uTime * 8.0;
            float w = 0.5 * (fbm(vec2(cos(vA) * 1.5 + 5.0 + uSeed, run)) + fbm(vec2(sin(vA) * 1.5 - 3.0, run * 1.3 + 7.7 + uSeed)));
            float face = pow(abs(dot(normalize(vN), normalize(vV))), mix(0.9, 1.6, uCore));      // the shell thins out toward its silhouette
            float heat = (w * 1.75 - 0.24 - t * mix(0.42, 0.7, uCore)) * face * smoothstep(0.0, 0.03, vT) * (1.0 - smoothstep(0.78, 1.0, t)) * mix(1.5, 2.0, uCore);
            heat = clamp(heat, 0.0, 1.0); if (heat < 0.01) discard;
            vec3 col = mix(fireCol(heat * mix(0.85, 1.0, uCore)), vec3(1.0, 0.92, 0.7), uCore * heat * 0.6);
            gl_FragColor = vec4(col * heat * uInt * 1.6, 1.0); }`,
      }));
      m.frustumCulled = false; m.renderOrder = 11; this.group.add(m); return m;   // (left visible, drawing nothing, so the chapter's warm-up compiles it)
    });
    this._prevDir = new THREE.Quaternion(); this._lag = new THREE.Vector3(0, 0, 1); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this.jetK = 0;
    // ---- flames on the ground
    const quad = new THREE.PlaneGeometry(1, 1); quad.translate(0, 0.5, 0);
    const ig = new THREE.InstancedBufferGeometry(); ig.index = quad.index; ig.setAttribute('position', quad.attributes.position); ig.setAttribute('uv', quad.attributes.uv);
    this.fPos = new THREE.InstancedBufferAttribute(new Float32Array(N_FLAME * 3), 3); this.fPar = new THREE.InstancedBufferAttribute(new Float32Array(N_FLAME * 4), 4);
    this.fPos.setUsage(THREE.DynamicDrawUsage); this.fPar.setUsage(THREE.DynamicDrawUsage); ig.setAttribute('iPos', this.fPos); ig.setAttribute('iPar', this.fPar); ig.instanceCount = 0;
    this.flameU = { uTime: { value: 0 } };
    this.flames = new THREE.Mesh(ig, new THREE.ShaderMaterial({
      uniforms: this.flameU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false,
      vertexShader: `attribute vec3 iPos; attribute vec4 iPar; varying vec2 vUv; varying float vSeed; varying float vInt;
        void main(){ vUv = uv; vSeed = iPar.z; vInt = iPar.w; vec4 mv = viewMatrix * vec4(iPos, 1.0); vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          mv.xyz += vec3(1.0, 0.0, 0.0) * position.x * iPar.x + up * position.y * iPar.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying float vSeed; varying float vInt;${FIRE_NOISE}
        void main(){
          vec2 uv = vUv; float t = uTime * 1.9 + vSeed * 17.0; vec2 q = vec2(uv.x * 2.0 - 1.0, uv.y);
          vec2 p = vec2(q.x * 1.7, q.y * 2.4 - t);
          float w = fbm(p * 1.2 + vec2(0.0, -t * 0.4)), w2 = fbm(p * 2.6 + vec2(w * 1.8, w * 1.2) + vec2(vSeed * 3.0, -t * 0.9));
          float reach = 0.42 + 0.58 * smoothstep(0.15, 0.85, fn(vec2(q.x * 2.6 + vSeed * 7.0, t * 0.55)) * 0.75 + fn(vec2(q.x * 6.0 - vSeed, t * 1.3)) * 0.35);
          float yy = clamp(uv.y / reach, 0.0, 1.5), width = mix(0.8, 0.06, pow(min(yy, 1.0), 0.85));
          float x = q.x + (w2 - 0.5) * 0.7 * uv.y + sin(uv.y * 5.0 - t * 1.7 + vSeed * 6.0) * 0.07 * uv.y;
          float heat = (1.0 - smoothstep(width * 0.35, width, abs(x))) * (1.0 - smoothstep(0.15, 1.05, yy + (w - 0.5) * 0.85)) * smoothstep(0.0, 0.1, uv.y);
          heat = clamp(heat * 1.75 - (w2 - 0.35) * 0.75, 0.0, 1.0);
          float a = smoothstep(0.03, 0.3, heat);
          gl_FragColor = vec4(fireCol(heat) * (0.4 + heat * 1.1) * vInt * a, 1.0); }`,
    }));
    this.flames.frustumCulled = false; this.flames.renderOrder = 10; this.group.add(this.flames); this.nF = 0;
    // ---- the char: N patches of a small grid each, written over in turn
    const SV = (SG + 1) * (SG + 1), sp = new Float32Array(N_SCORCH * SV * 3), sq = new Float32Array(N_SCORCH * SV * 4), si = [];
    for (let n = 0; n < N_SCORCH; n++) {
      for (let i = 0; i <= SG; i++) for (let j = 0; j <= SG; j++) { const v = n * SV + i * (SG + 1) + j; sq[v * 4] = i / SG * 2 - 1; sq[v * 4 + 1] = j / SG * 2 - 1; sq[v * 4 + 2] = -1e4; sq[v * 4 + 3] = n * 1.37; sp[v * 3 + 1] = -1e4; }
      for (let i = 0; i < SG; i++) for (let j = 0; j < SG; j++) { const a = n * SV + i * (SG + 1) + j; si.push(a, a + 1, a + SG + 1, a + 1, a + SG + 2, a + SG + 1); }
    }
    const sg = new THREE.BufferGeometry(); this.sPos = new THREE.BufferAttribute(sp, 3); this.sQ = new THREE.BufferAttribute(sq, 4); this.sPos.setUsage(THREE.DynamicDrawUsage); this.sQ.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.sPos); sg.setAttribute('q', this.sQ); sg.setIndex(si);
    this.scorchU = { uTime: { value: 0 } };
    this.scorch = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: this.scorchU, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false,
      vertexShader: `attribute vec4 q; varying vec2 vQ; varying float vAge; varying float vSeed; uniform float uTime; void main(){ vQ = q.xy; vAge = uTime - q.z; vSeed = q.w; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vQ; varying float vAge; varying float vSeed; uniform float uTime;${FIRE_NOISE}
        void main(){
          float r = length(vQ), n = fbm(vQ * 2.6 + vSeed * 9.0), edge = 1.0 - smoothstep(0.45, 0.98, r + (n - 0.5) * 0.5);
          float life = smoothstep(0.0, 0.6, vAge) * (1.0 - smoothstep(60.0, 85.0, vAge));
          float cn = fbm(vQ * 9.0 + vSeed * 3.0), crack = smoothstep(0.47, 0.5, cn) * (1.0 - smoothstep(0.5, 0.53, cn));
          float hot = crack * (1.0 - smoothstep(1.0, 7.0, vAge)) * (0.6 + 0.4 * sin(uTime * 3.0 + n * 20.0)) * edge * smoothstep(0.55, 0.3, r);
          vec3 col = vec3(0.012, 0.01, 0.01) * (0.6 + n) + vec3(1.0, 0.3, 0.04) * hot * 0.9;
          gl_FragColor = vec4(col, max(edge * life * 0.86, hot * life)); }`,
    }));
    this.scorch.frustumCulled = false; this.scorch.renderOrder = 2; this.group.add(this.scorch); this.nS = 0;
  }
  // flames are listed afresh each frame: begin, flame..., end
  begin(time) { this.time = time; this.nF = 0; this.flameU.uTime.value = time; this.scorchU.uTime.value = time; }
  flame(x, y, z, w, h, seed, k) { const n = this.nF; if (n >= N_FLAME || k <= 0.01) return; this.fPos.array[n * 3] = x; this.fPos.array[n * 3 + 1] = y; this.fPos.array[n * 3 + 2] = z; const a = this.fPar.array; a[n * 4] = w; a[n * 4 + 1] = h; a[n * 4 + 2] = seed; a[n * 4 + 3] = k; this.nF = n + 1; }
  end() { this.flames.geometry.instanceCount = this.nF; if (this.nF) { this.fPos.needsUpdate = true; this.fPar.needsUpdate = true; } this.flames.visible = this.nF > 0; }
  // a patch of burnt ground, draped on the terrain
  scorchAt(x, z, r, world, time) {
    const n = this.nS++ % N_SCORCH, SV = (SG + 1) * (SG + 1), P = this.sPos.array, Q = this.sQ.array;
    for (let i = 0; i <= SG; i++) for (let j = 0; j <= SG; j++) {
      const v = n * SV + i * (SG + 1) + j, px = x + (i / SG * 2 - 1) * r, pz = z + (j / SG * 2 - 1) * r;
      P[v * 3] = px; P[v * 3 + 1] = (world ? world.heightAt(px, pz) : 0) + 0.05; P[v * 3 + 2] = pz; Q[v * 4 + 2] = time;
    }
    this.sPos.needsUpdate = true; this.sQ.needsUpdate = true;
  }
  // the breath: k 0..1 (how hard he is blowing), from the mouth along dir for len metres
  jet(k, mouth, dir, len, time, dt) {
    this.jetK += ((k > 0 ? 1 : 0) - this.jetK) * Math.min(1, dt * (k > 0 ? 5 : 3.5));
    const on = this.jetK > 0.02;
    // the far end trails behind a turning head
    this._lag.lerp(dir, Math.min(1, dt * 5.5)).normalize();
    this._q.setFromUnitVectors(this._v.set(0, 0, 1), dir);
    const bend = this._v.copy(this._lag).sub(dir).multiplyScalar(len * 1.6).applyQuaternion(this._prevDir.copy(this._q).invert());
    this.jets.forEach((m, i) => {
      m.visible = on; if (!on) return;
      m.position.copy(mouth); m.quaternion.copy(this._q);
      const u = m.material.uniforms; u.uTime.value = time; u.uLen.value = len * (i ? 0.72 : 1); u.uInt.value = this.jetK * (k > 0 ? 0.6 + 0.4 * k : 1); u.uGrow.value = k > 0 ? Math.min(1, u.uGrow.value + dt * 3.2) : u.uGrow.value; u.uBend.value.copy(bend).multiplyScalar(i ? 0.55 : 1);
      if (this.jetK < 0.03) u.uGrow.value = 0;
    });
    if (!on) for (const m of this.jets) m.material.uniforms.uGrow.value = 0;
  }
  dispose() { this.scene.remove(this.group); for (const m of [...this.jets, this.flames, this.scorch]) { m.material.dispose(); } this.jets[0].geometry.dispose(); this.flames.geometry.dispose(); this.scorch.geometry.dispose(); }
}
