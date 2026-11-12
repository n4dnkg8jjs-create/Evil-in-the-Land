// The Devil and his shapes.
//  Watcher  — a tall horned figure with huge unblinking eyes whose head turns
//             far past where a neck should allow; he watches from the hills.
//  Crevice  — eyes and long fingers in the mountain clefts.
//  Hound, Serpent, Cryptid — mini-boss shapes. Dragon — the final form.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTemplate, instantiate, limb, blob, cone, horn, place, lumpyG, demonMaterial } from './demons.js';
import { scaleTextures, demonTextures } from './textures.js';
import { buildHorror, buildHumanDevil, tickRobes, plantRobe, guardArms, dissolvable } from './horror.js';
import { JI } from './rig.js';
import { buildDragonModel, DragonFire, DRAGON_FINGERS } from './dragon_model.js';
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
      this.tilt = R() < 0.3 ? (R() < 0.5 ? -1 : 1) * (0.72 + R() * 0.22) : (R() - 0.5) * 0.35;   // (no further: past this a horn would come down into his shoulder)
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
    guardArms(B);   // and his hands kept out of his robe and hood
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
      ik2(u, l, end, T, pole); if (isArm) (this._cT ||= new Map()).set(u, T);
    };
    limb(B.uArmR, B.fArmR, B.handR, 0, 0, 0.45, 0.75, true); limb(B.uArmL, B.fArmL, B.handL, 0, Math.PI, 0.45, 0.75, true);
    limb(B.thighR, B.shinR, B.footR, 0, Math.PI, -0.3, 0.7, false); limb(B.thighL, B.shinL, B.footL, 0, 0, -0.3, 0.7, false);
    // the arms go up past his head to the rock: where a forearm would pass through a horn or the hood, the elbow is
    // swung clear (guardArms), and the hand put back on the rock with the elbow kept on that side
    guardArms(B);
    for (const [u, l, end] of [[B.uArmR, B.fArmR, B.handR], [B.uArmL, B.fArmL, B.handL]]) { const T = this._cT.get(u), a = u.getWorldPosition(new V3()); ik2(u, l, end, T, l.getWorldPosition(new V3()).sub(a)); }
    guardArms(B);
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
// (q: the point in the mark's own frame, in metres: along and across a lane; or from the centre, +y along the yaw. The
// shape is cut out here, per pixel, because the mesh under it is a patch of the ground's own grid: see groundPatch.)
const TELE_VS = 'attribute vec2 q; varying vec2 vL; void main() { vL = q; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const TELE_FS = `varying vec2 vL; uniform vec3 uCol; uniform float uProg, uFade, uTime, uShape, uA, uB, uW;
void main() {
  vec2 vQ;
  if (abs(uShape - 1.0) < 0.5) { vQ = vec2(vL.x / uA, vL.y / max(0.001, uB * 0.5)); if (vQ.x < 0.0 || vQ.x > 1.0 || abs(vQ.y) > 1.0) discard; }
  else { float th = atan(vL.x, vL.y); vQ = vec2(length(vL) / uA, th / (abs(uShape - 2.0) < 0.5 ? max(0.001, uB) : 3.14159265)); if (vQ.x > 1.0 || abs(vQ.y) > 1.0) discard; }
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
// A patch of the ground's own grid over a box: its corners are the very points the ground is drawn through, and each
// square is cut along the same diagonal (world.js: 257 x 257 heights over 300 m, as heightAt reads them), so anything
// drawn on it lies flat on the ground: on the rough summit a mark sampled on its own grid stood up to a metre off it.
// attr(x, z) is called for each point, in order. Appends to pos and idx.
const GROUND_HALF = 150;
function groundPatch(world, x0, z0, x1, z1, lift, pos, idx, attr) {
  const n = world?.H ? Math.round(Math.sqrt(world.H.length)) : 257, cell = GROUND_HALF * 2 / (n - 1), H = (x, z) => (world ? world.heightAt(x, z) : 0);
  const i0 = clamp(Math.floor((x0 + GROUND_HALF) / cell), 0, n - 2), i1 = clamp(Math.ceil((x1 + GROUND_HALF) / cell), i0 + 1, n - 1);
  const j0 = clamp(Math.floor((z0 + GROUND_HALF) / cell), 0, n - 2), j1 = clamp(Math.ceil((z1 + GROUND_HALF) / cell), j0 + 1, n - 1);
  const base = pos.length / 3, ni = i1 - i0 + 1;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = -GROUND_HALF + i * cell, z = -GROUND_HALF + j * cell; pos.push(x, H(x, z) + lift, z); attr(x, z); }
  for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < ni - 1; i++) { const a = base + j * ni + i, b = a + 1, c = a + ni, d = c + 1; idx.push(a, c, b, d, b, c); }
  return (i1 - i0 + 1) * (j1 - j0 + 1);
}
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
  // a mesh laid on the ground: a patch of the ground's own grid under the shape (so it lies exactly on what is drawn,
  // never standing off it over a hollow nor sunk into a rise), the shape itself cut out of it in the shader
  build(T, world) {
    const pos = [], q = [], idx = [], fx = Math.sin(T.yaw), fz = Math.cos(T.yaw), line = T.shape === 'line', cone = T.shape === 'cone';
    let x0 = T.x - T.a, x1 = T.x + T.a, z0 = T.z - T.a, z1 = T.z + T.a;
    if (line) { const ex = [0, T.a].flatMap((al) => [-1, 1].map((sg) => [T.x + fx * al + fz * sg * T.b / 2, T.z + fz * al - fx * sg * T.b / 2])); x0 = Math.min(...ex.map((e) => e[0])); x1 = Math.max(...ex.map((e) => e[0])); z0 = Math.min(...ex.map((e) => e[1])); z1 = Math.max(...ex.map((e) => e[1])); }
    groundPatch(world, x0, z0, x1, z1, 0.04, pos, idx, (x, z) => {
      const dx = x - T.x, dz = z - T.z;
      if (line) q.push(dx * fx + dz * fz, dx * fz - dz * fx);
      else if (cone) q.push(dx * fz - dz * fx, dx * fx + dz * fz);
      else q.push(dx, dz);
    });
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
import { instantiateHound, houndMaterial, HOUND_PAW_Y } from './hound_model.js';   // (imports are hoisted: kept here, beside the class that uses them)
// A hound the size of a horse, black, starved and mangy (the model is in hound_model.js). He hunts like a wolf, not
// like a bull: he circles just out of reach looking for the side of them, comes in to bite and is gone again, and
// what he bites is chosen: the one kneeling over a fallen brother, the wounded, the stray; not the raised guard (that
// he goes round, or seizes). Crowded, he whirls and breaks out; hurt, he goes off into the dark of the wood and comes
// back at a run from somewhere else. The host decides (simulate); every client stands him on his feet (animate): each
// paw stays where it was set down until its turn to step, so he never slides.
const HOUND_LEGS = [{ f: 1, s: 1, k: 'L', hx: 0.34, hz: 0.5 }, { f: 1, s: -1, k: 'R', hx: -0.34, hz: 0.5 }, { f: 0, s: 1, k: 'L', hx: 0.31, hz: -1.24 }, { f: 0, s: -1, k: 'R', hx: -0.31, hz: -1.24 }];
const HOUND_FORE = 0.55;   // his place in the world (pos) is the ground under his shoulders: this far ahead of the model's middle
const HOUND_TROT = [0, 0.5, 0.5, 0], HOUND_GALLOP = [0.56, 0.68, 0, 0.13];   // when each leg steps in the stride: FL FR BL BR
const HOUND_SNAP = { wind: [0.5, 0.36, 0.62, 0.42], dmg: [15, 12, 22, 19], kb: [4, 4, 9, 6] };   // first bite, second, the slow third, a bite from the flank
const _hv = new THREE.Vector3(), _hw = new THREE.Vector3(), _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq2w = new THREE.Vector3(), _he = new THREE.Euler(0, 0, 0, 'YXZ');

export class Hound extends Boss {
  constructor(scene, partySize) {
    super(scene, 'hound');
    this.name = 'The Black Hound'; this.title = 'Canis Niger';
    this.party = Math.max(1, partySize || 1);
    this.mat = houndMaterial(); const H = instantiateHound(this.mat); this.mesh = H.mesh; this.B = H.B; scene.add(this.mesh);
    this.maxHp = this.hp = Math.round(1400 * (1 + 0.6 * (this.party - 1)));
    this.maxPoise = this.poise = 240 * (1 + 0.3 * (this.party - 1));
    this.phases = [0.66, 0.33]; this.camH = 1.5; this.camD = 1.15; this.alt = 0;
    this.cds = { pounce: 2.5, whirl: 0, maul: 5, dark: 10, howl: 40 }; this.f = {}; this.side = 1; this.sideT = 2; this.combo = 0; this.threat = new Map(); this.hurtT = 0; this.stuck = 0;
    this.look = new THREE.Vector3(0, 0, 8); this.heat = 0;
    this.calm = clamp(1.5 - 0.12 * this.party, 1.0, 1.4);   // how long he waits between his goes: longer against one or two, shorter against a crowd
    this.legs = HOUND_LEGS.map(() => ({ p: new THREE.Vector3(), from: new THREE.Vector3(), sw: false, q: 0, qd: 0.13, lift: 0, init: false, fly: false }));
    this.A = { lx: 0, lz: 0, vx: 0, vz: 0, lyaw: 0, yr: 0, gph: 0, gmix: 0, settled: true, breath: 0, ex: 0, ly: 0, lp: 0, hip: 0, chest: 0, shift: 0, sway: 0, neckP: 0, headP: 0, jaw: 0.1, roll: 0, pitch: 0, tail: 0, ears: 0, low: 0, first: true };
    const B = this.B;
    this.spheres = [{ name: 'head', bone: B.head, off: [0, -0.03, 0.3], r: 0.5, mul: 1.4 }, { name: 'neck', bone: B.neck2, off: [0, 0, 0.1], r: 0.52, mul: 1.15 }, { name: 'chest', bone: B.chest, off: [0, -0.35, 0.05], r: 0.78, mul: 0.95 },
      { name: 'ribs', bone: B.ribs, off: [0, -0.3, 0.05], r: 0.72, mul: 0.95 }, { name: 'loin', bone: B.loin, off: [0, -0.15, 0.1], r: 0.58, mul: 0.95 }, { name: 'hips', bone: B.hips, off: [0, -0.15, -0.1], r: 0.64, mul: 0.95 }].map((s) => ({ ...s, c: new THREE.Vector3() }));
  }
  setState(s) { super.setState(s); this.f = {}; }
  begin(s, atk = 0) { this.atk = atk; this.setState(s); return true; }

  // ---------------------------------------------------------------- the hunt (host)
  // who is round him: how many within reach of his body, how many of those behind him, and where the party stands
  around(C) {
    let near = 0, behind = 0, cx = 0, cz = 0, n = 0;
    for (const k of C.knights) {
      if (k.downed) continue; cx += k.pos.x; cz += k.pos.z; n++;
      const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 4.0) { near++; if (Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) > 1.8) behind++; }
    }
    return { near, behind, cx: n ? cx / n : this.pos.x, cz: n ? cz / n : this.pos.z, n };
  }
  // whom to go for: the kneeling, the wounded, the stray, whoever is hurting him; not a raised guard, not a man already down
  chooseTarget(C, dt) {
    this.retarget -= dt;
    const cur = this.target, ok = cur && !cur.downed && C.knights.includes(cur);
    if (ok && this.retarget > 0) return cur;
    this.retarget = 0.5;
    let best = null, bs = 1e9;
    for (const k of C.knights) {
      if (k.downed) continue;
      let iso = 12; for (const o of C.knights) if (o !== k && !o.downed) iso = Math.min(iso, o.pos.distanceTo(k.pos));
      if (iso === 12) iso = 0;
      let s = k.pos.distanceTo(this.pos);
      if (k.praying || k.reviving) s -= 5;
      s -= (1 - clamp(k.hp / (k.maxHp || 150), 0, 1)) * 7 + Math.min(iso, 8) * 0.5 + Math.min(8, (this.threat.get(k) || 0) * 0.035);
      if (k.blocking) s += 5;
      if (k.isAI) s += 1.5;
      if (k.action && k.actKind === 'knockdown') s += 12;
      if (k === cur) s -= 3;
      if (s < bs) { bs = s; best = k; }
    }
    if (best !== cur) this.retarget = 1.6;
    return (this.target = best);
  }
  takeHit(dmg, dir, stagger, C) {
    if (C && dir && this.alive) {   // who struck: the knight this blow came from
      let best = null, bs = 0.4;
      for (const k of C.knights) { if (k.downed) continue; const dx = this.pos.x - k.pos.x, dz = this.pos.z - k.pos.z, l = Math.hypot(dx, dz); if (l > 9 || l < 1e-3) continue; const dot = (dx * dir.x + dz * dir.z) / l; if (dot > bs) { bs = dot; best = k; } }
      if (best) this.threat.set(best, (this.threat.get(best) || 0) + dmg);
    }
    this.hurtT += dmg;
    const worrying = this.state === 'worry', r = super.takeHit(dmg, dir, stagger, C);
    if (worrying && this.alive) this.wear(dmg * 1.3, C);   // hacked at with his jaws full, he lets go the sooner
    return r;
  }
  // the companions are not as quick on their feet as a player: his teeth go a little less deep in them
  hurt(C, k, dmg, from, opts) { super.hurt(C, k, dmg * (k && k.isAI ? 0.55 : 1), from, opts); }
  canReel() { return !['intro', 'reel', 'vanish', 'prowl'].includes(this.state) && !(this.state === 'leap' && this.alt > 0.05) && !(this.state === 'charge' && this.f.ph === 1); }
  onPoiseBreak(C) { this.interrupt(); this.prey = null; this.alt = 0; this.begin('reel'); C?.ev('bossSfx', this, 'scream'); }
  onPhase(n) { this.howlDue = true; if (n === 3) this.dmgScale = 1.15; this.cds.dark = Math.min(this.cds.dark, 3); }
  phaseLine(n) { return n === 2 ? 'The Hound calls to the dark' : 'The Black Hound is maddened'; }
  // free to act: what does the moment call for?
  decide(C, T, d, bear) {
    const P = this.phase, S = this.around(C), ang = Math.abs(angleDiff(this.yaw, bear));
    if (this.howlDue) { this.howlDue = false; return this.begin('howl'); }
    if (this.cds.whirl <= 0 && ((S.near >= 2 && S.behind >= 1) || S.near >= 3 || (S.behind >= 1 && ang > 1.5))) return this.begin('whirl');
    if (P >= 2 && this.cds.dark <= 0 && (S.near >= 2 || this.hurtT > this.maxHp * 0.05 || d > 15)) return this.begin('vanish');
    if (P >= 2 && this.cds.howl <= 0 && d > 6) return this.begin('howl');
    const soft = T.praying || T.reviving;
    if (d > 5.5 && d < 15.5 && this.cds.pounce <= 0 && ang < 1.2 && (soft || R() < 0.8)) return this.begin('pounce', P >= 2 && !soft && R() < 0.35 ? 1 : 0);
    if (d < 4.2 && ang < 1.1) {
      if (T.blocking) {   // a raised guard: break it if the arm is tired, else seize him or go round it
        if ((T.stamina ?? 100) < 24) return this.begin('strike');
        if (P >= 2 && this.cds.maul <= 0) return this.begin('maul');
        return this.begin('sidestep');
      }
      if (P >= 2 && this.cds.maul <= 0 && R() < 0.5) return this.begin('maul');
      return this.begin(R() < 0.25 ? 'sidestep' : 'strike');
    }
    return false;
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world, pos = this.pos; this.world = W;
    this.hurtT = Math.max(0, this.hurtT - dt * this.maxHp * 0.015);
    for (const [k, v] of this.threat) this.threat.set(k, v * Math.exp(-dt * 0.22));
    if (this.state === 'death') { this.alt = Math.max(0, this.alt - dt * 6); this.vel.multiplyScalar(Math.exp(-5 * dt)); pos.addScaledVector(this.vel, dt); W.collide(this, 1.0); pos.y = W.heightAt(pos.x, pos.z); return; }
    const T = this.chooseTarget(C, dt), want = _hw.set(0, 0, 0), cad = this.phase >= 3 ? 1.15 : 1; let acc = 7, flying = false;
    if (!T) { this.vel.multiplyScalar(Math.exp(-6 * dt)); this.alt = 0; if (!['stalk', 'intro'].includes(this.state)) this.begin('stalk'); pos.y = W.heightAt(pos.x, pos.z); return; }
    const dx = T.pos.x - pos.x, dz = T.pos.z - pos.z, d = Math.hypot(dx, dz), bear = Math.atan2(dx, dz);
    const face = (yaw, rate) => { this.yaw = dampAngle(this.yaw, yaw, rate, dt); };
    const fwd = (v) => want.set(Math.sin(this.yaw) * v, 0, Math.cos(this.yaw) * v);
    const go = (gx, gz, v, turn = 6) => { const mx = gx - pos.x, mz = gz - pos.z, ml = Math.hypot(mx, mz) || 1; want.set(mx / ml * v, 0, mz / ml * v); if (turn) face(Math.atan2(mx, mz), turn); return ml; };
    this.look.copy(this.prey && this.state === 'worry' ? this.prey.pos : T.pos);
    switch (this.state) {
      case 'intro':   // he comes out of the trees at a walk, and stops, and looks at them
        face(bear, 3); if (this.t < 1.6) fwd(1.8);
        if (this.t > 1.7 && !this.f.s) { this.f.s = 1; C.ev('bossSfx', this, 'snarl'); }
        if (this.t > 2.6) { this.cd = 0.5; const S = this.around(C); this.home = new THREE.Vector3(S.cx, 0, S.cz); this.begin('stalk'); }
        break;
      case 'stalk': {
        this.sideT -= dt; if (this.sideT <= 0) { this.sideT = 2 + R() * 3; if (R() < 0.5) this.side *= -1; }
        if (this.home && Math.hypot(pos.x - this.home.x, pos.z - this.home.z) > 24) {   // he keeps the fight on the ground it began on: round them by the side nearer to it
          const a0 = Math.atan2(-dx, -dz), near = (sg) => Math.hypot(T.pos.x + Math.sin(a0 + sg * 0.6) * 6.5 - this.home.x, T.pos.z + Math.cos(a0 + sg * 0.6) * 6.5 - this.home.z);
          this.side = near(1) < near(-1) ? 1 : -1;
        }
        if (this.cd <= 0 && this.t > 0.12 && this.decide(C, T, d, bear)) break;
        if (d > 15) { face(bear, 5); fwd(12.5); }                                   // far off: run them down
        else if (this.cd <= 0) { face(bear, 6.5); fwd(d > 3.1 ? 7.5 : 0); }         // ready: go in
        else {                                                                      // waiting: round them, just out of reach
          const Rr = this.phase >= 2 ? 7.5 : 6.5, a = Math.atan2(-dx, -dz) + this.side * 0.6, ml = go(T.pos.x + Math.sin(a) * Rr, T.pos.z + Math.cos(a) * Rr, 6.5, 0);
          const v = Math.min(6.5, ml * 3); want.multiplyScalar(v / 6.5); face(ml > 1.2 ? Math.atan2(want.x, want.z) + angleDiff(Math.atan2(want.x, want.z), bear) * 0.4 : bear, 5);
        }
        break;
      }
      case 'strike': {   // a bite: the head drawn back, then the lunge. He turns with them until he commits.
        const wind = HOUND_SNAP.wind[this.atk] / cad, commit = wind * 0.55;
        if (!this.f.s) { this.f.s = 1; if (this.atk !== 1) C.ev('bossSfx', this, 'snarl'); }
        if (this.t < commit) { face(bear, 10); if (d > 3.1) fwd(3.5); }
        else {
          if (!this.f.c) { this.f.c = 1; const dmg = HOUND_SNAP.dmg[this.atk], kb = HOUND_SNAP.kb[this.atk]; this.warn('cone', pos.x, pos.z, 4.2, 0.62, this.yaw, wind - commit + 0.03, 0, 0, (Tl) => this.hurtIn(C, Tl, dmg, this.pos.clone(), { knockback: kb, stagger: true }, 0.35)); }
          if (this.t < wind + 0.06) fwd(9.5);
        }
        if (this.t > wind + 0.34 / cad) {
          const more = this.phase >= 2 ? 2 : 1;
          if (this.atk < more && (this.atk === 0 || R() < 0.7)) {   // and again, at whoever is nearest now
            let n = null, nd = 5.8; for (const k of C.knights) { if (k.downed || (k.action && k.actKind === 'knockdown')) continue; const dd = k.pos.distanceTo(pos); if (dd < nd) { nd = dd; n = k; } }
            if (n) { this.target = n; this.retarget = 1; this.begin('strike', this.atk + 1); break; }
          }
          this.combo++; this.begin('recover', this.phase);
        }
        break;
      }
      case 'sidestep': {   // a bound round to the side their guard does not cover, and a bite from there
        if (!this.f.i) { this.f.i = 1; this.side = angleDiff(T.yaw ?? 0, Math.atan2(-dx, -dz)) >= 0 ? 1 : -1; }
        const phi = Math.atan2(-dx, -dz) + this.side * 0.9, rr = clamp(d, 2.8, 3.7);
        go(T.pos.x + Math.sin(phi) * rr, T.pos.z + Math.cos(phi) * rr, 13, 0); acc = 14; face(bear, 12);
        this.alt = Math.sin(Math.PI * clamp(this.t / 0.34, 0, 1)) * 0.3;
        if (this.t > 0.34) { this.alt = 0; this.begin('strike', 3); }
        break;
      }
      case 'pounce': {   // crouched, the eyes on one of them (sometimes he waits there); then he springs
        const crouch = (this.atk ? 0.95 : 0.5) / cad; face(bear, 9);
        if (!this.f.s) { this.f.s = 1; C.ev('bossSfx', this, 'growl'); }
        if (this.t >= crouch) {
          let tx = dx + clamp((T.vel?.x || 0) * 0.3, -2.5, 2.5), tz = dz + clamp((T.vel?.z || 0) * 0.3, -2.5, 2.5); const l = Math.hypot(tx, tz) || 1, dist = clamp(l - 1.3, 3.5, 15.5); tx *= dist / l; tz *= dist / l;
          const dur = clamp(0.34 + dist / 24, 0.45, 0.8);
          this.leap = { x0: pos.x, z0: pos.z, x1: pos.x + tx, z1: pos.z + tz, dur, h: 1.2 + dist * 0.09 };
          this.yaw = Math.atan2(tx, tz); this.cds.pounce = this.phase >= 3 ? 3.2 : 5; C.ev('bossSfx', this, 'snarl');
          this.warn('circle', this.leap.x1 + tx / dist * 0.5, this.leap.z1 + tz / dist * 0.5, 3.0, 0, 0, dur, 0, 1, (Tl) => { this.hurtIn(C, Tl, 25, this.pos.clone(), { knockdown: true }, 0.2); C.ev('slam', new THREE.Vector3(Tl.x, W.heightAt(Tl.x, Tl.z), Tl.z), 3); });
          this.begin('leap', Math.round(dur * 100));
        }
        break;
      }
      case 'leap': {
        const L = this.leap, u = L ? this.t / L.dur : 2;
        if (u < 1) { const nx = lerp(L.x0, L.x1, u), nz = lerp(L.z0, L.z1, u); this.vel.set((nx - pos.x) / dt, 0, (nz - pos.z) / dt); pos.x = nx; pos.z = nz; this.alt = Math.sin(Math.PI * u) * L.h; flying = true; }
        else {
          this.alt = 0; acc = 12;
          if (!L || this.t > L.dur + (this.phase >= 3 ? 0.25 : 0.35)) {
            this.leap = null; let n = null, nd = 5.2; for (const k of C.knights) { if (k.downed || (k.action && k.actKind === 'knockdown')) continue; const dd = k.pos.distanceTo(pos); if (dd < nd) { nd = dd; n = k; } }
            if (n && this.phase >= 2) { this.target = n; this.retarget = 1; this.begin('strike', 0); } else this.begin('recover', this.phase);
          }
        }
        break;
      }
      case 'maul': {   // he seizes one of them (no guard stops it), and worries him like a rat
        const wind = 0.5 / cad, commit = wind * 0.5;
        if (!this.f.s) { this.f.s = 1; C.ev('bossSfx', this, 'growl'); }
        if (this.t < commit) { face(bear, 9); if (d > 3.0) fwd(4); }
        else {
          if (!this.f.c) {
            this.f.c = 1; this.cds.maul = 12;
            this.warn('cone', pos.x, pos.z, 4.2, 0.5, this.yaw, wind - commit + 0.03, 2, 0, (Tl) => {
              let prey = null, bd = 1e9; for (const k of C.knights) if (!k.downed && !(k.action && k.actKind === 'knockdown') && inside(k, Tl, 0.3)) { const dd = k.pos.distanceTo(this.pos); if (dd < bd) { bd = dd; prey = k; } }
              if (prey) { this.hurt(C, prey, 21, this.pos.clone(), { unblockable: true, stagger: true }); this.prey = prey; this.begin('worry'); }
            });
          }
          if (this.t < wind + 0.06) fwd(9);
        }
        if (this.t > wind + 0.5) { this.cd = 0.8; this.begin('stalk'); }
        break;
      }
      case 'worry': {   // his jaws shut on a knight: he shakes him until he is beaten off, or the knight tears free
        const k = this.prey, kd = k ? Math.hypot(k.pos.x - pos.x, k.pos.z - pos.z) : 99;
        if (!k || k.downed || kd > 4.0) { this.prey = null; this.cd = 0.9; this.begin('stalk'); break; }
        face(Math.atan2(k.pos.x - pos.x, k.pos.z - pos.z), 9); if (kd > 2.6) fwd(5);
        const n = Math.floor(this.t / 0.3); if (n > (this.f.n || 0) && n <= 4) { this.f.n = n; this.hurt(C, k, 7, this.pos.clone(), {}); }
        if (this.t > 1.45) { this.hurt(C, k, 6, this.pos.clone(), { knockback: 8 }); this.prey = null; this.cd = 0.6; this.begin('backoff'); }
        break;
      }
      case 'whirl':   // crowded: he spins, the jaws going right round, and throws them off
        if (!this.f.c) { this.f.c = 1; this.cds.whirl = 7; C.ev('bossSfx', this, 'snarl'); this.warn('circle', pos.x - Math.sin(this.yaw) * HOUND_FORE, pos.z - Math.cos(this.yaw) * HOUND_FORE, 4.2, 0, 0, 0.55 / cad, 0, 0, (Tl) => this.hurtIn(C, Tl, 10, this.pos.clone(), { knockback: 11 }, 0.3)); }
        if (this.t > 0.55 / cad + 0.5) { this.cd = 0.3; this.begin(this.phase >= 2 || R() < 0.5 ? 'backoff' : 'stalk'); }
        break;
      case 'backoff': {   // a bound away and to one side
        if (!this.f.i) { this.f.i = 1; this.side = R() < 0.5 ? 1 : -1; if (this.home) { const a0 = Math.atan2(-dx, -dz), far = (sg) => Math.hypot(pos.x + Math.sin(a0 + sg * 0.7) * 5 - this.home.x, pos.z + Math.cos(a0 + sg * 0.7) * 5 - this.home.z); if (Math.max(far(1), far(-1)) > 20) this.side = far(1) < far(-1) ? 1 : -1; } }
        const a = Math.atan2(-dx, -dz) + this.side * 0.7; want.set(Math.sin(a) * 12, 0, Math.cos(a) * 12); acc = 12; face(bear, 8);
        this.alt = Math.sin(Math.PI * clamp(this.t / 0.45, 0, 1)) * 0.3;
        if (this.t > 0.45) { this.alt = 0; this.cd = Math.max(this.cd, 0.35); this.begin('stalk'); }
        break;
      }
      case 'vanish': {   // off into the dark between the trees
        if (!this.f.i) {
          this.f.i = 1; const S = this.around(C), a0 = Math.atan2(pos.x - S.cx, pos.z - S.cz), hc = W.heightAt(S.cx, S.cz); let p = null, bs = 1e9;
          for (let i = 0; i < 7; i++) {   // away from them, by whichever way the ground lies most level
            const a = a0 + (i - 3) * 0.45 + (R() - 0.5) * 0.3, q = { pos: new THREE.Vector3(S.cx + Math.sin(a) * 30, 0, S.cz + Math.cos(a) * 30) }; W.collide(q, 1.2);
            const sc = Math.abs(W.heightAt(q.pos.x, q.pos.z) - hc) + Math.abs(W.heightAt((q.pos.x + S.cx) / 2, (q.pos.z + S.cz) / 2) - hc) + Math.abs(i - 3) * 0.6 + R() + (this.home ? Math.max(0, Math.hypot(q.pos.x - this.home.x, q.pos.z - this.home.z) - 30) * 0.25 : 0); if (sc < bs) { bs = sc; p = q; }
          }
          this.goal = p.pos; this.cds.dark = this.phase >= 3 ? 15 : 24; this.chargeN = this.phase >= 3 ? 2 : 1; this.hurtT = 0; C.ev('bossSfx', this, 'growl');
        }
        const ml = go(this.goal.x, this.goal.z, 16, 7); acc = 9;
        if (ml < 3 || this.t > 2.6) this.begin('prowl');
        break;
      }
      case 'prowl': {   // out there, going round them, choosing
        if (!this.f.i) { this.f.i = 1; this.f.dur = 1 + R() * 1.8; this.side = R() < 0.5 ? 1 : -1; }
        const S = this.around(C), a = Math.atan2(pos.x - S.cx, pos.z - S.cz) + this.side * 0.35; go(S.cx + Math.sin(a) * 27, S.cz + Math.cos(a) * 27, 9, 5);
        if (this.t > this.f.dur) this.begin('charge');
        break;
      }
      case 'charge': {   // out of the dark at a dead run, straight through them
        const wind = (this.f.again ? 0.45 : 0.6) / cad, ph = this.f.ph || 0;
        if (ph === 0) {
          if (!this.f.s) { this.f.s = 1; C.ev('bossSfx', this, 'roar'); }
          if (!this.f.c) face(bear, 7);
          if (this.t >= wind - 0.45 && !this.f.c) {
            this.f.c = 1; this.f.yaw = Math.atan2(dx + clamp((T.vel?.x || 0) * 0.5, -3, 3), dz + clamp((T.vel?.z || 0) * 0.5, -3, 3)); this.f.len = clamp(d + 8, 14, 40);
            this.warn('line', pos.x, pos.z, this.f.len, 3.4, this.f.yaw, 0.45 + this.f.len / 21 * 0.5, 0, 0, null);
          }
          if (this.f.c) face(this.f.yaw, 16);
          if (this.t >= wind && this.f.c) { this.f.ph = 1; this.yaw = this.f.yaw; this.f.x0 = pos.x; this.f.z0 = pos.z; this.f.hit = new Set(); }
        } else if (ph === 1) {
          fwd(21); acc = 10;
          const hx = pos.x + Math.sin(this.yaw) * 1.4, hz = pos.z + Math.cos(this.yaw) * 1.4;
          for (const k of C.knights) { if (k.downed || this.f.hit.has(k)) continue; if (Math.min(Math.hypot(k.pos.x - pos.x, k.pos.z - pos.z), Math.hypot(k.pos.x - hx, k.pos.z - hz)) < 1.8) { this.f.hit.add(k); this.hurt(C, k, 24, this.pos.clone(), { knockdown: true, knockback: 9 }); } }
          if (Math.hypot(pos.x - this.f.x0, pos.z - this.f.z0) >= this.f.len - 1 || this.t > wind + this.f.len / 21 + 0.6 || (this.t > wind + 0.5 && this.vel.length() < 6)) { this.f.ph = 2; this.f.end = this.t; }
        } else {
          acc = 4.5;
          if (this.t > this.f.end + 0.4) { if (--this.chargeN > 0) { this.begin('charge'); this.f.again = 1; } else this.begin('recover', this.phase); }
        }
        break;
      }
      case 'recover':   // blown: he stands a moment, flanks heaving, before he moves off again (atk: the phase it began in)
        face(bear, 2.2); acc = 9;
        if (this.t > [0, 0.95, 0.75, 0.55][this.atk || 1]) { this.cd = ([0, 0.9, 0.6, 0.4][this.phase] + R() * [0, 0.9, 0.6, 0.5][this.phase]) * this.calm; const off = this.combo >= 2 && R() < 0.5; if (off) this.combo = 0; this.begin(off ? 'backoff' : 'stalk'); }
        break;
      case 'howl':   // head up: what answers him comes out of the ground
        if (this.t > 0.7 && !this.f.c) { this.f.c = 1; this.cds.howl = 45; C.ev('bossSfx', this, 'howl'); C.summonAround(pos, 'crawler', 1 + this.party + (this.phase >= 3 ? 1 : 0)); }
        if (this.t > 2.3) { this.cd = 0.3; this.begin(this.phase >= 2 && this.cds.dark <= 6 ? 'vanish' : 'stalk'); }
        break;
      case 'reel':   // his poise broken: he staggers, head down. Then he snaps round at whoever is still on him.
        acc = 5;
        if (this.t > 1.5) { if (this.around(C).near >= 1) { this.cds.whirl = 0; this.begin('whirl'); } else { this.cd = 0.3; this.begin('stalk'); } }
        break;
    }
    if (!flying) {
      this.vel.x = damp(this.vel.x, want.x, acc, dt); this.vel.z = damp(this.vel.z, want.z, acc, dt);
      const px = pos.x, pz = pos.z, py = W.heightAt(px, pz); pos.x += this.vel.x * dt; pos.z += this.vel.z * dt; W.collide(this, 1.0);
      { const mv = Math.hypot(pos.x - px, pos.z - pz); if (mv > 1e-4 && (W.heightAt(pos.x + (pos.x - px) / mv * 1.2, pos.z + (pos.z - pz) / mv * 1.2) - py) / (mv + 1.2) > 0.55) { pos.x = px; pos.z = pz; } }   // a bank too steep to fight on: he will not climb it
      if (!(this.state === 'charge' && this.f.ph === 1)) for (const k of C.knights) {   // he does not walk through them: his chest stops short of a standing knight
        if (k.downed) continue; const ex = pos.x - k.pos.x, ez = pos.z - k.pos.z, el = Math.hypot(ex, ez);
        if (el < 1.9 && el > 1e-3) { const push = (1.9 - el) * Math.min(1, 12 * dt); pos.x += ex / el * push; pos.z += ez / el * push; }
      }
      // held up by the trees: go the other way round; and if that fails, over
      const wl = want.length(), moved = Math.hypot(pos.x - px, pos.z - pz) / Math.max(dt, 1e-4);
      if (wl > 3 && moved < wl * 0.3 && this.vel.length() > wl * 0.5) { this.stuck += dt; if (this.stuck > 0.5) { this.side *= -1; this.sideT = 2; } if (this.stuck > 1.4 && ['stalk', 'prowl', 'vanish'].includes(this.state)) { this.stuck = 0; this.cds.pounce = 0; this.begin(this.state === 'stalk' ? 'pounce' : 'charge'); } }
      else this.stuck = Math.max(0, this.stuck - dt * 2);
    } else W.collide(this, 0.6);
    pos.y = W.heightAt(pos.x, pos.z);
  }
  snap() { return [...this.baseSnap(), +this.look.x.toFixed(1), +this.look.z.toFixed(1), this.tele.snap()]; }
  applySnap(s, dt, W) {
    if (s[5] === this.state && (s[8] !== this.atk || s[6] < this.t - 0.4)) this.t = s[6];   // the same move begun again
    if (s !== this._ls) {   // a new word from the host: how fast he was going between the last two
      if (this._ls && this._age > 0.02) { const a = this._age; this._sv = [clamp((s[1] - this._ls[1]) / a, -30, 30), clamp((s[3] - this._ls[3]) / a, -30, 30)]; }
      this._ls = s; this._age = 0;
    }
    this._age += dt;
    const px = this.pos.x, pz = this.pos.z;
    super.applySnap(s, dt); this.net = true; this.look.set(s[11], 0, s[12]); this.tele.apply(s[13]); if (W) this.world = W;
    // he runs fast: carry him on at that speed between the host's words instead of trailing a stride behind
    const v = this._sv || [0, 0], lead = Math.min(this._age, 0.15), tx = s[1] + v[0] * lead, tz = s[3] + v[1] * lead;
    if (Math.hypot(tx - px, tz - pz) < 8) { const k = 1 - Math.exp(-16 * dt); this.pos.x = px + (tx - px) * k; this.pos.z = pz + (tz - pz) * k; }
  }
  teleFx(T, fx, world) { if (fx && T.fxk === 1) { const p = new THREE.Vector3(T.x, world ? world.heightAt(T.x, T.z) : 0, T.z); fx.dust(p, 9, [0.2, 0.18, 0.15]); fx.dust(p.clone().add(new THREE.Vector3(0.8, 0, 0.5)), 5, [0.17, 0.15, 0.13]); } }

  // ---------------------------------------------------------------- the body (every client)
  animate(dt, time, fx) {
    const B = this.B, W = this.world, st = this.state, A = this.A, pos = this.pos, U = this.mat.userData.u, G = (x, z) => (W ? W.heightAt(x, z) : 0);
    if (this.net && st !== 'death') this.t += dt;   // a guest runs the clock on between the host's words
    const T = this.t, cad = this.phase >= 3 ? 1.15 : 1, idt = 1 / Math.max(dt, 1e-3);
    this.tele.update(dt, W, fx);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5); U.uHit.value = this.hitFlash * 0.4; U.uTime.value = time;
    this.heat = damp(this.heat, st === 'death' || this.phase < 3 ? 0 : 1, 0.8, dt); U.uHeat.value = this.heat * (0.5 + 0.12 * Math.sin(time * 2.3));   // maddened: a dull heat far down his throat and in the cuts, no more
    // how he is moving, from where he has been (the same on the host and on a guest)
    if (A.first) { A.first = false; A.lx = pos.x; A.lz = pos.z; A.lyaw = this.yaw; }
    let vx = (pos.x - A.lx) * idt, vz = (pos.z - A.lz) * idt; if (Math.hypot(vx, vz) > 45) vx = vz = 0;
    A.lx = pos.x; A.lz = pos.z; A.vx = damp(A.vx, vx, 14, dt); A.vz = damp(A.vz, vz, 14, dt);
    A.yr = damp(A.yr, clamp(angleDiff(A.lyaw, this.yaw) * idt, -12, 12), 10, dt); A.lyaw = this.yaw;
    const spd = Math.hypot(A.vx, A.vz), run = clamp((spd - 6) / 5, 0, 1), near = Math.hypot(this.look.x - pos.x, this.look.z - pos.z);
    // ---- the pose the moment asks for
    const lowK = (1 - run) * smooth(clamp((17 - near) / 6, 0, 1));
    let hip = -0.1 * lowK - 0.06 * run, chest = -0.3 * lowK - 0.12 * run, shift = 0, sway = 0, neckP = 0.62 * lowK + 0.38 * run, headP = 0, jaw = 0.1 + 0.14 * run, roll = 0, pitch = 0, lookW = 1, tail = run, ears = lowK, shake = 0, air = 0, airU = 0, spin = 0, hop = 0, snapJ = false, attack = 0;
    switch (st) {
      case 'intro': if (T > 1.6) { const w = smooth(clamp((T - 1.6) / 0.3, 0, 1)); chest = -0.36 * w - 0.2; hip = -0.1; neckP = 0.5; jaw = 0.1 + 0.4 * w; ears = 1; tail = 0.6; } break;
      case 'strike': case 'maul': {
        const wind = (st === 'maul' ? 0.5 : HOUND_SNAP.wind[this.atk]) / cad, c = wind * (st === 'maul' ? 0.5 : 0.55), big = st === 'maul' ? 1.25 : 1; attack = 1;
        if (T < c) { const w = smooth(T / c); chest = -0.3 * w; hip = -0.13 * w; shift = -0.32 * w; neckP = -0.12 * w; headP = -0.28 * w; jaw = 0.2 + 0.7 * w * big; }
        else if (T < wind + 0.05) { const w = smooth(clamp((T - c) / (wind - c), 0, 1)); chest = -0.3 - 0.12 * w; hip = -0.13; shift = lerp(-0.32, 0.6, w); neckP = lerp(-0.12, 0.32, w); headP = lerp(-0.28, -0.32, w); jaw = T < wind - 0.025 ? 0.92 * big : 0; snapJ = true; }
        else { const w = smooth(clamp((T - wind - 0.05) / 0.3, 0, 1)); chest = -0.42 * (1 - w); hip = -0.13 * (1 - w); shift = 0.6 * (1 - w); neckP = 0.32 * (1 - w); headP = -0.32 * (1 - w); jaw = 0.02 + 0.1 * w; shake = (1 - w) * 0.45; snapJ = w < 0.3; }
        ears = 1; tail = 0.6; break;
      }
      case 'recover': chest = -0.22; hip = -0.04; neckP = 0.55; headP = 0.1; jaw = 0.34; attack = 0.8; lookW = 0.6; tail = 0; ears = 0.4; break;
      case 'worry': attack = 1; chest = -0.28; hip = -0.05; neckP = 0.5; headP = 0.12; jaw = 0.26; shake = 1; shift = 0.3 + 0.1 * Math.sin(time * 14); ears = 1; tail = 0.8; break;
      case 'sidestep': case 'backoff': chest = -0.3; hip = -0.16; neckP = 0.45; jaw = 0.3; ears = 1; tail = 0.7; roll = -0.12 * this.side; break;
      case 'pounce': { const w = smooth(clamp(T / 0.3, 0, 1)); attack = 0.6; chest = -0.56 * w; hip = -0.4 * w; shift = -0.36 * w; neckP = 0.36 * w; headP = -0.05; jaw = 0.16; ears = 1; tail = 1; sway = Math.sin(time * 9) * 0.03 * w; break; }
      case 'leap': {
        const dur = Math.max(0.2, this.atk / 100), u = T / dur; attack = 1;
        if (u < 1) { air = 1; airU = u; pitch = lerp(-0.42, 0.36, smooth(u)); neckP = 0.25; jaw = 0.8; tail = 1; hip = 0; chest = 0; ears = 1; }
        else { const w = smooth(clamp((T - dur) / 0.36, 0, 1)); chest = -0.6 * (1 - w) - 0.2 * w; hip = -0.3 * (1 - w); neckP = 0.5; jaw = 0.35; ears = 1; }
        break;
      }
      case 'whirl': {
        const wind = 0.55 / cad, s0 = wind - 0.14, sp = clamp((T - s0) / 0.36, 0, 1); attack = 1;
        const w = smooth(clamp(T / s0, 0, 1)); chest = -0.34 * w; hip = -0.3 * w; neckP = 0.3; jaw = 0.3 + 0.55 * w; ears = 1; tail = 1;
        if (sp > 0 && sp < 1) { spin = smooth(sp) * TAU * (this.side || 1); hop = Math.sin(Math.PI * sp) * 0.4; air = 1; airU = 0.6; lookW = 0; snapJ = true; jaw = sp > 0.8 ? 0 : 0.9; }
        else if (sp >= 1) { const r = smooth(clamp((T - s0 - 0.36) / 0.3, 0, 1)); chest = -0.4 * (1 - r); hip = -0.2 * (1 - r); jaw = 0.15; }
        break;
      }
      case 'charge': if ((T < 0.6 / cad && spd < 8)) { const w = smooth(clamp(T / 0.3, 0, 1)); attack = 0.6; chest = -0.5 * w; hip = -0.3 * w; shift = -0.3 * w; neckP = 0.4 * w; jaw = 0.4; ears = 1; tail = 1; } else { attack = 1; jaw = 0.55 + 0.3 * smooth(clamp((8 - near) / 4, 0, 1)); ears = 1; } break;
      case 'howl': { const w = smooth(clamp(T / 0.6, 0, 1)) * (1 - smooth(clamp((T - 1.9) / 0.4, 0, 1))); hip = -0.4 * w; chest = 0.06 * w; neckP = -0.72 * w; headP = -0.62 * w; jaw = 0.1 + 0.5 * w * (0.85 + 0.15 * Math.sin(time * 11)); lookW = 1 - w; ears = 1; tail = 0.3; break; }
      case 'reel': { const w = Math.sin(Math.PI * clamp(T / 1.5, 0, 1)) ** 0.6; chest = -0.5 * w; hip = -0.16 * w; roll = 0.16 * Math.sin(T * 5.2) * w; sway = 0.22 * Math.sin(T * 4.1) * w; neckP = 0.62 * w; headP = 0.3 * w; jaw = 0.34; lookW = 1 - w; shake = 0.35 * w; ears = 1; break; }
      case 'death': { const k1 = smooth(clamp(this.deathT / 0.6, 0, 1)); chest = -0.85 * k1; hip = -0.3 * k1; neckP = 0.6 * k1; headP = 0.2 * k1; jaw = 0.4; lookW = 0; tail = 0; ears = 0; break; }
    }
    const k16 = 1 - Math.exp(-16 * dt);
    for (const [n, v] of [['hip', hip], ['chest', chest], ['shift', shift], ['sway', sway], ['neckP', neckP], ['headP', headP], ['roll', roll], ['pitch', pitch], ['tail', tail], ['ears', ears]]) A[n] += (v - A[n]) * k16;
    A.jaw = snapJ ? jaw : damp(A.jaw, jaw, 18, dt);
    // the lips drawn back off the fangs when he means it (quivering), the hackles up along his back; the eyes go dull as he dies
    const SN = { intro: T > 1.4 ? 1 : 0.3, strike: 1, maul: 1, worry: 1, recover: 0.5, sidestep: 0.9, backoff: 0.75, pounce: 1, leap: 0.85, whirl: 1, charge: 1, howl: 0, reel: 0.2, death: 0, vanish: 0.35, prowl: 0.7 }[st];
    const snarl = SN ?? (0.3 + 0.7 * smooth(clamp((12 - near) / 6, 0, 1))) * (1 - 0.5 * run), hk = st === 'death' ? 0 : st === 'howl' || attack > 0.5 ? 1 : 0.35 + 0.65 * smooth(clamp((15 - near) / 7, 0, 1));
    A.snarl = damp(A.snarl || 0, snarl, snarl > (A.snarl || 0) ? 9 : 3, dt); A.hack = damp(A.hack || 0, hk, hk > (A.hack || 0) ? 3 : 0.8, dt);
    U.uSnarl.value = A.snarl; U.uHackle.value = A.hack; U.uShine.value = st === 'death' ? Math.max(0, 1 - this.deathT * 1.5) : 1;
    const lift = (0.045 + 0.004 * Math.sin(time * 33) + 0.003 * Math.sin(time * 51.7)) * A.snarl;
    for (const [b, sd] of [[B.lipL, 1], [B.lipR, -1]]) { const r = b.userData.rest; b.position.set(r.x + sd * 0.01 * A.snarl, r.y + lift * (sd > 0 ? 1 : 0.9), r.z - 0.01 * A.snarl); }
    B.lipLo.position.y = B.lipLo.userData.rest.y - 0.014 * A.snarl;
    A.ex = damp(A.ex, clamp(spd / 9 + attack * 0.7, 0, 1), attack || spd > 3 ? 3 : 0.35, dt); A.breath += dt * (1.3 + 3.6 * A.ex) * TAU;
    // ---- the trunk
    const yawV = this.yaw + spin, sy = Math.sin(yawV), cy = Math.cos(yawV), gph = A.gph * TAU;
    const ox = pos.x - sy * HOUND_FORE, oz = pos.z - cy * HOUND_FORE;   // the model's middle
    this.mesh.position.set(ox, pos.y + (this.alt || 0) + hop, oz); this.mesh.rotation.y = yawV;
    const gF = G(ox + sy * 0.5, oz + cy * 0.5), gB = G(ox - sy * 1.24, oz - cy * 1.24), grounded = 1 - air, slope = Math.atan2(gF - gB, 1.74) * grounded;
    const bob = (1 - run) * 0.022 * Math.sin(gph * 2) * clamp(spd / 3, 0, 1) + run * 0.08 * Math.sin(gph + 2.2), flex = run * Math.sin(gph + 0.6), bend = clamp(A.yr * 0.09, -0.3, 0.3);
    const root = B.hips, rr = root.userData.rest;
    root.position.set(rr.x + A.sway, rr.y + A.hip + bob + (gB - pos.y) * grounded, rr.z + A.shift);
    root.rotation.set((A.hip - A.chest) / 1.6 - slope + A.pitch + run * 0.05 * Math.sin(gph + 1.2), 0, A.roll + clamp(-A.yr * spd * 0.012, -0.28, 0.28));
    // the head follows whoever he has marked
    const lx = this.look.x - pos.x, lz = this.look.z - pos.z;
    A.ly = damp(A.ly, clamp(angleDiff(yawV, Math.atan2(lx, lz)), -1.5, 1.5) * lookW, 8, dt); A.lp = damp(A.lp, clamp(0.5 / Math.max(1.5, near - 2), 0, 0.3) * lookW, 6, dt);
    const shk = A.shake = damp(A.shake || 0, shake, 14, dt), sh = shk * Math.sin(time * (st === 'reel' ? 9 : 44));
    B.loin.rotation.set(flex * 0.2, bend, 0); B.ribs.rotation.set(-flex * 0.1, bend * 0.8, 0); B.chest.rotation.set(-flex * 0.08, bend * 0.5 + A.ly * 0.1, 0);
    B.neck1.rotation.set(A.neckP * 0.55 + A.lp * 0.3, A.ly * 0.3, 0); B.neck2.rotation.set(A.neckP * 0.32 + A.lp * 0.3, A.ly * 0.3 + sh * 0.35, -A.ly * 0.1);
    B.head.rotation.set(A.headP - A.neckP * 0.5 + A.lp * 0.4, A.ly * 0.3 + sh * 0.55, sh * 0.45 - A.ly * 0.12 + 0.07 * lowK * Math.sin(time * 0.6));   // (stalking, the head cocked a little, now one way, now the other)
    const pant = Math.max(0, Math.sin(A.breath * 2)) * A.ex;
    B.jaw.rotation.x = A.jaw * 0.95 + pant * 0.07 * (A.jaw < 0.4 ? 1 : 0); B.tongue.rotation.x = 0.04 + pant * 0.12 + (st === 'death' ? 0.3 : 0);
    const br = 0.014 * (0.6 + A.ex) * Math.sin(A.breath); B.ribL.position.x = B.ribL.userData.rest.x + br; B.ribR.position.x = B.ribR.userData.rest.x - br;
    const fl = Math.max(0, Math.sin(time * 0.9 + 1.3) - 0.93) * 6;
    B.earL.rotation.set(-0.9 * A.ears + fl, 0, -0.3 * A.ears); B.earR.rotation.set(-0.9 * A.ears - fl * 0.5, 0, 0.3 * A.ears);   // pinned flat back
    const wag = (1 - A.tail) * 0.14;
    B.tail1.rotation.set(0.1 + A.tail * 0.75, -bend * 1.2 + Math.sin(time * 1.7) * wag, 0); B.tail2.rotation.set(A.tail * 0.3, -bend * 1.5 + Math.sin(time * 1.7 - 0.7) * wag * 1.4, 0);
    B.tail3.rotation.set(A.tail * 0.25 + flex * 0.15, -bend * 1.5 + Math.sin(time * 1.7 - 1.4) * wag * 1.6, 0); B.tail4.rotation.set(A.tail * 0.2, Math.sin(time * 1.7 - 2.1) * wag * 1.8, 0);
    // ---- the feet
    const stride = lerp(1.5, 4.2, clamp(spd / 15, 0, 1)), duty = lerp(0.6, 0.25, run), turn = Math.abs(A.yr) * 1.0;
    let adv = (spd + turn) / stride; if (spd < 0.5 && turn < 0.5) adv = A.settled ? 0 : 1.7;
    A.gph = (A.gph + adv * dt) % 1; A.gmix = damp(A.gmix, run > 0.45 ? 1 : 0, 7, dt);
    const lead = Math.min(0.66, duty * stride * 0.5) / Math.max(spd, 0.05), dK = st === 'death' ? smooth(clamp((this.deathT - 0.45) / 0.75, 0, 1)) : 0;
    let settled = true;
    for (let i = 0; i < 4; i++) {
      const L = this.legs[i], D = HOUND_LEGS[i], k = D.k, ph = (A.gph + lerp(HOUND_TROT[i], HOUND_GALLOP[i], A.gmix)) % 1, wide = D.hx * (1 + 0.3 * lowK + (st === 'pounce' || st === 'reel' ? 0.3 : 0));
      const hzl = D.hz + A.shift * 0.6, hx = ox + cy * wide + sy * hzl, hz = oz - sy * wide + cy * hzl, tx = hx + A.vx * lead, tz = hz + A.vz * lead;
      if (!L.init) { L.init = true; L.p.set(hx, G(hx, hz), hz); }
      if (Math.hypot(L.p.x - hx, L.p.z - hz) > 6) L.p.set(hx, G(hx, hz), hz);   // he has been put somewhere else
      if (air > 0.5) {   // off the ground: the legs go with the body, reaching for the landing
        _hv.set(D.hx * 0.8, D.f ? lerp(0.95, 0.3, airU) : lerp(0.5, 0.62, airU), D.f ? lerp(0.9, 1.5, airU) : lerp(-2.3, -1.25, airU)); this.mesh.localToWorld(_hv);
        L.p.lerp(_hv, 1 - Math.exp(-24 * dt)); L.sw = false; L.q = 0; L.fly = true; L.lift = D.f ? 0.5 * (1 - airU) : 0.7;
      } else {
        if (L.fly) { L.fly = false; L.q = L.qd = 0.09; L.from.copy(L.p); }
        if (L.q > 0) {   // a quick step to catch himself
          L.q -= dt; const e = 1 - clamp(L.q / L.qd, 0, 1); L.p.set(lerp(L.from.x, tx, e), lerp(L.from.y, G(tx, tz), e) + Math.sin(Math.PI * e) * 0.12, lerp(L.from.z, tz, e)); L.lift = Math.sin(Math.PI * e) * 0.5; if (L.q <= 0) L.sw = ph >= duty;
        } else if (ph >= duty) {   // its turn to step: lifted, carried to where it will be wanted, set down
          if (!L.sw) { L.sw = true; L.from.copy(L.p); }
          const u = (ph - duty) / (1 - duty), e = smooth(u);
          L.p.set(lerp(L.from.x, tx, e), lerp(L.from.y, G(tx, tz), e) + Math.sin(Math.PI * u) * lerp(0.13, 0.4, run) * (D.f ? 1 : 1.15), lerp(L.from.z, tz, e)); L.lift = Math.sin(Math.PI * u);
        } else {   // planted: it does not move
          if (L.sw) { L.sw = false; L.p.y = G(L.p.x, L.p.z); }
          L.lift = 0;
          if (Math.hypot(L.p.x - hx, L.p.z - hz) > 0.85 || L.far) { L.q = L.qd = 0.11; L.from.copy(L.p); L.far = false; }
        }
        if (L.sw || L.q > 0 || Math.hypot(L.p.x - hx, L.p.z - hz) > 0.35) settled = false;
      }
      if (dK >= 1) continue;
      // solve the leg to it: shoulder blade, then elbow or stifle, then the pastern down to the paw
      const up = D.f ? B['farm' + k] : B['bthigh' + k], lo = D.f ? B['ffore' + k] : B['bshin' + k], pa = D.f ? B['fpast' + k] : B['bmeta' + k], paw = D.f ? B['fpaw' + k] : B['bpaw' + k];
      const fz = (L.p.x - ox) * sy + (L.p.z - oz) * cy - D.hz;   // how far ahead of its place the paw is
      if (D.f) { const sc = B['fscap' + k]; sc.rotation.x = clamp(-fz * 0.4, -0.32, 0.32); sc.position.y = sc.userData.rest.y + 0.05 * (1 - L.lift) * (0.5 + lowK); }
      up.quaternion.identity(); lo.quaternion.identity(); pa.quaternion.identity(); (D.f ? B['fscap' + k] : root).updateMatrixWorld(true);
      const pl = D.f ? 0.2735 : 0.461, back = D.f ? 0.31 + 0.75 * L.lift : 0.22 + 0.7 * L.lift, il = 1 / Math.hypot(1, back);
      _hp.set(L.p.x, L.p.y + HOUND_PAW_Y, L.p.z);
      _hv.set(_hp.x - sy * back * il * pl, _hp.y + il * pl, _hp.z - cy * back * il * pl);
      if (L.lift === 0 && !L.fly && L.q <= 0 && up.getWorldPosition(_hq2w).distanceTo(_hv) > (D.f ? 1.03 : 1.31)) L.far = true;   // it has been left too far behind to stand on: step
      ik2(up, lo, pa, _hv, D.f ? new THREE.Vector3(-sy + cy * D.s * 0.15, 0.1, -cy - sy * D.s * 0.15) : new THREE.Vector3(sy, 0.25, cy));
      aimBone(pa, paw.getWorldPosition(new THREE.Vector3()).sub(pa.getWorldPosition(_hv)), _hp.clone().sub(_hv));
      pa.getWorldQuaternion(_hq); _hq2.setFromEuler(_he.set(L.lift * 0.9, yawV, 0)); paw.quaternion.copy(_hq.invert().multiply(_hq2));
      if (dK > 0) for (const [b, x, z] of [[up, D.f ? 0.5 : -0.25, D.s > 0 ? -0.5 : 0], [lo, D.f ? -0.5 : 0.55, 0], [pa, D.f ? 0.3 : -0.4, 0], [paw, 0.5, 0]]) { _hq.setFromEuler(_he.set(x, 0, z)); b.quaternion.slerp(_hq, dK); }
    }
    A.settled = settled;
    if (st === 'death') {   // down on his chest, then over on his side; and then he burns away like the rest of them
      this.deathT += dt;
      if (dK > 0) {
        root.rotation.z += 1.5 * dK; root.rotation.x *= 1 - dK; root.position.y = lerp(root.position.y, 0.53 + (G(ox, oz) - pos.y), dK); root.position.x = rr.x + 0.5 * dK;
        if (dK >= 1) for (let i = 0; i < 4; i++) { const D = HOUND_LEGS[i], k = D.k; for (const [n, x, z] of D.f ? [['farm', 0.5, D.s > 0 ? -0.5 : 0], ['ffore', -0.5, 0], ['fpast', 0.3, 0], ['fpaw', 0.5, 0]] : [['bthigh', -0.25, D.s > 0 ? -0.5 : 0], ['bshin', 0.55, 0], ['bmeta', -0.4, 0], ['bpaw', 0.5, 0]]) B[n + k].rotation.set(x, 0, z); }
        B.neck1.rotation.set(0.3, -0.15 * dK, 0.2 * dK); B.neck2.rotation.set(0.2, -0.15 * dK, 0.15 * dK); B.head.rotation.set(0.15, -0.1 * dK, 0.1 * dK);
      }
      U.uDissolve.value = clamp((this.deathT - 2.6) / 2.2, 0, 1);
    }
    // his breath smokes in the cold, every breath out of him; thicker when he has been running, and when he howls
    if (fx && st !== 'death') {
      A.steam = (A.steam || 0) - dt; const bs = Math.sin(A.breath);
      if (A.steam <= 0 && bs > 0.5 && (A.lastB ?? 1) <= 0.5) { A.steam = 0.15; B.head.updateWorldMatrix(true, false); const big = clamp(A.ex, 0.3, 1) + (st === 'howl' ? 0.5 : 0); fx.wisp(_hv.set(0, -0.03, 0.66).applyMatrix4(B.head.matrixWorld), 0.13 + 0.14 * big, [0.24, 0.24, 0.25]); if (big > 0.6 || A.jaw > 0.3) fx.wisp(_hv.set(0, -0.15, 0.5).applyMatrix4(B.head.matrixWorld), 0.12 + 0.1 * big, [0.22, 0.22, 0.23]); }
      A.lastB = bs;
    }
    this.spheres[0].mul = st === 'reel' ? 2 : 1.4;
    this.updateSpheres();
  }
}

