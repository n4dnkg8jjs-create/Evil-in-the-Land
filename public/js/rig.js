// Human skeleton (adult male, ~1.80 m in harness), pose blending and
// analytic two-bone IK. Proportions follow the classical 8-head canon:
// hip joint 0.94 m, knee 0.49, shoulder 1.46, crown ~1.83.
//
// Conventions (character faces +Z, up +Y, character's RIGHT is -X).
// All joint rotations are Euler 'YXZ' (yaw, then pitch, then roll):
//  spine/chest/neck/head: +x bends forward, +y turns left, +z leans right
//  limbs hanging along -Y: -x swings forward, +x back; arms: +y swings toward
//  the character's left; elbows/knees: elbow flex = -x, knee flex = +x
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

export const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head',
  'clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL',
  'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL'];
export const JI = Object.fromEntries(JOINTS.map((j, i) => [j, i]));

export const SKEL = {
  hips: ['root', [0, 1.0, 0]],
  spine: ['hips', [0, 0.10, -0.01]],
  chest: ['spine', [0, 0.22, 0.0]],
  neck: ['chest', [0, 0.20, -0.01]],
  head: ['neck', [0, 0.10, 0.02]],
  clavR: ['chest', [-0.035, 0.13, 0.035]], uArmR: ['clavR', [-0.165, 0, 0]], fArmR: ['uArmR', [0, -0.30, 0]], handR: ['fArmR', [0, -0.265, 0]],
  clavL: ['chest', [0.035, 0.13, 0.035]], uArmL: ['clavL', [0.165, 0, 0]], fArmL: ['uArmL', [0, -0.30, 0]], handL: ['fArmL', [0, -0.265, 0]],
  thighR: ['hips', [-0.10, -0.06, 0]], shinR: ['thighR', [0, -0.45, 0]], footR: ['shinR', [0, -0.43, 0]],
  thighL: ['hips', [0.10, -0.06, 0]], shinL: ['thighL', [0, -0.45, 0]], footL: ['shinL', [0, -0.43, 0]],
};
export const LEN = { uArm: 0.30, fArm: 0.265, grip: 0.08, thigh: 0.45, shin: 0.43 };
const D2R = Math.PI / 180;

