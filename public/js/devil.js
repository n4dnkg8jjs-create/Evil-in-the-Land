// The Devil and his shapes.
//  Watcher  — a tall horned figure with huge unblinking eyes whose head turns
//             far past where a neck should allow; he watches from the hills.
//  Crevice  — eyes and long fingers in the mountain clefts.
//  Hound, Serpent, Cryptid — mini-boss shapes. Dragon — the final form.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTemplate, instantiate, limb, blob, cone, horn, place, lumpyG, demonMaterial } from './demons.js';
import { scaleTextures, demonTextures } from './textures.js';
import { buildHorror, buildHumanDevil, tickRobes, plantRobe, dissolvable } from './horror.js';
import { JI } from './rig.js';
import { buildDragonModel, dragonHideMaterial, dragonWingMaterial, dragonEyes } from './dragon_model.js';
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

// two-bone limb solver: turns u (upper) and l (lower) so that end reaches T, the middle joint bowing toward pole
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function aimBone(bone, from, to) {
  const dq = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_q1); bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(dq).multiply(_q1)); bone.updateMatrixWorld(true);
}
function ik2(u, l, end, T, pole) {
  const V3 = THREE.Vector3, a = u.getWorldPosition(new V3()), b = l.getWorldPosition(new V3()), c = end.getWorldPosition(new V3());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c), dv = T.clone().sub(a); const d = clamp(dv.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3); dv.normalize();
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pd = pole.clone().addScaledVector(dv, -pole.dot(dv)).normalize();
  const knee = a.clone().addScaledVector(dv, x).addScaledVector(pd, h);
  aimBone(u, b.clone().sub(a), knee.clone().sub(a));
  const b2 = l.getWorldPosition(new V3()), c2 = end.getWorldPosition(new V3());
  aimBone(l, c2.sub(b2), a.clone().addScaledVector(dv, d).sub(b2));
}

// ================================================================ WATCHER
// Him, on the hills: a figure far too tall and thin, arms hanging past the
// knee, ram horns, a ragged cloak, and two wide white eyes that never blink.
// He stands perfectly still. Only the head moves, in sudden snaps, and at the
// end it turns all the way round before he is gone.
const WATCHER_DEF = { rim: 0x000000, skin: 0x8e9592, horns: [0.95, 0.07, 3.0], hooded: true, dead: true, realEyes: true, eyeScale: 1.15, fingers: 1.95 };

export class Watcher {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    const body = buildHumanDevil(WATCHER_DEF) || buildHorror('devil', WATCHER_DEF);
    this.mat = body.mat; this.mesh = body.mesh; this.B = body.B;
    // taller and gaunter than any man; the forearms far too long, so the pale wrists hang out of the sleeves
    this.mesh.scale.set(0.92, 1.1, 0.92); this.baseScale = this.mesh.scale.clone();
    for (const k of ['R', 'L']) { const h = this.B['hand' + k]; h.position.multiplyScalar(1.32); h.userData.rest = h.position.clone(); }
    this.casters = []; this.mesh.traverse((o) => { if (o.isMesh && o.castShadow) this.casters.push(o); }); this.shadows = true;
    this.mesh.visible = false; scene.add(this.mesh);
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this.droneT = 3; this.unseen = 0; this.steps = 0; this.audio = null; this.view = null;
    this.pos = new THREE.Vector3(); this.yaw = 0; this.headYaw = 0; this.headTarget = 0; this.headRoll = 0; this.retarget = 0;
    this.state = 'hidden'; this.t = 0; this.fade = 0; this.mode = 'watch'; this.cool = 6; this.spotIdx = -1; this.seenT = 0;
  }
  // compile every one of his shaders now (at chapter load), so the first time he appears the game does not stall
  prewarm(renderer, camera) {
    const was = this.mesh.visible; this.mesh.visible = true; this.mat.userData.u.uDissolve.value = 0.5;
    try { renderer.compile(this.mesh, camera, this.scene); } catch (e) { try { renderer.compile(this.scene, camera); } catch {} }
    this.mesh.visible = was;
  }
  setShadows(on) { if (on === this.shadows) return; this.shadows = on; for (const m of this.casters) m.castShadow = on; }
  // is the camera looking at him (cosine of the angle off the view axis)
  looked() { const c = this.view; if (!c) return 1; c.getWorldDirection(this._f); this._v.set(this.pos.x, this.pos.y + 3, this.pos.z).sub(c.position).normalize(); return this._f.dot(this._v); }
  // host decides where he appears; clients mirror the state
  hostUpdate(dt, world, knights, phase) {
    this.t += dt; this.world = world;
    if (this.state === 'stare') return;   // held by a cutscene
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
      this.pos.set(s.x, s.y, s.z); this.state = 'appear'; this.t = 0; this.stay = 30 + R() * 25; this.steps = 0; this.unseen = 0;
      return 'appear';
    }
    let dmin = 1e9, nearest = null; for (const k of knights) { const d = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z); if (d < dmin) { dmin = d; nearest = k; } }
    if (nearest) { this.yaw = dampAngle(this.yaw, Math.atan2(nearest.pos.x - this.pos.x, nearest.pos.z - this.pos.z), 0.3, dt); }
    if (this.state === 'appear' && this.t > 1.6) { this.state = 'watch'; this.t = 0; }
    if (this.state === 'watch') {
      // look away for long enough and when you look back he is closer. He is never seen to move.
      if (this.looked() < 0.35) this.unseen += dt; else this.unseen = 0;
      if (this.unseen > 2.6 && this.steps < 2 && nearest && dmin > 80) {
        this.unseen = 0; this.steps++; const step = Math.min(16, dmin - 70);
        const dx = (nearest.pos.x - this.pos.x) / dmin, dz = (nearest.pos.z - this.pos.z) / dmin;
        const nx = this.pos.x + dx * step, nz = this.pos.z + dz * step;
        if (world.inBounds(nx, nz)) { this.pos.set(nx, world.heightAt(nx, nz), nz); this.yaw = Math.atan2(dx, dz); return 'step'; }
      }
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
    // smoke off him as he forms and unforms (a steady trickle, not a burst every frame)
    if (this.fx && (this.state === 'appear' || this.state === 'vanish') && R() < dt * 14) this.fx.wisp(this._v.set(this.pos.x, this.pos.y + R() * 3.8, this.pos.z), 1.0);
    // he has moved while no one was looking: a breath at your ear as you find him nearer
    if (this.lastPos && this.state === 'watch' && this.lastPos.distanceToSquared(this.pos) > 25 && this.audio) { this.audio.stinger?.('breath', 0.45); this.audio.whisper?.(camPos || this.pos, 1.6, 0.45); }
    (this.lastPos ||= new THREE.Vector3()).copy(this.pos);
    // stood on the lowest ground under his hem, so on a ridge the robe never hangs out over the air
    this.mesh.position.copy(this.pos); this.mesh.position.y = footGround(this.world, this.pos.x, this.pos.z, 0.5, this.pos.y); this.mesh.rotation.y = this.yaw;
    // far off he casts no shadow (and nothing while he is still forming)
    const camD = camPos ? Math.hypot(camPos.x - this.pos.x, camPos.z - this.pos.z) : 0;
    this.setShadows(camD < 60 && want > 0.95);
    // while he watches and you look at him: a drone too low to hear so much as feel, and a whisper
    if (this.audio && this.state === 'watch') {
      this.droneT -= dt;
      if (this.droneT <= 0 && this.looked() > 0.9) { this.droneT = 9 + R() * 5; this.audio.stinger?.('drone', 0.32); if (R() < 0.5) this.audio.whisper?.(this._v.set(this.pos.x, this.pos.y + 3, this.pos.z), 2.4, 0.35); }
    }
    // the head tracks the nearest knight with sudden, unnatural snaps
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.6 + R() * 1.8;
      let best = null, bd = 1e9; for (const k of knights || []) { const d = k.pos.distanceTo(this.pos); if (d < bd) { bd = d; best = k; } }
      const look = best ? angleDiff(this.yaw, Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z)) : 0;
      this.headTarget = clamp(look, -1.8, 1.8);
      // now and then the head lolls over, far past where a neck should allow, and stays there
      this.tilt = R() < 0.3 ? (R() < 0.5 ? -1 : 1) * (0.75 + R() * 0.35) : (R() - 0.5) * 0.35;
      this.snap = R() < 0.5;   // half the moves a sudden snap; the rest a slow, deliberate creep
    }
    if (this.state === 'stare') { this.headTarget = 0; this.tilt = 0.12; this.snap = false; this.retarget = 1; }
    let hy = this.headTarget, roll = this.tilt || 0;
    if (this.state === 'turn') {
      // the owl-turn: all the way round, in small jerking steps, the head tipping over as it goes
      // each jerk is quick and then held, so it reads as a deliberate stop-start, not a stutter
      const p = clamp(this.t / 2.2, 0, 1) * 9, k = Math.floor(p), f = p - k, q = Math.min(1, (k + 1 - Math.pow(1 - Math.min(1, f * 3.5), 3)) / 9);
      hy = this.turnFrom === undefined ? (this.turnFrom = this.headYaw) : this.turnFrom;
      hy += Math.sign(this.headTarget || 1) * Math.PI * q;
      roll = Math.sin(q * Math.PI) * 0.55 * Math.sign(this.headTarget || 1);
      this.headYaw = hy;
    } else {
      this.turnFrom = undefined;
      this.headYaw = dampAngle(this.headYaw, hy, this.snap ? 13 : 1.2, dt);
    }
    // the head creeps over into its tilt, slowly, and keeps going a little further than it should
    this.headRoll = damp(this.headRoll, roll * (1 + 0.15 * Math.sin(time * 0.21)), this.state === 'turn' ? 14 : 0.9, dt);
    // a palsy too slight to see except as wrongness (smooth, so it never reads as a glitch)
    const tremor = (Math.sin(time * 6.1) * 0.6 + Math.sin(time * 9.7 + 1.3) * 0.4) * 0.006;
    // utterly still; a slow breath and nothing else
    const breath = Math.sin(time * 0.42) * 1.6, sway = Math.sin(time * 0.17) * 1.2;
    e(B.hips, 0, 0, sway * 0.3); e(B.spine, 5, 0, -sway * 0.5); e(B.chest, 9 + breath, 0, 0);   // a slight stoop over you
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
    // the robe hangs plumb from his shoulders, its hem down on the ground about his feet
    this.mesh.updateMatrixWorld(true); plantRobe(B, this.mesh, 0.04);
  }
  // Him on a ceiling, like a spider: his back to the rock and his face hanging down at you, his long arms and legs
  // bent back over him to grip the stone, elbows and knees jutting out. go: how fast he is moving (0 still, 1
  // creeping, 2+ scuttling); roofY: the height of the rock. Called after animate(), it overrides the pose. The
  // hands and feet are put on the rock by solving each limb (so it works whatever the bones' own frames are).
  crawl(dt, time, pos, yaw, roofY, go) {
    const B = this.B, V3 = THREE.Vector3;
    this.crawlPh = (this.crawlPh || 0) + dt * (2.4 + go * 3.4) * Math.min(1, go);
    const ph = this.crawlPh, up = (x) => Math.max(0, x);
    const jk = Math.floor(time * (go > 1.5 ? 7 : 2.4)), hsh = (k) => { const x = Math.sin(k * 127.1 + 3.7) * 43758.5; return x - Math.floor(x); };
    const tw = (hsh(jk) - 0.5), tr = (hsh(jk + 31) - 0.5);
    // the body: head first along the way he goes, face (and belly) to the floor
    const fwd = new V3(Math.sin(yaw), 0, Math.cos(yaw)), down = new V3(0, -1, 0), side = new V3().crossVectors(fwd, down);
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, fwd, down)); this.mesh.scale.copy(this.baseScale);
    if (B.robe) B.robe.visible = false; for (const m of B.sleeves || []) m.visible = false;   // out of his robe: grey, naked, all bone and sinew
    const sw = Math.sin(ph);
    e(B.hips, 0, 0, sw * 6); e(B.spine, 8, sw * 5, -sw * 6); e(B.chest, 6, -sw * 4, sw * 5);
    // the head: lifted to look ahead and down, jerking from place to place, lolling over
    B.neck.rotation.set(-0.35 + tr * 0.15, tw * 0.5, tr * 0.3, 'YXZ');
    B.head.rotation.set(-0.45 + tr * 0.25, tw * 0.9, tr * 0.9 + 0.25, 'YXZ');
    e(B.jaw, go > 1.5 ? 30 : 4 + up(Math.sin(time * 1.3)) * 14, 0, 0);
    // set him hanging under the rock: hips and shoulders about two-thirds of a leg's length below it
    this.mesh.position.set(pos.x, roofY - 0.8, pos.z); this.mesh.updateMatrixWorld(true);
    const hp = B.hips.getWorldPosition(new V3()), legL = B.thighR.getWorldPosition(new V3()).distanceTo(B.shinR.getWorldPosition(new V3())) + B.shinR.getWorldPosition(new V3()).distanceTo(B.footR.getWorldPosition(new V3()));
    this.mesh.position.x += pos.x - hp.x; this.mesh.position.z += pos.z - hp.z; this.mesh.position.y += (roofY - legL * 0.36) - hp.y; this.mesh.updateMatrixWorld(true);
    const ctr = B.chest.getWorldPosition(new V3());
    // the gait: diagonal pairs move together (right hand with left foot); the moving hand or foot lifts off the rock
    const limb = (u, l, end, k, phase, reachF, reachS, isArm) => {
      const root = u.getWorldPosition(new V3()); const sg = Math.sign(root.clone().sub(ctr).dot(side)) || 1;
      const st = Math.sin(ph + phase), lift = up(Math.cos(ph + phase)) * 0.22 * Math.min(1, go);
      const T = root.clone().addScaledVector(fwd, reachF + st * 0.32 * Math.min(1, go)).addScaledVector(side, sg * reachS); T.y = roofY - lift;
      const pole = side.clone().multiplyScalar(sg).addScaledVector(down, 0.9).addScaledVector(fwd, isArm ? -0.3 : 0.4);
      ik2(u, l, end, T, pole);
    };
    limb(B.uArmR, B.fArmR, B.handR, 0, 0, 0.45, 0.75, true); limb(B.uArmL, B.fArmL, B.handL, 0, Math.PI, 0.45, 0.75, true);
    limb(B.thighR, B.shinR, B.footR, 0, Math.PI, -0.3, 0.7, false); limb(B.thighL, B.shinL, B.footL, 0, 0, -0.3, 0.7, false);
    e(B.handR, 40, 0, 0); e(B.handL, 40, 0, 0); e(B.footR, -30, 0, 0); e(B.footL, -30, 0, 0);
    this.pos.copy(this.mesh.position);
  }
}

// One Devil for the scares (Dread's 'turn round and He is there', Terror's figure on the road), shared, built and
// compiled once per game rather than once per system.
export function phantomDevil(g) {
  let D = g._phantomDevil;
  if (!D) { D = g._phantomDevil = new Watcher(g.scene, g.fx); D.audio = g.audio; D.view = g.engine.camera; D.prewarm(g.engine.renderer, g.engine.camera); }
  if (D.mesh.parent !== g.scene) g.scene.add(D.mesh);
  D.world = g.world;
  return D;
}
export function releasePhantom(D, owner) { if (!D || (owner && D.owner && D.owner !== owner)) return; D.mesh.rotation.set(0, D.yaw || 0, 0); if (D.baseScale) D.mesh.scale.copy(D.baseScale); if (D.B?.robe) D.B.robe.visible = true; for (const m of D.B?.sleeves || []) m.visible = true; D.state = 'hidden'; D.mesh.visible = false; D.owner = null; }

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

