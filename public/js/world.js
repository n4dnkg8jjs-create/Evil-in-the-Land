// Deterministic world generation per chapter: heightfield, the blight / life
// terrain shader, props, altars, colliders, water and the healing of the land.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { icoSmooth } from './demons.js';
import { CHAPTERS, HEALED } from './chapters.js';
import { settsTextures, emberWoodTextures, terrainTextures, stoneTextures, barkTextures, woodTextures, grassTexture, demonTextures, clothTextures, armorTextures, leafTexture, cloudTexture, plasterTextures, thatchTextures, roofTextures, leadedGlassTextures } from './textures.js';
import { rng, makeNoise, pathSampler, clamp, lerp, smooth, SpatialHash, TAU } from './util.js';
import { Vista } from './vista.js';
import { WX, WATER_U, WATER_GLSL } from './weather.js';
import { makeFlame } from './flame.js';
import { makeFrozen } from './people.js';
import { buildFallen } from './battlefield.js';

const HALF = 150, N = 257, CELL = (HALF * 2) / (N - 1);
// the Peak: arêtes running out from the summit [angle, is it the knights' way up], and the true summit [x, z, height]
const PEAK_RIDGES = [[-Math.PI / 2, true], [0.35, false], [1.05, false], [2.3, false], [3.0, false], [-2.35, false], [-0.75, false]];
export const PEAK_SPIRE = [6, 46, 9];
const PI = Math.PI;