// A pose is a flat Float32Array of joint Euler angles (radians) + hip offset.
export const POSE_SIZE = JOINTS.length * 3 + 3;
export function newPose() { return new Float32Array(POSE_SIZE); }
export function poseFromDeg(obj, base) {
  const p = base ? Float32Array.from(base) : newPose();
  for (const k in obj) {
    if (k === 'hipsOff') { p[JOINTS.length * 3] = obj[k][0]; p[JOINTS.length * 3 + 1] = obj[k][1]; p[JOINTS.length * 3 + 2] = obj[k][2]; continue; }
    const i = JI[k]; if (i === undefined) continue; const v = obj[k];
    p[i * 3] = v[0] * D2R; p[i * 3 + 1] = (v[1] || 0) * D2R; p[i * 3 + 2] = (v[2] || 0) * D2R;
  }
  return p;
}
export function mirrorDeg(obj) { // swap L/R limbs, negate yaw/roll
  const out = {};
  for (const k in obj) {
    const v = obj[k]; if (k === 'hipsOff') { out[k] = [-v[0], v[1], v[2]]; continue; }
    let m = k.endsWith('R') ? k.slice(0, -1) + 'L' : k.endsWith('L') ? k.slice(0, -1) + 'R' : k;
    out[m] = [v[0], -(v[1] || 0), -(v[2] || 0)];
  }
  return out;
}
export function lerpPose(out, a, b, t) { for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; }
export function copyPose(out, a) { out.set(a); return out; }
export function addPose(out, a, w = 1) { for (let i = 0; i < POSE_SIZE; i++) out[i] += a[i] * w; return out; }
// Blend only selected joints
export function lerpJoints(out, a, b, t, joints) { for (const j of joints) { const i = JI[j] * 3; out[i] = a[i] + (b[i] - a[i]) * t; out[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * t; out[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * t; } return out; }
export const LOWER = ['thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL'];
export const UPPER = ['spine', 'chest', 'neck', 'head', 'clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL'];

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();

export class Rig {
  constructor(scale = 1) {
    this.root = new THREE.Group();
    this.scale = scale;
    this.j = {};
    for (const name of JOINTS) {
      const [parent, off] = SKEL[name];
      const o = new THREE.Group(); o.name = name;
      o.position.set(off[0], off[1], off[2]);
      this.j[name] = o;
      (parent === 'root' ? this.root : this.j[parent]).add(o);
    }
    this.root.scale.setScalar(scale);
    this.basePos = this.j.hips.position.clone();
  }

  applyPose(p) {
    for (let i = 0; i < JOINTS.length; i++) {
      _e.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], 'YXZ');
      this.j[JOINTS[i]].quaternion.setFromEuler(_e);
    }
    const o = JOINTS.length * 3;
    this.j.hips.position.set(this.basePos.x + p[o], this.basePos.y + p[o + 1], this.basePos.z + p[o + 2]);
  }

  // Two-bone IK: put the wrist of arm `side` ('R'|'L') at world point `target`,
  // bending the elbow toward world pole direction `pole`. Then orient the hand
  // so its local axes match world `handQuat` (optional).
  solveArm(side, target, pole, handQuat) {
    const up = this.j['uArm' + side], fo = this.j['fArm' + side], ha = this.j['hand' + side];
    up.parent.updateWorldMatrix(true, false);
    const S = up.getWorldPosition(_v1);
    const s = this.scale;
    const a = LEN.uArm * s, b = LEN.fArm * s;
    const toT = _v2.subVectors(target, S);
    let d = toT.length();
    const n = toT.clone().divideScalar(d || 1);
    d = clamp(d, Math.abs(a - b) + 0.01, (a + b) * 0.9995);
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // bend direction: pole projected perpendicular to n
    const m = _v3.copy(pole).addScaledVector(n, -pole.dot(n));
    if (m.lengthSq() < 1e-6) m.set(0, -1, 0).addScaledVector(n, n.y);
    m.normalize();
    const E = _v4.copy(S).addScaledVector(n, a * cosA).addScaledVector(m, a * sinA);
    const T = _v5.copy(S).addScaledVector(n, d);
    const dirU = E.clone().sub(S).normalize();
    const dirF = T.clone().sub(E).normalize();
    // forearm deviation inside upper-arm frame -> local +Z
    let w = dirF.clone().addScaledVector(dirU, -dirF.dot(dirU));
    if (w.lengthSq() < 1e-8) w.copy(m).multiplyScalar(-1);
    w.normalize();
    const Y = dirU.clone().negate(); const Z = w; const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z);
    const qWorld = new THREE.Quaternion().setFromRotationMatrix(_m);
    const parentQ = up.parent.getWorldQuaternion(_q2);
    up.quaternion.copy(parentQ.invert().multiply(qWorld));
    const flex = Math.acos(clamp(dirU.dot(dirF), -1, 1));
    fo.quaternion.setFromAxisAngle(_v1.set(1, 0, 0), -flex);
    if (handQuat) {
      fo.updateWorldMatrix(true, false);
      const fq = fo.getWorldQuaternion(_q);
      ha.quaternion.copy(fq.invert().multiply(handQuat));
    }
  }

  // Grip a weapon with one hand. The hand's thumb axis runs along `d`; the
  // knuckles face `uPref`, but a hand may roll around a round grip by up to
  // maxRoll (radians) toward the most natural wrist (fingers continuing the
  // forearm). Grip point is where the fist closes; the wrist sits 8 cm back.
  gripArm(side, grip, d, uPref, pole, maxRoll = 0) {
    const s = this.scale;
    const D = d.clone().normalize();
    const U0 = uPref.clone().addScaledVector(D, -uPref.dot(D)); if (U0.lengthSq() < 1e-8) U0.set(0, 1, 0).addScaledVector(D, -D.y); U0.normalize();
    let U = U0.clone();
    const q = new THREE.Quaternion();
    const iters = maxRoll > 0 ? 3 : 1;
    for (let it = 0; it < iters; it++) {
      const wrist = grip.clone().addScaledVector(U, -LEN.grip * s);
      handQuatFrom(D, U, q);
      this.solveArm(side, wrist, pole, q);
      if (it === iters - 1) break;
      const fa = this.j['fArm' + side]; fa.updateWorldMatrix(true, false);
      const elbow = new THREE.Vector3().setFromMatrixPosition(fa.matrixWorld);
      const f = wrist.clone().sub(elbow); f.addScaledVector(D, -f.dot(D));
      if (f.lengthSq() < 1e-8) break;
      f.normalize();
      // signed angle from U0 to f around D
      const cr = new THREE.Vector3().crossVectors(U0, f);
      let ang = Math.atan2(cr.dot(D), U0.dot(f));
      ang = clamp(ang, -maxRoll, maxRoll);
      U.copy(U0).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(D, ang));
    }
    return U;
  }

  // gripArm, then swing the elbow out if the elbow or forearm passes through the
  // torso (f: torso field, see clearTorso). The hand stays where it is.
  gripArmClear(side, grip, d, uPref, pole, maxRoll, f) {
    let U = this.gripArm(side, grip, d, uPref, pole, maxRoll);
    if (!f) return U;
    const pl = pole.clone();
    for (let i = 0; i < 4; i++) {
      const hit = armInTorso(this, side, f);
      if (hit.depth < 0.012) break;
      pl.addScaledVector(hit.dir, 1.2 + i * 0.8).normalize();
      U = this.gripArm(side, grip, d, uPref, pl, maxRoll);
    }
    return U;
  }

  // Keep a weapon within reach of both hands: if a grip point is beyond an
  // arm's reach, the weapon is drawn in toward that shoulder (in place on p).
  fitWeapon(p, d, u, leftGrip) {
    const s = this.scale;
    const reach = (LEN.uArm + LEN.fArm) * 0.99 * s;
    const SR = new THREE.Vector3(), SL = new THREE.Vector3(), w = new THREE.Vector3();
    this.j.uArmR.updateWorldMatrix(true, false); SR.setFromMatrixPosition(this.j.uArmR.matrixWorld);
    this.j.uArmL.updateWorldMatrix(true, false); SL.setFromMatrixPosition(this.j.uArmL.matrixWorld);
    const U = u.clone().addScaledVector(d, -u.dot(d)); if (U.lengthSq() < 1e-8) U.set(0, 1, 0); U.normalize();
    const off = U.multiplyScalar(-LEN.grip * s); // grip -> wrist
    // pull the weapon toward a shoulder until that wrist is reachable; the
    // right (weapon) hand gets the last word, so an over-stretched leading hand lets go
    const minD = 0.2 * s; // closer than this crushes the elbow past ~140°
    const fixR = () => {
      w.copy(p).add(off); const dr = w.distanceTo(SR);
      if (dr > reach) { p.addScaledVector(w.sub(SR), -(dr - reach) / dr); return true; }
      if (dr < minD && dr > 1e-4) { p.addScaledVector(w.sub(SR), (minD - dr) / dr); return true; }
      return false;
    };
    for (let it = 0; it < 8; it++) {
      let moved = fixR();
      if (leftGrip !== null && leftGrip !== undefined) {
        w.copy(p).addScaledVector(d, leftGrip).add(off);
        const dl = w.distanceTo(SL);
        if (dl > reach) { p.addScaledVector(w.sub(SL), -0.6 * (dl - reach) / dl); moved = true; }
      }
      if (!moved) break;
    }
    fixR();
    return p;
  }

  // Choose where the leading hand holds a haft: the preferred spot if it can be
  // reached, otherwise slide along [min,max] to the nearest reachable spot.
  chooseGrip(side, p, d, pref, min, max) {
    const sh = this.j['uArm' + side]; sh.updateWorldMatrix(true, false);
    const S = new THREE.Vector3().setFromMatrixPosition(sh.matrixWorld);
    const reach = (LEN.uArm + LEN.fArm) * this.scale * 0.97 + LEN.grip * this.scale * 0.6;
    const at = (t) => S.distanceTo(new THREE.Vector3().copy(p).addScaledVector(d, t));
    if (at(pref) <= reach) return pref;
    let best = pref, bestScore = 1e9;
    for (let i = 0; i <= 24; i++) {
      const t = lerp(min, max, i / 24); const dd = at(t);
      const score = dd <= reach ? Math.abs(t - pref) : 10 + dd;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  // Leg IK (used for kneeling/slopes): ankle to target with knee pole
  solveLeg(side, target, pole) {
    const th = this.j['thigh' + side], sh = this.j['shin' + side];
    th.parent.updateWorldMatrix(true, false);
    const S = th.getWorldPosition(_v1); const s = this.scale;
    const a = LEN.thigh * s, b = LEN.shin * s;
    const toT = _v2.subVectors(target, S); let d = toT.length(); const n = toT.clone().divideScalar(d || 1);
    d = clamp(d, Math.abs(a - b) + 0.01, (a + b) * 0.999);
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    const m = _v3.copy(pole).addScaledVector(n, -pole.dot(n)); if (m.lengthSq() < 1e-6) m.set(0, 0, 1); m.normalize();
    const E = _v4.copy(S).addScaledVector(n, a * cosA).addScaledVector(m, a * sinA);
    const T = _v5.copy(S).addScaledVector(n, d);
    const dirU = E.clone().sub(S).normalize(), dirF = T.clone().sub(E).normalize();
    let w = dirF.clone().addScaledVector(dirU, -dirF.dot(dirU)); if (w.lengthSq() < 1e-8) w.copy(m).negate(); w.normalize();
    // knee flexes with +x, which moves the shin toward local -Z
    const Y = dirU.clone().negate(); const Z = w.negate(); const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
    _m.makeBasis(X, Y, Z);
    const qWorld = new THREE.Quaternion().setFromRotationMatrix(_m);
    const parentQ = th.parent.getWorldQuaternion(_q2);
    th.quaternion.copy(parentQ.invert().multiply(qWorld));
    const flex = Math.acos(clamp(dirU.dot(dirF), -1, 1));
    sh.quaternion.setFromAxisAngle(_v1.set(1, 0, 0), flex);
  }
}

// Keep the hands (and the haft between them) out of the body. `f` is a torso
// cross-section field ({r(th, y), centre(y)} in the chest's frame, see body.js).
// Each grip point is pushed radially out of the armoured torso; the whole weapon
// moves with it, so no stance or swing ever drives a fist through the breastplate.
const _inv = new THREE.Matrix4(), _pt = new THREE.Vector3(), _push = new THREE.Vector3();
export function clearTorso(rig, p, d, lg, f, margin = 0.09) {
  if (!f) return p;
  const chest = rig.j.chest; chest.updateWorldMatrix(true, false);
  _inv.copy(chest.matrixWorld).invert();
  for (let it = 0; it < 3; it++) {
    let best = 0;
    const n = lg === null || lg === undefined ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (lg * i) / (n - 1);
      _pt.copy(p).addScaledVector(d, t).applyMatrix4(_inv);
      if (_pt.y < -0.44 || _pt.y > 0.2) continue;
      const c = f.centre(_pt.y); const dx = _pt.x - c[0], dz = _pt.z - c[1];
      const dist = Math.hypot(dx, dz); const th = Math.atan2(dx, dz);
      const R = f.r(th, _pt.y) + margin;
      if (dist < R && R - dist > best) { best = R - dist; if (dist > 1e-4) _push.set(dx / dist, 0, dz / dist); else _push.set(0, 0, 1); }
    }
    if (best < 0.002) break;
    _pt.copy(_push).transformDirection(chest.matrixWorld);
    p.addScaledVector(_pt, best);
  }
  return p;
}