// ================================================================ BOSS TELEGRAPHS
// Every great blow is drawn on the ground before it lands: a shape in burning red that fills as the blow winds up
// (a disc, a lane, a fan, a widening ring), so it can be read and stepped out of; venom left lying burns green. The
// host adds them; they reach the other players in the boss's snapshot.
const TELE_SHAPES = ['circle', 'line', 'cone', 'ring', 'pool'];
const TELE_COLS = [[1.0, 0.2, 0.03], [0.32, 0.9, 0.1], [1.0, 0.5, 0.08]];
const TELE_VS = 'attribute vec2 q; varying vec2 vQ; void main() { vQ = q; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const TELE_FS = `varying vec2 vQ; uniform vec3 uCol; uniform float uProg, uFade, uTime, uShape, uA, uB, uW;
void main() {
  float a; float pulse = 0.72 + 0.28 * sin(uTime * 15.0); float done = step(0.985, uProg) * 0.55;
  if (uShape < 0.5 || abs(uShape - 2.0) < 0.5) {                 // a disc or a fan: it fills outward from the middle
    float r = vQ.x, edge = smoothstep(0.86, 1.0, r);
    if (uShape > 1.5) edge = max(edge, smoothstep(0.9, 1.0, abs(vQ.y)));
    float fill = 1.0 - smoothstep(uProg - 0.05, uProg, r);
    a = edge * pulse + fill * 0.34 + 0.07 + done;
  } else if (uShape < 1.5) {                                       // a lane: it fills from the near end
    float ax = abs(vQ.y), edge = max(smoothstep(0.82, 1.0, ax), smoothstep(0.04, 0.0, vQ.x) + smoothstep(0.96, 1.0, vQ.x));
    float fill = 1.0 - smoothstep(uProg - 0.03, uProg, vQ.x);
    float chev = step(0.55, fract(vQ.x * 7.0 - uTime * 2.2 - ax * 0.5)) * 0.1;   // arrows running down it
    a = edge * pulse + fill * 0.32 + chev + 0.05 + done;
  } else if (uShape < 3.5) {                                       // a widening ring: the wave front, and how far it will run
    float rr = vQ.x * uA, k = clamp((uProg - uW) / max(0.001, 1.0 - uW), 0.0, 1.0), front = mix(uB, uA, k);
    float band = exp(-pow((rr - front) / 0.75, 2.0)) * step(0.001, k);
    a = band * 1.4 + smoothstep(0.96, 1.0, vQ.x) * 0.45 * pulse + 0.035 + (1.0 - step(0.001, k)) * 0.12 * pulse;
  } else {                                                         // a pool of venom: a sick sheen, slowly crawling
    float r = vQ.x, w = 0.5 + 0.5 * sin(r * 21.0 - uTime * 3.0 + sin(vQ.y * 9.0 + uTime) * 1.5);
    a = (0.2 + 0.16 * w) * (1.0 - smoothstep(0.82, 1.0, r)) + smoothstep(0.86, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r)) * 0.45;
  }
  gl_FragColor = vec4(uCol * a * uFade * 1.5, 1.0);
}`;
class Telegraphs {
  constructor(scene, owner) { this.scene = scene; this.owner = owner; this.map = new Map(); this.gone = new Set(); this.seq = 1; this.time = 0; }
  // circle: a = radius · line: a = length, b = width, from (x, z) along yaw · cone: a = radius, b = half-angle ·
  // ring: a = final radius, b = first radius, yaw = the share of dur spent winding up · pool: a = radius
  add(shape, x, z, a, b = 0, yaw = 0, dur = 1, col = 0, fxk = 0) { const T = { id: this.seq++, shape, x, z, a, b, yaw, dur, t: 0, col, fxk }; this.map.set(T.id, T); return T; }
  snap() { const o = []; for (const T of this.map.values()) o.push([T.id, TELE_SHAPES.indexOf(T.shape), +T.x.toFixed(2), +T.z.toFixed(2), +T.a.toFixed(2), +T.b.toFixed(3), +T.yaw.toFixed(3), +T.dur.toFixed(2), +T.t.toFixed(2), T.col, T.fxk]); return o; }
  apply(arr) {
    if (!Array.isArray(arr)) return; const seen = new Set();
    for (const s of arr) {
      const [id, sh, x, z, a, b, yaw, dur, t, col, fxk] = s; seen.add(id); if (this.gone.has(id)) continue;
      const T = this.map.get(id); if (!T) this.map.set(id, { id, shape: TELE_SHAPES[sh], x, z, a, b, yaw, dur, t, col, fxk }); else if (Math.abs(T.t - t) > 0.25) T.t = t;
    }
    for (const T of [...this.map.values()]) if (!seen.has(T.id) && T.t > 0.4) this.kill(T);
  }
  kill(T) {
    if (T.mesh) { this.scene.remove(T.mesh); T.mesh.geometry.dispose(); T.mesh.material.dispose(); }
    this.map.delete(T.id); this.gone.add(T.id); if (this.gone.size > 400) this.gone.delete(this.gone.values().next().value);
  }
  clear() { for (const T of [...this.map.values()]) this.kill(T); }
  update(dt, world, fx) {
    this.time += dt;
    for (const T of [...this.map.values()]) {
      T.t += dt;
      if (!T.mesh) T.mesh = this.build(T, world);
      const u = T.mesh.material.uniforms, pool = T.shape === 'pool';
      u.uProg.value = clamp(T.t / T.dur, 0, 1); u.uTime.value = this.time;
      u.uFade.value = pool ? clamp(T.t / 0.3, 0, 1) * clamp((T.dur - T.t) / 0.8, 0, 1) : T.t > T.dur ? clamp(1 - (T.t - T.dur) / 0.3, 0, 1) * 1.5 : clamp(T.t / 0.1, 0, 1);
      if (!T.fired && !pool && T.t >= T.dur) { T.fired = true; this.owner.teleFx?.(T, fx, world); }
      if (T.t > (pool ? T.dur : T.dur + 0.3)) this.kill(T);
    }
  }
  // a mesh draped over the ground
  build(T, world) {
    const H = (x, z) => (world ? world.heightAt(x, z) : 0) + 0.1, pos = [], q = [], idx = [];
    if (T.shape === 'line') {
      const NL = Math.max(6, Math.ceil(T.a / 0.7)), NW = 4, fx = Math.sin(T.yaw), fz = Math.cos(T.yaw);
      for (let i = 0; i <= NL; i++) for (let j = 0; j <= NW; j++) { const al = i / NL * T.a, ac = (j / NW * 2 - 1) * T.b / 2, x = T.x + fx * al + fz * ac, z = T.z + fz * al - fx * ac; pos.push(x, H(x, z), z); q.push(i / NL, j / NW * 2 - 1); }
      for (let i = 0; i < NL; i++) for (let j = 0; j < NW; j++) { const a = i * (NW + 1) + j; idx.push(a, a + 1, a + NW + 1, a + 1, a + NW + 2, a + NW + 1); }
    } else {
      const fan = T.shape === 'cone', half = fan ? T.b : Math.PI, NR = Math.max(5, Math.ceil(T.a / 0.7)), NA = fan ? 26 : 44;
      for (let i = 0; i <= NR; i++) for (let j = 0; j <= NA; j++) { const r = i / NR * T.a, th = (j / NA * 2 - 1) * half, ang = (fan ? T.yaw : 0) + th, x = T.x + Math.sin(ang) * r, z = T.z + Math.cos(ang) * r; pos.push(x, H(x, z), z); q.push(i / NR, th / half); }
      for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j; idx.push(a, a + 1, a + NA + 1, a + 1, a + NA + 2, a + NA + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('q', new THREE.Float32BufferAttribute(q, 2)); g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Vector3(...TELE_COLS[T.col] || TELE_COLS[0]) }, uProg: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uShape: { value: TELE_SHAPES.indexOf(T.shape) }, uA: { value: T.a }, uB: { value: T.b }, uW: { value: T.shape === 'ring' ? T.yaw : 0 } },
      vertexShader: TELE_VS, fragmentShader: TELE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false, fog: false,
    });
    const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 3; this.scene.add(mesh); return mesh;
  }
}
// is a knight inside a telegraphed shape (pad: about a knight's breadth)
const inside = (k, T, pad = 0.45) => {
  const dx = k.pos.x - T.x, dz = k.pos.z - T.z;
  if (T.shape === 'line') { const fx = Math.sin(T.yaw), fz = Math.cos(T.yaw), al = dx * fx + dz * fz, ac = dx * fz - dz * fx; return al > -pad && al < T.a + pad && Math.abs(ac) < T.b / 2 + pad; }
  const d = Math.hypot(dx, dz); if (d > T.a + pad) return false;
  if (T.shape === 'cone') return d < 1.4 || Math.abs(angleDiff(T.yaw, Math.atan2(dx, dz))) < T.b + pad / d;
  return true;
};
// a tapering tube along a list of points (fangs, talons, a tongue)
function taperTube(pts, r0, r1, radial = 8, pw = 0.8) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n = pts.length * 3;
  const g = new THREE.TubeGeometry(curve, n, 1, radial, false), P = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { const t = Math.floor(i / (radial + 1)) / n; curve.getPointAt(t, c); v.fromBufferAttribute(P, i).sub(c).multiplyScalar(lerp(r0, r1, Math.pow(t, pw))).add(c); P.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}

// ================================================================ BOSS BASE
// Bosses are fought in phases: below each share of their health they change, and new attacks join the old. Blows wear
// down their poise; when it breaks they reel for a moment and are open, and then it is whole again for a while (so a
// party can punish, but never stun-lock them). Their blows are drawn on the ground before they land, and a knight
// already knocked flat is not struck again while getting up.
class Boss {
  constructor(scene, kind) {
    this.scene = scene; this.kind = kind; this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.state = 'intro'; this.t = 0; this.alive = true; this.spheres = []; this.hitFlash = 0; this.cd = 2; this.phase = 1; this.atk = 0; this.target = null; this.retarget = 0; this.dead = false; this.deathT = 0;
    this.tele = new Telegraphs(scene, this); this._q = []; this._kd = new Map(); this.gen = 0; this.dmgScale = 1; this.poiseCd = 0; this.maxPoise = 0; this.poise = 0;
  }
  setState(s) { this.state = s; this.t = 0; this.hitDone = false; }
  pickTarget(knights) {
    this.retarget -= 0.016;
    let best = null, bs = 1e9; for (const k of knights) { if (k.downed) continue; let d = k.pos.distanceTo(this.pos); if (k.praying) d *= 0.7; if (k === this.target) d *= 0.8; if (d < bs) { bs = d; best = k; } }
    this.target = best; return best;
  }
  hitTest(a, b, extra = 0.25) {
    if (this.untouchable) return null;
    let best = null;
    for (const s of this.spheres) {
      if (!(s.r > 0)) continue;
      const c = s.c; const ab = b.clone().sub(a); const t = clamp(c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq()), 0, 1);
      const p = a.clone().addScaledVector(ab, t); const d = p.distanceTo(c);
      if (d < s.r + extra && (!best || s.mul > best.mul)) best = { point: p, mul: s.mul, part: s.name };
    }
    return best;
  }
  updateSpheres() { for (const s of this.spheres) { s.bone.updateWorldMatrix(true, false); s.c.set(...s.off).applyMatrix4(s.bone.matrixWorld); } }
  takeHit(dmg, dir, stagger, C) {
    if (!this.alive || this.state === 'intro' || this.untouchable) return false;
    this.hp -= dmg; this.hitFlash = 1;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.tele.clear(); this._q.length = 0; this.setState('death'); C?.ev('bossDeath', this); return true; }
    if (this.phases) {
      let n = 1; for (const th of this.phases) if (this.hp < this.maxHp * th) n++;
      if (n > this.phase) { this.phase = n; this.onPhase?.(n, C); C?.ev('bossPhase', this, n); }
    }
    this.wear(dmg * (0.55 + (stagger || 0.5) * 0.6), C);
    return false;
  }
  // poise: worn down by blows (and a parry takes a great piece of it)
  wear(amount, C) {
    if (!this.maxPoise || !this.alive) return;
    this.poise -= amount;
    if (this.poise <= 0) { this.poise = this.maxPoise; if (this.poiseCd <= 0 && this.canReel?.()) { this.poiseCd = 11; this.onPoiseBreak?.(C); } }
  }
  parried(C) { this.wear(this.maxPoise * 0.4, C); }
  // host: do something after a delay (the blow that lands when its telegraph has filled)
  // (free: not part of the blow in hand, so not cancelled with it)
  later(d, fn, free = false) { this._q.push({ t: d, fn, gen: free ? -1 : this.gen }); }
  runLater(dt) { for (let i = this._q.length - 1; i >= 0; i--) { const q = this._q[i]; q.t -= dt; if (q.t <= 0) { this._q.splice(i, 1); if (this.alive) q.fn(); } } }
  warn(shape, x, z, a, b, yaw, dur, col, fxk, fn, free = false) { const T = this.tele.add(shape, x, z, a, b, yaw, dur, col, fxk); T.gen = free ? -1 : this.gen; if (fn) this.later(dur, () => fn(T), free); return T; }
  // a blow cut short: its telegraphs go out, and it does not land
  interrupt() { const g = this.gen++; this._q = this._q.filter((q) => q.gen !== g); for (const T of [...this.tele.map.values()]) if (T.gen === g) this.tele.kill(T); this.aimT = null; }
  // strike a knight. Never a stun-lock: a knight already down is let be, and a second knockdown within a few seconds is only a shove
  hurt(C, k, dmg, from, opts = {}) {
    if (!k || k.downed) return;
    if (k.action && k.actKind === 'knockdown') return;
    const o = { ...opts }, now = C.time || 0, key = k.id ?? k;
    if (o.knockdown) { if (now - (this._kd.get(key) ?? -99) < 4) { delete o.knockdown; o.knockback = Math.max(o.knockback || 0, 6); } else this._kd.set(key, now); }
    C.damageKnight(k, dmg * C.dmgMul * this.dmgScale, from, o, this);
  }
  hurtIn(C, T, dmg, from, opts, pad) { for (const k of C.knights) if (!k.downed && inside(k, T, pad)) this.hurt(C, k, dmg, from || new THREE.Vector3(T.x, 0, T.z), opts); }
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
  dispose() { this.scene.remove(this.mesh); this.tele.clear(); }
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
// "That old serpent, called the Devil, and Satan" (Rev. 12:9). Sixty metres of him: one closed, scaled body that runs
// along its own path over the ground and under it (each part of him passes where the head went), a viper's head with
// hinged fangs, slit-pupilled eyes and a forked tongue. He rears like a cobra, the neck rising out of the coils.
const SN = 84, SSP = 0.7, SRAD = 1.3, SSUB = 2, SRADIAL = 32;
function serpentRad(f) {   // f: node index from the head (fractional)
  const s = clamp(f / (SN - 1), 0, 1);
  const front = 0.6 + 0.4 * smooth(clamp(s / 0.18, 0, 1));
  const back = s < 0.42 ? 1 : Math.max(0.03, 1 - Math.pow((s - 0.42) / 0.58, 1.25));
  return SRAD * front * back;
}
// The hide: overlapping keeled scales drawn as a height field, each scale's free edge lying over the base of the one
// behind it like slates on a roof, turned into colour, normal, roughness and (in the crevices) ember maps. u runs round
// the body (the spine at u = 0.25, the belly at 0.75, broad ventral plates there), v along it from the head.
let _hide = null;
function serpentHide() {
  if (_hide) return _hide;
  const W = 512, H = 512, COLS = 24, ROWS = 12, VB0 = 0.63, VB1 = 0.87;
  const hgt = new Float32Array(W * H), rgb = new Float32Array(W * H * 3), rough = new Float32Array(W * H), glow = new Float32Array(W * H);
  const hs = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const wrap = (d) => d - Math.round(d), fr = (x) => x - Math.floor(x);
  // one scale's colour, from where its centre lies in the pattern: a chain of black, bone-rimmed diamonds down the
  // spine, dark blotches low on the flanks, olive-umber between
  const dorsal = (cu, cv, h) => {
    const du = Math.abs(wrap(cu - 0.25)), q = Math.abs(fr(cv * 2) - 0.5), dm = du / 0.13 + q / 0.5;
    let c = [0.11, 0.1, 0.072];
    if (dm < 0.8) c = [0.03, 0.027, 0.025]; else if (dm < 1.0) c = [0.055, 0.048, 0.038]; else if (dm < 1.24) c = [0.36, 0.31, 0.21];
    const fu = Math.min(Math.abs(wrap(cu - 0.02)), Math.abs(wrap(cu - 0.48))), fq = Math.abs(fr(cv * 2 + 0.5) - 0.5);
    if (fu / 0.065 + fq / 0.2 < 1) c = [0.035, 0.03, 0.026];
    const k = 0.78 + h * 0.44; return [c[0] * k, c[1] * k * (0.97 + h * 0.06), c[2] * k];
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H, i = y * W + x;
    let h, col, rg, gl;
    if (u > VB0 && u < VB1) {
      // the belly: broad plates across it, the one ahead lying over the one behind
      const rows = ROWS * 2, fy = v * rows, r0 = Math.floor(fy), across = (u - VB0) / (VB1 - VB0) * 2 - 1, edge = 1.3 - 0.2 * across * across;
      let r = r0, s = fy - r0; if (fy - (r0 - 1) < edge) { r = r0 - 1; s = fy - r; }
      const t = clamp(s / edge, 0, 1), side = 1 - Math.pow(Math.abs(across), 8);
      const rim = smooth(clamp((1 - t) / 0.1, 0, 1)) * smooth(clamp((1 - Math.abs(across)) / 0.06, 0, 1));
      h = (0.3 + 0.7 * Math.pow(t, 0.7)) * (0.4 + 0.6 * rim) * (0.75 + 0.25 * side);
      const rr = ((r % rows) + rows) % rows, n = hs(rr * 3.1, 7.7), sp = hs(x * 0.37 + 1, y * 0.71) > 0.985 ? 0.35 : 1;
      const dk = Math.pow(Math.abs(across), 3);
      col = [lerp(0.46, 0.13, dk) * (0.85 + n * 0.3) * sp, lerp(0.41, 0.115, dk) * (0.85 + n * 0.3) * sp, lerp(0.31, 0.09, dk) * (0.85 + n * 0.3) * sp];
      col = col.map((c) => c * (0.5 + 0.5 * rim)); rg = 0.42 + 0.35 * (1 - rim); gl = Math.pow(1 - rim, 2) * 0.5;
    } else {
      const fy = v * ROWS, r0 = Math.floor(fy);
      let best = null;
      for (const r of [r0 - 1, r0]) {
        const off = (r & 1) * 0.5, s = fy - r; if (s < 0 || s > 1.45) continue;
        const cc = Math.round(u * COLS - off);
        for (const c of [cc - 1, cc, cc + 1]) {
          const cu = (c + off) / COLS, w = wrap(u - cu) * COLS, hw = 0.64 * Math.sqrt(Math.max(0, 1 - ((s - 0.5) / 0.95) ** 2)), m = hw - Math.abs(w);
          if (m <= 0) continue;
          if (!best || m / hw > best.m / best.hw) best = { r, c, s, w, hw, m, cu };
        }
        if (best) break;   // the row ahead lies on top
      }
      if (!best) best = { r: r0, c: 0, s: 0, w: 0.5, hw: 0.5, m: 0, cu: u };
      const t = best.s / 1.45, rim = smooth(clamp(best.m / 0.075, 0, 1));
      const keel = 0.14 * Math.pow(1 - Math.abs(best.w) / Math.max(1e-3, best.hw), 2) * smooth(clamp((t - 0.2) / 0.5, 0, 1));
      h = (0.2 + 0.8 * Math.pow(t, 0.8) + keel) * (0.32 + 0.68 * rim);
      const rr = ((best.r % ROWS) + ROWS) % ROWS, cc = ((best.c % COLS) + COLS) % COLS;
      col = dorsal(best.cu, best.r / ROWS, hs(rr * 1.3, cc * 2.9)).map((c) => c * (0.42 + 0.58 * rim) * (0.92 + keel * 1.2));
      rg = 0.36 + 0.42 * (1 - rim) + (hs(rr, cc) - 0.5) * 0.08; gl = Math.pow(1 - rim, 2);
    }
    hgt[i] = h; rgb[i * 3] = col[0]; rgb[i * 3 + 1] = col[1]; rgb[i * 3 + 2] = col[2]; rough[i] = rg; glow[i] = gl;
  }
  const map = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4), rgh = new Uint8Array(W * H * 4), emi = new Uint8Array(W * H * 4);
  const lin2s = (c) => Math.round(255 * Math.pow(clamp(c, 0, 1), 1 / 2.2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, at = (xx, yy) => hgt[((yy + H) % H) * W + ((xx + W) % W)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * 3.2, dy = (at(x, y + 1) - at(x, y - 1)) * 3.2, l = Math.hypot(dx, dy, 1);
    nrm[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); nrm[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nrm[o + 3] = 255;
    map[o] = lin2s(rgb[i * 3]); map[o + 1] = lin2s(rgb[i * 3 + 1]); map[o + 2] = lin2s(rgb[i * 3 + 2]); map[o + 3] = 255;
    rgh[o] = rgh[o + 1] = rgh[o + 2] = Math.round(clamp(rough[i], 0, 1) * 255); rgh[o + 3] = 255;
    emi[o] = Math.round(glow[i] * 255); emi[o + 1] = Math.round(glow[i] * 70); emi[o + 2] = Math.round(glow[i] * 15); emi[o + 3] = 255;
  }
  const tex = (data, srgb) => { const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return (_hide = { map: tex(map, true), normal: tex(nrm, false), rough: tex(rgh, false), glow: tex(emi, true) });
}
// an amber eye, the slit pupil on the +x pole of a sphere (three's sphere UVs)
function serpentEyeTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#2a1404'; g.fillRect(0, 0, 256, 128);
  const gr = g.createRadialGradient(128, 64, 3, 128, 64, 62);
  gr.addColorStop(0, '#ffe066'); gr.addColorStop(0.35, '#f0a020'); gr.addColorStop(0.75, '#a85808'); gr.addColorStop(1, '#3a1604');
  g.fillStyle = gr; g.beginPath(); g.ellipse(128, 64, 62, 60, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(60,20,0,0.5)'; g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) { const a = i / 70 * TAU + Math.sin(i * 7.3) * 0.05, r0 = 10 + (i % 3) * 3, r1 = 40 + (i * 13 % 18); g.beginPath(); g.moveTo(128 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(128 + Math.cos(a + 0.05) * r1, 64 + Math.sin(a + 0.05) * r1); g.stroke(); }
  g.fillStyle = '#050202'; g.beginPath(); g.ellipse(128, 64, 5.5, 46, 0, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// a closed surface from a grid over L (0 back .. 1 front) and th (0..2PI round it); fn(L, th) -> [x, y, z, u, v].
// Faces with th < PI (the top) go in group 0, the rest in group 1.
function paramSurf(NL, NT, fn) {
  const pos = [], uv = [], i0 = [], i1 = [];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NT; j++) { const r = fn(i / NL, j / NT * TAU); pos.push(r[0], r[1], r[2]); uv.push(r[3], r[4]); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NT; j++) { const a = i * (NT + 1) + j, b = a + 1, c = a + NT + 1, d = c + 1; ((j + 0.5) / NT < 0.5 ? i0 : i1).push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...i0, ...i1]); g.addGroup(0, i0.length, 0); g.addGroup(i0.length, i1.length, 1); g.computeVertexNormals(); return g;
}
// The head, in its own frame: +z forward along the snout, y up, the origin where the neck meets the skull.
// A viper's: broad over the jaw-hinges, narrowing to a blunt snout, the brows ridged and horned over the eyes.
const SH_LIP = -0.05, SH_Z0 = -0.42, SH_Z1 = 2.75;
const shW = (L) => L < 0.22 ? lerp(0.72, 1.0, smooth(L / 0.22)) : lerp(1.0, 0.36, Math.pow((L - 0.22) / 0.78, 1.1));
const shH = (L) => lerp(0.66, 0.3, Math.pow(L, 0.9));
const shEnd = (L) => (L < 0.08 ? Math.sqrt(Math.max(0, 1 - ((0.08 - L) / 0.08) ** 2)) : 1) * (L > 0.9 ? Math.sqrt(Math.max(0, 1 - ((L - 0.9) / 0.1) ** 2)) : 1);
function buildSerpentHead(hide) {
  const head = new THREE.Group(), parts = {};
  const mouth = new THREE.MeshStandardMaterial({ color: 0xb48a82, roughness: 0.32, metalness: 0 });   // pale and wet, like a cottonmouth's
  const throat = new THREE.MeshStandardMaterial({ color: 0x140405, roughness: 0.7 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xdcd2b6, roughness: 0.26, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x060404, roughness: 0.85 });
  const skull = paramSurf(48, 56, (L, th) => {
    const e = shEnd(L), w = shW(L) * e, z = lerp(SH_Z0, SH_Z1, L);
    if (th <= Math.PI + 1e-6) {
      const c = Math.cos(th), s = Math.max(0, Math.sin(th));
      let y = SH_LIP + shH(L) * e * Math.pow(s, 0.6);
      y += 0.11 * e * Math.exp(-(((L - 0.55) / 0.12) ** 2)) * Math.exp(-(((Math.abs(c) - 0.62) / 0.2) ** 2));        // brow ridges over the eyes
      y -= 0.045 * e * Math.exp(-((c / 0.2) ** 2)) * smooth(clamp((L - 0.3) / 0.4, 0, 1));                          // a shallow furrow down the crown
      const x = w * Math.sign(c) * Math.pow(Math.abs(c), 0.72) * (1 - 0.05 * Math.exp(-(((L - 0.78) / 0.08) ** 2)) * s);  // pinched at the heat pits
      return [x, y, z, th / TAU, L * 2.4];
    }
    const c = Math.cos(th), s = -Math.sin(th);
    return [w * 0.97 * c, SH_LIP - 0.07 * e * s, z, th / TAU, L * 2.4];   // the palate
  });
  head.add(new THREE.Mesh(skull, [hide, mouth]));
  // the gullet, dark behind the open jaws
  head.add(new THREE.Mesh(place(new THREE.SphereGeometry(1, 20, 14), [0, SH_LIP - 0.3, 0.15], [0, 0, 0], [0.62, 0.42, 0.75]), throat));
  // teeth along the palate, raked back
  const tg = []; for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) { const L = 0.3 + i * 0.065, w = shW(L) * shEnd(L); tg.push(place(new THREE.ConeGeometry(0.028, 0.15, 5), [sx * (w * 0.86 - 0.06), SH_LIP - 0.1, lerp(SH_Z0, SH_Z1, L)], [Math.PI - 0.45, 0, 0])); }
  head.add(new THREE.Mesh(mergeGeometries(tg), bone));
  // the fangs: long and hollow, folded back along the palate until the mouth gapes, then swung forward
  parts.fangs = [];
  for (const sx of [-1, 1]) {
    const L = 0.86, f = new THREE.Group(); f.position.set(sx * (shW(L) * shEnd(L) * 0.62), SH_LIP - 0.03, lerp(SH_Z0, SH_Z1, L));
    f.add(new THREE.Mesh(taperTube([[0, 0, 0], [0, -0.22, -0.02], [0, -0.42, -0.1], [0, -0.56, -0.24]], 0.062, 0.004, 8, 1.2), bone)); head.add(f); parts.fangs.push(f);
  }
  // eyes: amber, slit-pupilled, glossy, under the brow; a little light of their own
  const et = serpentEyeTex(), em = new THREE.MeshPhysicalMaterial({ map: et, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
  parts.eyes = [];
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), em); m.position.set(sx * 0.585, SH_LIP + 0.33, 1.3); m.rotation.y = sx > 0 ? -0.4 : Math.PI + 0.4; head.add(m); parts.eyes.push(m); }
  // horned brows (a horned viper's): two short spikes over each eye, swept back
  const hg = []; for (const sx of [-1, 1]) for (const [dz, len] of [[0, 0.55], [-0.22, 0.36]]) hg.push(place(taperTube([[0, 0, 0], [sx * 0.03, len * 0.55, -len * 0.18], [sx * 0.07, len * 0.95, -len * 0.5]], 0.08, 0.006, 8, 0.9), [sx * 0.5, SH_LIP + 0.42, 1.24 + dz]));
  head.add(new THREE.Mesh(mergeGeometries(hg), new THREE.MeshStandardMaterial({ color: 0x241e18, roughness: 0.45 })));
  // nostrils and the heat pits between eye and nostril
  const dg = []; for (const sx of [-1, 1]) { dg.push(place(new THREE.SphereGeometry(0.05, 10, 8), [sx * 0.17, SH_LIP + 0.17, 2.62], [0, 0, 0], [1, 0.7, 1])); dg.push(place(new THREE.SphereGeometry(0.06, 10, 8), [sx * (shW(0.79) * 0.88), SH_LIP + 0.1, lerp(SH_Z0, SH_Z1, 0.79)], [0, 0, 0], [0.6, 1, 1])); }
  head.add(new THREE.Mesh(mergeGeometries(dg), dark));
  // the lower jaw, hinged far back under the skull: a scaled hull below, the pale floor of the mouth above
  const hinge = new THREE.Vector3(0, SH_LIP - 0.04, -0.12), jaw = new THREE.Group(); jaw.position.copy(hinge); head.add(jaw); parts.jaw = jaw;
  const jg = paramSurf(40, 48, (L, th) => {
    const e = shEnd(L * 0.97), w = shW(L * 0.97) * 0.9 * e, z = lerp(-0.3, 2.55, L), top = SH_LIP - 0.04;
    if (th <= Math.PI + 1e-6) { const c = Math.cos(th), s = Math.max(0, Math.sin(th)); return [w * c, top - 0.06 * e * s, z, th / TAU, L * 2.2]; }
    const c = Math.cos(th), s = -Math.sin(th); return [w * Math.sign(c) * Math.pow(Math.abs(c), 0.8), top - lerp(0.44, 0.16, L) * e * Math.pow(s, 0.7), z, th / TAU, L * 2.2];
  });
  jg.translate(-hinge.x, -hinge.y, -hinge.z); jaw.add(new THREE.Mesh(jg, [mouth, hide]));
  const lt = []; for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) { const L = 0.32 + i * 0.07, w = shW(L) * shEnd(L) * 0.9; lt.push(place(new THREE.ConeGeometry(0.024, 0.12, 5), [sx * (w * 0.82 - 0.05), SH_LIP + 0.01 - hinge.y, lerp(-0.3, 2.55, L) - hinge.z], [0.4, 0, 0])); }
  jaw.add(new THREE.Mesh(mergeGeometries(lt), bone));
  // the forked tongue, slid out through the notch in the lips to taste the air
  const tongue = new THREE.Group(), tm = new THREE.MeshStandardMaterial({ color: 0x220709, roughness: 0.28 });
  tongue.add(new THREE.Mesh(taperTube([[0, 0, 0], [0, 0.01, 0.5], [0, 0, 1.0]], 0.055, 0.032, 7, 1), tm));
  for (const sx of [-1, 1]) tongue.add(new THREE.Mesh(taperTube([[0, 0, 0.98], [sx * 0.05, 0.01, 1.2], [sx * 0.13, -0.01, 1.45]], 0.03, 0.004, 6, 1), tm));
  tongue.position.set(0, SH_LIP - 0.03, 1.15); tongue.visible = false; head.add(tongue); parts.tongue = tongue;
  head.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { head, parts };
}

export class Serpent extends Boss {
  constructor(scene, partySize) {
    super(scene, 'serpent');
    this.name = 'The Old Serpent'; this.title = 'Serpens Antiquus';
    this.party = Math.max(1, partySize || 1);
    this.maxHp = this.hp = Math.round(3400 * (1 + 0.7 * (this.party - 1)));
    this.maxPoise = this.poise = 340 * (1 + 0.25 * (this.party - 1));
    this.phases = [0.66, 0.33]; this.cad = 1 + 0.1 * (this.party - 1); this.cds = { coil: 10, brood: 3, rain: 0 }; this.chainN = 0; this.last = '';
    this.camH = 4.5; this.camD = 2.4;
    this.N = SN;
    const NG = SN + 24; this.gc = []; this.gd = new Float32Array(NG).fill(1); for (let i = 0; i < NG; i++) this.gc.push(new THREE.Vector3(0, 0, -i * SSP));
    this.vis = []; this.visD = new Float32Array(SN).fill(1); for (let i = 0; i < SN; i++) this.vis.push(new THREE.Vector3(0, -20, 0));
    this.chain = this.vis;
    const hide = serpentHide();
    this.mat = new THREE.MeshStandardMaterial({ map: hide.map, normalMap: hide.normal, normalScale: new THREE.Vector2(1.25, 1.25), roughnessMap: hide.rough, roughness: 1, metalness: 0.04, emissiveMap: hide.glow, emissive: 0xff3a10, emissiveIntensity: 0, side: THREE.DoubleSide });
    // the body: rings round the path (two to each joint of the chain), closed at the neck and drawn to a point at the tail
    const M = this.M = (SN - 1) * SSUB + 1, R2 = SRADIAL + 1, nV = M * R2 + 2;
    const uv = new Float32Array(nV * 2), idx = []; this.ringR = new Float32Array(M);
    let v = 0;
    for (let j = 0; j < M; j++) {
      const r = this.ringR[j] = serpentRad(j / SSUB);
      if (j > 0) v += (SSP / SSUB) / (4.0 * Math.max(0.3, r / SRAD));   // scales shrink with the body, so they stay scale-shaped
      for (let k = 0; k <= SRADIAL; k++) { uv[(j * R2 + k) * 2] = k / SRADIAL; uv[(j * R2 + k) * 2 + 1] = v; }
    }
    for (let j = 0; j < M - 1; j++) for (let k = 0; k < SRADIAL; k++) { const a = j * R2 + k, b = a + 1, c = a + R2, d = c + 1; idx.push(a, c, b, b, c, d); }
    const HC = M * R2, TT = HC + 1;
    for (let k = 0; k < SRADIAL; k++) { idx.push(HC, k, k + 1); const a = (M - 1) * R2 + k; idx.push(TT, a + 1, a); }
    uv[HC * 2] = 0.25; uv[HC * 2 + 1] = 0; uv[TT * 2] = 0.25; uv[TT * 2 + 1] = v;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.geo = g; this.mesh = new THREE.Mesh(g, this.mat); this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; scene.add(this.mesh);
    const H = buildSerpentHead(this.mat); this.head = H.head; this.hparts = H.parts; scene.add(this.head);
    this.headPos = new THREE.Vector3(); this.headDir = new THREE.Vector3(0, 0, 1); this.rear = -4; this.burrowed = true; this.jawOpen = 0; this.jawVis = 0; this.pitch = 0; this.tongueT = 2; this.flick = -1;
    this.spheres = [];
    for (let i = 3; i < SN; i += 3) this.spheres.push({ name: 'body', i, r: serpentRad(i) + 0.3, mul: 0.7, c: new THREE.Vector3() });
    this.spheres.push({ name: 'head', i: -1, r: 1.45, mul: 1.8, c: new THREE.Vector3() });
    this.alt = 0; this.touch = new Map(); this.poolT = 0;
  }
  // lay him out under the ground at pos, his body running away from it
  placeAt(pos) {
    const a = R() * TAU, dx = Math.sin(a), dz = Math.cos(a);
    this.headPos.copy(pos); this.headDir.set(-dx, 0, -dz); this.rear = -4.5;
    for (let i = 0; i < this.gc.length; i++) { this.gc[i].set(pos.x + dx * i * SSP, 0, pos.z + dz * i * SSP); this.gd[i] = 1; }
    if (this.world) this.followChain(this.world, 0.016);
  }
  surfY(W, x, z, r, d) { return W.heightAt(x, z) + r * 0.82 - d * (r * 2.6 + 1.6); }
  // The body follows the path the head has made over (and under) the ground. When he rears, the front of him rises
  // from the coils in a curve to the head, and the rest is drawn forward along the path to give it the length.
  followChain(W, dt = 0.016) {
    const gc = this.gc, gd = this.gd, n = gc.length;
    gc[0].set(this.headPos.x, 0, this.headPos.z); gd[0] = damp(gd[0], this.rear < -1.2 ? 1 : 0, 12, dt);
    for (let i = 1; i < n; i++) {
      const p = gc[i], q = gc[i - 1], dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz);
      if (l > SSP) { const k = SSP / l, nx = q.x + dx * k, nz = q.z + dz * k, mv = Math.hypot(nx - p.x, nz - p.z); p.x = nx; p.z = nz; gd[i] += (gd[i - 1] - gd[i]) * Math.min(1, mv / SSP); }
    }
    const cum = this.cum || (this.cum = new Float32Array(n)); cum[0] = 0;
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(gc[i].x - gc[i - 1].x, gc[i].z - gc[i - 1].z);
    let seg = 0;
    const trail = (s, out) => {
      while (seg < n - 2 && cum[seg + 1] < s) seg++;
      const l = cum[seg + 1] - cum[seg], f = l > 1e-4 ? (s - cum[seg]) / l : 0;
      out.x = gc[seg].x + (gc[seg + 1].x - gc[seg].x) * f; out.z = gc[seg].z + (gc[seg + 1].z - gc[seg].z) * f; out.d = gd[seg] + (gd[seg + 1] - gd[seg]) * clamp(f, 0, 1);
      return out;
    };
    const rear = this.rear, A = Math.abs(rear), H = this.headPos, f = this.headDir, vis = this.vis, sg = rear < 0 ? -1 : 1;
    const tp = this._tp || (this._tp = { x: 0, z: 0, d: 0 }), tq = this._tq || (this._tq = { x: 0, z: 0, d: 0 }), bz = this._bz || (this._bz = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, s: 0 })));
    let arc = 0, sa = 0;
    if (A > 0.08) {
      sa = 0.3 * A + 0.7; trail(sa, tp); trail(sa + 0.7, tq);
      const gy = this.surfY(W, tp.x, tp.z, serpentRad(sa / SSP), tp.d);
      let gx = tq.x - tp.x, gz = tq.z - tp.z; const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      const k1 = 0.5 * A, k2 = 0.32 * A + 0.5;
      const P0 = [H.x, H.y, H.z], P1 = [H.x - f.x * 0.3 * A, H.y - sg * k1, H.z - f.z * 0.3 * A], P2 = [tp.x - gx * k2, gy, tp.z - gz * k2], P3 = [tp.x, gy, tp.z];
      for (let m = 0; m < bz.length; m++) {
        const t = m / (bz.length - 1), a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3, B = bz[m];
        B.x = a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0]; B.y = a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]; B.z = a * P0[2] + b * P1[2] + c * P2[2] + d * P3[2];
        B.s = m ? bz[m - 1].s + Math.hypot(B.x - bz[m - 1].x, B.y - bz[m - 1].y, B.z - bz[m - 1].z) : 0;
      }
      arc = bz[bz.length - 1].s;
    }
    let m = 1;
    for (let i = 0; i < SN; i++) {
      const s = i * SSP, r = serpentRad(i), V = vis[i];
      if (s < arc) {
        while (m < bz.length - 1 && bz[m].s < s) m++;
        const a = bz[m - 1], b = bz[m], k = (s - a.s) / Math.max(1e-5, b.s - a.s);
        V.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
        const gy = W.heightAt(V.x, V.z);
        if (rear > 0) V.y = Math.max(V.y, gy + r * 0.8);
        this.visD[i] = clamp((gy - V.y) / (r * 2), 0, 1);
      } else {
        trail(arc > 0 ? sa + s - arc : s, tp);
        V.set(tp.x, this.surfY(W, tp.x, tp.z, r, tp.d), tp.z); this.visD[i] = tp.d;
      }
    }
    this.burrowed = this.visD[0] > 0.5;
  }

  // ---------------------------------------------------------------- the fight (host)
  canReel() { return ['loom', 'spit', 'slither', 'thrash', 'brood', 'rain', 'strike'].includes(this.state) && !(this.state === 'strike' && this.t < 0.5); }
  onPoiseBreak(C) { this.interrupt(); this.chainN = 0; this.aim = null; this.setState('recoil'); C?.ev('bossSfx', this, 'scream'); }
  onPhase(n, C) {
    if (n === 2) { this.cds.brood = 0; this.cds.coil = 4; }
    if (n === 3) { this.cad *= 1.35; this.dmgScale = 1.2; this.cds.rain = 0; C?.ev('bossSfx', this, 'roar'); }
    if (['loom', 'slither', 'spit'].includes(this.state)) { this.setState(n === 2 ? 'brood' : 'rain'); }
  }
  phaseLine(n) { return n === 2 ? 'The Serpent calls up its brood' : 'The Old Serpent rages'; }
  knightsNearBody(C) {
    const out = [];
    for (const k of C.knights) {
      if (k.downed || Math.hypot(k.pos.x - this.headPos.x, k.pos.z - this.headPos.z) < 6) continue;
      let bi = -1, bd = 1e9; for (let i = 8; i < SN - 6; i++) { if (this.visD[i] > 0.4) continue; const p = this.vis[i], d = Math.hypot(k.pos.x - p.x, k.pos.z - p.z) - serpentRad(i); if (d < bd) { bd = d; bi = i; } }
      if (bi >= 0 && bd < 4.5) out.push({ k, i: bi });
    }
    return out;
  }
  mouthPos() { const f = this.headDir; return new THREE.Vector3(this.headPos.x + f.x * 2.3, this.headPos.y - 0.15, this.headPos.z + f.z * 2.3); }
  glob(C, to, delay) {
    const from = this.mouthPos(), gy = C.world.heightAt(to.x, to.z), T = Math.max(0.35, from.distanceTo(new THREE.Vector3(to.x, gy + 1, to.z)) / 18);
    C.projectile('venom', { pos: from, chest: from }, { pos: new THREE.Vector3(to.x, gy, to.z) }, delay);
    this.warn('circle', to.x, to.z, 1.9, 0, 0, delay + T, 1, 3, () => this.warn('pool', to.x, to.z, 2.2, 0, 0, 6.5, 1, 0, null, true), true);
  }
  choose(C, T, d) {
    const P = this.phase, o = [], near = this.knightsNearBody(C);
    if (d < 12) o.push(['strike', 3.2]);
    if (near.length) o.push(['thrash', 2.6 + near.length * 0.5]);
    o.push(['spit', d > 10 ? 2.2 : 0.8]);
    if (d > 14) o.push(['slither', 2.4]);
    o.push(['dive', d > 16 ? 2.2 : 0.8]);
    if (P >= 2 && this.cds.coil <= 0) o.push(['coil', 1.8]);
    if (P >= 2 && this.cds.brood <= 0) o.push(['brood', 1.5]);
    if (P >= 3 && this.cds.rain <= 0) o.push(['rain', 2.2]);
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.35; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) return s; } return o[0][0];
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world; this.world = W;
    if (this.state === 'death') { this.rear = damp(this.rear, 0.2, 1.2, dt); this.jawOpen = 0.6; this.pitch = damp(this.pitch, 0.3, 2, dt); this.finish(W, dt); return; }
    const T = this.pickTarget(C.knights), tp = T ? T.pos : this.headPos;
    const dx = tp.x - this.headPos.x, dz = tp.z - this.headPos.z, d = Math.hypot(dx, dz), want = Math.atan2(dx, dz), cad = this.cad;
    const turn = (yaw, rate) => { const y = dampAngle(Math.atan2(this.headDir.x, this.headDir.z), yaw, rate, dt); this.headDir.set(Math.sin(y), 0, Math.cos(y)); };
    const move = (v) => this.headPos.addScaledVector(this.headDir, v * dt);
    const rearTo = (h, rate) => { this.rear = damp(this.rear, h, rate, dt); };
    const pitchTo = (p, rate = 6) => { this.pitch = damp(this.pitch, p, rate, dt); };
    const jaw = (j, rate = 10) => { this.jawOpen = damp(this.jawOpen, j, rate, dt); };
    switch (this.state) {
      case 'intro': // he rises out of the ground where he lay, and looks at them
        rearTo(this.t < 0.6 ? -4.5 : 7.2, 1.6); pitchTo(-0.15); jaw(this.t > 1.6 && this.t < 2.6 ? 1 : 0, 6); if (T) turn(want, 1.2);
        if (this.t > 1.5 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'erupt'); C.ev('slam', new THREE.Vector3(this.headPos.x, W.heightAt(this.headPos.x, this.headPos.z), this.headPos.z), 4); }
        if (this.t > 3.4) { this.cd = 0.6; this.setState('loom'); }
        break;
      case 'loom': // reared, swaying, the head turning to follow
        rearTo(6.6 + Math.sin(this.t * 1.6) * 0.35, 3); pitchTo(0.12); jaw(0.04); if (T) turn(want, 2.2);
        if (T && d > 13) move(4.5);
        if (T && this.t > 0.7 / cad && this.cd <= 0) { const s = this.choose(C, T, d); this.last = s; this.chainN = 0; this.setState(s); }
        break;
      case 'slither': { // down onto the ground and across it in great S-curves, the body sweeping after
        rearTo(1.0, 4); pitchTo(0.08); jaw(0);
        turn(want + Math.sin(this.t * 2.4) * 0.6, 3.2); move(11.5 * Math.sqrt(cad));
        if ((d < 9 && this.t > 1) || this.t > 5) { this.cd = 0.4; this.setState('loom'); }
        break;
      }
      case 'strike': { // drawn back and up, the lane burning on the ground; then the lunge, and the head lies there a moment
        const wind = (this.chainN ? 0.58 : 0.82) / cad, lunge = 0.24, rec = this.phase >= 3 ? 0.8 : 1.2;
        if (!this.aim) {
          const ox = this.headPos.x - this.headDir.x * 1.5, oz = this.headPos.z - this.headDir.z * 1.5, yaw = T ? want : Math.atan2(this.headDir.x, this.headDir.z), len = clamp(d + 4, 7, 17);
          this.aim = { x: ox, z: oz, yaw, len }; this.warn('line', ox, oz, len, 3.6, yaw, wind + 0.12, 0, 0, (Tl) => this.hurtIn(C, Tl, 44, this.headPos.clone(), { knockdown: true }));
          C.ev('bossSfx', this, 'hiss');
        }
        const A = this.aim;
        if (this.t < wind) { rearTo(this.chainN ? 3.4 : 7.6, 5); turn(A.yaw, 10); if (this.t < wind * 0.6) move(-2.2); pitchTo(-0.2); jaw(0.35); }
        else if (this.t < wind + lunge) {
          rearTo(0.75, 16); jaw(1, 30); pitchTo(0.45, 14); turn(A.yaw, 20);
          const ex = A.x + Math.sin(A.yaw) * A.len, ez = A.z + Math.cos(A.yaw) * A.len, rem = Math.hypot(ex - this.headPos.x, ez - this.headPos.z);
          move(Math.min(rem / Math.max(dt, wind + lunge - this.t), 70));
          if (!this.hitDone && this.t > wind + 0.1) { this.hitDone = true; C.ev('slam', new THREE.Vector3(ex, W.heightAt(ex, ez), ez), 3.2); }
        } else {
          rearTo(0.75, 6); jaw(0.3, 4); pitchTo(0.18, 4);
          if (this.t > wind + lunge + rec) {
            this.aim = null; const more = this.phase === 1 ? 0 : this.phase === 2 ? 1 : 2;
            if (this.chainN < more && T && R() < 0.8) { this.chainN++; this.setState('strike'); } else { this.chainN = 0; this.cd = 1.3 / cad; this.setState('loom'); }
          }
        }
        break;
      }
      case 'spit': // the jaws gape and he spits: the venom falls where the rings burn, and lies there burning
        rearTo(7.2, 3); if (T) turn(want, 4); pitchTo(-0.12); jaw(this.t < 0.55 ? 0.6 : 1, 8);
        if (this.t > 0.6 && !this.hitDone && T) {
          this.hitDone = true; const n = this.phase >= 2 ? 5 : 3;
          for (let k = 0; k < n; k++) { const lead = T.vel ? T.vel.clone().multiplyScalar(0.6) : new THREE.Vector3(), a = R() * TAU, r = k ? 1.6 + R() * 2.6 : 0; this.glob(C, new THREE.Vector3(T.pos.x + lead.x + Math.sin(a) * r, 0, T.pos.z + lead.z + Math.cos(a) * r), k * 0.13); }
          C.ev('bossSfx', this, 'hiss');
        }
        if (this.t > 1.5) { this.cd = 1.5 / cad; this.setState('loom'); }
        break;
      case 'thrash': // the coils near the knights who have gone to hack at his body heave up, and come down on them
        rearTo(5.2, 3); jaw(0.5); if (T) turn(want, 2);
        if (!this.hitDone) {
          this.hitDone = true; const pts = [];
          for (const { i } of this.knightsNearBody(C)) { const p = this.vis[i]; if (pts.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 4.5)) pts.push(p.clone()); if (pts.length >= 3) break; }
          const dur = 1.0 / Math.sqrt(cad);
          for (const p of pts) this.warn('circle', p.x, p.z, 3.8, 0, 0, dur, 0, 1, (Tl) => { this.hurtIn(C, Tl, 30, p, { knockback: 10 }); C.ev('slam', new THREE.Vector3(p.x, W.heightAt(p.x, p.z), p.z), 3.6); });
          C.ev('bossSfx', this, 'hiss');
        }
        if (this.t > 1.7) { this.cd = 1.1 / cad; this.setState('loom'); }
        break;
      case 'coil': { // round them at speed, the body closing a ring about them; then it tightens, and crushes what is inside
        if (!this.coilC) {
          const c = T ? T.pos.clone() : this.headPos.clone(); this.coilC = { x: c.x, z: c.z, a: Math.atan2(this.headPos.x - c.x, this.headPos.z - c.z), dir: R() < 0.5 ? 1 : -1 };
          this.warn('circle', c.x, c.z, 8.2, 0, 0, 3.9, 0, 0, (Tl) => { this.hurtIn(C, Tl, 52, new THREE.Vector3(Tl.x, 0, Tl.z), { knockdown: true, unblockable: true }, 0.2); C.ev('slam', new THREE.Vector3(Tl.x, W.heightAt(Tl.x, Tl.z), Tl.z), 7); C.ev('bossSfx', this, 'crash'); });
          C.ev('bossSfx', this, 'roar');
        }
        const K = this.coilC; K.a += dt * TAU / 2.7 * K.dir; const rr = this.t < 2.7 ? 9.2 : lerp(9.2, 4.2, smooth(clamp((this.t - 2.7) / 1.2, 0, 1)));
        const px = K.x + Math.sin(K.a) * rr, pz = K.z + Math.cos(K.a) * rr, ddx = px - this.headPos.x, ddz = pz - this.headPos.z, dd = Math.hypot(ddx, ddz);
        turn(Math.atan2(ddx, ddz), 9); move(Math.min(dd / dt, dd > 3 ? 30 : 24));
        rearTo(1.3, 5); jaw(0.2); pitchTo(0.1);
        if (this.t > 4.7) { this.coilC = null; this.cds.coil = 26; this.cd = 1.2 / cad; this.setState('loom'); }
        break;
      }
      case 'brood': // a shriek, and his brood come crawling out of the earth
        rearTo(8.4, 3); pitchTo(-0.55); jaw(1, 8);
        if (this.t > 0.7 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'scream'); const g = new THREE.Vector3(this.headPos.x, 0, this.headPos.z); C.summonAround(g, 'crawler', 2 + this.party + (this.phase >= 3 ? 2 : 0)); if (this.phase >= 3) C.summonAround(g, 'wretch', 1); }
        if (this.t > 2.2) { this.cds.brood = 32; this.cd = 0.8; this.setState('loom'); }
        break;
      case 'rain': { // high over them, spitting into the sky: it comes down all round them
        rearTo(9.2, 3); pitchTo(-0.75); jaw(1, 8); if (T) turn(want, 1.5);
        this.rainT = (this.rainT ?? 0) - dt;
        const total = 8 + 2 * this.party;
        if (this.t > 0.6 && this.t < 2.6 && this.rainT <= 0 && (this.rainN || 0) < total) {
          this.rainT = 2.0 / total; this.rainN = (this.rainN || 0) + 1;
          const alive = C.knights.filter((k) => !k.downed), k = alive[Math.floor(R() * alive.length)];
          if (k) { const a = R() * TAU, r = R() < 0.35 ? 0 : 1 + R() * 4.5; this.glob(C, new THREE.Vector3(k.pos.x + Math.sin(a) * r, 0, k.pos.z + Math.cos(a) * r), 0); }
        }
        if (this.t > 3.1) { this.rainN = 0; this.cds.rain = 20; this.cd = 1.0 / cad; this.setState('loom'); }
        break;
      }
      case 'dive': // nose down into the earth, and gone
        rearTo(-4.6, 2.4); move(7); jaw(0); pitchTo(0.7);
        if (this.t > 1.3) { C.ev('bossSfx', this, 'growl'); this.setState('under'); }
        break;
      case 'under': // a furrow of heaving dust running at them under the ground
        this.rear = -4.6; if (T) turn(want, 3.2); move(15 * Math.sqrt(cad)); pitchTo(0);
        if (d < 1.6 || this.t > 3.2) {
          const ex = tp.x, ez = tp.z; this.er = { x: ex, z: ez };
          this.warn('circle', ex, ez, 4.6, 0, 0, (this.phase >= 3 ? 0.85 : 1.1), 0, 1, (Tl) => {
            this.hurtIn(C, Tl, 40, new THREE.Vector3(ex, 0, ez), { knockdown: true }); C.ev('slam', new THREE.Vector3(ex, W.heightAt(ex, ez), ez), 4.8); C.ev('bossSfx', this, 'erupt'); this.setState('erupt');
          });
          this.setState('surface');
        }
        break;
      case 'surface': { // under the burning ring, gathering
        this.rear = -4.6; const ddx = this.er.x - this.headPos.x, ddz = this.er.z - this.headPos.z, dd = Math.hypot(ddx, ddz);
        if (dd > 0.2) { turn(Math.atan2(ddx, ddz), 8); move(Math.min(dd / dt, 22)); }
        if (this.t > 2) this.setState('erupt');
        break;
      }
      case 'erupt': // bursting up out of the earth, jaws wide
        rearTo(7.8, 9); jaw(this.t < 0.5 ? 1 : 0.2, 8); pitchTo(-0.25);
        if (this.t > 1.05) { if (this.phase >= 3 && !this.again) { this.again = true; this.setState('dive'); } else { this.again = false; this.cd = 1.1 / cad; this.setState('loom'); } }
        break;
      case 'recoil': // reeling, the head down on the ground: open to them
        rearTo(0.6, 6); jaw(0.55, 6); pitchTo(0.25, 4);
        if (this.t > 2.0) { this.cd = 0.8; this.setState('loom'); }
        break;
    }
    // the weight of him: crossing the ground at speed, the body bowls over what it meets
    if (this.state === 'slither') for (const k of C.knights) {
      if (k.downed || (this.touch.get(k) || 0) > (C.time || 0)) continue;
      for (let i = 5; i < SN - 8; i += 2) { if (this.visD[i] > 0.4) continue; const p = this.vis[i]; if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) < serpentRad(i) + 0.55) { this.touch.set(k, (C.time || 0) + 1.6); this.hurt(C, k, 14, p, { knockback: 7 }); break; } }
    }
    // the venom where it lies
    this.poolT -= dt;
    if (this.poolT <= 0) { this.poolT = 0.8; for (const Tl of this.tele.map.values()) if (Tl.shape === 'pool' && Tl.t > 0.3) for (const k of C.knights) if (!k.downed && inside(k, Tl, 0.1)) this.hurt(C, k, 7, new THREE.Vector3(Tl.x, 0, Tl.z), {}); }
    this.finish(W, dt);
  }
  finish(W, dt) {
    W.collide({ pos: this.headPos }, 0.8);
    const gy = W.heightAt(this.headPos.x, this.headPos.z);
    this.headPos.y = gy + this.rear; this.pos.set(this.headPos.x, gy, this.headPos.z);
    this.yaw = Math.atan2(this.headDir.x, this.headDir.z); this.alt = this.rear;
    this.followChain(W, dt);
  }
  snap() { return [...this.baseSnap(), +this.headPos.x.toFixed(2), +this.headPos.z.toFixed(2), +this.headDir.x.toFixed(3), +this.headDir.z.toFixed(3), +this.rear.toFixed(2), this.rear < -1.2 ? 1 : 0, +this.jawOpen.toFixed(2), +this.pitch.toFixed(2), this.tele.snap()]; }
  applySnap(s, dt, W) {
    super.applySnap(s, dt);
    const [, , , , , , , , , , , hx, hz, dx, dz, rear, , jaw, pitch, tele] = s;
    // a client: the host's word arrives fifteen times a second; the head is eased toward it every frame (see animate)
    if (!this.net || Math.hypot(hx - this.headPos.x, hz - this.headPos.z) > 10) { this.headPos.set(hx, 0, hz); this.rear = rear; }
    this.net = { hx, hz, dx, dz, rear, pitch: pitch || 0 }; this.jawOpen = jaw;
    this.tele.apply(tele);
    if (W) this.world = W;
  }
  teleFx(T, fx, world) {
    if (!fx) return; const p = new THREE.Vector3(T.x, world ? world.heightAt(T.x, T.z) : 0, T.z);
    if (T.fxk === 1) { fx.dust(p, 10, [0.24, 0.21, 0.17]); fx.dust(p.clone().add(new THREE.Vector3(1.2, 0, 0)), 6, [0.2, 0.18, 0.15]); }
    if (T.fxk === 3) { fx.bolt(p, [0.35, 0.95, 0.15]); fx.dust(p, 4, [0.12, 0.3, 0.06]); }
  }

  // ---------------------------------------------------------------- the body (every client)
  buildBody(P, time) {
    const M = this.M, R2 = SRADIAL + 1, pos = this.geo.attributes.position.array, nrm = this.geo.attributes.normal.array;
    const C = this._Cc || (this._Cc = Array.from({ length: M }, () => new THREE.Vector3()));
    for (let i = 0; i < SN - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(SN - 1, i + 2)];
      for (let k = 0; k < SSUB; k++) {
        const t = k / SSUB, t2 = t * t, t3 = t2 * t, o = C[i * SSUB + k];
        for (const ax of ['x', 'y', 'z']) o[ax] = 0.5 * (2 * p1[ax] + (-p0[ax] + p2[ax]) * t + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * t2 + (-p0[ax] + 3 * p1[ax] - 3 * p2[ax] + p3[ax]) * t3);
      }
    }
    C[M - 1].copy(P[SN - 1]);
    const t = this._vt || (this._vt = new THREE.Vector3()), s = this._vs || (this._vs = new THREE.Vector3()), n = this._vn || (this._vn = new THREE.Vector3()), ps = this._vps || (this._vps = new THREE.Vector3());
    const t0 = this._t0 || (this._t0 = new THREE.Vector3()), t1 = this._t1 || (this._t1 = new THREE.Vector3());
    // frames from the tail (always lying on the ground) up to the neck (which may stand straight up), so they never twist
    for (let j = M - 1; j >= 0; j--) {
      t.subVectors(C[Math.min(M - 1, j + 1)], C[Math.max(0, j - 1)]); if (t.lengthSq() < 1e-10) t.set(0, 0, 1); t.normalize();   // toward the tail
      s.set(-t.z, 0, t.x); const sl = s.length();
      if (j < M - 1) { ps.addScaledVector(t, -ps.dot(t)); if (ps.lengthSq() < 1e-8) ps.copy(s); ps.normalize(); if (sl > 0.3) s.divideScalar(sl).lerp(ps, 0.5).normalize(); else s.copy(ps); }
      else if (sl > 1e-4) s.divideScalar(sl); else s.set(1, 0, 0);
      ps.copy(s); n.crossVectors(s, t).normalize();
      if (j === 0) t0.copy(t); if (j === M - 1) t1.copy(t);
      const r = this.ringR[j] * (1 + 0.022 * Math.sin(time * 2.1 - j * 0.11)), c = C[j], base = j * R2;
      for (let k = 0; k <= SRADIAL; k++) {
        const ang = k / SRADIAL * TAU, ca = Math.cos(ang), sa = Math.sin(ang), fy = sa < 0 ? 0.72 : 1, fw = 1.06, o = (base + k) * 3;
        pos[o] = c.x + (n.x * sa * fy + s.x * ca * fw) * r; pos[o + 1] = c.y + (n.y * sa * fy + s.y * ca * fw) * r; pos[o + 2] = c.z + (n.z * sa * fy + s.z * ca * fw) * r;
        let nx = n.x * sa / fy + s.x * ca / fw, ny = n.y * sa / fy + s.y * ca / fw, nz = n.z * sa / fy + s.z * ca / fw; const l = Math.hypot(nx, ny, nz) || 1;
        nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
      }
    }
    // the cap inside the neck, and the point of the tail
    const HC = M * R2, TT = HC + 1, r0 = this.ringR[0], c0 = C[0], cT = C[M - 1];
    pos[HC * 3] = c0.x - t0.x * r0 * 0.6; pos[HC * 3 + 1] = c0.y - t0.y * r0 * 0.6; pos[HC * 3 + 2] = c0.z - t0.z * r0 * 0.6; nrm[HC * 3] = -t0.x; nrm[HC * 3 + 1] = -t0.y; nrm[HC * 3 + 2] = -t0.z;
    pos[TT * 3] = cT.x + t1.x * 0.5; pos[TT * 3 + 1] = cT.y + t1.y * 0.5; pos[TT * 3 + 2] = cT.z + t1.z * 0.5; nrm[TT * 3] = t1.x; nrm[TT * 3 + 1] = t1.y; nrm[TT * 3 + 2] = t1.z;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }
  animate(dt, time, fx) {
    const W = this.world;
    if (this.net && W) {
      const n = this.net, k = 1 - Math.exp(-12 * dt);
      this.headPos.x += (n.hx - this.headPos.x) * k; this.headPos.z += (n.hz - this.headPos.z) * k; this.rear += (n.rear - this.rear) * k; this.pitch += (n.pitch - this.pitch) * k;
      const y = dampAngle(Math.atan2(this.headDir.x, this.headDir.z), Math.atan2(n.dx, n.dz), 12, dt); this.headDir.set(Math.sin(y), 0, Math.cos(y));
      this.headPos.y = W.heightAt(this.headPos.x, this.headPos.z) + this.rear; this.followChain(W, dt);
    }
    this.tele.update(dt, W, fx);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.mat.emissiveIntensity = (this.phase >= 3 ? 0.45 + 0.3 * Math.sin(time * 2.6) : 0) + this.hitFlash * 2.4;
    const P = this._P || (this._P = this.vis.map(() => new THREE.Vector3()));
    for (let i = 0; i < SN; i++) P[i].copy(this.vis[i]);
    // a coil heaved up and slammed down where its ring burns
    for (const T of this.tele.map.values()) if (T.fxk === 1 && T.shape === 'circle' && T.a < 4) {
      const ph = T.t / T.dur, h = ph < 1 ? 2.8 * smooth(clamp(ph * 1.25, 0, 1)) : 2.8 * Math.max(0, 1 - (T.t - T.dur) / 0.1);
      if (h > 0) for (let i = 4; i < SN; i++) { const d = Math.hypot(P[i].x - T.x, P[i].z - T.z); if (d < 6.5) P[i].y += h * (1 - d / 6.5) ** 2 * (1 - this.visD[i]); }
    }
    if (this.state === 'death') {
      this.deathT += dt; const k = Math.max(0, this.deathT - 1.2);
      for (let i = 0; i < SN; i++) P[i].y += Math.sin(time * 9 + i * 0.5) * 0.12 * Math.max(0, 1 - this.deathT / 1.5) - k * (1.1 + 0.6 * i / SN);
    }
    this.buildBody(P, time);
    // the head
    const yaw = Math.atan2(this.headDir.x, this.headDir.z);
    this.head.position.copy(P[0]); this.head.rotation.set(this.pitch, yaw, 0, 'YXZ');
    this.jawVis = damp(this.jawVis, this.jawOpen, 14, dt);
    const H = this.hparts; H.jaw.rotation.x = this.jawVis * 1.15;
    const fang = lerp(1.3, -0.15, smooth(clamp(this.jawVis * 1.7, 0, 1))); for (const f of H.fangs) f.rotation.x = fang;
    // tasting the air: now and then the tongue slips out through the notch in the lips, flickers, and is gone
    this.tongueT -= dt;
    if (this.flick < 0 && this.tongueT <= 0 && this.jawVis < 0.2 && !this.burrowed && this.state !== 'death') { this.flick = 0; this.tongueT = 1.6 + R() * 2.4; }
    if (this.flick >= 0) {
      this.flick += dt; const e = Math.sin(Math.PI * clamp(this.flick / 0.75, 0, 1));
      H.tongue.visible = e > 0.02; H.tongue.position.z = 1.15 + e * 1.45; H.tongue.rotation.x = Math.sin(time * 46) * 0.14 * e - 0.05;
      if (this.flick > 0.75 || this.jawVis > 0.35) { this.flick = -1; H.tongue.visible = false; }
    }
    // dust where he goes into the earth and comes out of it, and over him as he runs beneath it
    if (fx && W) {
      this.dustT = (this.dustT || 0) - dt;
      if (this.dustT <= 0) {
        this.dustT = 0.1;
        for (let i = 1; i < SN; i += 2) { const a = this.visD[i - 1], b = this.visD[i]; if ((a - 0.5) * (b - 0.5) < 0) fx.dust(new THREE.Vector3(P[i].x, W.heightAt(P[i].x, P[i].z), P[i].z), 3, [0.22, 0.2, 0.17]); }
        if (this.state === 'under' || this.state === 'surface' || this.state === 'dive') { const g = this.headPos; fx.dust(new THREE.Vector3(g.x, W.heightAt(g.x, g.z), g.z), 5, [0.25, 0.22, 0.18]); }
      }
    }
    // what a blade can find
    for (const sp of this.spheres) {
      if (sp.i < 0) { this.head.updateMatrixWorld(true); this.head.localToWorld(sp.c.set(0, 0.05, 1.2)); sp.mul = this.state === 'recoil' ? 2.1 : 1.8; sp.r = this.burrowed ? 0 : 1.45; }
      else { sp.c.copy(P[sp.i]); sp.r = this.visD[sp.i] > 0.6 ? 0 : serpentRad(sp.i) + 0.3; }
    }
  }
  dispose() { this.scene.remove(this.mesh); this.scene.remove(this.head); this.tele.clear(); }
}

// ================================================================ THE THING ON THE RIDGE
// Him. The same grey, hooded, ram-horned shape that has watched them from the hills all the way up, come down off the
// ridge at last: two and a half times a man's height, the arms hanging to the knees and ending in black talons, bone
// breaking out through the back of his robe. Hurt enough, he begins to burn.
const DEVIL_DEF = { ...WATCHER_DEF, horns: [1.3, 0.09, 3.15] };
const DS = 2.45;
// the talons and the spines, on the Devil's own bones (and burning away with his flesh when he goes)
function devilGrotesque(B, root, DU) {
  const talon = dissolvable(new THREE.MeshStandardMaterial({ color: 0x110c0a, roughness: 0.3, metalness: 0.1 }), DU);
  const boneM = dissolvable(new THREE.MeshStandardMaterial({ color: 0x3a332c, roughness: 0.55 }), DU);
  let sk = null; root.traverse((o) => { if (o.isSkinnedMesh && !sk) sk = o; });
  for (const k of ['R', 'L']) {
    // the hand's extent in its own frame, from the skin bound to it
    const box = new THREE.Box3(), v = new THREE.Vector3();
    if (sk) {
      const hi = JI['hand' + k], inv = sk.skeleton.boneInverses[hi], g = sk.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      for (let i = 0; i < P.count; i++) if (SI.getX(i) === hi && SW.getX(i) > 0.6) box.expandByPoint(v.fromBufferAttribute(P, i).applyMatrix4(inv));
    }
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.02, -0.19, -0.045), new THREE.Vector3(0.02, 0, 0.05));
    const m = k === 'R' ? 1 : -1, cx = (box.min.x + box.max.x) / 2, gs = [];
    for (let i = 0; i < 4; i++) {
      const z = lerp(box.min.z + 0.014, box.max.z - 0.016, i / 3), len = 0.13 + (i === 1 || i === 2 ? 0.02 : 0);
      gs.push(place(taperTube([[0, 0, 0], [m * 0.01, -len * 0.4, 0.004], [m * 0.03, -len * 0.75, 0.01], [m * 0.058, -len, 0.016]], 0.012, 0.0015, 7, 1.1), [cx, box.min.y + 0.03, z]));
    }
    gs.push(place(taperTube([[0, 0, 0], [m * 0.02, -0.04, 0.02], [m * 0.045, -0.075, 0.03]], 0.011, 0.0015, 6, 1.1), [cx + m * 0.012, box.min.y + 0.085, box.max.z - 0.004]));
    const t = new THREE.Mesh(mergeGeometries(gs), talon); t.castShadow = true; B['hand' + k].add(t);
  }
  // spines of bone through the back of the robe, and two at the shoulder blades
  const sg = [];
  for (const [y, len, bone] of [[0.0, 0.3, 'spine'], [0.12, 0.36, 'spine'], [-0.02, 0.42, 'chest'], [0.1, 0.44, 'chest'], [0.2, 0.32, 'chest']]) sg.push([bone, place(taperTube([[0, 0, 0], [0, len * 0.35, -len * 0.5], [0, len * 0.8, -len * 0.85]], 0.04, 0.003, 7, 1), [0, y, -0.07])]);
  for (const s of [-1, 1]) sg.push(['chest', place(taperTube([[0, 0, 0], [s * 0.08, 0.1, -0.16], [s * 0.2, 0.22, -0.3]], 0.035, 0.003, 7, 1), [s * 0.09, 0.12, -0.08])]);
  for (const bone of ['spine', 'chest']) { const gg = sg.filter((e) => e[0] === bone).map((e) => e[1]); const mm = new THREE.Mesh(mergeGeometries(gg), boneM); mm.castShadow = true; B[bone].add(mm); }
}
// the lowest ground under a footprint (so a hem never hangs in the air off the edge of a ridge)
function footGround(W, x, z, r, y0) {
  if (!W) return y0;
  let y = W.heightAt(x, z); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; y = Math.min(y, W.heightAt(x + Math.sin(a) * r, z + Math.cos(a) * r)); }
  return Math.max(y, y0 - 0.9);
}

export class Cryptid extends Boss {
  constructor(scene, partySize, fx) {
    super(scene, 'cryptid');
    this.fx = fx;
    this.name = 'The Thing on the Ridge'; this.title = 'Qui in Montibus Vigilat';
    const body = buildHumanDevil(DEVIL_DEF) || buildHorror('devil', DEVIL_DEF);
    this.mat = body.mat; this.mesh = body.mesh; this.B = body.B; const B = this.B;
    this.mesh.scale.set(0.92 * DS, 1.08 * DS, 0.92 * DS);
    const DU = this.mat.userData.u.uDissolve;
    for (const k of ['R', 'L']) { B['fArm' + k].position.multiplyScalar(1.15); B['hand' + k].position.multiplyScalar(1.5); B['fArm' + k].userData.rest = B['fArm' + k].position.clone(); B['hand' + k].userData.rest = B['hand' + k].position.clone(); }
    if (B.robe) devilGrotesque(B, this.mesh, DU);
    this.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(this.mesh);
    // where his feet stand, in his own frame
    this.mesh.updateMatrixWorld(true); this.ankle = {};
    for (const k of ['R', 'L']) this.ankle[k] = this.mesh.worldToLocal(B['foot' + k].getWorldPosition(new THREE.Vector3()));
    this.party = Math.max(1, partySize || 1);
    this.maxHp = this.hp = Math.round(3800 * (1 + 0.7 * (this.party - 1)));
    this.maxPoise = this.poise = 300 * (1 + 0.25 * (this.party - 1));
    this.phases = [0.65, 0.3]; this.cad = 1 + 0.1 * (this.party - 1); this.cds = { legion: 6, pillars: 0, scream: 0 }; this.combo = 0; this.last = ''; this.wind = 0.8;
    this.camH = 3.4; this.camD = 2;
    const S = DS;
    this.spheres = [
      { name: 'head', bone: B.head, off: [0, 0.08, 0.04], r: 0.17 * S, mul: 1.7 }, { name: 'chest', bone: B.chest, off: [0, 0.12, 0.02], r: 0.25 * S, mul: 1 },
      { name: 'spine', bone: B.spine, off: [0, 0.08, 0], r: 0.22 * S, mul: 1 }, { name: 'hips', bone: B.hips, off: [0, -0.06, 0], r: 0.27 * S, mul: 1 },
      { name: 'robe', bone: B.thighR, off: [0, -0.28, 0], r: 0.21 * S, mul: 0.85 }, { name: 'robe', bone: B.thighL, off: [0, -0.28, 0], r: 0.21 * S, mul: 0.85 },
      { name: 'robe', bone: B.shinR, off: [0, -0.2, 0], r: 0.2 * S, mul: 0.85 }, { name: 'robe', bone: B.shinL, off: [0, -0.2, 0], r: 0.2 * S, mul: 0.85 },
      { name: 'arm', bone: B.fArmR, off: [0, -0.2, 0], r: 0.09 * S, mul: 0.8 }, { name: 'arm', bone: B.fArmL, off: [0, -0.2, 0], r: 0.09 * S, mul: 0.8 },
      { name: 'hand', bone: B.handR, off: [0, -0.1, 0], r: 0.11 * S, mul: 0.9 }, { name: 'hand', bone: B.handL, off: [0, -0.1, 0], r: 0.11 * S, mul: 0.9 },
    ].filter((s) => s.bone).map((s) => ({ ...s, c: new THREE.Vector3() }));
    this.headSphere = this.spheres[0];
    this._v = new THREE.Vector3(); this.spV = 0; this.ph = 0; this.look = 0; this.tilt = 0; this.tiltT = 0; this.reachLen = 9;
  }
  // ---------------------------------------------------------------- the fight (host)
  canReel() { return ['stalk', 'rake', 'grasp', 'stomp', 'pillars', 'legion', 'appear'].includes(this.state); }
  onPoiseBreak(C) { this.interrupt(); this.combo = 0; this.setState('stagger'); C?.ev('bossSfx', this, 'scream'); }
  onPhase(n, C) {
    if (n === 2) { this.cds.legion = 0; this.cds.pillars = 0; }
    if (n === 3) { this.cad *= 1.35; this.dmgScale = 1.2; this.cds.scream = 0; C?.ev('bossSfx', this, 'roar'); }
    if (this.state === 'stalk') this.setState(n === 2 ? 'legion' : 'scream');
  }
  phaseLine(n) { return n === 2 ? 'He calls up his legion' : 'He burns'; }
  choose(C, T, d) {
    const P = this.phase, o = [];
    const close = C.knights.filter((k) => !k.downed && Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z) < 6.5);
    const behind = close.filter((k) => Math.abs(angleDiff(this.yaw, Math.atan2(k.pos.x - this.pos.x, k.pos.z - this.pos.z))) > 1.7).length;
    if (d < 8.5) o.push(['rake', 3.4]);
    if (close.length >= 2 || behind) o.push(['stomp', 2.2 + behind * 1.4]); else if (d < 6) o.push(['stomp', 0.5]);
    if (d > 4.5 && d < 15) o.push(['grasp', d > 8 ? 3 : 1.2]);
    o.push(['vanish', d > 14 || this.far > 2 ? 3.2 : 0.45]);
    if (P >= 2 && this.cds.legion <= 0) o.push(['legion', 2.2]);
    if (P >= 2 && this.cds.pillars <= 0) o.push(['pillars', d > 9 ? 2.8 : 1.4]);
    if (P >= 3 && this.cds.scream <= 0) o.push(['scream', 2.6]);
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.35; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) return s; } return o[0][0];
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world; this.world = W;
    const wv = this._wv || (this._wv = new THREE.Vector3()); wv.set(0, 0, 0);
    if (this.state === 'death') { this.vel.multiplyScalar(0.9); this.pos.y = W.heightAt(this.pos.x, this.pos.z); return; }
    const T = this.pickTarget(C.knights), tp = T ? T.pos : this.pos;
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z, d = Math.hypot(dx, dz), want = Math.atan2(dx, dz), cad = this.cad;
    const face = (rate, yaw = want) => { this.yaw = dampAngle(this.yaw, yaw, rate, dt); };
    const fwd = (v) => wv.set(Math.sin(this.yaw) * v, 0, Math.cos(this.yaw) * v);
    const gp = (x, z) => new THREE.Vector3(x, W.heightAt(x, z), z);
    switch (this.state) {
      case 'intro': face(0.8); if (this.t > 3.8) { this.cd = 0.4; this.setState('stalk'); } break;
      case 'stalk': // he comes on with long, unhurried strides, and turns slowly: there is time to get round him
        face(1.8);
        if (d > 5.5) fwd((d > 12 ? 4.4 : 3.2) * Math.sqrt(cad));
        this.far = d > 15 ? (this.far || 0) + dt : 0;
        if (T && this.cd <= 0 && this.t > 0.45 / cad) { const s = this.choose(C, T, d); this.last = s; this.combo = 0; this.setState(s); }
        break;
      case 'rake': { // the long arm raised, the fan burning before him; then the talons come across it
        const third = this.phase >= 3 && this.combo === 2, wind = (third ? 0.9 : this.combo ? 0.56 : 0.82) / cad;
        if (!this.aimT) {
          this.atk = third ? 2 : this.combo % 2; this.lockYaw = want; this.wind = wind;
          if (third) { const cx = this.pos.x + Math.sin(want) * 4.3, cz = this.pos.z + Math.cos(want) * 4.3; this.aimT = this.warn('circle', cx, cz, 4.3, 0, 0, wind + 0.16, 0, 1, (Tl) => { this.hurtIn(C, Tl, 46, this.pos.clone(), { knockdown: true }); C.ev('slam', gp(Tl.x, Tl.z), 4.3); }); }
          else this.aimT = this.warn('cone', this.pos.x, this.pos.z, 8.4, 1.15, want, wind + 0.12, 0, 0, (Tl) => this.hurtIn(C, Tl, 32 + this.combo * 3, this.pos.clone(), { knockback: 9 }));
          C.ev('bossSfx', this, this.combo ? 'snarl' : 'growl');
        }
        face(9, this.lockYaw);
        if (this.t < wind) fwd(-0.6); else if (this.t < wind + 0.3) fwd(4);
        if (this.t > wind + (third ? 1.35 : 0.7)) {
          this.aimT = null;
          if (this.combo + 1 < (this.phase >= 3 ? 3 : 2) && T && d < 10) { this.combo++; this.setState('rake'); } else { this.combo = 0; this.cd = 1.15 / cad; this.setState('stalk'); }
        }
        break;
      }
      case 'grasp': { // drawn back, the lane burning out ahead of him; then he lunges down it and the hand comes down at the end
        const wind = 0.92 / cad, reach = 0.32, rec = this.phase >= 3 ? 1.0 : 1.45;
        if (!this.aimT) {
          const len = clamp(d + 3, 7, 15); this.lockYaw = want; this.reachLen = len; this.wind = wind;
          this.aimT = this.warn('line', this.pos.x + Math.sin(want) * 0.8, this.pos.z + Math.cos(want) * 0.8, len, 3.3, want, wind + 0.14, 0, 0, (Tl) => this.hurtIn(C, Tl, 38, this.pos.clone(), { knockdown: true }));
          this.lungeFrom = this.pos.clone(); C.ev('bossSfx', this, 'growl');
        }
        face(10, this.lockYaw);
        if (this.t > wind && this.t < wind + reach) {   // the lunge: he covers the lane but for the length of his arm
          const k = smooth(clamp((this.t - wind) / reach, 0, 1)), run = Math.max(0, this.reachLen - 5.2);
          this.pos.x = this.lungeFrom.x + Math.sin(this.lockYaw) * run * k; this.pos.z = this.lungeFrom.z + Math.cos(this.lockYaw) * run * k; this.vel.set(0, 0, 0);
        }
        if (!this.hitDone && this.t > wind + 0.16) { this.hitDone = true; const ex = this.pos.x + Math.sin(this.lockYaw) * 4.6, ez = this.pos.z + Math.cos(this.lockYaw) * 4.6; C.ev('slam', gp(ex, ez), 2.6); }
        if (this.t > wind + reach + rec) { this.aimT = null; this.cd = 1.0 / cad; this.setState('stalk'); }
        break;
      }
      case 'stomp': { // arms flung up; then both hands down flat on the earth, and fire runs out in a ring
        const wind = 1.0 / cad;
        if (!this.aimT) { this.wind = wind; this.aimT = this.warn('circle', this.pos.x, this.pos.z, 6.9, 0, 0, wind + 0.1, 2, 2, (Tl) => { this.hurtIn(C, Tl, 34, this.pos.clone(), { knockdown: true }); C.ev('slam', this.pos.clone(), 6.9); C.ev('bossSfx', this, 'crash'); }); C.ev('bossSfx', this, 'inhale'); }
        if (this.t > wind + 1.55) { this.aimT = null; this.cd = 0.9 / cad; this.setState('stalk'); }
        break;
      }
      case 'vanish': // he goes to smoke where he stands, and the ground burns behind one of them
        if (this.t > 0.7) this.untouchable = true;
        if (this.t > 1.15 && !this.hitDone && T) {
          this.hitDone = true;
          const ky = T.yaw ?? want; let px = T.pos.x - Math.sin(ky) * 3.3, pz = T.pos.z - Math.cos(ky) * 3.3; if (!W.inBounds(px, pz)) { px = T.pos.x - dx / (d || 1) * 3; pz = T.pos.z - dz / (d || 1) * 3; }
          const dur = this.phase >= 3 ? 0.8 : 1.05, yaw = Math.atan2(T.pos.x - px, T.pos.z - pz);
          this.warn('circle', px, pz, 3.8, 0, 0, dur, 0, 2, (Tl) => this.hurtIn(C, Tl, 30, new THREE.Vector3(px, 0, pz), { knockback: 10 }));
          this.later(dur - 0.38, () => { this.pos.set(px, W.heightAt(px, pz), pz); this.vel.set(0, 0, 0); this.yaw = yaw; this.untouchable = false; this.setState('appear'); C.ev('bossSfx', this, 'scream'); });
        }
        if (this.t > 4) { this.untouchable = false; this.setState('stalk'); }
        break;
      case 'appear': // out of the smoke already striking
        if (this.t > 1.15) { if (this.phase >= 3 && !this.again) { this.again = true; this.setState('vanish'); } else { this.again = false; this.cd = 0.9 / cad; this.setState('stalk'); } }
        break;
      case 'legion': // arms raised, presenting his legion: they come up out of the ground about him
        face(1.5);
        if (this.t > 0.9 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'howl'); C.summonAround(this.pos, 'shade', 1 + this.party); C.summonAround(this.pos, 'crawler', 2 + (this.phase >= 3 ? 2 : 0)); if (this.phase >= 3) C.summonAround(this.pos, 'husk', 1); }
        if (this.t > 2.6) { this.cds.legion = 34; this.cd = 0.6; this.setState('stalk'); }
        break;
      case 'pillars': // he points, and the ground opens in fire under them, one after another
        face(3);
        if (!this.hitDone) {
          this.hitDone = true; C.ev('bossSfx', this, 'growl');
          for (const k of C.knights) {
            if (k.downed) continue;
            for (let j = 0; j < 3; j++) this.later(0.45 + j * 0.5, () => {
              const a = R() * TAU, r = j ? 1.6 + R() * 2.6 : 0, x = k.pos.x + (k.vel ? k.vel.x * 0.45 : 0) + Math.sin(a) * r, z = k.pos.z + (k.vel ? k.vel.z * 0.45 : 0) + Math.cos(a) * r;
              this.warn('circle', x, z, 2.6, 0, 0, 1.15 / Math.sqrt(cad), 2, 2, (Tl) => { this.hurtIn(C, Tl, 28, new THREE.Vector3(x, 0, z), { knockback: 7 }); C.ev('slam', gp(x, z), 2.6); }, true);
            }, true);
          }
        }
        if (this.t > 2.7) { this.cds.pillars = 16; this.cd = 0.8 / cad; this.setState('stalk'); }
        break;
      case 'scream': { // he draws in, then screams: a wave runs out over the ground, and only a roll through it is safe
        const wind = 0.75, wave = 1.6;
        if (!this.aimT) { this.wind = wind; this.aimT = this.warn('ring', this.pos.x, this.pos.z, 17, 2, wind / (wind + wave), wind + wave, 0, 0, null); this.waveHit = new Set(); C.ev('bossSfx', this, 'inhale'); }
        if (this.t > wind && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'scream'); C.ev('bossSfx', this, 'roar'); }
        if (this.t > wind && this.aimT) {
          const r = 2 + 15 * clamp((this.t - wind) / wave, 0, 1);
          for (const k of C.knights) { if (k.downed || this.waveHit.has(k)) continue; const dd = Math.hypot(k.pos.x - this.aimT.x, k.pos.z - this.aimT.z); if (Math.abs(dd - r) < 1.1) { this.waveHit.add(k); this.hurt(C, k, 26, new THREE.Vector3(this.aimT.x, 0, this.aimT.z), { knockback: 12, unblockable: true }); } }
        }
        if (this.t > wind + wave + 0.5) { this.aimT = null; this.cds.scream = 22; this.cd = 0.9 / cad; this.setState('stalk'); }
        break;
      }
      case 'stagger': // down on one knee, bowed over: his head is in reach
        if (this.t > 2.3) { this.cd = 0.5; this.setState('stalk'); }
        break;
    }
    this.vel.x = damp(this.vel.x, wv.x, 5, dt); this.vel.z = damp(this.vel.z, wv.z, 5, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; W.collide(this, 1.3);
    this.pos.y = W.heightAt(this.pos.x, this.pos.z);
  }
  snap() { return [...this.baseSnap(), +this.wind.toFixed(2), +this.reachLen.toFixed(1), this.untouchable ? 1 : 0, this.tele.snap()]; }
  applySnap(s, dt, W) {
    const p0 = this.pos.clone(); super.applySnap(s, dt); this.netPos = new THREE.Vector3(s[1], s[2], s[3]); this.pos.copy(p0.distanceTo(this.netPos) > 8 ? this.netPos : p0);
    this.wind = s[11] || 0.8; this.reachLen = s[12] || 9; this.untouchable = !!s[13]; this.tele.apply(s[14]);
    if (W) this.world = W;
  }
  teleFx(T, fx, world) {
    if (!fx || T.fxk !== 2 && T.fxk !== 1) return;
    const g = (x, z) => new THREE.Vector3(x, world ? world.heightAt(x, z) : 0, z);
    if (T.fxk === 1) { fx.dust(g(T.x, T.z), 12, [0.22, 0.2, 0.17]); return; }
    // fire out of the ground: a column where a pillar burns, a ring of it round him when he strikes the earth
    if (T.a < 3) { const p = g(T.x, T.z); fx.explosion(p, 2.4, [1, 0.42, 0.1]); fx.flash(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff6020, 22, 0.4, 10); }
    else { const n = Math.round(T.a * 2.2); for (let i = 0; i < n; i++) { const a = i / n * TAU; fx.explosion(g(T.x + Math.sin(a) * T.a * 0.85, T.z + Math.cos(a) * T.a * 0.85), 1.6, [1, 0.4, 0.08]); } fx.flash(g(T.x, T.z).add(new THREE.Vector3(0, 2, 0)), 0xff5018, 40, 0.5, 18); }
  }
  // ---------------------------------------------------------------- his body (every client)
  animate(dt, time, fx) {
    const W = this.world, B = this.B, st = this.state, T = this.t, U = this.mat.userData.u;
    this.tele.update(dt, W, fx);
    if (this.netPos) { const k = 1 - Math.exp(-10 * dt); this.pos.lerp(this.netPos, k); }
    if (this.netPos) this.t += dt;   // (a client: the host's clock only arrives fifteen times a second)
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (U.uTime) U.uTime.value = time; tickRobes(time);
    // coming and going in smoke and embers; and when he burns, the fire eating holes in him
    let dis = 0;
    if (st === 'intro') dis = 1 - smooth(clamp((T - 0.3) / 2.2, 0, 1));
    else if (st === 'vanish') dis = smooth(clamp(T / 0.7, 0, 1));
    else if (st === 'appear') dis = 1 - smooth(clamp(T / 0.36, 0, 1));
    else if (st === 'death') { this.deathT += dt; dis = clamp((this.deathT - 1.8) / 3, 0, 1); }
    if (this.phase >= 3 && dis < 0.035) dis = 0.035 + 0.015 * Math.sin(time * 5.3);
    U.uDissolve.value = dis * 0.985; this.mesh.visible = dis < 0.97;
    if (fx && this.mesh.visible && ((dis > 0.04 && dis < 0.96) || this.phase >= 3 || this.hitFlash > 0.9) && R() < dt * (this.phase >= 3 ? 12 : 20)) fx.wisp(this._v.set(this.pos.x + (R() - 0.5) * 2.2, this.pos.y + R() * 4.6, this.pos.z + (R() - 0.5) * 2.2), 1.5);
    // where he stands: on the lowest ground under the hem
    this.mesh.position.set(this.pos.x, footGround(W, this.pos.x, this.pos.z, 1.2, this.pos.y), this.pos.z); this.mesh.rotation.y = this.yaw;
    // ---- the pose (degrees; +x bends forward, +y turns to his left; limbs: -x swings forward)
    const sp = Math.hypot(this.vel.x, this.vel.z); this.spV = damp(this.spV, st === 'stalk' ? sp : 0, 6, dt);
    const run = clamp(this.spV / 3.5, 0, 1); this.ph += dt * this.spV / (1.15 * DS) * Math.PI;
    const ph = this.ph, sw = Math.sin(ph), breath = Math.sin(time * 0.9) * 2;
    // the head: a slow, wrong tilt that snaps to a new angle now and then
    this.tiltT -= dt; if (this.tiltT <= 0) { this.tiltT = 0.8 + R() * 2.2; this.tiltTo = (R() - 0.5) * 50; this.snapTilt = R() < 0.5; }
    this.tilt = damp(this.tilt, this.tiltTo || 0, this.snapTilt ? 14 : 1.4, dt);
    const Q = {
      hips: [0, 0, sw * 2 * run], spine: [12 + run * 6, -sw * 4 * run, 0], chest: [10 + breath, sw * 5 * run, 0], neck: [10, 0, this.tilt * 0.25], head: [-4, 0, this.tilt * 0.75], jaw: [0, 0, 0],
      clavR: [0, 0, 0], clavL: [0, 0, 0],
      uArmR: [-6 + sw * 14 * run, 0, -7], uArmL: [-6 - sw * 14 * run, 0, 7], fArmR: [-16, 0, 0], fArmL: [-16, 0, 0],
      handR: [-12 + Math.max(0, Math.sin(time * 2.1)) * 30, 0, 0], handL: [-12 + Math.max(0, Math.sin(time * 1.7 + 1)) * 30, 0, 0],
      thighR: [-sw * 26 * run, 0, -3], thighL: [sw * 26 * run, 0, 3], shinR: [4 + Math.max(0, Math.cos(ph)) * 42 * run, 0, 0], shinL: [4 + Math.max(0, -Math.cos(ph)) * 42 * run, 0, 0], footR: [0, 0, 0], footL: [0, 0, 0],
    };
    const mix = (b, v, w) => { const q = Q[b]; if (!q || w <= 0) return; q[0] += (v[0] - q[0]) * w; q[1] += (v[1] - q[1]) * w; q[2] += (v[2] - q[2]) * w; };
    let drop = 0, kneel = 0, ikHand = null, ikW = 0, ikBoth = 0;
    const wind = this.wind || 0.8;
    if (st === 'rake') {
      const up = smooth(clamp(T / wind, 0, 1)), sk = smooth(clamp((T - wind) / 0.22, 0, 1)), w = up * (1 - smooth(clamp((T - wind - 0.4) / 0.35, 0, 1)));
      if (this.atk === 2) {
        for (const [k, m] of [['R', 1], ['L', -1]]) { mix('uArm' + k, [lerp(-172, -62, sk), 0, -m * lerp(22, 6, sk)], w); mix('fArm' + k, [lerp(-30, -8, sk), 0, 0], w); mix('hand' + k, [lerp(-20, 30, sk), 0, 0], w); }
        mix('spine', [lerp(-12, 42, sk), 0, 0], w); mix('chest', [lerp(-12, 26, sk), 0, 0], w); mix('neck', [lerp(-20, 10, sk), 0, 0], w); mix('head', [lerp(-25, 5, sk), 0, 0], w); drop = 0.14 * sk * w;
      } else {
        const k = this.atk === 1 ? 'L' : 'R', m = this.atk === 1 ? -1 : 1;   // m: +1 for the right arm (on his -x side)
        mix('uArm' + k, [lerp(-150, -38, sk), lerp(0, 58 * m, sk), lerp(-46 * m, -10 * m, sk)], w); mix('fArm' + k, [lerp(-42, -8, sk), 0, 0], w); mix('hand' + k, [lerp(-30, 25, sk), 0, 0], w);
        mix('chest', [lerp(-6, 22, sk), lerp(-26 * m, 32 * m, sk), 0], w); mix('spine', [lerp(-8, 26, sk), lerp(-10 * m, 14 * m, sk), 0], w); mix('head', [lerp(-12, 6, sk), lerp(-10 * m, 20 * m, sk), 0], w);
        drop = 0.06 * sk * w;
      }
    } else if (st === 'grasp') {
      const up = smooth(clamp(T / wind, 0, 1)), rk = smooth(clamp((T - wind) / 0.3, 0, 1)), rise = smooth(clamp((T - wind - 0.32 - (this.phase >= 3 ? 1.0 : 1.45) + 0.5) / 0.5, 0, 1)), w = (1 - rise);
      mix('spine', [lerp(-10 * up, 44, rk), 0, 0], w); mix('chest', [lerp(-6 * up, 22, rk), lerp(-12 * up, 0, rk), 0], w); mix('neck', [lerp(-8, 14, rk), 0, 0], w); mix('head', [lerp(-14, -10, rk), 0, 0], w);
      mix('uArmR', [lerp(38, -70, rk), 0, lerp(-24, -10, rk)], w); mix('fArmR', [lerp(-70, -10, rk), 0, 0], w); mix('handR', [lerp(-30, 20, rk), 0, 0], w);
      mix('uArmL', [lerp(-6, -40, rk), 0, 30], w * 0.8); mix('fArmL', [-30, 0, 0], w * 0.8);
      mix('thighR', [-30, 0, -3], rk * w); mix('thighL', [18, 0, 3], rk * w);
      drop = 0.16 * rk * w; ikHand = 'R'; ikW = rk * w;
    } else if (st === 'stomp') {
      const up = smooth(clamp(T / wind, 0, 1)), sl = smooth(clamp((T - wind) / 0.16, 0, 1)), rise = smooth(clamp((T - wind - 1.1) / 0.45, 0, 1)), w = up * (1 - rise);
      for (const [k, m] of [['R', 1], ['L', -1]]) { mix('uArm' + k, [lerp(-160, -55, sl), 0, -m * lerp(38, 18, sl)], w); mix('fArm' + k, [lerp(-25, -10, sl), 0, 0], w); }
      mix('spine', [lerp(-14, 52, sl), 0, 0], w); mix('chest', [lerp(-12, 22, sl), 0, 0], w); mix('neck', [lerp(-18, 12, sl), 0, 0], w); mix('head', [lerp(-28, -12, sl), 0, 0], w);
      drop = 0.24 * sl * w; ikBoth = sl * w;
    } else if (st === 'vanish' || st === 'appear') {
      if (st === 'vanish') { const w = smooth(clamp(T / 0.6, 0, 1)); mix('neck', [30, 0, 0], w); mix('head', [25, 0, 20], w); mix('spine', [20, 0, 0], w); for (const [k, m] of [['R', 1], ['L', -1]]) mix('uArm' + k, [-40, 30 * m, -20 * m], w); }
      else { const sk = smooth(clamp((T - 0.22) / 0.22, 0, 1)), w = 1 - smooth(clamp((T - 0.7) / 0.4, 0, 1)); for (const [k, m] of [['R', 1], ['L', -1]]) { mix('uArm' + k, [lerp(30, -150, sk), 0, -m * lerp(30, 40, sk)], w); mix('fArm' + k, [lerp(-60, -15, sk), 0, 0], w); } mix('spine', [lerp(30, -10, sk), 0, 0], w); mix('head', [lerp(10, -25, sk), 0, 0], w); }
    } else if (st === 'legion') {
      const w = smooth(clamp(T / 0.7, 0, 1)) * (1 - smooth(clamp((T - 2.1) / 0.5, 0, 1)));
      mix('uArmR', [-155 + Math.sin(time * 0.9) * 6, 0, -28], w); mix('uArmL', [-155 + Math.cos(time * 0.9) * 6, 0, 28], w); mix('fArmR', [-8, 0, 0], w); mix('fArmL', [-8, 0, 0], w); mix('handR', [12, 0, 0], w); mix('handL', [12, 0, 0], w);
      mix('spine', [-6, 0, 0], w); mix('chest', [-10, 0, 0], w); mix('head', [-22, 0, this.tilt * 0.3], w);
    } else if (st === 'pillars') {
      const w = smooth(clamp(T / 0.4, 0, 1)) * (1 - smooth(clamp((T - 2.2) / 0.5, 0, 1)));
      mix('uArmR', [-92, 0, -4], w); mix('fArmR', [-4, 0, 0], w); mix('handR', [10, 0, 0], w); mix('uArmL', [-128, 0, 34], w); mix('fArmL', [-30, 0, 0], w); mix('head', [2, 0, 0], w); mix('chest', [4, 12, 0], w);
    } else if (st === 'scream') {
      const h = smooth(clamp(T / wind, 0, 1)), rl = smooth(clamp((T - wind) / 0.18, 0, 1)), w = 1 - smooth(clamp((T - wind - 1.5) / 0.6, 0, 1));
      mix('spine', [lerp(26 * h, -14, rl), 0, 0], w); mix('chest', [lerp(16 * h, -22, rl), 0, 0], w); mix('neck', [lerp(10, -16, rl), 0, 0], w); mix('head', [lerp(18 * h, -38, rl), 0, Math.sin(time * 40) * 6 * rl], w);
      for (const [k, m] of [['R', 1], ['L', -1]]) { mix('uArm' + k, [lerp(-40 * h, 18, rl), lerp(38 * m * h, 0, rl), lerp(0, -86 * m, rl)], w); mix('fArm' + k, [lerp(-90 * h, -6, rl), 0, 0], w); mix('hand' + k, [lerp(0, 35, rl), 0, 0], w); }
    } else if (st === 'stagger' || st === 'death') {
      const t2 = st === 'death' ? this.deathT : T, w = smooth(clamp(t2 / 0.4, 0, 1)) * (st === 'death' ? 1 : 1 - smooth(clamp((t2 - 1.9) / 0.45, 0, 1)));
      const fall = st === 'death' ? smooth(clamp((t2 - 1.0) / 1.2, 0, 1)) : 0;
      mix('spine', [50 + fall * 25, 0, 6], w); mix('chest', [30, 0, 0], w); mix('neck', [20, 0, 10], w); mix('head', [24, 0, 18], w);
      for (const [k, m] of [['R', 1], ['L', -1]]) { mix('uArm' + k, [-40 - fall * 40, 0, -m * 10], w); mix('fArm' + k, [-20, 0, 0], w); mix('hand' + k, [20, 0, 0], w); }
      drop = 0.36 * w; kneel = w;
    } else if (st === 'intro') {
      const r = smooth(clamp((T - 2.0) / 1.6, 0, 1));
      mix('neck', [lerp(30, 6, r), 0, 0], 1); mix('head', [lerp(30, -14, r), 0, lerp(25, 8, r)], 1); mix('spine', [lerp(20, 8, r), 0, 0], 1);
      for (const [k, m] of [['R', 1], ['L', -1]]) mix('uArm' + k, [-10, 0, -m * lerp(4, 36, r)], 1);
    }
    for (const b in Q) if (B[b]) e(B[b], Q[b][0], Q[b][1], Q[b][2]);
    if (B.hips.userData.rest) { B.hips.position.copy(B.hips.userData.rest); B.hips.position.y += Math.abs(Math.sin(ph)) * 0.025 * run - drop; }
    this.mesh.updateMatrixWorld(true);
    // the arms put down on the ground, and the feet kept planted, by solving each limb
    const fw = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), V3 = THREE.Vector3;
    const toW = (x, y, z) => this.mesh.localToWorld(new V3(x, y, z));
    if (ikHand && ikW > 0.01) {
      const h = B['hand' + ikHand].getWorldPosition(new V3()), g = toW(-0.22, 0.12, 1.85);
      ik2(B.uArmR, B.fArmR, B.handR, h.lerp(g, ikW), new V3(0, -1, 0).addScaledVector(fw, -0.6));
    }
    if (ikBoth > 0.01) for (const [k, sx] of [['R', -1], ['L', 1]]) { const h = B['hand' + k].getWorldPosition(new V3()), g = toW(sx * 0.55, 0.1, 1.05); ik2(B['uArm' + k], B['fArm' + k], B['hand' + k], h.lerp(g, ikBoth), new V3(0, -0.5, 0).addScaledVector(fw, -1)); }
    if (drop > 0.005) {
      for (const k of ['R', 'L']) {
        const a = this.ankle[k]; let tgt = toW(a.x, a.y, a.z);
        if (kneel > 0) tgt = k === 'R' ? toW(a.x, a.y, a.z + 0.22 * kneel) : toW(a.x, a.y, a.z - 0.5 * kneel);
        ik2(B['thigh' + k], B['shin' + k], B['foot' + k], tgt, fw.clone().addScaledVector(new V3(0, 1, 0), 0.2));
        B['shin' + k].getWorldQuaternion(_q1); this.mesh.getWorldQuaternion(_q2); B['foot' + k].quaternion.copy(_q1.invert().multiply(_q2)); B['foot' + k].updateMatrixWorld(true);
      }
    }
    plantRobe(B, this.mesh, 0.07);
    // what a blade can find (bowed over on one knee, the head comes down within reach)
    this.headSphere.r = (st === 'stagger' ? 0.3 : 0.17) * DS; this.headSphere.mul = st === 'stagger' ? 2.0 : 1.7;
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
    const { body, wings } = buildDragonModel(); this.mat = dragonHideMaterial(); this.wingMat = dragonWingMaterial();
    const { mesh, B } = instantiate(body, this.mat); this.mesh = mesh; this.B = B;
    const wm = new THREE.SkinnedMesh(wings.geo, this.wingMat); wm.castShadow = true; wm.frustumCulled = false; mesh.add(wm); wm.updateMatrixWorld(true); wm.bind(mesh.skeleton, wm.matrixWorld); this.wingMesh = wm;
    scene.add(mesh); mesh.scale.setScalar(1.35); mesh.receiveShadow = true;
    B.head.add(dragonEyes());
    this.sun = scene.children.find((o) => o.isDirectionalLight && o.castShadow);
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
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4); this.mat.userData.u.uHit.value = this.hitFlash * 0.5; this.wingMat.userData.u.uHit.value = this.hitFlash * 0.3;
    const B = this.B, st = this.state, T = this.t;
    // the heat in his throat builds as he draws breath, and burns while he breathes fire
    const heat = st === 'breath' ? (T < 1 ? smooth(T) : this.breath ? 1 : 0.3) : this.breath ? 1 : 0;
    this.mat.userData.u.uBreath.value = damp(this.mat.userData.u.uBreath.value, heat, 4, dt);
    if (this.sun) this.wingMat.userData.u.uLightDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
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
      // at rest the wing folds like a bat's: the arm swept back and raised along the flank, the forearm folded
      // forward against it, the hand and its long fingers folded back again, closed together, the membrane furled
      const sweep = lerp(72, 0, spread), raise = lerp(22, 0, spread), fold2 = lerp(162, 8, spread), fold3 = lerp(158, 0, spread), finger = lerp(62, 0, spread);
      const beat = fl * 38 * spread;
      e(B['wing1' + k], 0, s * sweep, s * raise + s * beat);
      e(B['wing2' + k], 0, -s * fold2, s * beat * 0.4 - s * raise * 0.5);
      e(B['wing3' + k], 0, s * fold3, 0);
      e(B['f1' + k], 0, s * finger, s * beat * 0.2); e(B['f2' + k], 0, s * finger * 0.6, s * beat * 0.25); e(B['f3' + k], 0, s * finger * 0.05, s * beat * 0.3);
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
