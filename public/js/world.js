// Deterministic world generation per chapter: heightfield, the blight / life
// terrain shader, props, altars, colliders, water and the healing of the land.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { icoSmooth } from './demons.js';
import { CHAPTERS, HEALED } from './chapters.js';
import { terrainTextures, stoneTextures, barkTextures, woodTextures, grassTexture, demonTextures, clothTextures, armorTextures } from './textures.js';
import { rng, makeNoise, pathSampler, clamp, lerp, smooth, SpatialHash, TAU } from './util.js';

const HALF = 150, N = 257, CELL = (HALF * 2) / (N - 1);
const PI = Math.PI;

function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  return g;
}
function clean(g) { for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.index) { const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(i); g.setIndex(a); } return g; }
function merge(list) { return mergeGeometries(list.map(clean)); }
function lumpy(g, amt, seed) { // perturb a rock along its normals
  const n = makeNoise(seed); const p = g.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + n.fbm(v.x * 1.7 + seed, v.y * 1.7 + v.z * 1.3, 4) * amt; v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
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
    this.buildAltars();
    this.buildProps();
    this.buildGrass();
    if (this.ch.terrain.water !== undefined) this.buildWater();
    if (this.ch.terrain.kind === 'peak') this.buildCloudSea();
    engine.setAtmosphere(this.ch.atmos);
    this.baseAtmos = this.ch.atmos;
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
      const side = i % 2 ? 1 : -1; const off = this.ch.devil.close ? r.range(32, 42) : r.range(48, 66);
      let x = clamp(p.x + nx * side * off, -HALF + 30, HALF - 30), z = clamp(p.z + nz * side * off, -HALF + 30, HALF - 30);
      this.devilSpots.push({ x, z, t, hill: this.ch.terrain.hill });
    }
  }

  baseHeight(x, z) {
    const T = this.ch.terrain, n = this.noise;
    let h;
    switch (T.kind) {
      case 'fen': h = n.fbm(x * 0.012, z * 0.012, 5) * T.amp - 0.4 + n.fbm(x * 0.05, z * 0.05, 3) * 0.6; break;
      case 'mountain': h = n.ridge(x * 0.012, z * 0.012, 5) * T.amp * 2.2 + n.fbm(x * 0.03, z * 0.03, 4) * 4; break;
      case 'peak': {
        const r = Math.hypot(x, z);
        h = n.fbm(x * 0.05, z * 0.05, 3) * 0.6;
        if (r > 34) h -= (r - 34) * 1.8 + 50 * smooth(clamp((r - 36) / 30, 0, 1)) + n.ridge(x * 0.03, z * 0.03, 4) * 14 * smooth(clamp((r - 34) / 10, 0, 1));
        return h;
      }
      default: h = n.fbm(x * 0.009, z * 0.009, 5) * T.amp + n.ridge(x * 0.02, z * 0.02, 4) * T.amp * 0.25;
    }
    for (const s of this.devilSpots) { const d2 = (x - s.x) ** 2 + (z - s.z) ** 2; h += s.hill * Math.exp(-d2 / (2 * 16 * 16)); }
    if (T.edge) { const e = Math.max(Math.abs(x), Math.abs(z)); h += smooth(clamp((e - (HALF - T.edge)) / T.edge, 0, 1)) * 55 + (e > HALF - T.edge ? n.ridge(x * 0.03, z * 0.03, 3) * 10 : 0); }
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
        if (d < 18) { const ah = this.altarHeightGuess(a); h = lerp(ah, h, smooth(clamp((d - 9) / 9, 0, 1))); }
      }
      H[j * N + i] = h;
    }
    for (const a of altars) a.y = this.heightAt(a.x, a.z);
    for (const s of this.devilSpots) s.y = this.heightAt(s.x, s.z);
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
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.8; const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z), hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  // ---------------------------------------------------------------- terrain
  buildTerrain() {
    const seg = this.q.terrainSeg;
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
      uSize: { value: HALF * 2 }, uTile: { value: 0.22 }, uSnowLine: { value: T.kind === 'mountain' ? 85 : T.kind === 'peak' ? -6 : 9999 },
      uWater: { value: T.water !== undefined ? 0.0 : -9999 }, uEmber: { value: this.ch.id === 'peak' || this.ch.id === 'field' ? 1.6 : 0.9 }, uNStr: { value: 1.0 },
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
        uniform float uSize, uTile, uSnowLine, uWater, uEmber, uNStr; uniform vec3 uDeadTint, uAliveTint;`)
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
        vec3 tcol = mix(ground, rock.rgb * mix(0.62, 1.0, aliveMix), rockMix);
        float snow = smoothstep(uSnowLine, uSnowLine + 10.0, vWPos.y + rock.a * 5.0) * (1.0 - rockMix * 0.5);
        tcol = mix(tcol, texture2D(tSnow, wuv).rgb, snow);
        float wet = 1.0 - smoothstep(uWater - 0.2, uWater + 0.7, vWPos.y);
        tcol *= mix(1.0, 0.5, wet);
        diffuseColor.rgb = tcol;
        float ember = (1.0 - aliveMix) * (1.0 - rockMix) * (1.0 - snow) * smoothstep(0.06, 0.16, (dead.r - dead.g) * 2.0);
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
      for (let s = 0; s < 3; s++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(3.2 - s * 0.6, 3.3 - s * 0.6, 0.26, 8), stone); m.position.y = 0.13 + s * 0.26; m.receiveShadow = m.castShadow = true; g.add(m); }
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
    const lim = HALF - (this.ch.terrain.edge ? this.ch.terrain.edge * 0.55 : 4);
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
    const r = rng(seed); const parts = []; const tips = [];
    const branch = (start, dir, len, rad, depth) => {
      const pts = [start.clone()]; let p = start.clone(), d = dir.clone();
      const segs = 4;
      for (let s = 0; s < segs; s++) { d.add(new THREE.Vector3(r.range(-0.35, 0.35), r.range(-0.1, 0.2), r.range(-0.35, 0.35))).normalize(); p = p.clone().addScaledVector(d, len / segs); pts.push(p); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tg = new THREE.TubeGeometry(curve, 6, rad, depth === 0 ? 7 : 5, false);
      // taper
      const pos = tg.attributes.position; const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const ring = Math.floor(i / ((depth === 0 ? 7 : 5) + 1)); const t = ring / 6; const c = curve.getPoint(t);
        v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - t * 0.6).add(c); pos.setXYZ(i, v.x, v.y, v.z);
      }
      tg.computeVertexNormals(); parts.push(tg);
      if (depth >= (style === 'pine' ? 3 : 3) || rad < 0.03) { tips.push(p.clone()); return; }
      const kids = style === 'pine' ? 0 : r.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const t = r.range(0.45, 1.0); const sp = curve.getPoint(t);
        const nd = d.clone().add(new THREE.Vector3(r.range(-1, 1), r.range(-0.2, 0.6), r.range(-1, 1))).normalize();
        branch(sp, nd, len * r.range(0.5, 0.75), rad * 0.55, depth + 1);
      }
      if (style === 'pine' && depth === 0) {
        for (let k = 0; k < 14; k++) { const t = 0.25 + (k / 14) * 0.7; const sp = curve.getPoint(t); const a = k * 2.4; const nd = new THREE.Vector3(Math.cos(a), -0.2, Math.sin(a)); branch(sp, nd, (1 - t) * 3 + 0.6, 0.035, 3); }
      }
    };
    const H = style === 'pine' ? r.range(9, 14) : r.range(6, 10);
    branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 1, 0), H * (style === 'pine' ? 1 : 0.55), style === 'pine' ? 0.22 : 0.3, 0);
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
      for (let v = 0; v < 4; v++) variants.push(this.treeGeometry(this.ch.seed * 7 + v, v === 3 && P.pines ? 'oak' : style));
      const lists = variants.map(() => []);
      const leafList = [];
      const dense = kind === 'wood';
      this.scatter(P.deadTrees, (x, z) => this.okSpot(x, z, dense ? 7 : 9, 16) && (kind !== 'fen' || this.heightAt(x, z) > -0.3), (x, z, y) => {
        const v = r.int(0, 3); const s = r.range(0.8, 1.35);
        const it = { x, y: y - 0.1, z, ry: r() * TAU, s, rx: r.range(-0.06, 0.06), rz: r.range(-0.06, 0.06) };
        lists[v].push(it); this.addCollider(x, z, 0.45 * s);
        for (const tip of variants[v].tips) if (r() < 0.6) {
          const c = Math.cos(it.ry), sn = Math.sin(it.ry);
          leafList.push({ x: x + (tip.x * c + tip.z * sn) * s, y: y + tip.y * s, z: z + (-tip.x * sn + tip.z * c) * s, s: 0, target: r.range(1.0, 1.8) * s, ry: r() * TAU });
        }
      });
      variants.forEach((v, i) => this.instanced(v.geo, barkMat, lists[i]));
      // foliage (hidden until healed)
      const leafGeo = lumpy(icoSmooth(1), 0.3, 5);
      const leafMat = new THREE.MeshStandardMaterial({ color: P.pines ? 0x2c4a2c : 0x4a6a2a, roughness: 0.9, flatShading: true });
      this.leaves = { mesh: this.instanced(leafGeo, leafMat, leafList.map((l) => ({ ...l, s: 0.0001 }))), list: leafList };
    }
    // --- rocks & crags
    if (P.rocks || P.crags) {
      const rocks = []; for (let v = 0; v < 5; v++) rocks.push(lumpy(icoSmooth(2), 0.35, 30 + v));
      const lists = rocks.map(() => []);
      this.scatter(P.rocks || 0, (x, z) => this.okSpot(x, z, 4, 11), (x, z, y) => { const s = r.range(0.4, 1.6); lists[r.int(0, 4)].push({ x, y: y - s * 0.3, z, s, sy: s * r.range(0.6, 1), ry: r() * TAU }); if (s > 0.9) this.addCollider(x, z, s * 0.8); });
      if (P.crags) this.scatter(P.crags, (x, z) => kind === 'peak' ? Math.hypot(x, z) > 30 && Math.hypot(x, z) < 50 : this.okSpot(x, z, 11, 14), (x, z, y) => { const s = r.range(2.5, 6); lists[r.int(0, 4)].push({ x, y: y + s * 0.4, z, s, sy: s * r.range(1.4, 2.6), ry: r() * TAU, rx: r.range(-0.2, 0.2), rz: r.range(-0.2, 0.2) }); this.addCollider(x, z, s * 0.85); });
      if (kind === 'peak') { // ring of spires around the summit arena
        for (let k = 0; k < 22; k++) { const a = (k / 22) * TAU + r.range(-0.1, 0.1); const d = r.range(34, 40); const x = Math.cos(a) * d, z = Math.sin(a) * d; const s = r.range(2, 4.5); lists[k % 5].push({ x, y: this.heightAt(x, z) + s * 0.8, z, s, sy: s * r.range(2, 3.5), ry: r() * TAU, rx: r.range(-0.15, 0.15) }); }
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
        if (!this.okSpot(x, z, 3, 9)) continue;
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
    const w = r.range(5, 8), dpt = r.range(4, 6), y = this.heightAt(x, z), yaw = r() * TAU;
    const g = new THREE.Group(); g.position.set(x, y - 0.2, z); g.rotation.y = yaw;
    const walls = [];
    const wall = (len, cx, cz, rot) => {
      const segs = Math.ceil(len / 1.0);
      for (let s = 0; s < segs; s++) {
        if (r() < 0.18) continue; // collapsed gap
        const h = r() < 0.3 ? r.range(0.6, 1.6) : r.range(2.2, 3.4);
        const b = new THREE.BoxGeometry(len / segs + 0.02, h, 0.42); xf(b, [-len / 2 + (s + 0.5) * len / segs, h / 2, 0]);
        xf(b, [cx, 0, cz], [0, rot, 0]); walls.push(b);
        const lx = -len / 2 + (s + 0.5) * len / segs; const c = Math.cos(rot), sn = Math.sin(rot);
        const wx = cx + lx * c, wz = cz - lx * sn; const C = Math.cos(yaw), S = Math.sin(yaw);
        this.addCollider(x + wx * C + wz * S, z - wx * S + wz * C, 0.6);
      }
    };
    wall(w, 0, dpt / 2, 0); wall(w, 0, -dpt / 2, 0); wall(dpt, w / 2, 0, PI / 2); wall(dpt, -w / 2, 0, PI / 2);
    const m = new THREE.Mesh(merge(walls), brickMat); m.castShadow = m.receiveShadow = true; g.add(m);
    // charred roof beams and fallen rafters
    const beams = [];
    for (let k = 0; k < 5; k++) { const b = new THREE.BoxGeometry(0.18, 0.18, dpt + 1); xf(b, [-w / 2 + (k + 0.5) * w / 5, 3.0 + r.range(-0.3, 0.2), 0], [r.range(-0.3, 0.3), 0, r.range(-0.2, 0.2)]); if (r() < 0.7) beams.push(b); }
    for (let k = 0; k < 3; k++) { const b = new THREE.BoxGeometry(0.16, 0.16, r.range(2, 4)); xf(b, [r.range(-w / 3, w / 3), r.range(0.3, 1.5), r.range(-dpt / 3, dpt / 3)], [r.range(-1, 1), r() * TAU, r.range(-1, 1)]); beams.push(b); }
    const bm = new THREE.Mesh(merge(beams), charMat); bm.castShadow = true; g.add(bm);
    this.group.add(g);
    (this.ruinSpots || (this.ruinSpots = [])).push({ x, z });
  }

  placeChurch(r, brickMat, charMat) {
    // the church of Saint Aldric beside the second altar, with its bell tower
    const a = this.altarT[1] || this.altarT[0];
    const t = a.t; const p = this.path.at(t), q = this.path.at(Math.min(1, t + 0.01));
    let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const x = a.x + nx * 22, z = a.z + nz * 22; const y = this.heightAt(x, z);
    const yaw = Math.atan2(nx, nz);
    const g = new THREE.Group(); g.position.set(x, y - 0.3, z); g.rotation.y = yaw;
    const parts = [];
    const W = 9, L = 20, Hh = 7;
    const add = (geo) => parts.push(geo);
    for (const s of [-1, 1]) for (let k = 0; k < 10; k++) { if (k === 4 && s > 0) continue; const h = r() < 0.25 ? r.range(2, 4) : Hh; add(xf(new THREE.BoxGeometry(0.7, h, 2.0), [s * W / 2, h / 2, -L / 2 + 1 + k * 2])); }
    add(xf(new THREE.BoxGeometry(W, Hh, 0.7), [0, Hh / 2, -L / 2]));
    // west front with doorway, and the bell tower
    add(xf(new THREE.BoxGeometry(3, Hh, 0.7), [-3, Hh / 2, L / 2])); add(xf(new THREE.BoxGeometry(3, Hh, 0.7), [3, Hh / 2, L / 2])); add(xf(new THREE.BoxGeometry(3, 2.5, 0.7), [0, Hh - 1.25, L / 2]));
    add(xf(new THREE.BoxGeometry(4, 15, 4), [0, 7.5, L / 2 + 2.2])); add(xf(new THREE.ConeGeometry(3.1, 5, 4), [0, 17.5, L / 2 + 2.2], [0, PI / 4, 0]));
    const m = new THREE.Mesh(merge(parts), brickMat); m.castShadow = m.receiveShadow = true; g.add(m);
    const trusses = [];
    for (let k = 0; k < 8; k++) { if (r() < 0.35) continue; const b = new THREE.BoxGeometry(W + 1, 0.25, 0.25); xf(b, [0, Hh + 0.3, -L / 2 + 1.5 + k * 2.4], [0, 0, r.range(-0.15, 0.15)]); trusses.push(b); const rf = new THREE.BoxGeometry(0.2, 0.2, 6); xf(rf, [r.range(-3, 3), Hh + 1.6, -L / 2 + 1.5 + k * 2.4], [0.6, 0, 0]); trusses.push(rf); }
    const tm = new THREE.Mesh(merge(trusses), charMat); tm.castShadow = true; g.add(tm);
    this.group.add(g);
    const C = Math.cos(yaw), S = Math.sin(yaw);
    const toW = (lx, lz) => [x + lx * C + lz * S, z - lx * S + lz * C];
    for (let k = 0; k < 10; k++) for (const s of [-1, 1]) { if (k === 4 && s > 0) continue; const [cx, cz] = toW(s * W / 2, -L / 2 + 1 + k * 2); this.addCollider(cx, cz, 1.0); }
    for (let k = -4; k <= 4; k++) { const [cx, cz] = toW(k, -L / 2); this.addCollider(cx, cz, 0.6); }
    for (const lx of [-4, -3, -2, 2, 3, 4]) { const [cx, cz] = toW(lx, L / 2); this.addCollider(cx, cz, 0.6); }
    { const [cx, cz] = toW(0, L / 2 + 2.2); this.addCollider(cx, cz, 2.6); }
    const bf = toW(0, L / 2 + 2.2);
    this.belfry = new THREE.Vector3(bf[0], y + 13, bf[1]);
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
      uniforms: { uTime: uT, c1: { value: new THREE.Color(0x5a2418) }, c2: { value: new THREE.Color(0xd06a3a) }, fogC: { value: new THREE.Color(this.ch.atmos.fog) } },
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
    const m = new THREE.Mesh(g, mat); m.position.y = -62; this.group.add(m);
  }

  // ---------------------------------------------------------------- the land heals
  cleanse(i, instant = false) {
    const a = this.altars[i]; if (!a || a.state === 'cleansed') return;
    a.state = 'cleansed'; a.progress = 1;
    a.candles.visible = true;
    this.healAnims.push({ a, t: instant ? 99 : 0 });
    this.healedFrac = this.altars.filter((x) => x.state === 'cleansed').length / this.altars.length;
  }

  update(dt, camPos) {
    this.time += dt;
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
    this.scene.remove(this.group);
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const m = Array.isArray(o.material) ? o.material : [o.material]; m.forEach((x) => x.dispose()); } });
  }
}