// ================================================================ THE OLD SERPENT
import { buildSerpentHead, serpentSkin, SCALE_COLS, SCALE_ROWS_M, NECK } from './serpent_model.js';   // (imports are hoisted: kept here, beside the class that uses them)
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
// The hide (scales, belly plates, pattern, scars) is drawn by the skin shader in serpent_model.js.
export class Serpent extends Boss {
  constructor(scene, partySize) {
    super(scene, 'serpent');
    this.name = 'The Old Serpent'; this.title = 'Serpens Antiquus';
    this.party = Math.max(1, partySize || 1);
    this.maxHp = this.hp = Math.round(2600 * (1 + 0.55 * (this.party - 1)));
    this.maxPoise = this.poise = 340 * (1 + 0.25 * (this.party - 1));
    this.phases = [0.66, 0.33]; this.cad = 1 + 0.1 * (this.party - 1); this.cds = { coil: 10, brood: 3, rain: 0, sweep: 2, thrash: 0 }; this.chainN = 0; this.last = ''; this.f = {}; this.threat = new Map(); this.hurtT = 0; this.hood = 0;
    this.camH = 4.5; this.camD = 2.4;
    this.N = SN;
    const NG = SN + 24; this.gc = []; this.gd = new Float32Array(NG).fill(1); for (let i = 0; i < NG; i++) this.gc.push(new THREE.Vector3(0, 0, -i * SSP));
    this.vis = []; this.visD = new Float32Array(SN).fill(1); for (let i = 0; i < SN; i++) this.vis.push(new THREE.Vector3(0, -20, 0));
    this.chain = this.vis;
    this.mat = serpentSkin(false);   // the scales are drawn by the shader, along the body's own UVs
    // the body: rings round the path (two to each joint of the chain), closed at the neck and drawn to a point at the tail.
    // Its cross-section is a snake's: round over the back, the belly flat (the profile and its normals, once)
    const M = this.M = (SN - 1) * SSUB + 1, R2 = SRADIAL + 1, nV = M * R2 + 2;
    const uv = new Float32Array(nV * 2), idx = []; this.ringR = new Float32Array(M);
    const pf = (a) => { const ca = Math.cos(a), sa = Math.sin(a); return sa >= 0 ? [1.05 * ca, sa] : [1.05 * ca, -0.74 * Math.pow(-sa, 0.8)]; };
    this.prof = Array.from({ length: R2 }, (_, k) => { const a = k / SRADIAL * TAU, p = pf(a), p0 = pf(a - 1e-3), p1 = pf(a + 1e-3), nx = p1[1] - p0[1], ny = -(p1[0] - p0[0]), l = Math.hypot(nx, ny); return [p[0], p[1], nx / l, ny / l]; });
    let v = 0;
    for (let j = 0; j < M; j++) {
      const r = this.ringR[j] = serpentRad(j / SSUB) * lerp(NECK.r / (SRAD * 0.6), 1, smooth(clamp(j / 14, 0, 1)));   // the neck narrow behind the broad head
      if (j > 0) v += (SSP / SSUB) * SCALE_ROWS_M / Math.max(0.3, r / SRAD);   // scales shrink with the body, so they stay scale-shaped
      for (let k = 0; k <= SRADIAL; k++) { uv[(j * R2 + k) * 2] = k / SRADIAL * SCALE_COLS; uv[(j * R2 + k) * 2 + 1] = v; }
    }
    for (let j = 0; j < M - 1; j++) for (let k = 0; k < SRADIAL; k++) { const a = j * R2 + k, b = a + 1, c = a + R2, d = c + 1; idx.push(a, c, b, b, c, d); }
    const HC = M * R2, TT = HC + 1;
    for (let k = 0; k < SRADIAL; k++) { idx.push(HC, k, k + 1); const a = (M - 1) * R2 + k; idx.push(TT, a + 1, a); }
    uv[HC * 2] = 0.25 * SCALE_COLS; uv[HC * 2 + 1] = 0; uv[TT * 2] = 0.25 * SCALE_COLS; uv[TT * 2 + 1] = v;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nV * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
    this.geo = g; this.mesh = new THREE.Mesh(g, this.mat); this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; scene.add(this.mesh);
    const H = buildSerpentHead(); this.head = H.head; this.hparts = H.parts; this.hmat = H.parts.skin; scene.add(this.head);
    this.headPos = new THREE.Vector3(); this.headDir = new THREE.Vector3(0, 0, 1); this.rear = -4; this.burrowed = true; this.jawOpen = 0; this.jawVis = 0; this.pitch = 0; this.tongueT = 2; this.flick = -1;
    this.spheres = [];
    for (let i = 3; i < SN; i += 3) this.spheres.push({ name: 'body', i, r: serpentRad(i) + 0.3, mul: 0.7, c: new THREE.Vector3() });
    this.spheres.push({ name: 'head', i: -1, r: 1.45, mul: 1.8, c: new THREE.Vector3() });
    this.alt = 0; this.touch = new Map(); this.poolT = 0;
    // the venom where it lies: black pools on the ground (made now, so nothing is compiled when the first one falls)
    this.pools = []; const pm = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: 0.07, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (let n = 0; n < 22; n++) {
      const NS = 26, pos = new Float32Array((1 + 3 * NS) * 3), nr = new Float32Array((1 + 3 * NS) * 3), idx = []; for (let i = 1; i < nr.length; i += 3) nr[i] = 1;
      for (let k = 0; k < NS; k++) { const k1 = (k + 1) % NS; idx.push(0, 1 + k1, 1 + k); for (let r = 0; r < 2; r++) { const a0 = 1 + r * NS + k, a1 = 1 + r * NS + k1, b0 = a0 + NS, b1 = a1 + NS; idx.push(a0, a1, b0, a1, b1, b0); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); g.setIndex(idx);
      const m = new THREE.Mesh(g, pm); m.frustumCulled = false; m.receiveShadow = true; m.position.y = -999; m.userData.id = -1; scene.add(m); this.pools.push(m);
    }
  }
  setState(s) { super.setState(s); this.f = {}; }
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
  canReel() { return ['loom', 'spit', 'slither', 'thrash', 'brood', 'rain', 'strike', 'sweep'].includes(this.state) && !(this.state === 'strike' && this.aim && !this.f.down) && !(this.state === 'sweep' && this.t > 0.5 && !this.f.down); }
  onPoiseBreak(C) { this.interrupt(); this.chainN = 0; this.aim = null; this.coilC = null; this.setState('recoil'); C?.ev('bossSfx', this, 'scream'); }
  onPhase(n, C) {
    if (n === 2) { this.cds.brood = 0; this.cds.coil = 4; }
    if (n === 3) { this.cad *= 1.3; this.dmgScale = 1.15; this.cds.rain = 0; C?.ev('bossSfx', this, 'roar'); }
    if (['loom', 'slither', 'spit'].includes(this.state)) { this.setState(n === 2 ? 'brood' : 'rain'); }
  }
  // the companions are not as quick on their feet as a player: his blows fall a little lighter on them
  hurt(C, k, dmg, from, opts) { super.hurt(C, k, dmg * (k && k.isAI ? 0.45 : 1), from, opts); }
  takeHit(dmg, dir, stagger, C) {
    if (C && this.alive) {   // who struck: the knight nearest the part that was hit is close enough a guess
      let best = null, bd = 6; for (const k of C.knights) { if (k.downed) continue; for (let i = 0; i < SN; i += 4) { const dd = Math.hypot(k.pos.x - this.vis[i].x, k.pos.z - this.vis[i].z) - serpentRad(i); if (dd < bd) { bd = dd; best = k; } } }
      if (best) this.threat.set(best, (this.threat.get(best) || 0) + dmg);
    }
    this.hurtT += dmg;
    const r = super.takeHit(dmg, dir, stagger, C);
    if (this.alive && this.state === 'coil' && this.coilC && (this.coilC.hp -= dmg) <= 0) {   // hacked hard enough while he closes the ring, he lets it go
      this.interrupt(); this.coilC = null; this.cds.coil = 24; this.setState('recoil'); C?.ev('bossSfx', this, 'scream');
    }
    return r;
  }
  // whom he fixes on: the kneeling, the wounded, the stray, whoever is hurting him; not a raised guard
  chooseTarget(C, dt) {
    this.retarget -= dt;
    const cur = this.target, ok = cur && !cur.downed && C.knights.includes(cur);
    if (ok && this.retarget > 0) return cur;
    this.retarget = 0.6; let best = null, bs = 1e9;
    for (const k of C.knights) {
      if (k.downed) continue;
      let iso = 12; for (const o of C.knights) if (o !== k && !o.downed) iso = Math.min(iso, o.pos.distanceTo(k.pos)); if (iso === 12) iso = 0;
      let s = Math.hypot(k.pos.x - this.headPos.x, k.pos.z - this.headPos.z) * 0.8;
      if (k.praying || k.reviving) s -= 8;
      s -= (1 - clamp(k.hp / (k.maxHp || 150), 0, 1)) * 6 + Math.min(iso, 8) * 0.5 + Math.min(8, (this.threat.get(k) || 0) * 0.02);
      if (k.blocking) s += 4; if (k.isAI) s += 1.5; if (k === cur) s -= 3;
      if (s < bs) { bs = s; best = k; }
    }
    if (best !== cur) this.retarget = 2.2;
    return (this.target = best);
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
    this.warn('circle', to.x, to.z, 1.9, 0, 0, delay + T, 1, 3, () => this.warn('pool', to.x, to.z, 2.2, 0, 0, 5, 1, 0, null, true), true);
  }
  choose(C, T, d) {
    const P = this.phase, o = [], near = this.knightsNearBody(C), soft = T.praying || T.reviving;
    let crowd = 0; for (const k of C.knights) if (!k.downed && Math.hypot(k.pos.x - this.headPos.x, k.pos.z - this.headPos.z) < 9) crowd++;
    if (d < 13) o.push(['strike', soft ? 4.5 : 3.2]);
    if (this.cds.sweep <= 0 && crowd >= 1 && d < 9.5) o.push(['sweep', 1.2 + crowd * 1.3 + (T.blocking ? 1.2 : 0)]);   // crowded under his chin: the head goes through them like a scythe
    if (near.length && this.cds.thrash <= 0) o.push(['thrash', 2.6 + near.length * 0.8]);
    o.push(['spit', d > 10 ? 2.2 + (soft ? 2 : 0) : 0.6]);
    if (d > 14) o.push(['slither', 2.4]);
    o.push(['dive', d > 16 ? 2.2 : this.hurtT > this.maxHp * 0.05 ? 2.6 : 0.6]);   // hurt, he goes under, and comes up somewhere else
    if (P >= 2 && this.cds.coil <= 0) o.push(['coil', 1.8]);
    if (P >= 2 && this.cds.brood <= 0) o.push(['brood', 1.5]);
    if (P >= 3 && this.cds.rain <= 0) o.push(['rain', 2.2]);
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.35; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) return s; } return o[0][0];
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world; this.world = W;
    this.hurtT = Math.max(0, this.hurtT - dt * this.maxHp * 0.012); for (const [k, v] of this.threat) this.threat.set(k, v * Math.exp(-dt * 0.2));
    if (this.state === 'death') { this.rear = damp(this.rear, 0.2, 1.2, dt); this.jawOpen = 0.6; this.pitch = damp(this.pitch, 0.3, 2, dt); this.finish(W, dt); return; }
    const T = this.chooseTarget(C, dt), tp = T ? T.pos : this.headPos;
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
      case 'loom': // reared, swaying, the head turning to follow and looking down on whoever is near
        rearTo(6.6 + Math.sin(this.t * 1.6) * 0.35, 3); pitchTo(T ? clamp(0.85 - d * 0.045, 0.1, 0.5) : 0.12, 3); jaw(0.04); if (T) turn(want + Math.sin(this.t * 1.15) * 0.16, 2.4);
        if (T && d > 13) move(4.5); else if (T && d < 5) move(-3);   // he keeps them at the length of his strike
        if (T && this.t > 0.6 / cad && this.cd <= 0) { const s = this.choose(C, T, d); this.last = s; this.chainN = 0; this.setState(s); }
        break;
      case 'slither': { // down onto the ground and across it in great S-curves, the body sweeping after
        rearTo(1.0, 4); pitchTo(0.08); jaw(0);
        turn(want + Math.sin(this.t * 2.4) * 0.6, 3.2); move(11.5 * Math.sqrt(cad));
        if ((d < 9 && this.t > 1) || this.t > 5) { this.cd = 0.4; this.setState('loom'); }
        break;
      }
      case 'strike': { // drawn back and up, the hood spread, the head following them (for as long as he pleases); then the lane burns, and he comes down it
        const F = this.f; if (F.hold === undefined) { F.hold = (this.chainN ? 0.3 : 0.45 + R() * (this.phase >= 2 ? 0.75 : 0.35)) / cad; C.ev('bossSfx', this, 'hiss'); }
        const tele = (this.phase >= 2 ? 0.42 : 0.5) / Math.sqrt(cad), lunge = 0.24, rec = this.phase >= 3 ? 0.8 : 1.15, wind = F.hold + tele;
        if (this.t < F.hold) { rearTo(this.chainN ? 3.6 : 7.4, 5); if (T) turn(want, 5); if (this.t < F.hold * 0.7) move(-2.4); pitchTo(-0.15); jaw(0.3); }
        else if (!this.aim) {   // committed: at where they will be in a moment
          const ax = tp.x + (T ? clamp((T.vel?.x || 0) * 0.3, -2, 2) : 0) - this.headPos.x, az = tp.z + (T ? clamp((T.vel?.z || 0) * 0.3, -2, 2) : 0) - this.headPos.z;
          const yaw = T ? Math.atan2(ax, az) : Math.atan2(this.headDir.x, this.headDir.z), len = clamp(Math.hypot(ax, az) + 4.5, 8, 18), ox = this.headPos.x - Math.sin(yaw) * 1.5, oz = this.headPos.z - Math.cos(yaw) * 1.5;
          this.aim = { x: ox, z: oz, yaw, len }; this.warn('line', ox, oz, len, 3.6, yaw, tele + 0.12, 0, 0, (Tl) => this.hurtIn(C, Tl, 38, this.headPos.clone(), { knockdown: true }));
        }
        const A = this.aim;
        if (A) {
          if (this.t < wind) { rearTo(this.chainN ? 3.4 : 7.8, 6); turn(A.yaw, 12); pitchTo(-0.25); jaw(0.5); }
          else if (this.t < wind + lunge) {
            rearTo(0.75, 16); jaw(1, 30); pitchTo(0.45, 14); turn(A.yaw, 20);
            const ex = A.x + Math.sin(A.yaw) * A.len, ez = A.z + Math.cos(A.yaw) * A.len, rem = Math.hypot(ex - this.headPos.x, ez - this.headPos.z);
            move(Math.min(rem / Math.max(dt, wind + lunge - this.t), 70));
            if (!this.hitDone && this.t > wind + 0.1) { this.hitDone = true; C.ev('slam', new THREE.Vector3(ex, W.heightAt(ex, ez), ez), 3.2); }
          } else {   // and the head lies there a moment: now is the time to strike it
            F.down = 1; rearTo(0.75, 6); jaw(0.3, 4); pitchTo(0.18, 4);
            if (this.t > wind + lunge + rec) {
              this.aim = null; const more = this.phase === 1 ? 0 : this.phase === 2 ? 1 : 2;
              if (this.chainN < more && T && R() < 0.8) { this.chainN++; this.setState('strike'); } else { this.chainN = 0; this.cd = 1.3 / cad; this.setState('loom'); }
            }
          }
        }
        break;
      }
      case 'sweep': { // the head carried low and far round to one side, and then through them all in one stroke
        const F = this.f, wind = 0.95 / Math.sqrt(cad), sw = 0.34, RS = 6.6;
        if (!F.i) {
          F.i = 1; F.yaw = T ? want : Math.atan2(this.headDir.x, this.headDir.z); F.px = this.headPos.x - Math.sin(F.yaw) * 3.2; F.pz = this.headPos.z - Math.cos(F.yaw) * 3.2; F.dir = R() < 0.5 ? 1 : -1; this.cds.sweep = 9.5;
          const px = F.px, pz = F.pz; this.warn('cone', px, pz, 8.4, 1.15, F.yaw, wind + sw * 0.6, 0, 0, (Tl) => { for (const k of C.knights) if (!k.downed && Math.hypot(k.pos.x - px, k.pos.z - pz) > 2.6 && inside(k, Tl)) this.hurt(C, k, 26, new THREE.Vector3(px, 0, pz), { knockback: 12, stagger: true }); });   // tight in against his coils, the head goes over
          C.ev('bossSfx', this, 'hiss');
        }
        const a0 = F.yaw - F.dir * 1.2, a1 = F.yaw + F.dir * 1.2, at = (a, k) => { const gx = F.px + Math.sin(a) * RS, gz = F.pz + Math.cos(a) * RS; this.headPos.x += (gx - this.headPos.x) * k; this.headPos.z += (gz - this.headPos.z) * k; turn(a + F.dir * 1.2, 14); };
        if (this.t < wind) { at(lerp(F.yaw, a0, smooth(clamp(this.t / (wind * 0.75), 0, 1))), 1 - Math.exp(-7 * dt)); rearTo(1.9, 5); pitchTo(0.05); jaw(0.4); }
        else if (this.t < wind + sw) { at(lerp(a0, a1, smooth((this.t - wind) / sw)), 1); rearTo(0.9, 14); pitchTo(0.12); jaw(0.95, 24); if (!this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'crash'); } }
        else { F.down = 1; rearTo(0.85, 5); jaw(0.3, 4); pitchTo(0.16, 4); if (this.t > wind + sw + (this.phase >= 3 ? 0.7 : 1.0)) { this.cd = 1.1 / cad; this.setState('loom'); } }
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
      case 'thrash': // the coils near the knights who have gone to hack at his body heave up and come down on them; the tail lashes
        rearTo(5.2, 3); jaw(0.5); if (T) turn(want, 2);
        if (!this.hitDone) {
          this.hitDone = true; this.cds.thrash = 6.5; const pts = [];
          for (const { i } of this.knightsNearBody(C)) { const p = this.vis[i]; if (pts.every((q) => Math.hypot(q.p.x - p.x, q.p.z - p.z) > 4.5)) pts.push({ p: p.clone(), tail: i > SN * 0.62 }); if (pts.length >= 3) break; }
          const dur = 1.0 / Math.sqrt(cad);
          for (const { p, tail } of pts) this.warn('circle', p.x, p.z, tail ? 5.4 : 3.8, 0, 0, tail ? dur * 0.85 : dur, 0, tail ? 4 : 1, (Tl) => { this.hurtIn(C, Tl, tail ? 26 : 30, p, { knockback: tail ? 13 : 10 }); C.ev('slam', new THREE.Vector3(p.x, W.heightAt(p.x, p.z), p.z), tail ? 4.6 : 3.6); });
          C.ev('bossSfx', this, 'hiss');
        }
        if (this.t > 1.7) { this.cd = 1.1 / cad; this.setState('loom'); }
        break;
      case 'coil': { // round them at speed, the body closing a ring about them; then it tightens, and crushes what is inside
        if (!this.coilC) {
          const c = T ? T.pos.clone() : this.headPos.clone(); this.coilC = { x: c.x, z: c.z, a: Math.atan2(this.headPos.x - c.x, this.headPos.z - c.z), dir: R() < 0.5 ? 1 : -1, hp: this.maxHp * 0.045 };
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
      case 'recoil': // reeling, the head down on the ground: open to them. And then he comes back at whoever is still there.
        rearTo(0.6, 6); jaw(0.55, 6); pitchTo(0.25, 4);
        if (this.t > 2.0) {
          let n = 0; for (const k of C.knights) if (!k.downed && Math.hypot(k.pos.x - this.headPos.x, k.pos.z - this.headPos.z) < 9) n++;
          if (n) { this.cds.sweep = 0; this.last = 'sweep'; this.setState('sweep'); } else { this.cd = 0.8; this.setState('loom'); }
        }
        break;
    }
    // the weight of him: crossing the ground at speed, the body bowls over what it meets
    if (this.state === 'slither') for (const k of C.knights) {
      if (k.downed || (this.touch.get(k) || 0) > (C.time || 0)) continue;
      for (let i = 5; i < SN - 8; i += 2) { if (this.visD[i] > 0.4) continue; const p = this.vis[i]; if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) < serpentRad(i) + 0.55) { this.touch.set(k, (C.time || 0) + 1.6); this.hurt(C, k, 14, p, { knockback: 7 }); break; } }
    }
    // the venom where it lies
    this.poolT -= dt;
    if (this.poolT <= 0) { this.poolT = 0.8; for (const Tl of this.tele.map.values()) if (Tl.shape === 'pool' && Tl.t > 0.3) for (const k of C.knights) if (!k.downed && !k.isAI && inside(k, Tl, 0.1)) this.hurt(C, k, 5, new THREE.Vector3(Tl.x, 0, Tl.z), {}); }   // (the companions cannot see where it lies: it is let spare them)
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
    const M = this.M, R2 = SRADIAL + 1, pos = this.geo.attributes.position.array, nrm = this.geo.attributes.normal.array, PR = this.prof;
    const C = this._Cc || (this._Cc = Array.from({ length: M }, () => new THREE.Vector3()));
    for (let i = 0; i < SN - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(SN - 1, i + 2)];
      for (let k = 0; k < SSUB; k++) {
        const t = k / SSUB, t2 = t * t, t3 = t2 * t, o = C[i * SSUB + k];
        for (const ax of ['x', 'y', 'z']) o[ax] = 0.5 * (2 * p1[ax] + (-p0[ax] + p2[ax]) * t + (2 * p0[ax] - 5 * p1[ax] + 4 * p2[ax] - p3[ax]) * t2 + (-p0[ax] + 3 * p1[ax] - 3 * p2[ax] + p3[ax]) * t3);
      }
    }
    C[M - 1].copy(P[SN - 1]);
    // the first rings run straight back out of the head along its own axis, and bend from there into the path
    const JB = 7, hq = this.head.quaternion, hx = this._hx || (this._hx = new THREE.Vector3()), hv = this._hv || (this._hv = new THREE.Vector3());
    hx.set(1, 0, 0).applyQuaternion(hq);
    for (let j = 0; j < JB; j++) { hv.set(0, NECK.y, NECK.z - j * SSP / SSUB).applyQuaternion(hq).add(this.head.position); C[j].lerpVectors(hv, C[j], smooth(j / JB)); }
    const t = this._vt || (this._vt = new THREE.Vector3()), s = this._vs || (this._vs = new THREE.Vector3()), n = this._vn || (this._vn = new THREE.Vector3()), ps = this._vps || (this._vps = new THREE.Vector3());
    const t0 = this._t0 || (this._t0 = new THREE.Vector3()), t1 = this._t1 || (this._t1 = new THREE.Vector3());
    // frames from the tail (always lying on the ground) up to the neck (which may stand straight up), so they never twist
    for (let j = M - 1; j >= 0; j--) {
      t.subVectors(C[Math.min(M - 1, j + 1)], C[Math.max(0, j - 1)]); if (t.lengthSq() < 1e-10) t.set(0, 0, 1); t.normalize();   // toward the tail
      s.set(-t.z, 0, t.x); const sl = s.length();
      if (j < M - 1) { ps.addScaledVector(t, -ps.dot(t)); if (ps.lengthSq() < 1e-8) ps.copy(s); ps.normalize(); if (sl > 0.3) s.divideScalar(sl).lerp(ps, 0.5).normalize(); else s.copy(ps); }
      else if (sl > 1e-4) s.divideScalar(sl); else s.set(1, 0, 0);
      if (j < JB) { hv.copy(hx).addScaledVector(t, -hx.dot(t)); if (hv.lengthSq() > 1e-6) s.lerp(hv.normalize(), 1 - smooth(j / JB)).normalize(); }   // turned with the head
      ps.copy(s); n.crossVectors(s, t).normalize();
      if (j === 0) t0.copy(t); if (j === M - 1) t1.copy(t);
      const r = this.ringR[j] * (1 + 0.022 * Math.sin(time * 2.1 - j * 0.11)), c = C[j], base = j * R2, hd = j < 44 ? this.hood * Math.exp(-(((j - 15) / 9) ** 2)) : 0;   // the neck spread flat below the head when he threatens
      const fw = 1 + 0.6 * hd, fy = 1 - 0.22 * hd;
      for (let k = 0; k <= SRADIAL; k++) {
        const q = PR[k], X = q[0] * fw * r, Y = q[1] * fy * r, o = (base + k) * 3;
        pos[o] = c.x + n.x * Y + s.x * X; pos[o + 1] = c.y + n.y * Y + s.y * X; pos[o + 2] = c.z + n.z * Y + s.z * X;
        const nx = q[2] / fw, ny = q[3] / fy; let ax = n.x * ny + s.x * nx, ay = n.y * ny + s.y * nx, az = n.z * ny + s.z * nx; const l = Math.hypot(ax, ay, az) || 1;
        nrm[o] = ax / l; nrm[o + 1] = ay / l; nrm[o + 2] = az / l;
      }
    }
    // the cap inside the head, and the point of the tail
    const HC = M * R2, TT = HC + 1, r0 = this.ringR[0], c0 = C[0], cT = C[M - 1];
    pos[HC * 3] = c0.x + t0.x * r0 * 0.3; pos[HC * 3 + 1] = c0.y + t0.y * r0 * 0.3; pos[HC * 3 + 2] = c0.z + t0.z * r0 * 0.3; nrm[HC * 3] = -t0.x; nrm[HC * 3 + 1] = -t0.y; nrm[HC * 3 + 2] = -t0.z;
    pos[TT * 3] = cT.x + t1.x * 0.5; pos[TT * 3 + 1] = cT.y + t1.y * 0.5; pos[TT * 3 + 2] = cT.z + t1.z * 0.5; nrm[TT * 3] = t1.x; nrm[TT * 3 + 1] = t1.y; nrm[TT * 3 + 2] = t1.z;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }
  animate(dt, time, fx) {
    const W = this.world;
    if (this.net && W) {
      const n = this.net, k = 1 - Math.exp(-(this.state === 'strike' || this.state === 'sweep' ? 24 : 14) * dt);   // quick in the lunge and the sweep, or a guest sees the head cut corners
      this.headPos.x += (n.hx - this.headPos.x) * k; this.headPos.z += (n.hz - this.headPos.z) * k; this.rear += (n.rear - this.rear) * k; this.pitch += (n.pitch - this.pitch) * k;
      const y = dampAngle(Math.atan2(this.headDir.x, this.headDir.z), Math.atan2(n.dx, n.dz), 12, dt); this.headDir.set(Math.sin(y), 0, Math.cos(y));
      this.headPos.y = W.heightAt(this.headPos.x, this.headPos.z) + this.rear; this.followChain(W, dt);
    }
    this.tele.update(dt, W, fx);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.mat.emissiveIntensity = this.hmat.emissiveIntensity = (this.phase >= 3 ? 0.45 + 0.3 * Math.sin(time * 2.6) : 0) + this.hitFlash * 2.4;
    const st = this.state; this.hood = damp(this.hood, st === 'death' || this.burrowed ? 0 : st === 'strike' ? (this.rear > 4.5 ? 1 : 0) : st === 'loom' ? 0.5 : st === 'spit' || st === 'brood' || st === 'rain' || st === 'intro' ? 0.85 : st === 'thrash' ? 0.6 : 0, 5, dt);
    const P = this._P || (this._P = this.vis.map(() => new THREE.Vector3()));
    for (let i = 0; i < SN; i++) P[i].copy(this.vis[i]);
    // the tail lashing where its ring burns
    for (const T of this.tele.map.values()) if (T.fxk === 4) {
      const ph = T.t / T.dur, amp = ph < 1 ? 2.2 * smooth(clamp(ph * 1.2, 0, 1)) : 3.4 * Math.max(0, 1 - (T.t - T.dur) / 0.35);
      if (amp > 0) for (let i = Math.floor(SN * 0.5); i < SN - 1; i++) { const d = Math.hypot(this.vis[i].x - T.x, this.vis[i].z - T.z); if (d > 9) continue; const a = this.vis[i + 1], b = this.vis[i - 1], lx = a.z - b.z, lz = -(a.x - b.x), ll = Math.hypot(lx, lz) || 1, w = (1 - d / 9) ** 2 * (1 - this.visD[i]) * amp * Math.sin(ph < 1 ? time * 9 + i * 0.5 : (T.t - T.dur) * 26 + i * 0.4); P[i].x += lx / ll * w; P[i].z += lz / ll * w; P[i].y += Math.abs(w) * 0.25; }
    }
    // a coil heaved up and slammed down where its ring burns
    for (const T of this.tele.map.values()) if (T.fxk === 1 && T.shape === 'circle' && T.a < 4) {
      const ph = T.t / T.dur, h = ph < 1 ? 2.8 * smooth(clamp(ph * 1.25, 0, 1)) : 2.8 * Math.max(0, 1 - (T.t - T.dur) / 0.1);
      if (h > 0) for (let i = 4; i < SN; i++) { const d = Math.hypot(P[i].x - T.x, P[i].z - T.z); if (d < 6.5) P[i].y += h * (1 - d / 6.5) ** 2 * (1 - this.visD[i]); }
    }
    if (this.state === 'death') {
      this.deathT += dt; const k = Math.max(0, this.deathT - 1.2);
      for (let i = 0; i < SN; i++) P[i].y += Math.sin(time * 9 + i * 0.5) * 0.12 * Math.max(0, 1 - this.deathT / 1.5) - k * (1.1 + 0.6 * i / SN);
    }
    // the head (first: the neck is laid out from it)
    const yaw = Math.atan2(this.headDir.x, this.headDir.z);
    this.head.position.copy(P[0]); this.head.rotation.set(this.pitch, yaw, 0, 'YXZ');
    this.buildBody(P, time);
    this.jawVis = damp(this.jawVis, this.jawOpen, 14, dt);
    const H = this.hparts; H.gape(this.jawVis, time);
    // tasting the air: every second or two the tongue slides out of its sheath, through the notch in the lips, whips up
    // and down and is drawn back. With the jaws wide it lies in its sheath on the floor of the mouth, the forks showing.
    this.tongueT -= dt;
    const canFlick = !this.burrowed && st !== 'death' && st !== 'dive' && st !== 'under' && st !== 'surface';
    if (this.flick < 0 && this.tongueT <= 0 && canFlick && this.jawVis < 0.55) { this.flick = 0; this.tongueT = 1.1 + R() * 1.3; }
    let ext = 0;
    if (this.flick >= 0) {
      this.flick += dt; const f = this.flick / 0.95;
      ext = smooth(clamp(f / 0.16, 0, 1)) * (1 - smooth(clamp((f - 0.76) / 0.24, 0, 1)));
      if (f >= 1 || !canFlick) { this.flick = -1; ext = 0; }
    }
    if (ext > 0 || this._ext !== 0) { H.setTongue(ext, ext, time); this._ext = ext; }
    // dust where he goes into the earth and comes out of it, and over him as he runs beneath it
    if (fx && W) {
      this.dustT = (this.dustT || 0) - dt;
      if (this.dustT <= 0) {
        this.dustT = 0.1;
        for (let i = 1; i < SN; i += 2) { const a = this.visD[i - 1], b = this.visD[i]; if ((a - 0.5) * (b - 0.5) < 0) fx.dust(new THREE.Vector3(P[i].x, W.heightAt(P[i].x, P[i].z), P[i].z), 3, [0.22, 0.2, 0.17]); }
        if (this.state === 'under' || this.state === 'surface' || this.state === 'dive') { const g = this.headPos; fx.dust(new THREE.Vector3(g.x, W.heightAt(g.x, g.z), g.z), 5, [0.25, 0.22, 0.18]); }
      }
    }
    // the venom where it lies, black on the ground (its sick sheen is the telegraph drawn over it): draped over the
    // ground at the size it has now, so it lies on a slope as it spreads and does not hang over it
    let pn = 0;
    if (W) for (const T of this.tele.map.values()) {
      if (T.shape !== 'pool' || pn >= this.pools.length) continue; const M = this.pools[pn++], h0 = W.heightAt(T.x, T.z);
      const k = clamp(T.t / 0.35, 0, 1) * clamp((T.dur - T.t) / 0.8, 0, 1), sc = 0.3 + 0.7 * k;
      if (M.userData.id !== T.id || Math.abs(M.userData.sc - sc) > 0.004) {
        M.userData.id = T.id; M.userData.sc = sc; const A = M.geometry.attributes.position, NS = 26; A.setXYZ(0, 0, 0.03, 0);
        for (let r = 0; r < 3; r++) for (let q = 0; q < NS; q++) { const a = q / NS * TAU, rr = sc * T.a * [0.4, 0.76, 1][r] * (r ? 0.84 + 0.16 * Math.sin(a * 3 + T.id) * Math.cos(a * 5 + T.id * 1.7) + 0.08 * Math.sin(a * 9 + T.id * 0.3) : 1), x = Math.sin(a) * rr, z = Math.cos(a) * rr; A.setXYZ(1 + r * NS + q, x, W.heightAt(T.x + x, T.z + z) - h0 + 0.03, z); }
        A.needsUpdate = true;
      }
      M.position.set(T.x, h0, T.z); M.scale.set(1, 1, 1); M.visible = k > 0.01;
    }
    for (; pn < this.pools.length; pn++) { const M = this.pools[pn]; if (M.userData.id !== -1) { M.userData.id = -1; M.position.y = -999; } }
    // what a blade can find
    for (const sp of this.spheres) {
      if (sp.i < 0) { this.head.updateMatrixWorld(true); this.head.localToWorld(sp.c.set(0, 0.05, 1.2)); sp.mul = this.state === 'recoil' ? 2.1 : 1.8; sp.r = this.burrowed ? 0 : 1.45; }
      else { sp.c.copy(P[sp.i]); sp.r = this.visD[sp.i] > 0.6 ? 0 : serpentRad(sp.i) + 0.3; }
    }
  }
  dispose() { this.scene.remove(this.mesh); this.scene.remove(this.head); for (const m of this.pools) this.scene.remove(m); this.tele.clear(); }
}

