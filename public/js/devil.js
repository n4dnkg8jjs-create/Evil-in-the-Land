// The Devil and his shapes.
//  Watcher  — a tall horned figure with huge unblinking eyes whose head turns
//             far past where a neck should allow; he watches from the hills.
//  Crevice  — eyes and long fingers in the mountain clefts.
//  Hound, Serpent, Cryptid — mini-boss shapes. Dragon — the final form.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTemplate, instantiate, limb, blob, cone, horn, place, lumpyG, demonMaterial } from './demons.js';
import { scaleTextures, demonTextures } from './textures.js';
import { buildHorror, tickRobes } from './horror.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smooth, TAU } from './util.js';

const D2R = Math.PI / 180, R = Math.random;
const e = (b, x, y, z) => b.rotation.set(x * D2R, y * D2R, z * D2R);
const S = (x, y, z) => [x, y, z];
const sym = (fn) => [fn(-1, 'R'), fn(1, 'L')].flat();

// limb pointing along an arbitrary direction (joint-local)
function boneLimb(dir, r0, r1, seg = 8, lump = 0.12, seed = 1) {
  const d = new THREE.Vector3(...dir); const len = d.length();
  const g = limb(r0, r1, len, seg, lump, seed);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.clone().normalize()));
  return g;
}
// the wide, staring eyes every shape of Him shares
function staringEyes(positions, r, irisColor = 0xff2a10) {
  const sclera = mergeGeometries(positions.map((p) => place(new THREE.SphereGeometry(r, 16, 12), p)));
  const pupils = mergeGeometries(positions.map((p) => place(new THREE.SphereGeometry(r * 0.32, 10, 8), [p[0], p[1], p[2] + r * 0.82])));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(sclera, new THREE.MeshStandardMaterial({ color: 0xe8e0d0, emissive: 0x4a3a30, roughness: 0.15, metalness: 0 })));
  g.add(new THREE.Mesh(pupils, new THREE.MeshBasicMaterial({ color: new THREE.Color(irisColor).multiplyScalar(2.4), toneMapped: false })));
  return g;
}