function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  return g;
}
function clean(g) { for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.attributes.normal) g.computeVertexNormals(); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } return g; }
function merge(list) { return mergeGeometries(list.map(clean)); }
// texture coordinates in metres (box projection on the face's own axis), so a texture keeps its true scale on a
// beam, a wall or a gable whatever the size of the box it is painted on
function boxUV(g, tile) {
  const P = g.attributes.position, N = g.attributes.normal; let uv = g.attributes.uv;
  if (!uv) { uv = new THREE.Float32BufferAttribute(new Float32Array(P.count * 2), 2); g.setAttribute('uv', uv); }
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)), ny = Math.abs(N.getY(i)), nz = Math.abs(N.getZ(i)), x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tile, z / tile); else if (nx >= nz) uv.setXY(i, z / tile, y / tile); else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true; return g;
}
// a building material from a texture set, weathered: dirt and green damp rising up the first metre of wall, and
// moss on whatever faces the sky low down (gravestones, plinths, sills)
function buildingMat(t, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, aoMap: t.aoMap || null, roughness: 1, metalness: 0, side: opts.side || THREE.FrontSide, color: opts.color ?? 0xffffff });
  if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
  if (opts.weather !== false) {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;\nfloat wh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }\nfloat wn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(wh(i), wh(i+vec3(1,0,0)), f.x), mix(wh(i+vec3(0,1,0)), wh(i+vec3(1,1,0)), f.x), f.y), mix(mix(wh(i+vec3(0,0,1)), wh(i+vec3(1,0,1)), f.x), mix(wh(i+vec3(0,1,1)), wh(i+vec3(1,1,1)), f.x), f.y), f.z); }')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float wnz = wn(vOP * 2.3) * 0.6 + wn(vOP * 7.0) * 0.4;
          float damp = (1.0 - smoothstep(${(opts.dampTop ?? 0.9).toFixed(2)}, ${(opts.dampTop ?? 0.9).toFixed(2)} + 0.6, vOP.y + wnz * 0.4)) * ${(opts.damp ?? 0.55).toFixed(2)};
          float moss = smoothstep(0.55, 0.9, normalize(vON).y) * smoothstep(0.45, 0.75, wnz) * ${(opts.moss ?? 0.5).toFixed(2)} + damp * smoothstep(0.5, 0.8, wnz) * 0.5;
          diffuseColor.rgb *= 1.0 - damp * 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.16, 0.06) * (0.7 + wnz * 0.6), clamp(moss, 0.0, 0.85));`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + moss * 0.2 - damp * 0.1, 0.05, 1.0);');
    };
    m.customProgramCacheKey = () => 'bld' + (opts.key || '') + (opts.moss ?? 0.5) + (opts.damp ?? 0.55) + (opts.dampTop ?? 0.9);
  }
  return m;
}
function uvScale(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
function lumpy(g, amt, seed) { // perturb a rock along its normals
  const n = makeNoise(seed); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + n.fbm(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3, 4) * amt; v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}

// A standing stone: a rough slab, broader at the foot, its top worn round and broken, its faces pitted and fluted
// by the weather, leaning a little. Its base is at y=0 (sink it in the ground).
function megalith(w, h, d, seed) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 14, 4); g.translate(0, h / 2, 0);
  const n = makeNoise(seed * 7 + 3), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const t = v.y / h;
    const taper = 1.08 - 0.32 * t + (n.fbm(seed, t * 2.5, 2) - 0.5) * 0.2;
    let x = v.x * taper, z = v.z * taper;
    // the top worn round: the corners fall away
    const cr = Math.pow(Math.max(0, t - 0.72) / 0.28, 1.6); const ex = Math.abs(v.x) / (w / 2), ez = Math.abs(v.z) / (d / 2);
    let y = v.y - cr * (ex * ex * 0.35 + ez * ez * 0.15) * h * 0.25 - (n.fbm(v.x * 3 + seed, v.z * 3, 2) - 0.4) * cr * 0.35;
    // weathering: fluting runs down the faces, pits, a lean
    const fl = Math.sin(v.x * 9 + n.fbm(v.y * 0.8, seed, 2) * 4) * 0.025 + (n.fbm(v.x * 4 + seed, v.y * 3.5 + v.z * 4, 4) - 0.45) * 0.14;
    const len = Math.hypot(x, z) || 1; x += (x / len) * fl; z += (z / len) * fl;
    x += t * t * (n.fbm(seed + 5, 1, 2) - 0.5) * 0.5;
    p.setXYZ(i, x, Math.max(0, y), z);
  }
  g.computeVertexNormals(); return g;
}
// A fractured rock: a lump cut by a few random planes (flat cleavage faces, sharp edges), tapered toward the top
// if it is a spire, roughened, and shaded flat so every facet catches the light on its own.
// snow settles on whatever faces the sky
function snowyRock(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSWN; varying vec3 vSWP;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        mat4 sm = modelMatrix;
        #ifdef USE_INSTANCING
          sm = modelMatrix * instanceMatrix;
        #endif
        vSWN = normalize(mat3(sm) * objectNormal); vSWP = (sm * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSWN; varying vec3 vSWP;\nfloat sh2(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float snowK = smoothstep(0.42, 0.7, normalize(vSWN).y + (sh2(floor(vSWP * 3.0)) - 0.5) * 0.15);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.85, 0.9), snowK);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, snowK);');
  };
  mat.customProgramCacheKey = () => 'snowyRock';
  return mat;
}
function jaggedRock(seed, taper = 0, detail = 3) {
  const r = rng(seed); let g = icoSmooth(detail); const p = g.attributes.position; const v = new THREE.Vector3();
  const planes = []; for (let k = 0; k < 9; k++) { const nrm = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 1.2, r() - 0.5).normalize(); planes.push([nrm, 0.55 + r() * 0.35]); }
  const nz = makeNoise(seed);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + nz.ridge(v.x * 2.1 + seed, v.y * 2.1 + v.z * 1.7, 3) * 0.22);
    for (const [nrm, d] of planes) { const e = v.dot(nrm) - d; if (e > 0) v.addScaledVector(nrm, -e * 0.92); }
    if (taper) { const t = (v.y + 1) / 2; v.x *= 1 - taper * t * t; v.z *= 1 - taper * t * t; }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g = g.toNonIndexed(); g.computeVertexNormals(); return g;
}

// a lot's corners in world space (pad metres outside it); with n, a grid of n+1 x n+1 sample points over it
function lotCorners(L, pad = 0, n = 0) {
  const C = Math.cos(L.yaw), S = Math.sin(L.yaw), out = [];
  const toW = (lx, lz) => [L.x + lx * C + lz * S, L.z - lx * S + lz * C];
  if (!n) return [toW(L.x0 - pad, L.z0 - pad), toW(L.x1 + pad, L.z0 - pad), toW(L.x1 + pad, L.z1 + pad), toW(L.x0 - pad, L.z1 + pad)];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push(toW(lerp(L.x0 - pad, L.x1 + pad, i / n), lerp(L.z0 - pad, L.z1 + pad, j / n)));
  return out;
}

// do two lots (oriented rectangles) overlap, with pad metres between them?
function lotsOverlap(A, B, pad = 0) {
  const ca = lotCorners(A, pad / 2), cb = lotCorners(B, pad / 2);
  for (const L of [A, B]) for (const [ax, az] of [[Math.cos(L.yaw), -Math.sin(L.yaw)], [Math.sin(L.yaw), Math.cos(L.yaw)]]) {
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// ================================================================ THE CAVE ON THE ASCENT (planned here, built in cave.js)
// Near the top the track goes into the mountain. The cave is not a tube along the track: it has its own winding
// line, from a mouth low on the shoulder to a mouth above it, by long low tunnels and three great chambers, with
// blind galleries running off them into the black. It is planned before the ground is made: the walkable floor
// goes into the heightfield (so feet, collision and heightAt agree with what is drawn), while the ground that is
// drawn (Hv) keeps the mountain whole over it, cut open only at the two mouths.
export const CAVE_POW = 2.2;   // a passage's cross-section: a superellipse, fuller in the shoulders than an ellipse
export function caveProfile(q) { q = Math.abs(q); return q >= 1 ? 0 : Math.pow(1 - Math.pow(q, CAVE_POW), 1 / CAVE_POW); }

class CavePlan {
  constructor(W) {
    this.W = W; const C = W.cave, P = W.path, PT = 400, r = rng(W.ch.seed + 4242); this.n = W.noise;
    const ph = (t) => W.pathH[Math.round(clamp(t, 0, 1) * PT)];
    // the mountain as it would be with no shoulder over the track (the track itself), and as it is
    this.bare = (x, z) => W.rawHeight(x, z, false);
    this.lid = (x, z) => W.rawHeight(x, z, true);
    // the mouths: where the shoulder first stands high enough over the track to hold a roof
    const cover = (t) => { const p = P.at(t); return this.lid(p.x, p.z) - this.bare(p.x, p.z); };
    let tA = C.t0 - C.e; while (tA < C.t0 + 0.03 && cover(tA) < 7.5) tA += 0.0005;
    let tB = C.t1 + C.e; while (tB > C.t1 - 0.03 && cover(tB) < 7.5) tB -= 0.0005;
    this.tA = tA; this.tB = tB;
    const tan = (t) => { const a = P.at(t - 0.002), b = P.at(t + 0.002), l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
    const O = P.at(C.t0), E = P.at(C.t1); let ux = E.x - O.x, uz = E.z - O.z; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const L = (u, v) => ({ x: O.x + ux * u - uz * v, z: O.z + uz * u + ux * v });   // u along the shoulder, v to the left of the way up
    this.L = L;
    const pA = P.at(tA), pB = P.at(tB), dA = tan(tA), dB = tan(tB);
    const yA = this.yA = this.bare(pA.x, pA.z), yB = this.yB = this.bare(pB.x, pB.z), rise = yB - yA;
    const off = (p, d, k) => ({ x: p.x + d.x * k, z: p.z + d.z * k });
    // three chambers: the Hall, low and full of dripping water; the Nave, high, its floor climbing in terraces of
    // flowstone under a crack far up in its roof; the Vault, round, its floor deep mud
    const mk = (id, name, p, R, Hc, fc) => ({ id, name, x: p.x, z: p.z, R, Hc, fc: yA + fc, a1: r.range(0.06, 0.13), p1: r() * TAU, a2: r.range(0.04, 0.09), p2: r() * TAU, mouths: [] });
    const C1 = mk(0, 'hall', L(14, 10), 8, 7, -2.0), C2 = mk(1, 'nave', L(47, 19), 9.5, 10.5, 3.6), C3 = mk(2, 'vault', L(35, -7), 7, 8, 9.6);
    this.chambers = [C1, C2, C3];
    // the line through it all: point, half-width, height, floor above the lower mouth's (null: the chamber's)
    const K = (p, Wd, Ht, f, extra = {}) => ({ x: p.x, z: p.z, W: Wd, Ht, f, ...extra });
    const main = [];
    for (let k = 4; k >= 1; k--) main.push(K(P.at(tA - 0.0055 * k), lerp(2.1, 13, k / 4), 3.4, 0));
    main.push(K(pA, 2.1, 3.4, 0, { portal: 'A' }), K(off(pA, dA, 3.2), 1.9, 3.1, -0.1), K(L(4.5, 1.8), 1.8, 2.9, -0.3), K(L(8.5, 4.5), 2.2, 3.4, -0.6),
      K(C1, 2.4, 3.4, null),
      K(L(21.4, 13.2), 1.9, 3.0, -1.6), K(L(25, 16.5), 1.5, 2.5, -0.4), K(L(29, 16), 1.35, 2.3, 0.8), K(L(31.5, 12.5), 1.5, 2.6, 1.9), K(L(35.5, 12), 1.6, 2.8, 2.8), K(L(38.5, 15), 2.0, 3.2, 3.6),
      K(C2, 2.4, 3.6, null),
      K(L(47.2, 9.4), 1.8, 3.8, 6.4), K(L(45, 5), 1.6, 4.2, 7.6), K(L(40.5, 1.5), 1.8, 3.8, 9.0),
      K(C3, 2.4, 3.6, null),
      K(L(42.5, -6), 2.2, 3.6, 10.2), K(L(46.5, -2.5), 1.7, 3.0, 11.6), K(L(50, -4.2), 1.9, 3.2, 13.2), K(L(53, -1.8), 2.0, 3.4, rise - 2.6), K(off(pB, dB, -3.2), 2.0, 3.3, rise - 0.4),
      K(pB, 2.1, 3.4, rise, { portal: 'B' }));
    for (let k = 1; k <= 4; k++) main.push(K(P.at(tB + 0.0055 * k), lerp(2.1, 13, k / 4), 3.4, rise));
    this.main = this.spline(main, 0.5);
    this.sA = main.find((c) => c.portal === 'A').s; this.sB = main.find((c) => c.portal === 'B').s;
    for (const m of this.main) { m.fb = yA + m.fc; m.out = m.s < this.sA - 1e-6 || m.s > this.sB + 1e-6; }
    // the passages: the runs of the line outside the chambers, each reaching a little way into the chamber it meets
    const qOf = (Ch, x, z) => { const dx = x - Ch.x, dz = z - Ch.z; return Math.hypot(dx, dz) / this.rAt(Ch, Math.atan2(dz, dx)); };
    this.qOf = qOf;
    const inCh = (m) => this.chambers.find((c) => qOf(c, m.x, m.z) < 0.8) || null;
    this.tubes = []; let run = null;
    for (let j = 0; j < this.main.length; j++) {
      const m = this.main[j], c = inCh(m);
      if (!c) { if (!run) { run = { id: 3 + this.tubes.length, kind: 'main', S: [], from: j ? inCh(this.main[j - 1]) : null, to: null }; this.tubes.push(run); } run.S.push(m); m.tube = run.id; }
      else { if (run) { run.to = c; run = null; } m.ch = c.id; }
    }
    // blind galleries off each chamber, running into the black and ending in a crack
    const gal = [
      [C1, [K(L(11, 14), 1.6, 2.7, -0.9), K(L(8.6, 17.5), 1.5, 2.6, -0.9), K(L(5.5, 21), 1.3, 2.3, -0.4), K(L(3.5, 24.5), 1.1, 2.0, 0.3), K(L(2.6, 26.4), 0.25, 0.35, 0.4)]],
      [C2, [K(L(47.5, 24), 1.7, 2.9, 4.6), K(L(48.2, 29.2), 1.6, 2.8, 4.6), K(L(47, 33), 1.4, 2.5, 5.0), K(L(44.5, 36), 1.2, 2.2, 5.2), K(L(43.2, 37.6), 0.25, 0.35, 5.2)]],
      [C3, [K(L(33.5, -11), 1.6, 2.7, 9.8), K(L(32, -15), 1.5, 2.6, 9.8), K(L(30.5, -18.5), 1.4, 2.4, 9.5), K(L(32, -21.5), 1.1, 2.1, 9.3), K(L(33, -23), 0.25, 0.35, 9.3)]],
    ];
    for (const [Ch, pts] of gal) {
      const S = this.spline(pts, 0.5).filter((m) => qOf(Ch, m.x, m.z) >= 0.8); for (const m of S) { m.fb = yA + m.fc; m.out = false; }
      this.tubes.push({ id: 3 + this.tubes.length, kind: 'gallery', S, from: Ch, to: null });
    }
    for (const T of this.tubes) for (const m of T.S) m.tube = T.id;
    // the climb from the Nave to the Vault goes up in ledges
    { const T = this.tubes[2], f0 = T.S[0].fb; for (const m of T.S) { const v = (m.fb - f0) / 0.6, k = Math.floor(v), fr = v - k; m.fb = f0 + 0.6 * (k + smooth(clamp((fr - 0.55) / 0.45, 0, 1))); } }
    // where each passage meets its chamber, and how high the floor is there
    for (const T of this.tubes) for (const [end, Ch] of [[0, T.from], [1, T.to]]) {
      if (!Ch) continue; const S = end ? [...T.S].reverse() : T.S; let m = S.find((p) => qOf(Ch, p.x, p.z) >= 1) || S[S.length - 1];
      const sg = end ? -1 : 1, M = { x: m.x, z: m.z, y: m.fb, tube: T.id, dx: m.tx * sg, dz: m.tz * sg, W: m.W, Ht: m.Ht, end: S[0] };
      Ch.mouths.push(M); T['mouth' + end] = M;
    }
    // the Nave's floor climbs in terraces from the passage that comes up into it to the one that goes on
    { const a = C2.mouths.find((m) => m.tube === 4), b = C2.mouths.find((m) => m.tube === 5); const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
      C2.fc = a.y; C2.terr = { ax: a.x, az: a.z, dx: dx / l, dz: dz / l, len: l, h: b.y - a.y }; }
    // passages' floors run smoothly into their chambers'
    for (const T of this.tubes) for (const m of T.S) for (const Ch of [T.from, T.to]) {
      if (!Ch) continue; const q = qOf(Ch, m.x, m.z); if (q < 1.3) m.fb = lerp(m.fb, this.floorSmooth(Ch, m.x, m.z), smooth(clamp((1.3 - q) / 0.5, 0, 1)));
    }
    for (const m of this.main) if (m.ch !== undefined) m.fb = this.floorSmooth(this.chambers[m.ch], m.x, m.z);
    // standing water: a pool in the Hall, rimstone pools on the Nave's terraces, a mud-hole in the Vault, a pool
    // at the end of the Vault's gallery (and the stream down the long tunnel, made in cave.js)
    this.pools = [{ ...L(16.5, 7.5), r: 2.8, dip: 0.42 }, { ...L(44.5, 15.5), r: 1.3, dip: 0.2 }, { ...L(50.5, 18), r: 1.1, dip: 0.2 }, { ...L(45.5, 22.5), r: 1.0, dip: 0.18 },
      { ...L(36.2, -11.4), r: 2.2, dip: 0.5, mud: 1 }, { ...L(31.4, -19.8), r: 1.5, dip: 0.35 }];
    this.fissure = { ...L(48.5, 17.5) };   // the crack in the Nave's roof that lets in a little grey light
    // the mouths, for the ground to be cut round and the arches built in
    this.portals = [{ x: pA.x, z: pA.z, dx: dA.x, dz: dA.z, y: yA, W: 2.1, Ht: 3.4, s: this.sA }, { x: pB.x, z: pB.z, dx: -dB.x, dz: -dB.z, y: yB, W: 2.1, Ht: 3.4, s: this.sB }];
    for (const T of this.tubes) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, wm = 0; for (const m of T.S) { x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); z0 = Math.min(z0, m.z); z1 = Math.max(z1, m.z); wm = Math.max(wm, m.W); } const p = wm + 13; Object.assign(T, { x0: x0 - p, x1: x1 + p, z0: z0 - p, z1: z1 + p }); }
    // the junctions, for the walls of each piece to be opened where another runs into it (see cave.js)
    this.cuts = [];
    for (const Ch of this.chambers) for (const M of Ch.mouths) {
      this.cuts.push([Ch.x, Ch.z, 1, M.tube, Ch.R, Ch.Hc, M.y, Ch.a1, Ch.p1, Ch.a2, Ch.p2, 0]);
      const A = { x: M.x + M.dx * 2.2, z: M.z + M.dz * 2.2 }, B = { x: M.end.x - M.dx * 0.6, z: M.end.z - M.dz * 0.6 };
      this.cuts.push([A.x, A.z, 2, Ch.id, B.x, B.z, M.W * 0.97, M.Ht * 0.97, M.y, 0, 0, 0]);
    }
    for (const P2 of this.pools) P2.y = this.eval(P2.x, P2.z, false).floor - 0.07;
    this.buildGrid();
  }
  // a Catmull-Rom line through the control points, resampled every step metres, carrying their widths, heights, floors
  spline(ctrl, step) {
    const dense = [], SUB = 24;
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let k = 0; k < SUB; k++) {
        const f = k / SUB, f2 = f * f, f3 = f2 * f, cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
        dense.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z), i, f });
      }
    }
    const last = ctrl[ctrl.length - 1]; dense.push({ x: last.x, z: last.z, i: ctrl.length - 2, f: 1 });
    dense[0].s = 0; for (let k = 1; k < dense.length; k++) dense[k].s = dense[k - 1].s + Math.hypot(dense[k].x - dense[k - 1].x, dense[k].z - dense[k - 1].z);
    for (let i = 0; i < ctrl.length; i++) ctrl[i].s = dense[Math.min(i * SUB, dense.length - 1)].s;
    const total = dense[dense.length - 1].s, nS = Math.max(2, Math.ceil(total / step)), out = [], fc = ctrl.filter((c) => c.f !== null && c.f !== undefined);
    let k = 0;
    for (let j = 0; j <= nS; j++) {
      const s = total * j / nS; while (k < dense.length - 2 && dense[k + 1].s < s) k++;
      const a = dense[k], b = dense[k + 1], u = clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1);
      const i = a.i, fl = smooth(clamp(lerp(a.f, b.i === a.i ? b.f : 1, u), 0, 1)), c0 = ctrl[i], c1 = ctrl[i + 1];
      let lo = null, hi = null; for (const c of fc) { if (c.s <= s) lo = c; else if (!hi) hi = c; }
      const f = lo && hi ? lerp(lo.f, hi.f, (s - lo.s) / ((hi.s - lo.s) || 1)) : (lo || hi).f;
      out.push({ x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), s, W: lerp(c0.W, c1.W, fl), Ht: lerp(c0.Ht, c1.Ht, fl), fc: f, tx: 0, tz: 1 });
    }
    for (let j = 0; j < out.length; j++) { const a = out[Math.max(0, j - 1)], b = out[Math.min(out.length - 1, j + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; out[j].tx = (b.x - a.x) / l; out[j].tz = (b.z - a.z) / l; }
    return out;
  }
  rAt(Ch, a) { return Ch.R * (1 + Ch.a1 * Math.cos(a - Ch.p1) + Ch.a2 * Math.cos(2 * a - Ch.p2)); }
  // a chamber's floor without its small roughness: its lowest, rising toward each passage's floor where it comes in
  floorSmooth(Ch, x, z) {
    let base = Ch.fc; const T = Ch.terr;
    if (T) { const pr = clamp(((x - T.ax) * T.dx + (z - T.az) * T.dz) / T.len, 0, 1), v = pr * 6, k = Math.floor(v), fr = v - k; base = Ch.fc + T.h * Math.min(1, (k + smooth(clamp((fr - 0.62) / 0.38, 0, 1))) / 6); }
    let sum = 0, ws = 0;
    for (const M of Ch.mouths) { const w = smooth(clamp(1 - Math.hypot(x - M.x, z - M.z) / (0.85 * Ch.R), 0, 1)); sum += (M.y - base) * w; ws += w; }
    return base + sum / Math.max(1, ws);
  }
  // the floor's small roughness: grit and stones; the stream's bed down one side of the long tunnel; mud in waves
  feat(x, z, id, lat = 0, Wd = 2) {
    const n = this.n; let f = (n.fbm(x * 0.55 + id * 7.1, z * 0.55, 2) - 0.45) * 0.2;
    if (id === 4) f -= 0.26 * Math.exp(-(((lat - 0.42 * Wd) / 0.42) ** 2));
    if (id === 2) f += (n.fbm(x * 0.22, z * 0.22, 2) - 0.45) * 0.3;
    return f;
  }
  // everything about a point in plan: how far inside the rock (sdf < 0: in the open of the cave), the walkable floor,
  // the roof over it, how far along the way through it lies (prog), which piece it is in, and whether that is the
  // open track below a mouth rather than the cave
  eval(x, z, pools = true) {
    let prog = 0, pd = 1e9; const M = this.main;
    for (let i = 0; i < M.length - 1; i++) {
      const a = M[i], b = M[i + 1], abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1; const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1);
      const d = (x - a.x - abx * t) ** 2 + (z - a.z - abz * t) ** 2; if (d < pd) { pd = d; prog = lerp(a.s, b.s, t); }
    }
    const cands = [];
    for (const T of this.tubes) {
      if (x < T.x0 || x > T.x1 || z < T.z0 || z > T.z1) continue;
      let sd = 1e9, bi = 0, bt = 0; const S = T.S;
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1], abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1; const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1);
        const s2 = Math.hypot(x - a.x - abx * t, z - a.z - abz * t) - lerp(a.W, b.W, t) * 0.92; if (s2 < sd) { sd = s2; bi = i; bt = t; }
      }
      if (S.length < 2) continue;
      const a = S[bi], b = S[bi + 1], tx = lerp(a.tx, b.tx, bt), tz = lerp(a.tz, b.tz, bt), cx = lerp(a.x, b.x, bt), cz = lerp(a.z, b.z, bt);
      const lat = (x - cx) * -tz + (z - cz) * tx, s = lerp(a.s, b.s, bt), Wd = lerp(a.W, b.W, bt), Ht = lerp(a.Ht, b.Ht, bt), fb = lerp(a.fb, b.fb, bt);
      const out = T.kind === 'main' && (s < this.sA || s > this.sB);
      if (out) { const fl = this.bare(x, z); cands.push({ id: T.id, sd, fl, rf: fl + 60, out }); }
      else cands.push({ id: T.id, sd, fl: fb + this.feat(x, z, T.id, lat, Wd), rf: fb + Ht * caveProfile(lat / Wd), out });
    }
    for (const Ch of this.chambers) {
      const dx = x - Ch.x, dz = z - Ch.z, rho = Math.hypot(dx, dz); if (rho > Ch.R * 1.4 + 13) continue;
      const rr = this.rAt(Ch, Math.atan2(dz, dx)), fs = this.floorSmooth(Ch, x, z);
      cands.push({ id: Ch.id, sd: rho - rr * 0.93, fl: fs + this.feat(x, z, Ch.id), rf: fs + Ch.Hc * caveProfile(rho / rr), out: false });
    }
    if (!cands.length) return null;
    let best = null, ws = 0, fs = 0, rf = -1e9;
    for (const c of cands) if (!best || c.sd < best.sd) best = c;
    for (const c of cands) { const w = clamp((0.6 - c.sd) / 1.2, 0, 1); if (w > 0 && c.out === best.out) { ws += w; fs += c.fl * w; } if (c.sd < 0.6) rf = Math.max(rf, c.rf); }
    let floor = best.out ? best.fl : ws > 0 ? fs / ws : best.fl; if (rf < -1e8) rf = best.rf;
    if (pools && !best.out) for (const P2 of this.pools) { const d = Math.hypot(x - P2.x, z - P2.z); if (d < P2.r) floor -= P2.dip * smooth(1 - d / P2.r); }
    return { sdf: best.sd, floor, roof: rf, prog, piece: best.id, out: best.out };
  }
  // the plan on a half-metre grid, for quick questions every frame
  buildGrid() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (x, z, p) => { x0 = Math.min(x0, x - p); x1 = Math.max(x1, x + p); z0 = Math.min(z0, z - p); z1 = Math.max(z1, z + p); };
    for (const T of this.tubes) for (const m of T.S) grow(m.x, m.z, m.W + 12);
    for (const Ch of this.chambers) grow(Ch.x, Ch.z, Ch.R * 1.3 + 12);
    const st = this.step = 0.5; this.gx0 = x0; this.gz0 = z0; const nx = this.gnx = Math.ceil((x1 - x0) / st) + 1, nz = this.gnz = Math.ceil((z1 - z0) / st) + 1;
    const sdf = this.gsdf = new Float32Array(nx * nz), fl = this.gfloor = new Float32Array(nx * nz), rf = this.groof = new Float32Array(nx * nz), pr = this.gprog = new Float32Array(nx * nz);
    const pc = this.gpiece = new Int8Array(nx * nz), go = this.gout = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * st, z = z0 + j * st, e = this.eval(x, z);
      if (!e) { sdf[k] = 50; pc[k] = -1; continue; }
      sdf[k] = e.sdf; fl[k] = e.floor; pr[k] = e.prog; pc[k] = e.piece; go[k] = e.out ? 1 : 0;
      rf[k] = !e.out && e.sdf < 1.2 ? Math.min(e.roof, this.lid(x, z) - 0.8) : e.roof;   // never closer than that under the mountain's skin
    }
  }
  // the grid's answer at a point (shared object: copy what you need before asking again), or null off the grid
  sample(x, z, o = this._o || (this._o = {})) {
    const fx = (x - this.gx0) / this.step, fz = (z - this.gz0) / this.step, nx = this.gnx;
    if (!(fx >= 0 && fz >= 0 && fx < nx - 1 && fz < this.gnz - 1)) return null;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * nx + i, k2 = k + nx;
    const bl = (A) => (A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k2] * (1 - u) + A[k2 + 1] * u) * v, S = this.gsdf;
    o.sdf = bl(S); o.floor = bl(this.gfloor); o.roof = bl(this.groof); o.prog = bl(this.gprog);
    o.gx = ((S[k + 1] - S[k]) * (1 - v) + (S[k2 + 1] - S[k2]) * v) / this.step; o.gz = ((S[k2] - S[k]) * (1 - u) + (S[k2 + 1] - S[k + 1]) * u) / this.step;
    const kn = (v < 0.5 ? j : j + 1) * nx + (u < 0.5 ? i : i + 1); o.piece = this.gpiece[kn]; o.out = this.gout[kn] === 1;
    return o;
  }
  // keep a body inside the cave's walls (and, below each mouth, inside the gully that leads to it)
  collide(p, rad, nr) {
    let e = this.sample(p.x, p.z); if (!e) return false;
    if (!(e.sdf < 0.3 || (nr.t > this.tA - 0.024 && nr.t < this.tB + 0.024 && e.sdf < 11.5))) return false;
    const lim = -(rad + 0.18);
    for (let k = 0; k < 5 && e && e.sdf > lim; k++) { const g = Math.hypot(e.gx, e.gz); if (g < 1e-4) break; const m = e.sdf - lim + 0.02; p.x -= e.gx / g * m; p.z -= e.gz / g * m; e = this.sample(p.x, p.z); }
    return true;
  }
  // can one walk (or see) straight from a to b without going through rock?
  clear(ax, az, bx, bz, margin = 0.2) {
    const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
    for (let i = 1; i < n; i++) { const e = this.sample(lerp(ax, bx, i / n), lerp(az, bz, i / n)); if (!e || e.sdf > -margin) return false; }
    return true;
  }
  // the way through at a distance s along it
  mainAt(s) {
    const M = this.main; s = clamp(s, 0, M[M.length - 1].s); let lo = 0, hi = M.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (M[mid].s <= s) lo = mid; else hi = mid; }
    const a = M[lo], b = M[hi], u = clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1);
    return { x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), tx: lerp(a.tx, b.tx, u), tz: lerp(a.tz, b.tz, u), W: lerp(a.W, b.W, u), Ht: lerp(a.Ht, b.Ht, u), s };
  }
}

export class World {
  constructor(engine, quality, chapterIdx) {
    this.engine = engine; this.q = quality; this.idx = chapterIdx; this.ch = CHAPTERS[chapterIdx];
    this.scene = engine.scene;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.r = rng(this.ch.seed); this.noise = makeNoise(this.ch.seed);
    this.colliders = []; this.colGrid = new SpatialHash(6);
    this.time = 0; this.healAnims = []; this.wind = new THREE.Vector3(this.ch.wind[0], 0, this.ch.wind[1]);
    this.fires = []; this.waterLevel = -1000; this.fireSpots = []; this.charSpots = []; this.wells = [];
    this.healedFrac = 0;
    this.buildPath();
    this.planSettlement();
    this.buildHeights();
    this.buildTerrain();
    if (this.ch.terrain.kind !== 'peak') this.buildFarTerrain();
    this.buildAltars();
    this.buildProps();
    this.buildGrass();
    if (this.ch.terrain.water !== undefined) this.buildWater();
    if (this.ch.terrain.kind === 'peak') this.buildCloudSea();
    engine.setAtmosphere(this.ch.atmos);
    this.baseAtmos = this.ch.atmos;
    this.vista = new Vista(engine, chapterIdx, this.ch, (x, z) => this.groundAt(x, z));
  }

  // ---------------------------------------------------------------- layout
  buildPath() {
    const r = this.r, kind = this.ch.terrain.kind;
    let pts;
    if (kind === 'mountain') {
      // a climbing line that follows the lie of the mountain (a valley, a shoulder, a long traverse), not a zig-zag
      pts = [{ x: -30, z: -128 }, { x: -6, z: -108 }, { x: 22, z: -86 }, { x: 34, z: -60 }, { x: 18, z: -36 }, { x: -14, z: -18 }, { x: -38, z: 6 }, { x: -30, z: 34 }, { x: 2, z: 54 }, { x: 30, z: 76 }, { x: 26, z: 100 }, { x: 4, z: 124 }];
    } else if (kind === 'peak') {
      pts = [{ x: 0, z: -40 }, { x: 0, z: -20 }, { x: 0, z: 0 }, { x: 0, z: 20 }];
    } else {
      pts = [{ x: r.range(-15, 15), z: -128 }];
      const m = 6;
      for (let k = 1; k < m; k++) pts.push({ x: r.range(-60, 60) * (k % 2 ? 1 : -1) * 0.8, z: -128 + (256 * k) / m });
      pts.push({ x: r.range(-15, 15), z: 128 });
    }
    this.path = pathSampler(pts);
    if (kind === 'mountain') {
      // near the top the way goes into the mountain: under a shoulder of rock between t0 and t1 (e: how far the rock
      // runs out past them), by a cave system of its own (planned in CavePlan, built in cave.js)
      this.ledge = null; this.crevasse = null;
      this.cave = { t0: 0.655, t1: 0.80, e: 0.016 };
    }
    // altars along the path
    const n = this.ch.altars; this.altarT = [];
    if (kind === 'peak') {
      for (let i = 0; i < n; i++) { const a = -PI / 2 + (i / n) * TAU + PI / n; this.altarT.push({ x: Math.cos(a) * 22, z: Math.sin(a) * 22 }); }
    } else if (this.ch.terrain.kind === 'mountain' && n === 4) { for (const t of [0.12, 0.34, 0.55, 0.9]) this.altarT.push({ t, ...this.path.at(t) }); }   // clear of the cave and its rock (each on a broad shelf: rawHeight)
    else for (let i = 0; i < n; i++) { const t = lerp(0.14, 0.86, n === 1 ? 0.5 : i / (n - 1)); this.altarT.push({ t, ...this.path.at(t) }); }
    // Devil vantage hills, off to the side of the road
    this.devilSpots = [];
    const w = this.ch.devil?.watch || 0;
    for (let i = 0; i < w; i++) {
      const t = (i + 0.6) / (w + 0.4);
      const p = this.path.at(t), q = this.path.at(Math.min(1, t + 0.01));
      let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const side = i % 2 ? 1 : -1; const off = this.ch.devil.close ? r.range(80, 100) : r.range(95, 135);
      // ahead of the party as often as beside it: he watches them come
      const ahead = r.range(10, 50);
      const q2 = this.path.at(Math.min(1, t + 0.06));
      let fx = q2.x - p.x, fz = q2.z - p.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const x = p.x + nx * side * off + fx * ahead, z = p.z + nz * side * off + fz * ahead;
      this.devilSpots.push({ x, z, t, hill: this.ch.terrain.hill * 1.4 });
    }
  }

  baseHeight(x, z) {
    const T = this.ch.terrain, n = this.noise;
    let h;
    switch (T.kind) {
      case 'fen': h = n.fbm(x * 0.012, z * 0.012, 5) * T.amp - 0.4 + n.fbm(x * 0.05, z * 0.05, 3) * 0.6; break;
      case 'mountain': h = n.ridge(x * 0.012, z * 0.012, 5) * T.amp * 2.2 + n.fbm(x * 0.03, z * 0.03, 4) * 4; break;
      case 'peak': {
        // the summit: a rough saddle of broken rock, ringed by a lip of outcrops; arêtes run out and down from it
        // between sheer faces, the knights' ridge climbs in from the south, and behind the arena the true summit
        // stands up as a fang of black rock. Everything else falls away into the storm.
        const r = Math.hypot(x, z), a = Math.atan2(z, x);
        h = n.fbm(x * 0.06, z * 0.06, 4) * 1.1 + n.ridge(x * 0.12, z * 0.12, 3) * 0.45;
        const out = Math.max(0, r - 29);
        let rf = 0, path = 0;
        for (const [ra, isPath] of PEAK_RIDGES) {
          const wob = n.fbm(r * 0.025 + ra * 3, ra * 7, 2) * 0.25;
          let da = a - ra - wob; da = Math.atan2(Math.sin(da), Math.cos(da));
          const k = Math.exp(-(((da * r) / (isPath ? 6 : 4 + r * 0.06)) ** 2));
          if (isPath) path = Math.max(path, k); else rf = Math.max(rf, k);
        }
        const face = 1 - Math.max(rf, path);
        h -= out * (0.5 + 1.6 * face) + Math.pow(out, 1.4) * 0.06 * face + out * 0.25 * rf;
        h += (n.ridge(x * 0.032, z * 0.032, 5) - 0.45) * 26 * smooth(clamp(out / 14, 0, 1)) * (1 - path * 0.85);   // broken faces and buttresses
        h += rf * smooth(clamp(out / 5, 0, 1)) * (2 + n.ridge(x * 0.07, z * 0.07, 4) * 6);                     // the arêtes' jagged crests
        // a lip of outcrops round the arena (not across the knights' ridge)
        h += smooth(clamp((r - 25) / 4, 0, 1)) * (1 - smooth(clamp((r - 30) / 5, 0, 1))) * (1 + n.ridge(x * 0.11, z * 0.11, 3) * 3) * (1 - path);
        // the summit rises a little to the north: a broad snow dome with a corniced crest, not a spike
        const sd = Math.hypot(x - PEAK_SPIRE[0], (z - PEAK_SPIRE[1]) * 1.4);
        h += PEAK_SPIRE[2] * Math.exp(-((sd / 26) ** 2)) * (0.85 + 0.3 * n.fbm(x * 0.05, z * 0.05, 3));
        return h;
      }
      default: h = n.fbm(x * 0.009, z * 0.009, 5) * T.amp + n.ridge(x * 0.02, z * 0.02, 4) * T.amp * 0.25;
    }
    // the Devil's vantage points: broken crags rather than smooth mounds
    for (const s of this.devilSpots) {
      const d2 = (x - s.x) ** 2 + (z - s.z) ** 2; if (d2 > 120 * 120) continue;
      const g = Math.exp(-d2 / (2 * 30 * 30));
      h += s.hill * g * (0.62 + 0.55 * n.ridge(x * 0.03 + 7, z * 0.03 - 3, 4)) + s.hill * 0.16 * Math.pow(g, 0.6) * n.fbm(x * 0.11, z * 0.11, 3);
    }
    return h;
  }

  buildHeights() {
    const H = this.H = new Float32Array(N * N);
    const T = this.ch.terrain;
    this.makePathHeights();
    if (this.cave && !this.caveSys) this.caveSys = new CavePlan(this);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = this.rawHeight(-HALF + i * CELL, -HALF + j * CELL);
    this.flattenLots();
    if (this.caveSys) this.cutCave();
    for (const a of this.altarT) a.y = this.heightAt(a.x, a.z);
    for (const s of this.devilSpots) s.y = this.groundAt(s.x, s.z);
  }
  // the ground as generated, before any building pad is levelled into it (needs the path heights)
  rawHeight(x, z, shoulder = true) {
    const T = this.ch.terrain, PT = 400, pathH = this.pathH;
    let h = this.baseHeight(x, z);
    if (T.kind !== 'peak') {
      const nr = this.path.nearest(x, z);
      const ph = pathH[Math.round(nr.t * PT)];
      if (T.kind === 'mountain') h = this.lidHeight(x, z, nr, ph, h, shoulder);
      else h = lerp(ph, h, smooth(clamp((nr.d - 4) / 14, 0, 1)));
    }
    // flatten altar sites
    for (const a of this.altarT) {
      const d = Math.hypot(x - a.x, z - a.z);
      const fr = T.kind === 'peak' ? 5.5 : T.kind === 'mountain' ? 12 : 9;   // on the Ascent, a broad level shelf, so no slope of the gorge comes near the stones
      if (d < fr * 2) { const ah = this.altarHeightGuess(a); h = lerp(ah, h, smooth(clamp((d - fr) / fr, 0, 1))); }
    }
    return h;
  }
  // half the width of the Ascent's track at t: wide at the foot where the company gathers, narrow above
  trackHalf(t) { return 4.6 + this.noise.fbm(t * 9, 3.1, 2) * 2.2 + 9 * (1 - smooth(clamp(t / 0.07, 0, 1))); }
  // which side of the path a point lies: +1 on the side of the path's left normal (-tz, tx), -1 on the other
  pathSide(x, z, t) { const p = this.path.at(t), a = this.path.at(Math.max(0, t - 0.003)), b = this.path.at(Math.min(1, t + 0.003)); return ((x - p.x) * -(b.z - a.z) + (z - p.z) * (b.x - a.x)) >= 0 ? 1 : -1; }
  // the Ascent: the track climbs a mountain valley. Away from it the ground rises in natural slopes, steepening,
  // broken by spurs, gullies and outcrops (where the noise is steep the rock shows); above, the snowfields. Near
  // the top a shoulder of rock stands over the track (shoulder: with it, or as the ground would be without it);
  // the cave under it is cut afterwards (cutCave)
  lidHeight(x, z, nr, ph, h, shoulder = true) {
    const n = this.noise, t = nr.t;
    const half = this.trackHalf(t), w = Math.max(0, nr.d - half);
    let rise = w * 0.42 + Math.pow(w, 1.45) * 0.045;
    rise += (n.ridge(x * 0.045, z * 0.045, 4) - 0.45) * 10 * smooth(clamp(w / 8, 0, 1));    // spurs and gullies
    rise += n.fbm(x * 0.012, z * 0.012, 3) * 18 * smooth(clamp((w - 6) / 30, 0, 1));         // the big folds of the mountain
    rise += Math.max(0, n.ridge(x * 0.09 + 3, z * 0.09, 3) - 0.62) * 14 * smooth(clamp((w - 3) / 6, 0, 1));   // outcrops
    let y = ph + rise + h * 0.1 * smooth(clamp((w - 12) / 20, 0, 1));
    y += n.fbm(x * 0.3, z * 0.3, 2) * 0.14 * (1 - smooth(clamp(w, 0, 1)));                 // the track: rough, gritty
    // the shoulder of rock the cave runs under: it rises steeply right from the entrance
    const C = this.cave;
    if (C && shoulder) {
      const k = smooth(clamp((t - C.t0 + C.e) / 0.024, 0, 1)) * smooth(clamp((C.t1 + C.e - t) / 0.024, 0, 1));
      y += k * (16 + n.fbm(x * 0.05, z * 0.05, 3) * 7) * (1 - smooth(clamp((nr.d - 18) / 30, 0, 1)));
    }
    return y;
  }
  // in the cave (pad metres out into its rock), or over the stretch of the track the shoulder has buried
  inCaveZone(x, z, pad = 2) {
    const S = this.caveSys; if (!S) return false; const e = S.sample(x, z); if (!e) return false;
    if (e.sdf < pad && !e.out) return true;
    if (e.sdf < 40) { const nr = this.path.nearest(x, z); if (nr.t > S.tA && nr.t < S.tB && nr.d < 16 + pad) return true; }
    return false;
  }
  // cut the cave into the ground: its floor into H (what is walked on), while Hv (what is drawn) keeps the mountain
  // whole over it; below each mouth a gully is cut down to the track in both, leading in
  cutCave() {
    const S = this.caveSys, H = this.H, Hv = this.Hv = H.slice();
    const i0 = Math.max(0, Math.floor((S.gx0 + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((S.gx0 + S.gnx * S.step + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((S.gz0 + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((S.gz0 + S.gnz * S.step + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, e = S.eval(x, z); if (!e || e.sdf > 2.2) continue;
      const k = j * N + i;
      if (e.out) { const w = smooth(clamp((0.6 - e.sdf) / 1.2, 0, 1)); H[k] = Hv[k] = lerp(H[k], e.floor, w); }
      else H[k] = e.floor;
    }
  }
  // the height of the ground as drawn (over the cave, the mountain's skin rather than the cave's floor)
  visualHeightAt(x, z) {
    const Hv = this.Hv || this.H, fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = Hv[j * N + i], b = Hv[j * N + i + 1], c = Hv[(j + 1) * N + i], d = Hv[(j + 1) * N + i + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // ---------------------------------------------------------------- settlement
  // Farms and the village are laid out on purpose: houses front the road at a set-back, turned to face it, with
  // yards behind; a farmstead is a house and a barn round a yard beside a fenced field; each building stands on
  // a pad levelled into the ground before the terrain is built. Fences are planned here too, as continuous runs.
  planSettlement() {
    const P = this.ch.props, T = this.ch.terrain; this.lots = []; this.fenceRuns = [];
    if (T.kind === 'peak') return;
    if (T.kind === 'mountain') {
      // the First Company's last camp: a shelf cut back into the gorge wall beside the track
      this.makePathHeights();
      const t = this.cave ? this.cave.t0 - 0.04 : 0.74, p = this.path.at(t), q = this.path.at(t + 0.004); let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const x = p.x + nx * 8.5, z = p.z + nz * 8.5; const yaw = Math.atan2(-nx, -nz);
      const camp = { kind: 'camp', x, z, yaw, w: 11, d: 8, x0: -6, x1: 6, z0: -4.5, z1: 5.5, rad: 9 };
      camp.padH = this.pathH[Math.round(t * 400)]; this.lots.push(camp); this.camp = camp;
      return;
    }
    const r = rng(this.ch.seed + 909);
    // the path heights are needed for rawHeight; make them now (buildHeights keeps them)
    this.makePathHeights();
    const roadPt = (t) => { const p = this.path.at(t), q = this.path.at(Math.min(1, t + 0.004)), q0 = this.path.at(Math.max(0, t - 0.004)); let tx = q.x - q0.x, tz = q.z - q0.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return { p, tx, tz, nx: -tz, nz: tx }; };
    const fits = (lot) => {
      const corners = lotCorners(lot, 0);
      for (const [cx, cz] of corners) { if (!this.inBounds(cx, cz) || this.path.nearest(cx, cz).d < 5.5) return false; for (const a of this.altarT) if (Math.hypot(cx - a.x, cz - a.z) < 13) return false; }
      for (const a of this.altarT) if (Math.hypot(lot.x - a.x, lot.z - a.z) < 16) return false;
      for (const o of this.lots) if (lotsOverlap(o, lot, 0.6)) return false;
      let lo = 1e9, hi = -1e9; for (const [cx, cz] of lotCorners(lot, 0, 3)) { const h = this.rawHeight(cx, cz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo < (lot.kind === 'field' ? 5 : 3.2);
    };
    const add = (lot) => { lot.rad = Math.hypot(Math.max(-lot.x0, lot.x1), Math.max(-lot.z0, lot.z1)); if (!fits(lot)) return null; this.lots.push(lot); return lot; };
    // a house fronting the road: local +z faces the road; the front yard runs to the road, the back yard behind
    const house = (t, side, set, w, d, kind = 'house') => {
      const R = roadPt(t); const x = R.p.x + R.nx * side * set, z = R.p.z + R.nz * side * set;
      const yaw = Math.atan2(-R.nx * side, -R.nz * side);
      return add({ kind, x, z, yaw, w, d, x0: -w / 2 - 2.2, x1: w / 2 + 2.2, z0: -d / 2 - 5, z1: d / 2 + 1.2, t, side });
    };
    // Saint Aldric's: the church by the second altar, a square before it, and the village street along the road:
    // houses side by side fronting the street at the same setback, a lane between them now and then, each with its
    // fenced plot running back behind it
    if (P.village) {
      const a = this.altarT[1] || this.altarT[0];
      const R = roadPt(a.t); const x = a.x + R.nx * 22, z = a.z + R.nz * 22, yaw = Math.atan2(R.nx, R.nz);
      const ch = { kind: 'church', x, z, yaw, w: 9, d: 20, x0: -18, x1: 18, z0: -12, z1: 24, rad: 0 }; ch.rad = Math.hypot(18, 24); this.lots.push(ch); this.churchLot = ch;
      // distance along the road
      const NS = 800, sT = new Float32Array(NS + 1); { let prev = this.path.at(0); for (let i = 1; i <= NS; i++) { const q = this.path.at(i / NS); sT[i] = sT[i - 1] + Math.hypot(q.x - prev.x, q.z - prev.z); prev = q; } }
      const sOf = (t) => { const f = clamp(t, 0, 1) * NS, i = Math.min(NS - 1, Math.floor(f)); return lerp(sT[i], sT[i + 1], f - i); };
      const tOf = (sv) => { if (sv <= 0) return 0; if (sv >= sT[NS]) return 1; let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sT[m] < sv) lo = m; else hi = m; } return (lo + (sv - sT[lo]) / Math.max(1e-6, sT[hi] - sT[lo])) / NS; };
      this.sOf = sOf; this.tOf = tOf;
      const sA = sOf(a.t); let sMin = sA - 20, sMax = sA + 20;
      const row = (t, side, w, d) => {
        const RR = roadPt(t), set = 6.0 + d / 2 + 1.0;   // the house fronts stand 6 m from the middle of the street
        const hx = RR.p.x + RR.nx * side * set, hz = RR.p.z + RR.nz * side * set, yw = Math.atan2(-RR.nx * side, -RR.nz * side);
        return add({ kind: 'house', village: true, x: hx, z: hz, yaw: yw, w, d, x0: -w / 2 - 0.5, x1: w / 2 + 0.5, z0: -d / 2 - 9, z1: d / 2 + 1.0, t, side });
      };
      for (const dir of [-1, 1]) for (const side of [-1, 1]) {
        let sv = sA + dir * (side > 0 ? 24 : 13), made = 0;   // the square and the church on one side, the altar's ring on the other
        for (let k = 0; k < 24 && made < 6; k++) {
          const w = r.range(6.4, 8.4), d = r.range(5.4, 6.4), t = tOf(sv + dir * w / 2);
          if (t < 0.05 || t > 0.95) break;
          const lot = row(t, side, w, d);
          if (lot) {
            made++; sv += dir * (w + (r() < 0.3 ? 4.0 : 1.2));   // now and then a lane between two plots
            sMin = Math.min(sMin, sOf(t) - w); sMax = Math.max(sMax, sOf(t) + w);
            // the plot behind: fenced along its sides and back, a gate in the back fence
            const C = Math.cos(lot.yaw), S = Math.sin(lot.yaw), toW = (lx, lz) => [lot.x + lx * C + lz * S, lot.z - lx * S + lz * C];
            const bx = w / 2 + 0.3, bz0 = -d / 2 - 0.6, bz1 = -d / 2 - 8.6;
            this.fenceRuns.push({ pts: [toW(-bx, bz0), toW(-bx, bz1), toW(bx, bz1), toW(bx, bz0)], closed: false, lot, gate: 0.5 });
          } else sv += dir * 2.5;
        }
      }
      // the street is paved through the village, and widens into a square between the road and the church
      this.paving = { t0: tOf(sMin), t1: tOf(sMax), sA, sMin, sMax, a };
    }
    // farmsteads: a house fronting the road, a barn across the yard behind it, a fenced field beside them
    for (let k = 0, made = 0; k < 30 && made < (P.farm || 0); k++) {
      const t = r.range(0.08, 0.92), side = r.sign();
      const h = house(t, side, r.range(13, 16), r.range(7, 8.5), r.range(5.5, 6.5)); if (!h) continue;
      const C = Math.cos(h.yaw), S = Math.sin(h.yaw), toW = (lx, lz) => [h.x + lx * C + lz * S, h.z - lx * S + lz * C];
      const fs = r.sign(), [bx, bz] = toW(fs * 4, -h.d / 2 - 13);
      const barn = add({ kind: 'barn', x: bx, z: bz, yaw: h.yaw + Math.PI, w: r.range(10, 12), d: r.range(6.5, 7.5), x0: -7, x1: 7, z0: -6, z1: 6.5 });
      if (!barn) { this.lots.splice(this.lots.indexOf(h), 1); continue; }
      made++;
      // the field: a fenced rectangle along the road beside the steading, with a gate toward the yard
      const FW = r.range(26, 34), FD = r.range(20, 26); const [fx, fz] = toW(-fs * (h.w / 2 + 6 + FW / 2), -FD / 2 + 2);
      const field = { kind: 'field', x: fx, z: fz, yaw: h.yaw, w: FW, d: FD, x0: -FW / 2, x1: FW / 2, z0: -FD / 2, z1: FD / 2 };
      if (add(field)) this.fenceRuns.push({ pts: lotCorners(field, 0), closed: true, gate: 0.82, field });
      // a small paddock against the barn
      const pad = { kind: 'paddock', x: 0, z: 0, yaw: h.yaw, w: 10, d: 8, x0: -5, x1: 5, z0: -4, z1: 4 }; [pad.x, pad.z] = toW(fs * 4 + fs * 13, -h.d / 2 - 13);
      if (add(pad)) this.fenceRuns.push({ pts: lotCorners(pad, 0), closed: true, gate: 0.1 });
    }
    // fences along the road where people lived: a run either side of each settled stretch, open at each gateway
    if (P.fences) {
      const stretches = [];
      for (const L of this.lots) if (L.t !== undefined && !L.village) stretches.push([L.t - 0.045, L.t + 0.045]);
      stretches.sort((a, b) => a[0] - b[0]);
      const merged = []; for (const s2 of stretches) { const m = merged[merged.length - 1]; if (m && s2[0] <= m[1] + 0.03) m[1] = Math.max(m[1], s2[1]); else merged.push([...s2]); }
      for (const [t0, t1] of merged) for (const side of [-1, 1]) {
        const pts = []; for (let t = Math.max(0.03, t0); t <= Math.min(0.97, t1); t += 0.004) { const R = roadPt(t); pts.push([R.p.x + R.nx * side * 6.8, R.p.z + R.nz * side * 6.8]); }
        if (pts.length > 3) this.fenceRuns.push({ pts, closed: false, road: true });
      }
    }
  }
  makePathHeights() {
    if (this.pathH) return;
    const T = this.ch.terrain, PT = 400; const pathH = new Float32Array(PT + 1);
    for (let i = 0; i <= PT; i++) {
      const p = this.path.at(i / PT);
      if (T.kind === 'mountain') pathH[i] = (i / PT) * T.rise;
      else if (T.kind === 'fen') pathH[i] = Math.max(0.5, this.baseHeight(p.x, p.z) * 0.3 + 0.6);
      else pathH[i] = this.baseHeight(p.x, p.z) * 0.6;
    }
    for (let pass = 0; pass < 6; pass++) for (let i = 1; i < PT; i++) pathH[i] = (pathH[i - 1] + pathH[i] * 2 + pathH[i + 1]) / 4;
    this.pathH = pathH;
  }
  // level a pad under every building (not under fields), blending out over a few metres
  flattenLots() {
    const H = this.H;
    for (const L of this.lots) {
      if (L.kind === 'field' || L.kind === 'paddock') continue;
      let sum = 0, n = 0; if (L.padH === undefined) for (const [cx, cz] of lotCorners(L, 0, 4)) { sum += this.rawHeight(cx, cz); n++; }
      const ph = L.padH ?? (L.padH = sum / n); const B = L.kind === 'camp' ? 4 : 7;
      const C = Math.cos(L.yaw), S = Math.sin(L.yaw), R = L.rad + B;
      const i0 = Math.max(0, Math.floor((L.x - R + HALF) / CELL)), i1 = Math.min(N - 1, Math.ceil((L.x + R + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((L.z - R + HALF) / CELL)), j1 = Math.min(N - 1, Math.ceil((L.z + R + HALF) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * CELL - L.x, z = -HALF + j * CELL - L.z;
        const lx = x * C - z * S, lz = x * S + z * C;   // into the lot's frame
        const dx = Math.max(L.x0 - lx, 0, lx - L.x1), dz = Math.max(L.z0 - lz, 0, lz - L.z1); const d = Math.hypot(dx, dz);
        if (d > B) continue;
        const k = j * N + i; H[k] = lerp(ph, H[k], smooth(d / B));
      }
    }
  }
  inLot(x, z, pad = 0) {
    for (const L of this.lots || []) {
      const C = Math.cos(L.yaw), S = Math.sin(L.yaw), dx = x - L.x, dz = z - L.z, lx = dx * C - dz * S, lz = dx * S + dz * C;
      if (lx > L.x0 - pad && lx < L.x1 + pad && lz > L.z0 - pad && lz < L.z1 + pad) return L;
    }
    return null;
  }
  // inside a building's walls (houses, barns, the church), pad metres out
  inFootprint(x, z, pad = 0) {
    for (const L of this.lots || []) {
      if (L.kind !== 'house' && L.kind !== 'barn' && L.kind !== 'church') continue;
      const C = Math.cos(L.yaw), S = Math.sin(L.yaw), dx = x - L.x, dz = z - L.z, lx = dx * C - dz * S, lz = dx * S + dz * C;
      const hw = L.kind === 'church' ? 6.2 : L.w / 2 + 0.45, z0 = L.kind === 'church' ? -10.9 : -L.d / 2 - 0.7, z1 = L.kind === 'church' ? 15.7 : L.d / 2 + 0.7;
      if (Math.abs(lx) < hw + pad && lz > z0 - pad && lz < z1 + pad) return L;
    }
    return null;
  }
  // the paved street and square (Saint Aldric's)
  pavingHalf(t, side) {
    const P = this.paving, ds = Math.abs(this.sOf(t) - P.sA);
    const sq = side > 0 ? 7.4 * smooth(clamp(1 - (ds - 10) / 6, 0, 1)) : 0;
    return 3.7 + sq + (this.noise.fbm(t * 160, side * 3.3, 2) - 0.5) * 0.6;
  }
  onPaving(x, z) {
    const P = this.paving; if (!P) return false;
    if (Math.hypot(x - P.a.x, z - P.a.z) > 120) return false;
    const nr = this.path.nearest(x, z); if (nr.t < P.t0 || nr.t > P.t1) return false;
    return nr.d < this.pavingHalf(nr.t, this.pathSide(x, z, nr.t));
  }
  // fences as continuous runs of posts and two rails, each rail sloping with the ground between its posts
  buildFences(mat) {
    if (!this.fenceRuns?.length) return;
    const r = rng(this.ch.seed + 313); const posts = [], rails = [], gates = [];
    for (const run of this.fenceRuns) {
      const pts = run.closed ? [...run.pts, run.pts[0]] : run.pts;
      // resample at ~2.4 m
      const P2 = []; for (let k = 0; k < pts.length - 1; k++) { const [ax, az] = pts[k], [bx, bz] = pts[k + 1]; const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2.4)); for (let i = 0; i < n; i++) P2.push([ax + (bx - ax) * i / n, az + (bz - az) * i / n, k]); }
      P2.push([...pts[pts.length - 1], pts.length - 2]);
      const total = P2.length; const gi = run.gate !== undefined ? Math.floor(run.gate * (total - 1)) : -1;
      const ok = P2.map(([x, z]) => {
        if (!this.inBounds(x, z) || this.normalAt(x, z).y < 0.82) return false;
        if (!run.road && this.path.nearest(x, z).d < 4.8) return false;
        for (const a of this.altarT) if (Math.hypot(x - a.x, z - a.z) < 11) return false;
        const L = this.inLot(x, z, 0.4); if (L && L !== run.field && L !== run.lot && L.kind !== 'field' && L.kind !== 'paddock') return false;
        if (run.lot && this.inFootprint(x, z, 0.3)) return false;
        return true;
      });
      // a gateway in front of each house along a road fence
      const gap = P2.map(([x, z]) => { if (!run.road) return false; for (const L of this.lots) if (L.kind === 'house' && Math.hypot(x - L.x, z - L.z) < 9.5) { const toRoadx = Math.sin(L.yaw), toRoadz = Math.cos(L.yaw); const along = (x - L.x) * toRoadz - (z - L.z) * toRoadx; if (Math.abs(along) < 1.8) return true; } return false; });
      for (let i = 0; i < total; i++) {
        const [x, z] = P2[i]; if (!ok[i] || gap[i]) continue; const y = this.heightAt(x, z);
        posts.push({ x, y: y - 0.32, z, ry: r() * 0.4, rx: r.range(-0.04, 0.04), rz: r.range(-0.04, 0.04) });
        if (i + 1 >= total || !ok[i + 1] || gap[i + 1]) continue;
        const [x2, z2] = P2[i + 1], y2 = this.heightAt(x2, z2), L = Math.hypot(x2 - x, z2 - z);
        if (i === gi) { gates.push({ x: (x + x2) / 2, z: (z + z2) / 2, y: (y + y2) / 2, ry: Math.atan2(-(z2 - z), x2 - x), L }); continue; }
        // the ground between posts must not rise through the rails
        let bump = 0; for (const f of [0.25, 0.5, 0.75]) bump = Math.max(bump, this.heightAt(x + (x2 - x) * f, z + (z2 - z) * f) - (y + (y2 - y) * f));
        const pitch = Math.atan2(y2 - y, L), ry = Math.atan2(-(z2 - z), x2 - x);
        for (const hh of [0.42, 0.88]) { if (r() < 0.08) continue; rails.push({ x: (x + x2) / 2, y: (y + y2) / 2 + hh + bump, z: (z + z2) / 2, ry, rz: pitch, sx: L + 0.12 }); }
      }
    }
    const post = new THREE.BoxGeometry(0.13, 1.4, 0.13); post.translate(0, 0.7, 0);
    const rail = new THREE.BoxGeometry(1, 0.09, 0.055);
    this.instanced(post, mat, posts); this.instanced(rail, mat, rails);
    // gates, standing ajar
    const gateList = [];
    for (const G of gates) for (let k = 0; k < 4; k++) gateList.push({ x: G.x, y: G.y + 0.25 + k * 0.22, z: G.z, ry: G.ry + 0.5, sx: G.L * 0.95 });
    if (gateList.length) this.instanced(new THREE.BoxGeometry(1, 0.08, 0.05), mat, gateList);
  }
  altarHeightGuess(a) {
    const T = this.ch.terrain;
    if (T.kind === 'peak') return 0.2;
    if (a.t === undefined) return 0;
    return this.pathH[Math.round(a.t * 400)];
  }

  heightAt(x, z) {
    const fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const H = this.H;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    // the same two triangles per cell that the ground mesh is drawn with, so feet, houses and props sit exactly on what you see
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // where feet stand: the ground, or the steps of an altar (three octagonal steps of 26 cm) on top of it
  standAt(x, z) {
    let h = this.heightAt(x, z);
    const B = this.bridge; if (B) { const dx = x - B.x, dz = z - B.z, a = dx * B.dx + dz * B.dz, s2 = Math.abs(dx * B.dz - dz * B.dx); if (Math.abs(a) < B.half && s2 < 1.05) h = Math.max(h, B.y - Math.cos((a / B.half) * Math.PI / 2) * 0.35); }
    if (!this.altars) return h;
    for (const a of this.altars) {
      const dx = x - a.x, dz = z - a.z, d2 = dx * dx + dz * dz; if (d2 > 11) continue;
      const d = Math.sqrt(d2) * (1 - 0.04 * Math.abs(Math.cos(Math.atan2(dz, dx) * 4)));   // near enough an octagon
      const top = d < 2.05 ? 0.78 : d < 2.65 ? 0.52 : d < 3.27 ? 0.26 : 0;
      if (top) return Math.max(h, a.y + top);
    }
    return h;
  }
  // ground height anywhere, including the open land beyond the battlefield
  groundAt(x, z) {
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax <= HALF && az <= HALF) return this.heightAt(x, z);
    // blend from the battlefield's edge into the land beyond
    const ex = clamp(x, -HALF, HALF), ez = clamp(z, -HALF, HALF);
    const k = smooth(clamp(Math.max(ax - HALF, az - HALF) / 40, 0, 1));
    return lerp(this.heightAt(ex, ez), this.farHeight(x, z), k);
  }
  farHeight(x, z) {
    const n = this.noise, T = this.ch.terrain;
    let h = this.baseHeight(x, z) * 0.9 + n.fbm(x * 0.0018, z * 0.0018, 4) * 38;
    if (T.kind === 'mountain') h += (z + 150) * 0.45;  // the mountainside keeps climbing ahead
    return h;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8; const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const seg = N - 1;   // one vertex per height sample, so what is drawn is exactly the ground things stand on
    const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, seg, seg); g.rotateX(-PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, this.visualHeightAt(p.getX(i), p.getZ(i)));   // (the same as heightAt, but over the cave)
    g.computeVertexNormals();
    const tt = terrainTextures(this.q.tex >= 1024 ? 512 : 512);
    // blight mask: R channel = life
    this.maskSize = 256; this.maskData = new Uint8Array(this.maskSize * this.maskSize * 4);
    this.mask = new THREE.DataTexture(this.maskData, this.maskSize, this.maskSize, THREE.RGBAFormat);
    this.mask.magFilter = THREE.LinearFilter; this.mask.minFilter = THREE.LinearFilter; this.mask.needsUpdate = true;
    const T = this.ch.terrain;
    const uniforms = {
      tDead: { value: tt.dead }, tDeadN: { value: tt.deadN }, tAlive: { value: tt.alive }, tAliveN: { value: tt.aliveN },
      tRock: { value: tt.rock }, tRockN: { value: tt.rockN }, tSnow: { value: tt.snow }, tMask: { value: this.mask },
      tSetts: { value: null }, tSettsN: { value: null }, uRoad: { value: 0 },
      uSize: { value: HALF * 2 }, uTile: { value: 0.22 }, uSnowLine: { value: T.kind === 'mountain' ? 85 : 9999 },
      uWater: { value: T.water !== undefined ? 0.0 : -9999 }, uEmber: { value: this.ch.id === 'peak' ? 0.5 : this.ch.id === 'field' ? 1.6 : 0.9 }, uNStr: { value: 1.0 }, uRockAll: { value: T.kind === 'peak' ? 0.35 : 0 }, uFlatSnow: { value: T.kind === 'peak' || T.kind === 'mountain' ? 1 : 0 }, uSnowFrom: { value: T.kind === 'mountain' ? 10 : -1e4 }, uStrata: { value: T.kind === 'mountain' ? 1 : 0 },
      uDeadTint: { value: new THREE.Color(T.kind === 'fen' ? 0x8a8a78 : T.kind === 'mountain' || T.kind === 'peak' ? 0x9a9090 : 0xffffff) },
      uAliveTint: { value: new THREE.Color(T.kind === 'mountain' ? 0x9aa080 : 0xffffff) },
      uWet: WX.uWet, uRainA: WX.uRain, uWTime: WX.uWTime, uSnowAcc: WX.uSnowAcc,
      uHoles: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, 0)) },   // well shafts: no ground across their mouths
      uCaveCut: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4(0, 0, 0, 0)) },   // the cave's mouths: no ground across their arches
    };
    if (this.caveSys) this.caveSys.portals.forEach((M, k) => { const U = uniforms.uCaveCut.value; U[k * 3].set(M.x, M.z, M.dx, M.dz); U[k * 3 + 1].set(M.y, M.W + 0.16, M.Ht + 0.16, -1.9); U[k * 3 + 2].set(5.0, 0, 0, 1); });
    if (T.kind === 'vale' || T.kind === 'village') { const st = settsTextures(512); for (const t of [st.map, st.normalMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; } uniforms.tSetts.value = st.map; uniforms.tSettsN.value = st.normalMap; uniforms.uRoad.value = 1; }
    this.terrainUniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tDead, tDeadN, tAlive, tAliveN, tRock, tRockN, tSnow, tMask, tSetts, tSettsN; uniform float uRoad;
        uniform float uSize, uTile, uSnowLine, uWater, uEmber, uNStr, uRockAll, uFlatSnow, uSnowFrom, uStrata; uniform vec3 uDeadTint, uAliveTint;
        uniform float uWet, uRainA, uWTime, uSnowAcc; uniform vec4 uHoles[6]; uniform vec4 uCaveCut[6];
        float wxh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wxn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wxh(i), wxh(i + vec2(1, 0)), f.x), mix(wxh(i + vec2(0, 1)), wxh(i + vec2(1, 1)), f.x), f.y); }
        // rain rings: in each cell a drop lands now and then and a ring runs out from it; returns the slope of the ripples
        vec2 wxRipples(vec2 p, float t){
          vec2 g = vec2(0.0); vec2 c0 = floor(p);
          for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
            vec2 c = c0 + vec2(float(i), float(j)); float r0 = wxh(c);
            float ph = t * (0.8 + r0 * 0.6) + r0 * 7.0, n = floor(ph), f = fract(ph);
            vec2 ctr = c + vec2(wxh(c + n * 1.7), wxh(c + n * 3.1 + 5.0));
            vec2 d = p - ctr; float L = length(d) + 1e-4, R = f * 0.9;
            float q = (L - R) * 9.0; float w = sin((L - R) * 34.0) * exp(-q * q) * (1.0 - f) * (1.0 - f);
            g += d / L * w;
          }
          return g;
        }`)
        .replace('#include <map_fragment>', `
        for (int hi = 0; hi < 6; hi++) { vec4 HH = uHoles[hi]; if (HH.w > 0.5 && length(vWPos.xz - HH.xy) < HH.z) discard; }
        for (int ci = 0; ci < 2; ci++) {   // a cave mouth's arch (the passage's own superellipse, a little larger), run a few metres into the face
          vec4 CA = uCaveCut[ci * 3], CB = uCaveCut[ci * 3 + 1], CC = uCaveCut[ci * 3 + 2]; if (CC.w < 0.5) continue;
          vec2 cd = vWPos.xz - CA.xy; float cal = dot(cd, CA.zw), cla = abs(dot(cd, vec2(-CA.w, CA.z))) / CB.y, chy = (vWPos.y - CB.x) / CB.z;
          if (cal > CB.w && cal < CC.x && chy > -0.9 && (chy < 0.0 ? cla < 1.0 : pow(cla, 2.2) + pow(chy, 2.2) < 1.0)) discard;
        }
        vec2 wuv = vWPos.xz * uTile;
        vec2 muv = vWPos.xz / uSize + 0.5;
        float life = texture2D(tMask, muv).r;
        vec4 dead = texture2D(tDead, wuv); vec4 dead2 = texture2D(tDead, wuv * 0.21 + vec2(0.37, 0.11));
        vec4 grass = texture2D(tAlive, wuv); vec4 grass2 = texture2D(tAlive, wuv * 0.19 + 0.5);
        float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
        vec3 bw = pow(abs(vWNorm), vec3(4.0)); bw /= dot(bw, vec3(1.0));
        vec4 rock = texture2D(tRock, vWPos.zy * uTile * 0.5) * bw.x + texture2D(tRock, vWPos.xz * uTile * 0.5) * bw.y + texture2D(tRock, vWPos.xy * uTile * 0.5) * bw.z;
        vec3 deadCol = mix(dead.rgb, dead2.rgb, 0.4) * uDeadTint;
        float aliveMix = smoothstep(0.35, 0.65, life + (grass.a - dead.a) * 0.25);
        vec3 ground = mix(deadCol, mix(grass.rgb, grass2.rgb, 0.4) * uAliveTint, aliveMix);
        float rockMix = smoothstep(0.30, 0.52, slope + (rock.a - 0.5) * 0.18);
        rockMix = max(rockMix, uRockAll * smoothstep(0.25, 0.6, rock.a + dead2.a * 0.4));   // the summit: bare broken rock with grit in the hollows
        vec3 rockC = rock.rgb * mix(0.62, 1.0, aliveMix);
        // the gorge walls: bedded strata, pale and dark bands that kink with the folds of the rock
        float bed = vWPos.y * 0.55 + sin(vWPos.x * 0.05 + vWPos.z * 0.04) * 2.2 + rock.a * 1.2;
        rockC *= mix(1.0, 0.72 + 0.5 * smoothstep(0.2, 0.8, abs(fract(bed) - 0.5) * 2.0) + 0.15 * sin(bed * 0.37), uStrata);
        vec3 tcol = mix(ground, rockC, rockMix);
        // the road: packed mud worn into two wheel ruts, and through the village, setts laid in the mud
        vec4 rm = uRoad > 0.5 ? texture2D(tMask, muv) : vec4(0.0, 0.0, 0.0, 0.5);
        float rlat = (rm.a - 0.5) * 16.0;
        float rut = exp(-pow((abs(rlat) - 0.78) / 0.24, 2.0)) * smoothstep(0.4, 0.9, rm.g);
        float trk = smoothstep(0.08, 0.75, rm.g + (dead2.a - 0.5) * 0.35) * (1.0 - rockMix * 0.7);
        vec3 mud = mix(vec3(0.20, 0.16, 0.12), vec3(0.13, 0.10, 0.08), dead.a) * mix(1.0, 0.62, rut);
        mud = mix(mud, deadCol * 0.8, 0.25 * (1.0 - smoothstep(0.5, 0.95, rm.g)));
        tcol = mix(tcol, mud, trk);
        vec2 suv = vWPos.xz / 1.6; vec4 sc = uRoad > 0.5 ? texture2D(tSetts, suv) : vec4(0.0);
        // setts end raggedly: stones missing at the edges, mud between
        float pave = smoothstep(0.32, 0.62, rm.b + (wxn(floor(suv * vec2(6.0, 8.0)) * 0.37) - 0.5) * 0.55 * (1.0 - rm.b));
        tcol = mix(tcol, sc.rgb * 0.85, pave);
        float road = max(trk, pave);
        float snow = smoothstep(uSnowLine, uSnowLine + 10.0, vWPos.y + rock.a * 5.0) * (1.0 - rockMix * 0.5);
        // on the summit the snow lies on everything flat enough to hold it, thin and wind-scoured, rock showing through
        snow = max(snow, uFlatSnow * smoothstep(0.62, 0.86, vWNorm.y + (rock.a - 0.5) * 0.3 + (dead2.a - 0.5) * 0.15) * smoothstep(uSnowFrom, uSnowFrom + 70.0, vWPos.y + (rock.a - 0.5) * 16.0));
        // fresh snow settling on the flats while it falls
        snow = max(snow, uSnowAcc * smoothstep(0.8, 0.95, vWNorm.y) * smoothstep(0.3, 0.6, wxn(vWPos.xz * 0.4) * 0.6 + dead.a * 0.4 + uSnowAcc * 0.3));
        tcol = mix(tcol, texture2D(tSnow, wuv).rgb, snow);
        // rain: the ground darkens and goes glossy, and water stands in its hollows (low ground, flat, by the noise)
        float wetK = uWet * (1.0 - snow);
        float pn = wxn(vWPos.xz * 0.09) * 0.6 + wxn(vWPos.xz * 0.31 + 3.0) * 0.3 + (1.0 - dead2.a) * 0.1;
        float puddle = smoothstep(0.66 - uWet * 0.14 - rut * 0.3, 0.7 - uWet * 0.14 - rut * 0.3, pn) * smoothstep(0.94, 0.985, vWNorm.y) * smoothstep(0.3, 0.7, uWet) * (1.0 - snow) * (1.0 - rockMix) * (1.0 - pave * 0.7);
        tcol *= 1.0 - 0.4 * wetK;
        tcol = mix(tcol, tcol * 0.3 + vec3(0.008, 0.01, 0.012), puddle);
        float wet = 1.0 - smoothstep(uWater - 0.2, uWater + 0.7, vWPos.y);
        tcol *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = tcol;
        float ember = (1.0 - road) * (1.0 - aliveMix) * (1.0 - rockMix) * (1.0 - snow) * (1.0 - uFlatSnow) * smoothstep(0.06, 0.16, (dead.r - dead.g) * 2.0);
        `)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(mix(0.95, 0.82, aliveMix), 0.78, rockMix); roughnessFactor = mix(roughnessFactor, 0.2, wet); roughnessFactor = mix(roughnessFactor, 0.55, snow); roughnessFactor = mix(roughnessFactor, 0.32, wetK * 0.9); roughnessFactor = mix(roughnessFactor, 0.02, puddle);`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nd = texture2D(tDeadN, wuv).xyz * 2.0 - 1.0, na = texture2D(tAliveN, wuv).xyz * 2.0 - 1.0, nr = texture2D(tRockN, vWPos.xz * uTile * 0.5).xyz * 2.0 - 1.0;
          vec3 tnm = normalize(mix(mix(nd, na, aliveMix), nr, rockMix));
          if (pave > 0.01) tnm = normalize(mix(tnm, texture2D(tSettsN, suv).xyz * 2.0 - 1.0, pave));
          vec3 Nw = normalize(vWNorm); vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x); vec3 Bw = normalize(cross(Nw, Tw));
          vec3 nw = normalize(Tw * tnm.x * uNStr - Bw * tnm.y * uNStr + Nw * max(tnm.z, 0.2));
          // puddles lie flat as glass, ringed by the rain; wet ground takes the splashes too
          if (wetK > 0.01) {
            vec2 rg = uRainA > 0.01 ? wxRipples(vWPos.xz * 1.6, uWTime) : vec2(0.0);
            nw = normalize(mix(nw, Nw, puddle * 0.9) + vec3(rg.x, 0.0, rg.y) * uRainA * (0.35 * puddle + 0.08 * wetK));
          }
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.3, 0.06) * ember * uEmber * 0.6;');
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true; mesh.castShadow = this.ch.terrain.kind === 'mountain';
    this.group.add(mesh); this.terrain = mesh;
    // the knights set out from living land: green behind them, the blight ahead
    if (T.kind !== 'peak') {
      const S = this.maskSize;
      for (let j = 0; j < S; j++) {
        const z = (j / S - 0.5) * HALF * 2;
        for (let i = 0; i < S; i++) {
          const x = (i / S - 0.5) * HALF * 2;
          const edge = -112 + this.noise.n2(x * 0.03, 7.7) * 10 + this.noise.n2(x * 0.11, 3.1) * 4;
          const v = smooth(clamp((edge - z) / 16, 0, 1));
          const k = (j * S + i) * 4; this.maskData[k] = Math.max(this.maskData[k], v * 255);
        }
      }
      this.mask.needsUpdate = true;
    }
    this.paintRoad();
  }
  // The road, painted into the ground itself so it follows every rise and fold of the terrain and never
  // flickers or breaks: the mask's G channel is the packed-mud track, B the setts of the village street and square,
  // A the signed distance across the road (for the wheel ruts). Only where people lived and drove carts.
  paintRoad() {
    const T = this.ch.terrain; if (T.kind !== 'vale' && T.kind !== 'village') return;
    const S = this.maskSize, d = this.maskData, tex = (HALF * 2) / S, P = this.path.poly;
    const best = new Float32Array(S * S).fill(1e9), lat = new Float32Array(S * S), tt = new Float32Array(S * S), R = 14;
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[k], b = P[k + 1], abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1, l = Math.sqrt(l2);
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - R) / tex + S / 2)), i1 = Math.min(S - 1, Math.ceil((Math.max(a.x, b.x) + R) / tex + S / 2));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - R) / tex + S / 2)), j1 = Math.min(S - 1, Math.ceil((Math.max(a.z, b.z) + R) / tex + S / 2));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5 - S / 2) * tex, z = (j + 0.5 - S / 2) * tex;   // texel centres (the mask is sampled linearly)
        const f = clamp(((x - a.x) * abx + (z - a.z) * abz) / l2, 0, 1), px = a.x + abx * f, pz = a.z + abz * f, dd = (x - px) ** 2 + (z - pz) ** 2, q = j * S + i;
        if (dd < best[q]) { best[q] = dd; lat[q] = ((x - a.x) * -abz + (z - a.z) * abx) / l; tt[q] = (k + f) / (P.length - 1); }
      }
    }
    const pv = this.paving;
    for (let q = 0; q < S * S; q++) {
      if (best[q] > R * R) continue;
      const i = q % S, j = Math.floor(q / S), x = (i + 0.5 - S / 2) * tex, z = (j + 0.5 - S / 2) * tex, dist = Math.sqrt(best[q]);
      const nz = this.noise.n2(x * 0.21, z * 0.21) - 0.5;
      const half = 2.3 + this.noise.n2(tt[q] * 90, 4.4) * 0.6;
      const trk = 1 - smooth(clamp((dist + nz * 1.4 - half + 0.6) / 1.6, 0, 1));
      let pave = 0;
      if (pv) {
        const sv = this.sOf(tt[q]), ends = smooth(clamp((sv - pv.sMin) / 5, 0, 1)) * smooth(clamp((pv.sMax - sv) / 5, 0, 1));
        const ph = this.pavingHalf(tt[q], lat[q] >= 0 ? 1 : -1);
        pave = (1 - smooth(clamp((dist + nz * 1.2 - ph + 0.5) / 1.2, 0, 1))) * ends;
      }
      const k = q * 4; d[k + 1] = Math.max(d[k + 1], trk * 255); d[k + 2] = Math.max(d[k + 2], pave * 255); d[k + 3] = clamp(lat[q] / 8 * 0.5 + 0.5, 0, 1) * 255;
    }
    this.mask.needsUpdate = true;
  }
  // open country beyond the battlefield, out to the horizon
  buildFarTerrain() {
    const R = 2600, rings = 46, segs = 96;
    const pos = [];
    const radii = []; for (let i = 0; i <= rings; i++) radii.push(HALF * 0.92 + (R - HALF * 0.92) * Math.pow(i / rings, 2.2));
    for (let i = 0; i <= rings; i++) for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU; const r0 = radii[i];
      // square near the battlefield, round far away
      const sq = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const rr = r0 * lerp(sq, 1, clamp((r0 - HALF) / 400, 0, 1));
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      let y = this.groundAt(x, z);
      if (Math.abs(x) < HALF - 2 && Math.abs(z) < HALF - 2) y -= 3;   // tucked under the battlefield
      pos.push(x, y, z);
    }
    const idx = [];
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // the same ground, but the fog never fully swallows it: distant ridges stay dark layered silhouettes under the hazy horizon
    const base = this.terrain.material, mat = base.clone();
    mat.onBeforeCompile = (sh, r) => { base.onBeforeCompile(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('min( fogFactor, 0.88 )', 'min( fogFactor, 0.62 )')); };
    mat.customProgramCacheKey = () => 'farTerrain';
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m); this.farTerrain = m;
  }

  // how alive the land is here, 0..1 (beyond the battlefield, as at its edge)
  lifeAt(x, z) {
    if (!this.maskData) return 0;
    const S = this.maskSize;
    const i = clamp(Math.floor((x / (HALF * 2) + 0.5) * S), 0, S - 1), j = clamp(Math.floor((z / (HALF * 2) + 0.5) * S), 0, S - 1);
    return this.maskData[(j * S + i) * 4] / 255;
  }
  // paint life into the mask (world coords), returns true if anything changed
  paintLife(x, z, radius, amount) {
    const S = this.maskSize, d = this.maskData;
    const cx = (x / (HALF * 2) + 0.5) * S, cz = (z / (HALF * 2) + 0.5) * S, cr = radius / (HALF * 2) * S;
    const x0 = Math.max(0, Math.floor(cx - cr - 2)), x1 = Math.min(S - 1, Math.ceil(cx + cr + 2));
    const z0 = Math.max(0, Math.floor(cz - cr - 2)), z1 = Math.min(S - 1, Math.ceil(cz + cr + 2));
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
      const dd = Math.hypot(i - cx, j - cz);
      const n = this.noise.n2(i * 0.15, j * 0.15) * 0.18 * cr;
      const v = smooth(clamp((cr + n - dd) / Math.max(1, cr * 0.25), 0, 1)) * amount * 255;
      const k = (j * S + i) * 4; if (v > d[k]) d[k] = v;
    }
    this.mask.needsUpdate = true;
  }

  // ---------------------------------------------------------------- altars
  buildAltars() {
    const st = stoneTextures(512, true), stR = stoneTextures(512, false);
    const stone = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, roughness: 0.85 });
    const rough = new THREE.MeshStandardMaterial({ map: stR.map, normalMap: stR.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.92, color: 0xb4b2aa });
    const dt = demonTextures();
    const blight = new THREE.MeshStandardMaterial({ map: dt.map, normalMap: dt.normalMap, emissiveMap: dt.emissiveMap, emissive: 0xff3010, emissiveIntensity: 1.8, roughness: 0.4, metalness: 0.2 });
    this.altarMats = { stone, blight };
    this.altars = [];
    const r = rng(this.ch.seed + 9);
    for (let i = 0; i < this.altarT.length; i++) {
      const a = this.altarT[i];
      const g = new THREE.Group(); g.position.set(a.x, a.y, a.z);
      // octagonal steps
      for (let s = 0; s < 3; s++) { const cg = new THREE.CylinderGeometry(3.2 - s * 0.6, 3.3 - s * 0.6, 0.26, 8); uvScale(cg, (3.25 - s * 0.6) * TAU / 1.6, 0.26 / 1.6 * 5); const m = new THREE.Mesh(cg, stone); m.position.y = 0.13 + s * 0.26; m.receiveShadow = m.castShadow = true; g.add(m); }
      // wayside cross with a pitched cap
      const crossG = merge([
        xf(new THREE.BoxGeometry(0.34, 3.2, 0.34), [0, 2.38, 0]),
        xf(new THREE.BoxGeometry(1.5, 0.3, 0.3), [0, 3.25, 0]),
        xf(new THREE.BoxGeometry(0.6, 0.18, 0.6), [0, 0.86, 0]),
        xf(new THREE.ConeGeometry(0.32, 0.3, 4), [0, 4.12, 0], [0, PI / 4, 0]),
      ]);
      const cross = new THREE.Mesh(crossG, stone); cross.castShadow = true; g.add(cross);
      const yaw = Math.atan2(-a.x, -a.z) + r.range(-0.3, 0.3); cross.rotation.y = yaw;
      // standing stones mark the prayer circle
      const ring = [];
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU + r.range(-0.15, 0.15);
        const hh = 2.0 + r.range(0, 1.3), sg = megalith(0.78 + r.range(-0.1, 0.15), hh, 0.5 + r.range(-0.08, 0.1), k + i * 10);
        const m = new THREE.Mesh(sg, rough); m.position.set(Math.cos(ang) * 8.2, -0.35, Math.sin(ang) * 8.2); m.rotation.set(r.range(-0.12, 0.12), ang, r.range(-0.12, 0.12));
        m.castShadow = true; g.add(m); ring.push(m);
        this.addCollider(a.x + Math.cos(ang) * 8.2, a.z + Math.sin(ang) * 8.2, 0.55);
      }
      this.addCollider(a.x, a.z, 0.6);
      // the corruption: thorned black growths strangling the cross
      const corr = new THREE.Group();
      const tubes = [];
      for (let k = 0; k < 7; k++) {
        const pts = []; const a0 = r() * TAU, turns = r.range(0.8, 1.6), h = r.range(2.2, 4.0);
        for (let s = 0; s <= 14; s++) { const t = s / 14; const ang = a0 + t * turns * TAU; const rr = 0.28 + (1 - t) * 0.1; pts.push(new THREE.Vector3(Math.cos(ang) * rr, 0.8 + t * h, Math.sin(ang) * rr)); }
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.05 * r.range(0.7, 1.2), 5));
        for (let s = 0; s < 6; s++) { const p = pts[2 + s * 2]; const th = new THREE.ConeGeometry(0.025, 0.16, 4); xf(th, [p.x * 1.2, p.y, p.z * 1.2], [r() * 3, r() * 3, r() * 3]); tubes.push(th); }
      }
      for (let k = 0; k < 9; k++) { // roots crawling over the steps
        const ang = r() * TAU; const pts = [];
        for (let s = 0; s <= 8; s++) { const t = s / 8; pts.push(new THREE.Vector3(Math.cos(ang + t * 0.6) * (0.3 + t * 4.5), 0.82 - t * 0.7 + Math.sin(t * 9) * 0.05, Math.sin(ang + t * 0.6) * (0.3 + t * 4.5))); }
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07 * (1 - 0.0), 5));
      }
      const cm = new THREE.Mesh(merge(tubes), blight); cm.castShadow = true; corr.add(cm);
      g.add(corr);
      // candles that appear when cleansed
      const candles = new THREE.Group(); candles.visible = false;
      const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x302010 });
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
      for (let k = 0; k < 6; k++) { const ang = (k / 6) * TAU; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.24 + (k % 3) * 0.06, 8), wax); c.position.set(Math.cos(ang) * 0.75, 0.9 + c.geometry.parameters.height / 2, Math.sin(ang) * 0.75); candles.add(c); const f = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), flameMat); f.scale.y = 2; f.position.copy(c.position); f.position.y += c.geometry.parameters.height / 2 + 0.03; candles.add(f); }
      const cl = new THREE.PointLight(0xffb060, 0, 9, 2); cl.position.y = 1.5; candles.add(cl); candles.userData.light = cl;
      g.add(candles);
      // prayer circle on the ground
      const circleMat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(0xd9b46a) }, a: { value: 0.0 }, prog: { value: 0 }, time: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 color; uniform float a, prog, time; varying vec2 vUv;
          void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float ang = atan(p.y, p.x) / 6.28318 + 0.5;
            float ring = smoothstep(0.02, 0.0, abs(r - 0.96)) + smoothstep(0.015, 0.0, abs(r - 0.9)) * 0.6;
            float fill = step(ang, prog) * smoothstep(0.012, 0.0, abs(r - 0.93)) * 1.5;
            float runes = step(0.5, fract(ang * 56.0)) * smoothstep(0.01, 0.0, abs(r - 0.835)) * 0.5;
            float glow = (ring + fill + runes) * a * (0.85 + 0.15 * sin(time * 3.0));
            gl_FragColor = vec4(color * glow, 1.0); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const circle = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), circleMat); circle.rotation.x = -PI / 2; circle.position.y = 0.06; g.add(circle);
      // a red glow from the corruption
      const evil = new THREE.PointLight(0xff3010, 6, 14, 2); evil.position.y = 2; g.add(evil);
      this.group.add(g);
      this.altars.push({ i, x: a.x, y: a.y, z: a.z, group: g, corr, candles, circle, evilLight: evil, crossMesh: cross, state: 'blighted', progress: 0, radius: 7.2 });
    }
  }

  // ---------------------------------------------------------------- props
  addCollider(x, z, r) { const c = { x, z, r }; this.colliders.push(c); this.colGrid.insert(c, x, z); return c; }
  // keep an entity out of colliders and inside the world
  collide(ent, radius) {
    const p = ent.pos; const near = this.colGrid.query(p.x, p.z, radius + 3, this._q || (this._q = []));
    for (const c of near) {
      const dx = p.x - c.x, dz = p.z - c.z; const d = Math.hypot(dx, dz); const m = c.r + radius;
      if (d < m && d > 1e-4) { p.x = c.x + dx / d * m; p.z = c.z + dz / d * m; }
    }
    const lim = HALF - 8;
    if (this.ch.terrain.kind === 'peak') { const r = Math.hypot(p.x, p.z); if (r > 33) { p.x *= 33 / r; p.z *= 33 / r; } }
    else if (this.ch.terrain.kind === 'mountain') {
      // stay in the ravine
      const nr = this.path.nearest(p.x, p.z);
      // along the ledge, the outer edge is the edge of the world
      if (this.caveSys && this.caveSys.collide(p, radius, nr)) return;   // in and about the cave: its own walls
      let lim = 13; const L = this.ledge;
      if (L && nr.t > L.t0 && nr.t < L.t1) { const a = this.path.at(nr.t), b = this.path.at(Math.min(1, nr.t + 0.004)); const side = Math.sign((p.x - a.x) * -(b.z - a.z) + (p.z - a.z) * (b.x - a.x)); if (side === L.side) lim = 3.0; }
      if (nr.d > lim) { const q = this.path.at(nr.t); const k = lim / nr.d; p.x = q.x + (p.x - q.x) * k; p.z = q.z + (p.z - q.z) * k; }
      // the crevasse: only the bridge crosses it
      const C = this.crevasse, B = this.bridge;
      if (C && B) { const d = (p.x - C.x) * C.nx + (p.z - C.z) * C.nz, along = (p.x - C.x) * C.nz - (p.z - C.z) * C.nx;
        if (Math.abs(d) < 3.6 && Math.abs(along) < 16 && Math.abs(along) > 0.95) { const push = (Math.sign(d) || 1) * 3.6 - d; p.x += C.nx * push; p.z += C.nz * push; } }
    } else { p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim); }
  }
  inBounds(x, z) { return Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10; }

  okSpot(x, z, minPath = 5, minAltar = 14) {
    if (!this.inBounds(x, z)) return false;
    if (this.inCaveZone(x, z, 6)) return false;
    if (this.ch.terrain.kind !== 'peak' && this.path.nearest(x, z).d < minPath) return false;
    for (const a of this.altarT) if (Math.hypot(x - a.x, z - a.z) < minAltar) return false;
    if (this.inLot(x, z, 1.5)) return false;
    if (this.paving && this.onPaving(x, z)) return false;
    return true;
  }
  scatter(n, test, cb, tries = 6) {
    const r = this.r; let placed = 0;
    for (let k = 0; k < n * tries && placed < n; k++) {
      const x = r.range(-HALF + 8, HALF - 8), z = r.range(-HALF + 8, HALF - 8);
      if (!test(x, z)) continue;
      cb(x, z, this.heightAt(x, z)); placed++;
    }
  }
  instanced(geo, mat, list, { shadow = true, receive = true } = {}) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();
    list.forEach((it, i) => { E.set(it.rx || 0, it.ry || 0, it.rz || 0); Q.setFromEuler(E); S.setScalar(it.s || 1); if (it.sy) S.y = it.sy; if (it.sx) S.x = it.sx; if (it.sz) S.z = it.sz; P.set(it.x, it.y, it.z); M.compose(P, Q, S); m.setMatrixAt(i, M); });
    m.castShadow = shadow; m.receiveShadow = receive; m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere?.();
    this.group.add(m); return m;
  }

  treeGeometry(seed, style = 'oak') {
    // a gnarled tree: a leaning trunk with flared roots, limbs that fork four
    // times down to bare twigs; bark scaled to each limb's length
    const r = rng(seed); const parts = []; const tips = [];
    const pine = style === 'pine';
    const branch = (start, dir, len, rad, depth) => {
      const segs = depth === 0 ? 7 : 5;
      const pts = [start.clone()]; let p = start.clone(), d = dir.clone();
      const wander = depth === 0 ? 0.16 : 0.32;
      for (let s = 0; s < segs; s++) {
        d.add(new THREE.Vector3(r.range(-wander, wander), r.range(-0.12, 0.18) - (depth > 1 ? 0.06 : 0), r.range(-wander, wander))).normalize();
        p = p.clone().addScaledVector(d, len / segs); pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const radial = depth === 0 ? 9 : depth === 1 ? 7 : 5, tub = depth === 0 ? 14 : 6;
      const tg = new THREE.TubeGeometry(curve, tub, rad, radial, false);
      const pos = tg.attributes.position, uv = tg.attributes.uv; const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const ring = Math.floor(i / (radial + 1)); const t = ring / tub; const c = curve.getPoint(t);
        let k = 1 - t * 0.68;
        if (depth === 0 && t < 0.12) { // root flare: buttresses between the roots
          const ang = (i % (radial + 1)) / radial * TAU; k *= 1 + (1 - t / 0.12) ** 2 * (0.7 + 0.5 * Math.max(0, Math.sin(ang * 4 + seed)));
        }
        v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(k).add(c); pos.setXYZ(i, v.x, v.y, v.z);
        uv.setXY(i, uv.getX(i) * len / 1.6, uv.getY(i) * Math.max(1, rad * 12));
      }
      tg.computeVertexNormals(); parts.push(tg);
      const maxDepth = pine ? 1 : 4;
      if (depth >= maxDepth || rad < 0.014) { tips.push(p.clone()); return; }
      const kids = pine ? 0 : depth === 0 ? r.int(3, 4) : r.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const t = depth === 0 ? r.range(0.45, 0.95) : r.range(0.35, 1.0); const sp = curve.getPoint(t);
        const spread = depth === 0 ? 1.0 : 0.8;
        const nd = d.clone().add(new THREE.Vector3(r.range(-spread, spread), r.range(-0.15, 0.55), r.range(-spread, spread))).normalize();
        branch(sp, nd, len * r.range(0.48, 0.72), rad * r.range(0.45, 0.6), depth + 1);
      }
      if (pine && depth === 0) {
        for (let k = 0; k < 22; k++) { const t = 0.2 + (k / 22) * 0.75; const sp = curve.getPoint(t); const a = k * 2.4; const nd = new THREE.Vector3(Math.cos(a), -0.25 + t * 0.2, Math.sin(a)); branch(sp, nd, (1 - t) * 3.4 + 0.5, 0.035 * (1.2 - t), 2); }
      }
    };
    const H = pine ? r.range(10, 15) : r.range(7, 11);
    const lean = new THREE.Vector3(r.range(-0.12, 0.12), 1, r.range(-0.12, 0.12)).normalize();
    branch(new THREE.Vector3(0, -0.4, 0), lean, H * (pine ? 1 : 0.5), pine ? 0.24 : 0.34, 0);
    // a few surface roots snaking away from the base
    if (!pine) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + r.range(-0.4, 0.4); const pts = [];
      for (let s = 0; s <= 5; s++) { const t = s / 5; pts.push(new THREE.Vector3(Math.cos(a + t * 0.3) * (0.15 + t * 1.6), -0.05 - t * 0.3 + Math.sin(t * 7) * 0.04, Math.sin(a + t * 0.3) * (0.15 + t * 1.6))); }
      const c = new THREE.CatmullRomCurve3(pts); const tg = new THREE.TubeGeometry(c, 8, 0.09, 5, false);
      const pos = tg.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { const t = Math.floor(i / 6) / 8; const cc = c.getPoint(t); v.fromBufferAttribute(pos, i).sub(cc).multiplyScalar(1 - t * 0.8).add(cc); pos.setXYZ(i, v.x, v.y, v.z); }
      tg.computeVertexNormals(); parts.push(tg);
    }
    return { geo: merge(parts), tips };
  }

  buildProps() {
    const P = this.ch.props, r = this.r, kind = this.ch.terrain.kind;
    const bark = barkTextures(); const st = stoneTextures(512, false), stB = stoneTextures(512, true);
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughnessMap: bark.roughnessMap, roughness: 1 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, roughnessMap: st.roughnessMap, roughness: 1 });
    const brickMat = new THREE.MeshStandardMaterial({ map: stB.map, normalMap: stB.normalMap, roughnessMap: stB.roughnessMap, roughness: 1 });
    const wd = woodTextures(256, [70, 50, 34]); const charred = woodTextures(256, [26, 20, 18]);
    const woodMat = new THREE.MeshStandardMaterial({ map: wd.map, normalMap: wd.normalMap, roughnessMap: wd.roughnessMap, roughness: 1 });
    const charMat = new THREE.MeshStandardMaterial({ map: charred.map, normalMap: charred.normalMap, roughness: 0.95, emissive: 0x200800, emissiveIntensity: 0.3 });
    this.mats = { barkMat, stoneMat, brickMat, woodMat, charMat };

    // --- trees (dead) with hidden leaf crowns that grow back when the land heals
    if (P.deadTrees) {
      const variants = []; const style = P.pines ? 'pine' : 'oak';
      for (let v = 0; v < 6; v++) variants.push(this.treeGeometry(this.ch.seed * 7 + v, v >= 4 && P.pines ? 'oak' : style));
      const lists = variants.map(() => []);
      const leafList = [];
      const dense = kind === 'wood';
      this.scatter(P.deadTrees, (x, z) => this.okSpot(x, z, dense ? 7 : 9, 16) && (kind !== 'fen' || this.heightAt(x, z) > -0.3) && (kind !== 'mountain' || this.normalAt(x, z).y > 0.74), (x, z, y) => {
        const v = r.int(0, 5); const s = r.range(0.8, 1.35);
        const it = { x, y: y - 0.1, z, ry: r() * TAU, s, rx: r.range(-0.06, 0.06), rz: r.range(-0.06, 0.06) };
        lists[v].push(it); this.addCollider(x, z, 0.45 * s);
        for (const tip of variants[v].tips) if (r() < 0.45) {
          const c = Math.cos(it.ry), sn = Math.sin(it.ry);
          leafList.push({ x: x + (tip.x * c + tip.z * sn) * s, y: y + tip.y * s, z: z + (-tip.x * sn + tip.z * c) * s, s: 0, target: r.range(1.4, 2.3) * s, ry: r() * TAU });
        }
      });
      variants.forEach((v, i) => this.instanced(v.geo, barkMat, lists[i]));
      // foliage (hidden until healed)
      // leaf clusters: three crossed cards carrying a painted spray of leaves
      const cards = []; for (let k = 0; k < 3; k++) { const q = new THREE.PlaneGeometry(1.6, 1.6); q.rotateY((k / 3) * PI); q.rotateX(0.35 * (k - 1)); cards.push(q); }
      const leafGeo = merge(cards);
      const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(P.pines), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: P.pines ? 0x7a9a7a : 0xb0c890 });
      this.swayMaterial(leafMat, 0.06);
      for (const l of leafList) if (this.lifeAt(l.x, l.z) > 0.6) l.s = l.target;   // trees in leaf on the living land
      this.leaves = { mesh: this.instanced(leafGeo, leafMat, leafList.map((l) => ({ ...l, s: l.s || 0.0001 }))), list: leafList };
    }
    // --- rocks & crags
    if (P.rocks || P.crags) {
      const rocks = []; for (let v = 0; v < 5; v++) rocks.push(lumpy(icoSmooth(2), 0.35, 30 + v));
      const lists = rocks.map(() => []);
      this.scatter(P.rocks || 0, (x, z) => this.okSpot(x, z, 4, 11), (x, z, y) => { const s = r.range(0.4, 1.6); lists[r.int(0, 4)].push({ x, y: y - s * 0.3, z, s, sy: s * r.range(0.6, 1), ry: r() * TAU }); if (s > 0.9) this.addCollider(x, z, s * 0.8); });
      if (P.crags && kind !== 'peak' && kind !== 'mountain') this.scatter(P.crags, (x, z) => this.okSpot(x, z, 11, 14), (x, z, y) => { const s = r.range(2.5, 6); lists[r.int(0, 4)].push({ x, y: y + s * 0.4, z, s, sy: s * r.range(1.4, 2.6), ry: r() * TAU, rx: r.range(-0.2, 0.2), rz: r.range(-0.2, 0.2) }); this.addCollider(x, z, s * 0.85); });
      if (kind === 'peak') {
        // fractured outcrops on the lip of the arena and along the arêtes, leaning spires of black rock, the summit fang
        const jag = [], spires = []; for (let v = 0; v < 4; v++) { jag.push(jaggedRock(500 + v)); spires.push(jaggedRock(600 + v, 0.35)); }
        const jl = jag.map(() => []), sl = spires.map(() => []);
        for (let k = 0; k < 46; k++) {
          const a = r() * TAU; let da = a + Math.PI / 2; da = Math.atan2(Math.sin(da), Math.cos(da)); if (Math.abs(da) < 0.28) continue;   // keep the way up clear
          const d = r.range(27, 34), x = Math.cos(a) * d, z = Math.sin(a) * d, s = r.range(0.8, 2.6);
          jl[k % 4].push({ x, y: this.heightAt(x, z) + s * 0.25, z, s, sy: s * r.range(0.7, 1.5), ry: r() * TAU, rx: r.range(-0.3, 0.3), rz: r.range(-0.3, 0.3) }); if (s > 1.4) this.addCollider(x, z, s * 0.8);
        }
        for (let k = 0; k < 50; k++) {   // out on the faces and crests: broken buttresses half-buried in snow
          const a = r() * TAU, d = r.range(38, 110), x = Math.cos(a) * d, z = Math.sin(a) * d; const s = r.range(2.5, 6);
          (k % 4 ? jl : sl)[k % 4].push({ x, y: this.heightAt(x, z) - s * 0.15, z, s, sy: s * r.range(0.8, 1.6), ry: r() * TAU, rx: r.range(-0.3, 0.3), rz: r.range(-0.3, 0.3) });
        }
        const dark = snowyRock(stoneMat.clone()); dark.color = new THREE.Color(0x77726e); dark.flatShading = true;
        jag.forEach((g, i) => this.instanced(g, dark, jl[i])); spires.forEach((g, i) => this.instanced(g, dark, sl[i]));
      }
      rocks.forEach((g, i) => this.instanced(g, stoneMat, lists[i]));
    }
    // --- gravestones & wooden crosses
    if (P.graves) {
      const list = [];
      const yard = this.altarT[Math.min(1, this.altarT.length - 1)];
      for (let k = 0; k < P.graves; k++) {
        let cx = yard.x + 14 + (k % 6) * 1.6 + r.range(-0.2, 0.2), cz = yard.z - 6 + Math.floor(k / 6) * 1.8;
        const CL = this.churchLot;
        if (CL) {   // the churchyard: rows of graves beside the nave, on the church's levelled ground
          const lx = (k % 2 ? 1 : -1) * (11 + (Math.floor(k / 2) % 4) * 1.7) + r.range(-0.15, 0.15), lz = -9 + Math.floor(k / 8) * 2.0 + r.range(-0.15, 0.15);
          const C = Math.cos(CL.yaw), S = Math.sin(CL.yaw); cx = CL.x + lx * C + lz * S; cz = CL.z - lx * S + lz * C;
          if (!this.inBounds(cx, cz) || this.normalAt(cx, cz).y < 0.94 || this.path.nearest(cx, cz).d < 4) continue;
          list.push({ x: cx, y: this.heightAt(cx, cz) - 0.15, z: cz, ry: CL.yaw + r.range(-0.08, 0.08), rx: r.range(-0.1, 0.1), rz: r.range(-0.1, 0.1), s: r.range(0.85, 1.15) }); continue;
        }
        const [x, z] = this.okSpot(cx, cz, 3, 9) ? [cx, cz] : [r.range(-100, 100), r.range(-100, 100)];
        if (!this.okSpot(x, z, 3, 9) || this.normalAt(x, z).y < 0.94) continue;   // a churchyard is level ground, never a hillside
        list.push({ x, y: this.heightAt(x, z) - 0.15, z, ry: r.range(-0.2, 0.2), rx: r.range(-0.15, 0.15), rz: r.range(-0.15, 0.15), s: r.range(0.85, 1.15) });
      }
      // old headstones: lichened, green with moss on their tops and shoulders, dark with damp at the foot
      const graveMat = this.graveMat || (this.graveMat = buildingMat(stoneTextures(512, false), { key: 'grave', moss: 0.95, damp: 0.6, dampTop: 0.1 }));
      this.buildGraves(list, r, graveMat);
    }
    if (P.crosses) {
      const cg = merge([xf(new THREE.BoxGeometry(0.1, 1.6, 0.1), [0, 0.7, 0]), xf(new THREE.BoxGeometry(0.7, 0.09, 0.09), [0, 1.1, 0])]);
      const list = []; this.scatter(P.crosses, (x, z) => this.okSpot(x, z, 3, 12) && this.normalAt(x, z).y > 0.86, (x, z, y) => list.push({ x, y: y - 0.1, z, ry: r() * TAU, rx: r.range(-0.25, 0.25), rz: r.range(-0.2, 0.2) }));
      this.instanced(cg, woodMat, list);
    }
    this.buildFences(woodMat.clone());
    // --- the farms and the village of Saint Aldric, on their planned lots
    for (const L of this.lots || []) if (L.kind === 'house' || L.kind === 'barn') this.placeHouse(r, woodMat, charMat, brickMat, L.kind === 'barn', L);
    if (P.village) this.placeChurch(r, brickMat, charMat);
    if (P.village) this.buildWells();   // (the street is painted into the ground: paintRoad)
    if (P.fires) {
      // fires burning on in the wrecks of the houses, and out in the street and the plots where something caught
      const spots = this.fireSpots.slice(0, P.fires);
      for (let k = 0; spots.length < P.fires && k < 80; k++) {
        const ru = this.ruinSpots?.[k % (this.ruinSpots?.length || 1)];
        const x = ru ? ru.x + r.range(-10, 10) : r.range(-100, 100), z = ru ? ru.z + r.range(-10, 10) : r.range(-100, 100);
        if (!this.inBounds(x, z) || this.inFootprint(x, z, 0.8) || this.path.nearest(x, z).d < 3.2 || this.altarT.some((a) => Math.hypot(x - a.x, z - a.z) < 10) || this.wells.some((w) => Math.hypot(x - w.x, z - w.z) < 2.5)) continue;
        spots.push({ x, y: this.heightAt(x, z), z, s: r.range(0.55, 0.95), yaw: r() * TAU });
      }
      for (const f of spots) this.fires.push(f);
      this.buildBurning(spots, this.charSpots, r);
      // and the burning houses burn along their wall tops, where the floor beams and studs still stand on them
      for (const f of (this.wallFires || []).slice(0, 18)) this.fires.push(f);
      this.fireLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xff7a30, 0, 20, 2); this.group.add(l); return l; });
      this.flamePool = Array.from({ length: 10 }, (_, i) => { const f = makeFlame({ height: 1.6, width: 1.0, tongues: 5, sparks: i < 6 ? 40 : 18, smoke: true }); f.group.visible = false; this.group.add(f.group); return f; });
    }
    // --- fen: reeds, stumps, boardwalks
    if (P.reeds) {
      const rg = new THREE.PlaneGeometry(0.7, 1.6); rg.translate(0, 0.8, 0); const rg2 = rg.clone(); rg2.rotateY(PI / 2);
      const reedGeo = merge([rg, rg2]);
      const tex = grassTexture(false);
      const reedMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9a9070, roughness: 1 });
      this.swayMaterial(reedMat, 0.12);
      const list = []; this.scatter(Math.floor(P.reeds * this.q.grass), (x, z) => { const h = this.heightAt(x, z); return h > -0.7 && h < 0.4 && this.okSpot(x, z, 3, 9); }, (x, z, y) => list.push({ x, y: y - 0.1, z, ry: r() * TAU, s: r.range(0.7, 1.4) }), 3);
      this.instanced(reedGeo, reedMat, list, { shadow: false });
    }
    if (P.stumps) {
      const sg = merge([new THREE.CylinderGeometry(0.28, 0.4, 1.0, 8, 2)]); lumpy(sg, 0.15, 3);
      const list = []; this.scatter(P.stumps, (x, z) => this.okSpot(x, z, 4, 10), (x, z, y) => { const s = r.range(0.7, 1.4); list.push({ x, y: y + 0.2, z, s, sy: s * r.range(0.6, 1.6), ry: r() * TAU }); this.addCollider(x, z, 0.35 * s); });
      this.instanced(sg, barkMat, list);
    }
    if (P.logs) {
      const lg = new THREE.CylinderGeometry(0.35, 0.4, 6, 10, 1); lg.rotateZ(PI / 2);
      const list = []; this.scatter(P.logs, (x, z) => this.okSpot(x, z, 6, 12) && this.normalAt(x, z).y > 0.93, (x, z, y) => { const ry = r() * TAU; list.push({ x, y: y + 0.25, z, ry }); for (let s = -2; s <= 2; s++) this.addCollider(x + Math.cos(ry) * s * 1.2, z - Math.sin(ry) * s * 1.2, 0.45); });
      this.instanced(lg, barkMat, list);
    }
    if (P.boardwalk) {
      const plank = new THREE.BoxGeometry(1.8, 0.08, 0.26); const posts = [];
      const list = [];
      for (let t = 0; t < 1; t += 0.0025) {
        const a = this.path.at(t), b = this.path.at(t + 0.002); const h = this.heightAt(a.x, a.z);
        if (h > 0.25) continue;
        list.push({ x: a.x, y: Math.max(h, 0.0) + 0.3, z: a.z, ry: Math.atan2(b.x - a.x, b.z - a.z), rz: r.range(-0.04, 0.04) });
      }
      this.instanced(plank, woodMat, list, { shadow: true });
    }
    // --- battlefield
    if (P.banners) this.buildBanners(P.banners, r, woodMat);
    if (P.fallen) buildFallen(this, P.fallen, r);
    if (P.pikes) {
      const pg = new THREE.CylinderGeometry(0.02, 0.025, 3.2, 5); pg.translate(0, 1.6, 0);
      const list = []; this.scatter(P.pikes, (x, z) => this.okSpot(x, z, 3, 9), (x, z, y) => list.push({ x, y: y - 0.4, z, ry: r() * TAU, rx: r.range(-0.7, 0.7), rz: r.range(-0.7, 0.7), sy: r.range(0.4, 1.1) }));
      this.instanced(pg, woodMat, list);
    }
    if (P.cannons) {
      const bronze = new THREE.MeshStandardMaterial({ color: 0x7a5a2a, metalness: 1, roughness: 0.45 });
      for (let k = 0; k < P.cannons; k++) {
        const x = r.range(-90, 90), z = r.range(-90, 90); if (!this.okSpot(x, z, 6, 14) || this.normalAt(x, z).y < 0.9) continue;
        const g = new THREE.Group(); g.position.set(x, this.heightAt(x, z), z); g.rotation.y = r() * TAU; g.rotation.z = r.range(-0.2, 0.2);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.4, 14), bronze); barrel.rotation.x = PI / 2 - 0.15; barrel.position.y = 0.75; g.add(barrel);
        for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 14), woodMat); w.position.set(s * 0.45, 0.5, 0); w.rotation.y = PI / 2; g.add(w); }
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 2.0), charMat); carriage.position.set(0, 0.45, -0.5); carriage.rotation.x = 0.25; g.add(carriage);
        g.traverse((o) => { o.castShadow = true; }); this.group.add(g); this.addCollider(x, z, 1.2);
      }
    }
    if (P.wagons) for (let k = 0; k < P.wagons; k++) {
      const x = r.range(-100, 100), z = r.range(-100, 100); if (!this.okSpot(x, z, 6, 14) || this.normalAt(x, z).y < 0.9) continue;
      const g = new THREE.Group(); g.position.set(x, this.heightAt(x, z) - 0.1, z); g.rotation.set(0, r() * TAU, r.range(-0.3, 0.3));
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), charMat); bed.position.y = 0.8; g.add(bed);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 6, 12), woodMat); w.position.set(sx * 0.85, 0.45, sz * 1.1); w.rotation.y = PI / 2; g.add(w); }
      g.traverse((o) => { o.castShadow = true; }); this.group.add(g); this.addCollider(x, z, 1.8);
    }
    if (kind === 'mountain') this.buildAscent(stoneMat, woodMat, charMat);
    // --- mountain crevices: dark clefts where eyes will watch
    this.creviceSpots = [];
    if (P.crevices) {
      for (let k = 0; k < P.crevices; k++) {
        const t = 0.06 + (k / P.crevices) * 0.88;
        const a = this.path.at(t), b = this.path.at(Math.min(1, t + 0.005));
        let nx = -(b.z - a.z), nz = b.x - a.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        const side = k % 2 ? 1 : -1; const d = 9.5;
        const x = a.x + nx * side * d, z = a.z + nz * side * d; const y = this.heightAt(x, z) + 1.6;
        const g = new THREE.Group(); g.position.set(x, y, z); g.lookAt(a.x, y, a.z);
        const cleft = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.2, 0.6), new THREE.MeshBasicMaterial({ color: 0x010101 })); g.add(cleft);
        for (const s of [-1, 1]) { const rk = new THREE.Mesh(lumpy(icoSmooth(2), 0.3, k * 3 + s), stoneMat); rk.scale.set(1.4, 2.6, 1.2); rk.position.set(s * 1.25, 0, 0.1); rk.castShadow = true; g.add(rk); }
        this.group.add(g); this.creviceSpots.push({ x, y, z, t, group: g, face: new THREE.Vector3(a.x - x, 0, a.z - z).normalize() });
      }
    }
  }

  // the wells of Saint Aldric go down: a stone-lined shaft under each drum, black water far below, and the ground
  // cut away across its mouth (the terrain shader discards inside each well's circle)
  // Old headstones as a village churchyard has them: round-headed and shouldered slabs, a few stone crosses on
  // their plinths, one broken off, rough wooden crosses over the poorer graves. Each stone is cut from an outline
  // with worn arrises, chipped along its edges; many lean or have sunk, and each grave has its low mound of earth.
  buildGraves(list, r, graveMat) {
    if (!list.length) return;
    const outline = (kind) => {
      const S2 = new THREE.Shape(), w = 0.52, h = 0.86;
      if (kind === 0) { S2.moveTo(-w / 2, -0.3); S2.lineTo(-w / 2, h - w / 2); S2.absarc(0, h - w / 2, w / 2, PI, 0, true); S2.lineTo(w / 2, -0.3); }
      else if (kind === 1) {   // shouldered, with an ogee head
        S2.moveTo(-w / 2, -0.3); S2.lineTo(-w / 2, h * 0.74); S2.quadraticCurveTo(-w / 2, h * 0.86, -w * 0.3, h * 0.86); S2.quadraticCurveTo(-w * 0.06, h * 0.88, 0, h);
        S2.quadraticCurveTo(w * 0.06, h * 0.88, w * 0.3, h * 0.86); S2.quadraticCurveTo(w / 2, h * 0.86, w / 2, h * 0.74); S2.lineTo(w / 2, -0.3);
      } else if (kind === 2) {   // a stone cross, its arms a little flared
        const a = 0.075, b = 0.1, top = 1.05, arm = 0.72;
        S2.moveTo(-a, -0.3); S2.lineTo(-a, arm - 0.08); S2.lineTo(-0.3, arm - b); S2.lineTo(-0.3, arm + b); S2.lineTo(-a, arm + 0.08); S2.lineTo(-b, top); S2.lineTo(b, top);
        S2.lineTo(a, arm + 0.08); S2.lineTo(0.3, arm + b); S2.lineTo(0.3, arm - b); S2.lineTo(a, arm - 0.08); S2.lineTo(a, -0.3);
      } else {   // broken off: a jagged top
        S2.moveTo(-w / 2, -0.3); S2.lineTo(-w / 2, 0.48); S2.lineTo(-0.12, 0.62); S2.lineTo(-0.04, 0.5); S2.lineTo(0.1, 0.57); S2.lineTo(w / 2, 0.36); S2.lineTo(w / 2, -0.3);
      }
      S2.closePath();
      const g = new THREE.ExtrudeGeometry(S2, { depth: kind === 2 ? 0.16 : 0.13, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 2, curveSegments: 9 });
      g.translate(0, 0, kind === 2 ? -0.08 : -0.065);
      // chips and wear: nudge each outline point a little, more toward the top, where the weather takes it
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), zz = pa.getZ(i), k = Math.sin(x * 91.7 + y * 53.3 + kind * 7.1) * 43758.5; const n = (k - Math.floor(k)) - 0.5; const amt = 0.012 + Math.max(0, y) * 0.012; pa.setXYZ(i, x + n * amt, y + n * amt * 0.6, zz + n * amt * 0.5); }
      const parts = [g];
      if (kind === 2) parts.push(xf(new THREE.BoxGeometry(0.46, 0.26, 0.34), [0, -0.08, 0]), xf(new THREE.BoxGeometry(0.36, 0.1, 0.26), [0, 0.09, 0]));   // the cross's plinth
      const m = merge(parts.map((q) => q.index ? q.toNonIndexed() : q)); m.computeVertexNormals(); return boxUV(m, 0.7);
    };
    const geos = [0, 1, 2, 3].map(outline), buckets = [[], [], [], []], wooden = [], mounds = [];
    for (const it of list) {
      const u = r(), kind = u < 0.38 ? 0 : u < 0.62 ? 1 : u < 0.74 ? 2 : u < 0.84 ? 3 : 4;
      const lean = r() < 0.25, sunk = r() < 0.2;
      const g = { ...it, y: it.y + 0.15 - (sunk ? r.range(0.12, 0.3) : 0.02), rx: lean ? r.range(-0.3, 0.22) : it.rx * 0.5, rz: lean ? r.range(-0.18, 0.18) : it.rz * 0.5 };
      if (kind === 4) wooden.push({ ...g, s: r.range(0.9, 1.1) }); else buckets[kind].push(g);
      // the grave itself: a long low mound of earth in front of the stone, some of them sunk into a hollow
      const C = Math.cos(it.ry), S = Math.sin(it.ry), mx = it.x + S * 0.95, mz = it.z + C * 0.95;
      mounds.push({ x: mx, y: this.heightAt(mx, mz) - (sunk ? 0.1 : 0.02), z: mz, ry: it.ry, s: 1, sx: r.range(0.42, 0.5), sy: sunk ? 0.08 : r.range(0.12, 0.2), sz: r.range(0.72, 0.82) });
    }
    geos.forEach((g, i) => this.instanced(g, graveMat, buckets[i]));
    // wooden crosses: two split timbers lashed together, grey with age
    const wc = merge([xf(new THREE.BoxGeometry(0.09, 1.25, 0.07), [0, 0.32, 0], [0, 0, 0.02]), xf(new THREE.BoxGeometry(0.62, 0.075, 0.06), [0, 0.68, 0.06], [0, 0, -0.04]), xf(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), [0, 0.68, 0.035], [PI / 2, 0, 0])]);
    const woodG = this.graveWood || (this.graveWood = buildingMat(woodTextures(256, [92, 86, 78]), { key: 'gravewood', moss: 0.5, damp: 0.5, dampTop: 0.2 }));
    this.instanced(boxUV(wc, 0.6), woodG, wooden);
    // earth: dark, damp soil heaped and settled
    const mg = new THREE.SphereGeometry(1, 14, 7, 0, TAU, 0, PI / 2); lumpy(mg, 0.12, 31);
    const soil = this.graveSoil || (this.graveSoil = new THREE.MeshStandardMaterial({ color: 0x2b231c, roughness: 0.97, metalness: 0 }));
    this.instanced(mg, soil, mounds, { shadow: false });
  }
  buildWells() {
    if (!this.wells.length) return;
    const holes = this.terrainUniforms?.uHoles?.value, geos = [], waters = [];
    this.wells.forEach((W, i) => {
      if (holes && i < holes.length) holes[i].set(W.x, W.z, W.r + 0.05, 1);
      const depth = 7, top = W.y + W.top - 0.05, bottom = W.y - depth, H = top - bottom;
      const g = new THREE.CylinderGeometry(W.r, W.r * 0.96, H, 20, 10, true); g.translate(W.x, (top + bottom) / 2, W.z);
      uvScale(g, (TAU * W.r) / 1.2, H / 1.2);
      const P = g.attributes.position, col = new Float32Array(P.count * 3);
      for (let k = 0; k < P.count; k++) { const d = clamp((top - P.getY(k)) / depth, 0, 1), c = lerp(1, 0.04, Math.pow(d, 0.55)); col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = c; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); geos.push(g);
      const wd = new THREE.CircleGeometry(W.r * 0.97, 20); wd.rotateX(-PI / 2); wd.translate(W.x, bottom + 0.8, W.z); waters.push(wd);
      this.addCollider(W.x, W.z, W.r + 0.3);
    });
    const shaftMat = buildingMat(stoneTextures(512, true), { key: 'wellshaft', side: THREE.BackSide, moss: 0.9, damp: 0.8, dampTop: 999 }); shaftMat.vertexColors = true;
    const shaft = new THREE.Mesh(mergeGeometries(geos), shaftMat); shaft.receiveShadow = true; this.group.add(shaft);
    const wm = new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.02, metalness: 0.2, envMapIntensity: 0.25 });
    this.group.add(new THREE.Mesh(merge(waters), wm));
  }
  // the village street, paved with setts, opening into a square between the road and the church
  buildStreet() {
    const P = this.paving; if (!P) return;
    const NA = 18, step = 0.9, pos = [], uv = [], keep = [], idx = []; let rows = 0;
    for (let sv = P.sMin; sv <= P.sMax; sv += step, rows++) {
      const t = this.tOf(sv), p = this.path.at(t), q0 = this.path.at(this.tOf(sv - 0.5)), q1 = this.path.at(this.tOf(sv + 0.5));
      let tx = q1.x - q0.x, tz = q1.z - q0.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const nx = -tz, nz = tx;
      const hL = this.pavingHalf(t, -1), hR = this.pavingHalf(t, 1);
      for (let j = 0; j <= NA; j++) {
        const off = lerp(-hL, hR, j / NA), x = p.x + nx * off, z = p.z + nz * off;
        pos.push(x, this.heightAt(x, z) + 0.035, z); uv.push(off / 1.6, sv / 1.6);
        keep.push(this.inBounds(x, z) && !this.altarT.some((a) => Math.hypot(x - a.x, z - a.z) < 9.6) && !this.inFootprint(x, z, 0.05) && !this.wells.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 0.3));
      }
    }
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < NA; j++) {
      const a = i * (NA + 1) + j, b = a + NA + 1;
      if (keep[a] && keep[a + 1] && keep[b] && keep[b + 1]) idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // the winding must face up
    { const N = g.attributes.normal; let up = 0; for (let k = 0; k < N.count; k += 7) up += N.getY(k); if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const t2 = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t2; } g.setIndex(idx); g.computeVertexNormals(); } }
    const mat = buildingMat(settsTextures(512), { key: 'setts', moss: 0.35, damp: 0.25, dampTop: -99, normalScale: 1.4 });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -4;
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; this.group.add(m);
  }
  // charred timbers heaped where the fires are, still glowing in their cracks, and sparks going up from them
  // over the whole town (one draw: the sparks move on the GPU)
  buildBurning(fires, chars, r) {
    const et = emberWoodTextures(256);
    const emberMat = new THREE.MeshStandardMaterial({ map: et.map, normalMap: et.normalMap, roughnessMap: et.roughnessMap, roughness: 1, emissive: 0xff6a2a, emissiveMap: et.emissiveMap, emissiveIntensity: 1.6 });
    this.emberMat = emberMat;
    const parts = [];
    const heap = (f, burning) => {
      const n = burning ? 9 : 7, s0 = f.s || 1;
      for (let k = 0; k < n; k++) {
        const len = r.range(1.0, 2.6) * s0, th = r.range(0.14, 0.24), a = (f.yaw || 0) + (k / n) * PI + r.range(-0.3, 0.3), off = r.range(0, 0.5) * s0;
        const bx = f.x + Math.cos(a + 1.3) * off, bz = f.z + Math.sin(a + 1.3) * off;
        if (burning && k < 4) {   // the first few lean in together over the fire
          const tilt = r.range(0.7, 1.0), ca = (k / 4) * TAU + r() * 0.5;
          parts.push(xf(new THREE.BoxGeometry(th, len, th), [f.x + Math.cos(ca) * Math.sin(tilt) * len * 0.42, f.y + Math.cos(tilt) * len * 0.5 - 0.05, f.z + Math.sin(ca) * Math.sin(tilt) * len * 0.42], [-Math.sin(ca) * tilt, 0, Math.cos(ca) * tilt]));
        } else {
          const gy = Math.max(this.heightAt(bx, bz), f.y) + th * 0.5 + Math.floor(k / 3) * th * 0.8;
          parts.push(xf(new THREE.BoxGeometry(th, th, len), [bx, gy, bz], [r.range(-0.12, 0.12), a, r.range(-0.15, 0.15)]));
        }
      }
      for (let k = 0; k < 6; k++) {   // charcoal and embers about the foot
        const a = r() * TAU, d = r.range(0.3, 1.3) * s0, x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d, sz = r.range(0.08, 0.2);
        parts.push(xf(lumpy(icoSmooth(0), 0.3, 50 + k), [x, Math.max(this.heightAt(x, z), f.y) + sz * 0.3, z], [r() * 3, r() * 3, 0], [sz, sz * 0.6, sz]));
      }
    };
    for (const f of fires) heap(f, true);
    for (const c of chars) heap(c, false);
    if (parts.length) { const m = new THREE.Mesh(boxUV(merge(parts), 0.9), emberMat); m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    // sparks
    const src = [...fires, ...chars.map((c) => ({ ...c, s: (c.s || 1) * 0.4 }))]; if (!src.length) return;
    const N = Math.min(1400, src.length * 70), pos = new Float32Array(N * 3), seed = new Float32Array(N), str = new Float32Array(N);
    for (let i = 0; i < N; i++) { const f = src[i % src.length]; pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z; seed[i] = i * 1.618 + 0.31; str[i] = f.s || 1; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aStr', new THREE.BufferAttribute(str, 1));
    const wind = this.ch.wind || [0.6, 0.6];
    const U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(wind[0], wind[1]).normalize().multiplyScalar(0.9) } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
      vertexShader: `uniform float uTime; uniform vec2 uWind; attribute float aSeed; attribute float aStr; varying float vA; varying float vHot;
        float h1(float x){ return fract(sin(x * 91.3) * 47453.5); }
        void main(){
          float life = 1.8 + h1(aSeed) * 3.0, cyc = uTime / life + h1(aSeed * 3.1), ph = fract(cyc);
          vec3 p = position + vec3((h1(aSeed * 2.3) - 0.5) * 1.4, 0.3, (h1(aSeed * 5.1) - 0.5) * 1.4) * aStr;
          p.y += ph * (2.5 + h1(aSeed * 9.3) * 8.0) * (0.6 + 0.4 * aStr);
          p.xz += uWind * ph * ph * (4.0 + h1(aSeed * 4.4) * 6.0) + vec2(sin(ph * 7.0 + aSeed * 13.0), cos(ph * 5.0 + aSeed * 11.0)) * (0.15 + ph * 0.9);
          vA = (1.0 - ph) * smoothstep(0.0, 0.05, ph) * step(0.25, h1(aSeed * 13.1 + floor(cyc))) * (0.55 + 0.45 * sin(uTime * 23.0 + aSeed * 7.0));
          vHot = 1.0 - ph;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.0 + 2.2 * h1(aSeed * 6.6)) * (1.0 - ph * 0.5) * 11.0 / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; varying float vHot;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; float k = 1.0 - d * 4.0;
          vec3 col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.75, 0.35), vHot * vHot); gl_FragColor = vec4(col * 2.6 * k * vA, 1.0); }` });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; this.group.add(pts); this.sparks = U;
  }
  // the village's materials, made once per world: weathered stone, oak, daub, thatch, slate and shingle, leaded
  // glass, rusted iron, sacking, hay, standing water
  buildingMats() {
    if (this._bm) return this._bm;
    const M = this.mats || {};
    const st = stoneTextures(512, true), oak = woodTextures(256, [64, 46, 32]);
    const glassT = leadedGlassTextures(256), ironT = armorTextures('rusted', 256), sack = clothTextures([122, 102, 72], false, 128, 'sacking');
    const B = {
      stone: buildingMat(st, { key: 'stone', moss: 0.45, damp: 0.6 }),
      oak: buildingMat(oak, { key: 'oak', moss: 0.25, damp: 0.4, dampTop: 0.5 }),
      charred: M.charMat || buildingMat(woodTextures(256, [26, 20, 18]), { key: 'char' }),
      plaster: buildingMat(plasterTextures(512), { key: 'plaster', side: THREE.DoubleSide, moss: 0.2, damp: 0.5, dampTop: 3.0 }),
      thatch: buildingMat(thatchTextures(512), { key: 'thatch', normalScale: 1.6, moss: 0.4, damp: 0 }),
      slate: buildingMat(roofTextures('slate', 512), { key: 'slate', normalScale: 1.4, moss: 0.35, damp: 0 }),
      shingle: buildingMat(roofTextures('shingle', 512), { key: 'shingle', normalScale: 1.4, moss: 0.35, damp: 0 }),
      shingleBurnt: buildingMat(roofTextures('shingle', 512), { key: 'shingleB', color: 0x3a302a, damp: 0 }),
      glass: new THREE.MeshStandardMaterial({ map: glassT.map, normalMap: glassT.normalMap, roughnessMap: glassT.roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 1.5 }),
      iron: new THREE.MeshStandardMaterial({ map: ironT.map, normalMap: ironT.normalMap, roughnessMap: ironT.roughnessMap, metalnessMap: ironT.metalnessMap, metalness: 1, roughness: 1 }),
      sacking: new THREE.MeshStandardMaterial({ map: sack.map, normalMap: sack.normalMap, roughnessMap: sack.roughnessMap, roughness: 1, side: THREE.DoubleSide }),
      hay: buildingMat(thatchTextures(512), { key: 'hay', color: 0xd8c080, weather: false }),
      water: new THREE.MeshStandardMaterial({ color: 0x0a0d0e, roughness: 0.04, metalness: 0.1, envMapIntensity: 1.4 }),
      lamp: new THREE.MeshStandardMaterial({ color: 0x40301c, emissive: 0xff9a40, emissiveIntensity: 0.35, roughness: 0.3 }),
    };
    return (this._bm = B);
  }

  placeHouse(r, woodMat, charMat, brickMat, big, lot) {
    const x = lot.x, z = lot.z, w = lot.w, dpt = lot.d, yaw = lot.yaw;
    // set the house on its lowest corner; a stone footing takes up the slope
    const C = Math.cos(yaw), S = Math.sin(yaw);
    const toW = (lx, lz) => [x + lx * C + lz * S, z - lx * S + lz * C];
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const [px, pz] = toW((i / 4 - 0.5) * (w + 0.8), (j / 4 - 0.5) * (dpt + 0.8)); const h = this.heightAt(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const y = hi + 0.12;              // the floor sits just above the (levelled) ground
    const footing = y - lo + 0.9;     // and the footing reaches below the lowest
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
    const walls = [], timber = [], plaster = [], dark = [];
    const glass = [], iron = [], thatch = [], slate = [], cloth = [], hay = [], water = [], lamp = [], broken = [];
    walls.push(xf(new THREE.BoxGeometry(w + 0.7, footing, dpt + 0.7), [0, -footing / 2 + 0.12, 0]));
    const intact = big || r() < 0.4;   // some still stand to the eaves; barns are whole
    const roofKind = r() < 0.55 ? 'thatch' : r() < 0.6 ? 'slate' : 'shingle';
    const eave = 4.8;
    const wall = (len, cx, cz, rot, front) => {
      const segs = Math.max(3, Math.round(len / 1.15)); const sw = len / segs;
      const door = front ? Math.floor(segs / 2) : -1;
      // A burnt house's wall comes down in one or two breaches, its courses stepping down into each and back up,
      // never in isolated square notches: one height profile for the whole wall
      const prof = [];
      if (!intact) {
        const nb = r() < 0.3 ? 0 : r() < 0.7 ? 1 : 2, br = [];
        for (let b = 0; b < nb; b++) br.push({ c: r.range(0, segs - 1), hw: r.range(1.0, 2.4), d: r.range(1.3, 2.3) });
        for (let sg = 0; sg < segs; sg++) { let t = r.range(2.3, 2.6); for (const b of br) t = Math.min(t, 2.6 - b.d * smooth(clamp(1 - Math.abs(sg - b.c) / b.hw, 0, 1))); prof.push(Math.max(0.35, t)); }
      }
      const P0 = (gx, gy, gz) => { const c = Math.cos(rot), s2 = Math.sin(rot); return [cx + gx * c + gz * s2, gy, cz - gx * s2 + gz * c]; };
      // the upper storey: timber frame with plaster panels, on a standing house only
      const upper = (lx, sg, P) => {
          // jettied out over the street on the long walls of a standing house, its joists' ends showing under the
          // jetty; studs, a middle rail and a brace in each bay, daub panels between
          const fy = 2.6, fh = eave - fy, out = Math.sign(cz || cx) || 1, jt = rot === 0 ? 0.42 * out : 0;
          timber.push(xf(new THREE.BoxGeometry(sw + 0.04, 0.24, 0.3), P(lx, fy, 0.14 + jt), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw + 0.04, 0.2, 0.3), P(lx, eave, 0.14 + jt), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(0.18, fh, 0.3), P(lx - sw / 2 + 0.09, fy + fh / 2, 0.14 + jt), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw, 0.14, 0.26), P(lx, fy + fh * 0.5, 0.15 + jt), [0, rot, 0]));
          const diag = new THREE.BoxGeometry(0.14, Math.hypot(sw, fh) * 0.95, 0.28);
          timber.push(xf(diag, P(lx, fy + fh / 2, 0.14 + jt), [0, rot, (sg % 2 ? 1 : -1) * Math.atan2(sw, fh)]));
          plaster.push(xf(new THREE.BoxGeometry(sw + 0.02, fh, 0.2), P(lx, fy + fh / 2, 0.02 + jt), [0, rot, 0]));
          if (jt) { timber.push(xf(new THREE.BoxGeometry(0.16, 0.16, 0.7), P(lx, fy - 0.2, out * 0.3), [0, rot, 0])); timber.push(xf(new THREE.BoxGeometry(0.18, 0.5, 0.18), P(lx, fy - 0.42, out * 0.42), [0, rot, out * 0.6])); }
          // an upper window in alternate bays, leaded, with a sill
          if (sg % 2 === 0 && sg !== door) {
            glass.push(xf(new THREE.BoxGeometry(sw * 0.5, fh * 0.42, 0.06), P(lx, fy + fh * 0.48, 0.25 * out + jt), [0, rot, 0]));
            timber.push(xf(new THREE.BoxGeometry(sw * 0.62, 0.08, 0.36), P(lx, fy + fh * 0.25, 0.2 * out + jt), [0, rot, 0]));
            timber.push(xf(new THREE.BoxGeometry(0.05, fh * 0.42, 0.08), P(lx, fy + fh * 0.48, 0.27 * out + jt), [0, rot, 0]));
          }
      };
      for (let sg = 0; sg < segs; sg++) {
        const lx = -len / 2 + (sg + 0.5) * sw;
        const P = P0;
        const top = intact ? 2.6 : prof[sg];
        const ruin = !intact && top < 2.1;
        if (ruin) { const [rx0, , rz0] = P(lx, 0, 0); broken.push({ x: rx0, z: rz0, rot, top, sw }); }
        // a burnt house's front door: where the wall over it still stands, a charred lintel and the opening; where
        // it has come down, just the gap with the rubble in it
        if (sg === door && !intact && top < 2.45) {
          for (const sx of [-1, 1]) walls.push(xf(new THREE.BoxGeometry(0.22, Math.max(0.3, top * 0.8), 0.52), P(lx + sx * (sw / 2 - 0.11), Math.max(0.3, top * 0.8) / 2, 0), [0, rot, 0]));
          continue;
        }
        if (sg === door) { // doorway with a heavy lintel
          walls.push(xf(new THREE.BoxGeometry(sw, 0.5, 0.5), P(lx, 2.35, 0), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw + 0.3, 0.22, 0.56), P(lx, 2.1, 0), [0, rot, 0]));
          if (intact) upper(lx, sg, P);
          if (intact) dark.push(xf(new THREE.BoxGeometry(sw - 0.2, 2.0, 0.08), P(lx, 1.0, 0.0), [0, rot, 0]));
          if (intact) {
            const out = Math.sign(cz || cx) || 1, dw = sw - 0.25;
            timber.push(xf(new THREE.BoxGeometry(dw, 1.95, 0.07), P(lx, 1.0, 0.27 * out), [0, rot, 0]));
            for (const hy of [0.4, 1.0, 1.6]) iron.push(xf(new THREE.BoxGeometry(dw * 0.8, 0.05, 0.02), P(lx - dw * 0.08, hy, 0.315 * out), [0, rot, 0]));
            iron.push(xf(new THREE.TorusGeometry(0.06, 0.012, 6, 14), P(lx + dw * 0.3, 1.0, 0.33 * out), [0, rot, 0]));
            walls.push(xf(new THREE.BoxGeometry(sw + 0.2, 0.18, 0.6), P(lx, 0.0, 0.55 * out), [0, rot, 0]));   // the step
            iron.push(xf(new THREE.BoxGeometry(0.04, 0.04, 0.35), P(lx + sw * 0.62, 2.25, 0.4 * out), [0, rot, 0]));   // a lantern on its bracket
            lamp.push(xf(new THREE.BoxGeometry(0.16, 0.24, 0.16), P(lx + sw * 0.62, 2.05, 0.55 * out), [0, rot, 0]));
            iron.push(xf(new THREE.ConeGeometry(0.13, 0.12, 4), P(lx + sw * 0.62, 2.23, 0.55 * out), [0, rot + PI / 4, 0]));
            if (r() < 0.5) {   // a little porch roof over the door on two posts
              for (const px of [-1, 1]) timber.push(xf(new THREE.BoxGeometry(0.14, 2.45, 0.14), P(lx + px * (sw / 2 + 0.25), 1.22, 1.15 * out), [0, rot, 0]));
              (roofKind === 'thatch' ? thatch : slate).push(xf(new THREE.BoxGeometry(sw + 1.0, 0.12, 1.5), P(lx, 2.62, 0.75 * out), [out * 0.32, rot, 0]));
            }
            continue;
          }
          // the door itself, boarded, hanging open on one hinge (or gone)
          if (r() < 0.75) { const sw2 = sw - 0.25, open = r.range(0.5, 1.5); const hx = lx - sw2 / 2; const [dx, , dz] = P(hx + Math.cos(open) * sw2 / 2, 0, 0.28 + Math.sin(open) * sw2 / 2); timber.push(xf(new THREE.BoxGeometry(sw2, 1.95, 0.06), [dx, 1.0, dz], [0, rot - open, r.range(-0.04, 0.04)])); }
          continue;
        }
        const win = !ruin && sg % 2 === 1 && r() < 0.7;
        if (win) {
          walls.push(xf(new THREE.BoxGeometry(sw + 0.02, 1.0, 0.5), P(lx, 0.5, 0), [0, rot, 0]));
          walls.push(xf(new THREE.BoxGeometry(sw + 0.02, top - 2.0, 0.5), P(lx, 2.0 + (top - 2.0) / 2, 0), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw * 0.8, 0.12, 0.6), P(lx, 1.02, 0), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw * 0.9, 0.16, 0.58), P(lx, 1.95, 0), [0, rot, 0]));
          for (const sx of [-1, 1]) timber.push(xf(new THREE.BoxGeometry(0.08, 0.95, 0.56), P(lx + sx * sw * 0.34, 1.48, 0), [0, rot, 0]));
          if (intact) glass.push(xf(new THREE.BoxGeometry(sw * 0.62, 0.9, 0.08), P(lx, 1.48, 0), [0, rot, 0]));
          if (intact) { timber.push(xf(new THREE.BoxGeometry(0.06, 0.9, 0.14), P(lx, 1.48, 0), [0, rot, 0])); timber.push(xf(new THREE.BoxGeometry(sw * 0.62, 0.06, 0.14), P(lx, 1.62, 0), [0, rot, 0])); }
          // shutters: thrown open, one hanging by a hinge, one sometimes fallen
          for (const sx of [-1, 1]) {
            const fate = r(); if (fate < 0.2) continue;
            const hw = sw * 0.32, ang = fate < 0.4 ? 0.35 : 1.35;
            const [sx0, , sz0] = P(lx + sx * (sw * 0.31 + Math.cos(ang) * hw / 2), 0, 0.3 + Math.sin(ang) * hw / 2);
            timber.push(xf(new THREE.BoxGeometry(hw, 0.9, 0.04), [sx0, fate < 0.4 ? 1.35 : 1.48, sz0], [0, rot - sx * ang, fate < 0.4 ? sx * 0.35 : 0]));
          }
        } else if (intact) {
          walls.push(xf(new THREE.BoxGeometry(sw + 0.02, top, 0.52), P(lx, top / 2, 0), [0, rot, 0]));
        } else {
          // a burnt wall: each half of the bay meets its neighbour's height, so the top steps down into a breach
          // course by course; loose stones lie on the broken top
          const hl = (prof[Math.max(0, sg - 1)] + top) / 2, hr = (prof[Math.min(segs - 1, sg + 1)] + top) / 2;
          for (const [hx, hh] of [[-1, hl * 0.5 + top * 0.5], [1, hr * 0.5 + top * 0.5]]) walls.push(xf(new THREE.BoxGeometry(sw / 2 + 0.02, hh, 0.52), P(lx + hx * sw / 4, hh / 2, 0), [0, rot, 0]));
          const nst = ruin ? 3 : 1;
          for (let q = 0; q < nst; q++) { const qx = r.range(-sw / 2.4, sw / 2.4), hh = qx < 0 ? hl * 0.5 + top * 0.5 : hr * 0.5 + top * 0.5, sz = r.range(0.22, 0.42); walls.push(xf(lumpy(icoSmooth(1), 0.3, 700 + sg * 7 + q), P(lx + qx, hh + sz * 0.15, r.range(-0.1, 0.1)), [r() * 3, rot, r() * 3], [sz, sz * 0.6, sz * 0.8])); }
          // the charred ends of the floor joists and studs that stood on the wall, sticking up out of it
          if (!ruin && r() < 0.6) { const ht = r.range(0.25, 1.3); timber.push(xf(new THREE.BoxGeometry(0.16, ht, 0.18), P(lx + r.range(-sw / 3, sw / 3), top + ht / 2 - 0.05, 0.05), [r.range(-0.15, 0.15), rot, r.range(-0.25, 0.25)])); }
          if (r() < 0.35) timber.push(xf(new THREE.BoxGeometry(0.16, 0.16, r.range(0.6, 1.1)), P(lx, Math.min(hl, hr) - 0.12, 0.25), [r.range(-0.2, 0.2), rot, 0]));   // a joist end through the wall
          // where a window was, its charred head-beam still spans the burnt wall
          if (!ruin && sg % 2 === 1 && r() < 0.5) timber.push(xf(new THREE.BoxGeometry(sw * 0.85, 0.16, 0.56), P(lx, Math.min(hl, hr) - 0.35, 0), [0, rot, 0]));
          // a burning house burns at its wall tops and window heads too
          if (!ruin && r() < 0.22) { const [wx0, , wz0] = P(lx, 0, 0); const [fx, fz] = toW(wx0, wz0); (this.wallFires || (this.wallFires = [])).push({ x: fx, y: y + Math.min(hl, hr), z: fz, s: r.range(0.45, 0.75), yaw: yaw + rot, wall: true }); }
        }
        if (intact && top >= 2.5 && sg !== door) upper(lx, sg, P);
        const C2 = Math.cos(yaw), S2 = Math.sin(yaw); const [wx, , wz] = P(lx, 0, 0);
        this.addCollider(x + wx * C2 + wz * S2, z - wx * S2 + wz * C2, 0.6);
      }
    };
    wall(w, 0, dpt / 2, 0, true); wall(w, 0, -dpt / 2, 0, false); wall(dpt, w / 2, 0, PI / 2, false); wall(dpt, -w / 2, 0, PI / 2, false);
    // quoins: dressed stones up each corner
    for (const [cx, cz] of [[-w / 2, -dpt / 2], [w / 2, -dpt / 2], [-w / 2, dpt / 2], [w / 2, dpt / 2]]) {
      const top = intact ? eave : r.range(2.6, 3.1);   // the corners stand longest: never lower than the walls they close
      for (let k = 0; k < top / 0.45; k++) walls.push(xf(new THREE.BoxGeometry(0.66 + (k % 2) * 0.12, 0.42, 0.66 - (k % 2) * 0.12), [cx, 0.21 + k * 0.45, cz]));
    }
    // gable ends and roof timbers
    if (intact) {
      for (const sz of [-1, 1]) { const gb = new THREE.BufferGeometry(); const hw = w / 2;
        const gz = sz * (dpt / 2 + 0.44); gb.setAttribute('position', new THREE.Float32BufferAttribute([-hw, eave, gz, hw, eave, gz, 0, eave + 2.6, gz], 3)); gb.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 0.5], 2)); gb.setIndex([0, 1, 2]); gb.computeVertexNormals(); plaster.push(gb); }
      timber.push(xf(new THREE.BoxGeometry(0.24, 0.24, dpt + 1.4), [0, eave + 2.6, 0]));
      // where the jetty runs out past the side walls, the corners of the upper storey are closed with a panel and a post
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        plaster.push(xf(new THREE.BoxGeometry(0.24, eave - 2.6, 0.62), [sx * w / 2, (eave + 2.6) / 2, sz * (dpt / 2 + 0.27)]));
        timber.push(xf(new THREE.BoxGeometry(0.22, eave - 2.5, 0.22), [sx * w / 2, (eave + 2.6) / 2, sz * (dpt / 2 + 0.5)]));
      }
    }
    const rafters = intact ? 7 : 5, rise = 2.6, slope = Math.atan2(rise, w / 2), rlen = Math.hypot(w / 2, rise) + 0.5;
    const roofs = [];
    for (let k = 0; k < rafters; k++) {
      const lz = -dpt / 2 + (k + 0.5) * dpt / rafters;
      for (const sx of [-1, 1]) {
        if (intact) {
          // from the wall plate up to the ridge
          if (r() < 0.2) continue;
          timber.push(xf(new THREE.BoxGeometry(rlen, 0.16, 0.16), [sx * w / 4, eave + rise / 2 + 0.05, lz], [0, 0, -sx * slope]));
        } else if (r() < 0.35) {
          // fallen in: one end on the floor, the other against the broken wall
          const lean = r.range(0.5, 0.9); const L2 = 2.2 / Math.sin(lean);
          timber.push(xf(new THREE.BoxGeometry(L2, 0.16, 0.16), [sx * (w / 2 - Math.cos(lean) * L2 / 2 - 0.3), 1.1 + 0.05, lz + r.range(-0.3, 0.3)], [r.range(-0.1, 0.1), r.range(-0.2, 0.2), sx * lean]));
        }
      }
    }
    // a standing house is roofed whole: deep thatch with a ridge roll, or slates/shingles with a wooden gutter
    if (intact && roofKind === 'thatch') {
      for (const sx of [-1, 1]) thatch.push(xf(new THREE.BoxGeometry(rlen + 0.9, 0.42, dpt + 1.9), [sx * (w / 4 + 0.05), eave + rise / 2 + 0.28, 0], [0, 0, -sx * slope]));
      thatch.push(xf(new THREE.CylinderGeometry(0.3, 0.3, dpt + 2.0, 10), [0, eave + rise + 0.42, 0], [PI / 2, 0, 0]));
      for (const sz of [-1, 1]) thatch.push(xf(new THREE.BoxGeometry(w + 0.8, 0.3, 0.5), [0, eave + 0.05, sz * (dpt / 2 + 0.5)], [0, 0, 0], [1, 1, 1]));
    } else if (intact) {
      for (const sx of [-1, 1]) {
        slate.push(xf(new THREE.BoxGeometry(rlen + 0.5, 0.1, dpt + 1.7), [sx * (w / 4 + 0.05), eave + rise / 2 + 0.17, 0], [0, 0, -sx * slope]));
        timber.push(xf(new THREE.CylinderGeometry(0.09, 0.09, dpt + 1.7, 8, 1, true, 0, PI), [sx * (w / 2 + 0.45), eave - 0.08, 0], [PI / 2, 0, sx < 0 ? 0 : PI]));   // the gutter
      }
      slate.push(xf(new THREE.BoxGeometry(0.3, 0.18, dpt + 1.8), [0, eave + rise + 0.18, 0]));   // ridge tiles
    }
    // a burnt house's roof has come down: charred panels of it slid in off the wall tops and lying against them,
    // and shingles strewn over the floor and out round the walls
    if (!intact) {
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) {
        if (r() < 0.35) continue;
        const lz = -dpt / 2 + (k + 0.5) * dpt / 5 + r.range(-0.3, 0.3), top = r.range(1.0, 2.0), len = r.range(2.0, 3.4);
        const lean = Math.asin(clamp((top - 0.08) / len, 0.15, 0.95));
        roofs.push(xf(new THREE.BoxGeometry(len, 0.08, dpt / 5 + r.range(-0.2, 0.3)), [sx * (w / 2 - 0.3 - Math.cos(lean) * len / 2), top / 2 + 0.06, lz], [r.range(-0.08, 0.08), r.range(-0.15, 0.15), sx * lean]));
      }
      for (let k = 0; k < 40; k++) {
        const out = r() < 0.4, lx = out ? (r() < 0.5 ? -1 : 1) * (w / 2 + r.range(0.4, 1.8)) : r.range(-w / 2 + 0.4, w / 2 - 0.4), lz = r.range(-dpt / 2 - (out ? 1.5 : -0.4), dpt / 2 + (out ? 1.5 : -0.4));
        const [px, pz] = toW(lx, lz), gy0 = out ? this.heightAt(px, pz) - y : 0;
        roofs.push(xf(new THREE.BoxGeometry(r.range(0.18, 0.3), 0.025, r.range(0.12, 0.22)), [lx, gy0 + 0.02 + r() * 0.04, lz], [r.range(-0.3, 0.3), r() * TAU, r.range(-0.3, 0.3)]));
      }
    }
    // rubble: stone fallen from each broken stretch of wall, heaped at its foot inside and out, the heap highest
    // under the break
    for (const b of broken) {
      for (let k = 0; k < 9; k++) {
        const side = k % 2 ? 1 : -1, c = Math.cos(b.rot), s2 = Math.sin(b.rot);
        const along = r.range(-b.sw * 0.7, b.sw * 0.7), off = side * r.range(0.35, 1.3), lx = b.x + along * c + off * s2, lz = b.z - along * s2 + off * c;
        const [px, pz] = toW(lx, lz), inside = Math.abs(lx) < w / 2 && Math.abs(lz) < dpt / 2, gy0 = inside ? 0.1 : this.heightAt(px, pz) - y;
        const sz = r.range(0.16, 0.36) * (1.3 - Math.abs(off) * 0.4), st = lumpy(icoSmooth(1), 0.32, 900 + k + Math.floor(b.x * 10));
        walls.push(xf(st, [lx, gy0 + sz * 0.3, lz], [r() * 3, r() * 3, r() * 3], [sz, sz * r.range(0.55, 0.85), sz * r.range(0.8, 1.2)]));
      }
    }
    // chimney stack at one end
    if (r() < 0.7) { const cx = (r() < 0.5 ? -1 : 1) * (w / 2 - 0.5), ch = intact ? 8 : r.range(4, 7); walls.push(xf(new THREE.BoxGeometry(1.1, ch, 0.9), [cx, ch / 2, 0])); walls.push(xf(new THREE.BoxGeometry(1.3, 0.25, 1.1), [cx, ch, 0])); if (intact) { slate.push(xf(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 10), [cx, ch + 0.4, 0])); } }
    // fallen beams and rubble about the floor
    for (let k = 0; k < 4; k++) timber.push(xf(new THREE.BoxGeometry(0.16, 0.16, r.range(2, 4)), [r.range(-w / 3, w / 3), 0.2, r.range(-dpt / 3, dpt / 3)], [r.range(-0.08, 0.08), r() * TAU, r.range(-0.08, 0.08)]));
    for (let k = 0; k < 14; k++) { const sz = r.range(0.2, 0.55), lx = r.range(-w / 2 - 1.2, w / 2 + 1.2), lz = r.range(-dpt / 2 - 1.2, dpt / 2 + 1.2); const inside = Math.abs(lx) < w / 2 + 0.35 && Math.abs(lz) < dpt / 2 + 0.35; const [px, pz] = toW(lx, lz); walls.push(xf(new THREE.BoxGeometry(sz, sz * 0.6, sz * 0.8), [lx, sz * 0.2 + (inside ? 0 : this.heightAt(px, pz) - y), lz], [r() * 0.4, r() * 3, r() * 0.4])); }
    // the yard: barrels, crates, a woodpile against the wall, a cart, a fence
    this.dressYard(r, w, dpt, walls, timber, intact, (lx, lz) => { const [px, pz] = toW(lx, lz); return this.heightAt(px, pz) - y; }, { iron, cloth, hay, water, roofKind, toW, y });
    // a burnt house still burning: a fire in the wreck on its floor; or its timbers heaped and smouldering
    if (!intact && !big) {
      const lx = r.range(-w / 4, w / 4), lz = r.range(-dpt / 4, dpt / 4), [px, pz] = toW(lx, lz);
      ((r() < 0.6 ? this.fireSpots : this.charSpots) || []).push({ x: px, y: y + 0.12, z: pz, s: r.range(0.8, 1.15), yaw: yaw + r() * TAU });
    }
    const B = this.buildingMats();
    const voidMat = this.voidMat || (this.voidMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 }));
    for (const [list, m, tile] of [[walls, B.stone, 1.6], [timber, intact ? B.oak : B.charred, 1.1], [plaster, B.plaster, 2.0], [dark, voidMat, 1], [roofs, B.shingleBurnt, 2.2],
      [glass, B.glass, 0.8], [iron, B.iron, 0.6], [thatch, B.thatch, 2.4], [slate, roofKind === 'shingle' ? B.shingle : B.slate, 2.0], [cloth, B.sacking, 1.0], [hay, B.hay, 1.6], [water, B.water, 1], [lamp, B.lamp, 1]]) {
      if (!list.length) continue; const geo = boxUV(merge(list), tile); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = m !== B.lamp && m !== B.water; mesh.receiveShadow = true; g.add(mesh);
    }
    this.group.add(g);
    (this.ruinSpots || (this.ruinSpots = [])).push({ x, z });
  }

  dressYard(r, w, dpt, walls, timber, intact, gy, X = {}) {
    // everything out in the yard stands on the yard's own ground (gy: local ground height), not the house floor
    const T = { push: (g) => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(0, gy(c.x, c.z), 0); timber.push(g); } };
    const along = (side) => { const ox = side % 2 ? (side === 1 ? 1 : -1) * (w / 2 + 0.75) : r.range(-w / 2 + 1, w / 2 - 1); const oz = side % 2 ? r.range(-dpt / 2 + 1, dpt / 2 - 1) : (side === 0 ? 1 : -1) * (dpt / 2 + 0.75); return [ox, oz]; };
    for (let k = 0; k < 3; k++) {   // barrels, standing or rolled over
      const [ox, oz] = along(Math.floor(r() * 4)); const over = r() < 0.4;
      const b = new THREE.CylinderGeometry(0.3, 0.3, 0.85, 10); const hoop = new THREE.CylinderGeometry(0.335, 0.335, 0.62, 10, 1, true);
      const bg = merge([b, hoop]);
      T.push(xf(bg, [ox, over ? 0.3 : 0.43, oz], over ? [PI / 2, r() * TAU, 0] : [0, r() * TAU, 0]));
    }
    for (let k = 0; k < 2; k++) { const [ox, oz] = along(Math.floor(r() * 4)); const sz = r.range(0.5, 0.8); T.push(xf(new THREE.BoxGeometry(sz, sz * 0.8, sz), [ox, sz * 0.4, oz], [0, r() * TAU, 0])); if (r() < 0.5) T.push(xf(new THREE.BoxGeometry(sz * 0.8, sz * 0.6, sz * 0.8), [ox + 0.05, sz * 0.8 + sz * 0.3, oz], [0, r() * TAU, 0])); }
    // a woodpile under the eaves of one wall
    { const sx = r() < 0.5 ? -1 : 1; for (let row = 0; row < 3; row++) for (let k = 0; k < 6 - row; k++) T.push(xf(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 6), [sx * (w / 2 + 0.45), 0.09 + row * 0.16, -dpt / 4 + (k + row * 0.5) * 0.19], [PI / 2, 0, PI / 2])); }
    // a cart, tipped, its wheel off
    if (r() < 0.45) {
      const cx = r.range(-w / 2, w / 2), cz = (r() < 0.5 ? -1 : 1) * (dpt / 2 + 2.6), tilt = r.range(0.1, 0.3);
      T.push(xf(new THREE.BoxGeometry(1.4, 0.12, 2.4), [cx, 0.55, cz], [0, 0.3, tilt])); for (const sx of [-1, 1]) T.push(xf(new THREE.BoxGeometry(0.06, 0.4, 2.4), [cx + sx * 0.68, 0.78 + sx * tilt * 0.6, cz], [0, 0.3, tilt]));
      T.push(xf(new THREE.TorusGeometry(0.5, 0.06, 5, 12), [cx + 0.8, 0.5, cz + 0.9], [0, 0.3 + PI / 2, 0])); T.push(xf(new THREE.TorusGeometry(0.5, 0.06, 5, 12), [cx - 1.6, 0.07, cz - 0.6], [PI / 2, 0, 0]));
      T.push(xf(new THREE.BoxGeometry(0.08, 0.08, 2.0), [cx, 0.3, cz + 2.0], [0.25, 0.3, 0]));
    }
    const Y = (list) => ({ push: (g) => { g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(0, gy(c.x, c.z), 0); list.push(g); } });
    const I = Y(X.iron || timber), Cl = Y(X.cloth || timber), Hy = Y(X.hay || timber), Wt = Y(X.water || timber), St = Y(walls);
    // sacks of grain or meal slumped against the wall
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { const [ox, oz] = along(Math.floor(r() * 4)); const sk = new THREE.SphereGeometry(0.3, 10, 8); sk.scale(1, 1.25, 0.8); const P2 = sk.attributes.position; for (let i = 0; i < P2.count; i++) { const yy = P2.getY(i); if (yy < -0.2) P2.setY(i, -0.2 - (yy + 0.2) * 0.2); } sk.computeVertexNormals(); Cl.push(xf(sk, [ox + r.range(-0.3, 0.3), 0.26, oz], [r.range(-0.2, 0.2), r() * TAU, r.range(-0.15, 0.15)])); }
    // a well: a stone drum, a winch on two posts, the rope and the bucket
    if (r() < 0.28) {
      const wx = r.range(-w / 2, w / 2), wz = (r() < 0.5 ? -1 : 1) * (dpt / 2 + 3.2);
      St.push(xf(new THREE.CylinderGeometry(0.85, 0.9, 0.85, 18, 1, true), [wx, 0.42, wz])); St.push(xf(new THREE.TorusGeometry(0.86, 0.1, 6, 20), [wx, 0.85, wz], [PI / 2, 0, 0]));
      if (X.toW) { const [px, pz] = X.toW(wx, wz); (this.wells || (this.wells = [])).push({ x: px, z: pz, y: X.y + gy(wx, wz), r: 0.76, top: 0.85 }); }
      for (const sx of [-1, 1]) T.push(xf(new THREE.BoxGeometry(0.14, 1.9, 0.14), [wx + sx * 0.92, 0.95, wz]));
      T.push(xf(new THREE.CylinderGeometry(0.09, 0.09, 1.9, 8), [wx, 1.6, wz], [0, 0, PI / 2])); T.push(xf(new THREE.BoxGeometry(0.05, 0.3, 0.05), [wx + 1.05, 1.45, wz]));
      I.push(xf(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), [wx, 1.15, wz])); T.push(xf(new THREE.CylinderGeometry(0.15, 0.12, 0.25, 10), [wx, 0.62, wz]));
      const roofG = new THREE.BoxGeometry(2.2, 0.06, 0.8); T.push(xf(roofG, [wx, 2.05, wz + 0.3], [0.5, 0, 0])); T.push(xf(roofG.clone(), [wx, 2.05, wz - 0.3], [-0.5, 0, 0]));
    }
    // a trough of standing water
    if (r() < 0.45) { const [ox, oz] = along(Math.floor(r() * 4)); const tx2 = ox * 1.15, tz2 = oz * 1.15; for (const [a, b, c2, d] of [[1.6, 0.5, 0.06, [0, 0.25, 0.27]], [1.6, 0.5, 0.06, [0, 0.25, -0.27]], [0.06, 0.5, 0.6, [0.8, 0.25, 0]], [0.06, 0.5, 0.6, [-0.8, 0.25, 0]], [1.6, 0.06, 0.6, [0, 0.03, 0]]]) T.push(xf(new THREE.BoxGeometry(a, b, c2), [tx2 + d[0], d[1], tz2 + d[2]])); Wt.push(xf(new THREE.PlaneGeometry(1.5, 0.5), [tx2, 0.4, tz2], [-PI / 2, 0, 0])); }
    // a hay heap, or a rick
    if (r() < 0.4) { const [ox, oz] = along(Math.floor(r() * 4)); const hg = new THREE.SphereGeometry(1, 14, 10, 0, TAU, 0, PI / 2); hg.scale(1.1, 0.9, 0.9); Hy.push(xf(hg, [ox * 1.3, -0.05, oz * 1.3], [0, r() * TAU, 0])); }
    // tools left leaning on the wall: a pitchfork, a scythe
    if (r() < 0.6) {
      const sx = r() < 0.5 ? -1 : 1, lz = r.range(-dpt / 3, dpt / 3);
      T.push(xf(new THREE.CylinderGeometry(0.02, 0.022, 1.6, 6), [sx * (w / 2 + 0.38), 0.78, lz], [0, 0, sx * 0.18]));
      for (const t2 of [-0.06, 0, 0.06]) I.push(xf(new THREE.CylinderGeometry(0.008, 0.004, 0.32, 4), [sx * (w / 2 + 0.25) + t2 * 0, 1.66, lz + t2], [0, 0, sx * 0.18]));
      if (r() < 0.5) { T.push(xf(new THREE.CylinderGeometry(0.02, 0.022, 1.5, 6), [sx * (w / 2 + 0.36), 0.75, lz + 0.7], [0.15, 0, sx * 0.15])); I.push(xf(new THREE.BoxGeometry(0.75, 0.04, 0.012), [sx * (w / 2 + 0.3) - sx * 0.3, 1.45, lz + 0.8], [0, 0, sx * 0.4])); }
    }
    // a washing line between two posts, the sheets still pegged out
    if (intact && r() < 0.45) {
      const lz = (r() < 0.5 ? -1 : 1) * (dpt / 2 + 2.2), x0 = -w / 2 + 0.5, x1 = w / 2 - 0.5;
      for (const xx of [x0, x1]) T.push(xf(new THREE.BoxGeometry(0.1, 2.1, 0.1), [xx, 1.05, lz]));
      T.push(xf(new THREE.CylinderGeometry(0.008, 0.008, x1 - x0, 4), [(x0 + x1) / 2, 1.95, lz], [0, 0, PI / 2]));
      for (let k = 0; k < 3; k++) { const sh = new THREE.PlaneGeometry(0.9, 1.1, 4, 4); const P3 = sh.attributes.position; for (let i = 0; i < P3.count; i++) P3.setZ(i, Math.sin(P3.getX(i) * 4 + k) * 0.05 + (P3.getY(i) < 0 ? -P3.getY(i) * 0.08 : 0)); sh.computeVertexNormals(); Cl.push(xf(sh, [x0 + 0.8 + k * 1.1, 1.38, lz], [0, 0, r.range(-0.05, 0.05)])); }
    }
    // a wattle fence round part of the yard
    if (r() < 0.6) { const sz = -1; for (let k = 0; k < 8; k++) { if (r() < 0.2) continue; const fx = -w / 2 - 1.5 + k * (w + 3) / 7; T.push(xf(new THREE.BoxGeometry(0.08, 1.0, 0.08), [fx, 0.45, sz * (dpt / 2 + 4)])); if (k < 7 && r() > 0.25) T.push(xf(new THREE.BoxGeometry((w + 3) / 7, 0.55, 0.05), [fx + (w + 3) / 14, 0.5, sz * (dpt / 2 + 4)], [0, 0, r.range(-0.08, 0.08)])); } }
  }

  placeChurch(r, brickMat, charMat) {
    // the church of Saint Aldric beside the second altar, with its bell tower
    const CL = this.churchLot; const x = CL.x, z = CL.z, yaw = CL.yaw;
    const W = 9, L = 20, Hh = 7;
    const C0 = Math.cos(yaw), S0 = Math.sin(yaw);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= 5; i++) for (let j = 0; j <= 8; j++) { const lx = (i / 5 - 0.5) * (W + 1.6), lz = -L / 2 - 0.8 + (j / 8) * (L + 6); const h = this.heightAt(x + lx * C0 + lz * S0, z - lx * S0 + lz * C0); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const y = hi + 0.2;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
    const parts = [];
    const add = (geo) => parts.push(geo);
    const foot = y - lo + 1.4;
    add(xf(new THREE.BoxGeometry(W + 1.4, foot, L + 1.4), [0, -foot / 2 + 0.15, 0]));
    add(xf(new THREE.BoxGeometry(5.4, foot, 5.4), [0, -foot / 2 + 0.15, L / 2 + 2.2]));
    for (const s2 of [-1, 1]) for (let k = 0; k < 6; k++) { add(xf(new THREE.BoxGeometry(0.9, Hh * 0.8, 1.2), [s2 * (W / 2 + 0.6), Hh * 0.4, -L / 2 + 1.5 + k * 3.4])); add(xf(new THREE.BoxGeometry(0.9, 1.4, 1.2), [s2 * (W / 2 + 0.35), Hh * 0.8 + 0.3, -L / 2 + 1.5 + k * 3.4], [0, 0, s2 * 0.5])); }
    // the nave walls, broken in places, with tall pointed windows between the buttresses
    const dark = [];
    for (const s of [-1, 1]) for (let k = 0; k < 10; k++) {
      const zc = -L / 2 + 1 + k * 2, breach = k === 4 && s > 0, broken = breach || r() < 0.22;
      if (broken) {
        // a broken bay: the masonry steps down from each neighbour into the break, loose blocks on the ragged
        // top, and the fallen stone heaped on both sides of the wall's foot
        const h = breach ? r.range(0.5, 0.9) : r.range(2.2, 4);
        for (const [dz, hh] of [[-0.67, h * 0.35 + Hh * 0.65], [0, h], [0.67, h * 0.35 + Hh * 0.65]]) add(xf(new THREE.BoxGeometry(0.7, hh, 0.68), [s * W / 2, hh / 2, zc + dz]));
        for (let q = 0; q < 4; q++) { const sz = r.range(0.25, 0.45), dz = r.range(-0.9, 0.9), hh = Math.abs(dz) > 0.33 ? h * 0.35 + Hh * 0.65 : h; add(xf(lumpy(icoSmooth(1), 0.3, 1200 + k * 11 + q + (s > 0 ? 50 : 0)), [s * W / 2 + r.range(-0.15, 0.15), hh + sz * 0.15, zc + dz], [r() * 3, r() * 3, r() * 3], [sz, sz * 0.6, sz * 0.8])); }
        for (let q = 0; q < (breach ? 16 : 9); q++) { const sz = r.range(0.2, 0.5), side = q % 2 ? 1 : -1, off = side * r.range(0.4, breach ? 2.2 : 1.4); const rx2 = s * (W / 2 + off), rz2 = zc + r.range(-1.2, 1.2), gy2 = off > 0.6 ? Math.min(0, this.heightAt(x + rx2 * C0 + rz2 * S0, z - rx2 * S0 + rz2 * C0) - y) : 0; add(xf(lumpy(icoSmooth(1), 0.32, 1300 + k * 17 + q + (s > 0 ? 70 : 0)), [rx2, gy2 + sz * 0.25, rz2], [r() * 3, r() * 3, r() * 3], [sz, sz * 0.6, sz])); }
        continue;
      }
      if (k % 2 === 1) {
        add(xf(new THREE.BoxGeometry(0.7, 2.6, 2.0), [s * W / 2, 1.3, zc]));                          // under the sill
        add(xf(new THREE.BoxGeometry(0.7, Hh - 5.6, 2.0), [s * W / 2, (Hh + 5.6) / 2, zc]));           // over the arch
        for (const e of [-1, 1]) { add(xf(new THREE.BoxGeometry(0.7, 3.0, 0.6), [s * W / 2, 4.1, zc + e * 0.7])); add(xf(new THREE.BoxGeometry(0.72, 0.9, 0.22), [s * W / 2, 5.15, zc + e * 0.27], [e * 0.62, 0, 0])); }   // jambs and the pointed head
        add(xf(new THREE.BoxGeometry(0.9, 0.14, 1.0), [s * (W / 2 + 0.1), 2.62, zc]));                 // the sill
        for (let m = 0; m < 3; m++) dark.push(xf(new THREE.BoxGeometry(0.04, 0.03, 0.8), [s * W / 2, 3.2 + m * 0.75, zc + (r() - 0.5) * 0.1], [0.2 * (r() - 0.5), 0, 0]));   // what is left of the leading
      } else add(xf(new THREE.BoxGeometry(0.7, Hh, 2.0), [s * W / 2, Hh / 2, zc]));
    }
    // the east wall and its great window
    add(xf(new THREE.BoxGeometry(W, 2.4, 0.7), [0, 1.2, -L / 2])); add(xf(new THREE.BoxGeometry(W, Hh - 6.4, 0.7), [0, (Hh + 6.4) / 2, -L / 2]));
    for (const e of [-1, 1]) { add(xf(new THREE.BoxGeometry((W - 1.8) / 2, 4.0, 0.7), [e * (W / 4 + 0.45), 4.4, -L / 2])); add(xf(new THREE.BoxGeometry(0.8, 1.2, 0.72), [e * 0.42, 5.9, -L / 2], [0, 0, -e * 0.6])); }
    add(xf(new THREE.BoxGeometry(0.16, 3.6, 0.3), [0, 4.3, -L / 2]));   // the mullion
    // west front with doorway, and the bell tower
    add(xf(new THREE.BoxGeometry(3, Hh, 0.7), [-3, Hh / 2, L / 2])); add(xf(new THREE.BoxGeometry(3, Hh, 0.7), [3, Hh / 2, L / 2])); add(xf(new THREE.BoxGeometry(3, 2.5, 0.7), [0, Hh - 1.25, L / 2]));
    // the west tower: the door in its foot, slit windows up the shaft, an open belfry with the bell hanging in it, and a spire
    const TZ = L / 2 + 2.7, TW = 5.4, TT = 0.8, SH = 14, BH = 5;
    const twall = (face, y0, y1, gaps) => {   // one face of the tower between heights, with openings [x0, x1, ya, yb]
      const along = (u, v, w2, h2, yc) => face === 'w' ? xf(new THREE.BoxGeometry(w2, h2, TT), [u, yc, TZ + TW / 2 - TT / 2]) : face === 'n' ? xf(new THREE.BoxGeometry(TT, h2, w2), [-TW / 2 + TT / 2, yc, TZ + u]) : face === 's' ? xf(new THREE.BoxGeometry(TT, h2, w2), [TW / 2 - TT / 2, yc, TZ + u]) : xf(new THREE.BoxGeometry(w2, h2, TT), [u, yc, TZ - TW / 2 + TT / 2]);
      if (!gaps.length) { add(along(0, 0, TW, y1 - y0, (y0 + y1) / 2)); return; }
      const [x0, x1, ya, yb] = gaps[0];
      add(along((-TW / 2 + x0) / 2, 0, x0 + TW / 2, y1 - y0, (y0 + y1) / 2)); add(along((x1 + TW / 2) / 2, 0, TW / 2 - x1, y1 - y0, (y0 + y1) / 2));
      if (ya > y0) add(along((x0 + x1) / 2, 0, x1 - x0, ya - y0, (y0 + ya) / 2)); if (yb < y1) add(along((x0 + x1) / 2, 0, x1 - x0, y1 - yb, (yb + y1) / 2));
    };
    twall('w', 0, SH, [[-0.85, 0.85, 0, 3.4]]); twall('n', 0, SH, []); twall('s', 0, SH, []); twall('e', 3.6, SH, []);
    for (const [fx, fz, rot] of [[0, TZ + TW / 2 + 0.01, 0], [-TW / 2 - 0.01, TZ, PI / 2], [TW / 2 + 0.01, TZ, PI / 2]]) for (const yy of [7.2, 10.6]) dark.push(xf(new THREE.BoxGeometry(0.34, 1.7, 0.06), [fx, yy, fz], [0, rot, 0]));   // slit windows
    add(xf(new THREE.BoxGeometry(2.2, 0.35, 0.3), [0, 3.55, TZ + TW / 2 + 0.05]));   // the hood-mould over the door
    for (const yy of [7, SH]) add(xf(new THREE.BoxGeometry(TW + 0.3, 0.28, TW + 0.3), [0, yy, TZ]));   // string courses
    // the belfry: corner piers and a mullion on each face, open between them
    for (const cx2 of [-1, 1]) for (const cz2 of [-1, 1]) add(xf(new THREE.BoxGeometry(1.1, BH, 1.1), [cx2 * (TW / 2 - 0.55), SH + BH / 2, TZ + cz2 * (TW / 2 - 0.55)]));
    for (const [mx, mz, w2, d2] of [[0, TZ + TW / 2 - 0.4, 0.4, 0.8], [0, TZ - TW / 2 + 0.4, 0.4, 0.8], [TW / 2 - 0.4, TZ, 0.8, 0.4], [-TW / 2 + 0.4, TZ, 0.8, 0.4]]) {
      add(xf(new THREE.BoxGeometry(w2, BH - 1.2, d2), [mx, SH + (BH - 1.2) / 2, mz]));
      add(xf(new THREE.BoxGeometry(mx === 0 ? TW : 0.8, 1.2, mx === 0 ? 0.8 : TW), [mx, SH + BH - 0.6, mz]));   // the heads of the openings
    }
    add(xf(new THREE.BoxGeometry(TW + 0.5, 0.4, TW + 0.5), [0, SH + BH + 0.2, TZ]));   // cornice
    add(xf(new THREE.ConeGeometry(TW * 0.62, 10, 8), [0, SH + BH + 5.4, TZ], [0, PI / 8, 0]));   // the spire
    // before the west door: the village well under its little roof, and a preaching cross on its steps
    const gyC = (lx, lz) => this.heightAt(x + lx * C0 + lz * S0, z - lx * S0 + lz * C0) - y;
    { const wx = -6, wz = L / 2 + 9, wy = gyC(wx, wz);
      parts.push(xf(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 18, 1, true), [wx, wy + 0.45, wz]), xf(new THREE.TorusGeometry(0.98, 0.13, 6, 20), [wx, wy + 0.9, wz], [PI / 2, 0, 0]));
      parts.push(xf(new THREE.CylinderGeometry(1.15, 1.2, 0.3, 18, 1, true), [wx, wy - 0.1, wz]), xf(new THREE.RingGeometry(1.0, 1.16, 18), [wx, wy + 0.05, wz], [-PI / 2, 0, 0]));
      (this.wells || (this.wells = [])).push({ x: x + wx * C0 + wz * S0, z: z - wx * S0 + wz * C0, y: y + wy, r: 0.9, top: 0.9 });
      const cx = 6, cz = L / 2 + 10, cy = gyC(cx, cz);
      for (let k = 0; k < 3; k++) parts.push(xf(new THREE.BoxGeometry(2.4 - k * 0.6, 0.3, 2.4 - k * 0.6), [cx, cy + 0.15 + k * 0.3 - 0.15, cz]));
      parts.push(xf(new THREE.BoxGeometry(0.3, 3.2, 0.3), [cx, cy + 2.35, cz]), xf(new THREE.BoxGeometry(1.3, 0.28, 0.28), [cx, cy + 3.2, cz]));
      this.addCollider(x + wx * C0 + wz * S0, z - wx * S0 + wz * C0, 1.2); this.addCollider(x + cx * C0 + cz * S0, z - cx * S0 + cz * C0, 1.0);
      this.wellTop = [wx, wy, wz]; }
    const m = new THREE.Mesh(boxUV(merge(parts), 1.6), this.buildingMats().stone); m.castShadow = m.receiveShadow = true; g.add(m);
    const voidMat = this.voidMat || (this.voidMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 }));
    if (dark.length) g.add(new THREE.Mesh(merge(dark), voidMat));
    // the bell: bronze, hung from its headstock on a beam across the belfry; it swings when it rings
    { const bronze = new THREE.MeshStandardMaterial({ color: 0x8a6a34, metalness: 1, roughness: 0.38 });
      const prof = [[0.02, 0], [0.16, 0.0], [0.24, -0.06], [0.27, -0.3], [0.31, -0.6], [0.42, -0.86], [0.56, -1.0], [0.6, -1.05], [0.55, -1.06], [0.5, -1.0]].map(([rr, yy]) => new THREE.Vector2(rr, yy));
      const bg = new THREE.LatheGeometry(prof, 28);
      const pivot = new THREE.Group(); pivot.position.set(0, SH + BH - 1.5, TZ);
      const bell = new THREE.Mesh(bg, bronze); bell.castShadow = true; pivot.add(bell);
      const clapper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6), bronze); clapper.position.y = -0.5; const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), bronze); ball.position.y = -0.92; pivot.add(clapper, ball);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), charMat); stock.position.y = 0.12; pivot.add(stock);
      g.add(pivot); this.bellPivot = pivot; this.bellSwing = 0;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(TW - 1.2, 0.3, 0.3), charMat); beam.position.set(0, SH + BH - 1.25, TZ); g.add(beam);
      const floorB = new THREE.Mesh(new THREE.BoxGeometry(TW - 1.4, 0.2, TW - 1.4), charMat); floorB.position.set(0, SH + 0.1, TZ); g.add(floorB); }
    const trusses = [];
    { const [wx, wy, wz] = this.wellTop;   // the well's roof on two posts, the windlass and a bucket
      for (const sx of [-1, 1]) trusses.push(xf(new THREE.BoxGeometry(0.14, 2.3, 0.14), [wx + sx * 0.95, wy + 1.15, wz]));
      trusses.push(xf(new THREE.CylinderGeometry(0.08, 0.08, 2.0, 6), [wx, wy + 1.6, wz], [0, 0, PI / 2]));
      for (const sz of [-1, 1]) trusses.push(xf(new THREE.BoxGeometry(2.4, 0.06, 1.0), [wx, wy + 2.55, wz + sz * 0.42], [sz * 0.55, 0, 0]));
      trusses.push(xf(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 8), [wx + 0.3, wy + 1.0, wz])); }
    const rise = 3.4, slope = Math.atan2(rise, W / 2), rl = Math.hypot(W / 2, rise) + 0.4;
    trusses.push(xf(new THREE.BoxGeometry(0.3, 0.3, L * 0.55), [0, Hh + rise, -L / 2 + L * 0.3]));                  // what is left of the ridge
    for (let k = 0; k < 8; k++) {
      const lz = -L / 2 + 1.5 + k * 2.4;
      if (r() > 0.35) trusses.push(xf(new THREE.BoxGeometry(W + 1, 0.25, 0.25), [0, Hh + 0.12, lz]));               // tie beam, on the wall tops
      if (lz < -L / 2 + L * 0.58) for (const sx of [-1, 1]) if (r() > 0.25) trusses.push(xf(new THREE.BoxGeometry(rl, 0.2, 0.2), [sx * W / 4, Hh + rise / 2 + 0.1, lz], [0, 0, -sx * slope]));
    }
    // pews in rows, some thrown over; the altar table at the east end
    for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) {
      const pz = -L / 2 + 4 + k * 1.9; const over = r() < 0.3;
      const pew = merge([xf(new THREE.BoxGeometry(3, 0.08, 0.45), [0, 0.45, 0]), xf(new THREE.BoxGeometry(3, 0.55, 0.06), [0, 0.75, -0.22]), xf(new THREE.BoxGeometry(0.08, 0.45, 0.45), [-1.45, 0.22, 0]), xf(new THREE.BoxGeometry(0.08, 0.45, 0.45), [1.45, 0.22, 0])]);
      trusses.push(xf(pew, [sx * 2.1 + (over ? r.range(-0.4, 0.4) : 0), over ? 0.23 : 0, pz], over ? [-PI / 2 + 0.1, r.range(-0.4, 0.4), 0] : [0, r.range(-0.05, 0.05), 0]));
    }
    parts.push(xf(new THREE.BoxGeometry(2.4, 1.05, 1.0), [0, 0.52, -L / 2 + 1.6]));
    const tm = new THREE.Mesh(boxUV(merge(trusses), 1.1), charMat); tm.castShadow = true; g.add(tm);
    this.group.add(g);
    const C = Math.cos(yaw), S = Math.sin(yaw);
    const toW = (lx, lz) => [x + lx * C + lz * S, z - lx * S + lz * C];
    for (let k = 0; k < 10; k++) for (const s of [-1, 1]) { if (k === 4 && s > 0) continue; const [cx, cz] = toW(s * W / 2, -L / 2 + 1 + k * 2); this.addCollider(cx, cz, 1.0); }
    for (let k = -4; k <= 4; k++) { const [cx, cz] = toW(k, -L / 2); this.addCollider(cx, cz, 0.6); }
    for (const lx of [-4, -3, -2, 2, 3, 4]) { const [cx, cz] = toW(lx, L / 2); this.addCollider(cx, cz, 0.6); }
    for (const [ox, oz] of [[-2.2, 2.2], [2.2, 2.2], [-2.2, -2.2], [2.2, -2.2]]) { const [cx, cz] = toW(ox, L / 2 + 2.7 + oz); this.addCollider(cx, cz, 0.9); }
    this.church = { x, y, z, yaw, toW };
    const bf = toW(0, L / 2 + 2.7);
    this.belfry = new THREE.Vector3(bf[0], y + 17.5, bf[1]);
    (this.ruinSpots || (this.ruinSpots = [])).push({ x, z });
  }

  // ---------------------------------------------------------------- the Ascent
  buildAscent(stoneMat, woodMat, charMat) {
    const r = rng(this.ch.seed + 41);
    const frame = (t) => { const p = this.path.at(t), q = this.path.at(Math.min(1, t + 0.004)), q0 = this.path.at(Math.max(0, t - 0.004)); let tx = q.x - q0.x, tz = q.z - q0.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return { p, tx, tz, nx: -tz, nz: tx, y: this.pathH[Math.round(t * 400)] }; };
    const half = (t) => this.trackHalf(t);
    const rockM = snowyRock(stoneMat.clone()); rockM.color = new THREE.Color(0x8a8480); rockM.flatShading = true;
    const geos = []; for (let v = 0; v < 6; v++) geos.push(jaggedRock(700 + v, v > 3 ? 0.3 : 0));
    const lists = geos.map(() => []);
    const put = (it) => lists[r.int(0, 5)].push(it);
    const ledgeSide = (t) => this.ledge && t > this.ledge.t0 && t < this.ledge.t1 ? this.ledge.side : 0;
    const nearCrev = (x, z) => { const C = this.crevasse; return C && Math.abs((x - C.x) * C.nx + (z - C.z) * C.nz) < 5 && Math.abs((x - C.x) * C.nz - (z - C.z) * C.nx) < 18; };
    const nearAltar = (x, z, m) => this.altarT.some((a) => Math.hypot(x - a.x, z - a.z) < m);
    // boulders lying where they came to rest (on ground flat enough to hold them, half sunk in it), and fans of
    // scree spread below the gullies; nothing perched on a slope or sticking out of a face
    const rest = (x, z) => this.inBounds(x, z) && !this.inCaveZone(x, z, 3) && !nearAltar(x, z, 15) && !this.inLot(x, z, 1) && this.normalAt(x, z).y > 0.8;   // (well clear of an altar's shelf and its ring of stones)
    for (let k = 0; k < 160; k++) {
      const t = r.range(0.02, 0.98), F = frame(t), side = r.sign();
      const d = half(t) + r.range(0.5, 14), x = F.p.x + F.nx * side * d, z = F.p.z + F.nz * side * d;
      if (!rest(x, z)) continue;
      const s = r.range(0.4, 1.7) * (d > half(t) + 6 ? 1.4 : 1); put({ x, y: this.heightAt(x, z) - s * 0.45, z, s, sy: s * r.range(0.55, 0.9), ry: r() * TAU, rx: r.range(-0.2, 0.2), rz: r.range(-0.2, 0.2) });
      if (s > 1.1 && d < half(t) + 1.5) this.addCollider(x, z, s * 0.75);
    }
    for (let fan = 0; fan < 30; fan++) {
      const t = r.range(0.03, 0.97), F = frame(t), side = r.sign();
      const cx = F.p.x + F.nx * side * (half(t) + 4 + r() * 6), cz = F.p.z + F.nz * side * (half(t) + 4 + r() * 6);
      for (let k = 0; k < 26; k++) {
        const a = r() * TAU, d2 = Math.sqrt(r()) * 5, x = cx + Math.cos(a) * d2, z = cz + Math.sin(a) * d2;
        if (!this.inBounds(x, z) || this.inCaveZone(x, z, 2) || nearAltar(x, z, 11) || this.path.nearest(x, z).d < half(t) - 0.5 || this.normalAt(x, z).y < 0.6) continue;
        const s = r.range(0.1, 0.38); put({ x, y: this.heightAt(x, z) - s * 0.3, z, s, sy: s * 0.6, ry: r() * TAU, rx: r() * 2, rz: r() * 2 });
      }
    }
    geos.forEach((g, i) => this.instanced(g, rockM, lists[i]));

    // ---- the rope bridge over the crevasse
    if (this.crevasse) {
      const C = this.crevasse, y = this.pathH[Math.round(C.t * 400)], halfL = 4.6; this.bridge = { x: C.x, z: C.z, dx: C.nx, dz: C.nz, half: halfL, y };
      const plank = [], rope = [], posts = [];
      const yaw = Math.atan2(C.nx, C.nz);
      for (let k = -14; k <= 14; k++) { const a = (k / 14) * halfL; if (r() < 0.08 && Math.abs(k) < 12) continue; const sag = Math.cos((a / halfL) * PI / 2) * 0.35;
        plank.push(xf(new THREE.BoxGeometry(1.7, 0.06, 0.24), [C.x + C.nx * a, y - sag - 0.03, C.z + C.nz * a], [r.range(-0.03, 0.03), yaw, r.range(-0.03, 0.03)])); }
      for (const side of [-1, 1]) {
        const ox = C.nz * side * 0.95, oz = -C.nx * side * 0.95;
        for (const e of [-1, 1]) { const px = C.x + C.nx * e * (halfL + 0.8) + ox, pz = C.z + C.nz * e * (halfL + 0.8) + oz; posts.push(xf(new THREE.CylinderGeometry(0.09, 0.11, 2.0, 7), [px, this.heightAt(px, pz) + 0.7, pz])); }
        for (const hh of [0.95, 0.15]) {   // hand rope and foot rope, sagging
          const pts = []; for (let k = 0; k <= 20; k++) { const a = (k / 20 - 0.5) * 2 * (halfL + 0.8); const sag = Math.cos(clamp(a / (halfL + 0.8), -1, 1) * PI / 2) * (hh > 0.5 ? 0.45 : 0.36); pts.push(new THREE.Vector3(C.x + C.nx * a + ox, y + hh - sag + (Math.abs(a) > halfL ? 0.2 : 0), C.z + C.nz * a + oz)); }
          rope.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.025, 5, false));
        }
        for (let k = -6; k <= 6; k++) { const a = (k / 6) * halfL; const sag = Math.cos((a / halfL) * PI / 2); rope.push(xf(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 4), [C.x + C.nx * a + ox, y + 0.55 - sag * 0.42, C.z + C.nz * a + oz])); }
      }
      const ropeM = new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.95 });
      for (const [list, m] of [[plank, woodMat], [rope, ropeM], [posts, woodMat]]) { const mesh = new THREE.Mesh(merge(list), m); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); }
    }

    // ---- the ledge: stakes driven into the edge, a rope strung between them
    if (this.ledge) {
      const L = this.ledge, posts = [], ropePts = [];
      for (let t = L.t0 + 0.01; t < L.t1 - 0.01; t += 0.006) {
        const F = frame(t), x = F.p.x + F.nx * L.side * 3.1, z = F.p.z + F.nz * L.side * 3.1; const y = this.heightAt(x, z);
        posts.push(xf(new THREE.CylinderGeometry(0.05, 0.07, 1.2, 6), [x, y + 0.45, z], [r.range(-0.12, 0.12), 0, r.range(-0.12, 0.12)]));
        ropePts.push(new THREE.Vector3(x, y + 0.92, z));
      }
      const ropeM = new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.95 });
      this.group.add(new THREE.Mesh(merge(posts), woodMat));
      if (ropePts.length > 2) { const segs = []; for (let k = 0; k < ropePts.length - 1; k++) { const a = ropePts[k], b = ropePts[k + 1], m = a.clone().lerp(b, 0.5); m.y -= 0.12; segs.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 6, 0.022, 4, false)); } this.group.add(new THREE.Mesh(merge(segs), ropeM)); }
    }

    // ---- the frozen dead, and the First Company's last camp
    const frost = snowyRock(new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9 }));
    const rust = new THREE.MeshStandardMaterial({ color: 0x5a4636, metalness: 0.6, roughness: 0.75 });
    const body = (pose) => {   // a man frozen where he stopped: wrapped in his cloak, his helm on, snow on him
      const g = new THREE.Group(), parts = [], helm = [];
      const cap = (r0, len, p, rot) => parts.push(xf(new THREE.CapsuleGeometry(r0, len, 3, 8), p, rot));
      if (pose === 'sit') {   // sitting against the rock, knees up, head down on them
        cap(0.17, 0.42, [0, 0.42, -0.08], [0.25, 0, 0]); parts.push(xf(new THREE.SphereGeometry(0.11, 10, 8), [0, 0.78, 0.12]));
        for (const s of [-1, 1]) { cap(0.075, 0.38, [s * 0.11, 0.25, 0.2], [-0.9, 0, 0]); cap(0.06, 0.38, [s * 0.11, 0.2, 0.42], [0.35, 0, 0]); cap(0.055, 0.3, [s * 0.16, 0.48, 0.15], [-1.2, 0, s * 0.3]); }
        helm.push(xf(new THREE.SphereGeometry(0.135, 12, 8, 0, TAU, 0, PI * 0.6), [0, 0.82, 0.14], [0.6, 0, 0]));
        parts.push(xf(new THREE.ConeGeometry(0.42, 0.9, 10, 1, true), [0, 0.42, -0.06], [0.15, 0, 0]));   // the cloak round him
      } else {                // lying on his side, curled
        cap(0.17, 0.45, [0, 0.17, 0], [0, 0, PI / 2]); parts.push(xf(new THREE.SphereGeometry(0.11, 10, 8), [0.5, 0.15, 0.05]));
        for (const s of [-1, 1]) { cap(0.075, 0.38, [-0.45, 0.14 + s * 0.04, 0.18], [PI / 2, 0, 0.6]); cap(0.06, 0.36, [-0.3, 0.12 + s * 0.04, 0.48], [PI / 2, 0, -0.4]); }
        cap(0.055, 0.3, [0.25, 0.3, 0.2], [0.8, 0, 0.4]);
        helm.push(xf(new THREE.SphereGeometry(0.135, 12, 8, 0, TAU, 0, PI * 0.6), [0.55, 0.17, 0.05], [0, 0, -PI / 2]));
      }
      const m = new THREE.Mesh(merge(parts), frost); m.castShadow = true; g.add(m); g.add(new THREE.Mesh(merge(helm), rust)); return g;
    };
    let nb = 0;
    const placeBody = (x, z, yaw, pose) => {   // a whole frozen man where there are people to build him from, else the old wrapped shape
      const fz = makeFrozen(pose === 'lie' ? ['lie', 'prone'][nb % 2] : ['sit', 'prone', 'slump', 'sit'][nb % 4], nb++ * 7 + 3);
      if (fz) { fz.settle((px, pz) => this.heightAt(px, pz), x, z, yaw); this.group.add(fz.root); return; }
      const b = body(pose); b.position.set(x, this.heightAt(x, z) - 0.04, z); b.rotation.y = yaw; this.group.add(b);
    };
    for (let k = 0; k < 9; k++) {   // along the way, where they sat down and did not get up
      const t = 0.08 + k * 0.1 + r.range(-0.02, 0.02), F = frame(t), side = r.sign(); if (ledgeSide(t) === side) continue;
      const d = half(t) - 0.4, x = F.p.x + F.nx * side * d, z = F.p.z + F.nz * side * d; if (nearCrev(x, z) || nearAltar(x, z, 10)) continue;
      placeBody(x, z, Math.atan2(-F.nx * side, -F.nz * side) + r.range(-0.4, 0.4), r() < 0.6 ? 'sit' : 'lie');
    }
    if (this.camp) {
      const L = this.camp, C = Math.cos(L.yaw), S = Math.sin(L.yaw), toW = (lx, lz) => [L.x + lx * C + lz * S, L.z - lx * S + lz * C];
      const gy = L.padH; const parts = [], wood = [], cloth = [];
      // the fire: a ring of stones round black logs, long dead, with snow drifted in
      const [fx, fz] = toW(0, 1.5);
      for (let k = 0; k < 11; k++) { const a = (k / 11) * TAU; parts.push(xf(lumpy(icoSmooth(1), 0.3, 900 + k), [fx + Math.cos(a) * 0.62, gy + 0.08, fz + Math.sin(a) * 0.62], [r() * 3, r() * 3, 0], [0.16, 0.12, 0.14])); }
      for (let k = 0; k < 4; k++) wood.push(xf(new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), [fx, gy + 0.08, fz], [PI / 2, (k / 4) * PI + 0.3, 0.12]));
      // the tent: its ridge pole snapped, the canvas fallen in over what was inside it
      { const [tx, tz] = toW(-2.6, -1.2); const ty = gy; const NXc = 14, NZc = 12, pos = [], idx = [];
        for (let j = 0; j <= NZc; j++) for (let i = 0; i <= NXc; i++) { const u = i / NXc - 0.5, v = j / NZc; const ridge = lerp(1.6, 0.35, smooth(v)) ; const y = Math.max(0.05, ridge * (1 - Math.abs(u) * 2) + Math.sin(u * 13 + v * 7) * 0.05) + (1 - Math.abs(u) * 2) * 0.1 * Math.sin(v * 20);
          const lx = u * 2.6, lz = (v - 0.5) * 3.2; pos.push(lx, y, lz); }
        for (let j = 0; j < NZc; j++) for (let i = 0; i < NXc; i++) { const a = j * (NXc + 1) + i, b = a + NXc + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
        tg.rotateY(L.yaw); tg.translate(tx, ty, tz); cloth.push(tg);
        const [px, pz] = toW(-2.6, -2.75); wood.push(xf(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), [px, gy + 0.85, pz], [0, 0, 0.08]));
        const [qx, qz] = toW(-2.4, 0.2); wood.push(xf(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5), [qx, gy + 0.3, qz], [1.1, L.yaw, 0.2])); }
      // gear: shields, a spear driven in, bedrolls, a pot on its side
      const [sx, sz] = toW(2.6, -2.2); parts.push(xf(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 16), [sx, gy + 0.36, sz], [1.2, L.yaw, 0]));
      const [sx2, sz2] = toW(3.4, 0.4); parts.push(xf(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 16), [sx2, gy + 0.03, sz2]));
      const [spx, spz] = toW(1.4, -3.2); wood.push(xf(new THREE.CylinderGeometry(0.02, 0.025, 2.2, 5), [spx, gy + 1.0, spz], [0.15, 0, 0.1]));
      for (const [bx, bz] of [[-0.8, -0.6], [0.9, 3.3]]) { const [x, z] = toW(bx, bz); cloth.push(xf(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10), [x, gy + 0.14, z], [0, L.yaw + 0.4, PI / 2])); }
      const [ox, oz] = toW(0.8, 1.0); parts.push(xf(new THREE.SphereGeometry(0.18, 10, 8, 0, TAU, 0, PI * 0.6), [ox, gy + 0.12, oz], [1.4, 0.3, 0]));
      this.group.add(new THREE.Mesh(merge(parts), rust)); this.group.add(new THREE.Mesh(merge(wood), charMat));
      const canvasM = snowyRock(new THREE.MeshStandardMaterial({ color: 0x6a6252, roughness: 0.95, side: THREE.DoubleSide })); canvasM.customProgramCacheKey = () => 'snowyCanvas';
      const cm = new THREE.Mesh(merge(cloth), canvasM); cm.castShadow = true; cm.receiveShadow = true; this.group.add(cm);
      // the last of them, round the fire
      const [b1x, b1z] = toW(-0.9, 2.3); placeBody(b1x, b1z, L.yaw + PI + 0.5, 'sit');
      const [b2x, b2z] = toW(1.0, 2.6); placeBody(b2x, b2z, L.yaw - 0.8, 'lie');
      const [b3x, b3z] = toW(-3.2, 3.6); placeBody(b3x, b3z, L.yaw + 2.6, 'sit');
      this.addCollider(...toW(-2.6, -1.2), 1.6);
    }

    // ---- mist lying in the gorge, drifting
    const tex = cloudTexture(); this.mist = [];
    for (let k = 0; k < 46; k++) {
      const t = r.range(0, 1), F = frame(t), d = r.range(-10, 10), x = F.p.x + F.nx * d, z = F.p.z + F.nz * d; if (!this.inBounds(x, z) || this.inCaveZone(x, z, 12)) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xb8c0cc, transparent: true, opacity: 0.16 + r() * 0.1, depthWrite: false }));
      const y = F.y + r.range(1.5, 7); sp.position.set(x, y, z); sp.scale.set(r.range(14, 26), r.range(5, 9), 1); this.group.add(sp); this.mist.push({ s: sp, x, y, ph: r() * 10 });
    }
  }

  buildBanners(n, r, woodMat) {
    const colors = [[120, 20, 20], [180, 160, 60], [30, 40, 90], [200, 200, 190]];
    this.banners = [];
    const clothMats = colors.map((c, i) => { const t = clothTextures(c, false, 128, 'banner' + i); const m = new THREE.MeshStandardMaterial({ map: t.map, side: THREE.DoubleSide, roughness: 0.95 }); this.swayMaterial(m, 0.35, true); return m; });
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.04, 4.2, 6); poleGeo.translate(0, 2.1, 0);
    const clothGeo = new THREE.PlaneGeometry(1.1, 1.6, 6, 8); clothGeo.translate(0.58, 3.2, 0);
    // tattered lower edge
    const pos = clothGeo.attributes.position; for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 2.6) pos.setY(i, pos.getY(i) + Math.abs(Math.sin(i * 12.9)) * 0.35);
    const poles = [], cloths = colors.map(() => []);
    this.scatter(n, (x, z) => this.okSpot(x, z, 4, 10), (x, z, y) => { const it = { x, y: y - 0.3, z, ry: r() * TAU, rx: r.range(-0.25, 0.25), rz: r.range(-0.25, 0.25) }; poles.push(it); cloths[r.int(0, colors.length - 1)].push(it); });
    this.instanced(poleGeo, woodMat, poles);
    cloths.forEach((l, i) => this.instanced(clothGeo, clothMats[i], l, { shadow: true }));
  }

  // add wind sway to an instanced foliage/cloth material
  swayMaterial(mat, amount, cloth = false) {
    this.swayMats = this.swayMats || [];
    mat.userData.uTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = mat.userData.uTime; sh.uniforms.uSway = { value: amount };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uSway;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float wave = sin(uTime * ${cloth ? '3.1' : '1.7'} + ip.x * 0.31 + ip.z * 0.27 + position.x * ${cloth ? '2.5' : '0.0'});
          float k = ${cloth ? 'max(0.0, position.x) * 0.8' : 'max(0.0, position.y) * 0.6'};
          transformed.x += wave * uSway * k; transformed.z += wave * uSway * k * ${cloth ? '1.2' : '0.6'};`);
    };
    this.swayMats.push(mat);
  }

  // ---------------------------------------------------------------- grass
  // somewhere nothing grows up through: a building's floor, the paved street, a well's mouth
  // nothing grows on the trodden track: read back from the road the ground was painted with
  onTrack(x, z) { if (!this.maskData) return false; const S = this.maskSize, i = clamp(Math.floor((x / (HALF * 2) + 0.5) * S), 0, S - 1), j = clamp(Math.floor((z / (HALF * 2) + 0.5) * S), 0, S - 1); return this.maskData[(j * S + i) * 4 + 1] > 150; }
  blocked(x, z) { return this.onTrack(x, z) || !!this.inFootprint(x, z, 0.4) || this.wells.some((w) => Math.hypot(x - w.x, z - w.z) < w.r + 0.6) || (!!this.paving && this.onPaving(x, z)); }
  buildGrass() {
    const kind = this.ch.terrain.kind; if (kind === 'peak') return;
    const g1 = new THREE.PlaneGeometry(1.0, 0.7); g1.translate(0, 0.33, 0); const g2 = g1.clone(); g2.rotateY(PI / 2);
    const geo = merge([g1, g2]);
    const deadMat = new THREE.MeshStandardMaterial({ map: grassTexture(false), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: kind === 'mountain' ? 0xd0c098 : 0xb0a090 });
    const aliveMat = new THREE.MeshStandardMaterial({ map: grassTexture(true), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    this.swayMaterial(deadMat, 0.18); this.swayMaterial(aliveMat, 0.22);
    const r = rng(this.ch.seed + 77);
    const dead = [];
    const nDead = Math.floor((kind === 'mountain' ? 1400 : 9000) * this.q.grass);
    for (let k = 0; k < nDead * 3 && dead.length < nDead; k++) {
      const x = r.range(-HALF + 20, HALF - 20), z = r.range(-HALF + 20, HALF - 20);
      if (kind === 'fen' && this.heightAt(x, z) < 0.05) continue;
      if (this.normalAt(x, z).y < 0.82 || this.inCaveZone(x, z, 1)) continue;
      if (this.lifeAt(x, z) > 0.5) continue;
      if (this.blocked(x, z)) continue;
      dead.push({ x, y: this.heightAt(x, z) - 0.05, z, ry: r() * TAU, s: r.range(0.7, 1.3) });
    }
    this.instanced(geo, deadMat, dead, { shadow: false });
    // living grass and flowers, hidden until each altar is cleansed
    this.aliveGrass = [];
    const per = Math.floor(1400 * this.q.grass);
    const list = [];
    for (const a of this.altarT) {
      for (let k = 0; k < per; k++) {
        const ang = r() * TAU, d = Math.sqrt(r()) * 34; const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
        if (!this.inBounds(x, z) || (kind === 'fen' && this.heightAt(x, z) < 0.0)) continue;
        if (Math.hypot(x - a.x, z - a.z) < 3.2 || this.blocked(x, z)) continue;
        list.push({ x, y: this.heightAt(x, z) - 0.04, z, ry: r() * TAU, s: 0.0001, target: r.range(0.8, 1.5), d, altar: a });
      }
    }
    // the living country the knights ride out from
    if (kind !== 'peak' && kind !== 'mountain') {
      const n0 = list.length, want = Math.floor(5000 * this.q.grass);
      for (let k = 0; k < want * 2 && list.length - n0 < want; k++) {
        const x = r.range(-HALF + 6, HALF - 6), z = r.range(-HALF + 4, -95);
        if (this.lifeAt(x, z) < 0.6 || this.normalAt(x, z).y < 0.8 || this.blocked(x, z)) continue;
        const s = r.range(0.8, 1.5); list.push({ x, y: this.heightAt(x, z) - 0.04, z, ry: r() * TAU, s, target: s, d: 0, altar: null });
      }
    }
    this.aliveGrass = list;
    this.aliveMesh = this.instanced(geo, aliveMat, list, { shadow: false });
  }

  // ---------------------------------------------------------------- water
  buildWater() {
    const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 1, 1); g.rotateX(-PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0c1010, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.88, envMapIntensity: 1.3 });
    const uT = { value: 0 }; this.waterTime = uT;
    const tt = terrainTextures(512);
    mat.normalMap = tt.aliveN; mat.normalScale = new THREE.Vector2(0.25, 0.25);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uT; Object.assign(sh.uniforms, WATER_U); sh.uniforms.uRainOn = { value: 1 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvW = (modelMatrix * vec4(position,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vW; uniform float uTime, uRainOn;' + WATER_GLSL)
        .replace('#include <normal_fragment_maps>', `
          // slow wind-ruffle: a long, gentle swell and a finer cat's-paw, both faint (the fen is sheltered, shallow water)
          vec3 n1 = texture2D(normalMap, vW * 0.11 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vW * 0.53 - vec2(uTime * 0.02, -uTime * 0.03)).xyz * 2.0 - 1.0;
          vec3 nn = normalize(vec3(n1.xy * 0.05 + n2.xy * 0.035, 1.0));
          // wakes, footsteps and rain rings
          nn = waterNormal(nn, vW, uRainOn);
          normal = normalize((viewMatrix * vec4(nn.x, nn.z, -nn.y, 0.0)).xyz);`);
    };
    const m = new THREE.Mesh(g, mat); m.position.y = 0.02; m.receiveShadow = true; m.renderOrder = 1;
    this.group.add(m); this.water = m; this.waterLevel = 0;
  }
  buildCloudSea() {
    const g = new THREE.PlaneGeometry(2400, 2400, 1, 1); g.rotateX(-PI / 2);
    const uT = { value: 0 }; this.cloudTime = uT;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uT, c1: { value: new THREE.Color(0x16181e) }, c2: { value: new THREE.Color(0x4a4e5a) }, fogC: { value: new THREE.Color(this.ch.atmos.fog) } },
      vertexShader: `varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 c1, c2, fogC; varying vec3 vW;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.1; a*=0.5; } return s; }
        void main(){ vec2 p = vW.xz * 0.01 + vec2(uTime * 0.01, 0.0); float c = fbm(p) * 0.7 + fbm(p * 3.0 + 4.0) * 0.3;
          vec3 col = mix(c1, c2, smoothstep(0.35, 0.8, c)); float d = length(vW.xz); col = mix(col, fogC, smoothstep(200.0, 1100.0, d));
          gl_FragColor = vec4(col, 1.0); }`,
      fog: false,
    });
    const m = new THREE.Mesh(g, mat); m.position.y = -150; this.group.add(m);
  }

  // ---------------------------------------------------------------- the land heals
  cleanse(i, instant = false) {
    const a = this.altars[i]; if (!a || a.state === 'cleansed') return;
    a.state = 'cleansed'; a.progress = 1;
    if (this.bellPivot && (i === 1 || this.altars.length === 1)) this.bellSwing = 1;   // the bell of Saint Aldric rings again
    a.candles.visible = true;
    this.healAnims.push({ a, t: instant ? 99 : 0 });
    this.healedFrac = this.altars.filter((x) => x.state === 'cleansed').length / this.altars.length;
  }

  update(dt, camPos) {
    this.time += dt;
    if (this.vista) this.vista.update(dt, camPos);
    if (this.bellPivot && this.bellSwing > 0.002) { this.bellSwing = Math.max(0, this.bellSwing - dt * 0.05); this.bellPivot.rotation.z = Math.sin(this.time * 2.4) * 0.6 * this.bellSwing; const sg = Math.sign(Math.sin(this.time * 2.4)); if (sg !== this._toll) { this._toll = sg; if (this.onToll && this.bellSwing > 0.2) this.onToll(this.belfry); } }
    if (this.swayMats) for (const m of this.swayMats) m.userData.uTime.value = this.time;
    if (this.waterTime) this.waterTime.value = this.time;
    if (this.cloudTime) this.cloudTime.value = this.time;
    if (this.mist) for (const m of this.mist) { m.s.position.x = m.x + Math.sin(this.time * 0.05 + m.ph) * 3; m.s.position.y = m.y + Math.sin(this.time * 0.11 + m.ph) * 0.6; m.s.material.rotation = m.ph + this.time * 0.01; }
    for (const a of this.altars) {
      a.circle.material.uniforms.time.value = this.time;
      a.circle.material.uniforms.prog.value = a.progress;
      const want = a.state === 'active' ? 1 : a.state === 'blighted' ? 0.35 : 0;
      a.circle.material.uniforms.a.value += (want - a.circle.material.uniforms.a.value) * Math.min(1, dt * 3);
      a.evilLight.intensity = a.state === 'cleansed' ? Math.max(0, a.evilLight.intensity - dt * 4) : 5 + Math.sin(this.time * 3 + a.i) * 1.5;
    }
    // healing animations
    let grassDirty = false, leavesDirty = false;
    for (let k = this.healAnims.length - 1; k >= 0; k--) {
      const h = this.healAnims[k]; h.t += dt; const a = h.a;
      const T = h.t;
      const R = Math.min(34, T * 7);
      if (T < 7) this.paintLife(a.x, a.z, R, 1);
      a.corr.scale.setScalar(Math.max(0.0001, 1 - T / 2.2));
      a.candles.userData.light.intensity = Math.min(3, T * 1.5) * (0.9 + Math.sin(this.time * 13) * 0.08);
      // grass & flowers rise in a wave from the altar
      if (this.aliveGrass) for (let i = 0; i < this.aliveGrass.length; i++) {
        const g = this.aliveGrass[i]; if (g.altar !== this.altarT[a.i] || g.s >= g.target) continue;
        const local = (T - g.d / 7) / 1.4; if (local <= 0) continue;
        g.s = g.target * smooth(Math.min(1, local)); grassDirty = true;
        this.setInst(this.aliveMesh, i, g);
      }
      if (this.leaves?.mesh) for (let i = 0; i < this.leaves.list.length; i++) {
        const l = this.leaves.list[i]; if (l.s >= l.target) continue;
        const d = Math.hypot(l.x - a.x, l.z - a.z); if (d > 36) continue;
        const local = (T - d / 7 - 0.4) / 2.2; if (local <= 0) continue;
        l.s = Math.max(0.0001, l.target * smooth(Math.min(1, local))); leavesDirty = true;
        this.setInst(this.leaves.mesh, i, l);
      }
      if (T > 12) this.healAnims.splice(k, 1);
    }
    if (grassDirty) this.aliveMesh.instanceMatrix.needsUpdate = true;
    if (leavesDirty) this.leaves.mesh.instanceMatrix.needsUpdate = true;
    if (this.sparks) this.sparks.uTime.value = this.time;
    if (this.emberMat) this.emberMat.emissiveIntensity = 1.5 + Math.sin(this.time * 2.3) * 0.25 + Math.sin(this.time * 7.1) * 0.15;
    // village fires: nearest few get lights
    if (this.fires.length && camPos) {
      const near = this.fires.map((f) => [f, (f.x - camPos.x) ** 2 + (f.z - camPos.z) ** 2]).sort((a, b) => a[1] - b[1]);
      this.fireLights.forEach((l, i) => { const f = near[i]?.[0]; if (!f || near[i][1] > 90 * 90) { l.intensity = 0; return; } l.position.set(f.x, f.y + 1.1, f.z); const fl = Math.sin(this.time * 17 + i * 3) * 0.5 + Math.sin(this.time * 7.3 + i) * 0.5 + Math.sin(this.time * 31 + i * 1.7) * 0.35; l.intensity = (8 + fl * 2.6) * f.s; });
      // real flames on the nearest few; the rest are glow and sparks at a distance
      if (this.flamePool) this.flamePool.forEach((F, i) => { const f = near[i]?.[0]; const on = !!f && near[i][1] < 70 * 70; F.group.visible = on; if (!on) return; F.group.position.set(f.x, f.y + 0.05, f.z); F.group.scale.setScalar(f.s); F.update(this.time, camPos, 1); });
    }
  }
  setInst(mesh, i, g) {
    const M = this._m || (this._m = new THREE.Matrix4()); const Q = this._qq || (this._qq = new THREE.Quaternion());
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.ry || 0);
    M.compose(new THREE.Vector3(g.x, g.y, g.z), Q, new THREE.Vector3(g.s, g.s, g.s)); mesh.setMatrixAt(i, M);
  }

  // where demons claw their way up for an altar's waves
  spawnPoint(altar, r = Math.random) {
    for (let k = 0; k < 20; k++) {
      const ang = r() * TAU, d = 26 + r() * 16;
      const x = altar.x + Math.cos(ang) * d, z = altar.z + Math.sin(ang) * d;
      if (this.ch.terrain.kind === 'mountain') { const n = this.path.nearest(x, z); if (n.d > 11 || this.inCaveZone(x, z, 3)) continue; }
      if (this.ch.terrain.kind === 'peak') { if (Math.hypot(x, z) > 32) continue; }
      if (!this.inBounds(x, z)) continue;
      return { x, y: this.heightAt(x, z), z };
    }
    return { x: altar.x + 20, y: this.heightAt(altar.x + 20, altar.z), z: altar.z };
  }
  get startPos() {
    if (this.ch.terrain.kind === 'peak') return { x: 0, z: -28 };
    const p = this.path.at(0.012); return p;
  }
  get endPos() { return this.path.at(0.985); }

  dispose() {
    if (this.vista) this.vista.dispose();
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => x.dispose()); } });
  }
}