// ================================================================ THE THING ON THE RIDGE
// Him. The same grey, hooded shape that has watched them from the hills all the way up, come down off the ridge at
// last and standing twice a man's height. Nothing about him is a beast's: he does not run, or roar, or bare claws. He
// comes on without a step and stops dead; his head has turned to a man before his body does, and further than a neck
// should go; then an arm moves, very fast. He goes for whoever is weakest, or alone, or kneeling over a fallen
// brother; he is suddenly behind them. He answers greed (a flurry of blows from in front) at once. Hurt, he calls up
// his legion and puts out the light; hurt again, he burns.
const DEVIL_DEF = { ...WATCHER_DEF };   // the very figure they have seen on the hills, to the last fold of the hood
const DS = 2.3;
// the lowest ground under a footprint (so a hem never hangs in the air off the edge of a ridge)
function footGround(W, x, z, r, y0) {
  if (!W) return y0;
  let y = W.heightAt(x, z); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; y = Math.min(y, W.heightAt(x + Math.sin(a) * r, z + Math.cos(a) * r)); }
  return Math.max(y, y0 - 0.9);
}
// the game this client is running, if there is one to ask (for what only a player's own machine can do: the hush, the dread)
function devilGame(b) { try { return b.game || globalThis.__app?.game || null; } catch { return null; } }