// Deepest point of an arm (elbow, forearm) inside the armoured torso, and the
// outward direction (world) that would free it.
const _ae = new THREE.Vector3(), _aw = new THREE.Vector3(), _ap = new THREE.Vector3(), _ad = new THREE.Vector3();
export function armInTorso(rig, side, f, margin = 0.068) {
  const chest = rig.j.chest; chest.updateWorldMatrix(true, false);
  rig.j['hand' + side].updateWorldMatrix(true, false);
  _inv.copy(chest.matrixWorld).invert();
  _ae.setFromMatrixPosition(rig.j['fArm' + side].matrixWorld); _aw.setFromMatrixPosition(rig.j['hand' + side].matrixWorld);
  let depth = 0;
  for (const t of [0, 0.33, 0.66]) {
    _ap.copy(_ae).lerp(_aw, t).applyMatrix4(_inv);
    if (_ap.y < -0.44 || _ap.y > 0.2) continue;
    const c = f.centre(_ap.y); const dx = _ap.x - c[0], dz = _ap.z - c[1];
    const dist = Math.hypot(dx, dz), R = f.r(Math.atan2(dx, dz), _ap.y) + margin;
    if (R - dist > depth) { depth = R - dist; _ad.set(dist > 1e-4 ? dx / dist : 0, 0, dist > 1e-4 ? dz / dist : 1); }
  }
  if (depth > 0) _ad.transformDirection(chest.matrixWorld);
  return { depth, dir: _ad };
}

