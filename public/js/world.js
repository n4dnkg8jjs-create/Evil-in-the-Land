// Deterministic world generation per chapter: heightfield, the blight / life
// terrain shader, props, altars, colliders, water and the healing of the land.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { icoSmooth } from './demons.js';
import { CHAPTERS, HEALED } from './chapters.js';
import { terrainTextures, stoneTextures, barkTextures, woodTextures, grassTexture, demonTextures, clothTextures, armorTextures, leafTexture } from './textures.js';
import { rng, makeNoise, pathSampler, clamp, lerp, smooth, SpatialHash, TAU } from './util.js';
import { Vista } from './vista.js';
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
function clean(g) { for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } return g; }
function merge(list) { return mergeGeometries(list.map(clean)); }
function uvScale(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
function lumpy(g, amt, seed) { // perturb a rock along its normals
  const n = makeNoise(seed); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + n.fbm(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3, 4) * amt; v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z); }
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
function jaggedRock(seed, taper = 0) {
  const r = rng(seed); let g = icoSmooth(3); const p = g.attributes.position; const v = new THREE.Vector3();
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

export class World {
  constructor(engine, quality, chapterIdx) {
    this.engine = engine; this.q = quality; this.idx = chapterIdx; this.ch = CHAPTERS[chapterIdx];
    this.scene = engine.scene;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.r = rng(this.ch.seed); this.noise = makeNoise(this.ch.seed);
    this.colliders = []; this.colGrid = new SpatialHash(6);
    this.time = 0; this.healAnims = []; this.wind = new THREE.Vector3(this.ch.wind[0], 0, this.ch.wind[1]);
    this.fires = []; this.waterLevel = -1000;
    this.healedFrac = 0;
    this.buildPath();
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
      pts = [{ x: -40, z: -128 }, { x: 55, z: -100 }, { x: -55, z: -62 }, { x: 55, z: -24 }, { x: -55, z: 14 }, { x: 55, z: 52 }, { x: -30, z: 88 }, { x: 0, z: 124 }];
    } else if (kind === 'peak') {
      pts = [{ x: 0, z: -40 }, { x: 0, z: -20 }, { x: 0, z: 0 }, { x: 0, z: 20 }];
    } else {
      pts = [{ x: r.range(-15, 15), z: -128 }];
      const m = 6;
      for (let k = 1; k < m; k++) pts.push({ x: r.range(-60, 60) * (k % 2 ? 1 : -1) * 0.8, z: -128 + (256 * k) / m });
      pts.push({ x: r.range(-15, 15), z: 128 });
    }
    this.path = pathSampler(pts);
    // altars along the path
    const n = this.ch.altars; this.altarT = [];
    if (kind === 'peak') {
      for (let i = 0; i < n; i++) { const a = -PI / 2 + (i / n) * TAU + PI / n; this.altarT.push({ x: Math.cos(a) * 22, z: Math.sin(a) * 22 }); }
    } else for (let i = 0; i < n; i++) { const t = lerp(0.14, 0.86, n === 1 ? 0.5 : i / (n - 1)); this.altarT.push({ t, ...this.path.at(t) }); }
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
    // path table
    const PT = 400; const pathH = new Float32Array(PT + 1);
    for (let i = 0; i <= PT; i++) {
      const p = this.path.at(i / PT);
      if (T.kind === 'mountain') pathH[i] = (i / PT) * T.rise;
      else if (T.kind === 'fen') pathH[i] = Math.max(0.5, this.baseHeight(p.x, p.z) * 0.3 + 0.6);
      else pathH[i] = this.baseHeight(p.x, p.z) * 0.6;
    }
    // smooth the path heights
    for (let pass = 0; pass < 6; pass++) for (let i = 1; i < PT; i++) pathH[i] = (pathH[i - 1] + pathH[i] * 2 + pathH[i + 1]) / 4;
    this.pathH = pathH;
    const altars = this.altarT;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      let h = this.baseHeight(x, z);
      if (T.kind !== 'peak') {
        const nr = this.path.nearest(x, z);
        const ph = pathH[Math.round(nr.t * PT)];
        if (T.kind === 'mountain') {
          // the road is a ravine climbing the mountain: walls rise to either side
          const wall = Math.max(0, nr.d - 7);
          h = ph + h * smooth(clamp((nr.d - 6) / 24, 0, 1)) + wall * 0.9 + Math.pow(wall, 1.3) * 0.05;
        } else {
          h = lerp(ph, h, smooth(clamp((nr.d - 4) / 14, 0, 1)));
        }
      }
      // flatten altar sites
      for (const a of altars) {
        const d = Math.hypot(x - a.x, z - a.z);
        const fr = T.kind === 'peak' ? 5.5 : 9;
        if (d < fr * 2) { const ah = this.altarHeightGuess(a); h = lerp(ah, h, smooth(clamp((d - fr) / fr, 0, 1))); }
      }
      H[j * N + i] = h;
    }
    for (const a of altars) a.y = this.heightAt(a.x, a.z);
    for (const s of this.devilSpots) s.y = this.groundAt(s.x, s.z);
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
    const h = this.heightAt(x, z);
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
    for (let i = 0; i < p.count; i++) p.setY(i, this.heightAt(p.getX(i), p.getZ(i)));
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
      uSize: { value: HALF * 2 }, uTile: { value: 0.22 }, uSnowLine: { value: T.kind === 'mountain' ? 85 : 9999 },
      uWater: { value: T.water !== undefined ? 0.0 : -9999 }, uEmber: { value: this.ch.id === 'peak' ? 0.5 : this.ch.id === 'field' ? 1.6 : 0.9 }, uNStr: { value: 1.0 }, uRockAll: { value: T.kind === 'peak' ? 0.35 : 0 }, uFlatSnow: { value: T.kind === 'peak' ? 1 : 0 },
      uDeadTint: { value: new THREE.Color(T.kind === 'fen' ? 0x8a8a78 : T.kind === 'mountain' || T.kind === 'peak' ? 0x9a9090 : 0xffffff) },
      uAliveTint: { value: new THREE.Color(T.kind === 'mountain' ? 0x9aa080 : 0xffffff) },
    };
    this.terrainUniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNorm;
        uniform sampler2D tDead, tDeadN, tAlive, tAliveN, tRock, tRockN, tSnow, tMask;
        uniform float uSize, uTile, uSnowLine, uWater, uEmber, uNStr, uRockAll, uFlatSnow; uniform vec3 uDeadTint, uAliveTint;`)
        .replace('#include <map_fragment>', `
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
        vec3 tcol = mix(ground, rock.rgb * mix(0.62, 1.0, aliveMix), rockMix);
        float snow = smoothstep(uSnowLine, uSnowLine + 10.0, vWPos.y + rock.a * 5.0) * (1.0 - rockMix * 0.5);
        // on the summit the snow lies on everything flat enough to hold it, thin and wind-scoured, rock showing through
        snow = max(snow, uFlatSnow * smoothstep(0.62, 0.86, vWNorm.y + (rock.a - 0.5) * 0.3 + (dead2.a - 0.5) * 0.15));
        tcol = mix(tcol, texture2D(tSnow, wuv).rgb, snow);
        float wet = 1.0 - smoothstep(uWater - 0.2, uWater + 0.7, vWPos.y);
        tcol *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = tcol;
        float ember = (1.0 - aliveMix) * (1.0 - rockMix) * (1.0 - snow) * (1.0 - uFlatSnow) * smoothstep(0.06, 0.16, (dead.r - dead.g) * 2.0);
        `)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(mix(0.95, 0.82, aliveMix), 0.78, rockMix); roughnessFactor = mix(roughnessFactor, 0.2, wet); roughnessFactor = mix(roughnessFactor, 0.55, snow);`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nd = texture2D(tDeadN, wuv).xyz * 2.0 - 1.0, na = texture2D(tAliveN, wuv).xyz * 2.0 - 1.0, nr = texture2D(tRockN, vWPos.xz * uTile * 0.5).xyz * 2.0 - 1.0;
          vec3 tnm = normalize(mix(mix(nd, na, aliveMix), nr, rockMix));
          vec3 Nw = normalize(vWNorm); vec3 Tw = normalize(vec3(1.0, 0.0, 0.0) - Nw * Nw.x); vec3 Bw = normalize(cross(Nw, Tw));
          vec3 nw = normalize(Tw * tnm.x * uNStr - Bw * tnm.y * uNStr + Nw * max(tnm.z, 0.2));
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
    const rough = new THREE.MeshStandardMaterial({ map: stR.map, normalMap: stR.normalMap, roughness: 0.9 });
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
        const sg = lumpy(new THREE.BoxGeometry(0.7, 2.2 + r.range(0, 1.2), 0.5, 2, 4, 2), 0.15, k + i * 10);
        const m = new THREE.Mesh(sg, rough); m.position.set(Math.cos(ang) * 8.2, 0.9, Math.sin(ang) * 8.2); m.rotation.set(r.range(-0.12, 0.12), ang, r.range(-0.12, 0.12));
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
  addCollider(x, z, r) { const c = { x, z, r }; this.colliders.push(c); this.colGrid.insert(c, x, z); }
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
      if (nr.d > 13) { const q = this.path.at(nr.t); const k = 13 / nr.d; p.x = q.x + (p.x - q.x) * k; p.z = q.z + (p.z - q.z) * k; }
    } else { p.x = clamp(p.x, -lim, lim); p.z = clamp(p.z, -lim, lim); }
  }
  inBounds(x, z) { return Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10; }

  okSpot(x, z, minPath = 5, minAltar = 14) {
    if (!this.inBounds(x, z)) return false;
    if (this.ch.terrain.kind !== 'peak' && this.path.nearest(x, z).d < minPath) return false;
    for (const a of this.altarT) if (Math.hypot(x - a.x, z - a.z) < minAltar) return false;
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
    list.forEach((it, i) => { E.set(it.rx || 0, it.ry || 0, it.rz || 0); Q.setFromEuler(E); S.setScalar(it.s || 1); if (it.sy) S.y = it.sy; P.set(it.x, it.y, it.z); M.compose(P, Q, S); m.setMatrixAt(i, M); });
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
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.95 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, roughness: 0.9 });
    const brickMat = new THREE.MeshStandardMaterial({ map: stB.map, normalMap: stB.normalMap, roughness: 0.9 });
    const wd = woodTextures(256, [70, 50, 34]); const charred = woodTextures(256, [26, 20, 18]);
    const woodMat = new THREE.MeshStandardMaterial({ map: wd.map, normalMap: wd.normalMap, roughness: 0.85 });
    const charMat = new THREE.MeshStandardMaterial({ map: charred.map, normalMap: charred.normalMap, roughness: 0.95, emissive: 0x200800, emissiveIntensity: 0.3 });
    this.mats = { barkMat, stoneMat, brickMat, woodMat, charMat };

    // --- trees (dead) with hidden leaf crowns that grow back when the land heals
    if (P.deadTrees) {
      const variants = []; const style = P.pines ? 'pine' : 'oak';
      for (let v = 0; v < 6; v++) variants.push(this.treeGeometry(this.ch.seed * 7 + v, v >= 4 && P.pines ? 'oak' : style));
      const lists = variants.map(() => []);
      const leafList = [];
      const dense = kind === 'wood';
      this.scatter(P.deadTrees, (x, z) => this.okSpot(x, z, dense ? 7 : 9, 16) && (kind !== 'fen' || this.heightAt(x, z) > -0.3), (x, z, y) => {
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
      if (P.crags && kind !== 'peak') this.scatter(P.crags, (x, z) => this.okSpot(x, z, 11, 14), (x, z, y) => { const s = r.range(2.5, 6); lists[r.int(0, 4)].push({ x, y: y + s * 0.4, z, s, sy: s * r.range(1.4, 2.6), ry: r() * TAU, rx: r.range(-0.2, 0.2), rz: r.range(-0.2, 0.2) }); this.addCollider(x, z, s * 0.85); });
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
      const gs = merge([xf(new THREE.BoxGeometry(0.55, 0.9, 0.14), [0, 0.45, 0]), xf(new THREE.CylinderGeometry(0.275, 0.275, 0.14, 12, 1, false, 0, PI), [0, 0.9, 0], [PI / 2, 0, PI / 2])]);
      const list = [];
      const yard = this.altarT[Math.min(1, this.altarT.length - 1)];
      for (let k = 0; k < P.graves; k++) {
        const cx = yard.x + 14 + (k % 6) * 1.6 + r.range(-0.2, 0.2), cz = yard.z - 6 + Math.floor(k / 6) * 1.8;
        const [x, z] = this.okSpot(cx, cz, 3, 9) ? [cx, cz] : [r.range(-100, 100), r.range(-100, 100)];
        if (!this.okSpot(x, z, 3, 9) || this.normalAt(x, z).y < 0.94) continue;   // a churchyard is level ground, never a hillside
        list.push({ x, y: this.heightAt(x, z) - 0.15, z, ry: r.range(-0.2, 0.2), rx: r.range(-0.15, 0.15), rz: r.range(-0.15, 0.15), s: r.range(0.85, 1.15) });
      }
      this.instanced(gs, stoneMat, list);
    }
    if (P.crosses) {
      const cg = merge([xf(new THREE.BoxGeometry(0.1, 1.6, 0.1), [0, 0.7, 0]), xf(new THREE.BoxGeometry(0.7, 0.09, 0.09), [0, 1.1, 0])]);
      const list = []; this.scatter(P.crosses, (x, z) => this.okSpot(x, z, 3, 12), (x, z, y) => list.push({ x, y: y - 0.1, z, ry: r() * TAU, rx: r.range(-0.25, 0.25), rz: r.range(-0.2, 0.2) }));
      this.instanced(cg, woodMat, list);
    }
    if (P.fences) {
      const fg = merge([xf(new THREE.BoxGeometry(0.1, 1.1, 0.1), [-1.2, 0.55, 0]), xf(new THREE.BoxGeometry(0.1, 1.1, 0.1), [1.2, 0.55, 0]), xf(new THREE.BoxGeometry(2.6, 0.08, 0.06), [0, 0.8, 0]), xf(new THREE.BoxGeometry(2.6, 0.08, 0.06), [0, 0.4, 0.0])]);
      const list = []; this.scatter(P.fences, (x, z) => { const n = this.path.nearest(x, z); return n.d > 5 && n.d < 9 && this.okSpot(x, z, 4, 12); }, (x, z, y) => { const n = this.path.nearest(x, z); const a = this.path.at(n.t), b = this.path.at(Math.min(1, n.t + 0.004)); list.push({ x, y: y - 0.05, z, ry: Math.atan2(b.x - a.x, b.z - a.z) + PI / 2, rz: r.range(-0.15, 0.15) }); });
      this.instanced(fg, charMat, list);
    }
    // --- ruins: farms and the village of Saint Aldric
    if (P.farm) for (let k = 0; k < P.farm; k++) this.placeHouse(r, woodMat, charMat, brickMat, false);
    if (P.village) {
      for (let k = 0; k < 11; k++) this.placeHouse(r, woodMat, charMat, brickMat, false);
      this.placeChurch(r, brickMat, charMat);
    }
    if (P.fires) {
      for (let k = 0; k < P.fires; k++) {
        const near = this.ruinSpots?.length ? this.ruinSpots[k % this.ruinSpots.length] : null;
        const x = near ? near.x + r.range(-3, 3) : r.range(-100, 100), z = near ? near.z + r.range(-3, 3) : r.range(-100, 100);
        if (!this.inBounds(x, z)) continue;
        this.fires.push({ x, y: this.heightAt(x, z), z, s: r.range(0.6, 1.4) });
      }
      this.fireLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff7a30, 0, 18, 2); this.group.add(l); return l; });
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
      const list = []; this.scatter(P.logs, (x, z) => this.okSpot(x, z, 6, 12), (x, z, y) => { const ry = r() * TAU; list.push({ x, y: y + 0.25, z, ry }); for (let s = -2; s <= 2; s++) this.addCollider(x + Math.cos(ry) * s * 1.2, z - Math.sin(ry) * s * 1.2, 0.45); });
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
        const x = r.range(-90, 90), z = r.range(-90, 90); if (!this.okSpot(x, z, 6, 14)) continue;
        const g = new THREE.Group(); g.position.set(x, this.heightAt(x, z), z); g.rotation.y = r() * TAU; g.rotation.z = r.range(-0.2, 0.2);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.4, 14), bronze); barrel.rotation.x = PI / 2 - 0.15; barrel.position.y = 0.75; g.add(barrel);
        for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 6, 14), woodMat); w.position.set(s * 0.45, 0.5, 0); w.rotation.y = PI / 2; g.add(w); }
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 2.0), charMat); carriage.position.set(0, 0.45, -0.5); carriage.rotation.x = 0.25; g.add(carriage);
        g.traverse((o) => { o.castShadow = true; }); this.group.add(g); this.addCollider(x, z, 1.2);
      }
    }
    if (P.wagons) for (let k = 0; k < P.wagons; k++) {
      const x = r.range(-100, 100), z = r.range(-100, 100); if (!this.okSpot(x, z, 6, 14)) continue;
      const g = new THREE.Group(); g.position.set(x, this.heightAt(x, z), z); g.rotation.set(0, r() * TAU, r.range(-0.4, 0.4));
      const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), charMat); bed.position.y = 0.8; g.add(bed);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 6, 12), woodMat); w.position.set(sx * 0.85, 0.45, sz * 1.1); w.rotation.y = PI / 2; g.add(w); }
      g.traverse((o) => { o.castShadow = true; }); this.group.add(g); this.addCollider(x, z, 1.8);
    }
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

  placeHouse(r, woodMat, charMat, brickMat, big) {
    let x, z, ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      const t = r.range(0.05, 0.95); const p = this.path.at(t); const side = r.sign(); const d = r.range(14, 34);
      const q = this.path.at(Math.min(1, t + 0.005)); let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1;
      x = p.x + nx / l * side * d; z = p.z + nz / l * side * d; ok = this.okSpot(x, z, 11, 18);
    }
    if (!ok) return;
    const w = r.range(6, 9), dpt = r.range(5, 7), yaw = r() * TAU;
    // set the house on its lowest corner; a stone footing takes up the slope
    const C = Math.cos(yaw), S = Math.sin(yaw);
    const toW = (lx, lz) => [x + lx * C + lz * S, z - lx * S + lz * C];
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const [px, pz] = toW((i / 4 - 0.5) * (w + 0.8), (j / 4 - 0.5) * (dpt + 0.8)); const h = this.heightAt(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const y = hi + 0.15;              // the floor sits just above the highest ground
    const footing = y - lo + 1.2;     // and the footing reaches well below the lowest
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
    const walls = [], timber = [], plaster = [], dark = [];
    walls.push(xf(new THREE.BoxGeometry(w + 0.7, footing, dpt + 0.7), [0, -footing / 2 + 0.12, 0]));
    const intact = r() < 0.4;          // some still stand to the eaves
    const eave = 4.8;
    const wall = (len, cx, cz, rot, front) => {
      const segs = Math.max(3, Math.round(len / 1.15)); const sw = len / segs;
      const door = front ? Math.floor(segs / 2) : -1;
      for (let sg = 0; sg < segs; sg++) {
        const lx = -len / 2 + (sg + 0.5) * sw;
        const P = (gx, gy, gz) => { const c = Math.cos(rot), s2 = Math.sin(rot); return [cx + gx * c + gz * s2, gy, cz - gx * s2 + gz * c]; };
        const ruin = !intact && r() < 0.45;
        const top = ruin ? r.range(0.5, 2.0) : intact ? 2.6 : r.range(2.0, 2.6);
        if (sg === door) { // doorway with a heavy lintel
          walls.push(xf(new THREE.BoxGeometry(sw, 0.5, 0.5), P(lx, 2.35, 0), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw + 0.3, 0.22, 0.56), P(lx, 2.1, 0), [0, rot, 0]));
          dark.push(xf(new THREE.BoxGeometry(sw - 0.2, 2.0, 0.08), P(lx, 1.0, 0.0), [0, rot, 0]));
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
          dark.push(xf(new THREE.BoxGeometry(sw * 0.62, 0.9, 0.08), P(lx, 1.48, 0), [0, rot, 0]));
          // shutters: thrown open, one hanging by a hinge, one sometimes fallen
          for (const sx of [-1, 1]) {
            const fate = r(); if (fate < 0.2) continue;
            const hw = sw * 0.32, ang = fate < 0.4 ? 0.35 : 1.35;
            const [sx0, , sz0] = P(lx + sx * (sw * 0.31 + Math.cos(ang) * hw / 2), 0, 0.3 + Math.sin(ang) * hw / 2);
            timber.push(xf(new THREE.BoxGeometry(hw, 0.9, 0.04), [sx0, fate < 0.4 ? 1.35 : 1.48, sz0], [0, rot - sx * ang, fate < 0.4 ? sx * 0.35 : 0]));
          }
        } else {
          // rough courses: the top of a broken wall is ragged
          walls.push(xf(new THREE.BoxGeometry(sw + 0.02, top, 0.52), P(lx, top / 2, 0), [0, rot, 0]));
          if (ruin) for (let q = 0; q < 2; q++) walls.push(xf(new THREE.BoxGeometry(r.range(0.25, 0.5), r.range(0.15, 0.3), 0.48), P(lx + r.range(-sw / 3, sw / 3), top + 0.1, 0), [r.range(-0.2, 0.2), rot, r.range(-0.3, 0.3)]));
        }
        // the upper storey: timber frame with plaster panels, where it survives
        if ((intact || (!ruin && r() < 0.5)) && top >= 2.5) {
          const fy = 2.6, fh = eave - fy;
          timber.push(xf(new THREE.BoxGeometry(sw + 0.04, 0.2, 0.3), P(lx, fy, 0.14), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(sw + 0.04, 0.2, 0.3), P(lx, eave, 0.14), [0, rot, 0]));
          timber.push(xf(new THREE.BoxGeometry(0.18, fh, 0.3), P(lx - sw / 2 + 0.09, fy + fh / 2, 0.14), [0, rot, 0]));
          const diag = new THREE.BoxGeometry(0.14, Math.hypot(sw, fh) * 0.95, 0.28);
          timber.push(xf(diag, P(lx, fy + fh / 2, 0.14), [0, rot, (sg % 2 ? 1 : -1) * Math.atan2(sw, fh)]));
          plaster.push(xf(new THREE.BoxGeometry(sw, fh, 0.2), P(lx, fy + fh / 2, 0.02), [0, rot, 0]));
        }
        const C2 = Math.cos(yaw), S2 = Math.sin(yaw); const [wx, , wz] = P(lx, 0, 0);
        this.addCollider(x + wx * C2 + wz * S2, z - wx * S2 + wz * C2, 0.6);
      }
    };
    wall(w, 0, dpt / 2, 0, true); wall(w, 0, -dpt / 2, 0, false); wall(dpt, w / 2, 0, PI / 2, false); wall(dpt, -w / 2, 0, PI / 2, false);
    // quoins: dressed stones up each corner
    for (const [cx, cz] of [[-w / 2, -dpt / 2], [w / 2, -dpt / 2], [-w / 2, dpt / 2], [w / 2, dpt / 2]]) {
      const top = intact ? eave : r.range(1.2, 2.8);
      for (let k = 0; k < top / 0.45; k++) walls.push(xf(new THREE.BoxGeometry(0.66 + (k % 2) * 0.12, 0.42, 0.66 - (k % 2) * 0.12), [cx, 0.21 + k * 0.45, cz]));
    }
    // gable ends and roof timbers
    if (intact) {
      for (const sz of [-1, 1]) { const gb = new THREE.BufferGeometry(); const hw = w / 2;
        gb.setAttribute('position', new THREE.Float32BufferAttribute([-hw, eave, sz * dpt / 2, hw, eave, sz * dpt / 2, 0, eave + 2.6, sz * dpt / 2], 3)); gb.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 0.5], 2)); gb.setIndex([0, 1, 2]); gb.computeVertexNormals(); plaster.push(gb); }
      timber.push(xf(new THREE.BoxGeometry(0.24, 0.24, dpt + 1.2), [0, eave + 2.6, 0]));
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
    // what is left of the roof: shingled panels on the rafters, with holes burnt through
    if (intact) {
      for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) {
        if (r() < 0.3) continue;
        const lz = -dpt / 2 - 0.3 + (k + 0.5) * (dpt + 0.6) / 6;
        const len = rlen * r.range(0.55, 1), off = (rlen - len) * (r() < 0.5 ? 0.5 : 0);
        roofs.push(xf(new THREE.BoxGeometry(len, 0.08, (dpt + 0.6) / 6 + 0.02), [sx * (w / 4 + Math.cos(slope) * off * 0.5), eave + rise / 2 + 0.17 - Math.sin(slope) * off * 0.5, lz], [0, 0, -sx * slope]));
      }
    }
    // chimney stack at one end
    if (r() < 0.7) { const cx = (r() < 0.5 ? -1 : 1) * (w / 2 - 0.5), ch = intact ? 8 : r.range(4, 7); walls.push(xf(new THREE.BoxGeometry(1.1, ch, 0.9), [cx, ch / 2, 0])); walls.push(xf(new THREE.BoxGeometry(1.3, 0.25, 1.1), [cx, ch, 0])); }
    // fallen beams and rubble about the floor
    for (let k = 0; k < 4; k++) timber.push(xf(new THREE.BoxGeometry(0.16, 0.16, r.range(2, 4)), [r.range(-w / 3, w / 3), 0.2, r.range(-dpt / 3, dpt / 3)], [r.range(-0.08, 0.08), r() * TAU, r.range(-0.08, 0.08)]));
    for (let k = 0; k < 14; k++) { const sz = r.range(0.2, 0.55), lx = r.range(-w / 2 - 1.2, w / 2 + 1.2), lz = r.range(-dpt / 2 - 1.2, dpt / 2 + 1.2); const inside = Math.abs(lx) < w / 2 + 0.35 && Math.abs(lz) < dpt / 2 + 0.35; const [px, pz] = toW(lx, lz); walls.push(xf(new THREE.BoxGeometry(sz, sz * 0.6, sz * 0.8), [lx, sz * 0.2 + (inside ? 0 : this.heightAt(px, pz) - y), lz], [r() * 0.4, r() * 3, r() * 0.4])); }
    // the yard: barrels, crates, a woodpile against the wall, a cart, a fence
    this.dressYard(r, w, dpt, walls, timber, intact, (lx, lz) => { const [px, pz] = toW(lx, lz); return this.heightAt(px, pz) - y; });
    const plasterMat = this.plasterMat || (this.plasterMat = new THREE.MeshStandardMaterial({ color: 0xa89a82, roughness: 0.95, side: THREE.DoubleSide }));
    const voidMat = this.voidMat || (this.voidMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 }));
    const shingle = this.shingleMat || (this.shingleMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 0.9 }));
    for (const [list, m] of [[walls, brickMat], [timber, charMat], [plaster, plasterMat], [dark, voidMat], [roofs, shingle]]) {
      if (!list.length) continue; const mesh = new THREE.Mesh(merge(list), m); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh);
    }
    this.group.add(g);
    (this.ruinSpots || (this.ruinSpots = [])).push({ x, z });
  }

  dressYard(r, w, dpt, walls, timber, intact, gy) {
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
    // a wattle fence round part of the yard
    if (r() < 0.6) { const sz = r() < 0.5 ? 1 : -1; for (let k = 0; k < 8; k++) { if (r() < 0.2) continue; const fx = -w / 2 - 1.5 + k * (w + 3) / 7; T.push(xf(new THREE.BoxGeometry(0.08, 1.0, 0.08), [fx, 0.45, sz * (dpt / 2 + 4)])); if (k < 7 && r() > 0.25) T.push(xf(new THREE.BoxGeometry((w + 3) / 7, 0.55, 0.05), [fx + (w + 3) / 14, 0.5, sz * (dpt / 2 + 4)], [0, 0, r.range(-0.08, 0.08)])); } }
  }

  placeChurch(r, brickMat, charMat) {
    // the church of Saint Aldric beside the second altar, with its bell tower
    const a = this.altarT[1] || this.altarT[0];
    const t = a.t; const p = this.path.at(t), q = this.path.at(Math.min(1, t + 0.01));
    let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const x = a.x + nx * 22, z = a.z + nz * 22;
    const yaw = Math.atan2(nx, nz);
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
      if (k === 4 && s > 0) continue;                                   // the breach in the south wall
      const zc = -L / 2 + 1 + k * 2, broken = r() < 0.22;
      if (broken) { const h = r.range(2, 4); add(xf(new THREE.BoxGeometry(0.7, h, 2.0), [s * W / 2, h / 2, zc])); continue; }
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
      parts.push(xf(new THREE.CylinderGeometry(1.0, 1.1, 0.9, 14, 1, true), [wx, wy + 0.45, wz]), xf(new THREE.TorusGeometry(1.02, 0.12, 6, 16), [wx, wy + 0.9, wz], [PI / 2, 0, 0]));
      parts.push(xf(new THREE.CylinderGeometry(1.15, 1.2, 0.3, 14), [wx, wy - 0.1, wz]));
      const cx = 6, cz = L / 2 + 10, cy = gyC(cx, cz);
      for (let k = 0; k < 3; k++) parts.push(xf(new THREE.BoxGeometry(2.4 - k * 0.6, 0.3, 2.4 - k * 0.6), [cx, cy + 0.15 + k * 0.3 - 0.15, cz]));
      parts.push(xf(new THREE.BoxGeometry(0.3, 3.2, 0.3), [cx, cy + 2.35, cz]), xf(new THREE.BoxGeometry(1.3, 0.28, 0.28), [cx, cy + 3.2, cz]));
      this.addCollider(x + wx * C0 + wz * S0, z - wx * S0 + wz * C0, 1.2); this.addCollider(x + cx * C0 + cz * S0, z - cx * S0 + cz * C0, 1.0);
      this.wellTop = [wx, wy, wz]; }
    const m = new THREE.Mesh(merge(parts), brickMat); m.castShadow = m.receiveShadow = true; g.add(m);
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
    const tm = new THREE.Mesh(merge(trusses), charMat); tm.castShadow = true; g.add(tm);
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
  buildGrass() {
    const kind = this.ch.terrain.kind; if (kind === 'peak') return;
    const g1 = new THREE.PlaneGeometry(1.0, 0.7); g1.translate(0, 0.33, 0); const g2 = g1.clone(); g2.rotateY(PI / 2);
    const geo = merge([g1, g2]);
    const deadMat = new THREE.MeshStandardMaterial({ map: grassTexture(false), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xb0a090 });
    const aliveMat = new THREE.MeshStandardMaterial({ map: grassTexture(true), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    this.swayMaterial(deadMat, 0.18); this.swayMaterial(aliveMat, 0.22);
    const r = rng(this.ch.seed + 77);
    const dead = [];
    const nDead = Math.floor((kind === 'mountain' ? 3000 : 9000) * this.q.grass);
    for (let k = 0; k < nDead * 3 && dead.length < nDead; k++) {
      const x = r.range(-HALF + 20, HALF - 20), z = r.range(-HALF + 20, HALF - 20);
      if (kind === 'fen' && this.heightAt(x, z) < 0.05) continue;
      if (this.normalAt(x, z).y < 0.82) continue;
      if (this.lifeAt(x, z) > 0.5) continue;
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
        if (Math.hypot(x - a.x, z - a.z) < 3.2) continue;
        list.push({ x, y: this.heightAt(x, z) - 0.04, z, ry: r() * TAU, s: 0.0001, target: r.range(0.8, 1.5), d, altar: a });
      }
    }
    // the living country the knights ride out from
    if (kind !== 'peak') {
      const n0 = list.length, want = Math.floor(5000 * this.q.grass);
      for (let k = 0; k < want * 2 && list.length - n0 < want; k++) {
        const x = r.range(-HALF + 6, HALF - 6), z = r.range(-HALF + 4, -95);
        if (this.lifeAt(x, z) < 0.6 || this.normalAt(x, z).y < 0.8) continue;
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
      sh.uniforms.uTime = uT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvW = (modelMatrix * vec4(position,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vW; uniform float uTime;')
        .replace('#include <normal_fragment_maps>', `
          vec3 n1 = texture2D(normalMap, vW * 0.08 + vec2(uTime * 0.01, uTime * 0.006)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, vW * 0.13 - vec2(uTime * 0.008, -uTime * 0.012)).xyz * 2.0 - 1.0;
          vec3 nn = normalize(vec3((n1.xy + n2.xy) * 0.18, 1.0));
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
    // village fires: nearest few get lights
    if (this.fires.length && camPos) {
      const near = this.fires.map((f) => [f, (f.x - camPos.x) ** 2 + (f.z - camPos.z) ** 2]).sort((a, b) => a[1] - b[1]);
      this.fireLights.forEach((l, i) => { const f = near[i]?.[0]; if (!f || near[i][1] > 90 * 90) { l.intensity = 0; return; } l.position.set(f.x, f.y + 1.2, f.z); l.intensity = (6 + Math.sin(this.time * 17 + i * 3) * 1.5 + Math.sin(this.time * 7.3 + i) * 1.5) * f.s; });
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
      if (this.ch.terrain.kind === 'mountain') { const n = this.path.nearest(x, z); if (n.d > 11) continue; }
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
