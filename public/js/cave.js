// The cave on the Ascent. Near the top the way goes into the mountain, and through it: a real cave, planned in
// world.js (CavePlan) with its own winding line from a mouth low on the shoulder to a mouth above it. A gully leads
// up to the first mouth, an arch in a face of rock with an overhang and fallen blocks round it, and at its foot
// three of the Emperor's soldiers who got that far, and the torch one of them carried: take it up and light it,
// or you go no further. Beyond, a short passage drops by a slope of rubble into the Hall, a low chamber full of
// dripping water with a black pool in it; the long tunnel climbs from there beside a stream, narrow and low, to
// the Nave, a high chamber whose floor climbs in terraces of flowstone under a crack far up in its roof that lets
// in a thread of grey light; a rift goes up from it by ledges to the Vault, round, its floor deep mud; and a last
// long passage climbs over rubble to the daylight. Blind galleries run off each chamber into the black.
//
// Inside, He does what He can to make you turn back, slowly at first: a voice at the mouth; the dead man in the
// Hall; your own footsteps coming back to you wrong down the long tunnel; the torch all but dying, and in its
// last flickers something standing at the edge of the light, nearer each time, and gone when the light comes
// back; breathing close behind you; in the Nave, something crossing the roof through the thread of light; the
// dead man from the Hall sitting in the Nave; your name, from the galleries, then at your ear; a pale hand round
// the corner at the top of the rift, drawing back as you come; Him over your head on the Vault's roof; and in
// the last passage, something coming up behind you in the dark that you never see, all the way to the light.
//
// The walls: each passage is a shell swept along its line (a superellipse arch on the walkable floor, broken
// and lumpy), each chamber a dome; where they meet, each is opened where it runs into the other (the wall shader
// discards what lies inside the other's volume), so the junctions are clean. The floor is one mesh over the
// whole plan, drawn exactly on the heightfield the knights walk on. The ground that is drawn over the mountain
// is whole (world.Hv) except at the two arches, cut out of it (the terrain shader).
import * as THREE from 'three';
import { phantomDevil, releasePhantom } from './devil.js';
import { makeFlame } from './flame.js';
import { makeFrozen } from './people.js';
import { caveProfile, CAVE_POW } from './world.js';
import { makeNoise, rng, clamp, lerp, smooth, damp, TAU } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FOG = new THREE.Color(0x0b0a09);
const sgp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

export class Cave {
  constructor(game) {
    this.g = game; const W = this.W = game.world; this.S = W.caveSys; this.C = W.cave;
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.noise = makeNoise(4711); this.r = rng(4711);
    this.done = {}; this.torch = null; this.inside = 0; this.inCam = 0; this.u = -1; this.prog = -1; this.base = null; this.time = 0;
    this.flame = 1; this.flameAct = 1; this.act = null; this.queue = []; this.drops = []; this.walked = 0; this.echoQ = [];
    this.uni = { uCuts: { value: [] }, uAmb: { value: new THREE.Color(0, 0, 0) }, uTime: { value: 0 } };
    this.frustum = new THREE.Frustum(); this._m = new THREE.Matrix4();
    this.buildMaterials(); this.buildWalls(); this.buildFloor(); this.buildWater(); this.buildDressing(); this.buildMouths(); this.buildScares();
    this.marks();
  }

