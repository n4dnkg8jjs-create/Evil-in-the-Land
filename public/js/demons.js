// The horde. Seven demon kinds, each a skinned mesh built from a procedural
// skeleton (one draw call per demon), animated procedurally, and driven by
// host-side AI. Clients see puppets fed from host snapshots.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { demonTextures } from './textures.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smooth, makeNoise, TAU, SpatialHash, rng } from './util.js';

const D2R = Math.PI / 180;
const R = Math.random;

// ---------------------------------------------------------------- type table
export const TYPES = {
  shade:   { name: 'Shade',   rarity: 'common',   hp: 45,  speed: 6.0, radius: 0.45, height: 2.0, dmg: 9,  range: 1.9, cd: 1.3, mass: 1, rim: 0xb0201a, eye: 0xffe0a0, score: 1, stagger: 1 },
  crawler: { name: 'Crawler', rarity: 'common',   hp: 28,  speed: 7.6, radius: 0.5,  height: 0.9, dmg: 7,  range: 1.6, cd: 1.1, mass: 0.7, rim: 0x7a2ab0, eye: 0xff4030, score: 1, stagger: 1 },
  wretch:  { name: 'Wretch',  rarity: 'uncommon', hp: 55,  speed: 4.4, radius: 0.45, height: 1.7, dmg: 12, range: 20, cd: 3.2, mass: 1, rim: 0x4a8a2a, eye: 0xb0ff60, score: 2, stagger: 1, ranged: true },
  husk:    { name: 'Husk',    rarity: 'uncommon', hp: 70,  speed: 3.2, radius: 0.7,  height: 1.6, dmg: 32, range: 2.4, cd: 1, mass: 1.6, rim: 0xd06010, eye: 0xffa040, score: 2, stagger: 0.6 },
  brute:   { name: 'Brute',   rarity: 'rare',     hp: 420, speed: 3.9, radius: 1.0,  height: 3.1, dmg: 26, range: 3.2, cd: 2.4, mass: 5, rim: 0xff1a10, eye: 0xff6020, score: 8, stagger: 0.25, big: true },
  wraith:  { name: 'Wraith',  rarity: 'rare',     hp: 140, speed: 5.0, radius: 0.5,  height: 2.4, dmg: 14, range: 16, cd: 4.5, mass: 0.8, rim: 0x80a0ff, eye: 0xd0e8ff, score: 5, stagger: 0.7, ranged: true, floats: 0.5 },
  herald:  { name: 'Herald',  rarity: 'very rare', hp: 260, speed: 7.0, radius: 0.8,  height: 2.4, dmg: 22, range: 2.6, cd: 3.5, mass: 2, rim: 0xffa020, eye: 0xffd060, score: 10, stagger: 0.5, flies: 6 },
};