export class Cryptid extends Boss {
  constructor(scene, partySize, fx) {
    super(scene, 'cryptid');
    this.fx = fx;
    this.name = 'The Thing on the Ridge'; this.title = 'Qui in Montibus Vigilat';
    const body = buildHumanDevil(DEVIL_DEF) || buildHorror('devil', DEVIL_DEF);
    this.mat = body.mat; this.mesh = body.mesh; this.B = body.B; const B = this.B;
    this.mesh.scale.set(0.92 * DS, 1.08 * DS, 0.92 * DS);
    // the arms too long: the hands hang at his knees
    for (const k of ['R', 'L']) { B['fArm' + k].position.multiplyScalar(1.15); B['hand' + k].position.multiplyScalar(1.5); B['fArm' + k].userData.rest = B['fArm' + k].position.clone(); B['hand' + k].userData.rest = B['hand' + k].position.clone(); }
    this.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(this.mesh);
    // The dark he brings with him: a veil over the whole view, drawn in the scene itself (no light and no pass is
    // added for it). It lies under the marks that burn on the ground, so those are never hidden by it.
    this.veilU = { uA: { value: 0 } };
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.veilU, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vP; uniform float uA; void main(){ if (uA < 0.004) discard; float r = length(vP * vec2(1.0, 0.8)); gl_FragColor = vec4(0.0, 0.0, 0.006, uA * mix(0.7, 1.0, smoothstep(0.15, 1.1, r))); }',
    }));
    this.veil.frustumCulled = false; this.veil.renderOrder = 2; scene.add(this.veil); this.veilA = 0;
    this.party = Math.max(1, partySize || 1);
    this.maxHp = this.hp = Math.round(3600 * (1 + 0.6 * (this.party - 1)));
    this.maxPoise = this.poise = 420 * this.party;
    this.phases = [0.65, 0.3]; this.cad = 1 + 0.08 * (this.party - 1); this.cds = { legion: 6, pillars: 0, scream: 0, eclipse: 8, rebuke: 0, stomp: 0, vanish: 5 }; this.combo = 0; this.last = ''; this.wind = 0.8;
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
    this._v = new THREE.Vector3(); this.tilt = 0; this.tiltT = 0; this.reachLen = 9; this.dark = 0; this.greed = 0; this.steps = 0; this.glideT = 0; this.gliding = true;
    this.look = new THREE.Vector3(); this.headYaw = 0; this.headTo = 0; this.headT = 0; this.threat = new Map(); this.struckAt = new Map(); this.victim = null; this.lastVictim = null;
  }
  dispose() { this.scene.remove(this.mesh); this.scene.remove(this.veil); this.veil.geometry.dispose(); this.veil.material.dispose(); this.tele.clear(); }
  // ---------------------------------------------------------------- the fight (host)
  // his strength is set by who has come: a companion counts for a little more than half a player
  size(C) {
    this.sized = true; let n = 0; for (const k of C.knights) n += k.isAI ? 0.55 : 1; n = Math.max(1, n);
    const f = this.hp / this.maxHp; this.maxHp = Math.round(3600 * (1 + 0.6 * (n - 1))); this.hp = this.maxHp * f; this.maxPoise = this.poise = 420 * n; this.cad = 1 + 0.08 * (n - 1); this.party = n;
  }
  canReel() { return ['stalk', 'strike', 'reach', 'stomp', 'pillars', 'legion', 'appear', 'eclipse'].includes(this.state); }
  onPoiseBreak(C) { this.interrupt(); this.combo = 0; this.poiseCd = 14; this.setState('stagger'); C?.ev('bossSfx', this, 'scream'); }
  onPhase(n, C) {
    if (n === 2) { this.cds.legion = 0; this.cds.pillars = 4; this.cds.eclipse = 9; }
    if (n === 3) { this.cad *= 1.3; this.dmgScale = 1.2; this.cds.scream = 0; C?.ev('bossSfx', this, 'roar'); }
    if (this.state === 'stalk') this.setState(n === 2 ? 'legion' : 'scream');
  }
  phaseLine(n) { return n === 2 ? 'He calls up his legion' : 'He burns'; }
  takeHit(dmg, dir, stagger, C) {
    if (!this.alive || this.state === 'intro' || this.untouchable) return false;
    // who struck him, and from where: blows rained on him from in front are answered
    if (C && dir) {
      let best = null, bs = 0.5;
      for (const k of C.knights) { if (k.downed) continue; const dx = this.pos.x - k.pos.x, dz = this.pos.z - k.pos.z, l = Math.hypot(dx, dz) || 1; if (l > 9) continue; const s = (dx * dir.x + dz * dir.z) / l; if (s > bs) { bs = s; best = k; } }
      if (best) { this.threat.set(best, (this.threat.get(best) || 0) + dmg); if (Math.abs(angleDiff(this.yaw, Math.atan2(best.pos.x - this.pos.x, best.pos.z - this.pos.z))) < 1.15) this.greed += dmg; }
    }
    return super.takeHit(dmg, dir, stagger, C);
  }
  // (a companion cannot read the ground as a player can, and is struck far more often: his harness turns more of it)
  hurt(C, k, dmg, from, opts) { if (k && !k.downed) this.struckAt.set(k, C.time || 0); super.hurt(C, k, k && k.isAI ? dmg * 0.3 : dmg, from, opts); }
  // Whom he turns on: the wounded, the one alone, the one kneeling over a fallen brother, the one who has been hurting
  // him; less the one behind a raised guard, less the one he has only just struck.
  score(C, k, cur, now, human) {
    const d = Math.hypot(k.pos.x - this.pos.x, k.pos.z - this.pos.z);
    let s = 60 / (d + 5) + (k === cur ? 3 : 0), rev = false, ally = false;
    for (const o of C.knights) { if (o === k) continue; const dd = o.pos.distanceTo(k.pos); if (o.downed && dd < 2.8 && k.praying) rev = true; if (!o.downed && dd < 8) ally = true; }
    if (rev) s += 12; else if (k.praying) s += 7;
    s += (1 - k.hp / k.maxHp) * 9;
    if (!ally && C.knights.length > 1) s += 5;
    s += Math.min(7, (this.threat.get(k) || 0) / 40);
    if (k.blocking && k.stamina > 40) s -= 6;
    if (k.stamina < 25) s += 3;
    if (now - (this.struckAt.get(k) ?? -99) < 2.5) s -= 5;
    if (k.isAI && human) s -= 4;
    return { s, rev, d };
  }
  chooseTarget(C, dt) {
    this.retarget -= dt;
    const cur = this.target && !this.target.downed && C.knights.includes(this.target) ? this.target : null;
    if (cur && (this.retarget > 0 || this.state !== 'stalk')) return cur;
    const now = C.time || 0; let best = null, bs = -1e9, human = false;
    for (const k of C.knights) if (!k.downed && !k.isAI) human = true;
    for (const k of C.knights) { if (k.downed) continue; const { s } = this.score(C, k, cur, now, human); if (s > bs) { bs = s; best = k; } }
    this.retarget = 1.6; this.target = best; return best;
  }
  // the one he will be standing behind: as above, but distance is nothing to him, and never the same one twice running
  stepVictim(C) {
    const now = C.time || 0; let best = null, bs = -1e9, urgent = false, human = false;
    for (const k of C.knights) if (!k.downed && !k.isAI) human = true;
    for (const k of C.knights) {
      if (k.downed) continue; const r = this.score(C, k, null, now, human); let s = r.s - 60 / (r.d + 5) + Math.min(4, r.d / 6);
      if (k === this.lastVictim) s -= 6;
      if (s > bs) { bs = s; best = k; urgent = r.rev || k.hp < k.maxHp * 0.3; }
    }
    return { k: best, urgent };
  }
  choose(C, T, d) {
    const P = this.phase, o = []; let near = 0, behind = 0;
    for (const k of C.knights) { if (k.downed) continue; const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z; if (Math.hypot(dx, dz) > 6.5) continue; near++; if (Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz))) > 1.7) behind++; }
    const V = this.stepVictim(C);
    if (d < 8.2) o.push(['strike', T.blocking ? 1.4 : 3.4]);
    if (this.cds.stomp <= 0 && (near >= 2 || behind)) o.push(['stomp', 1.6 + behind * 1.5 + (near - 1) * 0.5]);
    if (d > 4.5 && d < 16) o.push(['reach', (d > 8 ? 3 : 1.2) * (T.blocking ? 2 : 1)]);
    if (this.cds.vanish <= 0 || d > 18) o.push(['vanish', d > 14 || this.far > 2 ? 4 : V.urgent ? 3 : V.k && V.k !== T ? 1.2 : 0.4]);
    if (P >= 2 && this.cds.legion <= 0) o.push(['legion', 2.2]);
    if (P >= 2 && this.cds.pillars <= 0) o.push(['pillars', d > 9 ? 2.8 : 1.4]);
    if (P >= 2 && this.cds.eclipse <= 0) o.push(['eclipse', 3]);
    if (P >= 3 && this.cds.scream <= 0) o.push(['scream', 2.6]);
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.35; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) { if (s === 'vanish') { this.victim = V.k; this.steps = P >= 3 ? 2 : 1; } return s; } } return o[0][0];
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world; this.world = W;
    if (!this.sized) this.size(C);
    this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * 0.025 * dt);
    this.greed = Math.max(0, this.greed - dt * 45); this.dark = Math.max(0, this.dark - dt);
    this.threatT = (this.threatT || 0) - dt; if (this.threatT <= 0) { this.threatT = 1; for (const [k, v] of this.threat) this.threat.set(k, v * 0.88); }
    const wv = this._wv || (this._wv = new THREE.Vector3()); wv.set(0, 0, 0);
    if (this.state === 'death') { this.vel.multiplyScalar(0.9); this.dark = 0; this.pos.y = W.heightAt(this.pos.x, this.pos.z); return; }
    const T = this.chooseTarget(C, dt), tp = T ? T.pos : this.pos;
    const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z, d = Math.hypot(dx, dz), want = Math.atan2(dx, dz), cad = this.cad;
    if (T) this.look.copy(tp);
    const face = (rate, yaw = want) => { this.yaw = dampAngle(this.yaw, yaw, rate, dt); };
    const fwd = (v) => wv.set(Math.sin(this.yaw) * v, 0, Math.cos(this.yaw) * v);
    const gp = (x, z) => new THREE.Vector3(x, W.heightAt(x, z), z);
    switch (this.state) {
      case 'intro': face(0.8); if (this.t > 3.8) { this.cd = 0.4; this.setState('stalk'); } break;
      case 'stalk': { // he comes on without a step, a way and then stock still; he turns slowly, but his head has already turned
        face(1.6);
        this.glideT -= dt; if (this.glideT <= 0) { this.gliding = !this.gliding; this.glideT = this.gliding ? 1.3 + R() * 1.5 : 0.45 + R() * 0.8; }
        if (d > 5.2 && (this.gliding || d > 13)) fwd((d > 12 ? 5.2 : 3.5) * Math.sqrt(cad));
        this.far = d > 15 ? (this.far || 0) + dt : 0;
        if (this.greed > 95 * this.party && this.cds.rebuke <= 0 && T) { this.last = 'rebuke'; this.setState('rebuke'); }   // greed is answered
        else if (T && this.cd <= 0 && this.t > 0.4 / cad) { const s = this.choose(C, T, d); this.last = s; this.combo = 0; this.setState(s); }
        break;
      }
      case 'strike': { // a long arm raised, the fan burning before him; then it comes across. Sometimes he holds it, and lets them move first
        const n = this.combo, third = this.phase >= 3 && n === 2;
        if (!this.aimT) {
          this.held = R() < (this.phase >= 2 ? 0.36 : 0.22);
          const wind = (third ? 0.9 : n ? 0.52 : 0.8) * (this.held ? 1.6 : 1) / cad;
          this.atk = third ? 2 : n % 2; this.lockYaw = want; this.wind = wind;
          if (third) { const cx = this.pos.x + Math.sin(want) * 3.8, cz = this.pos.z + Math.cos(want) * 3.8; this.aimT = this.warn('circle', cx, cz, 4.1, 0, 0, wind + 0.14, 0, 1, (Tl) => { this.hurtIn(C, Tl, 44, this.pos.clone(), { knockdown: true }); C.ev('slam', gp(Tl.x, Tl.z), 4.1); }); }
          else this.aimT = this.warn('cone', this.pos.x, this.pos.z, 7.6, 1.0, want, wind + 0.1, 0, 0, (Tl) => this.hurtIn(C, Tl, 26 + n * 3, this.pos.clone(), { knockback: 9, stagger: true }));
          C.ev('bossSfx', this, n ? 'snarl' : 'growl');
        }
        const wind = this.wind; face(9, this.lockYaw);
        if (this.t > wind + (third ? 1.2 : 0.6)) {
          this.aimT = null;
          if (n + 1 < (this.phase >= 3 ? 3 : 2) && T && d < 10) { this.combo++; this.setState('strike'); } else { this.combo = 0; this.cd = 1.0 / cad; this.setState('stalk'); }
        }
        break;
      }
      case 'reach': { // an arm held out down the lane, palm down. What stands in it when the hand closes is taken, and dragged to him
        const wind = 0.95 / cad;
        if (!this.aimT) {
          const len = clamp(d + 3.5, 8, 16); this.lockYaw = want; this.reachLen = len; this.wind = wind; this.took = 0;
          this.aimT = this.warn('line', this.pos.x + Math.sin(want) * 0.8, this.pos.z + Math.cos(want) * 0.8, len, 3.2, want, wind + 0.12, 0, 3, (Tl) => {
            for (const k of C.knights) {
              if (k.downed || !inside(k, Tl)) continue; const kx = k.pos.x - this.pos.x, kz = k.pos.z - this.pos.z, kd = Math.hypot(kx, kz) || 1; this.took++;
              this.hurt(C, k, 28, new THREE.Vector3(k.pos.x + kx / kd * 3, 0, k.pos.z + kz / kd * 3), { knockback: clamp((kd - 3) * 1.7, 0, 16), unblockable: true, stagger: true });   // (struck from beyond: he is thrown toward Him)
            }
          });
          C.ev('bossSfx', this, 'growl');
        }
        face(10, this.lockYaw);
        if (this.t > wind + 0.55) { this.aimT = null; if (this.took && T) { this.combo = 0; this.cd = 0; this.last = 'strike'; this.setState('strike'); } else if (this.t > wind + 1.15) { this.cd = 0.9 / cad; this.setState('stalk'); } }
        break;
      }
      case 'stomp': { // his arms rise from his sides; when they fall the ground about him opens in fire
        const wind = 1.0 / cad;
        if (!this.aimT) { this.wind = wind; this.aimT = this.warn('circle', this.pos.x, this.pos.z, 6.9, 0, 0, wind + 0.1, 2, 2, (Tl) => { this.hurtIn(C, Tl, 34, this.pos.clone(), { knockdown: true }); C.ev('slam', this.pos.clone(), 6.9); C.ev('bossSfx', this, 'crash'); }); C.ev('bossSfx', this, 'inhale'); }
        if (this.t > wind + 1.3) { this.aimT = null; this.cds.stomp = 5 / cad; this.cd = 0.8 / cad; this.setState('stalk'); }
        break;
      }
      case 'rebuke': { // they pressed him from in front: both hands, at once
        const wind = 0.42;
        if (!this.aimT) { this.wind = wind; this.aimT = this.warn('cone', this.pos.x, this.pos.z, 5.6, 1.25, this.yaw, wind, 0, 1, (Tl) => this.hurtIn(C, Tl, 22, this.pos.clone(), { knockback: 15, stagger: true })); C.ev('bossSfx', this, 'snarl'); }
        if (this.t > wind + 0.7) { this.aimT = null; this.cds.rebuke = 7; this.greed = 0; this.cd = 0.5 / cad; this.setState('stalk'); }
        break;
      }
      case 'vanish': // he is not there. Then the ground burns behind one of them
        if (this.t > 0.45) this.untouchable = true;
        if (this.t > 0.85 && !this.hitDone) {
          this.hitDone = true; const V = this.victim && !this.victim.downed ? this.victim : T; this.lastVictim = V;
          if (V) {
            const ky = V.yaw ?? want, q = { pos: new THREE.Vector3(V.pos.x - Math.sin(ky) * 3.3, 0, V.pos.z - Math.cos(ky) * 3.3) }; W.collide(q, 1.3);
            if (Math.hypot(q.pos.x - V.pos.x, q.pos.z - V.pos.z) < 2) { q.pos.set(V.pos.x + Math.sin(ky) * 3.3, 0, V.pos.z + Math.cos(ky) * 3.3); W.collide(q, 1.3); }   // (no room behind him: before him, then)
            const px = q.pos.x, pz = q.pos.z, dur = this.phase >= 3 || this.dark > 0 ? 0.8 : 1.0, yaw = Math.atan2(V.pos.x - px, V.pos.z - pz);
            this.warn('circle', px, pz, 3.8, 0, 0, dur, 0, 2, (Tl) => this.hurtIn(C, Tl, 30, new THREE.Vector3(px, 0, pz), { knockback: 10, stagger: true }));
            this.later(dur - 0.36, () => { this.pos.set(px, W.heightAt(px, pz), pz); this.vel.set(0, 0, 0); this.yaw = yaw; this.untouchable = false; this.target = V; this.retarget = 2; this.setState('appear'); C.ev('bossSfx', this, 'scream'); });
          }
        }
        if (this.t > 4) { this.untouchable = false; this.setState('stalk'); }
        break;
      case 'appear': // out of the smoke already striking
        if (this.t > 1.0) {
          if (--this.steps > 0) { this.victim = this.stepVictim(C).k; this.setState('vanish'); }
          else { this.steps = 0; this.cds.vanish = (this.phase >= 3 ? 6 : 9) / cad; this.cd = 0.8 / cad; this.setState('stalk'); }
        }
        break;
      case 'legion': // arms raised, presenting his legion: they come up out of the ground about him
        face(1.5);
        if (this.t > 0.9 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'howl'); const n = Math.round(this.party); C.summonAround(this.pos, 'shade', 1 + n); C.summonAround(this.pos, 'crawler', 2 + (this.phase >= 3 ? 2 : 0)); if (this.phase >= 3) C.summonAround(this.pos, 'husk', 1); }
        if (this.t > 2.6) { this.cds.legion = 34; this.cd = 0.6; this.setState('stalk'); }
        break;
      case 'pillars': // he points, and the ground opens in fire under them, one after another
        face(3);
        if (!this.hitDone) {
          this.hitDone = true; C.ev('bossSfx', this, 'growl');
          for (const k of C.knights) {
            if (k.downed) continue;
            for (let j = 0; j < (k.isAI ? 1 : 3); j++) this.later(0.45 + j * 0.5, () => {
              const a = R() * TAU, r = j ? 1.6 + R() * 2.6 : 0, x = k.pos.x + (k.vel ? k.vel.x * 0.45 : 0) + Math.sin(a) * r, z = k.pos.z + (k.vel ? k.vel.z * 0.45 : 0) + Math.cos(a) * r;
              this.warn('circle', x, z, 2.6, 0, 0, 1.15 / Math.sqrt(cad), 2, 2, (Tl) => { this.hurtIn(C, Tl, 28, new THREE.Vector3(x, 0, z), { knockback: 7, unblockable: true }); C.ev('slam', gp(x, z), 2.6); }, true);
            }, true);
          }
        }
        if (this.t > 2.7) { this.cds.pillars = 16; this.cd = 0.8 / cad; this.setState('stalk'); }
        break;
      case 'eclipse': // his arms go up, and the light goes out of the world. In the dark he is behind one of them, and then another
        face(1.2);
        if (this.t > 1.3 && !this.hitDone) { this.hitDone = true; this.dark = 9; C.ev('bossSfx', this, 'howl'); }
        if (this.t > 2.1) { this.cds.eclipse = 44; this.steps = this.phase >= 3 ? 3 : 2; this.victim = this.stepVictim(C).k; this.last = 'vanish'; this.setState('vanish'); }
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
      case 'stagger': // his guard is broken: he reels where he stands, the head thrown aside and in reach. Then he is gone from under their blades
        if (this.t > 2.3) { this.greed = 0; this.steps = 1; this.victim = this.stepVictim(C).k; this.last = 'vanish'; this.setState('vanish'); }
        break;
    }
    const k = wv.x || wv.z ? 4 : 10;   // (he stops dead)
    this.vel.x = damp(this.vel.x, wv.x, k, dt); this.vel.z = damp(this.vel.z, wv.z, k, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; W.collide(this, 1.3);
    this.pos.y = W.heightAt(this.pos.x, this.pos.z);
  }
  snap() { return [...this.baseSnap(), +this.wind.toFixed(2), +this.reachLen.toFixed(1), this.untouchable ? 1 : 0, this.tele.snap(), +this.dark.toFixed(1), +this.look.x.toFixed(1), +this.look.z.toFixed(1), this.maxHp]; }
  applySnap(s, dt, W) {
    const p0 = this.pos.clone(), y0 = this.yaw; super.applySnap(s, dt); this.netYaw = s[4]; this.yaw = Math.abs(angleDiff(y0, s[4])) > 1.6 ? s[4] : y0;
    this.netPos = new THREE.Vector3(s[1], s[2], s[3]); this.pos.copy(p0.distanceTo(this.netPos) > 8 ? this.netPos : p0);
    this.wind = s[11] || 0.8; this.reachLen = s[12] || 9; this.untouchable = !!s[13]; this.tele.apply(s[14]); this.dark = s[15] || 0; this.look.set(s[16] ?? this.pos.x, 0, s[17] ?? this.pos.z); if (s[18]) this.maxHp = s[18];
    if (W) this.world = W;
  }
  teleFx(T, fx, world) {
    if (!fx || !T.fxk) return;
    const g = (x, z) => new THREE.Vector3(x, world ? world.heightAt(x, z) : 0, z);
    if (T.fxk === 1) { fx.dust(g(T.x, T.z), 12, [0.22, 0.2, 0.17]); return; }
    if (T.fxk === 3) { const n = Math.round(T.a); for (let i = 0; i < n; i++) { const p = g(T.x + Math.sin(T.yaw) * (i + 0.5), T.z + Math.cos(T.yaw) * (i + 0.5)); p.y += 0.3; fx.wisp(p, 1.4); fx.wisp(p, 0.9); } return; }   // the dark runs down the lane
    // fire out of the ground: a column where a pillar burns, a ring of it round him when his arms fall
    if (T.a < 3) { const p = g(T.x, T.z); fx.explosion(p, 2.4, [1, 0.42, 0.1]); fx.flash(p.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff6020, 22, 0.4, 10); }
    else if (T.a < 5) { const p = g(T.x, T.z); for (let i = 0; i < 10; i++) fx.wisp(p.clone().add(new THREE.Vector3((R() - 0.5) * 3, R() * 3, (R() - 0.5) * 3)), 1.6); }
    else { const n = Math.round(T.a * 2.2); for (let i = 0; i < n; i++) { const a = i / n * TAU; fx.explosion(g(T.x + Math.sin(a) * T.a * 0.85, T.z + Math.cos(a) * T.a * 0.85), 1.6, [1, 0.4, 0.08]); } fx.flash(g(T.x, T.z).add(new THREE.Vector3(0, 2, 0)), 0xff5018, 40, 0.5, 18); }
  }
  // ---------------------------------------------------------------- his body (every client)
  animate(dt, time, fx) {
    const W = this.world, B = this.B, st = this.state, U = this.mat.userData.u;
    this.tele.update(dt, W, fx);
    if (this.netPos) { const k = 1 - Math.exp(-10 * dt); this.pos.lerp(this.netPos, k); this.yaw = dampAngle(this.yaw, this.netYaw ?? this.yaw, 10, dt); this.t += dt; this.dark = Math.max(0, this.dark - dt); }   // (a client: the host's clock only arrives fifteen times a second)
    const T = this.t, came = this.pSt !== st; this.pSt = st;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    if (U.uTime) U.uTime.value = time; tickRobes(time);
    // coming and going in smoke and embers; and when he burns, the fire eating holes in him
    let dis = 0;
    if (st === 'intro') dis = 1 - smooth(clamp((T - 0.3) / 2.2, 0, 1));
    else if (st === 'vanish') dis = smooth(clamp(T / 0.45, 0, 1));
    else if (st === 'appear') dis = 1 - smooth(clamp(T / 0.3, 0, 1));
    else if (st === 'death') { this.deathT += dt; dis = clamp((this.deathT - 1.2) / 3.2, 0, 1); }
    if (this.phase >= 3 && dis < 0.035) dis = 0.035 + 0.015 * Math.sin(time * 5.3);
    if (st === 'stagger') dis = Math.max(dis, 0.05 + 0.04 * Math.sin(time * 31));
    U.uDissolve.value = dis * 0.985; this.mesh.visible = dis < 0.97;
    if (fx && this.mesh.visible && ((dis > 0.04 && dis < 0.96) || this.phase >= 3 || this.hitFlash > 0.9) && R() < dt * (this.phase >= 3 ? 12 : 20)) fx.wisp(this._v.set(this.pos.x + (R() - 0.5) * 2.2, this.pos.y + R() * 4.6, this.pos.z + (R() - 0.5) * 2.2), 1.5);
    // where he stands: on the lowest ground under the hem
    this.mesh.position.set(this.pos.x, footGround(W, this.pos.x, this.pos.z, 1.2, this.pos.y), this.pos.z); this.mesh.rotation.y = this.yaw;
    // ---- the dark he brings (a little of it always; all of it when he puts out the light), and the hush with it
    const G = came || (this.dark > 0) !== this.wasDark ? devilGame(this) : null;
    if (this.dark > 0 && !this.wasDark && G) { try { G.audio?.silence?.(Math.min(3, this.dark)); G.audio?.heartbeat?.(0.5); } catch {} }
    this.wasDark = this.dark > 0;
    if (came && st === 'appear' && G && G.me && G.dread) { try { if (Math.hypot(G.me.pos.x - this.pos.x, G.me.pos.z - this.pos.z) < 6.5) { G.dread.level = Math.min(1, G.dread.level + 0.14); G.audio?.heartbeat?.(0.6); } } catch {} }   // he is behind YOU
    let va = !this.alive ? 0 : this.dark > 0 ? 0.5 * clamp(this.dark / 1.2, 0, 1) + 0.22 : [0, 0.1, 0.17, 0.24][this.phase] || 0.1;
    if (st === 'intro') va *= clamp(T / 3, 0, 1); if (st === 'eclipse') va = Math.max(va, 0.72 * smooth(clamp((T - 0.5) / 0.9, 0, 1)));
    this.veilA = damp(this.veilA, va, 2.5, dt); this.veilU.uA.value = this.veilA;
    // ---- the head goes first: it has turned on the one he wants before the body does, in snaps, and further than a neck should go
    const ld = Math.hypot(this.look.x - this.pos.x, this.look.z - this.pos.z), lw = ld > 0.5 ? clamp(angleDiff(this.yaw, Math.atan2(this.look.x - this.pos.x, this.look.z - this.pos.z)), -2.0, 2.0) : 0;
    this.headT -= dt; if (this.headT <= 0 || Math.abs(lw - this.headTo) > 1.2) { this.headT = 0.3 + R() * 0.7; this.headTo = lw; }
    this.headYaw = damp(this.headYaw, st === 'stalk' || st === 'legion' || st === 'pillars' || st === 'intro' ? this.headTo : lw * 0.5, 16, dt);
    this.tiltT -= dt; if (this.tiltT <= 0) { this.tiltT = 0.8 + R() * 2.4; this.tiltTo = (R() - 0.5) * 44; this.snapTilt = R() < 0.5; }
    this.tilt = damp(this.tilt, this.tiltTo || 0, this.snapTilt ? 14 : 1.4, dt);
    // ---- the pose (degrees; +x bends forward, +y turns to his left; limbs: -x swings forward). He never bends far:
    // the robe hangs plumb to a stoop of fifteen degrees, and his legs do not move at all.
    const hy = this.headYaw * 57.3, breath = Math.sin(time * 0.9) * 1.6, down = ld < 9 ? 16 : 7;
    const Q = this.Q || (this.Q = {}); const set = (b, x, y, z) => { const q = Q[b] || (Q[b] = [0, 0, 0]); q[0] = x; q[1] = y; q[2] = z; };
    set('hips', 0, 0, 0); set('spine', 4, hy * 0.08, 0); set('chest', 3 + breath, hy * 0.12, 0); set('neck', 5 + down * 0.4, hy * 0.3, this.tilt * 0.25); set('head', -2 + down * 0.6, hy * 0.5, this.tilt * 0.75);
    set('clavR', 0, 0, 0); set('clavL', 0, 0, 0); set('uArmR', -3, 0, -6); set('uArmL', -3, 0, 6); set('fArmR', -8, 0, 0); set('fArmL', -8, 0, 0);
    set('handR', -10 + Math.max(0, Math.sin(time * 1.3)) ** 6 * 26, 0, 0); set('handL', -10 + Math.max(0, Math.sin(time * 0.9 + 2)) ** 6 * 26, 0, 0);
    for (const k of ['R', 'L']) { set('thigh' + k, 0, 0, k === 'R' ? -2 : 2); set('shin' + k, 2, 0, 0); set('foot' + k, 0, 0, 0); }
    const mix = (b, v, w) => { const q = Q[b]; if (!q || w <= 0) return; q[0] += (v[0] - q[0]) * w; q[1] += (v[1] - q[1]) * w; q[2] += (v[2] - q[2]) * w; };
    const wind = this.wind || 0.8, both = [['R', 1], ['L', -1]];   // (m: +1 for the right arm, on his -x side)
    let sink = 0;
    if (st === 'strike') {
      // the arm goes up slowly and stops; it comes across in a tenth of a second
      const up = smooth(clamp(T / Math.min(wind, 0.7), 0, 1)), sk = smooth(clamp((T - wind) / 0.11, 0, 1)), w = up * (1 - smooth(clamp((T - wind - 0.34) / 0.3, 0, 1)));
      if (this.atk === 2) {
        for (const [k, m] of both) { mix('uArm' + k, [lerp(-172, -58, sk), 0, -m * lerp(20, 6, sk)], w); mix('fArm' + k, [lerp(-26, -6, sk), 0, 0], w); mix('hand' + k, [lerp(-20, 30, sk), 0, 0], w); }
        mix('spine', [lerp(-5, 9, sk), 0, 0], w); mix('chest', [lerp(-6, 5, sk), 0, 0], w); mix('neck', [lerp(-10, 8, sk), 0, 0], w); mix('head', [lerp(-16, 6, sk), 0, 0], w);
      } else {
        const k = this.atk === 1 ? 'L' : 'R', m = this.atk === 1 ? -1 : 1;
        mix('uArm' + k, [lerp(-150, -42, sk), lerp(0, 60 * m, sk), lerp(-44 * m, -8 * m, sk)], w); mix('fArm' + k, [lerp(-38, -6, sk), 0, 0], w); mix('hand' + k, [lerp(-30, 25, sk), 0, 0], w);
        mix('chest', [lerp(-3, 7, sk), lerp(-16 * m, 24 * m, sk), 0], w); mix('spine', [lerp(-2, 4, sk), lerp(-6 * m, 8 * m, sk), 0], w);
      }
    } else if (st === 'reach') {
      const up = smooth(clamp(T / (wind * 0.7), 0, 1)), cl = smooth(clamp((T - wind) / 0.14, 0, 1)), w = up * (1 - smooth(clamp((T - wind - 0.5) / 0.5, 0, 1)));
      mix('uArmR', [lerp(-86, -52, cl), 0, -3], w); mix('fArmR', [lerp(-4, -78, cl), 0, 0], w); mix('handR', [lerp(22, -55, cl), 0, 0], w);   // held out, palm down; then closed and drawn in
      mix('chest', [lerp(1, -3, cl), 10, 0], w); mix('spine', [lerp(2, -2, cl), 4, 0], w); mix('head', [down * 0.6 + 4, 0, this.tilt * 0.3], w);
    } else if (st === 'stomp') {
      const up = smooth(clamp(T / wind, 0, 1)), sl = smooth(clamp((T - wind) / 0.14, 0, 1)), w = up * (1 - smooth(clamp((T - wind - 0.9) / 0.4, 0, 1)));
      for (const [k, m] of both) { mix('uArm' + k, [lerp(-18, -12, sl), 0, -m * lerp(96, 22, sl)], w); mix('fArm' + k, [lerp(-10, -4, sl), 0, 0], w); mix('hand' + k, [lerp(-30, 50, sl), 0, 0], w); }   // arms out from his sides like a cross; then down
      mix('chest', [lerp(-6, 6, sl), 0, 0], w); mix('neck', [lerp(-10, 12, sl), 0, 0], w); mix('head', [lerp(-18, 14, sl), 0, 0], w);
    } else if (st === 'rebuke') {
      const sk = smooth(clamp((T - wind + 0.1) / 0.1, 0, 1)), w = smooth(clamp(T / 0.2, 0, 1)) * (1 - smooth(clamp((T - wind - 0.35) / 0.3, 0, 1)));
      for (const [k, m] of both) { mix('uArm' + k, [lerp(24, -84, sk), 0, -m * 8], w); mix('fArm' + k, [lerp(-112, -6, sk), 0, 0], w); mix('hand' + k, [lerp(0, 62, sk), 0, 0], w); }
      mix('chest', [lerp(-4, 5, sk), 0, 0], w);
    } else if (st === 'vanish' || st === 'appear') {
      if (st === 'vanish') { const w = smooth(clamp(T / 0.4, 0, 1)); mix('neck', [22, 0, 0], w); mix('head', [20, 0, 14], w); }
      else { const sk = smooth(clamp((T - 0.2) / 0.16, 0, 1)), w = 1 - smooth(clamp((T - 0.6) / 0.35, 0, 1)); for (const [k, m] of both) { mix('uArm' + k, [lerp(-8, -150, sk), 0, -m * lerp(10, 44, sk)], w); mix('fArm' + k, [lerp(-20, -12, sk), 0, 0], w); } mix('head', [lerp(12, -16, sk), 0, 0], w); mix('chest', [lerp(3, -5, sk), 0, 0], w); }
    } else if (st === 'legion' || st === 'eclipse') {
      const ec = st === 'eclipse', w = smooth(clamp(T / (ec ? 1.2 : 0.7), 0, 1)) * (1 - smooth(clamp((T - (ec ? 1.9 : 2.1)) / 0.5, 0, 1)));
      mix('uArmR', [(ec ? -168 : -155) + Math.sin(time * 0.9) * 5, 0, ec ? -12 : -28], w); mix('uArmL', [(ec ? -168 : -155) + Math.cos(time * 0.9) * 5, 0, ec ? 12 : 28], w); mix('fArmR', [-8, 0, 0], w); mix('fArmL', [-8, 0, 0], w); mix('handR', [12, 0, 0], w); mix('handL', [12, 0, 0], w);
      mix('spine', [-3, 0, 0], w); mix('chest', [-7, 0, 0], w); mix('neck', [ec ? -14 : -6, 0, 0], w); mix('head', [ec ? -32 : -22, 0, this.tilt * 0.3], w);
    } else if (st === 'pillars') {
      const w = smooth(clamp(T / 0.4, 0, 1)) * (1 - smooth(clamp((T - 2.2) / 0.5, 0, 1)));
      mix('uArmR', [-92, 0, -4], w); mix('fArmR', [-4, 0, 0], w); mix('handR', [10, 0, 0], w); mix('chest', [3, 10, 0], w);
    } else if (st === 'scream') {
      const h = smooth(clamp(T / wind, 0, 1)), rl = smooth(clamp((T - wind) / 0.18, 0, 1)), w = 1 - smooth(clamp((T - wind - 1.5) / 0.6, 0, 1));
      mix('spine', [lerp(8 * h, -5, rl), 0, 0], w); mix('chest', [lerp(6 * h, -9, rl), 0, 0], w); mix('neck', [lerp(10, -16, rl), 0, 0], w); mix('head', [lerp(18 * h, -38, rl), 0, Math.sin(time * 40) * 6 * rl], w);
      for (const [k, m] of both) { mix('uArm' + k, [lerp(-40 * h, 18, rl), lerp(38 * m * h, 0, rl), lerp(0, -86 * m, rl)], w); mix('fArm' + k, [lerp(-90 * h, -6, rl), 0, 0], w); mix('hand' + k, [lerp(0, 35, rl), 0, 0], w); }
    } else if (st === 'stagger') {
      // he does not fall: he reels where he stands, the head snapped aside, an arm thrown up
      const w = smooth(clamp(T / 0.18, 0, 1)) * (1 - smooth(clamp((T - 1.9) / 0.4, 0, 1))), sh = Math.sin(time * 37) * 2.5;
      mix('spine', [-6 + sh, 0, 4], w); mix('chest', [-5, -14, 0], w); mix('neck', [-8, 30, 18], w); mix('head', [8, 46, 26 + sh * 2], w);
      mix('uArmL', [-118, 30, 22], w); mix('fArmL', [-96, 0, 0], w); mix('handL', [30, 0, 0], w); mix('uArmR', [-16, 0, -34 + sh], w); mix('fArmR', [-30, 0, 0], w);
    } else if (st === 'death') {
      // he draws himself up to his whole height, the arms opening; and burns away from inside the robe, which falls empty
      const t2 = this.deathT, w = smooth(clamp(t2 / 0.6, 0, 1)), sh = Math.sin(time * 41) * 3 * (1 - clamp(t2 / 3, 0, 1));
      mix('spine', [-5, 0, 0], w); mix('chest', [-8 + sh, 0, 0], w); mix('neck', [-16, 0, 0], w); mix('head', [-34, sh * 3, 10], w);
      for (const [k, m] of both) { mix('uArm' + k, [-14, 0, -m * 46 + sh], w); mix('fArm' + k, [-22, 0, 0], w); mix('hand' + k, [36, 0, 0], w); }
      sink = smooth(clamp((t2 - 1.6) / 2.6, 0, 1));
    } else if (st === 'intro') {
      const r = smooth(clamp((T - 2.0) / 1.6, 0, 1));
      mix('neck', [lerp(26, 6, r), 0, 0], 1); mix('head', [lerp(26, -8, r), 0, lerp(22, 6, r)], 1); mix('spine', [lerp(10, 4, r), 0, 0], 1);
    }
    for (const b in Q) if (B[b]) e(B[b], Q[b][0], Q[b][1], Q[b][2]);
    if (B.hips.userData.rest) B.hips.position.copy(B.hips.userData.rest);
    this.mesh.updateMatrixWorld(true);
    plantRobe(B, this.mesh, 0.07);
    if (sink > 0 && B.robe) B.robe.scale.y *= 1 - sink * 0.9;   // (the robe going down empty)
    guardArms(B);   // whatever the pose, the forearms and hands never pass into the robe, the hood or the horns
    // what a blade can find (reeling, the head is thrown aside and lower)
    this.headSphere.r = (st === 'stagger' ? 0.3 : 0.17) * DS; this.headSphere.mul = st === 'stagger' ? 2.0 : 1.7;
    this.updateSpheres();
  }
}