  // ---------------------------------------------------------------- materials: the mountain's own rock, wet
  buildMaterials() {
    const U = this.W.terrainUniforms, S = this.S, NC = S.cuts.length;
    this.uni.uCuts.value = []; for (const c of S.cuts) this.uni.uCuts.value.push(new THREE.Vector4(c[0], c[1], c[2], c[3]), new THREE.Vector4(c[4], c[5], c[6], c[7]), new THREE.Vector4(c[8], c[9], c[10], c[11]));
    const P = CAVE_POW.toFixed(2);
    const patch = (mat, key) => {
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.uni);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aWet; attribute float aDeep; attribute float aPiece; varying float vWet; varying float vDeep; varying float vPiece; varying vec3 vCW;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWet = aWet; vDeep = aDeep; vPiece = aPiece;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying float vWet; varying float vDeep; varying float vPiece; varying vec3 vCW;
          uniform vec4 uCuts[${Math.max(3, NC * 3)}]; uniform vec3 uAmb; uniform float uTime;
          float cvh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          // is this point inside another piece of the cave (so this piece's wall must open there)?
          bool caveCut(vec3 p, float piece) {
            for (int i = 0; i < ${NC}; i++) {
              vec4 A = uCuts[i * 3], B = uCuts[i * 3 + 1], Q = uCuts[i * 3 + 2];
              if (abs(A.w - piece) > 0.5) continue;
              if (A.z < 1.5) {   // a chamber's dome
                vec2 d = p.xz - A.xy; float th = atan(d.y, d.x);
                float q = length(d) / (B.x * (1.0 + B.w * cos(th - Q.x) + Q.y * cos(2.0 * th - Q.z)) * 0.97), hy = (p.y - B.z) / B.y;
                if (hy > -0.25 && (hy < 0.0 ? q < 1.0 : pow(q, ${P}) + pow(hy, ${P}) < 1.0)) return true;
              } else {           // a passage's end
                vec2 ab = B.xy - A.xy; float t = dot(p.xz - A.xy, ab) / dot(ab, ab); if (t < 0.0 || t > 1.0) continue;
                float la = length(p.xz - A.xy - ab * t) / B.z, hy = (p.y - Q.x) / B.w;
                if (hy > -0.4 && (hy < 0.0 ? la < 1.0 : pow(la, ${P}) + pow(hy, ${P}) < 1.0)) return true;
              }
            }
            return false;
          }`)
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          ${NC ? 'if (vPiece > -0.5 && caveCut(vCW, vPiece)) discard;' : ''}
          float deepK = smoothstep(0.5, 6.0, vDeep);`)
          .replace('#include <color_fragment>', `#include <color_fragment>
          float runK = floor(vCW.x * 2.6 + vCW.z * 2.6);
          float streak = smoothstep(0.62, 1.0, cvh(vec2(runK, 0.0))) * (0.55 + 0.45 * sin(vCW.y * 1.7 + cvh(vec2(runK, 1.0)) * 6.0));
          float wet = clamp(vWet + streak * 0.6 * step(0.08, vWet), 0.0, 1.0);
          diffuseColor.rgb *= 1.0 - 0.3 * wet;`)
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.13, wet);')
          .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= 1.0 - deepK;'))
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= 1.0 - 0.95 * deepK; reflectedLight.indirectSpecular *= 1.0 - 0.9 * deepK;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uAmb * (0.3 + 0.7 * deepK);');
      };
      mat.customProgramCacheKey = () => key + NC;
      return mat;
    };
    const map = U.tRock.value, nmap = U.tRockN.value;
    this.rock = patch(new THREE.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(1.5, 1.5), vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide }), 'caveRock');
    this.floorMat = patch(new THREE.MeshStandardMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 0.86, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'caveFloor');
  }
  // colour, wetness, depth into the cave and which piece it belongs to, for every vertex of a geometry
  paint(geo, piece, fn) {
    const S = this.S, P = geo.attributes.position, n = P.count, col = new Float32Array(n * 3), wet = new Float32Array(n), deep = new Float32Array(n), pc = new Float32Array(n).fill(piece), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), e = S.sample(x, z);
      deep[i] = e && !e.out ? clamp(Math.min(e.prog - S.sA, S.sB - e.prog), 0, 99) : 0;
      wet[i] = fn.call(this, x, y, z, c, e); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    geo.setAttribute('aDeep', new THREE.BufferAttribute(deep, 1)); geo.setAttribute('aPiece', new THREE.BufferAttribute(pc, 1));
    return geo;
  }
  // the rock of the walls: grey limestone in beds, some ochre, dark seams between; pale crusts of calcite where
  // water runs (and whole walls of white flowstone in the Nave), iron-red in the Vault; wet low down
  wallColor(x, y, z, c, e) {
    const n = this.noise, piece = e ? e.piece : -1, hy = e ? y - e.floor : 2;
    const w = y * 1.25 + n.fbm(x * 0.07, z * 0.07, 2) * 4 + n.fbm(x * 0.5 + 3, z * 0.5, 2) * 0.6, band = 0.5 + 0.5 * Math.sin(w), seam = 0.5 + 0.5 * Math.sin(w * 2.9 + 1.7);
    let r = lerp(0.36, 0.5, band), g = lerp(0.34, 0.38, band), b = lerp(0.32, 0.27, band);
    if (seam > 0.86) { r *= 0.55; g *= 0.55; b *= 0.55; }
    const v = 0.85 + n.fbm(x * 0.9, z * 0.9 + y, 2) * 0.3; r *= v; g *= v; b *= v;
    const calc = clamp((n.fbm(x * 0.18 + 11, z * 0.18 - y * 0.15, 3) - (piece === 1 ? 0.3 : 0.55)) * 3, 0, 1) * (piece === 1 ? 1 : 0.7);
    r = lerp(r, 0.8, calc); g = lerp(g, 0.74, calc); b = lerp(b, 0.6, calc);
    if (piece === 2 || piece === 6) { const fe = clamp((n.fbm(x * 0.3 + 5, y * 0.4, 2) - 0.5) * 3, 0, 1) * 0.7; r = lerp(r, 0.5, fe); g = lerp(g, 0.25, fe); b = lerp(b, 0.14, fe); }
    c.setRGB(r, g, b);
    return clamp(0.6 - hy * 0.3, 0, 0.75) + (piece === 0 || piece === 1 ? 0.25 : 0.05) + calc * 0.25;
  }
  // the floor: grit and rubble; silt by the Hall's pool; the long tunnel's stream-bed of sand; the Nave's
  // flowstone, cream and orange; the Vault's black mud
  floorColor(x, y, z, c, e) {
    const n = this.noise, piece = e ? e.piece : -1, v = 0.8 + n.fbm(x * 1.3, z * 1.3, 2) * 0.4, sp = n.fbm(x * 0.35 + 9, z * 0.35, 2);
    let r = 0.32, g = 0.3, b = 0.28, wet = 0.3;
    if (piece === 0) { r = 0.34; g = 0.3; b = 0.25; wet = 0.55; }
    else if (piece === 4) { const bed = clamp((sp - 0.45) * 3, 0, 1); r = lerp(0.24, 0.45, bed); g = lerp(0.23, 0.38, bed); b = lerp(0.22, 0.28, bed); wet = 0.7; }
    else if (piece === 1) { const o = clamp((sp - 0.4) * 2.5, 0, 1); r = lerp(0.72, 0.62, o); g = lerp(0.62, 0.42, o); b = lerp(0.46, 0.26, o); wet = 0.85; }
    else if (piece === 5) { r = 0.4; g = 0.34; b = 0.26; wet = 0.35; }
    else if (piece === 2) { r = 0.17; g = 0.12; b = 0.085; wet = 0.9; }
    else if (piece === 6) { r = 0.36; g = 0.34; b = 0.32; wet = 0.15; }
    for (const P of this.S.pools) { const d = Math.hypot(x - P.x, z - P.z); if (d < P.r + 1.2) { const k = smooth(clamp(1 - (d - P.r) / 1.2, 0, 1)); r *= 1 - 0.35 * k; g *= 1 - 0.35 * k; b *= 1 - 0.3 * k; wet = Math.max(wet, k); } }
    c.setRGB(r * v, g * v, b * v); return wet;
  }

  // ---------------------------------------------------------------- the walls
  buildWalls() {
    const S = this.S, W = this.W, n = this.noise; this.walls = [];
    const P2 = 2 / CAVE_POW, visClamp = (x, y, z, ok) => ok ? Math.min(y, W.visualHeightAt(x, z) - 0.8) : y;
    // each passage: rings swept along its line
    for (const T of S.tubes) {
      const list = T.kind === 'main' ? T.S.filter((m) => m.s >= S.sA - 1.6 && m.s <= S.sB + 1.6) : T.S;
      if (list.length < 2) continue;
      const NA = 30, RL = NA + 3, pos = [], uv = [], idx = []; const s0 = list[0].s, s1 = list[list.length - 1].s;
      for (let i = 0; i < list.length; i++) {
        const m = list[i], nx = -m.tz, nz = m.tx;
        const dPort = T.kind === 'main' ? Math.min(Math.abs(m.s - S.sA), Math.abs(m.s - S.sB)) : 99;
        const fP = smooth(clamp((dPort - 1.2) / 3, 0, 1));
        const dEnd = Math.min(T.from ? m.s - s0 : 99, T.to ? s1 - m.s : 99), fJ = 0.35 + 0.65 * smooth(clamp((dEnd - 1) / 3, 0, 1));
        const amp = (0.1 + 0.16 * m.W) * (0.15 + 0.85 * fP) * fJ, lean = m.W * 0.3 * (n.fbm(m.s * 0.08 + T.id, 3.3, 2) - 0.45) * fP;
        const inner = !(T.kind === 'main' && dPort < 2.5);
        const ring = []; let arc = 0, px = 0, py = 0;
        const put = (lat, y) => { const x = m.x + nx * lat, z = m.z + nz * lat; y = visClamp(x, y, z, inner); if (ring.length) arc += Math.hypot(lat - px, y - py); px = lat; py = y; pos.push(x, y, z); uv.push(arc / 2.0, m.s / 2.0); ring.push(1); };
        let d0 = 0, dN = 0; const arch = [];
        for (let k = 0; k <= NA; k++) {
          const ph = Math.PI * k / NA, cs = Math.cos(ph), sn = Math.sin(ph);
          let d = amp * ((n.fbm(m.s * 0.42 + T.id * 17, ph * 1.7 + T.id, 3) * 2 - 0.85) + 0.6 * (n.ridge(m.s * 0.9 + T.id, ph * 3.1, 2) - 0.5));
          if (sn < 0.4) d = Math.max(d, -0.04);
          const lat = -sgp(cs, P2) * m.W - cs * d + lean * sn * sn, y = m.fb + Math.pow(Math.max(0, sn), P2) * m.Ht + sn * d;
          arch.push([lat, y]); if (k === 0) d0 = d; if (k === NA) dN = d;
        }
        const bR = -(m.W + Math.max(0, d0) + 0.12), bL = m.W + Math.max(0, dN) + 0.12;
        put(bR, W.heightAt(m.x + nx * bR, m.z + nz * bR) - 1.2); for (const [lat, y] of arch) put(lat, y); put(bL, W.heightAt(m.x + nx * bL, m.z + nz * bL) - 1.2);
      }
      for (let i = 0; i < list.length - 1; i++) for (let k = 0; k < RL - 1; k++) { const a = i * RL + k, b = a + RL; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      // a blind gallery ends in a crack: close it
      if (T.kind === 'gallery') { const m = list[list.length - 1], c = pos.length / 3, base = (list.length - 1) * RL; pos.push(m.x + m.tx * 0.3, m.fb + 0.25, m.z + m.tz * 0.3); uv.push(0, 0); for (let k = 0; k < RL - 1; k++) idx.push(base + k, c, base + k + 1); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
      this.paint(geo, T.id, this.wallColor); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.rock); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.piece = T.id; this.group.add(mesh); this.walls.push(mesh);
    }
    // each chamber: a dome on its floor, broken and lumpy; the Nave's walls hung with curtains of flowstone
    for (const Ch of S.chambers) {
      const NT = 104, NP = 26, RL = NP + 2, pos = [], uv = [], idx = [], a3 = 0.035, p3 = Ch.id * 2.1;
      const mouthNear = (th) => { let f = 1; for (const M of Ch.mouths) { const mt = Math.atan2(M.z - Ch.z, M.x - Ch.x); let d = Math.abs(Math.atan2(Math.sin(th - mt), Math.cos(th - mt))); const wa = (M.W + 1.6) / Ch.R; f = Math.min(f, 0.3 + 0.7 * smooth(clamp((d - wa) / 0.25, 0, 1))); } return f; };
      for (let j = 0; j <= NT; j++) {
        const th = (j / NT) * TAU, rr = S.rAt(Ch, th) * (1 + a3 * Math.cos(3 * th - p3)), cth = Math.cos(th), sth = Math.sin(th), mf = mouthNear(th);
        let arc = 0, pr = 0, py = 0;
        const put = (rho, y, first) => { const x = Ch.x + cth * rho, z = Ch.z + sth * rho; y = Math.min(y, W.visualHeightAt(x, z) - 0.8); if (!first) arc += Math.hypot(rho - pr, y - py); pr = rho; py = y; pos.push(x, y, z); uv.push(j / NT * TAU * Ch.R / 2.4, arc / 2.4); };
        const ring = [];
        for (let k = 0; k <= NP; k++) {
          const ph = (Math.PI / 2) * k / NP, q = Math.pow(Math.max(0, Math.cos(ph)), P2), h = Math.pow(Math.min(1, Math.max(0, Math.sin(ph))), P2);
          let d = 0.09 * Ch.R * (1 - 0.6 * h) * (n.fbm(th * 2.4 * Ch.R / 8 + Ch.id * 5, ph * 2.2, 3) * 2 - 0.85) * (h < 0.45 ? mf : 1);
          if (Ch.name === 'nave') d += 0.06 * Ch.R * Math.max(0, Math.sin(th * 34 + n.fbm(th * 3, 1.5, 2) * 5)) * Math.pow(1 - h, 1.5) * mf;   // curtains of flowstone
          if (h < 0.25) d = Math.max(d, -0.03 * Ch.R);
          d *= 1 - Math.pow(h, 4);
          const rho = rr * q + d * Math.pow(q, 0.3), x = Ch.x + cth * rho, z = Ch.z + sth * rho;
          const y = S.floorSmooth(Ch, x, z) + Ch.Hc * h * (1 + 0.14 * (n.fbm(th * 3 + Ch.id, ph * 3, 2) - 0.45) * (1 - Math.pow(h, 4))) + d * 0.4 * h;
          ring.push([rho, y]);
        }
        const rb = rr * 1.03 + Math.max(0, ring[0][0] - rr);
        put(rb, W.heightAt(Ch.x + cth * rb, Ch.z + sth * rb) - 1.2, true); for (const [rho, y] of ring) put(rho, y);
      }
      for (let j = 0; j < NT; j++) for (let k = 0; k < RL - 1; k++) { const a = j * RL + k, b = a + RL; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
      this.paint(geo, Ch.id, this.wallColor); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.rock); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.piece = Ch.id; this.group.add(mesh); this.walls.push(mesh);
    }
    this.ray = new THREE.Raycaster(); this.ray.far = 30;
  }
  // the rock above (or beside) a point: the first wall hit going that way
  castTo(o, dir, far = 30) { this.ray.set(o, dir); this.ray.far = far; const h = this.ray.intersectObjects(this.walls, false)[0]; return h || null; }

  // ---------------------------------------------------------------- the floor: one mesh, exactly on the walked ground
  buildFloor() {
    const S = this.S, W = this.W, nx = S.gnx, nz = S.gnz, st = S.step, use = new Int32Array(nx * nz).fill(-1), pos = [], uv = [], idx = [];
    const ok = (k) => !S.gout[k] || (S.gprog[k] > S.sA - 1.9 && S.gprog[k] < S.sB + 1.9);
    const vid = (i, j) => { const k = j * nx + i; if (use[k] < 0) { const x = S.gx0 + i * st, z = S.gz0 + j * st; use[k] = pos.length / 3; pos.push(x, W.heightAt(x, z) + 0.03, z); uv.push(x / 2.2, z / 2.2); } return use[k]; };
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i, ks = [k, k + 1, k + nx, k + nx + 1]; let m = 1e9; for (const q of ks) m = Math.min(m, S.gsdf[q]);
      if (m > 0.75 || !ks.every(ok)) continue;
      const a = vid(i, j), b = vid(i, j + 1), c = vid(i + 1, j), d = vid(i + 1, j + 1); idx.push(a, b, c, c, b, d);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    this.paint(geo, -1, this.floorColor); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.floorMat); mesh.receiveShadow = true; this.group.add(mesh); this.floor = mesh;
  }

  // ---------------------------------------------------------------- standing and running water
  buildWater() {
    const S = this.S, W = this.W, U = W.terrainUniforms;
    const nm = U.tRockN.value.clone(); nm.wrapS = nm.wrapT = THREE.RepeatWrapping; nm.repeat.set(3, 3); nm.needsUpdate = true;
    const water = new THREE.MeshStandardMaterial({ color: 0x0a1012, roughness: 0.04, metalness: 0.15, normalMap: nm, normalScale: new THREE.Vector2(0.15, 0.15), transparent: true, opacity: 0.88 });
    const mud = new THREE.MeshStandardMaterial({ color: 0x140d08, roughness: 0.12, metalness: 0.05 });
    this.pools = [];
    for (const P of S.pools) {
      const g = new THREE.CircleGeometry(P.r * 1.08, 36); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, P.mud ? mud : water); m.position.set(P.x, P.y, P.z); m.receiveShadow = true; this.group.add(m); this.pools.push(P);
    }
    // the stream down the long tunnel, from the Nave to the Hall's pool, running over its bed
    const T = S.tubes.find((t) => t.id === 4); if (!T) return;
    const fm = U.tRockN.value.clone(); fm.wrapS = fm.wrapT = THREE.RepeatWrapping; fm.repeat.set(1, 1); fm.needsUpdate = true; this.flowMap = fm;
    const flow = new THREE.MeshStandardMaterial({ color: 0x101618, roughness: 0.03, metalness: 0.1, normalMap: fm, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const pos = [], uv = [], idx = []; const L = T.S.slice(2, -2);
    L.forEach((m, i) => {
      const nx = -m.tz, nz = m.tx, c = 0.42 * m.W;
      for (const [k, o] of [[0, c - 0.34], [1, c + 0.34]]) {
        const x = m.x + nx * o, z = m.z + nz * o; let y = -1e9; for (const f of [-0.2, 0, 0.2]) y = Math.max(y, W.heightAt(m.x + nx * (c + f), m.z + nz * (c + f)));
        pos.push(x, y + 0.04, z); uv.push(k, m.s / 1.6);
      }
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, flow));
  }

  // ---------------------------------------------------------------- stalactites, stalagmites, columns, rubble, flowstone
  spike(len, rad, seed, up) {
    const cg = new THREE.ConeGeometry(rad, len, 7, 6, false), P = cg.attributes.position, nz = makeNoise(seed);
    for (let v = 0; v < P.count; v++) {
      let x = P.getX(v), y = P.getY(v), z = P.getZ(v); const k = 0.5 - y / len;
      const knob = 1 + (nz.fbm(y * 9 + seed, Math.atan2(z, x) * 1.5, 3) - 0.3) * 0.7 + Math.sin(y * 23 + seed) * 0.08; x *= knob; z *= knob;
      x += (nz.fbm(seed, y * 2.1, 2) - 0.5) * len * 0.22 * k; z += (nz.fbm(y * 2.1, seed, 2) - 0.5) * len * 0.22 * k; P.setXYZ(v, x, y, z);
    }
    if (!up) cg.rotateX(Math.PI); return cg;
  }
  boulder(sz, seed, flat = 0.7) {
    const g = new THREE.IcosahedronGeometry(sz, 2), P = g.attributes.position, nz = makeNoise(seed);
    for (let v = 0; v < P.count; v++) { const x = P.getX(v), y = P.getY(v), z = P.getZ(v), f = 0.75 + nz.fbm(x * 1.7 / sz + seed, y * 1.7 / sz + z, 3) * 0.5; P.setXYZ(v, x * f, y * f * flat, z * f); }
    return g;
  }
  distMain(x, z) { let d = 1e9; for (const m of this.S.main) d = Math.min(d, (x - m.x) ** 2 + (z - m.z) ** 2); return Math.sqrt(d); }
  nearMouth(x, z, r) { for (const Ch of this.S.chambers) for (const M of Ch.mouths) if (Math.hypot(x - M.x, z - M.z) < r) return true; return false; }
  buildDressing() {
    const S = this.S, W = this.W, r = this.r, list = [], up = V(0, 1, 0); this.drips = [];
    const interior = (x, z, m = -0.5) => { const e = S.sample(x, z); return e && !e.out && e.sdf < m && e.prog > S.sA + 2 && e.prog < S.sB - 2 ? e : null; };
    // stalactites in clusters where water comes through, more in the chambers; drips from many of them
    for (let k = 0, tries = 0; k < 190 && tries < 3000; tries++) {
      const x = S.gx0 + r() * S.gnx * S.step, z = S.gz0 + r() * S.gnz * S.step, e = interior(x, z, -0.35); if (!e) continue;
      const inCh = e.piece < 3; if (!inCh && r() < 0.45) continue; const piece = e.piece, fl = e.floor;
      if (this.nearMouth(x, z, 2.6)) continue;
      const hit = this.castTo(V(x, fl + 0.6, z), up); if (!hit || hit.point.y - fl < 1.6) continue; k++;
      const n0 = 1 + Math.floor(r() * (inCh ? 4 : 2));
      for (let c = 0; c < n0; c++) {
        const ox = (r() - 0.5) * 0.9, oz = (r() - 0.5) * 0.9, h2 = this.castTo(V(x + ox, fl + 0.6, z + oz), up); if (!h2) continue;
        const room = h2.point.y - fl, len = Math.min(room * 0.45, (0.2 + r() ** 2 * (inCh ? 2.6 : 1.2))), rad = 0.05 + len * (0.08 + r() * 0.07);
        const cg = this.spike(len + 0.4, rad, k * 7 + c, false); cg.translate(x + ox, h2.point.y - (len + 0.4) / 2 + 0.38, z + oz); list.push(cg);
        if (c === 0 && r() < 0.4) this.drips.push({ x: x + ox, y: h2.point.y - len, z: z + oz, next: r() * 5, piece });
        // a stalagmite rising under it
        if (c === 0 && r() < 0.35) { const sl = 0.2 + r() ** 2 * (inCh ? 1.4 : 0.6), gx = x + ox, gz = z + oz, gy = W.heightAt(gx, gz); const sg = this.spike(sl + 0.2, 0.08 + sl * 0.2, 900 + k, true); sg.translate(gx, gy + sl / 2 - 0.1, gz); list.push(sg); if (sl > 0.7 && this.distMain(gx, gz) > 1.2) W.addCollider(gx, gz, 0.1 + sl * 0.18); }
      }
    }
    // columns: where a stalactite and a stalagmite met, long ago; in the chambers, off the way through
    const cols = [[0, 2], [1, 4], [2, 1]];
    for (const [ci, nC] of cols) {
      const Ch = S.chambers[ci];
      for (let k = 0, tries = 0; k < nC && tries < 200; tries++) {
        const a = r() * TAU, q = 0.3 + r() * 0.42, rr = S.rAt(Ch, a) * q, x = Ch.x + Math.cos(a) * rr, z = Ch.z + Math.sin(a) * rr;
        if (this.distMain(x, z) < 2.6 || this.nearMouth(x, z, 3) || S.pools.some((P) => Math.hypot(x - P.x, z - P.z) < P.r + 0.6)) continue;
        const y0 = W.heightAt(x, z), hit = this.castTo(V(x, y0 + 0.5, z), up); if (!hit) continue; k++;
        const y1 = hit.point.y, rad = (Ch.name === 'nave' && k === 1 ? 0.9 : 0.3 + r() * 0.35), hh = y1 - y0 + 0.8;
        const cg = new THREE.CylinderGeometry(rad * 0.7, rad, hh, 12, 16), P = cg.attributes.position, nz = makeNoise(4000 + k + ci * 10);
        for (let v = 0; v < P.count; v++) { const yy = P.getY(v) / hh + 0.5, waist = 1 - 0.45 * Math.exp(-(((yy - 0.55) / 0.18) ** 2)), flare = 1 + 1.4 * Math.pow(1 - yy, 6) + 1.1 * Math.pow(yy, 5); const knob = waist * flare * (1 + (nz.fbm(yy * 6, Math.atan2(P.getZ(v), P.getX(v)) * 1.3, 3) - 0.3) * 0.5); P.setX(v, P.getX(v) * knob); P.setZ(v, P.getZ(v) * knob); }
        cg.translate(x, y0 + hh / 2 - 0.4, z); list.push(cg); W.addCollider(x, z, rad * 1.15);
      }
    }
    // rubble: the slope down into the Hall, fallen blocks along every passage, the last passage choked with it
    const rock = (x, z, sz, flat = 0.7) => { const y = W.heightAt(x, z), g = this.boulder(sz, Math.floor(r() * 1e4), flat); g.rotateY(r() * TAU); g.translate(x, y + sz * flat * 0.3, z); list.push(g); if (sz > 0.5 && this.distMain(x, z) > 1.0) W.addCollider(x, z, sz * 0.8); };
    { const M = S.chambers[0].mouths.find((m) => m.tube === 3); if (M) for (let k = 0, tries = 0; k < 18 && tries < 200; tries++) { const x = M.x + (r() - 0.5) * 9 - M.dx * 3, z = M.z + (r() - 0.5) * 9 - M.dz * 3; if (!interior(x, z, -0.4) || this.distMain(x, z) < 0.9) continue; k++; rock(x, z, 0.2 + r() ** 2 * 0.9); } }
    for (const T of S.tubes) for (let i = 0; i < T.S.length; i += 5) {
      const m = T.S[i]; if (T.kind === 'main' && (m.s < S.sA + 2 || m.s > S.sB - 2)) continue; const many = T.id === 6 ? 3 : 1;
      for (let c = 0; c < many; c++) { if (r() < 0.45) continue; const sd = r() < 0.5 ? -1 : 1, lat = sd * m.W * (0.55 + r() * 0.3), x = m.x - m.tz * lat, z = m.z + m.tx * lat; if (!interior(x, z, -0.3)) continue; rock(x, z, 0.15 + r() ** 2 * (T.id === 6 ? 0.6 : 0.4)); }
    }
    // the Nave: curtains of flowstone hanging from its roof by the walls
    { const Ch = S.chambers[1];
      for (let k = 0, tries = 0; k < 7 && tries < 80; tries++) {
        const a = r() * TAU, rr = S.rAt(Ch, a) * (0.62 + r() * 0.2), x = Ch.x + Math.cos(a) * rr, z = Ch.z + Math.sin(a) * rr; const e = interior(x, z); if (!e || this.nearMouth(x, z, 3)) continue;
        const hit = this.castTo(V(x, e.floor + 0.5, z), up); if (!hit) continue; k++;
        const wd = 1.2 + r() * 1.4, ln = Math.min(hit.point.y - e.floor - 1.4, 1.6 + r() * 2.2), g = new THREE.PlaneGeometry(wd, ln, 18, 6), P = g.attributes.position;
        for (let v = 0; v < P.count; v++) { const u = P.getX(v) / wd + 0.5, t = 0.5 - P.getY(v) / ln; P.setZ(v, Math.sin(u * 18 + k) * 0.09 * (0.4 + t) + Math.sin(u * 5) * 0.12); P.setY(v, P.getY(v) - Math.max(0, Math.sin(u * 9 + k * 2)) * 0.35 * t); }
        g.rotateY(-a + Math.PI / 2); g.translate(x, hit.point.y - ln / 2 + 0.25, z); list.push(g);
      }
    }
    if (list.length) {
      const m = this.mergeAll(list);
      this.paint(m, -1, (x, y, z, c, e) => { const w = this.wallColor(x, y, z, c, e); c.r = lerp(c.r, 0.62, 0.4); c.g = lerp(c.g, 0.57, 0.4); c.b = lerp(c.b, 0.48, 0.4); return Math.min(1, w + 0.2); });
      m.computeVertexNormals(); const mesh = new THREE.Mesh(m, this.rock); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    }
    // the drops themselves, falling and ringing out on the floor or the water
    const dg = new THREE.SphereGeometry(0.014, 6, 4); dg.scale(1, 2.6, 1);
    const dm = new THREE.MeshStandardMaterial({ color: 0xcfe0e8, roughness: 0.05, metalness: 0.2, emissive: 0x1a2024 });
    const rg = new THREE.RingGeometry(0.8, 1, 24); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const d = new THREE.Mesh(dg, dm); d.visible = false; this.group.add(d);
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0x9fb2ba, transparent: true, opacity: 0, depthWrite: false })); ring.visible = false; this.group.add(ring);
      this.drops.push({ m: d, ring, live: false, vy: 0, t: 0, y1: 0, rt: -1 });
    }
  }

  // ---------------------------------------------------------------- each mouth: rock round the arch; the soldiers and their torch
  buildMouths() {
    const S = this.S, W = this.W, r = this.r, list = [];
    for (const M of S.portals) {
      const nx = -M.dz, nz = M.dx, at = (along, lat) => ({ x: M.x + M.dx * along + nx * lat, z: M.z + M.dz * along + nz * lat });
      // blocks round the arch, set into the face, and a great slab over it
      for (let k = 0; k <= 10; k++) {
        const ph = Math.PI * k / 10, cs = Math.cos(ph), sn = Math.sin(ph), sz = 0.7 + r() * 0.7;
        const lat = -sgp(cs, 2 / CAVE_POW) * (M.W + sz * 0.85), y = M.y + Math.pow(Math.max(0, sn), 2 / CAVE_POW) * (M.Ht + sz * 0.7), p = at(-0.9 - r() * 0.6, lat);
        const g = this.boulder(sz, 300 + k + M.s, 0.8); g.rotateY(r() * TAU); g.translate(p.x, y, p.z); list.push(g);
      }
      { const p = at(-0.6, 0), g = this.boulder(1, 77 + M.s, 1); g.scale(M.W + 2.2, 1.1, 2.6); g.rotateY(Math.atan2(M.dx, M.dz)); g.translate(p.x, M.y + M.Ht + 1.0, p.z); list.push(g); }
      for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) { const sz = 0.5 + r() * 0.9, p = at(-2.2 - k * 1.8 - r(), sd * (M.W + 0.6 + r() * 0.9)); const g = this.boulder(sz, 500 + k * 3 + sd + M.s, 0.75); g.translate(p.x, W.heightAt(p.x, p.z) + sz * 0.2, p.z); list.push(g); }
    }
    if (list.length) {
      const geo = this.mergeAll(list); this.paint(geo, -1, this.wallColor); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.rock); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    }
    // a little grey daylight just inside each mouth
    this.portalLights = S.portals.map((M) => { const L = new THREE.PointLight(0x9aa8bc, 0, 11, 1.6); L.position.set(M.x + M.dx * 1.6, M.y + 2.2, M.z + M.dz * 1.6); this.group.add(L); return L; });
    // the soldiers, below the first mouth, and the torch
    const F = S.mainAt(S.sA - 5), nx = -F.tz, nz = F.tx, wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 });
    const poses = ['lie', 'sit', 'kneel'];
    for (let k = 0; k < 3; k++) {
      const sd = k - 1, x = F.x + nx * (sd * 1.5 + (sd ? 0 : 0.4)) - F.tx * (k * 0.9), z = F.z + nz * (sd * 1.5) - F.tz * (k * 0.9), y = W.heightAt(x, z);
      const fz = makeFrozen(poses[k], 11 + k * 5); if (!fz) continue;
      fz.root.position.set(x, y, z); fz.root.rotation.y = Math.atan2(F.tx, F.tz) + Math.PI + (r() - 0.5) * 1.2; this.group.add(fz.root);
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6), wood); hb.position.set(x + (r() - 0.5) * 1.2, y + 0.05, z + (r() - 0.5) * 1.2); hb.rotation.set(Math.PI / 2, r() * 3, 0.1); hb.castShadow = true; this.group.add(hb);
    }
    const tg = this.torchProp = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.62, 8), wood); haft.position.y = 0.31; tg.add(haft);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.9 })); head.position.y = 0.66; tg.add(head);
    const tx = F.x + nx * 0.7 + F.tx * 1.2, tz = F.z + nz * 0.7 + F.tz * 1.2;
    tg.position.set(tx, W.heightAt(tx, tz) + 0.03, tz); tg.rotation.set(Math.PI / 2 - 0.08, 0, 0.6); this.group.add(tg);
    this.torchSpot = V(tx, W.heightAt(tx, tz), tz);
    const glint = new THREE.PointLight(0xff9040, 0, 3, 2); glint.position.copy(this.torchSpot).add(V(0, 0.4, 0)); this.group.add(glint); this.glint = glint;
  }
  mergeAll(list) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g)); let n = 0; for (const g of parts) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), U2 = new Float32Array(n * 2); let o = 0;
    for (const g of parts) { P.set(g.attributes.position.array, o * 3); if (g.attributes.uv) U2.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('uv', new THREE.BufferAttribute(U2, 2)); return m;
  }

  // ---------------------------------------------------------------- what He uses: the dead man, the hand, the writing, the light in the Nave
  buildScares() {
    const S = this.S, W = this.W, r = this.r;
    // one dead man, who is in the Hall, and then in the Nave, and then lying across the last passage
    const seed = 23, Ch0 = S.chambers[0], Ch1 = S.chambers[1];
    const mHall = Ch0.mouths.find((m) => m.tube === 4), mNave = Ch1.mouths.find((m) => m.tube === 4);
    const spots = [];
    if (mHall) { const a = Math.atan2(mHall.z - Ch0.z, mHall.x - Ch0.x) - 0.55, rr = S.rAt(Ch0, a) * 0.8, x = Ch0.x + Math.cos(a) * rr, z = Ch0.z + Math.sin(a) * rr; spots.push({ pose: 'slump', x, z, yaw: Math.atan2(Ch0.x - x, Ch0.z - z) }); }
    if (mNave) { const toC = Math.atan2(Ch1.x - mNave.x, Ch1.z - mNave.z), x = mNave.x + Math.sin(toC) * 4.2 + Math.cos(toC) * 1.3, z = mNave.z + Math.cos(toC) * 4.2 - Math.sin(toC) * 1.3; spots.push({ pose: 'slump', x, z, yaw: Math.atan2(mNave.x - x, mNave.z - z) }); }
    { const F = S.mainAt(S.sB - 13); spots.push({ pose: 'lie', x: F.x, z: F.z, yaw: Math.atan2(F.tx, F.tz) + Math.PI / 2 }); }
    this.dead = spots.map((sp, i) => { const fz = makeFrozen(sp.pose, seed); if (!fz) return null; fz.root.position.set(sp.x, W.heightAt(sp.x, sp.z), sp.z); fz.root.rotation.y = sp.yaw; fz.root.visible = i === 0; this.group.add(fz.root); return { root: fz.root, x: sp.x, z: sp.z, y: W.heightAt(sp.x, sp.z) }; }).filter(Boolean);
    this.deadAt = 0;
    // NON EXIBIS, in blood, come up on the Hall's wall behind you
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
    x.clearRect(0, 0, 1024, 256); x.font = 'bold 150px serif'; x.fillStyle = 'rgba(110,8,6,0.95)'; x.textAlign = 'center'; x.fillText('NON EXIBIS', 512, 170);
    for (let i = 0; i < 60; i++) { const px = 120 + r() * 780, py = 150 + r() * 30; x.fillRect(px, py, 2 + r() * 4, 30 + r() * 80); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0, roughness: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }));
    { const m0 = Ch0.mouths.find((m) => m.tube === 3); const a = m0 ? Math.atan2(m0.z - Ch0.z, m0.x - Ch0.x) + 0.62 : 0, fl = S.floorSmooth(Ch0, Ch0.x, Ch0.z), o = V(Ch0.x, fl + 2.0, Ch0.z);
      const hit = this.castTo(o, V(Math.cos(a), 0, Math.sin(a)), 14); const p = hit ? hit.point : V(Ch0.x + Math.cos(a) * Ch0.R * 0.9, fl + 2, Ch0.z + Math.sin(a) * Ch0.R * 0.9);
      pm.position.copy(p).addScaledVector(V(Math.cos(a), 0, Math.sin(a)), -0.12); pm.lookAt(o.x, p.y, o.z); }
    this.group.add(pm); this.writing = { m: pm, show: 0 };
    // the hand round the corner at the top of the rift
    this.limb = this.makeLimb();
    { const T = S.tubes.find((t) => t.id === 5), M = T && T.mouth1;
      if (M) { const nx = -M.dz, nz = M.dx, lat = M.W * 0.95, K = V(M.x - M.dx * 0.35 + nx * lat, 0, M.z - M.dz * 0.35 + nz * lat); K.y = W.heightAt(K.x, K.z) + 1.15;
        const L = this.limb.group; L.position.copy(K); const X = V(M.dx, 0, M.dz).normalize(), Y = V(-nx, 0, -nz).normalize(), Z = new THREE.Vector3().crossVectors(X, Y);
        L.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); this.limb.K = K.clone(); this.limb.X = X; this.limb.s = this.S.sample(K.x, K.z)?.prog ?? 0; this.group.add(L); } }
    // the crack in the Nave's roof, and the thread of grey light down from it
    { const F = S.fissure, e = S.sample(F.x, F.z), fl = e ? e.floor : S.yA, top = e ? e.roof - 0.1 : fl + 9;
      const sp = new THREE.SpotLight(0x8c9cb4, 26, 24, 0.24, 0.75, 1.1); sp.position.set(F.x, top, F.z); sp.target.position.set(F.x + 0.6, fl, F.z - 0.4); this.group.add(sp, sp.target); this.shaft = sp;
      const h = top - fl, cg = new THREE.CylinderGeometry(0.12, 1.5, h, 24, 1, true); cg.translate(0, -h / 2, 0);
      const bm = new THREE.ShaderMaterial({ uniforms: { uA: { value: 0.8 }, uH: { value: h }, uTime: this.uni.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: 'varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform float uA, uH, uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ float t = -vP.y / uH; float rim = pow(abs(dot(vN, vV)), 1.5); float motes = 0.75 + 0.25 * sin(vP.y * 7.0 + uTime * 0.6 + vP.x * 9.0); gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * uA * rim * (1.0 - t * 0.8) * motes, 1.0); }' });
      const beam = new THREE.Mesh(cg, bm); beam.position.set(F.x, top, F.z); beam.rotation.z = 0.05; this.group.add(beam); this.beam = beam;
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6), new THREE.MeshBasicMaterial({ color: 0xaab8cc, transparent: true, opacity: 0.8, depthWrite: false })); crack.rotation.x = Math.PI / 2; crack.position.set(F.x, top + 0.02, F.z); this.group.add(crack); this.crack = crack; }
  }
  // a long pale arm and a hand of long fingers, made to hold the rock
  makeLimb() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xcbc3b6, roughness: 0.55, metalness: 0, emissive: 0x070605 }), group = new THREE.Group(), seg = (a, b, r0, r1) => {
      const L = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, L, 9, 4); g.translate(0, L / 2, 0); const m = new THREE.Mesh(g, skin); m.position.copy(a); m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()); return m; };
    const sh = V(1.35, 0.02, 0.05), el = V(0.72, -0.06, -0.02), wr = V(0.06, 0, 0);
    group.add(seg(sh, el, 0.05, 0.036), seg(el, wr, 0.034, 0.024));
    for (const p of [el, wr]) { const k = new THREE.Mesh(new THREE.SphereGeometry(p === el ? 0.042 : 0.03, 10, 8), skin); k.position.copy(p); group.add(k); }
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.026, 0.085), skin); palm.position.set(-0.02, 0, 0); group.add(palm);
    const fingers = [];
    for (let i = 0; i < 4; i++) {
      let parent = new THREE.Group(); parent.position.set(-0.08, 0, -0.033 + i * 0.022); group.add(parent); const f = [parent];
      for (const L of [0.12, 0.095, 0.07]) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.011, L, 6), skin); m.rotation.z = Math.PI / 2; m.position.x = -L / 2; parent.add(m); const j = new THREE.Group(); j.position.x = -L; parent.add(j); parent = j; f.push(j); }
      fingers.push(f);
    }
    { const t = new THREE.Group(); t.position.set(-0.02, 0, 0.05); t.rotation.y = -0.9; group.add(t); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.1, 6), skin); m.rotation.z = Math.PI / 2; m.position.x = -0.05; t.add(m); }
    const curl = (k) => { for (const f of fingers) for (let j = 0; j < f.length - 1; j++) f[j].rotation.z = -k * (0.35 + j * 0.25); };
    curl(1); group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return { group, curl, state: 'wait', t: 0 };
  }
  // where along the way through each part of it lies
  marks() {
    const S = this.S, near = (Ch) => { let best = 1e9, s = 0; for (const m of S.main) { const d = Math.hypot(m.x - Ch.x, m.z - Ch.z); if (d < best) { best = d; s = m.s; } } return s; };
    const T = (id) => S.tubes.find((t) => t.id === id);
    this.mk = { c1: near(S.chambers[0]), c2: near(S.chambers[1]), c3: near(S.chambers[2]), t1a: T(4).S[0].s, t1b: T(4).S[T(4).S.length - 1].s, t2a: T(5).S[0].s, t2b: T(5).S[T(5).S.length - 1].s, t3a: T(6).S[0].s, t3b: S.sB };
  }

  // ---------------------------------------------------------------- the torch in the hand
  takeTorch() {
    const g = this.g; if (this.torch) return;
    this.torchProp.visible = false;
    const make = (k, light) => {
      const grp = new THREE.Group();
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 })); haft.position.y = 0.12; grp.add(haft);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x1a120a, roughness: 0.9 })); head.position.y = 0.47; grp.add(head);
      const tip = new THREE.Object3D(); tip.position.y = 0.53; grp.add(tip);   // where the flame stands (it burns upright, in the world)
      const fl = makeFlame({ height: 0.46, width: 0.2, tongues: 3, sparks: 26 }); this.group.add(fl.group);
      let L = null; if (light) { L = new THREE.PointLight(0xff8a3a, light, 22, 1.5); L.position.y = 0.6; L.castShadow = false; grp.add(L); }
      grp.position.set(0.0, -0.06, 0.02); grp.rotation.set(0.9, 0, 0); k.rig.j.handL.add(grp);
      return { grp, tip, fl, L, k, base: light };
    };
    this.torch = [make(g.me, 16)];
    const comp = g.knightList.filter((k) => k !== g.me && !k.downed).slice(0, 3);
    comp.forEach((k, i) => this.torch.push(make(k, i === 0 ? 9 : 0)));
    g.audio.stinger?.('breath', 0.15);
    g.ui.subtitle(['The pitch takes the flame at the third strike. The dark draws back a little, and no further.', ''], 4.5);
  }
  prompt() {
    if (this.torch || !this.torchSpot) return '';
    const m = this.g.me.pos; return Math.hypot(m.x - this.torchSpot.x, m.z - this.torchSpot.z) < 2.6 ? '<kbd>F</kbd>Take up the soldier\'s torch and light it' : '';
  }
  // the camera stays inside the rock: under the roof, off the floor, and back no further than the passage allows
  clampCamera(want, look) {
    if (this.inCam < 0.01 && !this.inside) return;
    const S = this.S, ew = S.sample(want.x, want.z);
    if (ew && !ew.out && ew.sdf < 0) want.y = clamp(want.y, ew.floor + 0.5, Math.max(ew.floor + 0.6, ew.roof - 0.4));
    const n = Math.max(1, Math.ceil(look.distanceTo(want) / 0.2)); let lx = look.x, ly = look.y, lz = look.z;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = lerp(look.x, want.x, t), y = lerp(look.y, want.y, t), z = lerp(look.z, want.z, t), e = S.sample(x, z); if (!e) return;
      if (!e.out && (e.sdf > -0.3 || y > e.roof - 0.3 || y < e.floor + 0.3)) { want.set(lx, ly, lz); return; }
      lx = x; ly = y; lz = z;
    }
  }
  at(x, z) { const e = this.S.sample(x, z); return e ? { sdf: e.sdf, floor: e.floor, roof: e.roof, prog: e.prog, piece: e.piece, out: e.out } : null; }
  inView(p, r = 0.6) { return this.frustum.intersectsSphere(new THREE.Sphere(p, r)); }
  // could the eye see it: in the view, and no rock between (taking the plan's word for the rock)
  visible(p, r = 0.6) { const c = this.g.engine.camera.position; return this.inView(p, r) && (!this.S.sample(c.x, c.z) || this.S.clear(c.x, c.z, p.x, p.z, 0.05)); }
  looking(p) { const c = this.g.engine.camera, f = V(0, 0, 0); c.getWorldDirection(f); return f.dot(p.clone().sub(c.position).normalize()); }

  // ---------------------------------------------------------------- every frame
  update(dt, time) {
    const g = this.g, W = this.W, S = this.S, me = g.me; this.time += dt; this.uni.uTime.value = time;
    const cam = g.engine.camera; this.frustum.setFromProjectionMatrix(this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // where the knight is, how far along, and how far into the dark the eye is
    const e = this.at(me.pos.x, me.pos.z), inT = !!e && !e.out && e.sdf < 0.8;
    this.prog = inT ? e.prog : -1; this.here = e;
    this.u = inT ? (e.prog - S.sA) / (S.sB - S.sA) : e && e.prog > S.sB ? 2 : -1;
    const ce = this.at(cam.position.x, cam.position.z);
    const deep = ce && !ce.out && ce.sdf < 0.6 && cam.position.y < ce.roof + 1 ? smooth(clamp((ce.prog - S.sA + 0.6) / 3, 0, 1)) * smooth(clamp((S.sB + 0.6 - ce.prog) / 3, 0, 1)) : 0;
    this.inCam = damp(this.inCam || 0, deep, 3, dt); this.inside = inT ? 1 : 0;
    this.applyDark(this.inCam);
    for (const L of this.portalLights) L.intensity = 2.2 * this.inCam;
    // no going in without a light
    if (!this.torch && inT && e.prog > S.sA + 0.4) {
      const F = S.mainAt(S.sA - 1.4); me.pos.x = F.x; me.pos.z = F.z; me.pos.y = W.heightAt(F.x, F.z);
      if (!this.warned || this.time - this.warned > 5) { this.warned = this.time; g.ui.subtitle(['It is black as the pit in there. The dead soldier\'s torch lies at the foot of the rock.', ''], 4); }
    }
    if (!this.torch && g.input?.pressed('KeyF') && this.prompt()) this.takeTorch();
    // the torch: flicker; it gutters when He wants it to
    this.glint.intensity = this.torch ? 0 : 0.6 + Math.sin(time * 3) * 0.2;
    this.flame = damp(this.flame, this.flameAct, this.flameAct < this.flame ? 14 : 2.5, dt);
    if (this.torch) {
      const fl = 0.85 + Math.sin(time * 23) * 0.06 + Math.sin(time * 37.7) * 0.05 + (Math.random() - 0.5) * 0.08, lv = this.flame;
      for (const T of this.torch) {
        T.tip.getWorldPosition(T.fl.group.position); T.fl.group.scale.setScalar(clamp(lv * 1.15, 0.18, 1)); T.fl.update(time, cam.position, fl * Math.max(0.12, lv));
        if (T.L) T.L.intensity = T.base * fl * lv;
        if (Math.random() < dt * 5) g.fx.wisp?.(T.fl.group.position.clone().add(V(0, 0.45, 0)), 0.25, [0.08, 0.07, 0.065]);
      }
    }
    // inside, the road's terrors wait, and no demon comes: He has His own ways in here
    if (this.inCam > 0.3 || inT) { if (g.terror) g.terror.next = Math.max(g.terror.next || 0, 15); if (g.dread) { g.dread.nextPhantom = Math.max(g.dread.nextPhantom || 0, 8); g.dread.nextDevil = Math.max(g.dread.nextDevil || 0, 12); } }
    if (this.flowMap) this.flowMap.offset.y = time * 0.35;   // the stream runs down toward the Hall
    this.updateDrips(dt);
    this.herd(dt);
    this.updateScares(dt, time);
  }
  // inside, the sky's light does not reach: the torches, a little grey daylight at the mouths, the faint glow of wet rock
  applyDark(k) {
    const e = this.g.engine, sc = this.g.scene;
    if (!this.base || k < 0.001) { this.base = { sun: e.sun.intensity, hemi: e.hemi.intensity, fill: e.fill.intensity, fog: sc.fog.color.clone(), fd: sc.fog.density }; if (k < 0.001) { this.uni.uAmb.value.setRGB(0, 0, 0); return; } }
    const B = this.base;
    e.sun.intensity = B.sun * (1 - 0.97 * k); e.hemi.intensity = B.hemi * (1 - 0.9 * k); e.fill.intensity = B.fill * (1 - k);
    sc.fog.color.copy(B.fog).lerp(FOG, k); sc.fog.density = lerp(B.fd, 0.022, k);
    this.uni.uAmb.value.setRGB(0.07, 0.06, 0.05).multiplyScalar(k);
  }
  // water drops from the stalactites: you see them fall, and the rings they make
  updateDrips(dt) {
    const cam = this.g.engine.camera.position, W = this.W;
    for (const d of this.drips) {
      d.next -= dt; if (d.next > 0) continue; d.next = 1.5 + Math.random() * 6;
      if (this.inCam < 0.3 || Math.hypot(d.x - cam.x, d.z - cam.z) > 24) continue;
      const D = this.drops.find((q) => !q.live && q.rt < 0); if (!D) continue;
      let y1 = W.heightAt(d.x, d.z); for (const P of this.pools) if (Math.hypot(d.x - P.x, d.z - P.z) < P.r) y1 = Math.max(y1, P.y);
      D.live = true; D.vy = 0; D.y1 = y1 + 0.01; D.m.position.set(d.x, d.y, d.z); D.m.visible = true;
    }
    for (const D of this.drops) {
      if (D.live) { D.vy -= 9.8 * dt; D.m.position.y += D.vy * dt; if (D.m.position.y <= D.y1) { D.live = false; D.m.visible = false; D.rt = 0; D.ring.position.set(D.m.position.x, D.y1 + 0.005, D.m.position.z); D.ring.visible = true; this.drip(D.ring.position); } }
      if (D.rt >= 0) { D.rt += dt; const k = D.rt / 0.75; D.ring.scale.setScalar(0.03 + k * 0.32); D.ring.material.opacity = 0.55 * (1 - k); if (k >= 1) { D.rt = -1; D.ring.visible = false; } }
    }
  }
  drip(p) {
    const A = this.g.audio, ctx = A.ctx; if (!ctx || !A.sfx || !ctx.createOscillator) return;
    const cam = this.g.engine.camera.position, gain = 0.1 * clamp(1 - p.distanceTo(cam) / 22, 0, 1); if (gain < 0.005) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = 'sine'; o.frequency.setValueAtTime(1300 + Math.random() * 900, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.09);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(gain, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(gn); if (pan) { pan.pan.value = (Math.random() - 0.5) * 1.6; gn.connect(pan).connect(A.sfx); } else gn.connect(A.sfx);
    o.start(t); o.stop(t + 0.35);
  }
  // the others follow the leader round the bends (they cannot see through rock), and are never left far behind
  herd(dt) {
    const g = this.g, S = this.S, lead = g.leader?.(); if (!lead) return;
    const el = this.at(lead.pos.x, lead.pos.z); if (!el || el.out || el.sdf > 0.8) return;
    for (const k of g.knightList) {
      if (k === lead || !k.isAI || !g.owns?.(k) || k.downed) continue;
      const e = this.at(k.pos.x, k.pos.z); if (!e || e.sdf > 0.8) continue;
      const gap = el.prog - e.prog, far = Math.abs(gap);
      if (far > 16 && !this.visible(k.pos.clone().setY(k.pos.y + 1), 1)) { const F = S.mainAt(el.prog - Math.sign(gap) * 4); k.pos.set(F.x, this.W.heightAt(F.x, F.z), F.z); continue; }
      if (!S.clear(k.pos.x, k.pos.z, lead.pos.x, lead.pos.z, 0.3) && far > 1.5) {
        const F = S.mainAt(e.prog + Math.sign(gap) * 2.5), dx = F.x - k.pos.x, dz = F.z - k.pos.z, l = Math.hypot(dx, dz) || 1, v = Math.min(l, 3.6 * dt);
        k.pos.x += dx / l * v; k.pos.z += dz / l * v; k.yaw = Math.atan2(dx, dz);
      }
    }
  }

  // ---------------------------------------------------------------- what He does in the dark
  once(key, cond, fn) { if (!this.done[key] && cond) { this.done[key] = true; fn(); } }
  devil() { const D = phantomDevil(this.g); D.owner = 'cave'; return D; }
  endAct() { const D = this.g._phantomDevil; if (D && D.owner === 'cave') { releasePhantom(D, 'cave'); D.state = 'hidden'; D.mesh.visible = false; } this.act = null; this.echoQ.length = 0; this.flameAct = 1; }
  updateScares(dt, time) {
    const g = this.g, me = g.me, S = this.S, mk = this.mk, cam = g.engine.camera.position; if (!this.torch) return;
    const p = this.prog, inT = p >= 0, e = this.here, name = me.name || 'knight';
    const dread = (a) => { if (g.dread) g.dread.level = Math.min(1, (g.dread.level || 0) + a); };
    const camF = () => { const f = V(0, 0, 0); g.engine.camera.getWorldDirection(f); f.y = 0; return f.normalize(); };
    const floorAt = (x, z) => this.W.heightAt(x, z);
    // the steps you take (the echo is made from them)
    const mv = this.lastPos ? Math.hypot(me.pos.x - this.lastPos.x, me.pos.z - this.lastPos.z) : 0; (this.lastPos ||= V(0, 0, 0)).copy(me.pos);
    const speed = mv / Math.max(dt, 1e-3); this.speed = damp(this.speed || 0, speed, 6, dt);
    const dp = inT && this.lastProg >= 0 ? p - this.lastProg : 0; this.lastProg = p; this.vProg = damp(this.vProg || 0, dp / Math.max(dt, 1e-3), 4, dt);
    // a voice at the mouth
    this.once('voice', inT && p > S.sA + 3.5, () => { g.audio.whisper(cam.clone().addScaledVector(camF(), 6).setY(cam.y + 0.5), 2.6, 0.45); g.ui.subtitle(['Leave the light behind, little knight. You will see me better.', ''], 4); dread(0.06); });
    // the Hall: as you go on through it, the writing comes up on the wall behind you
    this.once('writing', inT && p > mk.c1 + 2 && this.looking(this.writing.m.position) < 0.2, () => { this.writing.show = 1; });
    if (this.writing.show) { const M = this.writing.m.material; M.opacity = Math.min(1, M.opacity + dt * 0.3); }
    // the dead man goes on ahead of you, where you cannot see him go
    if (this.dead.length > 1) {
      const D = this.dead, want = p > mk.t2a + 2 && D.length > 2 ? 2 : p > mk.t1a + 5 ? 1 : 0;
      if (want > this.deadAt) { const a = D[this.deadAt], b = D[want], camP = cam;
        if (!this.visible(V(a.x, a.y + 0.6, a.z), 1) && !this.visible(V(b.x, b.y + 0.6, b.z), 1) && Math.hypot(b.x - camP.x, b.z - camP.z) > 9) { a.root.visible = false; b.root.visible = true; this.deadAt = want; } }
    }
    // queue the big moments; one at a time
    const want = (key, cond) => { if (!this.done[key] && cond && !this.queue.includes(key)) this.queue.push(key); };
    want('echo', inT && p > mk.t1a + 1.5 && p < mk.t1a + 9);
    want('gutter', inT && p > mk.t1a + 11 && p < mk.t1b - 2);
    want('breath', inT && p > mk.t1b - 4.5 && p < mk.c2);
    want('shadow', inT && e.piece === 1 && p > mk.t1b + 1);
    want('names', inT && p > mk.c2 && this.done.shadow);
    want('limb', inT && this.limb.s && p > this.limb.s - 9 && this.limb.state === 'wait');
    want('roof', inT && (e.piece === 2 || p > mk.c3 - 2.5) && p < mk.t3a);
    want('chase', inT && p > mk.t3a + 2.5);
    // each has its stretch of the cave; one not begun when you are past it is let go, one under way is cut short
    const until = { echo: mk.t1a + 11, gutter: mk.t1b, breath: mk.c2 + 4, shadow: mk.t2a, names: mk.t2a + 3, limb: mk.c3, roof: mk.t3a + 3, chase: 1e9 };
    this.queue = this.queue.filter((k) => !(inT && p > until[k]));
    if (this.act && inT && p > until[this.act.kind] + 2) this.endAct();
    if (!this.act && this.queue.length) { const k = this.queue.shift(); if (!this.done[k]) { this.done[k] = true; this.act = { kind: k, t: 0 }; } }
    // every so often, something in the dark: a stone falling, a drop echoing, a long low sound
    if (inT && !this.act) { this.amb = (this.amb ?? 6) - dt; if (this.amb < 0) { this.amb = 7 + Math.random() * 9; const F = S.mainAt(p + (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 10)); const q = V(F.x, floorAt(F.x, F.z) + 1, F.z);
      const k = Math.random(); if (k < 0.45) for (let i = 0; i < 3; i++) setTimeout(() => this.W === g.world && g.audio.footstep(q, false, 0.5 - i * 0.12), i * 180 + Math.random() * 80); else if (k < 0.75) this.drip(q); else g.audio.stinger('drone', 0.16); } }
    this.updateLimb(dt);
    const A = this.act; this.flameAct = 1; if (!A) return; A.t += dt;
    if (A.kind === 'echo') {
      // your own steps, come back to you from up the tunnel: a beat late, and then a few more after you stop
      this.walked += mv; if (this.walked > 0.95 && this.speed > 0.6) { this.walked = 0; this.echoQ.push({ t: A.t + 0.38 + Math.random() * 0.08, d: 9 + Math.random() * 2 }); }
      for (let i = this.echoQ.length - 1; i >= 0; i--) if (this.echoQ[i].t <= A.t) { const q = this.echoQ.splice(i, 1)[0], F = S.mainAt(p + q.d); g.audio.footstep(V(F.x, floorAt(F.x, F.z) + 0.3, F.z), true, 0.55); }
      if (this.speed < 0.25) { A.still = (A.still || 0) + dt; if (A.still > 0.5 && !A.extra && A.t > 3) { A.extra = A.t; dread(0.08); } } else A.still = 0;
      if (A.extra) { const k = Math.floor((A.t - A.extra) / 0.62); if (k < 3 && k >= (A.n || 0)) { A.n = k + 1; const F = S.mainAt(p + 8 - k * 1.6); g.audio.footstep(V(F.x, floorAt(F.x, F.z) + 0.3, F.z), true, 0.6 + k * 0.2); } if (A.t - A.extra > 2.4) { g.audio.silence?.(1.5); this.act = null; this.echoQ.length = 0; } }
      if (!A.extra && (A.t > 10 || p > this.mk.t1a + 11)) { this.act = null; this.echoQ.length = 0; }
    } else if (A.kind === 'gutter') {
      // the torch all but dies; in its last flickers something stands at the edge of the light, nearer each time;
      // when the light comes back there is nothing there
      const T = A.t, bursts = [[1.0, 1.32, 0.6, 7.2], [2.15, 2.4, 0.45, 4.3], [2.95, 3.04, 0.32, 2.6]];
      let lv = T < 0.5 ? lerp(1, 0.12, T / 0.5) : T < 3.6 ? 0.035 : Math.min(1, 0.035 + (T - 3.6) * 0.9), show = null;
      for (const [a, b, l, d] of bursts) if (T > a && T < b) { lv = l * (0.75 + Math.random() * 0.25); show = d; }
      this.flameAct = lv; if (T < 0.1 && !A.s) { A.s = 1; g.audio.silence?.(3.6); g.audio.stinger('breath', 0.45); dread(0.14); }
      const D = this.devil();
      if (show) {
        if (!A.base) { A.base = p; }
        const F = S.mainAt(A.base + show), x = F.x - F.tz * 0.25, z = F.z + F.tx * 0.25, y = floorAt(x, z), ee = this.at(x, z);
        D.state = 'watch'; D.t = 2; D.pos.set(x, y, z); D.yaw = Math.atan2(me.pos.x - x, me.pos.z - z); D.animate(dt, time, cam, [me]);
        if (!A.h0) { D.mesh.scale.copy(D.baseScale); D.mesh.updateMatrixWorld(true); const bx = new THREE.Box3().setFromObject(D.mesh); A.h0 = Math.max(2, bx.max.y - bx.min.y); }
        const room = ee ? ee.roof - y - 0.15 : 2.5; D.mesh.scale.copy(D.baseScale).multiplyScalar(Math.min(1, room / A.h0)); D.mesh.visible = true;
        if (show < 3 && !A.close) { A.close = 1; g.audio.whisper(cam.clone(), 0.6, 0.5); }
      } else if (D.owner === 'cave') { D.mesh.visible = false; D.state = 'hidden'; }
      if (T > 3.6 && !A.back) { A.back = 1; releasePhantom(D, 'cave'); D.state = 'hidden'; D.mesh.visible = false; g.audio.heartbeat?.(0.6); }
      if (T > 4.8) this.act = null;
    } else if (A.kind === 'breath') {
      // breathing, close behind you; turn round and it stops
      const f = camF(), yaw = Math.atan2(f.x, f.z); if (A.yaw === undefined) { A.yaw = yaw; A.nb = 0; }
      if (A.t > A.nb) { A.nb = A.t + 1.7; g.audio.stinger('breath', 0.4); g.audio.whisper(cam.clone().addScaledVector(f, -0.45), 1.1, 0.22); }
      const turned = Math.abs(Math.atan2(Math.sin(yaw - A.yaw), Math.cos(yaw - A.yaw))) > 1.7;
      if (turned || A.t > 7) { if (turned) { g.audio.silence?.(1.2); dread(0.1); } this.act = null; }
    } else if (A.kind === 'shadow') {
      // in the Nave: something crosses the roof, high up, through the thread of light, and is gone
      const F = S.fissure, f = camF();
      if (!A.a) { const side = V(-f.z, 0, f.x); A.a = V(F.x - side.x * 8, 0, F.z - side.z * 8); A.b = V(F.x + side.x * 8, 0, F.z + side.z * 8); A.wait = 0; }
      const lookOK = this.looking(V(F.x, (e?.floor || 0) + 6, F.z)) > 0.55; if (!A.go) { A.wait += dt; if (lookOK || A.wait > 3.5) { A.go = A.t; g.audio.stinger('scrape', 0.4); dread(0.1); } return; }
      const T = A.t - A.go, k = smooth(clamp(T / 3.2, 0, 1)), pos = A.a.clone().lerp(A.b, k), ee = this.at(pos.x, pos.z), D = this.devil();
      D.state = 'watch'; D.t = 2; D.yaw = Math.atan2(A.b.x - A.a.x, A.b.z - A.a.z); D.animate(dt, time, cam, [me]); D.crawl(dt, time, pos, D.yaw, (ee ? ee.roof : (e?.floor || 0) + 9) - 0.2, 2.4);
      if ((A.st = (A.st || 0) - dt) < 0) { A.st = 0.11; g.audio.footstep(D.pos.clone(), false, 0.3); }
      if (T > 3.3) { releasePhantom(D, 'cave'); D.state = 'hidden'; D.mesh.visible = false; this.act = null; }
    } else if (A.kind === 'names') {
      // your name: from the black of a gallery, then from the other side, then at your ear
      const G2 = S.tubes.find((t) => t.id === 8), end = G2 ? G2.S[G2.S.length - 1] : S.mainAt(p + 10), f = camF();
      if (!A.n && A.t > 0.8) { A.n = 1; g.audio.whisper(V(end.x, floorAt(end.x, end.z) + 1.4, end.z), 2.0, 0.5); g.ui.subtitle([`…${name}…`, ''], 2.6); }
      if (A.n === 1 && A.t > 4.2) { A.n = 2; const s = V(-f.z, 0, f.x); g.audio.whisper(cam.clone().addScaledVector(s, -6), 1.6, 0.5); g.ui.subtitle([`${name}…`, ''], 2.4); }
      if (A.n === 2 && A.t > 7.4) { A.n = 3; g.audio.whisper(cam.clone().addScaledVector(f, -0.25).add(V(0.2, 0, 0)), 1.0, 0.75); g.ui.subtitle([`${name}.`, ''], 2); g.audio.heartbeat?.(0.7); dread(0.12); }
      if (A.t > 9) this.act = null;
    } else if (A.kind === 'limb') {
      if (this.limb.state === 'gone' || A.t > 20) this.act = null;
    } else if (A.kind === 'roof') {
      // the Vault: scrabbling overhead; grit falls; He comes over the roof toward you, stops right above you and
      // hangs there looking down; something drips from Him at your feet; then He scuttles away behind you
      const D = this.devil(), T = A.t, f = camF();
      if (!A.from) { const Ch = S.chambers[2]; A.from = V(Ch.x * 2 - me.pos.x, 0, Ch.z * 2 - me.pos.z); A.away = V(me.pos.x - f.x * 9, 0, me.pos.z - f.z * 9); A.nx = 0; dread(0.1); }
      if (T < 1.6) { if (T > A.nx) { A.nx = T + 0.22; const q = me.pos.clone().addScaledVector(f, 3 + Math.random() * 3); const ee = this.at(q.x, q.z); q.y = ee ? ee.roof - 0.3 : me.pos.y + 6; g.audio.footstep(q, false, 0.35); if (Math.random() < 0.5) g.fx.dust?.(q, 3, [0.3, 0.28, 0.25]); } this.flameAct = 0.7; return; }
      let pos, go;
      if (T < 4.2) { const k = smooth(clamp((T - 1.6) / 2.6, 0, 1)); pos = A.from.clone().lerp(V(me.pos.x, 0, me.pos.z), k); go = 1; }
      else if (T < 6.6) { A.hold ||= V(me.pos.x, 0, me.pos.z); A.hold.lerp(V(me.pos.x, 0, me.pos.z), Math.min(1, dt * 0.8)); pos = A.hold.clone(); go = 0; }
      else { const k = smooth(clamp((T - 6.6) / 1.5, 0, 1)); pos = (A.hold || V(me.pos.x, 0, me.pos.z)).clone().lerp(A.away, k); go = 2.8; }
      const ee = this.at(pos.x, pos.z), roof = ee && !ee.out ? ee.roof : me.pos.y + 7;
      const yaw = T < 6.6 ? Math.atan2(me.pos.x - A.from.x, me.pos.z - A.from.z) : Math.atan2(A.away.x - pos.x, A.away.z - pos.z);
      D.state = 'watch'; D.t = 2; D.yaw = yaw; D.animate(dt, time, cam, [me]); D.crawl(dt, time, pos, yaw, roof - 0.2, go);
      this.flameAct = T > 4.2 && T < 6.6 ? 0.55 : 0.85;
      if (T > 4.2 && !A.still) { A.still = true; g.audio.whisper(D.pos.clone(), 1.8, 0.6); g.audio.heartbeat?.(0.7); dread(0.12); }
      if (T > 5.3 && !A.drop) { A.drop = true; const q = me.pos.clone().add(V(0.4, 0, 0.3)); q.y = floorAt(q.x, q.z) + 0.01; const R = this.drops.find((d) => d.rt < 0); if (R) { R.ring.position.copy(q); R.ring.visible = true; R.rt = 0; } this.drip(q); }
      if (T > 6.6 && !A.run) { A.run = true; g.audio.scream(D.pos.clone(), false, 0.35, 1.4); g.engine.shake(0.15, 0.3); for (let i = 0; i < 5; i++) setTimeout(() => this.W === g.world && g.audio.footstep(D.pos.clone(), true, 0.7), i * 120); }
      if (T > 8.2) { releasePhantom(D, 'cave'); D.state = 'hidden'; D.mesh.visible = false; this.act = null; g.audio.whisper(me.pos.clone().setY(me.pos.y + 2.5), 1.4, 0.5); }
    } else if (A.kind === 'chase') {
      // the last passage: something comes up behind you out of the Vault, fast, and you never see it. Stop, and it
      // is at your back. It follows you right to the light, and there it stops.
      if (!A.gap) { A.gap = 15; A.nf = 0; A.ng = 0.8; A.nh = 0; const F = S.mainAt(p - 15); g.audio.scream(V(F.x, floorAt(F.x, F.z) + 1.5, F.z), false, 0.7, 0.62); g.engine.shake(0.3, 0.6); dread(0.2); g.ui.subtitle(['Run.', ''], 1.6); }
      const vT = A.t < 4 ? 6.2 : 5.2; A.gap = clamp(A.gap + (this.vProg - vT) * dt, 2.6, 30);
      const F = S.mainAt(p - A.gap), q = V(F.x, floorAt(F.x, F.z) + 0.6, F.z), near = 1 / A.gap;
      if (A.t > A.nf) { A.nf = A.t + 0.12 + Math.random() * 0.08; g.audio.footstep(q, true, Math.min(1.4, 0.4 + near * 4)); if (Math.random() < 0.25) g.audio.footstep(q.clone().add(V((Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2)), false, 0.4); }
      if (A.t > A.ng) { A.ng = A.t + 1.1 + Math.random() * 0.6; g.audio.growl?.(q, 0.55, 0.9, Math.min(0.7, 0.2 + near * 2)); }
      if (A.t > A.nh) { A.nh = A.t + 0.5 + A.gap * 0.02; g.audio.heartbeat?.(0.5 + near); }
      g.engine.shake(Math.min(0.12, near * 0.25), 0.1);
      this.flameAct = A.gap < 3 ? 0.25 + Math.random() * 0.2 : 0.6 + Math.random() * 0.3;
      if (A.gap < 2.8 && !A.atBack) { A.atBack = A.t; g.audio.stinger('breath', 0.6); g.audio.whisper(cam.clone().addScaledVector(camF(), -0.3), 0.8, 0.7); }
      if (A.atBack && A.t - A.atBack > 3) A.atBack = 0;
      if (p > S.sB - 1.2 || this.u > 1) {
        const F2 = S.mainAt(S.sB - 18); g.audio.scream(V(F2.x, floorAt(F2.x, F2.z) + 1.5, F2.z), false, 0.45, 0.5); g.audio.silence?.(2.5);
        setTimeout(() => { if (this.W === g.world) g.ui.subtitle(['Go on up, then. He has been waiting for you longer than I have.', ''], 5); }, 1800);
        this.act = null;
      }
    }
  }
  // the hand: it holds the rock at the corner until you come near enough to see it, then draws back round it
  updateLimb(dt) {
    const L = this.limb; if (!L.K || L.state === 'gone') return;
    const me = this.g.me.pos, d = Math.hypot(me.x - L.K.x, me.z - L.K.z);
    L.group.visible = this.prog >= 0 && this.prog > this.mk.t2a - 4;
    if (L.state === 'wait') {
      const seen = d < 9.5 && this.visible(L.K, 0.3) && this.looking(L.K) > 0.8;
      if (seen || d < 3.5) { L.state = 'seen'; L.t = 0; }
      L.curl(1 + Math.sin(this.time * 2.3) * 0.04);
    } else if (L.state === 'seen') {
      L.t += dt; if (L.t > 0.45) { L.state = 'pull'; L.t = 0; this.g.audio.stinger('scrape', 0.45); if (this.g.dread) this.g.dread.level = Math.min(1, this.g.dread.level + 0.12); }
    } else if (L.state === 'pull') {
      L.t += dt; const k = smooth(clamp(L.t / 0.75, 0, 1)); L.group.position.copy(L.K).addScaledVector(L.X, k * 1.7 + k * k * 0.6); L.curl(1 - 0.7 * smooth(clamp(L.t / 0.3, 0, 1)) + 0.5 * smooth(clamp((L.t - 0.4) / 0.35, 0, 1)));
      if (L.t > 0.9) { L.state = 'gone'; L.group.visible = false; }
    }
  }
  dispose() {
    if (this.torch) for (const T of this.torch) { T.grp.removeFromParent(); T.fl.group.removeFromParent(); }
    const D = this.g._phantomDevil; if (D && D.owner === 'cave') releasePhantom(D, 'cave');
    if (this.base) { const e = this.g.engine, B = this.base; e.sun.intensity = B.sun; e.hemi.intensity = B.hemi; e.fill.intensity = B.fill; this.g.scene.fog.color.copy(B.fog); this.g.scene.fog.density = B.fd; }
    this.group.removeFromParent(); this.group.traverse((o) => o.geometry?.dispose?.());
  }
}