// ---------------------------------------------------------------- materials
function demonMaterial(rimHex) {
  const dt = demonTextures();
  const u = { uDissolve: { value: 0 }, uRim: { value: new THREE.Color(rimHex) }, uRimPow: { value: 2.6 }, uGlow: { value: 1 }, uHit: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: dt.map, normalMap: dt.normalMap, emissiveMap: dt.emissiveMap, emissive: new THREE.Color(rimHex), emissiveIntensity: 1.2, roughness: 0.55, metalness: 0.1, color: 0x9a9090 });
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDPos; uniform float uDissolve, uRimPow, uGlow, uHit; uniform vec3 uRim;
      float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dnz = dn(vDPos * 7.0) * 0.65 + dn(vDPos * 19.0) * 0.35;
      if (uDissolve > 0.0 && dnz < uDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= uGlow;
      float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPow);
      totalEmissiveRadiance += uRim * fres * 1.4 * uGlow;
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit * 2.0;
      if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 6.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dnz));`);
  };
  mat.customProgramCacheKey = () => 'demon-v1';
  return mat;
}

// ---------------------------------------------------------------- skeleton & geometry helpers
// limb: tapered tube from y=0 down to -len (joint-local)
function limb(r0, r1, len, seg = 8, lump = 0.15, seed = 1) {
  const pts = []; const n = 10;
  for (let i = 0; i <= n; i++) { const t = i / n; const r = lerp(r0, r1, t) * (1 + Math.sin(t * Math.PI) * 0.15); pts.push(new THREE.Vector2(Math.max(0.001, r * (i === 0 || i === n ? 0.6 : 1)), -t * len)); }
  const g = new THREE.LatheGeometry(pts.reverse(), seg);
  return lumpyG(g, lump, seed);
}
// smooth (indexed) icosphere with spherical UVs
export function icoSmooth(detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI * 2) + 0.5; uv[i * 2 + 1] = p.getY(i) * 0.5 + 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
}
function blob(rx, ry, rz, lump = 0.2, seed = 1, detail = 2) {
  const g = icoSmooth(detail); g.scale(rx, ry, rz); return lumpyG(g, lump, seed);
}
function cone(r, h, seg = 6) { const g = new THREE.ConeGeometry(r, h, seg); return g; }
function horn(len, r, curl, seg = 10) {
  const pts = []; for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push(new THREE.Vector3(0, Math.sin(t * curl) * len * 0.6, -Math.cos(t * curl) * len * 0.0 + t * len * 0.3 - Math.sin(t * curl * 0.5) * len * 0.4)); }
  const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg * 2, r, 6, false);
  const pos = tg.attributes.position; const v = new THREE.Vector3(); const curve = new THREE.CatmullRomCurve3(pts);
  for (let i = 0; i < pos.count; i++) { const ring = Math.floor(i / 7); const t = ring / (seg * 2); const c = curve.getPoint(t); v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - t * 0.92).add(c); pos.setXYZ(i, v.x, v.y, v.z); }
  tg.computeVertexNormals(); return tg;
}
const _noise = makeNoise(4242);
function lumpyG(g, amt, seed) {
  if (!amt) return g;
  const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + _noise.fbm(v.x * 6 + seed, v.y * 6 + v.z * 5, 3) * amt; p.setXYZ(i, v.x * k, v.y * (1 + (k - 1) * 0.5), v.z * k); }
  g.computeVertexNormals(); return g;
}
function place(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s))); return g;
}

// Build a skinned model template from joints [{name,parent,pos}] and parts
// [{joint, geo (joint-local), blend (m, softens into parent at the joint), to?: other joint for blending}]
function buildTemplate(joints, parts) {
  const idx = {}; joints.forEach((j, i) => (idx[j.name] = i));
  // rest-pose model matrices
  const world = joints.map(() => new THREE.Matrix4());
  joints.forEach((j, i) => {
    const local = new THREE.Matrix4().makeTranslation(j.pos[0], j.pos[1], j.pos[2]);
    world[i] = j.parent ? world[idx[j.parent]].clone().multiply(local) : local;
  });
  const geos = [];
  for (const part of parts) {
    const g = part.geo; for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); }
    const ji = idx[part.joint]; const pj = joints[ji].parent ? idx[joints[ji].parent] : ji;
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const y = g.attributes.position.getY(v);
      if (part.skin) { // explicit two-bone weights: [nameA, wA, nameB, wB]
        const [a, wa, b, wb] = part.skin(g.attributes.position.getX(v), y, g.attributes.position.getZ(v));
        si[v * 4] = idx[a]; si[v * 4 + 1] = idx[b] ?? idx[a]; sw[v * 4] = wa; sw[v * 4 + 1] = wb; continue;
      }
      let wp = 0;
      if (part.blend && joints[ji].parent) wp = 0.5 * smooth(clamp(1 - (-y) / part.blend, 0, 1)) * (y <= 0.02 ? 1 : 0);
      if (part.weight) wp = part.weight(g.attributes.position.getX(v), y, g.attributes.position.getZ(v));
      const other = part.to ? idx[part.to] : pj;
      si[v * 4] = ji; si[v * 4 + 1] = other; sw[v * 4] = 1 - wp; sw[v * 4 + 1] = wp;
    }
    const gc = g.clone(); gc.applyMatrix4(world[ji]);
    gc.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    gc.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geos.push(gc);
  }
  const geo = mergeGeometries(geos);
  geo.computeBoundingSphere();
  return { joints, idx, geo };
}

function instantiate(tpl, mat, eyeTpl) {
  const bones = tpl.joints.map((j) => { const b = new THREE.Bone(); b.name = j.name; b.position.set(...j.pos); b.rotation.order = 'YXZ'; return b; });
  tpl.joints.forEach((j, i) => { if (j.parent) bones[tpl.idx[j.parent]].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(tpl.geo, mat);
  mesh.add(bones[0]); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  const B = {}; tpl.joints.forEach((j, i) => (B[j.name] = bones[i]));
  for (const b of bones) b.userData.rest = b.position.clone();
  if (eyeTpl) { const e = new THREE.Mesh(eyeTpl.geo, eyeTpl.mat); B[eyeTpl.joint].add(e); mesh.userData.eyes = e; }
  return { mesh, B };
}

// ---------------------------------------------------------------- the seven kinds
const S = (x, y, z) => [x, y, z];
function sym(fn) { return [fn(-1, 'R'), fn(1, 'L')].flat(); }

const BUILDERS = {
  shade() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 1.0, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.14, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.3, 0) },
      { name: 'neck', parent: 'chest', pos: S(0, 0.27, 0.02) }, { name: 'head', parent: 'neck', pos: S(0, 0.13, 0.04) }, { name: 'jaw', parent: 'head', pos: S(0, -0.02, 0.06) },
      ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.21, 0.2, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.43, 0) }, { name: 'hand' + k, parent: 'fArm' + k, pos: S(0, -0.41, 0) },
        { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.11, -0.04, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.5, 0) }, { name: 'foot' + k, parent: 'shin' + k, pos: S(0, -0.47, 0) }]),
    ];
    const p = [
      { joint: 'hips', geo: blob(0.16, 0.12, 0.11, 0.25, 1) },
      { joint: 'spine', geo: place(blob(0.12, 0.2, 0.09, 0.3, 2), [0, 0.12, 0]), blend: 0.1 },
      { joint: 'chest', geo: place(blob(0.21, 0.19, 0.13, 0.3, 3), [0, 0.1, -0.01]), blend: 0.12 },
      { joint: 'chest', geo: place(blob(0.07, 0.07, 0.07, 0.2, 9), [-0.2, 0.2, 0]) }, { joint: 'chest', geo: place(blob(0.07, 0.07, 0.07, 0.2, 10), [0.2, 0.2, 0]) },
      ...[0, 1, 2, 3, 4].map((i) => ({ joint: 'chest', geo: place(cone(0.025, 0.12, 4), [0, 0.02 + i * 0.06, -0.12], [-1.9, 0, 0]) })), // spine ridges
      { joint: 'neck', geo: place(limb(0.05, 0.045, 0.16, 6, 0.1, 4), [0, 0.15, 0], [0, 0, 0]), blend: 0.05 },
      { joint: 'head', geo: place(blob(0.1, 0.125, 0.14, 0.18, 5), [0, 0.07, 0.03]) },
      { joint: 'head', geo: place(cone(0.03, 0.18, 5), [-0.07, 0.17, -0.04], [-0.6, 0, 0.4]) }, { joint: 'head', geo: place(cone(0.03, 0.18, 5), [0.07, 0.17, -0.04], [-0.6, 0, -0.4]) },
      { joint: 'jaw', geo: place(blob(0.07, 0.04, 0.09, 0.2, 6), [0, -0.03, 0.04]) },
      ...[0, 1, 2, 3, 4].map((i) => ({ joint: 'jaw', geo: place(cone(0.008, 0.05, 4), [-0.04 + i * 0.02, 0.0, 0.11], [Math.PI, 0, 0]) })),
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.05, 0.035, 0.43, 7, 0.2, 11 + s), blend: 0.08 },
        { joint: 'fArm' + k, geo: limb(0.036, 0.024, 0.41, 7, 0.2, 13 + s), blend: 0.06 },
        { joint: 'hand' + k, geo: place(blob(0.045, 0.06, 0.025, 0.2, 15), [0, -0.05, 0]), blend: 0.03 },
        ...[0, 1, 2, 3].map((i) => ({ joint: 'hand' + k, geo: place(cone(0.012, 0.24, 4), [(i - 1.5) * 0.022, -0.2, 0.02], [0.25, 0, (i - 1.5) * 0.12 + Math.PI]) })),
        { joint: 'thigh' + k, geo: limb(0.075, 0.045, 0.5, 8, 0.2, 17 + s), blend: 0.08 },
        { joint: 'shin' + k, geo: limb(0.046, 0.03, 0.47, 7, 0.2, 19 + s), blend: 0.06 },
        { joint: 'foot' + k, geo: place(blob(0.04, 0.035, 0.12, 0.2, 21), [0, -0.02, 0.08]), blend: 0.02 },
        ...[0, 1, 2].map((i) => ({ joint: 'foot' + k, geo: place(cone(0.01, 0.08, 4), [(i - 1) * 0.025, -0.03, 0.2], [Math.PI / 2, 0, 0]) })),
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.04, 0.08, 0.15], [0.04, 0.08, 0.15]], r: 0.016 } };
  },
  crawler() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 0.5, -0.2) }, { name: 'spine', parent: 'hips', pos: S(0, 0.02, 0.22) }, { name: 'chest', parent: 'spine', pos: S(0, 0.0, 0.24) },
      { name: 'head', parent: 'chest', pos: S(0, 0.02, 0.22) }, { name: 'jaw', parent: 'head', pos: S(0, -0.04, 0.06) },
      ...sym((s, k) => [
        { name: 'legF1' + k, parent: 'chest', pos: S(s * 0.13, 0, 0.04) }, { name: 'legF2' + k, parent: 'legF1' + k, pos: S(0, -0.46, 0) },
        { name: 'legB1' + k, parent: 'hips', pos: S(s * 0.12, 0, -0.02) }, { name: 'legB2' + k, parent: 'legB1' + k, pos: S(0, -0.5, 0) },
      ]),
    ];
    const p = [
      { joint: 'hips', geo: blob(0.15, 0.1, 0.16, 0.25, 31) },
      { joint: 'spine', geo: place(blob(0.13, 0.09, 0.17, 0.3, 32), [0, 0, 0.0]), blend: 0 },
      { joint: 'chest', geo: place(blob(0.16, 0.11, 0.16, 0.3, 33), [0, 0.02, 0.02]) },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ joint: i < 3 ? 'spine' : 'chest', geo: place(cone(0.022, 0.14, 4), [0, 0.1, -0.1 + (i % 3) * 0.1], [-0.3, 0, 0]) })),
      { joint: 'head', geo: place(blob(0.1, 0.07, 0.12, 0.2, 34), [0, 0, 0.06]) },
      { joint: 'jaw', geo: place(blob(0.09, 0.03, 0.09, 0.2, 35), [0, -0.01, 0.06]) },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ joint: 'jaw', geo: place(cone(0.007, 0.05, 4), [-0.06 + i * 0.024, 0.02, 0.13], [0, 0, 0]) })),
      ...sym((s, k) => [
        { joint: 'legF1' + k, geo: limb(0.04, 0.03, 0.46, 6, 0.2, 36 + s), blend: 0.05 }, { joint: 'legF2' + k, geo: limb(0.03, 0.006, 0.6, 6, 0.15, 37 + s), blend: 0.05 },
        { joint: 'legB1' + k, geo: limb(0.05, 0.035, 0.5, 6, 0.2, 38 + s), blend: 0.05 }, { joint: 'legB2' + k, geo: limb(0.035, 0.006, 0.62, 6, 0.15, 39 + s), blend: 0.05 },
      ]),
    ];
    const eyePos = []; for (let i = 0; i < 6; i++) eyePos.push([(i % 3 - 1) * 0.04, 0.05 + Math.floor(i / 3) * 0.025, 0.14]);
    return { j, p, eyes: { joint: 'head', pos: eyePos, r: 0.011 } };
  },
  wretch() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 0.85, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.12, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.24, 0) },
      { name: 'neck', parent: 'chest', pos: S(0, 0.2, 0.05) }, { name: 'head', parent: 'neck', pos: S(0, 0.1, 0.04) }, { name: 'robe', parent: 'hips', pos: S(0, 0, 0) },
      ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.17, 0.16, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.32, 0) }, { name: 'hand' + k, parent: 'fArm' + k, pos: S(0, -0.3, 0) },
        { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.09, -0.03, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.4, 0) }]),
    ];
    // ragged robe: an open cone from the chest to the ground
    const robe = new THREE.CylinderGeometry(0.16, 0.42, 1.05, 14, 6, true); robe.translate(0, -0.27, 0);
    const rp = robe.attributes.position; for (let i = 0; i < rp.count; i++) { const y = rp.getY(i); if (y < -0.75) rp.setY(i, y + Math.abs(Math.sin(i * 7.7)) * 0.18); }
    lumpyG(robe, 0.08, 41);
    const hood = new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62); place(hood, [0, 0.06, -0.02], [-0.3, 0, 0], [1, 1.15, 1.2]);
    const p = [
      { joint: 'hips', geo: blob(0.13, 0.1, 0.1, 0.2, 42) },
      { joint: 'spine', geo: place(blob(0.12, 0.16, 0.1, 0.25, 43), [0, 0.1, 0]), blend: 0.08 },
      { joint: 'chest', geo: place(blob(0.17, 0.15, 0.12, 0.25, 44), [0, 0.08, 0]), blend: 0.08 },
      { joint: 'robe', geo: robe, weight: (x, y) => smooth(clamp(-y / 1.0, 0, 1)) * 0.0, to: 'hips' },
      { joint: 'chest', geo: place(new THREE.CylinderGeometry(0.2, 0.17, 0.3, 12, 1, true), [0, 0.12, 0]) },
      { joint: 'neck', geo: place(limb(0.04, 0.04, 0.12, 6, 0.1, 45), [0, 0.11, 0]) },
      { joint: 'head', geo: place(blob(0.08, 0.1, 0.1, 0.2, 46), [0, 0.04, 0.03]) },
      { joint: 'head', geo: hood },
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.035, 0.028, 0.32, 6, 0.2, 47 + s), blend: 0.06 }, { joint: 'fArm' + k, geo: limb(0.028, 0.02, 0.3, 6, 0.2, 48 + s), blend: 0.05 },
        ...[0, 1, 2].map((i) => ({ joint: 'hand' + k, geo: place(cone(0.009, 0.14, 4), [(i - 1) * 0.02, -0.08, 0.02], [0.3, 0, Math.PI + (i - 1) * 0.2]) })),
        { joint: 'thigh' + k, geo: limb(0.05, 0.035, 0.4, 6, 0.2, 49 + s), blend: 0.06 }, { joint: 'shin' + k, geo: limb(0.035, 0.025, 0.42, 6, 0.2, 50 + s), blend: 0.05 },
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.03, 0.05, 0.11], [0.03, 0.05, 0.11]], r: 0.014 } };
  },
  husk() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 0.62, 0) }, { name: 'belly', parent: 'hips', pos: S(0, 0.3, 0.05) }, { name: 'chest', parent: 'hips', pos: S(0, 0.62, 0) },
      { name: 'head', parent: 'chest', pos: S(0, 0.12, 0.08) },
      ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.3, 0.02, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.28, 0) },
        { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.2, -0.02, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.3, 0) }]),
    ];
    const p = [
      { joint: 'hips', geo: blob(0.25, 0.16, 0.22, 0.2, 51) },
      { joint: 'belly', geo: blob(0.5, 0.48, 0.48, 0.18, 52, 3) },
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ joint: 'belly', geo: place(blob(0.09, 0.09, 0.05, 0.3, 60 + i), [Math.cos(i * 0.9) * 0.42, Math.sin(i * 1.7) * 0.3, Math.sin(i * 0.9) * 0.42]) })), // boils
      { joint: 'chest', geo: blob(0.26, 0.15, 0.22, 0.2, 53) },
      { joint: 'head', geo: place(blob(0.1, 0.09, 0.1, 0.2, 54), [0, 0.03, 0.04]) },
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.07, 0.055, 0.28, 7, 0.2, 55 + s), blend: 0.05 }, { joint: 'fArm' + k, geo: limb(0.055, 0.04, 0.26, 7, 0.2, 56 + s), blend: 0.05 },
        { joint: 'thigh' + k, geo: limb(0.11, 0.08, 0.3, 7, 0.2, 57 + s), blend: 0.05 }, { joint: 'shin' + k, geo: limb(0.08, 0.07, 0.32, 7, 0.2, 58 + s), blend: 0.05 },
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.035, 0.05, 0.12], [0.035, 0.05, 0.12]], r: 0.014 } };
  },
  brute() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 1.35, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.25, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.45, 0) },
      { name: 'neck', parent: 'chest', pos: S(0, 0.38, 0.14) }, { name: 'head', parent: 'neck', pos: S(0, 0.12, 0.12) }, { name: 'jaw', parent: 'head', pos: S(0, -0.06, 0.1) },
      ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.52, 0.3, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.68, 0) }, { name: 'hand' + k, parent: 'fArm' + k, pos: S(0, -0.74, 0) },
        { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.24, -0.06, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.64, 0) }, { name: 'foot' + k, parent: 'shin' + k, pos: S(0, -0.62, 0) }]),
    ];
    const p = [
      { joint: 'hips', geo: blob(0.36, 0.26, 0.28, 0.2, 71) },
      { joint: 'spine', geo: place(blob(0.38, 0.34, 0.3, 0.25, 72), [0, 0.2, 0]), blend: 0.15 },
      { joint: 'chest', geo: place(blob(0.6, 0.42, 0.42, 0.25, 73, 3), [0, 0.18, 0.02]), blend: 0.15 },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ joint: 'chest', geo: place(cone(0.06, 0.32, 5), [(i % 2 ? 1 : -1) * (0.15 + Math.floor(i / 2) * 0.12), 0.48 - Math.floor(i / 2) * 0.1, -0.2], [-1.0, 0, (i % 2 ? -1 : 1) * 0.4]) })),
      { joint: 'neck', geo: place(limb(0.2, 0.18, 0.2, 8, 0.15, 74), [0, 0.12, 0]), blend: 0.1 },
      { joint: 'head', geo: place(blob(0.2, 0.2, 0.22, 0.2, 75), [0, 0.04, 0.06]) },
      { joint: 'head', geo: place(horn(0.75, 0.07, 2.4), [-0.16, 0.14, 0.0], [0, -0.6, 0.3]) }, { joint: 'head', geo: place(horn(0.75, 0.07, 2.4), [0.16, 0.14, 0.0], [0, 0.6, -0.3]) },
      { joint: 'jaw', geo: place(blob(0.16, 0.07, 0.15, 0.2, 76), [0, -0.03, 0.05]) },
      ...[0, 1].map((i) => ({ joint: 'jaw', geo: place(cone(0.03, 0.14, 5), [(i ? 1 : -1) * 0.11, 0.06, 0.14], [0, 0, 0]) })),
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.2, 0.15, 0.68, 9, 0.2, 77 + s), blend: 0.15 },
        { joint: 'fArm' + k, geo: limb(0.22, 0.17, 0.74, 9, 0.25, 78 + s), blend: 0.12 },
        { joint: 'hand' + k, geo: place(blob(0.2, 0.18, 0.18, 0.25, 79), [0, -0.12, 0.03]), blend: 0.05 },
        ...[0, 1, 2].map((i) => ({ joint: 'fArm' + k, geo: place(cone(0.04, 0.2, 5), [s * 0.15, -0.2 - i * 0.18, -0.08], [-0.6, 0, -s * 1.2]) })),
        { joint: 'thigh' + k, geo: limb(0.22, 0.16, 0.64, 9, 0.2, 80 + s), blend: 0.12 },
        { joint: 'shin' + k, geo: limb(0.16, 0.13, 0.62, 9, 0.2, 81 + s), blend: 0.1 },
        { joint: 'foot' + k, geo: place(blob(0.14, 0.08, 0.24, 0.2, 82), [0, -0.04, 0.1]), blend: 0.03 },
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.08, 0.08, 0.24], [0.08, 0.08, 0.24]], r: 0.026 } };
  },
  wraith() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 1.25, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.16, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.28, 0) },
      { name: 'head', parent: 'chest', pos: S(0, 0.36, 0.06) }, { name: 'tail', parent: 'hips', pos: S(0, -0.1, 0) }, { name: 'tail2', parent: 'tail', pos: S(0, -0.6, 0) },
      ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.2, 0.2, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.42, 0) }, { name: 'hand' + k, parent: 'fArm' + k, pos: S(0, -0.46, 0) }]),
    ];
    const shroud = new THREE.CylinderGeometry(0.2, 0.55, 1.3, 16, 8, true); shroud.translate(0, -0.55, 0);
    const sp = shroud.attributes.position; for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); if (y < -0.9) sp.setY(i, y + Math.abs(Math.sin(i * 5.3)) * 0.4); }
    lumpyG(shroud, 0.12, 91);
    const hood = new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.7); place(hood, [0, 0.04, -0.03], [-0.25, 0, 0], [1, 1.3, 1.3]);
    const p = [
      { joint: 'hips', geo: blob(0.16, 0.12, 0.12, 0.2, 92) },
      { joint: 'tail', geo: shroud, weight: (x, y) => smooth(clamp((-y - 0.3) / 0.8, 0, 1)), to: 'tail2' },
      { joint: 'spine', geo: place(blob(0.14, 0.2, 0.11, 0.25, 93), [0, 0.12, 0]), blend: 0.1 },
      { joint: 'chest', geo: place(blob(0.2, 0.18, 0.13, 0.25, 94), [0, 0.12, 0]), blend: 0.1 },
      { joint: 'chest', geo: place(new THREE.CylinderGeometry(0.24, 0.2, 0.5, 14, 1, true), [0, 0.1, 0]) },
      { joint: 'head', geo: place(blob(0.08, 0.11, 0.1, 0.15, 95), [0, 0.02, 0.03]) },
      { joint: 'head', geo: hood },
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.04, 0.03, 0.42, 6, 0.15, 96 + s), blend: 0.06 },
        { joint: 'uArm' + k, geo: place(new THREE.CylinderGeometry(0.06, 0.14, 0.7, 8, 2, true), [0, -0.45, 0]) }, // trailing sleeve
        { joint: 'fArm' + k, geo: limb(0.03, 0.02, 0.46, 6, 0.15, 97 + s), blend: 0.05 },
        ...[0, 1, 2, 3].map((i) => ({ joint: 'hand' + k, geo: place(cone(0.008, 0.2, 4), [(i - 1.5) * 0.018, -0.1, 0.0], [0.1, 0, Math.PI + (i - 1.5) * 0.1]) })),
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.035, 0.04, 0.12], [0.035, 0.04, 0.12]], r: 0.018 } };
  },
  herald() {
    const j = [
      { name: 'hips', parent: null, pos: S(0, 1.2, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.16, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.3, 0) },
      { name: 'neck', parent: 'chest', pos: S(0, 0.28, 0.04) }, { name: 'head', parent: 'neck', pos: S(0, 0.12, 0.05) },
      { name: 'tail1', parent: 'hips', pos: S(0, -0.05, -0.12) }, { name: 'tail2', parent: 'tail1', pos: S(0, -0.5, 0) }, { name: 'tail3', parent: 'tail2', pos: S(0, -0.5, 0) },
      ...sym((s, k) => [
        { name: 'uArm' + k, parent: 'chest', pos: S(s * 0.2, 0.2, 0.02) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.36, 0) },
        { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.11, -0.04, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.45, 0) },
        { name: 'wing1' + k, parent: 'chest', pos: S(s * 0.12, 0.18, -0.12) }, { name: 'wing2' + k, parent: 'wing1' + k, pos: S(s * 0.9, 0, 0) }, { name: 'wing3' + k, parent: 'wing2' + k, pos: S(s * 1.0, 0, 0) },
      ]),
    ];
    const wing = (s, k) => {
      // membrane from the body to the finger tips, weighted along the wing bones
      const g = new THREE.BufferGeometry(); const pos = [], ind = [], uv = [];
      const cols = 8, rows = 4;
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
        const u = c / cols, v = r / rows; const x = s * u * 1.95; const y = -v * (0.2 + 0.9 * Math.sin(u * Math.PI * 0.9)) + Math.sin(u * 3) * 0.1 * (1 - v);
        const scallop = v === 1 ? Math.abs(Math.sin(u * Math.PI * 4)) * 0.18 : 0;
        pos.push(x, y + scallop, -v * 0.08); uv.push(u, v);
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; ind.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ind); g.computeVertexNormals();
      return [
        { joint: 'wing1' + k, geo: g, weight: (x) => smooth(clamp((Math.abs(x) - 0.4) / 0.6, 0, 1)), to: 'wing2' + k },
        { joint: 'wing1' + k, geo: place(limb(0.035, 0.03, 0.9, 6, 0.1, 101), [0, 0, 0], [0, 0, s * Math.PI / 2]) },
        { joint: 'wing2' + k, geo: place(limb(0.03, 0.012, 1.0, 6, 0.1, 102), [0, 0, 0], [0, 0, s * Math.PI / 2]) },
        { joint: 'wing3' + k, geo: place(cone(0.02, 0.15, 4), [s * 0.05, 0, 0], [0, 0, s * Math.PI / 2]) },
      ];
    };
    const p = [
      { joint: 'hips', geo: blob(0.15, 0.12, 0.11, 0.2, 103) },
      { joint: 'spine', geo: place(blob(0.13, 0.19, 0.1, 0.25, 104), [0, 0.12, 0]), blend: 0.1 },
      { joint: 'chest', geo: place(blob(0.21, 0.2, 0.14, 0.25, 105), [0, 0.1, 0]), blend: 0.1 },
      { joint: 'neck', geo: place(limb(0.05, 0.045, 0.16, 6, 0.1, 106), [0, 0.15, 0]), blend: 0.05 },
      { joint: 'head', geo: place(blob(0.1, 0.12, 0.13, 0.2, 107), [0, 0.06, 0.03]) },
      ...[0, 1, 2, 3, 4].map((i) => ({ joint: 'head', geo: place(cone(0.02, 0.18 + (i === 2 ? 0.08 : 0), 5), [(i - 2) * 0.05, 0.17, -0.02], [-0.3, 0, (i - 2) * -0.25]) })), // crown of horns
      { joint: 'tail1', geo: limb(0.06, 0.04, 0.5, 6, 0.1, 108), blend: 0.05 }, { joint: 'tail2', geo: limb(0.04, 0.025, 0.5, 6, 0.1, 109), blend: 0.05 },
      { joint: 'tail3', geo: limb(0.025, 0.005, 0.5, 6, 0.1, 110), blend: 0.05 },
      ...sym((s, k) => [
        { joint: 'uArm' + k, geo: limb(0.045, 0.035, 0.36, 6, 0.2, 111 + s), blend: 0.06 }, { joint: 'fArm' + k, geo: limb(0.035, 0.02, 0.4, 6, 0.2, 112 + s), blend: 0.05 },
        { joint: 'thigh' + k, geo: limb(0.07, 0.045, 0.45, 7, 0.2, 113 + s), blend: 0.06 }, { joint: 'shin' + k, geo: limb(0.045, 0.02, 0.5, 6, 0.2, 114 + s), blend: 0.05 },
        ...wing(s, k),
      ]),
    ];
    return { j, p, eyes: { joint: 'head', pos: [[-0.04, 0.07, 0.14], [0.04, 0.07, 0.14]], r: 0.017 } };
  },
};

const templates = {};
function getTemplate(type) {
  if (templates[type]) return templates[type];
  const b = BUILDERS[type]();
  const tpl = buildTemplate(b.j, b.p);
  const eyeGeos = b.eyes.pos.map((p) => place(new THREE.SphereGeometry(b.eyes.r, 8, 6), p));
  tpl.eye = { joint: b.eyes.joint, geo: mergeGeometries(eyeGeos), mat: new THREE.MeshBasicMaterial({ color: new THREE.Color(TYPES[type].eye).multiplyScalar(3), toneMapped: false }) };
  templates[type] = tpl; return tpl;
}
export function prewarmDemons() { for (const t in TYPES) getTemplate(t); }

// ---------------------------------------------------------------- demon instance
const ST = { spawn: 0, chase: 1, windup: 2, strike: 3, recover: 4, stagger: 5, dead: 6, special: 7, flee: 8, leap: 9 };
export const STATE_NAMES = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));

export class Demon {
  constructor(type, id, scene) {
    this.type = type; this.def = TYPES[type]; this.id = id; this.scene = scene;
    const tpl = getTemplate(type);
    this.mat = demonMaterial(this.def.rim);
    const { mesh, B } = instantiate(tpl, this.mat, tpl.eye);
    this.mesh = mesh; this.B = B; scene.add(mesh);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.state = ST.spawn; this.stateT = 0; this.cd = R() * 1.0; this.target = null; this.retarget = 0;
    this.phase = R(); this.speedVis = 0; this.hitFlash = 0; this.flinch = 0; this.flinchDir = 1; this.dissolve = 0; this.alive = true; this.removed = false;
    this.seed = R() * 100; this.special = 0; this.fuse = -1; this.alt = this.def.flies || 0;
    this.scale = this.def.big ? 1 : 0.92 + R() * 0.16; mesh.scale.setScalar(this.scale);
    this.wispT = 0; this.lastHitBy = null; this.buff = 0;
  }
  get radius() { return this.def.radius * this.scale; }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + this.def.height * 0.6 * this.scale + (this.alt || 0), this.pos.z); }
  setState(s) { this.state = s; this.stateT = 0; }

  // ------------------------------------------------ host AI
  simulate(dt, C) {
    this.stateT += dt; this.cd -= dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.flinch = Math.max(0, this.flinch - dt * 4);
    this.buff = Math.max(0, this.buff - dt);
    const def = this.def;
    if (this.state === ST.dead) { this.vel.multiplyScalar(0.9); return; }
    if (this.state === ST.spawn) { if (this.stateT > 1.3) this.setState(ST.chase); this.pos.y = C.world.heightAt(this.pos.x, this.pos.z); return; }
    // targeting: prefer knights at prayer, then the nearest
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || this.target.downed) {
      this.retarget = 0.8 + R() * 0.6; let best = null, bs = 1e9;
      for (const k of C.knights) { if (k.downed) continue; let d = k.pos.distanceTo(this.pos); if (k.praying) d *= 0.55; if (k === this.target) d *= 0.85; if (d < bs) { bs = d; best = k; } }
      this.target = best;
    }
    const T = this.target;
    let want = new THREE.Vector3();
    let speed = def.speed * (1 + this.buff * 0.25) * (C.speedMul || 1);
    let toT = T ? new THREE.Vector3(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z) : new THREE.Vector3();
    const dist = toT.length(); if (dist > 1e-4) toT.divideScalar(dist);
    const faceT = () => { if (T) this.yaw = dampAngle(this.yaw, Math.atan2(toT.x, toT.z), 8, dt); };
    const bh = this.behave[this.type] || this.behave.melee;
    bh.call(this, dt, C, T, toT, dist, want, speed, faceT);
    // separation from other demons
    const near = C.hash.query(this.pos.x, this.pos.z, 2.5, this._near || (this._near = []));
    for (const o of near) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z; const d2 = dx * dx + dz * dz; const m = this.radius + o.radius;
      if (d2 < m * m && d2 > 1e-6) { const d = Math.sqrt(d2); const push = (m - d) / d * (o.def.mass / (o.def.mass + def.mass)); this.pos.x += dx * push * 0.5; this.pos.z += dz * push * 0.5; }
    }
    // knights are solid
    for (const k of C.knights) {
      if (k.downed) continue;
      const dx = this.pos.x - k.pos.x, dz = this.pos.z - k.pos.z; const d = Math.hypot(dx, dz); const m = this.radius + 0.4;
      if (d < m && d > 1e-4) { this.pos.x = k.pos.x + dx / d * m; this.pos.z = k.pos.z + dz / d * m; }
    }
    this.vel.x = damp(this.vel.x, want.x, this.state === ST.stagger ? 2 : 8, dt); this.vel.z = damp(this.vel.z, want.z, this.state === ST.stagger ? 2 : 8, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    C.world.collide(this, this.radius * 0.8);
    const gy = C.world.heightAt(this.pos.x, this.pos.z);
    if (this.state === ST.leap) this.pos.y = gy + Math.sin(clamp(this.stateT / this.leapT, 0, 1) * Math.PI) * (this.leapH || 1.4);
    else this.pos.y = gy;
    if (def.flies) { const tgtAlt = this.state === ST.strike ? 1.0 : this.state === ST.windup ? 3 : def.flies; this.alt = damp(this.alt, tgtAlt, 3, dt); }
    if (def.floats) this.alt = def.floats + Math.sin(C.time * 1.7 + this.seed) * 0.15;
  }

  // shared melee: approach, wind up, strike in an arc, recover
  meleeStep(dt, C, T, toT, dist, want, speed, faceT, o = {}) {
    const def = this.def;
    switch (this.state) {
      case ST.chase: {
        if (!T) break;
        // weave slightly so the swarm surrounds rather than queues
        const side = Math.sin(C.time * 0.8 + this.seed) * 0.35;
        want.set(toT.x + toT.z * side, 0, toT.z - toT.x * side).normalize().multiplyScalar(speed * (dist < 3 ? 0.4 : 1));
        faceT();
        if (o.leap && dist < o.leap[1] && dist > o.leap[0] && this.cd <= 0) { this.setState(ST.leap); this.leapT = o.leapT || 0.6; this.leapH = o.leapH || 1.2; this.leapDir = toT.clone(); this.leapSpeed = dist / this.leapT * 1.05; C.ev('demonSfx', this, 'leap'); break; }
        if (dist < def.range * this.scale + 0.3 && this.cd <= 0) { this.setState(ST.windup); this.atk = o.pickAttack ? o.pickAttack.call(this, dist) : 0; C.ev('demonSfx', this, 'windup'); }
        break;
      }
      case ST.leap: {
        want.copy(this.leapDir).multiplyScalar(this.leapSpeed);
        if (this.stateT >= this.leapT) { this.setState(ST.strike); this.atk = 9; this.didHit = false; }
        break;
      }
      case ST.windup: {
        faceT();
        if (this.stateT >= (o.windup ? o.windup[this.atk] ?? o.windup[0] : 0.45)) { this.setState(ST.strike); this.didHit = false; }
        break;
      }
      case ST.strike: {
        const step = o.lunge ?? 2.5; const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        if (this.stateT < 0.15) want.copy(f).multiplyScalar(step);
        if (!this.didHit && this.stateT > 0.08) {
          this.didHit = true;
          const reach = def.range * this.scale + 0.6, arc = o.arc || 1.2;
          for (const k of C.knights) {
            if (k.downed) continue;
            const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z; const d = Math.hypot(dx, dz);
            const ang = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
            if (d < reach && ang < arc) C.damageKnight(k, def.dmg * (o.dmgMul ? o.dmgMul[this.atk] ?? 1 : 1) * (C.dmgMul || 1), this.pos, o.hitOpts ? o.hitOpts[this.atk] : undefined, this);
          }
          if (o.onStrike) o.onStrike.call(this, C);
        }
        if (this.stateT > 0.32) { this.setState(ST.recover); }
        break;
      }
      case ST.recover: if (this.stateT > (o.recover || 0.45)) { this.setState(ST.chase); this.cd = def.cd * (0.7 + R() * 0.6); } break;
      case ST.stagger: if (this.stateT > 0.55) this.setState(ST.chase); break;
    }
  }

  // ------------------------------------------------ damage
  takeHit(dmg, dir, stagger, C, byId) {
    if (!this.alive || this.state === ST.spawn && this.stateT < 0.6) return false;
    this.hp -= dmg; this.hitFlash = 1; this.flinch = 1; this.flinchDir = R() < 0.5 ? -1 : 1; this.lastHitBy = byId;
    if (dir) { const k = 3.5 * stagger / this.def.mass; this.vel.x += dir.x * k; this.vel.z += dir.z * k; }
    if (this.hp <= 0) { this.die(C); return true; }
    if (stagger * this.def.stagger > 0.55 && this.state !== ST.leap) { this.setState(ST.stagger); }
    return false;
  }
  die(C) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this.setState(ST.dead); this.mesh.castShadow = false;
    if (C) C.ev('demonDeath', this);
    if (this.onDeath) this.onDeath(this);
  }

  // ------------------------------------------------ client puppet
  applySnap(s, dt) {
    // [id, typeIdx, x, z, yaw, state, stateT, hp%, alt, atk]
    const [, , x, z, yaw, st, stT, hpP, alt, atk] = s;
    if (this.snapInit) { const k = 1 - Math.exp(-14 * dt); this.pos.x += (x - this.pos.x) * k; this.pos.z += (z - this.pos.z) * k; if (Math.hypot(x - this.pos.x, z - this.pos.z) > 5) { this.pos.x = x; this.pos.z = z; } }
    else { this.pos.x = x; this.pos.z = z; this.snapInit = true; }
    this.yaw = dampAngle(this.yaw, yaw, 14, dt);
    if (st !== this.state) { this.state = st; this.stateT = stT; } else this.stateT = Math.max(this.stateT, stT);
    const hp = hpP / 100 * this.maxHp; if (hp < this.hp - 0.5) { this.hitFlash = 1; this.flinch = 0.6; }
    this.hp = hp; this.alt = alt; this.atk = atk;
  }
  snap(typeIdx) { return [this.id, typeIdx, +this.pos.x.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(2), this.state, +this.stateT.toFixed(2), Math.round(this.hp / this.maxHp * 100), +(this.alt || 0).toFixed(2), this.atk || 0]; }

  // ------------------------------------------------ animation
  animate(dt, time, world, fx, camPos) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedVis = damp(this.speedVis, sp, 8, dt);
    if (this.state === ST.dead) {
      this.dissolve = Math.min(1, this.dissolve + dt * 0.75);
      this.mat.userData.u.uDissolve.value = 0.02 + this.dissolve * 0.98;
      if (fx && R() < 0.5) fx.wisp(this.chest, 0.5);
      if (this.dissolve >= 1) this.removed = true;
    }
    this.mat.userData.u.uHit.value = this.hitFlash * 0.8;
    // distance LOD for animation updates
    const d2 = camPos ? (camPos.x - this.pos.x) ** 2 + (camPos.z - this.pos.z) ** 2 : 0;
    this.lodSkip = d2 > 70 * 70 ? (this.lodSkip + 1) % 3 : 0;
    this.mesh.position.set(this.pos.x, (world && this.state !== ST.leap && !this.def.flies && !this.def.floats ? this.pos.y : this.pos.y) + (this.alt || 0), this.pos.z);
    this.mesh.rotation.y = this.yaw;
    if (this.lodSkip) return;
    // emerging from the earth
    if (this.state === ST.spawn) this.mesh.position.y -= (1 - smooth(clamp(this.stateT / 1.1, 0, 1))) * this.def.height * this.scale;
    ANIM[this.type].call(this, dt, time);
    // smoke wisps trail off the shadow-flesh
    this.wispT += dt;
    if (fx && this.wispT > (d2 > 40 * 40 ? 0.5 : 0.18) && this.state !== ST.dead) { this.wispT = 0; fx.wisp(this.chest, 0.35 * this.scale * (this.def.big ? 1.6 : 1)); }
  }

  dispose() { this.scene.remove(this.mesh); this.mat.dispose(); }
}

// ---------------------------------------------------------------- behaviours (host)
Demon.prototype.behave = {
  melee(dt, C, T, toT, dist, want, speed, faceT) { this.meleeStep(dt, C, T, toT, dist, want, speed, faceT); },
  shade(dt, C, T, toT, dist, want, speed, faceT) {
    this.meleeStep(dt, C, T, toT, dist, want, speed, faceT, { leap: [3.2, 6.0], leapT: 0.55, leapH: 1.3, windup: [0.42], lunge: 3 });
  },
  crawler(dt, C, T, toT, dist, want, speed, faceT) {
    // erratic scuttling
    if (this.state === ST.chase) { this.zig = (this.zig || 0) + dt * 5; }
    this.meleeStep(dt, C, T, toT, dist, want, speed, faceT, { leap: [2.6, 6.5], leapT: 0.5, leapH: 1.0, windup: [0.25], lunge: 2, arc: 1.4 });
    if (this.state === ST.chase) { const z = Math.sin(this.zig + this.seed) * 0.7; want.x += -toT.z * z * speed * 0.6; want.z += toT.x * z * speed * 0.6; }
  },
  wretch(dt, C, T, toT, dist, want, speed, faceT) {
    const def = this.def;
    switch (this.state) {
      case ST.chase: {
        if (!T) break; faceT();
        if (dist > 18) want.copy(toT).multiplyScalar(speed);
        else if (dist < 8) want.copy(toT).multiplyScalar(-speed * 0.9);
        else { const s = Math.sin(C.time * 0.5 + this.seed); want.set(-toT.z * s, 0, toT.x * s).multiplyScalar(speed * 0.5); }
        if (this.cd <= 0 && dist < def.range && dist > 4) { this.setState(ST.windup); C.ev('demonSfx', this, 'cast'); }
        break;
      }
      case ST.windup: faceT(); if (this.stateT > 0.9) { this.setState(ST.strike); if (T) C.projectile('bolt', this, T); } break;
      case ST.strike: if (this.stateT > 0.35) { this.setState(ST.chase); this.cd = def.cd * (0.8 + R() * 0.5); } break;
      case ST.stagger: if (this.stateT > 0.5) this.setState(ST.chase); break;
    }
  },
  husk(dt, C, T, toT, dist, want, speed, faceT) {
    switch (this.state) {
      case ST.chase: if (!T) break; faceT(); want.copy(toT).multiplyScalar(speed); if (dist < 2.6) { this.setState(ST.special); C.ev('demonSfx', this, 'inflate'); } break;
      case ST.special: want.set(0, 0, 0); if (this.stateT > 1.1) { C.explode(this, 4.5, this.def.dmg); this.die(C); } break;
      case ST.stagger: if (this.stateT > 0.5) this.setState(ST.chase); break;
    }
  },
  brute(dt, C, T, toT, dist, want, speed, faceT) {
    const def = this.def;
    if (this.state === ST.chase && T && this.cd <= 0 && dist > 7 && dist < 22 && R() < dt * 0.8) { this.setState(ST.special); this.charge = toT.clone(); C.ev('demonSfx', this, 'roar'); return; }
    if (this.state === ST.special) { // paw the ground, then charge in a line
      if (this.stateT < 0.9) { faceT(); if (T) this.charge.copy(toT); want.set(0, 0, 0); }
      else if (this.stateT < 2.3) {
        want.copy(this.charge).multiplyScalar(12);
        for (const k of C.knights) { if (k.downed || (this.chargeHit && this.chargeHit.has(k))) continue; if (k.pos.distanceTo(this.pos) < 1.8) { (this.chargeHit || (this.chargeHit = new Set())).add(k); C.damageKnight(k, 30 * (C.dmgMul || 1), this.pos, { knockdown: true, knockback: 9 }, this); } }
        if (C.world.colGrid.query(this.pos.x + this.charge.x, this.pos.z + this.charge.z, 1.2, []).length) { this.setState(ST.stagger); C.ev('slam', this.pos, 2.5); }
      } else { this.setState(ST.recover); this.cd = 3; this.chargeHit = null; }
      return;
    }
    this.meleeStep(dt, C, T, toT, dist, want, speed, faceT, {
      pickAttack: (d) => (R() < 0.45 ? 1 : 0), windup: [0.55, 0.9], dmgMul: [1, 1.15], lunge: 1.5, arc: 1.6, recover: 0.8,
      hitOpts: [{ knockback: 6 }, { knockdown: true }],
      onStrike(C2) { if (this.atk === 1) { C2.ev('slam', this.pos, 3.6); for (const k of C2.knights) if (!k.downed && k.pos.distanceTo(this.pos) < 3.6 && k.pos.distanceTo(this.pos) > this.def.range) C2.damageKnight(k, 16 * (C2.dmgMul || 1), this.pos, { knockdown: true }, this); } },
    });
  },
  wraith(dt, C, T, toT, dist, want, speed, faceT) {
    const def = this.def;
    switch (this.state) {
      case ST.chase: {
        if (!T) break; faceT();
        if (dist > 14) want.copy(toT).multiplyScalar(speed); else if (dist < 6) want.copy(toT).multiplyScalar(-speed * 0.6);
        this.special += dt;
        if (this.special > 6 && R() < dt) { this.special = 0; this.setState(ST.flee); C.ev('demonSfx', this, 'blink'); break; }
        if (this.cd <= 0 && dist < def.range) { this.setState(ST.windup); C.ev('demonSfx', this, 'lance'); }
        break;
      }
      case ST.flee: // blink: vanish and reappear beside another knight
        if (this.stateT > 0.5 && !this.blinked) {
          this.blinked = true; const k = C.knights[Math.floor(R() * C.knights.length)];
          if (k) { const a = R() * TAU; this.pos.x = k.pos.x + Math.cos(a) * 9; this.pos.z = k.pos.z + Math.sin(a) * 9; C.world.collide(this, 0.5); }
        }
        if (this.stateT > 1.0) { this.blinked = false; this.setState(ST.chase); }
        break;
      case ST.windup: faceT(); if (this.stateT > 1.2) { this.setState(ST.strike); if (T) C.projectile('lance', this, T); } break;
      case ST.strike: if (this.stateT > 0.5) { this.setState(ST.chase); this.cd = def.cd; } break;
      case ST.stagger: if (this.stateT > 0.5) this.setState(ST.chase); break;
    }
  },
  herald(dt, C, T, toT, dist, want, speed, faceT) {
    this.special += dt;
    // shriek: summon shades and drive nearby demons into a frenzy
    if (this.special > 11 && this.state === ST.chase) { this.special = 0; this.setState(ST.flee); C.ev('demonSfx', this, 'shriek'); C.summon(this, 'shade', 3); for (const o of C.hash.query(this.pos.x, this.pos.z, 14, [])) o.buff = 6; return; }
    if (this.state === ST.flee) { want.set(0, 0, 0); if (this.stateT > 1.4) this.setState(ST.chase); return; }
    if (this.state === ST.chase && T) {
      // circle the knights, then dive
      const a = C.time * 0.6 + this.seed; const cx = T.pos.x + Math.cos(a) * 9, cz = T.pos.z + Math.sin(a) * 9;
      want.set(cx - this.pos.x, 0, cz - this.pos.z); const l = want.length(); if (l > 0.1) want.multiplyScalar(speed / l);
      this.yaw = dampAngle(this.yaw, Math.atan2(want.x, want.z), 4, dt);
      if (this.cd <= 0 && dist < 12) { this.setState(ST.windup); C.ev('demonSfx', this, 'shriekShort'); }
      return;
    }
    this.meleeStep(dt, C, T, toT, dist, want, speed, faceT, { windup: [0.6], lunge: 9, arc: 1.0, recover: 0.7 });
  },
};

// ---------------------------------------------------------------- procedural animation (shared host/client)
const e = (b, x, y, z) => { b.rotation.set(x * D2R, y * D2R, z * D2R); };
const sinp = (t) => Math.sin(t * TAU);

function deathPose(B, t, fall = 1) {
  const k = smooth(clamp(t / 0.7, 0, 1));
  if (B.spine) e(B.spine, 40 * k * fall, 0, 10 * k);
  if (B.head) e(B.head, 30 * k, 0, 0);
  if (B.hips) { B.hips.position.y = B.hips.userData.rest.y * (1 - 0.55 * k); B.hips.rotation.x = 20 * k * D2R; }
}

const ANIM = {
  shade(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 2.6;
    const ph = this.phase, run = clamp(s / 5, 0, 1);
    const tw = Math.sin(time * 23 + this.seed) * 3 * (1 - run * 0.5); // twitch
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += -Math.abs(Math.sin(ph * TAU)) * 0.08 * run;
    e(B.hips, 6 * run, sinp(ph) * 8 * run, 0);
    e(B.spine, 22 + 18 * run, -sinp(ph) * 6 * run, 0); e(B.chest, 16 + 8 * run, -sinp(ph) * 8 * run, tw * 0.5);
    e(B.neck, -24 - 10 * run, 0, 0); e(B.head, -18 + tw, Math.sin(time * 1.3 + this.seed) * 25 * (1 - run), tw * 2);
    e(B.jaw, 10 + Math.max(0, Math.sin(time * 5 + this.seed)) * 18, 0, 0);
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = (ph + o) % 1; const sw = sinp(p), cw = Math.cos(p * TAU);
      e(B['thigh' + k], -sw * 40 * run - 15, 0, sg * 5); e(B['shin' + k], 25 + Math.max(0, cw) * 70 * run, 0, 0); e(B['foot' + k], -10 + sw * 20 * run, 0, 0);
      // arms trail behind while sprinting, loose and clawing at idle
      e(B['uArm' + k], lerp(-20 + Math.sin(time * 2 + o * 6) * 8, 55 + sw * 20, run), 0, sg * (12 + 18 * run)); e(B['fArm' + k], lerp(-35, -20, run), 0, 0); e(B['hand' + k], -20, 0, 0);
    }
    if (st === ST.windup || st === ST.strike || st === ST.recover || st === ST.leap) {
      const w = st === ST.windup ? smooth(clamp(T / 0.4, 0, 1)) : st === ST.leap ? 1 : 0;
      const sk = st === ST.strike ? smooth(clamp(T / 0.18, 0, 1)) : st === ST.recover ? 1 - smooth(clamp(T / 0.4, 0, 1)) * 0.6 : 0;
      for (const [k, sg] of [['R', -1], ['L', 1]]) {
        const up = -150 * w, down = -30; const x = st === ST.windup || st === ST.leap ? up : lerp(-150, down, sk);
        e(B['uArm' + k], x, 0, sg * (40 * w + 10 - 30 * sk)); e(B['fArm' + k], -60 * w - 10, 0, 0); e(B['hand' + k], 20, 0, 0);
      }
      e(B.chest, 10 - 25 * w + 40 * sk, 0, 0); e(B.head, -30 * w + 10 * sk, 0, 0); e(B.jaw, 40, 0, 0);
      if (st === ST.leap) { e(B.thighR, -70, 0, -5); e(B.thighL, -50, 0, 5); e(B.shinR, 100, 0, 0); e(B.shinL, 80, 0, 0); }
    }
    if (st === ST.spawn) { const k = clamp(T / 1.1, 0, 1); e(B.uArmR, -160 + k * 120, 0, -30); e(B.uArmL, -150 + k * 110, 0, 30); e(B.spine, 50 - k * 30, 0, 0); }
    if (st === ST.stagger) { e(B.spine, 0, 0, 0); e(B.chest, -20, 0, 10 * this.flinchDir); e(B.head, -30, 0, 0); }
    if (this.flinch > 0) { B.chest.rotation.x -= this.flinch * 0.35; B.head.rotation.z += this.flinch * 0.3 * this.flinchDir; }
    if (st === ST.dead) { deathPose(B, T); e(B.uArmR, -20, 0, -60 * clamp(T, 0, 1)); e(B.uArmL, -20, 0, 60 * clamp(T, 0, 1)); }
  },
  crawler(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 1.3;
    const ph = this.phase, run = clamp(s / 4, 0, 1);
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += Math.abs(Math.sin(ph * TAU * 2)) * 0.05 * run + Math.sin(time * 9 + this.seed) * 0.01;
    e(B.hips, 0, Math.sin(ph * TAU) * 8 * run, Math.sin(ph * TAU * 2) * 5 * run);
    e(B.spine, 0, -Math.sin(ph * TAU) * 6 * run, 0); e(B.chest, -6, 0, 0);
    e(B.head, -10 + Math.sin(time * 7 + this.seed) * 6, Math.sin(time * 3 + this.seed) * 20 * (1 - run), Math.sin(time * 11 + this.seed) * 8);
    e(B.jaw, 15 + Math.max(0, Math.sin(time * 6 + this.seed)) * 25, 0, 0);
    // spider-legs: knees high, feet planted, diagonal pairs
    const legs = [['F', 'R', -1, 0], ['B', 'L', 1, 0], ['F', 'L', 1, 0.5], ['B', 'R', -1, 0.5]];
    for (const [fb, k, sg, o] of legs) {
      const p = (ph + o) % 1; const lift = Math.max(0, Math.sin(p * TAU)) * run; const swing = Math.cos(p * TAU) * run;
      const u = B['leg' + fb + '1' + k], l = B['leg' + fb + '2' + k];
      const fwd = fb === 'F' ? -1 : 1;
      e(u, fwd * (15 + swing * 25), 0, sg * (95 + lift * 25)); e(l, 0, 0, -sg * (125 + lift * 20));
    }
    if (st === ST.windup || st === ST.leap || st === ST.strike) {
      const w = st === ST.windup ? smooth(clamp(T / 0.25, 0, 1)) : 1;
      e(B.chest, -35 * w, 0, 0); e(B.head, -25 * w, 0, 0); e(B.jaw, 50 * w, 0, 0);
      for (const k of ['R', 'L']) { const sg = k === 'R' ? -1 : 1; e(B['legF1' + k], -70 * w, 0, sg * 60); e(B['legF2' + k], 0, 0, -sg * 60); }
      B.hips.position.y -= 0.12 * w * (st === ST.windup ? 1 : 0);
    }
    if (st === ST.spawn) B.hips.rotation.x = -40 * D2R * (1 - clamp(T / 1.1, 0, 1));
    if (this.flinch > 0) { B.chest.rotation.z += this.flinch * 0.4 * this.flinchDir; }
    if (st === ST.dead) { const k = smooth(clamp(T / 0.5, 0, 1)); B.hips.rotation.z = k * 2.6; B.hips.position.y = B.hips.userData.rest.y * (1 - 0.3 * k); }
  },
  wretch(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 1.6; const ph = this.phase, run = clamp(s / 3.5, 0, 1);
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += -Math.abs(Math.sin(ph * TAU)) * 0.05 * run;
    e(B.hips, 0, 0, Math.sin(ph * TAU) * 6 * run);
    e(B.spine, 30, 0, 0); e(B.chest, 22, 0, Math.sin(time * 1.1 + this.seed) * 4); e(B.neck, -30, 0, 0); e(B.head, -10, Math.sin(time * 0.9 + this.seed) * 20, 0);
    e(B.robe, -20, 0, Math.sin(ph * TAU) * 4 * run);
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = (ph + o) % 1; e(B['thigh' + k], -sinp(p) * 30 * run - 10, 0, 0); e(B['shin' + k], 20 + Math.max(0, Math.cos(p * TAU)) * 50 * run, 0, 0);
      e(B['uArm' + k], -30 + sinp(time * 0.3 + o) * 6, 0, sg * 10); e(B['fArm' + k], -60, 0, 0);
    }
    if (st === ST.windup || st === ST.strike) {
      const w = st === ST.windup ? smooth(clamp(T / 0.6, 0, 1)) : 1 - smooth(clamp(T / 0.3, 0, 1));
      const thr = st === ST.strike ? smooth(clamp(T / 0.15, 0, 1)) : 0;
      e(B.uArmR, -110 * w - 60 * thr, 0, -20 + 30 * thr); e(B.fArmR, -40 * w, 0, 0); e(B.uArmL, -100 * w, 0, 30); e(B.fArmL, -50 * w, 0, 0);
      e(B.chest, 10 - 20 * w + 30 * thr, 0, 0); e(B.head, -25 * w, 0, 0);
    }
    if (this.flinch > 0) B.chest.rotation.x -= this.flinch * 0.4;
    if (st === ST.dead) deathPose(B, T);
  },
  husk(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 0.9; const ph = this.phase, run = clamp(s / 2.5, 0, 1);
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += Math.abs(Math.sin(ph * TAU)) * 0.06 * run;
    e(B.hips, 0, 0, Math.sin(ph * TAU) * 12 * run);
    e(B.chest, 10, 0, -Math.sin(ph * TAU) * 6 * run); e(B.head, -10, Math.sin(time * 2 + this.seed) * 15, 0);
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = (ph + o) % 1; e(B['thigh' + k], -sinp(p) * 30 * run, 0, sg * 12); e(B['shin' + k], 10 + Math.max(0, Math.cos(p * TAU)) * 40 * run, 0, 0);
      e(B['uArm' + k], -20 + sinp(p) * 20 * run, 0, sg * 40); e(B['fArm' + k], -40, 0, 0);
    }
    let infl = 1 + Math.sin(time * 2 + this.seed) * 0.03;
    if (st === ST.special) { const k = clamp(T / 1.1, 0, 1); infl = 1 + k * 0.45 + Math.sin(T * 40) * 0.04 * k; this.mat.userData.u.uGlow.value = 1 + k * 4; }
    B.belly.scale.setScalar(infl);
    if (this.flinch > 0) B.chest.rotation.x -= this.flinch * 0.3;
    if (st === ST.dead) deathPose(B, T, 0.4);
  },
  brute(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 3.4; const ph = this.phase, run = clamp(s / 4, 0, 1);
    const charging = st === ST.special && T > 0.9;
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += -Math.abs(Math.sin(ph * TAU)) * 0.12 * run;
    e(B.hips, 8 * run, sinp(ph) * 10 * run, Math.sin(ph * TAU) * 4 * run);
    e(B.spine, 18 + 14 * run + (charging ? 20 : 0), -sinp(ph) * 8 * run, 0); e(B.chest, 10 + 6 * run, -sinp(ph) * 10 * run, 0);
    e(B.neck, -25 - (charging ? 10 : 0), 0, 0); e(B.head, -10 + (charging ? 25 : 0), Math.sin(time * 0.7 + this.seed) * 15 * (1 - run), 0);
    e(B.jaw, 8 + Math.max(0, Math.sin(time * 2 + this.seed)) * 12, 0, 0);
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = (ph + o) % 1; const sw = sinp(p);
      e(B['thigh' + k], -sw * 32 * run - 12, 0, sg * 8); e(B['shin' + k], 22 + Math.max(0, Math.cos(p * TAU)) * 55 * run, 0, 0); e(B['foot' + k], -10, 0, 0);
      // knuckle-walking gait when running, heavy arm swing
      e(B['uArm' + k], -10 + sw * -40 * run, 0, sg * 18); e(B['fArm' + k], -30 - 20 * run, 0, 0); e(B['hand' + k], 0, 0, 0);
    }
    if (st === ST.special && T < 0.9) { // paw the ground
      const k = Math.sin(T * 14); e(B.uArmR, -60 + k * 20, 0, -20); e(B.fArmR, -20, 0, 0); e(B.spine, 40, 0, 0); e(B.head, 10, 0, 0); e(B.jaw, 40, 0, 0);
    }
    if (st === ST.windup || st === ST.strike || st === ST.recover) {
      const w = st === ST.windup ? smooth(clamp(T / (this.atk === 1 ? 0.85 : 0.5), 0, 1)) : 0;
      const sk = st === ST.strike ? smooth(clamp(T / 0.15, 0, 1)) : st === ST.recover ? 1 : 0;
      if (this.atk === 1) { // overhead double-fist ground slam
        for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k], lerp(-170 * w, -60, sk), 0, sg * 25); e(B['fArm' + k], lerp(-50 * w, -10, sk), 0, 0); }
        e(B.spine, lerp(-5 * w + 18, 45, sk), 0, 0); e(B.head, -20 * w, 0, 0); e(B.jaw, 45 * w, 0, 0);
        B.hips.position.y -= sk * 0.35;
      } else { // backhand swipe
        e(B.uArmR, lerp(-60 * w, -80, sk), lerp(-50 * w, 70, sk), -60 + 30 * sk); e(B.fArmR, -40 * (1 - sk), 0, 0);
        e(B.chest, 10, lerp(-40 * w, 45, sk), 0);
      }
    }
    if (this.flinch > 0) B.chest.rotation.x -= this.flinch * 0.2;
    if (st === ST.stagger) { e(B.chest, -15, 0, 10); e(B.head, -25, 0, 0); }
    if (st === ST.dead) { deathPose(B, T * 0.7); e(B.thighR, -70 * clamp(T, 0, 1), 0, 0); e(B.shinR, 110 * clamp(T, 0, 1), 0, 0); }
  },
  wraith(dt, time) {
    const B = this.B, st = this.state, T = this.stateT;
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += Math.sin(time * 1.7 + this.seed) * 0.08;
    const lean = clamp(this.speedVis / 5, 0, 1);
    e(B.hips, 10 * lean, 0, 0); e(B.spine, 10, 0, Math.sin(time * 0.8 + this.seed) * 5); e(B.chest, 8, 0, 0); e(B.head, -10, Math.sin(time * 0.6 + this.seed) * 25, Math.sin(time * 1.1) * 10);
    e(B.tail, 15 * lean + Math.sin(time * 2.1 + this.seed) * 6, 0, Math.sin(time * 1.4 + this.seed) * 8); e(B.tail2, 25 * lean + Math.sin(time * 2.6 + this.seed) * 10, 0, Math.sin(time * 1.9) * 10);
    for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k], -15 + Math.sin(time * 1.2 + sg) * 8, 0, sg * 22); e(B['fArm' + k], -25, 0, 0); e(B['hand' + k], 10, 0, 0); }
    if (st === ST.windup || st === ST.strike) {
      const w = st === ST.windup ? smooth(clamp(T / 1.0, 0, 1)) : 1 - smooth(clamp(T / 0.5, 0, 1));
      e(B.uArmR, -95 * w, 0, -10); e(B.fArmR, -5, 0, 0); e(B.uArmL, -60 * w, 0, 50 * w); e(B.chest, -15 * w, 0, 0); e(B.head, -10 * w, 0, 0);
    }
    let sc = 1; if (st === ST.flee) sc = T < 0.5 ? 1 - smooth(T / 0.5) : smooth((T - 0.5) / 0.5);
    this.mesh.scale.setScalar(this.scale * Math.max(0.001, sc));
    if (this.flinch > 0) B.chest.rotation.x -= this.flinch * 0.4;
    if (st === ST.dead) { const k = smooth(clamp(T / 0.8, 0, 1)); B.hips.position.y = B.hips.userData.rest.y * (1 - 0.6 * k); e(B.spine, 50 * k, 0, 0); }
  },
  herald(dt, time) {
    const B = this.B, st = this.state, T = this.stateT;
    const flapRate = st === ST.windup ? 1.4 : st === ST.strike ? 0 : 2.4;
    this.phase += dt * flapRate; const f = Math.sin(this.phase * TAU);
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += -f * 0.12;
    const dive = st === ST.strike ? 1 : st === ST.windup ? smooth(clamp(T / 0.6, 0, 1)) : 0;
    e(B.hips, 25 + 45 * dive, 0, 0); e(B.spine, 5, 0, 0); e(B.chest, 5 - 10 * dive, 0, 0); e(B.neck, -20 - 20 * dive, 0, 0); e(B.head, -10, Math.sin(time + this.seed) * 20 * (1 - dive), 0);
    for (const [k, sg] of [['R', -1], ['L', 1]]) {
      const fold = st === ST.strike ? 1 : 0;
      e(B['wing1' + k], 0, sg * (-20 + 30 * fold), sg * (f * 45 * (1 - fold) + 10 + 60 * fold));
      e(B['wing2' + k], 0, sg * (10 + 70 * fold), sg * (f * 20 * (1 - fold) - 10));
      e(B['wing3' + k], 0, 0, sg * (f * 15));
      e(B['thigh' + k], 20 - 30 * dive, 0, sg * 10); e(B['shin' + k], 40, 0, 0);
      e(B['uArm' + k], lerp(-20, -110, dive), 0, sg * 20); e(B['fArm' + k], -40, 0, 0);
    }
    e(B.tail1, -40 + Math.sin(time * 2) * 10, 0, Math.sin(time * 1.3) * 15); e(B.tail2, 10, 0, Math.sin(time * 1.7) * 15); e(B.tail3, 10, 0, Math.sin(time * 2.1) * 15);
    if (st === ST.flee) { e(B.neck, -50, 0, 0); e(B.head, -30, 0, 0); for (const k of ['R', 'L']) e(B['uArm' + k], -120, 0, (k === 'R' ? -1 : 1) * 60); }
    if (this.flinch > 0) B.chest.rotation.x -= this.flinch * 0.3;
    if (st === ST.dead) { const k = smooth(clamp(T / 0.6, 0, 1)); this.alt = Math.max(0, (this.alt || 0) - dt * 8); e(B.hips, 80 * k, 0, 40 * k); }
  },
};

// ---------------------------------------------------------------- manager
export const TYPE_LIST = Object.keys(TYPES);

export class Horde {
  constructor(scene) {
    this.scene = scene; this.list = []; this.byId = new Map(); this.nextId = 1; this.hash = new SpatialHash(4);
    this.projectiles = [];
  }
  spawn(type, x, z, world, id) {
    const d = new Demon(type, id ?? this.nextId++, this.scene);
    d.onDeath = (x) => this.onDeath && this.onDeath(x);
    d.pos.set(x, world.heightAt(x, z), z); d.yaw = R() * TAU;
    this.list.push(d); this.byId.set(d.id, d);
    return d;
  }
  get alive() { return this.list.filter((d) => d.alive); }
  get aliveCount() { let n = 0; for (const d of this.list) if (d.alive) n++; return n; }
  rebuildHash() { this.hash.clear(); for (const d of this.list) if (d.alive) this.hash.insert(d, d.pos.x, d.pos.z); }
  simulate(dt, C) { this.rebuildHash(); C.hash = this.hash; for (const d of this.list) d.simulate(dt, C); }
  animate(dt, time, world, fx, camPos) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i]; d.animate(dt, time, world, fx, camPos);
      if (d.removed) { d.dispose(); this.byId.delete(d.id); this.list.splice(i, 1); }
    }
  }
  snapshot() { return this.list.filter((d) => d.state !== ST.dead || d.stateT < 0.2).map((d) => d.snap(TYPE_LIST.indexOf(d.type))); }
  applySnapshot(arr, dt, world) {
    const seen = new Set();
    for (const s of arr) {
      const [id, ti] = s; seen.add(id);
      let d = this.byId.get(id);
      if (!d) { d = this.spawn(TYPE_LIST[ti], s[2], s[3], world, id); }
      if (d.alive) d.applySnap(s, dt);
      if (d.state === ST.dead && d.alive) d.die(null);
      d.pos.y = world.heightAt(d.pos.x, d.pos.z);
    }
    for (const d of this.list) if (!seen.has(d.id) && d.alive && d.snapInit) { d.die(null); }
  }
  clear() { for (const d of this.list) d.dispose(); this.list.length = 0; this.byId.clear(); }
}
export { ST };

export { buildTemplate, instantiate, limb, blob, cone, horn, place, lumpyG, demonMaterial };