// ================================================================ THE GREAT DRAGON
// The Great Dragon of the Apocalypse, fought in three parts. On the summit he fights on the ground: jaws, the claws
// of his wings, the tail for whoever gets behind him, a beat of the wings for a crowd, a sweeping breath of fire, a
// leap onto whoever stands off or kneels. Hurt, he takes to the air: the wards wake, and while the knights pray he
// burns lanes across the summit, spits fire on the ones kneeling, stoops with his talons, and comes down to fight
// on the ground for a while before he rises again. Each ward that is finished strikes him out of the sky and leaves
// him stunned where they can reach his head. When the third has struck he is cast down for good, and fights to the
// death faster and with more fire. He chooses his blows by where the knights stand and what they are doing.
const DK = 0.92;                     // the model's size in the world
const DRG = { bite: [0.74, 0.44, 0.52], biteRec: 0.95, claw: 0.72, tail: 0.66, buffet: 0.9, slam: 1.0, breath: 1.05, quick: 0.6, pounce: 0.85, pounceAir: 0.95, hop: 0.5, hopAir: 0.75, charge: 0.85, chargeRun: 0.85, takeoff: 2.7, ring: 31, alt: 15, stun: 7, intro: 9.6, land: 4.6 };
const DRG_GROUND = ['stalk', 'strike', 'claw', 'tail', 'buffet', 'stomp', 'breath', 'storm', 'roar', 'charge'];   // ('strike' is the bite, 'stomp' the slam: names the companions already know to get clear of)
const NECK_G = [-20, -15, -6, 8, 16, 12, 16], NECK_F = [17, 12, 6, -2, -8, -8, -2], NECK_H = [30, 22, 12, 4, 0, 0, 10];
const LIMBS = [['R', 1, -2.2, -1.4], ['L', 1, 2.2, -1.4], ['R', 0, -3.9, 3.9], ['L', 0, 3.9, 3.9]];   // side, hind?, where it stands (his own frame)
const FOLD = { f1: [0.2, 0.45, -1], f2: [0.15, 0.3, -1], f3: [0.09, 0.15, -1], f4: [0.03, 0.03, -1] };   // where the fingers lie when the wing is shut
const _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _d3 = new THREE.Vector3(), _d4 = new THREE.Vector3(), _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion();
const _dq3 = new THREE.Quaternion(), _dqI = new THREE.Quaternion(), _dn = new THREE.Vector3(), _dU = new THREE.Vector3();
// one of the fx lights, held (no light is ever added for him: these four are in the scene from the start)
function dragonLight(fx, slot, p, color, intensity, dist) {
  const l = fx && fx.lights && fx.lights[slot]; if (!l) return;
  l.position.copy(p); l.color.set(color); l.distance = dist; l.userData.peak = intensity; l.userData.dur = 0.3; l.userData.t = 0.3; l.intensity = intensity;
}

