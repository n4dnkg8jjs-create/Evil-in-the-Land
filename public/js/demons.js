// The horde. Seven demon kinds, each a skinned mesh built from a procedural
// skeleton (one draw call per demon), animated procedurally, and driven by
// host-side AI. Clients see puppets fed from host snapshots.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { demonTextures } from './textures.js';
import { buildHorror, ANIM, horrorTick } from './horror.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smooth, makeNoise, TAU, SpatialHash, rng } from './util.js';

const D2R = Math.PI / 180;
const R = Math.random;

// ---------------------------------------------------------------- type table
export const TYPES = {
  shade:   { name: 'Shade',   rarity: 'common',   hp: 45,  speed: 6.0, radius: 0.45, height: 2.05, dmg: 9,  range: 1.9, cd: 1.3, mass: 1, rim: 0x8a1410, score: 1, stagger: 1 },
  crawler: { name: 'Crawler', rarity: 'common',   hp: 28,  speed: 7.6, radius: 0.55, height: 0.9, dmg: 7,  range: 1.6, cd: 1.1, mass: 0.7, rim: 0x5a1a80, score: 1, stagger: 1 },
  wretch:  { name: 'Wretch',  rarity: 'uncommon', hp: 55,  speed: 4.4, radius: 0.45, height: 1.6, dmg: 12, range: 20, cd: 3.2, mass: 1, rim: 0x3a7a20, score: 2, stagger: 1, ranged: true, robe: true },
  husk:    { name: 'Husk',    rarity: 'uncommon', hp: 70,  speed: 3.2, radius: 0.7,  height: 1.7, dmg: 32, range: 2.4, cd: 1, mass: 1.6, rim: 0xc05010, score: 2, stagger: 0.6, boils: true, skin: 0x1c1612 },
  brute:   { name: 'Brute',   rarity: 'rare',     hp: 420, speed: 3.9, radius: 1.0,  height: 2.9, dmg: 26, range: 3.2, cd: 2.4, mass: 5, rim: 0xd01a10, score: 8, stagger: 0.25, big: true, horns: [0.62, 0.06, 2.3], spikes: true },
  wraith:  { name: 'Wraith',  rarity: 'rare',     hp: 140, speed: 5.0, radius: 0.55, height: 2.2, dmg: 14, range: 16, cd: 4.5, mass: 0.8, rim: 0x6080d0, score: 5, stagger: 0.7, ranged: true, wings: 1.7 },
  herald:  { name: 'Herald',  rarity: 'very rare', hp: 260, speed: 7.0, radius: 0.8,  height: 2.5, dmg: 22, range: 2.6, cd: 3.5, mass: 2, rim: 0xe08020, score: 10, stagger: 0.5, wings: 2.2, crown: true },
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

const S = (x, y, z) => [x, y, z];
function sym(fn) { return [fn(-1, 'R'), fn(1, 'L')].flat(); }
export function prewarmDemons() {}

// ---------------------------------------------------------------- demon instance
const ST = { spawn: 0, chase: 1, windup: 2, strike: 3, recover: 4, stagger: 5, dead: 6, special: 7, flee: 8, leap: 9 };
export const STATE_NAMES = Object.fromEntries(Object.entries(ST).map(([k, v]) => [v, k]));

export class Demon {
  constructor(type, id, scene) {
    this.type = type; this.def = TYPES[type]; this.id = id; this.scene = scene;
    const body = buildHorror(type, this.def);
    this.mat = body.mat; this.wings = body.wings;
    this.mesh = body.mesh; this.B = body.B; scene.add(this.mesh);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0;
    this.hp = this.def.hp; this.maxHp = this.def.hp;
    this.state = ST.spawn; this.stateT = 0; this.cd = R() * 1.0; this.target = null; this.retarget = 0;
    this.phase = R(); this.speedVis = 0; this.hitFlash = 0; this.flinch = 0; this.flinchDir = 1; this.dissolve = 0; this.alive = true; this.removed = false;
    this.seed = R() * 100; this.special = 0; this.fuse = -1; this.alt = 0;
    this.scale = this.def.big ? 1 : 0.92 + R() * 0.16; this.mesh.scale.setScalar(this.scale);
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
    this.mat.userData.u.uTime.value = time;
    const h = horrorTick(this, dt, time, d2 < 32 * 32);
    // stop-motion: now and then a demon freezes mid-motion, then snaps on to where it really is
    if (h.stutter > 0 && this.state !== ST.dead) return;
    this.mesh.position.set(this.pos.x, this.pos.y + (this.alt || 0), this.pos.z);
    this.mesh.rotation.y = this.yaw;
    if (this.lodSkip) return;
    // emerging from the earth
    if (this.state === ST.spawn) this.mesh.position.y -= (1 - smooth(clamp(this.stateT / 1.1, 0, 1))) * this.def.height * this.scale;
    ANIM[this.type].call(this, dt, time);
    // smoke wisps trail off the shadow-flesh
    this.wispT += dt;
    if (fx && this.wispT > (d2 > 40 * 40 ? 0.5 : 0.18) && this.state !== ST.dead) { this.wispT = 0; fx.wisp(this.chest, 0.35 * this.scale * (this.def.big ? 1.6 : 1)); }
  }

  dispose() { this.scene.remove(this.mesh); this.mat.dispose(); if (this.wings) for (const k in this.wings) this.wings[k].mesh.geometry.dispose(); }
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
    this.meleeStep(dt, C, T, toT, dist, want, speed, faceT, { leap: [4, 10], leapT: 0.7, leapH: 2.0, windup: [0.6], lunge: 6, arc: 1.0, recover: 0.7 });
  },
};

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
      if (d.wantScream) { if (this.onScream) this.onScream(d, d.wantScream); d.wantScream = null; }
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