function dragonMaterial() {
  const st = scaleTextures(512);
  const u = { uDissolve: { value: 0 }, uRim: { value: new THREE.Color(0xff3a10) }, uRimPow: { value: 3 }, uGlow: { value: 1 }, uHit: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, emissiveMap: st.emissiveMap, emissive: 0xff5010, emissiveIntensity: 2.2, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide, color: 0xa08a80 });
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uRimPow, uGlow, uHit; uniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= uGlow;
        totalEmissiveRadiance += uRim * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), uRimPow) * 1.2;
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit;`);
  };
  m.customProgramCacheKey = () => 'dragon-v1';
  return m;
}

// ================================================================ WATCHER
// Him, on the hills: a figure far too tall and thin, arms hanging past the
// knee, ram horns, a ragged cloak, and two wide white eyes that never blink.
// He stands perfectly still. Only the head moves, in sudden snaps, and at the
// end it turns all the way round before he is gone.
const WATCHER_DEF = { rim: 0x000000, skin: 0x8e9592, horns: [0.95, 0.07, 3.0], hooded: true, dead: true, realEyes: true, eyeScale: 1.15 };

export class Watcher {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    const body = buildHorror('devil', WATCHER_DEF);
    this.mat = body.mat; this.mesh = body.mesh; this.B = body.B;
    this.mesh.visible = false; scene.add(this.mesh);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.headYaw = 0; this.headTarget = 0; this.headRoll = 0; this.retarget = 0;
    this.state = 'hidden'; this.t = 0; this.fade = 0; this.mode = 'watch'; this.cool = 6; this.spotIdx = -1; this.seenT = 0;
  }
  // host decides where he appears; clients mirror the state
  hostUpdate(dt, world, knights, phase) {
    this.t += dt;
    const spots = world.devilSpots; if (!spots.length) return;
    if (this.state === 'hidden') {
      this.cool -= dt; if (this.cool > 0 || phase === 'cinematic') return;
      // a spot far from every knight, so he is only ever a silhouette on a ridge
      let best = -1, bs = -1;
      spots.forEach((s, i) => {
        if (i === this.spotIdx) return;
        let dmin = 1e9; for (const k of knights) dmin = Math.min(dmin, Math.hypot(k.pos.x - s.x, k.pos.z - s.z));
        if (dmin < 85 || dmin > 175) return;
        const score = -Math.abs(dmin - 115) + Math.random() * 20;
        if (score > bs) { bs = score; best = i; }
      });
      if (best < 0) { this.cool = 3; return; }
      this.spotIdx = best; const s = spots[best];
      this.pos.set(s.x, s.y, s.z); this.state = 'appear'; this.t = 0; this.stay = 30 + R() * 25;
      return 'appear';
    }
    let dmin = 1e9, nearest = null; for (const k of knights) { const d = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z); if (d < dmin) { dmin = d; nearest = k; } }
    if (nearest) { this.yaw = dampAngle(this.yaw, Math.atan2(nearest.pos.x - this.pos.x, nearest.pos.z - this.pos.z), 0.3, dt); }
    if (this.state === 'appear' && this.t > 1.6) { this.state = 'watch'; this.t = 0; }
    if (this.state === 'watch') {
      if (dmin < 60 || this.t > this.stay) { this.state = 'turn'; this.t = 0; return 'turn'; }
    }
    if (this.state === 'turn' && this.t > 2.4) { this.state = 'vanish'; this.t = 0; return 'vanish'; }
    if (this.state === 'vanish' && this.t > 1.4) { this.state = 'hidden'; this.cool = 20 + R() * 20; }
  }
  netState() { return [this.state, +this.pos.x.toFixed(1), +this.pos.y.toFixed(1), +this.pos.z.toFixed(1), +this.yaw.toFixed(2), +this.t.toFixed(2), this.mode]; }
  applyNet(s) { const [st, x, y, z, yaw, t, mode] = s; if (st !== this.state) this.t = t; this.state = st; this.pos.set(x, y, z); this.yaw = yaw; this.mode = mode; }

  animate(dt, time, camPos, knights) {
    if (this.state === 'hidden') { this.mesh.visible = false; this.fade = 0; return; }
    this.mesh.visible = true;
    const B = this.B;
    const want = this.state === 'appear' ? smooth(clamp(this.t / 1.5, 0, 1)) : this.state === 'vanish' ? 1 - smooth(clamp(this.t / 1.2, 0, 1)) : 1;
    this.fade = want;
    this.mat.userData.u.uDissolve.value = (1 - want) * 0.98;
    this.mat.userData.u.uTime.value = time; tickRobes(time);
    if (this.fx && (this.state === 'appear' || this.state === 'vanish') && R() < 0.6) this.fx.wisp(new THREE.Vector3(this.pos.x, this.pos.y + R() * 3.5, this.pos.z), 1.0);
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    // the head tracks the nearest knight with sudden, unnatural snaps
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.6 + R() * 1.8;
      let best = null, bd = 1e9; for (const k of knights || []) { const d = k.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = k; } }
      const look = best ? angleDiff(this.yaw, Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z)) : 0;
      this.headTarget = clamp(look, -1.8, 1.8);
      // now and then the head lolls over, far past where a neck should allow, and stays there
      this.tilt = R() < 0.3 ? (R() < 0.5 ? -1 : 1) * (0.75 + R() * 0.35) : (R() - 0.5) * 0.35;
      this.snap = R() < 0.6;   // most moves are a single sudden snap; the rest a slow, deliberate creep
    }
    let hy = this.headTarget, roll = this.tilt || 0;
    if (this.state === 'turn') {
      // the owl-turn: all the way round, in small jerking steps, the head tipping over as it goes
      const p = smooth(clamp(this.t / 2.2, 0, 1)), steps = Math.floor(p * 9) / 9;
      const q = lerp(steps, p, 0.25) + Math.sin(time * 41) * 0.006;
      hy = this.turnFrom === undefined ? (this.turnFrom = this.headYaw) : this.turnFrom;
      hy += Math.sign(this.headTarget || 1) * Math.PI * q;
      roll = Math.sin(q * Math.PI) * 0.55 * Math.sign(this.headTarget || 1);
      this.headYaw = hy;
    } else {
      this.turnFrom = undefined;
      this.headYaw = dampAngle(this.headYaw, hy, this.snap ? 30 : 1.6, dt);
    }
    this.headRoll = damp(this.headRoll, roll, this.state === 'turn' ? 30 : 2.2, dt);
    const tremor = Math.sin(time * 29) * 0.012 + Math.sin(time * 17.3) * 0.008;
    // utterly still; a slow breath and nothing else
    const breath = Math.sin(time * 0.5) * 1.2;
    e(B.hips, 0, 0, 0); e(B.spine, 4, 0, 0); e(B.chest, 6 + breath, 0, 0);
    // the neck takes a little of the turn and leans into the tilt; the head does the rest
    const ny = clamp(this.headYaw, -0.6, 0.6) * 0.3;
    B.neck.rotation.set(0.14 - Math.abs(this.headRoll) * 0.1, ny, this.headRoll * 0.25, 'YXZ');
    B.head.rotation.set(-0.08 + Math.abs(this.headRoll) * 0.12 + tremor, this.headYaw - ny, this.headRoll * 0.8 + tremor, 'YXZ');
    e(B.jaw, 0, 0, 0);   // the mouth stays shut
    for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['clav' + k], 0, 0, 0); e(B['thigh' + k], 0, 0, sg * 3); e(B['shin' + k], 2, 0, 0); e(B['foot' + k], 0, 0, 0); }
    if (this.mode === 'army') { // arms raised, presenting his legion
      e(B.uArmR, -155 + Math.sin(time * 0.7) * 5, 0, -28); e(B.uArmL, -155 + Math.cos(time * 0.7) * 5, 0, 28); e(B.fArmR, -8, 0, 0); e(B.fArmL, -8, 0, 0); e(B.handR, 10, 0, 0); e(B.handL, 10, 0, 0);
    } else {
      e(B.uArmR, -3, 0, -4); e(B.uArmL, -3, 0, 4); e(B.fArmR, -6, 0, 0); e(B.fArmL, -6, 0, 0);
      e(B.handR, -10 + Math.max(0, Math.sin(time * 2.3)) * 25, 0, 0); e(B.handL, -10 + Math.max(0, Math.sin(time * 1.9 + 1)) * 25, 0, 0); // the long fingers curl and uncurl
    }
  }
}

// ================================================================ CREVICE EYES
export class Crevices {
  constructor(scene, spots) {
    this.list = spots.map((s, i) => {
      const g = new THREE.Group(); g.position.set(0, 0, 0.36); s.group.add(g);
      const eyes = staringEyes([[-0.09, 0.2, 0], [0.09, 0.2, 0]], 0.07); g.add(eyes);
      const fingers = new THREE.Group(); g.add(fingers);
      const fm = new THREE.MeshStandardMaterial({ color: 0x1a1414, roughness: 0.6 });
      for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(limb(0.025, 0.008, 0.45, 5, 0.2, 300 + k), fm); f.position.set(0.32, 0.55 - k * 0.12, 0.05); f.rotation.set(0, 0, -1.2 - k * 0.1); fingers.add(f); }
      const arm = new THREE.Mesh(limb(0.06, 0.03, 1.8, 6, 0.15, 320), fm); arm.rotation.x = -Math.PI / 2; arm.scale.y = 0.001; arm.position.set(0, 0.2, 0); g.add(arm);
      return { s, g, eyes, fingers, arm, blink: R() * 4, retreat: 0, grab: 0, cd: 0, idx: i };
    });
  }
  update(dt, time, knights, host, onGrab) {
    for (const c of this.list) {
      let dmin = 1e9, nearest = null; for (const k of knights) { const d = Math.hypot(k.pos.x - c.s.x, k.pos.z - c.s.z); if (d < dmin) { dmin = d; nearest = k; } }
      const want = dmin < 6 ? 1 : 0; c.retreat = damp(c.retreat, want, 3, dt);
      c.blink -= dt; const closed = c.blink < 0.12; if (c.blink < 0) c.blink = 2 + R() * 5;
      c.eyes.scale.set(1, closed ? 0.1 : 1, 1); c.eyes.position.z = -c.retreat * 0.5; c.eyes.visible = c.retreat < 0.95;
      if (nearest && !closed) { const lp = c.s.group.worldToLocal(nearest.pos.clone().add(new THREE.Vector3(0, 1.5, 0))); c.eyes.lookAt(lp); }
      c.fingers.children.forEach((f, k) => { f.rotation.z = -1.2 - k * 0.1 + Math.sin(time * 2 + k) * 0.15 * (1 - c.retreat) - c.retreat * 0.8; });
      c.fingers.position.x = -c.retreat * 0.3;
      // the long arm lunges out at anyone who lingers too close
      c.cd -= dt;
      if (host && nearest && dmin < 3.6 && c.cd <= 0) { c.cd = 7; c.grab = 0.001; onGrab(c, nearest); }
      if (c.grab > 0) { c.grab += dt; const k = c.grab < 0.18 ? c.grab / 0.18 : Math.max(0, 1 - (c.grab - 0.3) / 0.4); c.arm.scale.y = Math.max(0.001, k); if (c.grab > 0.75) { c.grab = 0; c.arm.scale.y = 0.001; } }
    }
  }
  remoteGrab(i) { const c = this.list[i]; if (c) c.grab = 0.001; }
}

// ================================================================ BOSS BASE
class Boss {
  constructor(scene, kind) { this.scene = scene; this.kind = kind; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.state = 'intro'; this.t = 0; this.alive = true; this.spheres = []; this.hitFlash = 0; this.cd = 2; this.phase = 1; this.atk = 0; this.target = null; this.retarget = 0; this.dead = false; this.deathT = 0; }
  setState(s) { this.state = s; this.t = 0; }
  pickTarget(knights) {
    this.retarget -= 0.016;
    let best = null, bs = 1e9; for (const k of knights) { if (k.downed) continue; let d = k.pos.distanceTo(this.pos); if (k.praying) d *= 0.7; if (d < bs) { bs = d; best = k; } }
    this.target = best; return best;
  }
  hitTest(a, b, extra = 0.25) {
    let best = null;
    for (const s of this.spheres) {
      const c = s.c; const ab = b.clone().sub(a); const t = clamp(c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const p = a.clone().addScaledVector(ab, t); const d = p.distanceTo(c);
      if (d < s.r + extra && (!best || s.mul > best.mul)) best = { point: p, mul: s.mul, part: s.name };
    }
    return best;
  }
  updateSpheres() { for (const s of this.spheres) { s.bone.updateWorldMatrix(true, false); s.c.set(...s.off).applyMatrix4(s.bone.matrixWorld); } }
  takeHit(dmg, dir, stagger, C) {
    if (!this.alive || this.state === 'intro') return false;
    this.hp -= dmg; this.hitFlash = 1;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.setState('death'); C?.ev('bossDeath', this); return true; }
    return false;
  }
  baseSnap() { return [this.kind, +this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(2), this.state, +this.t.toFixed(2), Math.round(this.hp), this.atk, this.phase, +(this.alt || 0).toFixed(2)]; }
  applySnap(s, dt) {
    const [, x, y, z, yaw, st, t, hp, atk, phase, alt] = s;
    const k = 1 - Math.exp(-10 * dt);
    this.pos.x += (x - this.pos.x) * k; this.pos.y += (y - this.pos.y) * k; this.pos.z += (z - this.pos.z) * k;
    if (this.pos.distanceTo(new THREE.Vector3(x, y, z)) > 8) this.pos.set(x, y, z);
    this.yaw = dampAngle(this.yaw, yaw, 10, dt);
    if (st !== this.state) { this.state = st; this.t = t; } else this.t = Math.max(this.t, t);
    if (hp < this.hp - 1) this.hitFlash = 1;
    this.hp = hp; this.atk = atk; this.phase = phase; this.alt = alt;
    if (st === 'death') this.alive = false;
  }
  dispose() { this.scene.remove(this.mesh); }
}

// ================================================================ THE BLACK HOUND
function buildHound() {
  const j = [
    { name: 'hips', parent: null, pos: S(0, 1.5, -0.7) }, { name: 'spine', parent: 'hips', pos: S(0, 0.05, 0.7) }, { name: 'chest', parent: 'spine', pos: S(0, 0.08, 0.7) },
    { name: 'neck', parent: 'chest', pos: S(0, 0.25, 0.45) }, { name: 'head', parent: 'neck', pos: S(0, 0.2, 0.4) }, { name: 'jaw', parent: 'head', pos: S(0, -0.12, 0.12) },
    { name: 'tail1', parent: 'hips', pos: S(0, 0.05, -0.3) }, { name: 'tail2', parent: 'tail1', pos: S(0, 0, -0.5) },
    ...sym((s, k) => [
      { name: 'fl1' + k, parent: 'chest', pos: S(s * 0.32, -0.1, 0.1) }, { name: 'fl2' + k, parent: 'fl1' + k, pos: S(0, -0.6, 0.05) }, { name: 'fl3' + k, parent: 'fl2' + k, pos: S(0, -0.6, -0.05) },
      { name: 'bl1' + k, parent: 'hips', pos: S(s * 0.3, -0.05, 0) }, { name: 'bl2' + k, parent: 'bl1' + k, pos: S(0, -0.55, 0.25) }, { name: 'bl3' + k, parent: 'bl2' + k, pos: S(0, -0.5, -0.3) }, { name: 'bl4' + k, parent: 'bl3' + k, pos: S(0, -0.42, 0.05) },
    ]),
  ];
  const p = [
    { joint: 'hips', geo: blob(0.38, 0.36, 0.45, 0.2, 401) },
    { joint: 'spine', geo: place(blob(0.36, 0.38, 0.5, 0.25, 402), [0, 0, 0]), blend: 0 },
    { joint: 'chest', geo: place(blob(0.48, 0.55, 0.5, 0.25, 403), [0, -0.05, 0.05]) },
    ...[0, 1, 2, 3, 4].map((i) => ({ joint: 'spine', geo: place(new THREE.TorusGeometry(0.4, 0.035, 5, 14, Math.PI * 1.2), [0, -0.05, -0.3 + i * 0.16], [Math.PI / 2, 0, -Math.PI * 0.1]) })), // ribs
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ joint: i < 4 ? 'spine' : 'chest', geo: place(cone(0.04, 0.3, 4), [0, 0.42, -0.3 + (i % 4) * 0.2], [-0.5, 0, 0]) })),
    { joint: 'neck', geo: boneLimb([0, 0.2, 0.4], 0.3, 0.24, 8, 0.15, 404), blend: 0.1 },
    { joint: 'head', geo: place(blob(0.26, 0.24, 0.3, 0.15, 405), [0, 0.02, 0.05]) },
    { joint: 'head', geo: place(blob(0.15, 0.13, 0.32, 0.15, 406), [0, -0.04, 0.38]) },
    { joint: 'head', geo: place(cone(0.07, 0.3, 5), [-0.14, 0.24, -0.05], [-0.9, 0, 0.3]) }, { joint: 'head', geo: place(cone(0.07, 0.3, 5), [0.14, 0.24, -0.05], [-0.9, 0, -0.3]) },
    { joint: 'jaw', geo: place(blob(0.12, 0.06, 0.3, 0.15, 407), [0, -0.03, 0.26]) },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ joint: 'jaw', geo: place(cone(0.016, 0.09, 4), [(i % 2 ? 1 : -1) * 0.07, 0.04, 0.12 + Math.floor(i / 2) * 0.12], [0, 0, 0]) })),
    { joint: 'tail1', geo: boneLimb([0, 0, -0.5], 0.1, 0.06, 6, 0.1, 408), blend: 0.05 }, { joint: 'tail2', geo: boneLimb([0, -0.1, -0.6], 0.06, 0.01, 6, 0.1, 409), blend: 0.05 },
    ...sym((s, k) => [
      { joint: 'fl1' + k, geo: boneLimb([0, -0.6, 0.05], 0.17, 0.12, 8, 0.15, 410), blend: 0.1 }, { joint: 'fl2' + k, geo: boneLimb([0, -0.6, -0.05], 0.11, 0.08, 7, 0.15, 411), blend: 0.06 },
      { joint: 'fl3' + k, geo: place(blob(0.1, 0.06, 0.16, 0.15, 412), [0, -0.03, 0.08]), blend: 0.03 },
      { joint: 'bl1' + k, geo: boneLimb([0, -0.55, 0.25], 0.22, 0.14, 8, 0.15, 413), blend: 0.1 }, { joint: 'bl2' + k, geo: boneLimb([0, -0.5, -0.3], 0.13, 0.08, 7, 0.15, 414), blend: 0.06 },
      { joint: 'bl3' + k, geo: boneLimb([0, -0.42, 0.05], 0.08, 0.07, 6, 0.15, 415), blend: 0.05 }, { joint: 'bl4' + k, geo: place(blob(0.1, 0.06, 0.16, 0.15, 416), [0, -0.03, 0.08]), blend: 0.03 },
    ]),
  ];
  return buildTemplate(j, p);
}

export class Hound extends Boss {
  constructor(scene, partySize) {
    super(scene, 'hound');
    this.name = 'The Black Hound'; this.title = 'Canis Niger';
    const tpl = buildHound(); this.mat = demonMaterial(0xff4010);
    const { mesh, B } = instantiate(tpl, this.mat); this.mesh = mesh; this.B = B; scene.add(mesh); mesh.scale.setScalar(1.25);
    const eyes = new THREE.Mesh(mergeGeometries([place(new THREE.SphereGeometry(0.05, 8, 6), [-0.12, 0.08, 0.28]), place(new THREE.SphereGeometry(0.05, 8, 6), [0.12, 0.08, 0.28])]), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6010).multiplyScalar(4), toneMapped: false }));
    B.head.add(eyes);
    this.maxHp = this.hp = 1100 + 380 * Math.max(0, partySize - 1);
    this.phaseG = 0; this.speedVis = 0;
    this.spheres = [{ name: 'head', bone: B.head, off: [0, 0, 0.2], r: 0.55, mul: 1.5 }, { name: 'chest', bone: B.chest, off: [0, 0, 0], r: 0.75, mul: 1 }, { name: 'spine', bone: B.spine, off: [0, 0, 0], r: 0.6, mul: 1 }, { name: 'hips', bone: B.hips, off: [0, 0, 0], r: 0.6, mul: 1 }, { name: 'neck', bone: B.neck, off: [0, 0.1, 0.2], r: 0.45, mul: 1.2 }].map((s) => ({ ...s, c: new THREE.Vector3() }));
    this.howlT = 12;
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.howlT -= dt;
    if (this.state === 'death') { this.vel.multiplyScalar(0.9); return; }
    if (this.state === 'intro') { if (this.t > 2.4) this.setState('chase'); this.pos.y = C.world.heightAt(this.pos.x, this.pos.z); return; }
    const T = this.pickTarget(C.knights); if (!T) return;
    const to = new THREE.Vector3(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z); const d = to.length(); to.divideScalar(d || 1);
    let want = new THREE.Vector3();
    const face = (r = 6) => { this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), r, dt); };
    switch (this.state) {
      case 'chase':
        face(5); want.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(d > 5 ? 11 : 4);
        if (this.howlT < 0) { this.setState('howl'); C.ev('bossSfx', this, 'howl'); break; }
        if (this.cd <= 0 && d < 3.4) { this.setState('bite'); this.atk = 0; C.ev('bossSfx', this, 'snarl'); }
        else if (this.cd <= 0 && d > 6 && d < 12) { this.setState('pounce'); this.atk = 1; this.leapDir = to.clone(); this.leapSpeed = d / 0.7; C.ev('bossSfx', this, 'roar'); }
        break;
      case 'bite':
        if (this.t < 0.35) face(10);
        if (this.t > 0.38 && !this.hitDone) { this.hitDone = true; for (const k of C.knights) { const dd = k.pos.distanceTo(this.pos); const ang = Math.abs(angleDiff(this.yaw, Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z))); if (dd < 4.2 && ang < 0.8) C.damageKnight(k, 28 * C.dmgMul, this.pos, { knockback: 5 }, this); } }
        if (this.t < 0.45) want.copy(to).multiplyScalar(5);
        if (this.t > 0.9) { this.setState('chase'); this.cd = 1.2 + R(); this.hitDone = false; }
        break;
      case 'pounce':
        if (this.t < 0.45) { face(10); want.set(0, 0, 0); }
        else if (this.t < 1.15) { want.copy(this.leapDir).multiplyScalar(this.leapSpeed); }
        else if (!this.hitDone) { this.hitDone = true; C.ev('slam', this.pos, 3.2); for (const k of C.knights) if (k.pos.distanceTo(this.pos) < 3.4) C.damageKnight(k, 34 * C.dmgMul, this.pos, { knockdown: true }, this); }
        if (this.t > 1.8) { this.setState('chase'); this.cd = 1.6; this.hitDone = false; }
        break;
      case 'howl':
        if (this.t > 0.8 && !this.summoned) { this.summoned = true; C.summonAround(this.pos, 'crawler', 4 + C.knights.length); }
        if (this.t > 2.4) { this.setState('chase'); this.howlT = 20; this.summoned = false; }
        break;
    }
    this.vel.x = damp(this.vel.x, want.x, 6, dt); this.vel.z = damp(this.vel.z, want.z, 6, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; C.world.collide(this, 1.2);
    const gy = C.world.heightAt(this.pos.x, this.pos.z);
    this.pos.y = this.state === 'pounce' && this.t > 0.45 && this.t < 1.15 ? gy + Math.sin((this.t - 0.45) / 0.7 * Math.PI) * 2.5 : gy;
  }
  snap() { return this.baseSnap(); }
  animate(dt, time) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.mat.userData.u.uHit.value = this.hitFlash * 0.6;
    const B = this.B; const sp = Math.hypot(this.vel.x, this.vel.z); this.speedVis = damp(this.speedVis, sp, 6, dt);
    this.phaseG += dt * this.speedVis / 3.2; const ph = this.phaseG * TAU, run = clamp(this.speedVis / 8, 0, 1);
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += Math.sin(ph * 2) * 0.1 * run;
    e(B.hips, Math.sin(ph) * 8 * run, 0, 0); e(B.spine, -Math.sin(ph) * 10 * run, 0, 0); e(B.chest, Math.sin(ph) * 6 * run, 0, 0);
    e(B.neck, -10 + Math.cos(ph) * 6 * run, 0, 0); e(B.head, 10, Math.sin(time * 0.8) * 10 * (1 - run), 0); e(B.jaw, 12 + Math.max(0, Math.sin(time * 4)) * 10, 0, 0);
    e(B.tail1, -20 + Math.sin(ph) * 15, Math.sin(time * 2) * 15, 0); e(B.tail2, 20, Math.sin(time * 2.5) * 20, 0);
    // rotary gallop
    const legs = [['fl', 'R', 0], ['fl', 'L', 0.12], ['bl', 'R', 0.55], ['bl', 'L', 0.67]];
    for (const [l, k, o] of legs) {
      const p = (ph / TAU + o) % 1 * TAU; const sw = Math.sin(p) * run, lift = Math.max(0, Math.cos(p)) * run;
      if (l === 'fl') { e(B['fl1' + k], -sw * 45, 0, 0); e(B['fl2' + k], -lift * 50, 0, 0); e(B['fl3' + k], lift * 40, 0, 0); }
      else { e(B['bl1' + k], -sw * 40, 0, 0); e(B['bl2' + k], lift * 40, 0, 0); e(B['bl3' + k], -lift * 30, 0, 0); }
    }
    const st = this.state, T = this.t;
    if (st === 'bite') { const w = T < 0.35 ? smooth(T / 0.35) : 1 - smooth(clamp((T - 0.4) / 0.4, 0, 1)); e(B.neck, -30 * w + 25 * (T > 0.35 ? 1 : 0) * w, 0, 0); e(B.head, -20 * w, 0, 0); e(B.jaw, 50 * w, 0, 0); }
    if (st === 'pounce' && T < 0.45) { const w = smooth(T / 0.45); B.hips.position.y -= 0.4 * w; e(B.chest, -15 * w, 0, 0); for (const k of ['R', 'L']) { e(B['bl1' + k], 40 * w, 0, 0); e(B['bl2' + k], 60 * w, 0, 0); } }
    if (st === 'pounce' && T >= 0.45 && T < 1.15) { e(B.chest, -20, 0, 0); for (const k of ['R', 'L']) { e(B['fl1' + k], -70, 0, 0); e(B['bl1' + k], 50, 0, 0); } e(B.jaw, 45, 0, 0); }
    if (st === 'howl') { const w = smooth(clamp(T / 0.6, 0, 1)) * (1 - smooth(clamp((T - 1.8) / 0.6, 0, 1))); e(B.neck, -60 * w, 0, 0); e(B.head, -40 * w, 0, 0); e(B.jaw, 35 * w, 0, 0); B.hips.position.y -= 0.3 * w; }
    if (st === 'intro') { const w = 1 - smooth(clamp(T / 2.0, 0, 1)); this.mesh.position.y -= w * 2.5; }
    if (st === 'death') { this.deathT += dt; const k = smooth(clamp(this.deathT / 1.2, 0, 1)); B.hips.rotation.z = k * 1.5; B.hips.position.y = B.hips.userData.rest.y * (1 - 0.5 * k); this.mat.userData.u.uDissolve.value = clamp((this.deathT - 1.5) / 3, 0, 1); }
    this.updateSpheres();
  }
}

// ================================================================ THE OLD SERPENT
export class Serpent extends Boss {
  constructor(scene, partySize) {
    super(scene, 'serpent');
    this.name = 'The Old Serpent'; this.title = 'Serpens Antiquus';
    this.N = 56; this.spacing = 0.62; this.radial = 14;
    this.maxHp = this.hp = 1500 + 450 * Math.max(0, partySize - 1);
    this.chain = []; for (let i = 0; i < this.N; i++) this.chain.push(new THREE.Vector3(0, -6, -i * this.spacing));
    this.rad = (i) => 0.78 * (1 - Math.pow(i / this.N, 1.6)) + 0.1 + (i < 4 ? -0.12 * (4 - i) / 4 : 0);
    const st = scaleTextures(512);
    this.mat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, emissiveMap: st.emissiveMap, emissive: 0xff3010, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2, color: 0x6a6060 });
    const R2 = this.radial + 1;
    const pos = new Float32Array(this.N * R2 * 3), uv = new Float32Array(this.N * R2 * 2), idx = [];
    for (let i = 0; i < this.N; i++) for (let k = 0; k < R2; k++) { uv[(i * R2 + k) * 2] = k / this.radial * 2; uv[(i * R2 + k) * 2 + 1] = i * 0.25; }
    for (let i = 0; i < this.N - 1; i++) for (let k = 0; k < this.radial; k++) { const a = i * R2 + k, b = a + 1, c = a + R2, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    this.geo = g; this.mesh = new THREE.Mesh(g, this.mat); this.mesh.castShadow = true; this.mesh.frustumCulled = false; scene.add(this.mesh);
    // the head: skull, jaw, horns, and His eyes
    const hm = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, emissiveMap: st.emissiveMap, emissive: 0xff3010, emissiveIntensity: 1.6, roughness: 0.4, color: 0x6a6060 });
    this.head = new THREE.Group(); scene.add(this.head);
    this.head.add(new THREE.Mesh(place(blob(0.75, 0.55, 1.1, 0.12, 501), [0, 0.1, 0.5]), hm));
    this.head.add(new THREE.Mesh(place(horn(1.6, 0.13, 3.4), [-0.4, 0.4, 0.1], [0, -0.5, 0.2]), hm)); this.head.add(new THREE.Mesh(place(horn(1.6, 0.13, 3.4), [0.4, 0.4, 0.1], [0, 0.5, -0.2]), hm));
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.15, 0.1); this.head.add(this.jaw);
    this.jaw.add(new THREE.Mesh(place(blob(0.6, 0.22, 1.0, 0.12, 502), [0, -0.1, 0.55]), hm));
    for (let i = 0; i < 2; i++) this.jaw.add(new THREE.Mesh(place(cone(0.07, 0.5, 6), [(i ? 1 : -1) * 0.35, 0.18, 1.2], [0, 0, 0]), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.3 })));
    this.head.add(staringEyes([[-0.36, 0.38, 0.95], [0.36, 0.38, 0.95]], 0.12));
    this.head.traverse((o) => { o.castShadow = true; });
    this.headPos = new THREE.Vector3(); this.headDir = new THREE.Vector3(0, 0, 1); this.rear = 0; this.burrowed = true; this.jawOpen = 0;
    this.spheres = [];
    for (let i = 0; i < this.N; i += 3) this.spheres.push({ name: 'body', i, r: this.rad(i) + 0.25, mul: 1, c: new THREE.Vector3() });
    this.spheres.push({ name: 'head', i: -1, r: 1.1, mul: 1.6, c: new THREE.Vector3() });
    this.alt = 0;
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt;
    if (this.state === 'death') return;
    const T = this.pickTarget(C.knights);
    const W = C.world;
    const toward = (p, speed, ground = true) => {
      const d = new THREE.Vector3(p.x - this.headPos.x, 0, p.z - this.headPos.z); const l = d.length(); if (l > 0.01) d.divideScalar(l);
      this.headDir.lerp(d, 1 - Math.exp(-3 * dt)).normalize();
      this.headPos.addScaledVector(this.headDir, speed * dt);
      return l;
    };
    switch (this.state) {
      case 'intro': case 'burrow': {
        // tunnel under the party, then erupt beside the target
        this.burrowed = true; this.rear = damp(this.rear, -3.5, 2, dt);
        if (T) { const l = toward(T.pos, 12); if (l < 5 && this.t > (this.state === 'intro' ? 2.5 : 1.2)) { this.setState('emerge'); C.ev('bossSfx', this, 'erupt'); C.ev('slam', this.headPos.clone(), 4); } }
        break;
      }
      case 'emerge': this.burrowed = false; this.rear = damp(this.rear, 6.5, 4, dt); if (this.t > 1.2) this.setState('loom'); break;
      case 'loom': { // rear up, sway, choose
        this.rear = damp(this.rear, 5.5 + Math.sin(this.t * 2) * 0.4, 3, dt);
        if (T) toward(T.pos, 0.0);
        if (this.t > 1.0 && this.cd <= 0 && T) {
          const d = T.pos.distanceTo(this.headPos);
          if (d < 9) { this.setState('strike'); this.atk = 0; this.strikeTo = T.pos.clone(); C.ev('bossSfx', this, 'hiss'); }
          else if (d < 22) { this.setState('spit'); this.atk = 1; C.ev('bossSfx', this, 'hiss'); }
          else { this.setState('slither'); }
        }
        if (this.t > 8) this.setState('dive');
        break;
      }
      case 'strike': { // coil back, then lunge the head down onto the target
        if (this.t < 0.55) { this.rear = damp(this.rear, 7.5, 6, dt); this.headPos.addScaledVector(this.headDir, -2 * dt); }
        else if (this.t < 0.85) { this.rear = damp(this.rear, 0.8, 14, dt); toward(this.strikeTo, 22); this.jawOpen = 1; }
        else if (!this.hitDone) { this.hitDone = true; C.ev('slam', this.headPos.clone(), 3); for (const k of C.knights) if (k.pos.distanceTo(this.headPos) < 3.2) C.damageKnight(k, 32 * C.dmgMul, this.headPos, { knockdown: true }, this); }
        if (this.t > 1.8) { this.hitDone = false; this.jawOpen = 0; this.cd = 1.5; this.setState(R() < 0.35 ? 'dive' : 'loom'); }
        break;
      }
      case 'spit':
        this.jawOpen = this.t > 0.6 ? 1 : 0.3;
        if (this.t > 0.7 && !this.hitDone && T) { this.hitDone = true; for (let k = 0; k < 3; k++) C.projectile('venom', { pos: this.headPos.clone().add(new THREE.Vector3(0, 0.5, 0)), chest: this.headPos.clone().add(new THREE.Vector3(0, 0.5, 0)) }, T, k * 0.12); }
        if (this.t > 1.5) { this.hitDone = false; this.jawOpen = 0; this.cd = 2; this.setState('loom'); }
        break;
      case 'slither': // glide along the ground around the knights, tail sweeping
        this.rear = damp(this.rear, 1.2, 3, dt);
        if (T) { const a = this.t * 0.9; const p = new THREE.Vector3(T.pos.x + Math.cos(a) * 7, 0, T.pos.z + Math.sin(a) * 7); toward(p, 9); }
        for (const k of C.knights) for (let i = 8; i < this.N; i += 6) { if (k.pos.distanceTo(this.chain[i]) < this.rad(i) + 0.8 && (this.sweepCd || 0) <= 0) { this.sweepCd = 1.2; C.damageKnight(k, 16 * C.dmgMul, this.chain[i], { knockback: 8 }, this); } }
        this.sweepCd = (this.sweepCd || 0) - dt;
        if (this.t > 5) this.setState('loom');
        break;
      case 'dive': this.rear = damp(this.rear, -4, 3, dt); this.headPos.addScaledVector(this.headDir, 6 * dt); if (this.t > 1.4) this.setState('burrow'); break;
    }
    W.collide({ pos: this.headPos }, 0.5);
    const gy = W.heightAt(this.headPos.x, this.headPos.z);
    this.headPos.y = gy + this.rear;
    this.pos.copy(this.headPos);
    this.yaw = Math.atan2(this.headDir.x, this.headDir.z);
    this.alt = this.rear;
    this.followChain(W);
  }
  followChain(W) {
    const ch = this.chain; ch[0].copy(this.headPos);
    for (let i = 1; i < this.N; i++) {
      const p = ch[i], q = ch[i - 1]; const d = p.clone().sub(q); const l = d.length() || 1;
      p.copy(q).addScaledVector(d, this.spacing / l);
      const gy = W.heightAt(p.x, p.z) + this.rad(i) * 0.8 - (this.burrowed && i < 18 ? 3 : 0);
      const lift = i < 12 ? (1 - i / 12) : 0;
      if (lift <= 0 || p.y < gy) p.y = Math.max(gy, p.y * lift + gy * (1 - lift));
    }
  }
  snap() { return [...this.baseSnap(), +this.headPos.x.toFixed(2), +this.headPos.z.toFixed(2), +this.headDir.x.toFixed(3), +this.headDir.z.toFixed(3), +this.rear.toFixed(2), this.burrowed ? 1 : 0, this.jawOpen]; }
  applySnap(s, dt, W) {
    super.applySnap(s, dt);
    const [, , , , , , , , , , , hx, hz, dx, dz, rear, bur, jaw] = s;
    const k = 1 - Math.exp(-12 * dt);
    this.headPos.x += (hx - this.headPos.x) * k; this.headPos.z += (hz - this.headPos.z) * k;
    this.headDir.set(dx, 0, dz).normalize(); this.rear = rear; this.burrowed = !!bur; this.jawOpen = jaw;
    if (W) { this.headPos.y = W.heightAt(this.headPos.x, this.headPos.z) + this.rear; this.followChain(W); }
  }
  animate(dt, time) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.mat.emissiveIntensity = 1.6 + this.hitFlash * 3;
    const ch = this.chain, R2 = this.radial + 1, pos = this.geo.attributes.position;
    // undulation for the sidewinding body
    let prevN = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.N; i++) {
      const p = ch[i]; const nxt = ch[Math.min(this.N - 1, i + 1)], prv = ch[Math.max(0, i - 1)];
      const t = new THREE.Vector3().subVectors(prv, nxt); if (t.lengthSq() < 1e-6) t.set(0, 0, 1); t.normalize();
      let b = new THREE.Vector3().crossVectors(t, prevN); if (b.lengthSq() < 1e-6) b.set(1, 0, 0); b.normalize();
      const n = new THREE.Vector3().crossVectors(b, t).normalize(); prevN = n;
      const r = this.rad(i) * (1 + Math.sin(time * 3 - i * 0.4) * 0.03);
      const wig = Math.sin(time * 4 - i * 0.35) * 0.15 * (this.burrowed ? 0 : 1);
      for (let k = 0; k <= this.radial; k++) {
        const a = k / this.radial * TAU; const ca = Math.cos(a), sa = Math.sin(a);
        const flat = sa < 0 ? 0.75 : 1; // flattened belly
        pos.setXYZ(i * R2 + k, p.x + (n.x * sa * flat + b.x * ca) * r + b.x * wig, p.y + (n.y * sa * flat + b.y * ca) * r, p.z + (n.z * sa * flat + b.z * ca) * r + b.z * wig);
      }
    }
    pos.needsUpdate = true; this.geo.computeVertexNormals();
    this.head.position.copy(ch[0]);
    const look = new THREE.Vector3().subVectors(ch[0], ch[2]); if (look.lengthSq() > 1e-6) { look.normalize(); this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), look); }
    this.jaw.rotation.x = lerp(this.jaw.rotation.x, this.jawOpen * 0.7 + Math.max(0, Math.sin(time * 2)) * 0.05, 1 - Math.exp(-12 * dt));
    if (this.state === 'death') { this.deathT += dt; const k = clamp(this.deathT / 3, 0, 1); this.mesh.scale.setScalar(1); this.mat.opacity = 1; this.head.scale.setScalar(1 - k * 0.999); if (k >= 1) { this.mesh.visible = false; } }
    for (const s of this.spheres) s.c.copy(s.i < 0 ? this.head.position.clone().add(look.clone().multiplyScalar(0.6)) : ch[s.i]);
  }
  dispose() { this.scene.remove(this.mesh); this.scene.remove(this.head); }
}

// ================================================================ THE LONG-LIMBED THING (cryptid)
function buildCryptid() {
  const j = [
    { name: 'hips', parent: null, pos: S(0, 1.7, 0) }, { name: 'spine', parent: 'hips', pos: S(0, 0.25, 0) }, { name: 'chest', parent: 'spine', pos: S(0, 0.45, 0) },
    { name: 'neck', parent: 'chest', pos: S(0, 0.45, 0.04) }, { name: 'head', parent: 'neck', pos: S(0, 0.22, 0.05) }, { name: 'jaw', parent: 'head', pos: S(0, -0.06, 0.12) },
    ...sym((s, k) => [{ name: 'uArm' + k, parent: 'chest', pos: S(s * 0.3, 0.32, 0) }, { name: 'fArm' + k, parent: 'uArm' + k, pos: S(0, -0.85, 0) }, { name: 'hand' + k, parent: 'fArm' + k, pos: S(0, -0.85, 0) },
      { name: 'thigh' + k, parent: 'hips', pos: S(s * 0.15, -0.05, 0) }, { name: 'shin' + k, parent: 'thigh' + k, pos: S(0, -0.85, 0) }, { name: 'foot' + k, parent: 'shin' + k, pos: S(0, -0.8, 0) }]),
  ];
  const p = [
    { joint: 'hips', geo: blob(0.2, 0.15, 0.14, 0.2, 601) },
    { joint: 'spine', geo: place(blob(0.15, 0.3, 0.12, 0.3, 602), [0, 0.22, 0]), blend: 0.12 },
    ...[0, 1, 2, 3, 4].map((i) => ({ joint: 'spine', geo: place(new THREE.TorusGeometry(0.17, 0.018, 4, 12, Math.PI * 1.2), [0, 0.08 + i * 0.08, 0.02], [Math.PI / 2, 0, Math.PI * 0.4]) })),
    { joint: 'chest', geo: place(blob(0.26, 0.24, 0.15, 0.25, 603), [0, 0.18, 0]), blend: 0.12 },
    { joint: 'neck', geo: place(limb(0.05, 0.045, 0.45, 6, 0.15, 604), [0, 0.45, 0]), blend: 0.06 },
    // deer skull with broken antlers
    { joint: 'head', geo: place(blob(0.11, 0.12, 0.14, 0.12, 605), [0, 0.08, 0]) },
    { joint: 'head', geo: place(blob(0.06, 0.06, 0.2, 0.15, 606), [0, 0.0, 0.2], [0.3, 0, 0]) },
    ...sym((s, k) => [
      { joint: 'head', geo: place(horn(0.7, 0.03, 1.4), [s * 0.08, 0.2, -0.02], [0.2, s * 0.6, s * -0.4]) },
      { joint: 'head', geo: place(horn(0.4, 0.02, 1.1), [s * 0.12, 0.35, 0.05], [0.6, s * 1.0, s * -0.8]) },
    ]),
    { joint: 'jaw', geo: place(blob(0.05, 0.03, 0.16, 0.15, 607), [0, -0.02, 0.1]) },
    ...sym((s, k) => [
      { joint: 'uArm' + k, geo: limb(0.05, 0.035, 0.85, 7, 0.2, 610 + s), blend: 0.08 }, { joint: 'fArm' + k, geo: limb(0.036, 0.024, 0.85, 7, 0.2, 611 + s), blend: 0.06 },
      ...[0, 1, 2, 3].map((i) => ({ joint: 'hand' + k, geo: place(limb(0.013, 0.004, 0.42, 4, 0.1, 612 + i), [(i - 1.5) * 0.025, -0.02, 0.0], [0.2, 0, (i - 1.5) * 0.1]) })),
      { joint: 'thigh' + k, geo: limb(0.07, 0.045, 0.85, 7, 0.2, 613 + s), blend: 0.08 }, { joint: 'shin' + k, geo: limb(0.045, 0.03, 0.8, 7, 0.2, 614 + s), blend: 0.06 },
      { joint: 'foot' + k, geo: place(blob(0.04, 0.03, 0.14, 0.2, 615), [0, -0.02, 0.1]), blend: 0.02 },
    ]),
  ];
  return buildTemplate(j, p);
}

export class Cryptid extends Boss {
  constructor(scene, partySize, fx) {
    super(scene, 'cryptid');
    this.fx = fx;
    this.name = 'The Thing on the Ridge'; this.title = 'Res Ambulans';
    const tpl = buildCryptid(); this.mat = demonMaterial(0xa0b0c0);
    this.mat.color.set(0xd8d0c8); this.mat.emissiveIntensity = 0.3;
    const { mesh, B } = instantiate(tpl, this.mat); this.mesh = mesh; this.B = B; scene.add(mesh); mesh.scale.setScalar(1.15);
    B.head.add(staringEyes([[-0.055, 0.1, 0.1], [0.055, 0.1, 0.1]], 0.045, 0xffd040));
    this.maxHp = this.hp = 1250 + 400 * Math.max(0, partySize - 1);
    this.spheres = [{ name: 'head', bone: B.head, off: [0, 0.08, 0.05], r: 0.3, mul: 1.6 }, { name: 'chest', bone: B.chest, off: [0, 0.15, 0], r: 0.45, mul: 1 }, { name: 'spine', bone: B.spine, off: [0, 0.2, 0], r: 0.35, mul: 1 }, { name: 'hips', bone: B.hips, off: [0, 0, 0], r: 0.35, mul: 1 },
      { name: 'leg', bone: B.shinR, off: [0, -0.4, 0], r: 0.25, mul: 0.8 }, { name: 'leg', bone: B.shinL, off: [0, -0.4, 0], r: 0.25, mul: 0.8 }].map((s) => ({ ...s, c: new THREE.Vector3() }));
    this.speedVis = 0; this.ph = 0; this.stalkA = R() * TAU; this.hits = 0;
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt;
    if (this.state === 'death') { this.vel.multiplyScalar(0.9); return; }
    const T = this.pickTarget(C.knights); if (!T) return;
    const to = new THREE.Vector3(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z); const d = to.length(); to.divideScalar(d || 1);
    const want = new THREE.Vector3();
    switch (this.state) {
      case 'intro': if (this.t > 2.2) this.setState('stalk'); break;
      case 'stalk': { // circle at the edge of sight, watching
        this.stalkA += dt * 0.35;
        const p = new THREE.Vector3(T.pos.x + Math.cos(this.stalkA) * 20, 0, T.pos.z + Math.sin(this.stalkA) * 20);
        want.set(p.x - this.pos.x, 0, p.z - this.pos.z); const l = want.length(); if (l > 0.5) want.multiplyScalar(Math.min(7, l * 2) / l);
        this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), 4, dt);
        if (this.t > 4 + R() * 2) { this.setState('dash'); C.ev('bossSfx', this, 'scream'); }
        break;
      }
      case 'dash': // on all fours, impossibly fast
        this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), 6, dt);
        want.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(14);
        if (d < 3.2) { this.setState('claw'); this.atk = 0; this.combo = 0; }
        if (this.t > 4) this.setState('stalk');
        break;
      case 'claw':
        this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), 8, dt);
        if (this.t > 0.35 && !this.hitDone) { this.hitDone = true; for (const k of C.knights) { const dd = k.pos.distanceTo(this.pos); const ang = Math.abs(angleDiff(this.yaw, Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z))); if (dd < 4.2 && ang < 1.0) C.damageKnight(k, 22 * C.dmgMul, this.pos, { knockback: 4 }, this); } }
        if (this.t < 0.4) want.copy(to).multiplyScalar(4);
        if (this.t > 0.7) { this.hitDone = false; this.combo++; this.atk = this.combo % 2; if (this.combo >= 3) { this.setState('retreat'); this.atk = 0; } else this.t = 0; }
        break;
      case 'retreat':
        want.copy(to).multiplyScalar(-11); this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), 6, dt);
        if (this.t > 1.4) this.setState('stalk');
        break;
      case 'stagger': if (this.t > 1.2) this.setState('retreat'); break;
    }
    this.vel.x = damp(this.vel.x, want.x, 7, dt); this.vel.z = damp(this.vel.z, want.z, 7, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; C.world.collide(this, 0.6);
    this.pos.y = C.world.heightAt(this.pos.x, this.pos.z);
  }
  takeHit(dmg, dir, stagger, C) {
    const r = super.takeHit(dmg, dir, stagger, C);
    if (this.alive && stagger > 1.1 && this.state !== 'stagger') { this.setState('stagger'); }
    return r;
  }
  snap() { return this.baseSnap(); }
  animate(dt, time) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.mat.userData.u.uHit.value = this.hitFlash * 0.6;
    const B = this.B; const sp = Math.hypot(this.vel.x, this.vel.z); this.speedVis = damp(this.speedVis, sp, 6, dt);
    const fours = this.state === 'dash' || this.state === 'retreat' ? 1 : 0;
    this.four = damp(this.four || 0, fours, 5, dt);
    this.ph += dt * this.speedVis / (2.8 + this.four * 1.2); const ph = this.ph * TAU; const run = clamp(this.speedVis / 6, 0, 1);
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    const f = this.four;
    B.hips.position.copy(B.hips.userData.rest); B.hips.position.y -= f * 0.7 - Math.abs(Math.sin(ph)) * 0.1 * run;
    e(B.hips, 10 + f * 30, 0, 0); e(B.spine, 15 + f * 25 + Math.sin(time * 0.7) * 3, 0, 0); e(B.chest, 10 + f * 20, 0, 0);
    e(B.neck, -20 - f * 50, 0, 0); e(B.head, -10 - f * 10, Math.sin(time * 1.6) * 30 * (1 - run), Math.sin(time * 0.9) * 25 * (1 - run)); // the slow, wrong tilt of its head
    e(B.jaw, 8 + Math.max(0, Math.sin(time * 1.3)) * 25, 0, 0);
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = ph + o * TAU; const sw = Math.sin(p) * run;
      e(B['thigh' + k], -sw * 35 - 20 * f - 10, 0, sg * 6); e(B['shin' + k], 25 + Math.max(0, Math.cos(p)) * 60 * run + 30 * f, 0, 0); e(B['foot' + k], -15, 0, 0);
      e(B['uArm' + k], lerp(-10 + Math.sin(time * 0.8 + o * 3) * 6, -60 - sw * 50 * -1, f), 0, sg * lerp(8, 12, f)); e(B['fArm' + k], lerp(-15, -5, f), 0, 0); e(B['hand' + k], lerp(-10, 30, f), 0, 0);
    }
    if (this.state === 'claw') {
      const w = smooth(clamp(this.t / 0.3, 0, 1)), sk = smooth(clamp((this.t - 0.3) / 0.15, 0, 1));
      const k = this.atk ? 'L' : 'R', sg = this.atk ? 1 : -1;
      e(B['uArm' + k], lerp(-160 * w, -40, sk), lerp(0, -sg * 40, sk), sg * 30); e(B['fArm' + k], -40 * (1 - sk), 0, 0); e(B.chest, 20 + 20 * sk, sg * 25 * sk, 0); e(B.jaw, 50, 0, 0);
    }
    if (this.state === 'intro') { const w = smooth(clamp(this.t / 2, 0, 1)); e(B.neck, -20 + 70 * (1 - w), 0, 0); B.hips.position.y -= (1 - w) * 1.2; }
    if (this.state === 'stagger') { e(B.chest, -25, 0, 15); e(B.head, -40, 0, 30); }
    if (this.state === 'death') { this.deathT += dt; const k = smooth(clamp(this.deathT / 1.4, 0, 1)); B.hips.position.y = B.hips.userData.rest.y * (1 - 0.7 * k); e(B.spine, 60 * k, 0, 0); this.mat.userData.u.uDissolve.value = clamp((this.deathT - 1.5) / 3, 0, 1); }
    this.updateSpheres();
  }
}

// ================================================================ THE GREAT DRAGON
function buildDragon() {
  const j = [
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
  const F = { f1: [5.4, 0, 1.6], f2: [6.2, 0, -1.2], f3: [3.6, 0, -4.4] };
  const p = [
    { joint: 'hips', geo: blob(1.25, 1.1, 1.6, 0.12, 701, 3) },
    { joint: 'spine', geo: blob(1.35, 1.2, 1.35, 0.12, 702, 3), blend: 0 },
    { joint: 'chest', geo: place(blob(1.6, 1.55, 1.5, 0.12, 703, 3), [0, 0.1, 0.1]) },
    { joint: 'chest', geo: place(blob(1.0, 0.8, 1.2, 0.15, 704), [0, -0.7, 0.4]) }, // keel
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ joint: i < 3 ? 'hips' : i < 6 ? 'spine' : 'chest', geo: place(cone(0.16, 0.9 - (i % 3) * 0.1, 5), [0, 1.1 + (i % 3 === 1 ? 0.1 : 0), -0.6 + (i % 3) * 0.6], [-0.4, 0, 0]) })),
    ...[1, 2, 3, 4, 5].map((i) => ({ joint: 'neck' + i, geo: boneLimb([0, i < 5 ? 0.5 : 0.3, 0.75], 0.75 - i * 0.08, 0.68 - i * 0.08, 10, 0.08, 710 + i), blend: 0.3 })),
    ...[1, 2, 3, 4, 5].map((i) => ({ joint: 'neck' + i, geo: place(cone(0.1, 0.5, 4), [0, 0.6 - i * 0.05, 0.3], [-0.6, 0, 0]) })),
    // the head: long skull, heavy brow, snout, horns
    { joint: 'head', geo: place(blob(0.62, 0.55, 0.85, 0.1, 720), [0, 0.12, 0.3]) },
    { joint: 'head', geo: place(blob(0.45, 0.38, 0.9, 0.1, 721), [0, 0.0, 1.15]) },
    { joint: 'head', geo: place(blob(0.6, 0.15, 0.3, 0.15, 722), [0, 0.45, 0.7]) }, // brow
    ...sym((s, k) => [
      { joint: 'head', geo: place(horn(2.4, 0.2, 2.6), [s * 0.42, 0.5, 0.0], [0.2, s * 0.35, 0]) },
      { joint: 'head', geo: place(horn(1.2, 0.1, 2.0), [s * 0.55, 0.25, -0.1], [0.4, s * 0.9, s * -0.3]) },
      { joint: 'head', geo: place(cone(0.07, 0.35, 5), [s * 0.5, -0.1, 0.2], [0.2, 0, s * 1.2]) },
    ]),
    { joint: 'jaw', geo: place(blob(0.4, 0.17, 0.95, 0.12, 723), [0, -0.05, 0.65]) },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ joint: 'jaw', geo: place(cone(0.05, 0.28, 5), [(i % 2 ? 1 : -1) * 0.3, 0.15, 0.4 + Math.floor(i / 2) * 0.3], [0, 0, 0]) })),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ joint: 'head', geo: place(cone(0.05, 0.25, 5), [(i % 2 ? 1 : -1) * 0.34, -0.25, 0.8 + Math.floor(i / 2) * 0.28], [Math.PI, 0, 0]) })),
    { joint: 'tail1', geo: boneLimb([0, -0.04, -1.35], 0.85, 0.7, 10, 0.08, 730), blend: 0.3 },
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ joint: 'tail' + i, geo: boneLimb([0, -0.04, -1.35], 0.78 - i * 0.08, 0.7 - i * 0.075, 9, 0.08, 730 + i), blend: 0.3 })),
    ...[1, 3, 5, 7].map((i) => ({ joint: 'tail' + i, geo: place(cone(0.1, 0.5, 4), [0, 0.6 - i * 0.05, -0.6], [-0.7, 0, 0]) })),
    { joint: 'tail9', geo: place(cone(0.5, 1.2, 4), [0, 0, -1.6], [-Math.PI / 2, 0, 0], [1, 1, 0.2]) }, // the spade
    ...sym((s, k) => [
      { joint: 'thigh' + k, geo: boneLimb([0, -1.6, 0.55], 0.62, 0.42, 10, 0.1, 740), blend: 0.25 },
      { joint: 'shin' + k, geo: boneLimb([0, -1.45, -0.65], 0.4, 0.26, 9, 0.1, 741), blend: 0.15 },
      { joint: 'foot' + k, geo: place(blob(0.35, 0.18, 0.55, 0.12, 742), [0, -0.1, 0.35]), blend: 0.05 },
      ...[0, 1, 2].map((i) => ({ joint: 'foot' + k, geo: place(cone(0.07, 0.4, 5), [(i - 1) * 0.18, -0.15, 0.9], [Math.PI / 2 - 0.3, 0, 0]) })),
      { joint: 'wing1' + k, geo: boneLimb([s * 2.6, 0.2, -0.3], 0.36, 0.26, 9, 0.08, 750), blend: 0.2 },
      { joint: 'wing2' + k, geo: boneLimb([s * 3.4, 0, -0.6], 0.25, 0.16, 8, 0.08, 751), blend: 0.15 },
      { joint: 'wing3' + k, geo: place(cone(0.12, 0.7, 5), [s * 0.2, 0.1, 0.4], [-1.2, 0, 0]) }, // wrist claw
      ...['f1', 'f2', 'f3'].map((f, i) => ({ joint: f + k, geo: boneLimb([s * F[f][0], F[f][1], F[f][2]], 0.13 - i * 0.02, 0.025, 6, 0.05, 752 + i) })),
      membrane(s, k, F),
    ]),
  ];
  return buildTemplate(j, p);
}

// Wing membrane panels in wing1-local space, skinned by distance to the wing bones
function membrane(s, k, F) {
  const O = new THREE.Vector3(0, 0, 0), E = new THREE.Vector3(s * 2.6, 0.2, -0.3), W = E.clone().add(new THREE.Vector3(s * 3.4, 0, -0.6));
  const T = ['f1', 'f2', 'f3'].map((f) => W.clone().add(new THREE.Vector3(s * F[f][0], F[f][1], F[f][2])));
  const H = new THREE.Vector3(s * 0.1, -1.0, -3.4); // trailing edge meets the flank
  const segs = [['wing1' + k, O, E], ['wing2' + k, E, W], ['f1' + k, W, T[0]], ['f2' + k, W, T[1]], ['f3' + k, W, T[2]], ['hips', H, H]];
  const segDist = (p, a, b) => { const ab = b.clone().sub(a); const t = ab.lengthSq() ? clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0; return a.clone().addScaledVector(ab, t).distanceTo(p); };
  const pos = [], uv = [], idx = [];
  const tri = (A, B, C, scallop) => {
    const n = 8; const base = pos.length / 3; const map = {};
    for (let i = 0; i <= n; i++) for (let jj = 0; jj <= n - i; jj++) {
      const a = i / n, b = jj / n, c = 1 - a - b;
      const p = new THREE.Vector3().addScaledVector(A, c).addScaledVector(B, a).addScaledVector(C, b);
      if (scallop && c < 1e-6) { const t = a; p.lerp(A, Math.sin(t * Math.PI) * 0.22); } // scalloped trailing edge
      p.y -= Math.sin(a * Math.PI) * Math.sin(b * Math.PI) * 0.25; // billow
      map[i + ',' + jj] = pos.length / 3; pos.push(p.x, p.y, p.z); uv.push(a, b);
    }
    for (let i = 0; i < n; i++) for (let jj = 0; jj < n - i; jj++) {
      const a = map[i + ',' + jj], b = map[(i + 1) + ',' + jj], c = map[i + ',' + (jj + 1)]; idx.push(a, b, c);
      if (jj < n - i - 1) { const d = map[(i + 1) + ',' + (jj + 1)]; idx.push(b, d, c); }
    }
  };
  tri(W, T[0], T[1], true); tri(W, T[1], T[2], true); tri(W, T[2], H, true); tri(W, H, E, false); tri(E, H, O, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return {
    joint: 'wing1' + k, geo: g,
    skin: (x, y, z) => {
      const p = new THREE.Vector3(x, y, z);
      const ws = segs.map(([name, a, b]) => [name, 1 / Math.pow(segDist(p, a, b) + 0.15, 3)]).sort((A, B) => B[1] - A[1]);
      const t = ws[0][1] + ws[1][1]; return [ws[0][0], ws[0][1] / t, ws[1][0], ws[1][1] / t];
    },
  };
}

export class Dragon extends Boss {
  constructor(scene, partySize, fx) {
    super(scene, 'dragon');
    this.fx = fx;
    this.name = 'The Great Dragon'; this.title = 'Draco Magnus Rufus';
    const tpl = buildDragon(); this.mat = dragonMaterial();
    const { mesh, B } = instantiate(tpl, this.mat); this.mesh = mesh; this.B = B; scene.add(mesh); mesh.scale.setScalar(1.35);
    B.head.add(staringEyes([[-0.42, 0.32, 0.75], [0.42, 0.32, 0.75]], 0.14, 0xffa020));
    this.maxHp = this.hp = 5200 + 1900 * Math.max(0, partySize - 1);
    this.alt = 0; this.ph = 0; this.flap = 0; this.fly = 0; this.breath = 0; this.wardsDone = 0;
    this.spheres = [
      { name: 'head', bone: B.head, off: [0, 0.1, 0.7], r: 1.1, mul: 1.6 }, { name: 'neck', bone: B.neck3, off: [0, 0.2, 0.3], r: 0.9, mul: 1.15 }, { name: 'neck', bone: B.neck1, off: [0, 0.2, 0.3], r: 1.0, mul: 1.1 },
      { name: 'chest', bone: B.chest, off: [0, 0, 0], r: 2.1, mul: 1.0 }, { name: 'body', bone: B.spine, off: [0, 0, 0], r: 1.8, mul: 0.9 }, { name: 'body', bone: B.hips, off: [0, 0, 0], r: 1.7, mul: 0.9 },
      { name: 'leg', bone: B.shinR, off: [0, -0.6, 0], r: 0.7, mul: 0.8 }, { name: 'leg', bone: B.shinL, off: [0, -0.6, 0], r: 0.7, mul: 0.8 },
      { name: 'tail', bone: B.tail2, off: [0, 0, 0], r: 0.9, mul: 0.7 }, { name: 'tail', bone: B.tail4, off: [0, 0, 0], r: 0.7, mul: 0.7 },
      { name: 'wing', bone: B.wing2R, off: [-1.5, 0, 0], r: 0.6, mul: 0.6 }, { name: 'wing', bone: B.wing2L, off: [1.5, 0, 0], r: 0.6, mul: 0.6 },
    ].map((s) => ({ ...s, c: new THREE.Vector3() }));
    this.firePatches = []; this.strafe = null; this.mouth = new THREE.Vector3(); this.mouthDir = new THREE.Vector3(0, 0, 1);
  }
  get groundY() { return this._gy || 0; }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt;
    const W = C.world;
    this._gy = W.heightAt(this.pos.x, this.pos.z);
    if (this.state === 'death') { this.alt = damp(this.alt, 0, 2, dt); return; }
    const T = this.pickTarget(C.knights);
    const to = T ? new THREE.Vector3(T.pos.x - this.pos.x, 0, T.pos.z - this.pos.z) : new THREE.Vector3(0, 0, 1); const d = to.length(); to.divideScalar(d || 1);
    const face = (r = 2.5) => { this.yaw = dampAngle(this.yaw, Math.atan2(to.x, to.z), r, dt); };
    const want = new THREE.Vector3();
    const hpF = this.hp / this.maxHp;
    // phase changes
    if (this.phase === 1 && hpF < 0.66 && this.state !== 'takeoff') { this.phase = 2; this.setState('takeoff'); C.ev('bossPhase', this, 2); }
    if (this.phase === 2 && this.wardsDone >= 3 && this.state !== 'crash') { this.phase = 3; this.setState('crash'); C.ev('bossPhase', this, 3); }
    const enraged = this.phase === 3 ? 1.3 : 1;
    // lingering hellfire on the ground
    for (let i = this.firePatches.length - 1; i >= 0; i--) {
      const f = this.firePatches[i]; f.t -= dt; f.tick -= dt;
      if (f.tick <= 0) { f.tick = 0.5; for (const k of C.knights) if (!k.downed && Math.hypot(k.pos.x - f.x, k.pos.z - f.z) < f.r) C.damageKnight(k, 7 * C.dmgMul, new THREE.Vector3(f.x, 0, f.z), { unblockable: true, fire: true }, this); }
      if (f.t <= 0) this.firePatches.splice(i, 1);
    }
    switch (this.state) {
      case 'intro': this.alt = damp(this.alt, 0, 1.2, dt); this.fly = Math.max(0, this.fly - dt * 0.25); if (this.t > 5.5) { this.fly = 0; this.setState('stalk'); } break;
      case 'stalk': {
        face(1.8); if (d > 9) want.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(4.2 * enraged);
        if (this.cd <= 0 && T) {
          const behind = C.knights.some((k) => !k.downed && Math.abs(angleDiff(this.yaw, Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z))) > 2.2 && k.pos.distanceTo(this.pos) < 12);
          if (behind) { this.setState('tail'); this.atk = 1; C.ev('bossSfx', this, 'growl'); }
          else if (d < 8) { this.setState(R() < 0.5 ? 'bite' : 'stomp'); this.atk = this.state === 'bite' ? 0 : 2; C.ev('bossSfx', this, 'growl'); }
          else if (d < 20) { this.setState('breath'); this.atk = 3; C.ev('bossSfx', this, 'inhale'); }
          if (this.phase === 3 && R() < 0.25 && this.state === 'stalk') { this.setState('roar'); C.ev('bossSfx', this, 'roar'); }
        }
        break;
      }
      case 'bite': {
        if (this.t < 0.6) face(4);
        if (this.t > 0.75 && !this.hitDone) { this.hitDone = true; for (const k of C.knights) { const dd = k.pos.distanceTo(this.mouth); if (dd < 3.4) C.damageKnight(k, 40 * C.dmgMul, this.pos, { knockdown: true }, this); } }
        if (this.t > 1.6 / enraged) { this.endAttack(1.4); }
        break;
      }
      case 'stomp': {
        if (this.t < 0.7) face(3);
        if (this.t > 0.95 && !this.hitDone) { this.hitDone = true; C.ev('slam', this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 3, 0, Math.cos(this.yaw) * 3)), 5); for (const k of C.knights) if (k.pos.distanceTo(this.pos) < 7.5) C.damageKnight(k, 30 * C.dmgMul, this.pos, { knockdown: true }, this); }
        if (this.t > 1.9 / enraged) this.endAttack(1.6);
        break;
      }
      case 'tail': { // whirl the tail through everything behind
        this.yaw += dt * 3.2 * (this.tailDir || 1);
        if (!this.tailDir) this.tailDir = R() < 0.5 ? -1 : 1;
        if (this.t > 0.3 && this.t < 1.6) for (const k of C.knights) { if (k.downed || (this.tailHit || (this.tailHit = new Set())).has(k)) continue; const dd = k.pos.distanceTo(this.pos); if (dd > 4 && dd < 13) { const a = angleDiff(this.yaw + Math.PI, Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z)); if (Math.abs(a) < 0.6) { this.tailHit.add(k); C.damageKnight(k, 26 * C.dmgMul, this.pos, { knockback: 12, knockdown: true }, this); } } }
        if (this.t > 2.0) { this.tailHit = null; this.tailDir = 0; this.endAttack(1.2); }
        break;
      }
      case 'breath': { // sweep a cone of fire
        if (this.t < 1.0) face(3);
        else if (this.t < 3.4) {
          this.breath = 1; this.yaw += Math.sin((this.t - 1) * 1.3) * dt * 0.9;
          this.breathTick = (this.breathTick || 0) - dt;
          if (this.breathTick <= 0) { this.breathTick = 0.25; this.coneDamage(C, 16, 0.42, 9); if (R() < 0.5) this.firePatch(C, this.mouth, this.mouthDir, 10); }
        } else this.breath = 0;
        if (this.t > 4.0) this.endAttack(2.0);
        break;
      }
      case 'roar': if (this.t > 0.8 && !this.summoned) { this.summoned = true; C.summonAround(this.pos, 'shade', 3 + C.knights.length); if (this.phase === 3) C.summonAround(this.pos, 'herald', 1); } if (this.t > 2.6) { this.summoned = false; this.endAttack(1); } break;
      case 'takeoff': this.fly = Math.min(1, this.fly + dt * 0.5); this.alt = damp(this.alt, 16, 0.8, dt); if (this.t > 3.2) { this.setState('circle'); C.ev('wardsActive', this); } break;
      case 'circle': { // circle the summit; between passes, rain fire
        this.fly = 1; const a = (this.circA = (this.circA || 0) + dt * 0.25);
        const tx = Math.cos(a) * 30, tz = Math.sin(a) * 30; want.set(tx - this.pos.x, 0, tz - this.pos.z); const l = want.length(); if (l > 0.1) want.multiplyScalar(13 / l);
        this.yaw = dampAngle(this.yaw, Math.atan2(want.x, want.z), 2, dt); this.alt = damp(this.alt, 18 + Math.sin(this.t) * 2, 1, dt);
        if (this.t > 7 && T) { this.setState('strafe'); const s0 = new THREE.Vector3(T.pos.x, 0, T.pos.z); const dir = s0.clone().sub(new THREE.Vector3(this.pos.x, 0, this.pos.z)).normalize(); this.strafe = { dir }; C.ev('bossSfx', this, 'roar'); }
        if (this.t > 4 && R() < dt * 0.3) C.summonAround(new THREE.Vector3(0, 0, 0), 'shade', 2);
        break;
      }
      case 'strafe': { // a low run across the summit, breathing fire on the ground beneath
        this.fly = 1; want.copy(this.strafe.dir).multiplyScalar(16);
        this.yaw = dampAngle(this.yaw, Math.atan2(this.strafe.dir.x, this.strafe.dir.z), 4, dt);
        this.alt = damp(this.alt, this.t < 3.2 ? 5 : 18, 1.5, dt);
        if (this.t > 0.8 && this.t < 3.4) { this.breath = 1; this.breathTick = (this.breathTick || 0) - dt; if (this.breathTick <= 0) { this.breathTick = 0.2; const below = new THREE.Vector3(this.pos.x, this.groundY, this.pos.z).addScaledVector(this.strafe.dir, 4); this.firePatch(C, below, null, 0); this.coneDamage(C, 12, 0.6, 8); } }
        else this.breath = 0;
        if (this.t > 4.5) this.setState('circle');
        break;
      }
      case 'stunned': this.alt = damp(this.alt, this.phase === 2 ? 2 : 0, 2, dt); this.breath = 0; if (this.t > 3) this.setState(this.phase === 2 ? 'circle' : 'stalk'); break;
      case 'crash': this.fly = Math.max(0, this.fly - dt * 0.8); this.alt = damp(this.alt, 0, 2.5, dt); this.breath = 0; if (this.t > 1.2 && !this.crashed) { this.crashed = true; C.ev('slam', this.pos.clone(), 8); C.ev('bossSfx', this, 'crash'); } if (this.t > 4.5) this.setState('stalk'); break;
    }
    this.vel.x = damp(this.vel.x, want.x, 2.5, dt); this.vel.z = damp(this.vel.z, want.z, 2.5, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.fly < 0.5) { const r = Math.hypot(this.pos.x, this.pos.z); if (r > 27) { this.pos.x *= 27 / r; this.pos.z *= 27 / r; } }
    // knights cannot walk through Him
    if (this.alt < 3) for (const k of C.knights) { const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z; const dd = Math.hypot(dx, dz); if (dd < 3.2 && dd > 1e-3) { k.pos.x = this.pos.x + dx / dd * 3.2; k.pos.z = this.pos.z + dz / dd * 3.2; } }
    this.pos.y = this.groundY;
  }
  endAttack(cd) { this.hitDone = false; this.breath = 0; this.setState('stalk'); this.cd = cd / (this.phase === 3 ? 1.4 : 1); }
  coneDamage(C, len, half, dmg) {
    for (const k of C.knights) {
      if (k.downed) continue; const v = k.chestPos.clone().sub(this.mouth); const dist = v.length(); if (dist > len) continue;
      const ang = v.normalize().angleTo(this.mouthDir); if (ang < half) C.damageKnight(k, dmg * C.dmgMul, this.mouth, { unblockable: true, fire: true }, this);
    }
  }
  firePatch(C, origin, dir, dist) {
    const p = origin.clone(); if (dir) p.addScaledVector(dir, dist * (0.5 + R() * 0.6));
    p.y = C.world.heightAt(p.x, p.z);
    this.firePatches.push({ x: p.x, z: p.z, r: 2.4, t: 5, tick: 0 });
    C.ev('firePatch', p);
  }
  wardStrike(C) { // a completed ward calls down heaven's light upon Him
    this.wardsDone++; this.hp -= this.maxHp * 0.07; this.hitFlash = 1;
    if (this.hp <= 1) this.hp = 1;
    this.setState('stunned');
  }
  snap() { return [...this.baseSnap(), +this.fly.toFixed(2), this.breath, this.wardsDone, this.firePatches.map((f) => [+f.x.toFixed(1), +f.z.toFixed(1), +f.t.toFixed(1)])]; }
  applySnap(s, dt) { super.applySnap(s, dt); this.fly = s[11]; this.breath = s[12]; this.wardsDone = s[13]; this.firePatches = (s[14] || []).map(([x, z, t]) => ({ x, z, t, r: 2.4 })); }
  animate(dt, time, fx) {
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4); this.mat.userData.u.uHit.value = this.hitFlash * 0.5;
    const B = this.B, st = this.state, T = this.t;
    this.mesh.position.set(this.pos.x, this.pos.y + this.alt, this.pos.z); this.mesh.rotation.y = this.yaw;
    const fly = this.fly; const sp = Math.hypot(this.vel.x, this.vel.z);
    this.ph += dt * (sp / 6) * (1 - fly); const ph = this.ph * TAU;
    this.flap += dt * (st === 'takeoff' ? 1.4 : st === 'strafe' ? 0.6 : 0.9) * fly; const fl = Math.sin(this.flap * TAU);
    const br = Math.sin(time * 0.9) * 0.5 + 0.5; // breathing
    // body
    B.hips.position.copy(B.hips.userData.rest);
    B.hips.position.y += -Math.abs(Math.sin(ph)) * 0.2 * (1 - fly) + fl * 0.3 * fly;
    e(B.hips, -4 * (1 - fly) + 6 * fly, Math.sin(ph) * 4 * (1 - fly), 0);
    e(B.spine, 2 + br * 1.5, -Math.sin(ph) * 4 * (1 - fly), 0); e(B.chest, -4 + br * 2 - 8 * fly, 0, 0);
    // neck: S-curve, swaying, the head turning to watch
    const look = this.target ? angleDiff(this.yaw, Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z)) : 0;
    const ly = clamp(look, -1.2, 1.2) / 5;
    const nk = [[-20, 14], [-10, 10], [5, 6], [20, 4], [25, 2]];
    nk.forEach(([x, swayAmp], i) => e(B['neck' + (i + 1)], x * (1 - fly * 0.6) + 25 * fly * (i < 2 ? 1 : 0), ly * 180 / Math.PI + Math.sin(time * 0.6 + i * 0.5) * swayAmp * 0.3, 0));
    e(B.head, 20 + br * 2 - 30 * fly * 0.5, 0, Math.sin(time * 0.4) * 4); e(B.jaw, 4 + br * 3, 0, 0);
    for (let i = 1; i <= 9; i++) e(B['tail' + i], (i === 1 ? -6 : 2) * (1 - fly) + 2 * fly, Math.sin(time * 1.1 - i * 0.5) * (4 + i * 0.8) * (1 - fly * 0.5) + Math.sin(ph) * 3, 0);
    // legs: walking (folded up in flight)
    for (const [k, sg, o] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const p = ph + o * TAU; const sw = Math.sin(p) * clamp(sp / 4, 0, 1) * (1 - fly), lift = Math.max(0, Math.cos(p)) * clamp(sp / 4, 0, 1) * (1 - fly);
      e(B['thigh' + k], -sw * 25 + 60 * fly, 0, sg * 4); e(B['shin' + k], lift * 30 + 40 * fly, 0, 0); e(B['foot' + k], -lift * 20 + 50 * fly, 0, 0);
    }
    // wings: folded at rest, spread and beating in flight
    for (const [k, s] of [['R', -1], ['L', 1]]) {
      const spread = fly;
      const sweep = lerp(62, 0, spread), droop = lerp(28, 0, spread), fold2 = lerp(140, 8, spread), finger = lerp(40, 0, spread);
      const beat = fl * 38 * spread;
      e(B['wing1' + k], 0, s * sweep, -s * droop + s * beat);
      e(B['wing2' + k], 0, -s * fold2, s * beat * 0.4);
      e(B['wing3' + k], 0, s * lerp(80, 0, spread), 0);
      e(B['f1' + k], 0, s * finger * 0.3, s * beat * 0.2); e(B['f2' + k], 0, s * finger * 0.7, s * beat * 0.25); e(B['f3' + k], 0, s * finger, s * beat * 0.3);
    }
    // attacks
    if (st === 'bite') { const w = T < 0.6 ? smooth(T / 0.6) : 1 - smooth(clamp((T - 0.75) / 0.5, 0, 1)); const lunge = T > 0.6 && T < 1.0 ? 1 : 0; e(B.neck1, -20 + 30 * w * lunge - 20 * w * (1 - lunge), 0, 0); e(B.neck3, 5 + 25 * lunge * w, 0, 0); e(B.head, 20 - 10 * w, 0, 0); e(B.jaw, 50 * w * (lunge ? 1 : 0.6), 0, 0); }
    if (st === 'stomp') { const w = T < 0.9 ? smooth(T / 0.9) : 1 - smooth(clamp((T - 0.95) / 0.3, 0, 1)); e(B.thighR, -55 * w, 0, -10); e(B.shinR, 40 * w, 0, 0); B.hips.position.y += 0.6 * w; e(B.chest, -15 * w, 0, 0); }
    if (st === 'breath' || (st === 'strafe' && this.breath)) {
      const w = st === 'strafe' ? 1 : T < 1.0 ? smooth(T) : this.breath ? 1 : 1 - smooth(clamp((T - 3.4) / 0.5, 0, 1));
      const inhale = st === 'breath' && T < 1.0;
      e(B.neck1, -30 * (inhale ? w : 0) + 10 * (this.breath ? 1 : 0), 0, 0); e(B.neck4, inhale ? -20 * w : 15, 0, 0); e(B.head, inhale ? 40 : (st === 'strafe' ? 70 : 5), 0, 0); e(B.jaw, inhale ? 10 : 45 * w, 0, 0);
      e(B.chest, inhale ? -10 * w : 0, 0, 0);
    }
    if (st === 'tail') { e(B.spine, 0, (this.tailDir || 1) * -20, 0); for (let i = 1; i <= 9; i++) B['tail' + i].rotation.y += (this.tailDir || 1) * -0.18; }
    if (st === 'roar' || st === 'intro' && T > 2.5) { const w = st === 'roar' ? smooth(clamp(T / 0.6, 0, 1)) * (1 - smooth(clamp((T - 2) / 0.5, 0, 1))) : smooth(clamp((T - 2.5) / 0.6, 0, 1)) * (1 - smooth(clamp((T - 4.6) / 0.6, 0, 1))); e(B.neck1, -40 * w, 0, 0); e(B.neck5, -20 * w, 0, 0); e(B.head, -25 * w, 0, 0); e(B.jaw, 60 * w, 0, 0); for (const [k, s] of [['R', -1], ['L', 1]]) { e(B['wing1' + k], 0, s * 20, s * 40 * w); e(B['wing2' + k], 0, -s * 60, 0); } }
    if (st === 'stunned') { e(B.neck1, 30, 0, 15); e(B.head, 30, 0, 20); e(B.jaw, 25, 0, 0); }
    if (st === 'death') {
      this.deathT += dt; const k = smooth(clamp(this.deathT / 3, 0, 1));
      e(B.neck1, 40 * k, 0, 20 * k); e(B.neck3, 20 * k, 0, 0); e(B.head, 30 * k, 0, 0); B.hips.position.y = B.hips.userData.rest.y * (1 - 0.5 * k); e(B.hips, 0, 0, 25 * k);
      this.mat.userData.u.uGlow.value = 1 + Math.sin(this.deathT * 20) * 0.5 * (1 - k) + k * 2;
    }
    this.updateSpheres();
    // mouth for fire
    B.head.updateWorldMatrix(true, false);
    this.mouth.set(0, -0.1, 2.0).applyMatrix4(B.head.matrixWorld);
    this.mouthDir.set(0, -0.25, 1).transformDirection(B.head.matrixWorld);
    if (fx) {
      if (this.breath) fx.fireStream(this.mouth, this.mouthDir, 16, 0.35, 1.6);
      else if (R() < 0.15) fx.wisp(this.mouth, 0.4, [0.08, 0.06, 0.05]);
      for (const f of this.firePatches) if (R() < 0.6) fx.hellfire(f.x, this.world ? this.world.heightAt(f.x, f.z) : this.pos.y, f.z, f.r);
    }
  }
}