export class Dragon extends Boss {
  constructor(scene, partySize, fx) {
    super(scene, 'dragon');
    this.fx = fx;
    this.name = 'The Great Dragon'; this.title = 'Draco Magnus Rufus';
    const M = buildDragonModel(); this.model = M; this.mat = M.hideMat; this.wingMat = M.wingMat;
    const mesh = M.mesh, B = M.B; this.mesh = mesh; this.B = B; this.wingMesh = M.wingMesh;
    mesh.scale.setScalar(DK); mesh.rotation.order = 'YXZ'; scene.add(mesh);
    this.fire = new DragonFire(scene);
    this.sun = scene.children.find((o) => o.isDirectionalLight && o.castShadow);
    this.party = Math.max(1, partySize || 1);
    this.maxHp = this.hp = Math.round(9000 * (1 + 0.55 * (this.party - 1)));
    this.maxPoise = this.poise = 900 * this.party;
    this.cad = 1 + 0.07 * (this.party - 1);
    this.alt = 0; this.fly = 0; this.breath = 0; this.wardsDone = 0; this.aim = 0; this.wind = 0.8; this.lockYaw = 0; this.combo = 0; this.last = ''; this.hug = 0; this.groundT = 0; this.airN = 0; this.fv = 0;
    this.cds = { tail: 0, buffet: 5, breath: 4, pounce: 7, slam: 0, hop: 6, storm: 4, charge: 3, roar: 24 };
    this.ap = new THREE.Vector2(); this.look = new THREE.Vector3(); this.from = new THREE.Vector3(); this.to = new THREE.Vector2(); this.wv = new THREE.Vector3();
    this.threat = new Map(); this.struckAt = new Map(); this.wardSeen = new Set();
    const S = (name, bone, off, r, mul) => ({ name, bone: B[bone], off, r: r * DK, mul, c: new THREE.Vector3() });
    this.spheres = [
      S('head', 'head', [0, 0.1, 1.2], 1.25, 1.6), S('head', 'head', [0, -0.1, 2.5], 0.85, 1.6),
      S('neck', 'neck5', [0, 0, 0.5], 0.85, 1.2), S('neck', 'neck3', [0, 0, 0.4], 0.95, 1.15), S('neck', 'neck1', [0, -0.2, 0.4], 1.3, 1.1),
      S('chest', 'chest', [0, -0.7, 0], 2.2, 1), S('body', 'spine', [0, -0.3, 0], 1.9, 0.95), S('body', 'hips', [0, -0.15, 0], 1.8, 0.95),
      ...[['R', -1], ['L', 1]].flatMap(([k, s]) => [
        S('leg', 'thigh' + k, [s * 0.35, -0.8, 0.7], 1.1, 0.85), S('leg', 'shin' + k, [0, -0.55, -1.0], 0.75, 0.85), S('leg', 'meta' + k, [0, -0.5, 0.4], 0.7, 0.85), S('leg', 'foot' + k, [0, 0.1, 0.6], 0.8, 0.85),
        S('wing', 'wing1' + k, [s * 1.7, 0.2, -0.2], 0.8, 0.75), S('wing', 'wing2' + k, [s * 2.1, 0, 0.5], 0.7, 0.75), S('wing', 'wing3' + k, [0, 0, 0], 0.9, 0.8),
      ]),
      S('tail', 'tail2', [0, 0, 0], 1.1, 0.7), S('tail', 'tail4', [0, 0, 0], 0.9, 0.7), S('tail', 'tail6', [0, 0, 0], 0.7, 0.7), S('tail', 'tail8', [0, 0, 0], 0.5, 0.7),
    ];
    this.mouth = new THREE.Vector3(); this.mouthDir = new THREE.Vector3(0, 0, 1); this.headPos = new THREE.Vector3();
    // the body's own state (every client): the pose, the springs, where each foot is planted
    this.Q = {}; for (const n in B) this.Q[n] = [0, 0, 0];
    this.limbs = LIMBS.map(([k, hind, x, z]) => ({ k, hind, x: x * DK, z: z * DK, p: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), s: -1, dur: 0.3, set: false }));
    this.flap = 0; this.hov = 0; this.glide = 0; this.sq = 0; this.sqV = 0; this.lookA = 0; this.lookP = 0; this.tailLag = 0; this.heat = 0; this.jawK = 0; this.wingW = 1; this.prev = new THREE.Vector3(); this.pv = new THREE.Vector3(); this.prevYaw = 0; this.prevAlt = 0; this.yawV = 0; this.bank = 0; this.gY = 0;
  }
  get groundY() { return this.gY; }
  dispose() { this.scene.remove(this.mesh); this.tele.clear(); this.fire.dispose(); }

  // ---------------------------------------------------------------- the fight (host)
  canReel() { return this.alt < 0.5 && DRG_GROUND.includes(this.state); }
  onPoiseBreak(C) { this.interrupt(); this.breath = 0; this.combo = 0; this.poiseCd = 15; this.setState('reel'); C?.ev('bossSfx', this, 'scream'); }
  takeHit(dmg, dir, stagger, C) {
    if (!this.alive || this.state === 'intro') return false;
    // who struck him: the knight standing where the blow came from
    if (C && dir) {
      let best = null, bs = 0.5;
      for (const k of C.knights) { if (k.downed) continue; const dx = this.pos.x - k.pos.x, dz = this.pos.z - k.pos.z, l = Math.hypot(dx, dz) || 1; if (l > 16) continue; const s = (dx * dir.x + dz * dir.z) / l; if (s > bs) { bs = s; best = k; } }
      if (best) this.threat.set(best, (this.threat.get(best) || 0) + dmg);
      if (this.alt < 1) this.hug += dmg;
    }
    // in the air he cannot be killed outright: only the wards cast him down
    if (this.phase === 2) {
      const floor = this.maxHp * 0.34;
      if (this.hp - dmg < floor) { dmg = Math.max(0, this.hp - floor); if (C && (C.time || 0) - (this.remindT || -99) > 14) { this.remindT = C.time || 0; C.ev('wardsActive', this); } }
      if (dmg <= 0) { this.hitFlash = 0.5; return false; }
    }
    return super.takeHit(dmg, dir, stagger, C);
  }
  // a completed ward calls down heaven's light upon him: it burns the lesser things about the altar, and he falls
  wardStrike(C) {
    this.wardsDone++; this.hitFlash = 1; this.interrupt(); this.breath = 0; this.combo = 0;
    this.hp = Math.max(Math.min(this.hp, this.maxHp * 0.12), this.hp - this.maxHp * 0.05);
    const W = C.world;
    W.altars.forEach((a, i) => { if (a.state === 'cleansed' && !this.wardSeen.has(i)) { this.wardSeen.add(i); C.ev('slam', new THREE.Vector3(a.x, a.y ?? W.heightAt(a.x, a.z), a.z), 10, 400); } });
    if (!this.alive) return;
    if (this.alt > 1.5) this.setState('struck'); else { this.alt = 0; this.fly = 0; this.setState('stunned'); }
  }
  // his strength is set by who has come: a companion counts for a little more than half a player
  size(C) {
    this.sized = true; let n = 0; for (const k of C.knights) n += k.isAI ? 0.55 : 1; n = Math.max(1, n);
    const f = this.hp / this.maxHp; this.maxHp = Math.round(9000 * (1 + 0.55 * (n - 1))); this.hp = this.maxHp * f; this.maxPoise = this.poise = 900 * n; this.cad = 1 + 0.07 * (n - 1); this.party = n;
  }
  endAttack(cd) { this.aimT = null; this.breath = 0; this.combo = 0; this.cd = cd / this.cad; this.setState('stalk'); }
  // burning ground: a pool of fire that lies for a while (drawn, and synced, as a telegraph)
  pool(C, x, z, r, dur) {
    if (this.tele.map.size > 46) return;
    let n = 0; for (const T of this.tele.map.values()) if (T.shape === 'pool' && Math.hypot(T.x - x, T.z - z) < r * 0.7 && T.dur - T.t > dur * 0.5 && ++n) break;
    if (!n) this.tele.add('pool', x, z, r, 0, 0, dur, 2, 0);
  }
  burn(dt, C) {
    this.burnT = (this.burnT || 0) - dt; if (this.burnT > 0) return; this.burnT = 0.5;
    for (const T of this.tele.map.values()) {
      if (T.shape !== 'pool' || T.t < 0.3 || T.t > T.dur - 0.4) continue;
      for (const k of C.knights) if (!k.downed && Math.hypot(k.pos.x - T.x, k.pos.z - T.z) < T.a) { _d0.set(T.x, 0, T.z); this.hurt(C, k, 6, _d0, { unblockable: true, fire: true }); }
    }
  }
  // those the jet of his breath lies across (on the ground: from (ox, oz) along yaw)
  jetDamage(C, ox, oz, yaw, len, half, dmg) {
    for (const k of C.knights) {
      if (k.downed) continue; const dx = k.pos.x - ox, dz = k.pos.z - oz, dd = Math.hypot(dx, dz); if (dd > len || dd < 0.5) continue;
      if (Math.abs(angleDiff(yaw, Math.atan2(dx, dz))) < half + 0.55 / dd) { _d0.set(ox, 0, oz); this.hurt(C, k, dmg, _d0, { unblockable: true, fire: true }); }
    }
  }
  // Whom he goes for. Not simply the nearest: the one kneeling at a ward or over a fallen brother, the wounded, the
  // one who has strayed from the rest, the one who has been hurting him; less the one hiding behind a guard, and
  // less the one he has only just struck.
  chooseTarget(C, dt) {
    this.retarget -= dt;
    const cur = this.target && !this.target.downed && C.knights.includes(this.target) ? this.target : null;
    if (cur && (this.retarget > 0 || (this.state !== 'stalk' && this.state !== 'circle'))) return cur;
    const now = C.time || 0, air = this.alt > 3; let best = null, bs = -1e9, human = false;
    for (const k of C.knights) if (!k.downed && !k.isAI) human = true;
    for (const k of C.knights) {
      if (k.downed) continue;
      const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      let s = 110 / (d + 7) + (k === cur ? 3 : 0);
      if (k.praying) { let rev = false; for (const o of C.knights) if (o.downed && o.pos.distanceTo(k.pos) < 2.8) rev = true; s += rev ? 7 : air ? 9 : 6; }
      if (k.hp < k.maxHp * 0.4) s += 6;
      let ally = false; for (const o of C.knights) if (o !== k && !o.downed && o.pos.distanceTo(k.pos) < 9) ally = true;
      if (!ally && C.knights.length > 1) s += 4;
      s += Math.min(8, (this.threat.get(k) || 0) / 45);
      if (k.blocking && k.stamina > 40) s -= 6;
      if (now - (this.struckAt.get(k) ?? -99) < 2.5) s -= 5;
      if (k.isAI && human) s -= 4;   // (he knows which of them are men)
      if (s > bs) { bs = s; best = k; }
    }
    this.retarget = 1.4; this.target = best; return best;
  }
  // (a companion cannot read the ground as a player can, and is struck far more often: his harness turns more of it)
  hurt(C, k, dmg, from, opts) { if (k && !k.downed) this.struckAt.set(k, C.time || 0); super.hurt(C, k, k && k.isAI ? dmg * 0.3 : dmg, from, opts); }
  // what to do on the ground, by where they are
  choose(C, T, d, ang) {
    const P = this.phase, o = [], aa = Math.abs(ang); let near = 0, behind = 0, front = 0;
    for (const k of C.knights) {
      if (k.downed) continue; const dx = k.pos.x - this.pos.x, dz = k.pos.z - this.pos.z, dd = Math.hypot(dx, dz), a = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
      if (dd < 9) near++; if (dd < 14 && a > 2.0) behind++; if (dd < 20 && dd > 6 && a < 0.8) front++;
    }
    if (behind && this.cds.tail <= 0) o.push(['tail', 3 + behind * 1.6]);
    const crowded = this.hug > 120 * this.party;   // (they are all over him, and it is telling)
    if ((near >= 3 || (near >= 2 && crowded)) && this.cds.buffet <= 0) o.push(['buffet', 1 + near * 0.6]);
    if (crowded && this.cds.hop <= 0) o.push(['hop', 4]);
    if (d > 5.5 && d < 13.5 && aa < 1.15) o.push(['strike', (T.blocking ? 1.1 : 3.2) * (T.stamina < 25 ? 1.6 : 1)]);
    if (d < 10 && aa < 2.0) o.push(['claw', aa > 0.8 || d < 6 ? 3 : 1.5]);
    if (d < 8.5 && aa < 1.2 && this.cds.slam <= 0) o.push(['stomp', T.blocking ? 3 : d < 6 ? 2.2 : 1]);
    if (d > 7 && d < 25 && aa < 1.3 && this.cds.breath <= 0) o.push(['breath', (d > 12 ? 3 : 1.4) + front * 0.9]);
    if ((d > 14 || (T.praying && d > 9)) && this.cds.pounce <= 0) o.push(['pounce', T.praying ? 6 : this.far > 2 ? 6 : 3]);
    if (P >= 3 && this.cds.storm <= 0) o.push(['storm', 2.4]);
    if (P >= 3 && this.cds.charge <= 0 && d > 9 && aa < 0.9) o.push(['charge', 2.6]);
    if (this.cds.roar <= 0 && P !== 2) o.push(['roar', 1.6]);
    if (!o.length) return null;
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.35; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) return s; } return o[0][0];
  }
  // what to do from the air
  chooseAir(C, T) {
    let praying = 0; for (const k of C.knights) if (!k.downed && k.praying) praying++;
    const o = [['strafe', praying ? 2.6 : 1.6], ['spit', praying ? 3.2 : 1.2], ['swoop', praying ? 1 : 2], ['dive', (praying ? 1 : 3) + (this.airN >= 2 ? 4 : 0)]];
    if (this.airN >= 3) return 'dive';
    let tot = 0; for (const e of o) { if (e[0] === this.last) e[1] *= 0.3; tot += e[1]; }
    let r = R() * tot; for (const [s, w] of o) { r -= w; if (r <= 0) return s; } return 'strafe';
  }
  simulate(dt, C) {
    this.t += dt; this.cd -= dt; this.poiseCd -= dt; this.runLater(dt); for (const k in this.cds) this.cds[k] -= dt;
    const W = C.world, pos = this.pos; this.world = W;
    if (!this.sized) this.size(C);
    const cad = this.cad * (this.phase === 1 ? 0.82 : 1);   // (on the summit, before he is hurt, he takes his time)
    this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * 0.025 * dt);
    this.hug = Math.max(0, this.hug - dt * 16);
    this.threatT = (this.threatT || 0) - dt; if (this.threatT <= 0) { this.threatT = 1; for (const [k, v] of this.threat) this.threat.set(k, v * 0.88); }
    this.burn(dt, C);
    const wv = this.wv.set(0, 0, 0); let free = true;   // (free: he moves by his own velocity this step)
    if (this.state === 'death') { this.alt = Math.max(0, this.alt - dt * (5 + this.t * 16)); this.fly = Math.max(0, this.fly - dt * 0.7); this.breath = 0; this.vel.multiplyScalar(0.9); this.gY = W.heightAt(pos.x, pos.z); pos.y = this.gY; return; }
    const T = this.chooseTarget(C, dt), tp = T ? T.pos : pos;
    const dx = tp.x - pos.x, dz = tp.z - pos.z, d = Math.hypot(dx, dz), want = T ? Math.atan2(dx, dz) : this.yaw, ang = angleDiff(this.yaw, want);
    if (T) this.look.set(tp.x, tp.y + 1.3, tp.z);
    const face = (rate, yaw = want) => { this.yaw = dampAngle(this.yaw, yaw, rate, dt); };
    const gp = (x, z) => new THREE.Vector3(x, W.heightAt(x, z), z);
    const lead = (k, s) => (k && k.vel ? [k.pos.x + k.vel.x * s, k.pos.z + k.vel.z * s] : [tp.x, tp.z]);
    const into = (x, z, r) => { const l = Math.hypot(x, z); return l > r ? [x * r / l, z * r / l] : [x, z]; };
    if (this.phase === 3 && this.hp > this.maxHp * 0.28) this.hp = this.maxHp * 0.28;   // cast down, his strength is spent: the last of the fight stays short
    const hpF = this.hp / this.maxHp;
    // ---- the fight changes
    if (this.phase === 1 && hpF < 0.7 && this.state === 'stalk') { this.phase = 2; this.interrupt(); this.setState('takeoff'); C.ev('bossPhase', this, 2); }
    if (this.phase === 2 && this.alt < 0.5) this.groundT -= dt;   // (in the air phase he only stays down so long)
    if (this.phase === 2 && this.state === 'stalk' && this.groundT <= 0 && this.cd <= 0.3) { this.interrupt(); this.setState('takeoff'); }
    switch (this.state) {
      case 'intro': { // he comes down out of the storm onto the summit, and roars at them
        const L = DRG.land;
        if (this.t < 0.2 && T) this.yaw = want;
        if (this.t < L) { const u = this.t / L; this.alt = 40 * (1 - u) * (1 - u); this.fly = 1; }
        else {
          if (!this.hitDone) { this.hitDone = true; this.alt = 0; C.ev('slam', gp(pos.x, pos.z), 9); C.ev('bossSfx', this, 'crash'); }
          this.fly = this.t < 6 ? 1 - (this.t - L) / (6 - L) * 0.45 : this.t < 8.3 ? 0.55 : Math.max(0, 0.55 - (this.t - 8.3) * 0.6);
          if (this.t > 6 && !this.roared) { this.roared = true; C.ev('bossSfx', this, 'roar'); }
        }
        if (this.t > DRG.intro) { this.fly = 0; this.cd = 0.6; this.setState('stalk'); }
        break;
      }
      case 'stalk': { // he comes on, turning to keep them before him
        face(1.7);
        if (T && d > 9.5) wv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar((d > 16 ? 5.6 : 4.2) * Math.sqrt(cad) * (this.phase === 3 ? 1.2 : 1));
        else if (T && d < 6.2 && Math.abs(ang) < 1.3) wv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-2.8);   // too close under him: he gives ground to get his jaws on them
        this.far = d > 15 ? (this.far || 0) + dt : 0;
        if (T && this.cd <= 0 && this.t > 0.3) {
          const s = this.choose(C, T, d, ang);
          if (s) { this.last = s; this.combo = 0; this.quick = false; this.biteMax = this.phase >= 3 ? 2 + (R() < 0.5 ? 1 : 0) : 1 + (R() < 0.55 ? 1 : 0); this.clawMax = this.phase >= 3 || R() < 0.4 ? 2 : 1; this.setState(s); }
        }
        break;
      }
      case 'strike': { // the neck drawn back; then the jaws come down where the circle burns. And again, on wherever he has got to
        const n = this.combo, wind = DRG.bite[Math.min(2, n)] / cad, last = n + 1 >= this.biteMax;
        if (!this.aimT) {
          const a = clamp(ang, -1.15, 1.15), yy = this.yaw + a, dd = clamp(d, 6.5, 12.5);
          this.ap.set(pos.x + Math.sin(yy) * dd, pos.z + Math.cos(yy) * dd); this.wind = wind; this.atk = n; this.lockYaw = this.yaw + a * 0.6;
          this.aimT = this.warn('circle', this.ap.x, this.ap.y, 2.7, 0, 0, wind + 0.1, 0, 1, (Tl) => { this.hurtIn(C, Tl, last ? 52 : 42, pos.clone(), last ? { knockdown: true } : { knockback: 6, stagger: true }); C.ev('slam', gp(Tl.x, Tl.z), 2.4); });
          C.ev('bossSfx', this, n ? 'snarl' : 'growl');
        }
        face(2.4, this.lockYaw);
        if (this.t > wind + 0.1 + (last ? DRG.biteRec : 0.28)) { this.aimT = null; if (!last && T && d < 14 && Math.abs(ang) < 1.5) { this.combo++; this.setState('strike'); } else this.endAttack(0.9); }
        break;
      }
      case 'claw': { // the hand of a wing lifted; then it rakes across the fan
        const wind = DRG.claw / cad;
        if (!this.aimT) {
          const a = clamp(ang, -1.8, 1.8), yy = this.yaw + a;
          this.atk = a < 0 ? 0 : 1; this.wind = wind; this.ap.set(pos.x + Math.sin(yy) * 6, pos.z + Math.cos(yy) * 6);
          this.aimT = this.warn('cone', pos.x + Math.sin(this.yaw) * 1.5, pos.z + Math.cos(this.yaw) * 1.5, 8.8, 0.62, yy, wind + 0.1, 0, 1, (Tl) => this.hurtIn(C, Tl, 28, pos.clone(), { knockback: 9, stagger: true }));
          C.ev('bossSfx', this, 'snarl');
        }
        if (this.t > wind + 0.7) { this.aimT = null; if (this.combo + 1 < this.clawMax && T && d < 11) { this.combo++; this.setState('claw'); } else this.endAttack(0.8); }
        break;
      }
      case 'tail': { // the tail drawn to one side; then it comes round through everything behind him
        const wind = DRG.tail / cad;
        if (!this.aimT) {
          this.atk = R() < 0.5 ? 0 : 1; this.wind = wind; const hx = pos.x - Math.sin(this.yaw) * 2.5, hz = pos.z - Math.cos(this.yaw) * 2.5;
          this.aimT = this.warn('cone', hx, hz, 15, 1.3, this.yaw + Math.PI, wind + 0.12, 0, 1, (Tl) => this.hurtIn(C, Tl, 30, new THREE.Vector3(hx, 0, hz), { knockdown: true, knockback: 11 }));
          C.ev('bossSfx', this, 'hiss');
        }
        if (this.t > wind + 0.8) { this.cds.tail = 5 / cad; this.endAttack(0.5); }
        break;
      }
      case 'buffet': { // he rears with his wings spread; their beat throws down everyone about him
        const wind = DRG.buffet / cad;
        if (!this.aimT) { this.wind = wind; this.aimT = this.warn('circle', pos.x, pos.z, 11.5, 0, 0, wind + 0.1, 0, 4, (Tl) => { this.hurtIn(C, Tl, 12, pos.clone(), { knockback: 17, stagger: true }); C.ev('bossSfx', this, 'hiss'); }); C.ev('bossSfx', this, 'inhale'); }
        if (this.t > wind + 0.9) { this.cds.buffet = 16 / cad; this.cds.breath = Math.min(this.cds.breath, 0.5); this.endAttack(0.3); }
        break;
      }
      case 'stomp': { // up on his hind legs; then his whole weight down on his hands. No guard holds against it
        const wind = DRG.slam / cad;
        if (!this.aimT) {
          this.wind = wind; const cx = pos.x + Math.sin(this.yaw) * 4.5, cz = pos.z + Math.cos(this.yaw) * 4.5; this.ap.set(cx, cz);
          this.aimT = this.warn('circle', cx, cz, 5.6, 0, 0, wind + 0.1, 0, 1, (Tl) => { this.hurtIn(C, Tl, 40, pos.clone(), { knockdown: true, unblockable: true }); C.ev('slam', gp(cx, cz), 5.6); C.ev('bossSfx', this, 'crash'); });
          C.ev('bossSfx', this, 'growl');
        }
        if (this.t > wind + 1.1) { this.cds.slam = 6 / cad; this.endAttack(0.8); }
        break;
      }
      case 'breath': { // he draws breath, the fire showing in his throat; then the jet crosses the fan, bending after the one he wants
        const wind = (this.quick ? DRG.quick : DRG.breath) / cad, len = this.quick ? 1.5 : this.phase >= 3 ? 3.4 : 2.4;
        if (!this.aimT) {
          const mid = this.yaw + clamp(ang, -1.25, 1.25), sg = R() < 0.5 ? 1 : -1;
          this.aim0 = mid - sg * 0.62; this.aim1 = mid + sg * 0.62; this.aim = this.aim0; this.aimMid = mid; this.wind = wind; this.breathTick = 0; this.poolN = 0;
          this.ap.set(pos.x + Math.sin(this.yaw) * 5.5, pos.z + Math.cos(this.yaw) * 5.5);
          this.aimT = this.warn('cone', this.ap.x, this.ap.y, 19, 0.8, mid, wind + 0.15, 2, 0, null); C.ev('bossSfx', this, 'inhale');
        }
        if (this.t >= wind && this.t < wind + len) {
          if (!this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'roar'); }
          this.breath = 1; const u = (this.t - wind) / len;
          let a = lerp(this.aim0, this.aim1, this.phase >= 3 && !this.quick ? smooth(1 - Math.abs(1 - u * 2)) : smooth(u));   // (cast down, it comes back across)
          if (T) a += clamp(angleDiff(a, Math.atan2(tp.x - this.ap.x, tp.z - this.ap.y)), -0.3, 0.3) * 0.55;
          this.aim = this.aimMid + clamp(angleDiff(this.aimMid, a), -0.78, 0.78);
          this.breathTick -= dt;
          if (this.breathTick <= 0) {
            this.breathTick = 0.2; this.jetDamage(C, this.ap.x, this.ap.y, this.aim, 19, 0.17, 9);
            if (this.poolN++ % 2 === 0) { const r = 6 + R() * 11; this.pool(C, this.ap.x + Math.sin(this.aim) * r, this.ap.y + Math.cos(this.aim) * r, 2.3, 5.5); }
          }
        } else this.breath = 0;
        if (this.t > wind + len + 0.7) { this.cds.breath = 7 / cad; this.endAttack(0.7); }
        break;
      }
      case 'pounce': { // crouched; then he is in the air and coming down on the circle
        const wind = DRG.pounce / cad, air = DRG.pounceAir;
        if (!this.aimT) {
          let [gx, gz] = lead(T, 0.5); [gx, gz] = into(gx, gz, 24);
          const l = Math.hypot(gx - pos.x, gz - pos.z) || 1, back = Math.min(3.5, l * 0.5);
          this.ap.set(gx, gz); this.from.copy(pos); this.to.set(gx - (gx - pos.x) / l * back, gz - (gz - pos.z) / l * back); this.wind = wind; this.lockYaw = Math.atan2(gx - pos.x, gz - pos.z);
          this.aimT = this.warn('circle', gx, gz, 6.8, 0, 0, wind + air, 0, 1, (Tl) => { this.hurtIn(C, Tl, 48, pos.clone(), { knockdown: true, unblockable: true }); C.ev('slam', gp(gx, gz), 6.8); C.ev('bossSfx', this, 'crash'); });
          C.ev('bossSfx', this, 'growl');
        }
        face(6, this.lockYaw);
        if (this.t > wind && this.t < wind + air) { const u = (this.t - wind) / air; pos.x = lerp(this.from.x, this.to.x, u); pos.z = lerp(this.from.z, this.to.y, u); this.alt = Math.sin(Math.PI * u) * 5.5; this.fly = Math.sin(Math.PI * u) * 0.55; free = false; }
        else if (this.t >= wind + air) { this.alt = 0; this.fly = Math.max(0, this.fly - dt * 2.5); free = false; }
        if (this.t > wind + air + 1.15) { this.alt = 0; this.fly = 0; this.cds.pounce = 9 / cad; this.far = 0; this.endAttack(0.6); }
        break;
      }
      case 'hop': { // crowded: he springs back off his hands with a beat of the wings, and burns the ground he stood on
        const wind = DRG.hop / cad, air = DRG.hopAir;
        if (!this.aimT) {
          this.wind = wind; this.from.copy(pos); const [bx, bz] = into(pos.x - Math.sin(this.yaw) * 10, pos.z - Math.cos(this.yaw) * 10, 24); this.to.set(bx, bz);
          this.aimT = this.warn('circle', pos.x, pos.z, 7.5, 0, 0, wind + 0.1, 0, 4, (Tl) => this.hurtIn(C, Tl, 10, new THREE.Vector3(Tl.x, 0, Tl.z), { knockback: 13, stagger: true })); C.ev('bossSfx', this, 'hiss');
        }
        if (this.t > wind && this.t < wind + air) { const u = (this.t - wind) / air; pos.x = lerp(this.from.x, this.to.x, smooth(u)); pos.z = lerp(this.from.z, this.to.y, smooth(u)); this.alt = Math.sin(Math.PI * u) * 3.2; this.fly = Math.sin(Math.PI * u) * 0.8; free = false; }
        if (this.t > wind + air + 0.12) { this.aimT = null; this.alt = 0; this.fly = 0; this.hug = 0; this.cds.hop = 22 / cad; this.quick = true; this.setState('breath'); }
        break;
      }
      case 'charge': { // cast down: he runs the lane with his head low, and everything in it goes under him
        const wind = DRG.charge / cad, run = DRG.chargeRun;
        if (!this.aimT) {
          let len = clamp(d + 7, 15, 27); const [ex, ez] = into(pos.x + Math.sin(want) * len, pos.z + Math.cos(want) * len, 25); len = Math.max(9, Math.hypot(ex - pos.x, ez - pos.z));
          this.lockYaw = want; this.runLen = Math.max(4, len - 5); this.from.copy(pos); this.wind = wind; this.hitSet = new Set();
          this.aimT = this.warn('line', pos.x + Math.sin(want) * 2, pos.z + Math.cos(want) * 2, len, 6.4, want, wind + 0.15, 0, 0, null); C.ev('bossSfx', this, 'roar');
        }
        face(9, this.lockYaw);
        if (this.t > wind && this.t < wind + run) {
          const u = smooth((this.t - wind) / run), fx = Math.sin(this.lockYaw), fz = Math.cos(this.lockYaw); pos.x = this.from.x + fx * this.runLen * u; pos.z = this.from.z + fz * this.runLen * u; free = false;
          for (const k of C.knights) { if (k.downed || this.hitSet.has(k)) continue; const kx = k.pos.x - pos.x, kz = k.pos.z - pos.z, al = kx * fx + kz * fz, ac = kx * fz - kz * fx; if (al > -2 && al < 7 && Math.abs(ac) < 3.5) { this.hitSet.add(k); this.hurt(C, k, 44, pos.clone(), { knockdown: true, knockback: 9 }); } }
        }
        if (this.t > wind + run + 0.9) { this.cds.charge = 12 / cad; this.endAttack(0.5); }
        break;
      }
      case 'storm': { // cast down: he rears and pours fire into the sky, and it comes down on each of them
        this.breath = this.t > 0.8 && this.t < 2.6 ? 2 : 0;
        if (!this.hitDone && this.t > 0.9) {
          this.hitDone = true; C.ev('bossSfx', this, 'roar');
          for (const k of C.knights) {
            if (k.downed) continue;
            for (let j = 0; j < (k.isAI ? 1 : 3); j++) this.later(0.3 + j * 0.75 + R() * 0.2, () => {
              if (k.downed) return; const a = R() * TAU, r = j ? 1.2 + R() * 2.6 : 0, [lx, lz] = lead(k, 0.5), x = lx + Math.sin(a) * r, z = lz + Math.cos(a) * r;
              this.warn('circle', x, z, 3.3, 0, 0, 1.3, 2, 5, (Tl) => { this.hurtIn(C, Tl, 22, new THREE.Vector3(x, 0, z), { knockback: 6, unblockable: true, fire: true }); this.pool(C, x, z, 2.6, 5); }, true);
            }, true);
          }
        }
        if (this.t > 3.4) { this.cds.storm = 17 / cad; this.endAttack(0.8); }
        break;
      }
      case 'roar': // he calls, and the lesser things come up out of the rock
        if (this.t > 0.8 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'roar'); C.summonAround(pos, 'shade', this.phase >= 3 ? 2 : 2 + Math.round(this.party)); }
        if (this.t > 2.4) { this.cds.roar = 40; this.endAttack(0.6); }
        break;
      case 'reel': // his guard is broken: the head comes down within reach. Then he throws them off
        if (this.t > 2.6) { this.aimT = null; this.cds.buffet = 0; this.setState('buffet'); }
        break;
      case 'stunned': // heaven's light has struck him down: he lies there
        this.breath = 0; this.alt = 0; this.fly = Math.max(0.25, this.fly - dt * 1.5);
        if (this.t > DRG.stun) {
          this.aimT = null;
          if (this.wardsDone >= 3 && this.phase < 3) { this.hp = Math.min(this.hp, this.maxHp * 0.25); this.phase = 3; this.cad *= 1.15; this.dmgScale = 1.1; this.cds.storm = 3; this.cds.charge = 1; this.cds.roar = 0; C.ev('bossPhase', this, 3); this.setState('rage'); }
          else { this.groundT = 0; this.cd = 0; this.setState('buffet'); }
        }
        break;
      case 'rage': // cast down for good: his wings will not lift him, and he means to take them with him
        this.fly = Math.max(0, this.fly - dt * 0.4);
        if (this.t > 0.7 && !this.hitDone) { this.hitDone = true; C.ev('bossSfx', this, 'roar'); C.summonAround(pos, 'shade', 2); }
        if (this.t > 2.8) { this.fly = 0; this.endAttack(0.3); }
        break;
      // ---- in the air
      case 'takeoff': { // a crouch, a beat of the wings that throws them back, and he is up
        if (!this.aimT) { this.wind = 1.0; this.aimT = this.warn('circle', pos.x, pos.z, 10.5, 0, 0, 1.0, 0, 4, (Tl) => { this.hurtIn(C, Tl, 10, pos.clone(), { knockback: 16, stagger: true }); C.ev('bossSfx', this, 'hiss'); }); C.ev('bossSfx', this, 'roar'); }
        if (this.t > 0.6) this.fly = Math.min(1, this.fly + dt * 1.4);
        if (this.t > 1.0) { const u = clamp((this.t - 1.0) / (DRG.takeoff - 1.0), 0, 1); this.alt = DRG.alt * smooth(u); wv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(4 * u); }
        if (this.t > DRG.takeoff) { this.aimT = null; this.fly = 1; this.airN = 0; this.fv = 6; if (!this.wardsOn) { this.wardsOn = true; C.ev('wardsActive', this); } this.airWait = 2.2; this.setState('circle'); }
        break;
      }
      case 'circle': { // he rides round the summit above its rim, and picks his moment
        this.fly = 1; this.breath = 0;
        const a = Math.atan2(pos.x, pos.z), dir = this.ringDir || (this.ringDir = R() < 0.5 ? 1 : -1), rr = Math.hypot(pos.x, pos.z);
        const ga = a + dir * 0.6, gr = DRG.ring + (DRG.ring - rr) * 0.4;
        this.steer(dt, Math.sin(ga) * gr, Math.cos(ga) * gr, 15, 1.5);
        this.alt = damp(this.alt, DRG.alt + Math.sin(this.t * 0.7) * 1.5, 1.2, dt);
        if (this.phase !== 2) { if (this.t > 1) this.startDive(C, T, lead, into); break; }   // (cast down, or the fight reset: he comes to ground)
        if (T && this.t > this.airWait / cad) {
          const s = this.chooseAir(C, T); this.last = s; this.airN++;
          if (s === 'dive') this.startDive(C, T, lead, into);
          else if (s === 'spit') { this.shots = 0; this.setState('spit'); }
          else this.startPass(C, s, T, lead);
        }
        break;
      }
      case 'strafe': case 'swoop': { // down onto the lane and along it: fire the length of it, or his talons through whoever stands in it
        const P = this.pass, strafe = this.state === 'strafe'; free = false;
        if (this.t < P.T1) {   // the turn in
          const u = this.t / P.T1, u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2, ox = pos.x, oz = pos.z;
          pos.x = h00 * P.x0 + h10 * P.m0x + h01 * P.px + h11 * P.m1x; pos.z = h00 * P.z0 + h10 * P.m0z + h01 * P.pz + h11 * P.m1z;
          if (Math.hypot(pos.x - ox, pos.z - oz) > 1e-3) this.yaw = dampAngle(this.yaw, Math.atan2(pos.x - ox, pos.z - oz), 10, dt);
          this.alt = lerp(P.a0, P.alt, smooth(u)); this.atk = 0;
        } else {
          const s0 = P.s, s = (this.t - P.T1) * P.spd, fx = Math.sin(P.yaw), fz = Math.cos(P.yaw); P.s = s; this.atk = 1;
          pos.x = P.px + fx * s; pos.z = P.pz + fz * s; this.yaw = dampAngle(this.yaw, P.yaw, 10, dt);
          const out = clamp((s - P.len + 8) / 14, 0, 1); this.alt = lerp(P.alt, DRG.alt, smooth(out));
          this.breath = strafe && s < P.len - 2 ? 1 : 0; this.aim = P.yaw;
          if (s < P.len) {
            if (strafe) while (P.drop < s + 4 && P.drop < P.len - 1) { this.pool(C, P.px + fx * P.drop + (R() - 0.5), P.pz + fz * P.drop + (R() - 0.5), 3.0, 7); P.drop += 3.3; }
            for (const k of C.knights) {
              if (k.downed || P.hit.has(k)) continue; const kx = k.pos.x - P.px, kz = k.pos.z - P.pz, al = kx * fx + kz * fz, ac = kx * fz - kz * fx;
              if (Math.abs(ac) < P.w / 2 + 0.4 && al > s0 - 1.5 && al < s + (strafe ? 5 : 3)) {
                P.hit.add(k);
                if (strafe) this.hurt(C, k, 26, _d0.set(pos.x, 0, pos.z), { unblockable: true, fire: true, knockback: 4 });
                else this.hurt(C, k, 38, _d0.set(k.pos.x - fx * 2, 0, k.pos.z - fz * 2), { knockdown: true, knockback: 15 });
              }
            }
          }
          if (s > P.len + 6) { this.breath = 0; this.fv = P.spd * 0.7; this.airWait = 2.6 + R() * 1.6; this.ringDir = (fx * pos.z - fz * pos.x) > 0 ? 1 : -1; this.setState('circle'); }
        }
        break;
      }
      case 'spit': { // he hangs on his wings over the rim and spits fire on them: on the ones kneeling first
        this.fly = 1; this.steer(dt, 0, 0, 1.5, 2.2); this.alt = damp(this.alt, 12.5, 1.5, dt);
        if (T) this.yaw = dampAngle(this.yaw, want, 2.5, dt);
        const n = Math.min(4, 1 + this.wardsDone + Math.floor(C.knights.length / 3));
        if (this.shots < n && this.t > 0.8 + this.shots * 0.55) {
          const list = C.knights.filter((k) => !k.downed).sort((a, b) => (b.praying ? 2 : 0) + (b.isAI ? 0 : 1) - (a.praying ? 2 : 0) - (a.isAI ? 0 : 1));
          const k = list[this.shots % Math.max(1, list.length)]; this.shots++;
          if (k) { const [x, z] = lead(k, k.praying ? 0 : 0.6); this.look.set(x, k.pos.y, z); this.warn('circle', x, z, 3.2, 0, 0, 1.6, 2, 5, (Tl) => { this.hurtIn(C, Tl, 24, new THREE.Vector3(x, 0, z), { knockback: 7, unblockable: true, fire: true }); this.pool(C, x, z, 3.0, 6); }, true); C.ev('bossSfx', this, 'erupt'); }
        }
        if (this.t > 0.8 + n * 0.55 + 0.9) { this.airWait = 2.6 + R() * 1.6; this.setState('circle'); }
        break;
      }
      case 'dive': { // he folds his wings and comes down on the circle with his whole weight
        const P = this.pass, u = clamp(this.t / P.T1, 0, 1), u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2, ox = pos.x, oz = pos.z; free = false;
        pos.x = h00 * P.x0 + h10 * P.m0x + h01 * P.px + h11 * P.m1x; pos.z = h00 * P.z0 + h10 * P.m0z + h01 * P.pz + h11 * P.m1z;
        if (Math.hypot(pos.x - ox, pos.z - oz) > 1e-3) this.yaw = dampAngle(this.yaw, Math.atan2(pos.x - ox, pos.z - oz), 8, dt);
        this.alt = P.a0 * (1 - Math.pow(u, 2.2));
        if (this.t >= P.T1) { this.alt = 0; this.aimT = null; this.groundT = this.phase === 2 ? 11 + this.wardsDone * 1.5 : 0; this.setState('landed'); }
        break;
      }
      case 'landed': // down: the wings fold, and he fights on the ground for a while
        this.alt = 0; this.fly = Math.max(0, this.fly - dt * 1.1); face(1.2);
        if (this.t > 1.25) { this.fly = 0; this.cds.tail = Math.min(this.cds.tail, 0.5); this.endAttack(0.2); }
        break;
      case 'struck': { // heaven's light has hit him in the air: he falls, toward the middle, where they can reach him
        this.breath = 0; free = false;
        if (!this.aimT) {
          const [tx, tz] = into(pos.x, pos.z, 19); this.to.set(tx, tz); this.from.copy(pos); this.a0 = this.alt; this.wind = clamp(Math.sqrt(this.alt / 6), 0.9, 1.8);
          this.aimT = this.warn('circle', tx, tz, 7.5, 0, 0, this.wind, 0, 1, (Tl) => { this.hurtIn(C, Tl, 26, gp(Tl.x, Tl.z), { knockback: 12, knockdown: true }); C.ev('slam', gp(Tl.x, Tl.z), 9); C.ev('bossSfx', this, 'crash'); }); C.ev('bossSfx', this, 'scream');
        }
        const u = clamp(this.t / this.wind, 0, 1); pos.x = lerp(this.from.x, this.to.x, u); pos.z = lerp(this.from.z, this.to.y, u); this.alt = this.a0 * (1 - u * u); this.fly = 1 - u * 0.5;
        if (this.t >= this.wind) { this.alt = 0; this.aimT = null; this.setState('stunned'); }
        break;
      }
    }
    if (free) { this.vel.x = damp(this.vel.x, wv.x, 2.6, dt); this.vel.z = damp(this.vel.z, wv.z, 2.6, dt); pos.x += this.vel.x * dt; pos.z += this.vel.z * dt; } else this.vel.set(0, 0, 0);
    // he keeps to the summit on the ground, and over it in the air
    { const lim = this.alt > 2 ? 62 : 25, r = Math.hypot(pos.x, pos.z); if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; } }
    // knights cannot walk through him
    if (this.alt < 2.5) for (const k of C.knights) { const kx = k.pos.x - pos.x, kz = k.pos.z - pos.z, dd = Math.hypot(kx, kz); if (dd < 2.9 && dd > 1e-3) { k.pos.x = pos.x + kx / dd * 2.9; k.pos.z = pos.z + kz / dd * 2.9; } }
    this.gY = W.heightAt(pos.x, pos.z); pos.y = this.gY;
  }
  // flight: turn toward a point at no more than `turn`, and fly at `speed`
  steer(dt, gx, gz, speed, turn) {
    const dA = angleDiff(this.yaw, Math.atan2(gx - this.pos.x, gz - this.pos.z)); this.yaw += clamp(dA, -turn * dt, turn * dt);
    this.fv = damp(this.fv, speed, 1.6, dt); this.wv.set(Math.sin(this.yaw) * this.fv, 0, Math.cos(this.yaw) * this.fv);
    this.vel.x = this.wv.x; this.vel.z = this.wv.z;
  }
  // a run along a lane: a smooth turn in from where he is (T1 seconds), then straight down it
  startPass(C, kind, T, lead) {
    const pos = this.pos, strafe = kind === 'strafe', w = strafe ? 7 : 5; let len = strafe ? 46 : 40;
    // through the ward where they kneel, if they do; else through the one he wants
    let qx, qz; const pr = C.knights.find((k) => !k.downed && k.praying);
    if (strafe && pr) { qx = pr.pos.x; qz = pr.pos.z; } else [qx, qz] = lead(T, 0.8);
    let dx = qx - pos.x, dz = qz - pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; len = Math.min(len, Math.min(len * 0.5, l + 5) + len * 0.5);
    const pre = Math.min(len * 0.5, l + 5), px = qx - dx * pre, pz = qz - dz * pre, yaw = Math.atan2(dx, dz), dist = Math.hypot(px - pos.x, pz - pos.z), T1 = clamp(dist / 16, 1.8, 3.2), L = Math.max(10, dist) * 0.9;
    this.pass = { kind, x0: pos.x, z0: pos.z, a0: this.alt, px, pz, yaw, len, w, T1, spd: strafe ? 21 : 25, alt: strafe ? 6 : 2.4, m0x: Math.sin(this.yaw) * L, m0z: Math.cos(this.yaw) * L, m1x: dx * L, m1z: dz * L, s: 0, drop: 2, hit: new Set() };
    this.wind = T1;
    this.warn('line', px, pz, len, w, yaw, T1 + len / this.pass.spd, strafe ? 2 : 0, 0, null);
    C.ev('bossSfx', this, strafe ? 'inhale' : 'scream');
    this.setState(kind);
  }
  startDive(C, T, lead, into) {
    const pos = this.pos; let [gx, gz] = T ? lead(T, 0.9) : [0, 0]; [gx, gz] = into(gx, gz, 20);
    let dx = gx - pos.x, dz = gz - pos.z; const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
    const T1 = clamp(dist / 15, 1.7, 2.4), L = Math.max(8, dist) * 0.8;
    this.pass = { kind: 'dive', x0: pos.x, z0: pos.z, a0: this.alt, px: gx - dx * 2.5, pz: gz - dz * 2.5, T1, m0x: Math.sin(this.yaw) * L, m0z: Math.cos(this.yaw) * L, m1x: dx * L, m1z: dz * L };
    this.wind = T1; this.ap.set(gx, gz);
    this.aimT = this.warn('circle', gx, gz, 8.5, 0, 0, T1, 0, 1, (Tl) => { this.hurtIn(C, Tl, 52, new THREE.Vector3(gx, 0, gz), { knockdown: true, unblockable: true, knockback: 8 }); C.ev('slam', new THREE.Vector3(gx, C.world.heightAt(gx, gz), gz), 8.5); C.ev('bossSfx', this, 'crash'); });
    C.ev('bossSfx', this, 'scream');
    this.setState('dive');
  }
  snap() { return [...this.baseSnap(), +this.fly.toFixed(2), this.breath, this.wardsDone, +this.aim.toFixed(2), +this.wind.toFixed(2), +this.ap.x.toFixed(1), +this.ap.y.toFixed(1), +this.look.x.toFixed(1), +this.look.y.toFixed(1), +this.look.z.toFixed(1), this.tele.snap(), this.maxHp]; }
  applySnap(s, dt, W) {
    const p0 = this.pos.clone(), y0 = this.yaw; super.applySnap(s, dt); this.netYaw = s[4]; this.yaw = y0;
    (this.netPos ||= new THREE.Vector3()).set(s[1], s[2], s[3]); this.pos.copy(p0.distanceTo(this.netPos) > 14 ? this.netPos : p0);
    this.netAlt = s[10] || 0; if (this.altL === undefined || Math.abs(this.altL - this.netAlt) > 12) this.altL = this.netAlt; this.alt = this.altL;
    this.fly = s[11]; this.breath = s[12]; this.wardsDone = s[13]; this.aim = s[14]; this.wind = s[15] || 0.8; this.ap.set(s[16], s[17]); this.look.set(s[18], s[19], s[20]); this.tele.apply(s[21]); if (s[22]) this.maxHp = s[22];
    if (W) { this.world = W; this.gY = W.heightAt(this.pos.x, this.pos.z); }
  }
  teleFx(T, fx, world) {
    if (!fx || !T.fxk) return;
    const y = world ? world.heightAt(T.x, T.z) : 0, p = _d1.set(T.x, y, T.z);
    if (T.fxk === 1) { for (let i = 0; i < 3; i++) fx.dust(_d2.set(T.x + (R() - 0.5) * T.a, y, T.z + (R() - 0.5) * T.a), 8, [0.3, 0.29, 0.3]); }
    else if (T.fxk === 4) { const n = 14; for (let i = 0; i < n; i++) { const a = i / n * TAU; fx.dust(_d2.set(T.x + Math.sin(a) * T.a * 0.6, y, T.z + Math.cos(a) * T.a * 0.6), 4, [0.4, 0.4, 0.42]); } }
    else if (T.fxk === 5) { fx.explosion(p, T.a, [1, 0.42, 0.1]); }
  }
  // ---------------------------------------------------------------- his body (every client)
  animate(dt, time, fx) {
    const B = this.B, Q = this.Q, st = this.state, W = this.world, U = this.mat.userData.u, pos = this.pos;
    this.tele.update(dt, W, fx);
    if (this.netPos) {   // (a client: the host's word only arrives fifteen times a second)
      const k = 1 - Math.exp(-12 * dt); pos.lerp(this.netPos, k); this.altL += (this.netAlt - this.altL) * k; this.alt = this.altL; this.yaw = dampAngle(this.yaw, this.netYaw ?? this.yaw, 12, dt); this.t += dt;
      if (W) this.gY = W.heightAt(pos.x, pos.z);
    }
    const T = this.t, wind = this.wind || 0.8, H = (x, z) => (W ? W.heightAt(x, z) : 0);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4); U.uHit.value = this.hitFlash * 0.5; this.wingMat.userData.u.uHit.value = this.hitFlash * 0.3;
    if (this.sun) this.wingMat.userData.u.uLightDir.value.copy(this.sun.position).sub(this.sun.target.position).normalize();
    // ---- how he is moving (measured here, so it is the same on every client)
    const idt = dt > 1e-4 ? 1 / dt : 0, pv = this.pv;
    if (!this.seen) { this.seen = true; this.prev.copy(pos); this.prevYaw = this.yaw; this.prevAlt = this.alt; this.pT = T; this.pSt = st; }
    pv.x = damp(pv.x, clamp((pos.x - this.prev.x) * idt, -30, 30), 8, dt); pv.z = damp(pv.z, clamp((pos.z - this.prev.z) * idt, -30, 30), 8, dt);
    const vAlt = (this.alt - this.prevAlt) * idt, sp = Math.hypot(pv.x, pv.z);
    this.yawV = damp(this.yawV, clamp(angleDiff(this.prevYaw, this.yaw) * idt, -4, 4), 6, dt);
    const crossed = (t0) => this.pSt === st && this.pT < t0 && T >= t0;
    // touchdown: his weight comes down on his legs, and they give under it
    if (this.prevAlt > 0.3 && this.alt <= 0.3 && dt > 0) { this.sqV = -clamp(-vAlt * 0.5, 3, 9); for (const L of this.limbs) L.set = false; }
    this.prev.copy(pos); this.prevYaw = this.yaw; this.prevAlt = this.alt;
    this.sqV += (-this.sq * 70 - this.sqV * 10) * dt; this.sq = clamp(this.sq + this.sqV * dt, -1.6, 0.6);
    const flyK = smooth(clamp(this.fly, 0, 1)), gw = 1 - flyK, air = clamp(this.alt / 4, 0, 1), fwx = Math.sin(this.yaw), fwz = Math.cos(this.yaw);
    // ---- what the moment asks of the body
    let hovT = 0, glideT = 0, pitchT = 0, rear = 0, crouch = 0, shiftZ = 0, hipRoll = 0, hipYaw = 0, wOpen = 0, gbeat = 0, neckUp = 0, headAdd = 0, jaw = 3 + Math.sin(time * 0.8) * 2, heat = 0, headW = 0, headPitch = 0;
    let tailWhip = 0, shake = 0, sprawl = 0, reach = 0, lowNeck = 0, aimYaw = null, roll = 0, legsFwd = 0;
    const hT = _d4, handW = this._hw || (this._hw = { R: 0, L: 0 }), handT = this._ht || (this._ht = { R: new THREE.Vector3(), L: new THREE.Vector3() }); handW.R = handW.L = 0;
    const up01 = smooth(clamp(T / wind, 0, 1));
    switch (st) {
      case 'intro': {
        hovT = 1; legsFwd = this.alt < 9 && this.alt > 0.3 ? 1 : 0;
        const r = smooth(clamp((T - 6) / 0.5, 0, 1)) * (1 - smooth(clamp((T - 8.2) / 0.7, 0, 1)));
        neckUp = 22 * r; headAdd = -30 * r; jaw = lerp(jaw, 58, r); shake = r; wOpen = T > DRG.land ? 1 : 0; gbeat = 18 * r; rear = 8 * r; heat = 0.25 * r;
        break;
      }
      case 'strike': {
        const sk = smooth(clamp((T - wind) / 0.12, 0, 1)), back = smooth(clamp((T - wind - 0.32) / 0.5, 0, 1));
        let ax = this.ap.x - pos.x, az = this.ap.y - pos.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
        _d0.set(pos.x + fwx * 4.4 * DK, this.gY + 8.6 * DK, pos.z + fwz * 4.4 * DK);                      // drawn back
        _d1.set(this.ap.x - ax * 2.5 * DK, H(this.ap.x, this.ap.y) + 1.5 * DK, this.ap.y - az * 2.5 * DK);   // and down on the mark
        hT.lerpVectors(_d0, _d1, sk); headW = up01 * (1 - back); headPitch = lerp(-8, 32, sk);
        jaw = lerp(lerp(jaw, 40, up01), 2, smooth(clamp((T - wind - 0.08) / 0.07, 0, 1)));
        shiftZ = (-0.9 * up01 * (1 - sk) + 1.4 * sk) * (1 - back); crouch = 0.3 * sk * (1 - back);
        if (crossed(wind + 0.1)) this.sqV -= 1.5;
        break;
      }
      case 'claw': {
        const sk = smooth(clamp((T - wind) / 0.2, 0, 1)), back = smooth(clamp((T - wind - 0.3) / 0.4, 0, 1)), k = this.atk ? 'L' : 'R', s = this.atk ? 1 : -1;
        const rel = angleDiff(this.yaw, Math.atan2(this.ap.x - pos.x, this.ap.y - pos.z)), a = rel + s * lerp(0.95, -0.75, sk), rr = lerp(4.6, 6.8, Math.sin(sk * Math.PI) * 0.6 + sk * 0.4);
        handT[k].set(Math.sin(a) * rr, lerp(5.2, 0.7, sk), Math.cos(a) * rr + 1.6); handW[k] = up01 * (1 - back);
        hipRoll = s * lerp(-7 * up01, 8, sk) * (1 - back); hipYaw = s * lerp(6 * up01, -9, sk) * (1 - back); crouch = 0.25 * sk * (1 - back); jaw = lerp(jaw, 22, up01 * (1 - back));
        break;
      }
      case 'tail': {
        const dir = this.atk ? 1 : -1, sk = smooth(clamp((T - wind) / 0.22, 0, 1)), back = smooth(clamp((T - wind - 0.36) / 0.45, 0, 1));
        tailWhip = dir * lerp(12 * up01, -15, sk) * (1 - back); hipYaw = dir * lerp(7 * up01, -11, sk) * (1 - back); crouch = 0.3 * up01 * (1 - back); aimYaw = -dir * 0.9 * (1 - back);
        break;
      }
      case 'buffet': case 'takeoff': {
        const tk = st === 'takeoff', dn = smooth(clamp((T - wind) / 0.16, 0, 1)), back = tk ? 0 : smooth(clamp((T - wind - 0.45) / 0.45, 0, 1)), w = up01 * (1 - back);
        rear = (tk ? 14 : 26) * w * (tk ? 1 - smooth(clamp((T - wind) / 0.6, 0, 1)) : 1); wOpen = w; gbeat = lerp(40, -44, dn) * w; neckUp = 14 * w; jaw = lerp(jaw, 50, w * (1 - dn * 0.5)); shake = w * 0.5;
        crouch = (tk ? 0.9 : 0.3) * up01 * (1 - dn); if (tk) { hovT = 1; if (T > wind) wOpen = 1; }
        if (crossed(wind) && fx) for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; fx.dust(_d0.set(pos.x + Math.sin(a) * 5, this.gY, pos.z + Math.cos(a) * 5), 5, [0.4, 0.4, 0.42]); }
        break;
      }
      case 'stomp': {
        const dn = smooth(clamp((T - wind) / 0.12, 0, 1)), back = smooth(clamp((T - wind - 0.55) / 0.5, 0, 1)), w = up01 * (1 - back);
        rear = 34 * up01 * (1 - dn); neckUp = 10 * up01 * (1 - dn); jaw = lerp(jaw, 36, w);
        for (const [k, s] of [['R', -1], ['L', 1]]) { handT[k].set(s * lerp(3.4, 2.7, dn), lerp(6.8, 0.4, dn), lerp(4.4, 5.6, dn)); handW[k] = w; }
        if (crossed(wind + 0.1)) this.sqV -= 6;
        break;
      }
      case 'breath': {
        const go = smooth(clamp((T - wind) / 0.25, 0, 1)), on = this.breath ? 1 : 0;
        heat = on ? 1 : T < wind + 0.3 ? smooth(clamp(T / (wind * 0.85), 0, 1)) : 0.2;
        neckUp = 15 * up01 * (1 - go); shiftZ = -0.7 * up01 * (1 - go) + 0.5 * go; lowNeck = go * (T < wind + 0.3 || on ? 1 : 1 - smooth(clamp((T - wind - 0.3) / 0.6, 0, 1)));
        jaw = lerp(jaw, 50, go * (on || T < wind + 0.4 ? 1 : 0)); shake = on * 0.7; if (T > wind * 0.5) aimYaw = angleDiff(this.yaw, this.aim);
        break;
      }
      case 'pounce': case 'hop': {
        const hop = st === 'hop', a0 = hop ? DRG.hopAir : DRG.pounceAir, u = clamp((T - wind) / a0, 0, 1);
        hovT = 1; crouch = (hop ? 0.5 : 1.0) * up01 * (T > wind ? 0 : 1); rear = hop ? 10 * up01 * (1 - u) : -6 * up01 * (T > wind ? 0 : 1); wOpen = up01; gbeat = hop ? lerp(36, -40, smooth(clamp((T - wind) / 0.18, 0, 1))) : 14;
        if (!hop && T > wind && u < 1) { reach = Math.sin(u * Math.PI); jaw = lerp(jaw, 46, u); }
        break;
      }
      case 'charge': { const w = up01 * (1 - smooth(clamp((T - wind - DRG.chargeRun) / 0.6, 0, 1))); lowNeck = w * 0.8; jaw = lerp(jaw, 34, w); crouch = 0.35 * w; shake = w * 0.3; break; }
      case 'storm': { const w = smooth(clamp(T / 0.7, 0, 1)) * (1 - smooth(clamp((T - 2.6) / 0.6, 0, 1))); rear = 24 * w; neckUp = 24 * w; headAdd = -34 * w; jaw = lerp(jaw, 56, w); wOpen = w * 0.8; gbeat = 22 * w; heat = w; shake = this.breath ? 1 : 0; break; }
      case 'roar': case 'rage': { const w = smooth(clamp(T / 0.6, 0, 1)) * (1 - smooth(clamp((T - (st === 'rage' ? 2.3 : 1.9)) / 0.5, 0, 1))); rear = 10 * w; neckUp = 20 * w; headAdd = -26 * w; jaw = lerp(jaw, 58, w); wOpen = w * 0.9; gbeat = 16 * w; shake = w; heat = 0.3 * w; break; }
      case 'reel': { const w = smooth(clamp(T / 0.35, 0, 1)) * (1 - smooth(clamp((T - 2.0) / 0.6, 0, 1))); headW = w; hT.set(1.4, 0.95, 10.4); this.mesh.localToWorld(hT); headPitch = 6; crouch = 0.6 * w; jaw = lerp(jaw, 22, w); hipRoll = 5 * w; break; }
      case 'stunned': case 'death': {
        const dth = st === 'death', t2 = dth ? (this.deathT += dt) : T, w = smooth(clamp(t2 / 0.5, 0, 1)) * (dth ? 1 : 1 - smooth(clamp((t2 - DRG.stun + 1.1) / 1.0, 0, 1)));
        sprawl = w; crouch = 1.75 * w; headW = w; hT.set(dth ? -2.2 : 1.6, 0.85, dth ? 9.4 : 10.2); this.mesh.localToWorld(hT); headPitch = 4; jaw = lerp(jaw, dth ? 30 : 16 + Math.sin(time * 2.2) * 5, w);
        for (const [k, s] of [['R', -1], ['L', 1]]) { handT[k].set(s * 6.2, 0.4, 2.2 + (s > 0 ? 0.8 : -0.5)); handW[k] = w; }
        if (dth) { roll = 0.2 * smooth(clamp((t2 - 0.8) / 2.5, 0, 1)); const k = clamp(t2 / 4, 0, 1); U.uGlow.value = (1 - k) * (1 + Math.sin(t2 * 17) * 0.4 * (1 - k)); const em = this.model.eyes.userData.mat; if (em) em.emissiveIntensity = 0.55 * (1 - k); shake = Math.max(0, 1 - t2 / 1.6); heat = Math.max(0, 0.5 - t2 * 0.25); }
        break;
      }
      case 'struck': roll = Math.sin(T * 5.2) * 0.55; pitchT = 24; jaw = 44; hovT = 0.5; shake = 1; break;
      case 'spit': { hovT = 1; const u = (T - 0.8) / 0.55, f = u - Math.floor(u); const k = u > -0.6 && f < 0.36 ? Math.sin(f / 0.36 * Math.PI) : 0; jaw = lerp(jaw, 46, k); heat = 0.45 + 0.55 * k; headAdd = -10 * k; lowNeck = 0.4; break; }
      case 'strafe': case 'swoop': {
        if (this.atk) { glideT = 0.7; pitchT = 3; if (st === 'strafe') { lowNeck = 1; jaw = 46; heat = 1; shake = 0.5; } else { legsFwd = 1; jaw = 30; } }
        else { glideT = 0.45; pitchT = 16; heat = st === 'strafe' ? smooth(clamp(T / wind, 0, 1)) : 0; }
        break;
      }
      case 'dive': { const u = clamp(T / wind, 0, 1); if (u < 0.7) { glideT = 0.85; pitchT = 34; } else { hovT = 1; legsFwd = 1; } jaw = lerp(jaw, 40, u); break; }
      case 'landed': wOpen = 1 - smooth(clamp(T / 1.1, 0, 1)); break;
      case 'circle': heat = 0.06; break;
    }
    this.pT = T; this.pSt = st;
    this.hov = damp(this.hov, hovT, 4, dt); this.glide = damp(this.glide, glideT, 3.5, dt); this.pitch = damp(this.pitch || 0, pitchT, 3.5, dt); this.legsFwd = damp(this.legsFwd || 0, legsFwd, 5, dt);
    const hov = this.hov, glide = this.glide * flyK;
    // ---- the wings' beat (and the body riding it)
    this.flap += dt * lerp(lerp(0.72, 1.18, hov), 0.3, glide) * (0.15 + 0.85 * flyK);
    const ph = this.flap * TAU, A = lerp(lerp(30, 46, hov), 7, glide) * flyK;
    const b1 = A * Math.sin(ph), b2 = A * 0.6 * Math.sin(ph - 0.7), b3 = A * 0.55 * Math.sin(ph - 1.3), flex = Math.max(0, Math.cos(ph - 0.3)) * flyK * (1 - glide);
    const bob = -Math.sin(ph) * 0.5 * flyK * (1 - glide) * (0.6 + 0.4 * hov);
    this.bank = damp(this.bank, clamp(-this.yawV * 0.55, -0.6, 0.6) * flyK * (1 - hov), 3, dt);
    // ---- the pose (degrees; +x pitches a bone nose-down, +y turns it to his left)
    const set = (n, x, y, z) => { const q = Q[n]; q[0] = x; q[1] = y; q[2] = z; };
    const br = Math.sin(time * 0.8) * (1 + sprawl * 2), tr = shake ? Math.sin(time * 43) * shake : 0;
    set('hips', 5 * gw * (1 - sprawl) + flyK * (this.pitch - 32 * hov * air) - rear, hipYaw, hipRoll);
    set('spine', 1 + br * 0.8 - rear * 0.12, -hipYaw * 0.4, 0); set('chest', -2 * gw + br * 1.3 - 4 * hov * flyK - rear * 0.1, -hipYaw * 0.3, -hipRoll * 0.4);
    // the neck: an S, the head carried high and turned on whoever he is watching
    const lx = this.look.x - pos.x, lz = this.look.z - pos.z, ld = Math.hypot(lx, lz);
    this.lookA = damp(this.lookA, aimYaw !== null ? clamp(aimYaw, -1.35, 1.35) : ld > 1 && !sprawl ? clamp(angleDiff(this.yaw, Math.atan2(lx, lz)), -1.4, 1.4) : 0, aimYaw !== null ? 9 : 3.5, dt);
    const hh = this.headPos.y - this.look.y, hd = Math.hypot(this.look.x - this.headPos.x, this.look.z - this.headPos.z);
    this.lookP = damp(this.lookP, ld > 1 && !lowNeck && !headW ? clamp(Math.atan2(hh, Math.max(2, hd)) * 57.3 - 14, -12, 48) : 0, 3, dt);
    const ny = this.lookA * 57.3 / 7.5, LOW = [-2, 0, 3, 7, 9, 9, 12];
    for (let i = 0; i < 6; i++) {
      const base = lerp(NECK_G[i], LOW[i], lowNeck) * gw + lerp(lerp(NECK_F[i], NECK_H[i], hov), LOW[i] + 6, lowNeck) * flyK;
      set('neck' + (i + 1), base - neckUp * (i < 3 ? 1 : -0.35) + (i > 3 ? this.lookP * 0.2 : 0) + tr * 0.4, ny * (i < 2 ? 0.6 : 1.1) + Math.sin(time * 0.5 + i * 0.6) * (1.5 + i * 0.4) * gw * (1 - sprawl), 0);
    }
    set('head', lerp(NECK_G[6], LOW[6], lowNeck) * gw + lerp(lerp(NECK_F[6], NECK_H[6], hov), LOW[6] + 14, lowNeck) * flyK + this.lookP * 0.6 + headAdd + tr, ny * 1.4, Math.sin(time * 0.37) * 3 * (1 - sprawl) + tr * 1.5);
    this.jawK = damp(this.jawK, jaw, 16, dt); set('jaw', this.jawK, 0, 0);
    // the tail: carried clear of the ground, swaying, swinging wide against a turn
    this.tailLag = damp(this.tailLag, clamp(-this.yawV * 9, -15, 15), 3, dt);
    for (let i = 1; i <= 10; i++) {
      const gx = (i === 1 ? -4 : i < 5 ? -1 : i < 8 ? 1 : -3) * (1 - sprawl) + sprawl * (i < 3 ? 5 : 0);
      set('tail' + i, gx * gw + ((i === 1 ? -9 : -0.5) * (1 - hov) + (i < 4 ? 9 : 2) * hov) * flyK + Math.sin(ph - i * 0.5) * 2.2 * flyK + (i < 4 ? Math.abs(tailWhip) * 0.2 : 0) + rear * (i < 3 ? 0.3 : 0),
        Math.sin(time * 0.9 - i * 0.55) * (1.5 + i * 0.6) * (1 - 0.5 * flyK) * (1 - sprawl * 0.8) + this.tailLag * (0.4 + i * 0.12) + tailWhip * (0.6 + i * 0.08), 0);
    }
    for (const [k, s] of [['R', -1], ['L', 1]]) {
      // legs, in the air: trailed in flight, hanging in a hover, reached forward to strike or to land
      const lf = this.legsFwd;
      set('thigh' + k, lerp(lerp(82, 20, hov), -38, lf) * flyK, 0, -s * 3 * flyK); set('shin' + k, lerp(lerp(-30, -8, hov), 16, lf) * flyK, 0, 0); set('meta' + k, lerp(lerp(62, 24, hov), -30, lf) * flyK, 0, 0); set('foot' + k, lerp(lerp(48, 20, hov), -24, lf) * flyK, 0, 0);
      // wings: the beat runs out along them, and they fold a little on the way up; on the ground, open, they are held raised
      const g = gw * wOpen, sw = 4 + 12 * flex + 34 * glide + 16 * g;
      set('wing1' + k, -7 * Math.cos(ph) * flyK * (1 - glide), s * sw, s * (7 + b1 + 10 * glide + (14 + gbeat) * g + tr * 2 * g));
      set('wing2' + k, 0, -s * (6 + 22 * flex + 50 * glide + 30 * g), s * (b2 + gbeat * 0.4 * g));
      set('wing3' + k, 0, s * (4 + 18 * flex + 46 * glide + 22 * g), s * (b3 * 0.7 + gbeat * 0.3 * g));
      const fan = 5 + 14 * flex + 26 * glide + 10 * g;
      set('f1' + k, 0, s * fan, s * b3 * 0.3); set('f2' + k, 0, s * fan * 0.62, s * b3 * 0.35); set('f3' + k, 0, s * fan * 0.28, s * b3 * 0.4); set('f4' + k, 0, 0, s * b3 * 0.3);
    }
    for (const n in Q) { const q = Q[n]; e(B[n], q[0], q[1], q[2]); }
    // ---- where he stands; the feet and the hands of the wings planted, each stepping when the body has left it behind
    const grounded = this.alt < 0.6 && this.fly < 0.75;
    let lifted = 0, tilt = 0;
    for (let i = 0; i < 4; i++) {
      const L = this.limbs[i], cy = fwz, sy = fwx;
      const hx = pos.x + L.x * cy + L.z * sy + pv.x * 0.22, hz = pos.z - L.x * sy + L.z * cy + pv.z * 0.22;
      if (!grounded) { L.set = false; continue; }
      if (!L.set || Math.hypot(L.p.x - hx, L.p.z - hz) > 7 * DK) { L.set = true; L.s = -1; L.p.set(hx, H(hx, hz), hz); }
      if (L.s < 0) {
        const err = Math.hypot(L.p.x - hx, L.p.z - hz), thr = (L.hind ? 1.45 : 1.65) * DK * (sp > 5 ? 0.75 : 1);
        if ((err > thr && this.limbs[i ^ 1].s < 0 && this.limbs[i ^ 2].s < 0) || err > thr * 2.3) {   // (a limb lifts only while its neighbours stand)
          L.s = 0; L.a.copy(L.p); L.b.set(hx + (hx - L.p.x) * 0.5 + pv.x * 0.2, 0, hz + (hz - L.p.z) * 0.5 + pv.z * 0.2); L.b.y = H(L.b.x, L.b.z); L.dur = clamp(0.42 - sp * 0.025, 0.16, 0.42);
        }
      }
      if (L.s >= 0) {
        L.s += dt / L.dur; const u = clamp(L.s, 0, 1); L.c.lerpVectors(L.a, L.b, smooth(u)); L.c.y += Math.sin(Math.PI * u) * (L.hind ? 0.8 : 1.05) * DK; lifted++; tilt += (L.x > 0 ? 1 : -1) * (L.hind ? 1 : 0.6);
        if (L.s >= 1) { L.s = -1; L.p.copy(L.b); if (fx) fx.dust(L.p, 2, [0.3, 0.29, 0.3]); }
      } else L.c.copy(L.p);
    }
    this.sway = damp(this.sway || 0, tilt * 1.6, 6, dt);
    B.hips.rotation.z += this.sway * D2R * gw;
    const rest = B.hips.userData.rest;
    B.hips.position.set(rest.x, rest.y + (-0.3 * gw - crouch * gw + this.sq * (0.4 + 0.6 * gw) + bob - lifted * 0.06 * gw), rest.z + shiftZ * gw);
    this.mesh.position.set(pos.x, this.gY + this.alt, pos.z); this.mesh.rotation.set(0, this.yaw, this.bank + roll);
    this.mesh.updateMatrixWorld(true);
    // ---- the limbs solved onto their marks
    this.legW = damp(this.legW ?? 1, grounded ? 1 : 0, 10, dt); this.wingW = damp(this.wingW, grounded ? 1 - wOpen : 0, 9, dt);
    if (this.legW > 0.01) for (let i = 0; i < 2; i++) {
      const L = this.limbs[i], k = L.k, th = B['thigh' + k], sh = B['shin' + k], mt = B['meta' + k], ft = B['foot' + k], w = this.legW;
      _d0.set(L.c.x - fwx * 0.8 * DK, L.c.y + 1.3 * DK, L.c.z - fwz * 0.8 * DK);   // the hock: above and behind the toes
      if (w < 0.999) { mt.getWorldPosition(_d1); _d0.lerpVectors(_d1, _d0, w); }
      ik2(th, sh, mt, _d0, _d2.set(fwx, 0.25, fwz));
      if (w > 0.5) {
        mt.getWorldPosition(_d1); ft.getWorldPosition(_d3); aimBone(mt, _d3.sub(_d1), _d2.set(L.c.x, L.c.y + 0.25 * DK, L.c.z).sub(_d1));
        // the foot laid along the ground under it (its long toes stood off a slope, or into it, held level with the body)
        const e = 1.2 * DK, gx = L.c.x, gz = L.c.z;
        _dn.set(H(gx - e, gz) - H(gx + e, gz), 2 * e, H(gx, gz - e) - H(gx, gz + e)).normalize();
        this.mesh.getWorldQuaternion(_dq2); _dU.set(0, 1, 0).applyQuaternion(_dq2);
        _dq3.setFromUnitVectors(_dU, _dn); const ta = _dU.angleTo(_dn); if (ta > 0.6) _dq3.slerpQuaternions(_dqI, _dq3, 0.6 / ta);   // (no steeper than that: off a ledge the toes stay as they were)
        mt.getWorldQuaternion(_dq); ft.quaternion.copy(_dq.invert().multiply(_dq3).multiply(_dq2)); ft.updateMatrixWorld(true);
      }
    }
    for (let i = 2; i < 4; i++) {
      const L = this.limbs[i], k = L.k, s = k === 'L' ? 1 : -1, w1 = B['wing1' + k], w2 = B['wing2' + k], w3 = B['wing3' + k];
      let w = this.wingW;
      _d0.set(L.c.x, L.c.y + 0.4 * DK, L.c.z);
      if (handW[k] > 0.001 && this.alt < 0.6) { this.mesh.localToWorld(_d1.copy(handT[k])); if (w < 0.02) w3.getWorldPosition(_d0); _d0.lerp(_d1, handW[k]); w = Math.max(w, handW[k]); }
      if (w < 0.01) continue;
      if (w < 0.999) { w3.getWorldPosition(_d1); _d0.lerpVectors(_d1, _d0, w); }
      ik2(w1, w2, w3, _d0, _d2.set(s * 0.45 * fwz - 0.55 * fwx, 1, -s * 0.45 * fwx - 0.55 * fwz));   // the elbow carried high, behind and out
      // the fingers laid back along the flank, the membrane furled between them
      const open = sprawl * 0.5;
      for (const f in FOLD) {
        const fb = B[f + k], F = DRAGON_FINGERS[f], D = FOLD[f];
        _d1.set(s * F[0], F[1], F[2]).transformDirection(fb.matrixWorld);
        const lx2 = s * (D[0] + open * (1.2 - D[1] * 2)), lz2 = D[2];
        _d3.set(lx2 * fwz + lz2 * fwx, D[1] * (1 - open), -lx2 * fwx + lz2 * fwz).normalize();
        if (w < 0.999) _d3.lerpVectors(_d1, _d3, w).normalize();
        aimBone(fb, _d1, _d3);
      }
    }
    // the head brought to a point (the bite, the collapse): the neck bends at its root and its middle to reach it
    if (headW > 0.01) {
      B.head.getWorldPosition(_d1); _d0.lerpVectors(_d1, hT, headW);
      ik2(B.neck1, B.neck4, B.head, _d0, _d2.set(-fwx * 0.3, 1, -fwz * 0.3));
      _d1.set(0, 0, 1).transformDirection(B.head.matrixWorld); const pr = headPitch * D2R, c = Math.cos(pr);
      let ax = _d0.x - pos.x, az = _d0.z - pos.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      _d3.set(ax * c, -Math.sin(pr), az * c); _d3.lerpVectors(_d1, _d3, headW).normalize(); aimBone(B.head, _d1, _d3);
    }
    for (const sph of this.spheres) sph.c.set(sph.off[0], sph.off[1], sph.off[2]).applyMatrix4(sph.bone.matrixWorld);
    const stn = st === 'stunned' || st === 'reel'; this.spheres[0].mul = this.spheres[1].mul = stn ? 2.0 : 1.6; this.spheres[0].r = (stn ? 1.6 : 1.25) * DK;
    // ---- his mouth, and the fire
    this.headPos.set(0, 0.2, 1.0).applyMatrix4(B.head.matrixWorld);
    this.mouth.set(0, -0.2, 2.75).applyMatrix4(B.head.matrixWorld); this.mouthDir.set(0, -0.1, 1).transformDirection(B.head.matrixWorld);
    this.heat = damp(this.heat, heat, heat > this.heat ? 3 : 2, dt); U.uBreath.value = this.heat; this.wingMat.userData.u.uFire.value = this.breath ? 0.5 + 0.2 * Math.sin(time * 23) : 0;
    const F = this.fire; F.begin(time);
    let jl = 12;
    if (this.breath) {
      const dir = this.mouthDir; jl = dir.y < -0.06 ? clamp((this.mouth.y - this.gY) / -dir.y, 5, 20) : 11;
      const hx = this.mouth.x + dir.x * jl, hz = this.mouth.z + dir.z * jl, hy = dir.y < -0.06 ? H(hx, hz) : this.mouth.y + dir.y * jl;
      // where it strikes the ground it boils up and spreads (each tongue of flame on the ground where it stands)
      if (dir.y < -0.06) { for (let i = 0; i < 6; i++) { const a = i * 2.4 + Math.floor(time * 7) * 1.3, r = 0.4 + (i % 3) * 0.9, fx2 = hx + Math.sin(a) * r, fz2 = hz + Math.cos(a) * r; F.flame(fx2, H(fx2, fz2) - 0.1, fz2, 2.6, 2.6 + (i % 2) * 1.3, i * 1.9, 1.2); } if (!this._scT || time - this._scT > 0.3) { this._scT = time; F.scorchAt(hx, hz, 3, W, time); } }
      if (fx) {
        if (R() < dt * 22) fx.fireStream(this.mouth, dir, jl * 0.85, 0.3, 0.3);
        dragonLight(fx, 3, _d0.set(hx, hy + 1.6, hz), 0xff6a20, 55 + 20 * Math.sin(time * 31), 30); dragonLight(fx, 2, _d1.copy(this.mouth).addScaledVector(dir, 2.5), 0xff7a30, 30, 18);
      }
    } else if (fx && this.heat > 0.3 && R() < dt * 8) fx.wisp(this.mouth, 0.5, [0.06, 0.05, 0.05]);
    F.jet(this.breath ? 1 : 0, this.mouth, this.mouthDir, jl, time, dt);
    let lit = false;
    for (const P of this.tele.map.values()) {
      if (P.shape === 'pool') {
        const k = clamp(P.t / 0.35, 0, 1) * clamp((P.dur - P.t) / 1.2, 0, 1), n = Math.min(7, Math.round(P.a * 2.2));
        // (each tongue of fire stands on the ground where it is: all at the height of the middle, they hung in the air
        // over every hollow and off the edge of the rock, metres up)
        if (!P.seen) { P.seen = true; P.gy = H(P.x, P.z); P.fy = []; for (let i = 0; i < n; i++) { const a = P.id * 2.4 + i * 2.399, r = P.a * 0.8 * Math.sqrt((i + 0.5) / n); P.fy.push(H(P.x + Math.sin(a) * r, P.z + Math.cos(a) * r)); } F.scorchAt(P.x, P.z, P.a * 1.3, W, time); }
        for (let i = 0; i < n; i++) { const a = P.id * 2.4 + i * 2.399, r = P.a * 0.8 * Math.sqrt((i + 0.5) / n); F.flame(P.x + Math.sin(a) * r, P.fy[i] - 0.1, P.z + Math.cos(a) * r, 1.6 + ((i * 7 + P.id) % 5) * 0.25, 2.0 + ((i * 3 + P.id) % 4) * 0.6, P.id + i * 1.7, k); }
        if (fx && R() < dt * 3 * k) fx.hellfire(P.x, P.gy, P.z, P.a);
        if (fx && !lit && !this.breath && k > 0.5) { lit = true; dragonLight(fx, 3, _d0.set(P.x, P.gy + 1.5, P.z), 0xff6a20, 26 + 8 * Math.sin(time * 27 + P.id), 20); }
      } else if (P.fxk === 5 && !P.fired) {   // a gout of fire on its way down to its mark
        if (!P.o) P.o = this.mouth.clone();
        const u = clamp(P.t / P.dur, 0, 1), gy = P.gy ?? (P.gy = H(P.x, P.z)), x = lerp(P.o.x, P.x, u), z = lerp(P.o.z, P.z, u), y = lerp(P.o.y, gy, u * u) + Math.sin(u * Math.PI) * (st === 'storm' ? 14 : 3);
        F.flame(x, y - 1.1, z, 2.4, 2.8, P.id, 1.5); F.flame(x, y - 0.8, z, 1.5, 1.8, P.id + 3.3, 1.5);
        if (fx && R() < dt * 30) fx.wisp(_d0.set(x, y, z), 0.8, [0.07, 0.05, 0.04]);
      }
    }
    F.end();
    // the wind of his wings on the ground beneath him
    if (fx && this.alt > 0.6 && this.alt < 10 && hov > 0.4 && R() < dt * 16) { const a = R() * TAU, r = 3 + R() * 6; fx.dust(_d0.set(pos.x + Math.sin(a) * r, this.gY, pos.z + Math.cos(a) * r), 3, [0.4, 0.4, 0.42]); }
    if (fx && st === 'death' && this.deathT < 6 && R() < dt * 10) fx.wisp(_d0.copy(this.headPos).add(_d1.set((R() - 0.5) * 4, R(), (R() - 0.5) * 4)), 1.2, [0.05, 0.04, 0.04]);
  }
}