// A world/root-space orientation from a weapon axis `d` and edge direction `u`.
// Hand convention: hand +Z runs out of the thumb side of the fist along the
// weapon; the knuckles (and the true edge) face hand -Y.
export function handQuatFrom(d, u, out = new THREE.Quaternion()) {
  const Z = _v1.copy(d).normalize();
  const uu = _v2.copy(u).addScaledVector(Z, -u.dot(Z));
  if (uu.lengthSq() < 1e-8) uu.set(0, 1, 0).addScaledVector(Z, -Z.y);
  uu.normalize();
  const Y = _v3.copy(uu).negate();
  const X = _v4.crossVectors(Y, Z).normalize();
  _m.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m);
}
// Weapon object frame: X = edge (u), Y = along weapon (d), Z = X × Y
export function weaponQuatFrom(d, u, out = new THREE.Quaternion()) {
  const Y = _v1.copy(d).normalize();
  const X = _v2.copy(u).addScaledVector(Y, -u.dot(Y));
  if (X.lengthSq() < 1e-8) X.set(1, 0, 0).addScaledVector(Y, -Y.x);
  X.normalize();
  const Z = _v3.crossVectors(X, Y).normalize();
  _m.makeBasis(X, Y, Z);
  return out.setFromRotationMatrix(_m);
}
