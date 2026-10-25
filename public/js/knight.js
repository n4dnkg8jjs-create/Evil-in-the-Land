// The knight: rig + harness + weapon, a procedural locomotion system, the
// combat state machine, two-bone IK for hands, the kneeling prayer with the
// sign of the cross, and a verlet-simulated cape.
import * as THREE from 'three';
import { Rig, JOINTS, JI, POSE_SIZE, newPose, poseFromDeg, handQuatFrom, weaponQuatFrom, LOWER, clearTorso, armInTorso } from './rig.js';
import { dressRig, STYLES } from './armor.js';
import { dressBody, field } from './body.js';
import { buildWeapon, WEAPONS } from './weapons.js';
import { MOVESETS, COMMON } from './moves.js';
import { clothTextures } from './textures.js';
import { clamp, lerp, damp, dampAngle, angleDiff, smooth, TAU } from './util.js';

const D2R = Math.PI / 180;
const HIP_O = JOINTS.length * 3;
const UPPER_IDX = ['spine', 'chest', 'neck', 'head', 'clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL'].map((j) => JI[j]);
const LOWER_IDX = ['hips', ...LOWER].map((j) => JI[j]);
const ARM_JOINTS = ['uArmR', 'fArmR', 'handR', 'uArmL', 'fArmL', 'handL'];

export const RELICS = {
  water: { name: 'Holy Water', desc: 'Hurl a blessed vial. Scalds demons and hallows the ground.', cooldown: 16 },
  reliquary: { name: 'Reliquary of St. Giles', desc: 'Raise the relic: heals nearby knights and drives demons back.', cooldown: 28 },
  medal: { name: 'Medal of St. Michael', desc: 'For eight seconds your blows burn with holy fire.', cooldown: 26 },
};
export const HERALDRY = {
  gules: { name: 'Gules', cloth: [128, 22, 26], plume: [0.75, 0.1, 0.1] },
  azure: { name: 'Azure', cloth: [24, 46, 112], plume: [0.15, 0.25, 0.7] },
  sable: { name: 'Sable', cloth: [22, 20, 22], plume: [0.08, 0.08, 0.08] },
  vert: { name: 'Vert', cloth: [26, 82, 40], plume: [0.15, 0.5, 0.2] },
  purpure: { name: 'Purpure', cloth: [78, 26, 92], plume: [0.45, 0.15, 0.55] },
  argent: { name: 'Argent', cloth: [200, 196, 186], plume: [0.9, 0.88, 0.84] },
};

// ---------------------------------------------------------------- clip compilation
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
function compileStance(ms, wkey) {
  const neutral = { thighR: [4, 0, -4], shinR: [10, 0, 0], footR: [-8, 0, 0], thighL: [-6, 0, 4], shinL: [10, 0, 0], footL: [-4, 0, 0] };
  const s = ms.stance;
  const mk = (spec) => ({
    pose: poseFromDeg(Object.assign({}, neutral, s.body, spec?.body || {})),
    w: spec?.w || s.w, l: spec?.l || s.l || null,
    pr: spec?.pr || s.pr || [-0.7, -0.6, -0.4], pl: spec?.pl || s.pl || [0.7, -0.6, -0.4],
  });
  return { stance: mk(null), carry: mk(ms.carry), block: mk(ms.block) };
}
function compileClip(clip, st) {
  const base = st.stance;
  const keys = [{ t: 0 }, ...clip.keys];
  if (keys[keys.length - 1].t < clip.dur - 1e-4) keys.push({ t: clip.dur });
  const n = keys.length;
  const times = new Float32Array(n);
  const pose = new Float32Array(n * POSE_SIZE), wch = new Float32Array(n * 9), lch = new Float32Array(n * 9), poles = new Float32Array(n * 6);
  let hasL = !!base.l;
  let prevW = base.w, prevL = base.l;
  for (let i = 0; i < n; i++) {
    const k = keys[i]; times[i] = k.t;
    const p = Float32Array.from(base.pose);
    if (k.body) { const o = poseFromDeg(k.body, p); p.set(o); }
    const h = k.hip || [0, 0, 0]; p[HIP_O] = h[0]; p[HIP_O + 1] = h[1]; p[HIP_O + 2] = h[2];
    pose.set(p, i * POSE_SIZE);
    const w = k.w || (i === 0 || i === n - 1 ? base.w : (clip.keepWeapon ? base.w : prevW)); prevW = w;
    wch.set([...w.p, ...w.d, ...w.u], i * 9);
    const l = k.l || (i === 0 || i === n - 1 ? base.l : prevL); prevL = l;
    if (k.l) hasL = true;
    if (l) lch.set([...l.p, ...l.d, ...l.u], i * 9);
    else lch.set([0.22, 0.95, 0.05, 0, 1, 0, 0, 0, 1], i * 9);
    poles.set([...(k.pr || base.pr), ...(k.pl || base.pl)], i * 6);
  }
  return { ...clip, n, times, pose, wch, lch, poles, hasL };
}
// Cubic Hermite (Catmull-Rom tangents, non-uniform) sampling of a keyed track
function sampleTrack(times, vals, stride, t, out, off = 0, count = stride) {
  const n = times.length;
  if (t <= times[0]) { for (let c = 0; c < count; c++) out[c] = vals[off + c]; return out; }
  if (t >= times[n - 1]) { for (let c = 0; c < count; c++) out[c] = vals[(n - 1) * stride + off + c]; return out; }
  let i = 0; while (i < n - 2 && t > times[i + 1]) i++;
  const t0 = times[i], t1 = times[i + 1], dt = t1 - t0, s = (t - t0) / dt;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  for (let c = 0; c < count; c++) {
    const v0 = vals[i * stride + off + c], v1 = vals[(i + 1) * stride + off + c];
    const m0 = i > 0 ? (v1 - vals[(i - 1) * stride + off + c]) / (t1 - times[i - 1]) : 0;
    const m1 = i + 2 < n ? (vals[(i + 2) * stride + off + c] - v0) / (times[i + 2] - t0) : 0;
    out[c] = h00 * v0 + h10 * dt * m0 + h01 * v1 + h11 * dt * m1;
  }
  return out;
}
function sampleRange(arr, t0, t1, t) { // root motion speed lookup
  for (const m of arr || []) if (t >= m[t0] && t < m[t1]) return m;
  return null;
}

export { compileStance, compileClip, sampleTrack };

// ---------------------------------------------------------------- cape (verlet cloth)
// A half-cloak gathered at the collar and hung over the pauldrons. The cloth is
// simulated on a coarse grid that collides with the real torso shape (body.js), the
// pauldrons and the thighs; it is drawn on a finer, smoothed grid with pleats
// pressed into it, wool sheen on the outside and a darker lining within.
const CW = 11, CH = 13, RW = 31, RH = 37;
class Cape {
  constructor(color, style) {
    this.len = 1.0; this.top = 0.2; this.hem = 1.25; this.arc = 1.9; this.ps = style?.pauldron || 1;
    const N = CW * CH;
    this.p = new Float32Array(N * 3); this.o = new Float32Array(N * 3); this.init = false;
    this.rest = this.len / (CH - 1);
    this.restW = new Float32Array(CH);
    for (let j = 0; j < CH; j++) this.restW[j] = lerp(this.top * 1.9, this.hem, Math.pow(j / (CH - 1), 0.8)) / (CW - 1);
    const geo = new THREE.PlaneGeometry(1, 1, RW - 1, RH - 1);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3.5);
    this.geo = geo;
    const ct = clothTextures(color, false, 256, 'cape');
    const map = ct.map.clone(); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
    const nmap = ct.normalMap.clone(); nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.needsUpdate = true;
    const lining = new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255).multiplyScalar(0.35);
    const mat = new THREE.MeshPhysicalMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.95, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255).lerp(new THREE.Color(1, 1, 1), 0.35), side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uLining = { value: lining };
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uLining;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = uLining * (0.7 + 0.6 * diffuseColor.g / max(0.05, diffuseColor.r + diffuseColor.g + diffuseColor.b));');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.pleat = Array.from({ length: RW }, (_, i) => Math.sin(i / (RW - 1) * Math.PI * 7) * 0.5 + Math.sin(i / (RW - 1) * Math.PI * 11 + 1.3) * 0.25);
    this._m = new THREE.Matrix4(); this._mi = new THREE.Matrix4();
  }
  anchor(i, out, chestM) {
    const u = i / (CW - 1) - 0.5, th = Math.PI + u * this.arc * 2;   // around the back of the collar
    const f = field('torso');
    const y = 0.215;
    let x, z;
    if (f) { const c = f.centre(0.16); const r = f.r(th, 0.16) * 0.78 + 0.05; x = c[0] + Math.sin(th) * r; z = c[1] + Math.cos(th) * r; }
    else { x = Math.sin(th) * 0.16; z = Math.cos(th) * 0.12; }
    return out.set(x, y, z).applyMatrix4(chestM);
  }
  update(dt, rig, wind, groundY) {
    const chest = rig.j.chest; chest.updateWorldMatrix(true, false);
    const p = this.p, o = this.o;
    const tmp = _a, d = _b;
    // after a teleport (respawn, chapter load) start the cloth afresh
    _c.setFromMatrixPosition(chest.matrixWorld);
    if (this.init && this.lastChest && this.lastChest.distanceToSquared(_c) > 4) this.init = false;
    (this.lastChest || (this.lastChest = new THREE.Vector3())).copy(_c);
    for (let i = 0; i < CW; i++) {
      this.anchor(i, tmp, chest.matrixWorld);
      if (!this.init) {
        const out = tmp.clone().sub(_c.setFromMatrixPosition(chest.matrixWorld)).setY(0).normalize();
        for (let j = 0; j < CH; j++) { const k = (j * CW + i) * 3; const sp = j * 0.03; p[k] = o[k] = tmp.x + out.x * sp; p[k + 1] = o[k + 1] = tmp.y - j * this.rest; p[k + 2] = o[k + 2] = tmp.z + out.z * sp; }
      }
      const k = i * 3; p[k] = o[k] = tmp.x; p[k + 1] = o[k + 1] = tmp.y; p[k + 2] = o[k + 2] = tmp.z;
    }
    this.init = true;
    dt = Math.min(dt, 1 / 30);
    const g = -9.8 * dt * dt, damping = 0.975, t = performance.now() * 0.001;
    for (let j = 1; j < CH; j++) for (let i = 0; i < CW; i++) {
      const k = (j * CW + i) * 3;
      const vx = (p[k] - o[k]) * damping, vy = (p[k + 1] - o[k + 1]) * damping, vz = (p[k + 2] - o[k + 2]) * damping;
      o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2];
      const gust = (Math.sin(t * 2.3 + i * 0.6 + j * 0.45) * 0.5 + 0.7) * (j / CH);
      p[k] += vx + wind.x * dt * dt * gust * 1.6; p[k + 1] += vy + g; p[k + 2] += vz + wind.z * dt * dt * gust * 1.6;
    }
    // colliders, in the chest's frame: the torso outline, the pauldrons; thighs in world
    this._m.copy(chest.matrixWorld); this._mi.copy(this._m).invert();
    const f = field('torso');
    const thR = rig.j.thighR, thL = rig.j.thighL, shR = rig.j.shinR, shL = rig.j.shinL;
    thR.updateWorldMatrix(true, false); thL.updateWorldMatrix(true, false); shR.updateWorldMatrix(true, false); shL.updateWorldMatrix(true, false);
    const legs = [[_d.setFromMatrixPosition(thR.matrixWorld).clone(), _d.setFromMatrixPosition(shR.matrixWorld).clone()], [_d.setFromMatrixPosition(thL.matrixWorld).clone(), _d.setFromMatrixPosition(shL.matrixWorld).clone()]];
    const SH = 0.035 + 0.165;
    for (let it = 0; it < 5; it++) {
      for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
        const k = (j * CW + i) * 3;
        if (i < CW - 1) this.link(k, k + 3, (this.restW[j]));
        if (j < CH - 1) this.link(k, k + CW * 3, this.rest);
        if (i < CW - 1 && j < CH - 1) this.link(k, k + CW * 3 + 3, Math.hypot(this.rest, (this.restW[j] + this.restW[j + 1]) / 2));
        if (j < CH - 2) this.link(k, k + CW * 6, this.rest * 2, 0.35);   // bend resistance
      }
      for (let j = 1; j < CH; j++) for (let i = 0; i < CW; i++) {
        const k = (j * CW + i) * 3;
        tmp.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(this._mi);
        let moved = false;
        // torso + harness
        if (tmp.y > -0.62 && tmp.y < 0.24) {
          const yl = clamp(tmp.y, -0.42, 0.2);
          const c = f ? f.centre(yl) : [0, 0.05];
          const dx = tmp.x - c[0], dz = tmp.z - c[1];
          const th = Math.atan2(dx, dz);
          const R = (f ? f.r(th, yl) : 0.15) + (tmp.y < -0.22 ? 0.12 : 0.05);
          const dl = Math.hypot(dx, dz);
          if (dl < R && dl > 1e-5) { tmp.x = c[0] + dx * R / dl; tmp.z = c[1] + dz * R / dl; moved = true; }
        }
        // pauldrons
        for (const sx of [-1, 1]) {
          d.set(tmp.x - sx * SH, tmp.y - 0.165, tmp.z - 0.03);
          const R = 0.13 * this.ps, dl = d.length();
          if (dl < R && dl > 1e-5) { tmp.set(sx * SH, 0.165, 0.03).addScaledVector(d, R / dl); moved = true; }
        }
        if (moved) tmp.applyMatrix4(this._m); else tmp.set(p[k], p[k + 1], p[k + 2]);
        // thighs (capsules)
        for (const [a, b] of legs) {
          d.subVectors(b, a); const L2 = d.lengthSq();
          const s = clamp(_c.subVectors(tmp, a).dot(d) / L2, 0, 1);
          _c.copy(a).addScaledVector(d, s); const e = tmp.clone().sub(_c); const el = e.length(); const R = 0.13;
          if (el < R && el > 1e-5) tmp.copy(_c).addScaledVector(e, R / el);
        }
        if (tmp.y < groundY + 0.03) tmp.y = groundY + 0.03;
        p[k] = tmp.x; p[k + 1] = tmp.y; p[k + 2] = tmp.z;
      }
    }
    this.draw();
  }
  // smooth the coarse cloth onto the render grid and press in the pleats
  draw() {
    const p = this.p, pos = this.geo.attributes.position;
    const node = (i, j, c) => p[(clamp(j, 0, CH - 1) * CW + clamp(i, 0, CW - 1)) * 3 + c];
    const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    for (let rj = 0; rj < RH; rj++) {
      const fj = rj / (RH - 1) * (CH - 1), j = Math.min(CH - 2, Math.floor(fj)), tj = fj - j;
      for (let ri = 0; ri < RW; ri++) {
        const fi = ri / (RW - 1) * (CW - 1), i = Math.min(CW - 2, Math.floor(fi)), ti = fi - i;
        for (let c = 0; c < 3; c++) {
          const row = (jj) => cr(node(i - 1, jj, c), node(i, jj, c), node(i + 1, jj, c), node(i + 2, jj, c), ti);
          const v = cr(row(j - 1), row(j), row(j + 1), row(j + 2), tj);
          if (c === 0) pos.setX(rj * RW + ri, v); else if (c === 1) pos.setY(rj * RW + ri, v); else pos.setZ(rj * RW + ri, v);
        }
      }
    }
    this.geo.computeVertexNormals();
    const nrm = this.geo.attributes.normal;
    for (let rj = 1; rj < RH; rj++) {
      const depth = 0.028 * Math.pow(rj / (RH - 1), 0.6);
      for (let ri = 0; ri < RW; ri++) {
        const q = rj * RW + ri, a = this.pleat[ri] * depth;
        pos.setXYZ(q, pos.getX(q) + nrm.getX(q) * a, pos.getY(q) + nrm.getY(q) * a, pos.getZ(q) + nrm.getZ(q) * a);
      }
    }
    pos.needsUpdate = true; this.geo.computeVertexNormals();
  }
  link(a, b, rest, stiff = 1) {
    const p = this.p;
    const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    if (stiff < 1 && d > rest) return;   // bending links only push apart
    const diff = (d - rest) / d * stiff;
    const W3 = CW * 3;
    const fa = a < W3 ? 0 : 0.5, fb = b < W3 ? 0 : 0.5; const tot = fa + fb || 1;
    const ka = fa / tot, kb = fb / tot;
    p[a] += dx * diff * ka; p[a + 1] += dy * diff * ka; p[a + 2] += dz * diff * ka;
    p[b] -= dx * diff * kb; p[b + 1] -= dy * diff * kb; p[b + 2] -= dz * diff * kb;
  }
}

// ---------------------------------------------------------------- knight
const _wq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3();

// The knight's own head, inside the helmet: a weathered face under a quilted arming cap, eyes that catch the
// light through the sights. The body model stops at the neck (the helmet replaces it), but every helmet has
// openings, and without this there was nothing behind them.
let _headParts = null;
export function knightHead({ cap = true, skin: skinHex = null } = {}) {
  if (!_headParts) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x6e564a, roughness: 0.66 });   // weathered, and in the helmet's shadow
    const beard = new THREE.MeshStandardMaterial({ color: 0x2e241e, roughness: 0.95 });
    const cap = new THREE.MeshStandardMaterial({ color: 0x5a5046, roughness: 0.95 });
    const eye = new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.15 });
    const iris = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.2 });
    const geo = (g, p, s = [1, 1, 1], r = [0, 0, 0]) => { g.scale(...s); g.rotateX(r[0]); g.rotateY(r[1]); g.rotateZ(r[2]); g.translate(...p); return g; };
    // skull and face: an egg, longer front to back, narrowing to the jaw
    const face = new THREE.SphereGeometry(1, 24, 18); const fp = face.attributes.position;
    for (let i = 0; i < fp.count; i++) { const y = fp.getY(i), z = fp.getZ(i); const jaw = Math.max(0, -y); fp.setX(i, fp.getX(i) * (1 - jaw * 0.28)); if (z > 0.3 && Math.abs(y) < 0.35) fp.setZ(i, z * 1.04); }
    geo(face, [0, 0.085, 0.012], [0.074, 0.104, 0.094]); face.computeVertexNormals();
    const nose = geo(new THREE.ConeGeometry(0.014, 0.04, 6), [0, 0.07, 0.104], [1, 1, 0.8], [Math.PI / 2 + 0.35, 0, 0]);
    const brow = geo(new THREE.CylinderGeometry(0.011, 0.011, 0.085, 8), [0, 0.103, 0.086], [1, 1, 1], [0, 0, Math.PI / 2]);
    const capG = geo(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), [0, 0.098, 0.004], [0.081, 0.112, 0.1], [-0.18, 0, 0]);
    // a short beard along the jaw and the line of the mouth
    const bd = geo(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), [0, 0.085, 0.016], [0.078, 0.108, 0.098]);
    const mouth = geo(new THREE.BoxGeometry(0.036, 0.005, 0.01), [0, 0.035, 0.1]);
    _headParts = [[face, skin], [nose, skin], [brow, skin], [capG, cap], [bd, beard], [mouth, beard]];
    for (const s2 of [-1, 1]) {
      _headParts.push([geo(new THREE.SphereGeometry(0.0125, 10, 8), [s2 * 0.03, 0.088, 0.09]), eye]);
      _headParts.push([geo(new THREE.SphereGeometry(0.006, 8, 6), [s2 * 0.03, 0.088, 0.1015]), iris]);
    }
  }
  const lit = skinHex ? new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.6 }) : null;   // out in the open, not in a helmet's shadow
  const g = new THREE.Group(); _headParts.forEach(([geo, m], i) => { if (!cap && i === 3) return; const o = new THREE.Mesh(geo, lit && i < 3 ? lit : m); o.castShadow = false; g.add(o); });
  return g;
}

const standY = (w, x, z) => (w.standAt ? w.standAt(x, z) : w.heightAt(x, z));   // altar steps included

export class Knight {
  constructor(scene, quality, loadout, opts = {}) {
    this.scene = scene; this.loadout = loadout;
    this.id = opts.id ?? 0; this.name = opts.name || 'Knight'; this.kind = 'knight';
    this.style = STYLES[loadout.style]; this.wdef = WEAPONS[loadout.weapon];
    const her = HERALDRY[loadout.heraldry] || HERALDRY.gules;
    this.rig = new Rig(opts.scale || 1);
    this.dress = dressRig(this.rig, loadout.style, loadout.finish, quality, { cloth: her.cloth, plume: loadout.plume === false ? null : her.plume });
    this.group = this.rig.root;
    this.body = dressBody(this.rig, her.cloth, quality);
    this.rig.j.head.add(knightHead());   // a man inside the helmet: seen through the sights and the gap above the bevor
    scene.add(this.group);
    this.weapon = buildWeapon(loadout.weapon, quality);
    scene.add(this.weapon);
    if (this.wdef.buckler) { this.buckler = buildWeapon('buckler', quality); this.rig.j.handL.add(this.buckler); this.buckler.position.set(0, -0.06, 0); }
    if (loadout.cape) { this.cape = new Cape(her.cloth, this.style); scene.add(this.cape.mesh); }
    // compiled animation
    const ms = MOVESETS[loadout.weapon];
    this.st = compileStance(ms, loadout.weapon);
    this.lights = ms.light.map((c) => compileClip(c, this.st));
    this.heavyClip = compileClip(ms.heavy, this.st);
    this.common = {}; for (const k in COMMON) this.common[k] = compileClip(COMMON[k], this.st);
    // state
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = 0; this.spinYaw = 0;
    this.maxHp = 150; this.hp = 150; this.stamina = 100; this.maxStamina = 100;
    this.action = null; this.actT = 0; this.combo = 0; this.queued = null; this.comboReset = 0;
    this.hitStop = 0; this.buffered = null; this.lungeExtra = 0; this.findTarget = null;
    this.blocking = false; this.blockT = 0; this.blockW = 0; this.sprintW = 0;
    this.praying = false; this.kneel = 0; this.prayT = 0;
    this.downed = false; this.downT = 0; this.reviveProgress = 0; this.dead = false;
    this.iframes = 0; this.staggerResist = 0;
    this.relicCd = 0; this.fury = 0;
    this.phase = 0; this.lastStepPhase = 0; this.speed = 0; this.moveYaw = 0; this.time = Math.random() * 10;
    this.flinch = 0; this.flinchDir = 0;
    this.pose = newPose(); this.loco = newPose(); this.from = newPose(); this.tmpPose = newPose();
    this.wNow = new Float32Array(9); this.lNow = new Float32Array(9); this.polesNow = new Float32Array(6);
    this.wFrom = new Float32Array(9); this.lFrom = new Float32Array(9); this.hasLNow = !!this.st.stance.l;
    this.armQ = ARM_JOINTS.map(() => new THREE.Quaternion()); this.armBlend = 0; this.lastIkOff = false;
    this.events = [];
    this.hitSet = new Set(); this.activeHits = [];
    this.headLook = 0; this.lookTarget = null;
    this.lastHitBy = 0; this.netAct = null;
    this.tip = new THREE.Vector3(); this.base = new THREE.Vector3(); this.prevTip = new THREE.Vector3(); this.prevBase = new THREE.Vector3();
    this.group.traverse((o) => { o.userData.knight = this; });
    if (opts.nameplate) this.makeNameplate(this.name);
  }

  makeNameplate(name) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
    x.font = '600 30px "EB Garamond", Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,0.9)'; x.shadowBlur = 6; x.fillStyle = '#efe4c8'; x.fillText(name, 128, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true, fog: false }));
    s.scale.set(1.1, 0.28, 1); s.position.set(0, 2.35, 0); s.renderOrder = 5;
    this.group.add(s); this.nameplate = s;
  }

  dispose() {
    this.scene.remove(this.group); this.scene.remove(this.weapon);
    if (this.cape) this.scene.remove(this.cape.mesh);
  }

  get forward() { return _a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get busy() { return !!this.action; }
  get canAct() { return !this.downed && !this.praying && this.kneel < 0.05; }
  get chestPos() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.3, this.pos.z); }

  // ------------------------------------------------ actions
  startAction(clip, kind, extra = {}) {
    this.action = clip; this.actKind = kind; this.actT = 0; this.actExtra = extra;
    this.from.set(this.pose); this.wFrom.set(this.wNow); this.lFrom.set(this.lNow);
    this.hitSet.clear(); this.sfxIdx = 0; this.aoeDone = new Set(); this.released = false;
    this.events.push({ type: 'act', kind, clip: clip.name || kind, combo: this.combo });
  }
  actionSpeed() {
    let s = this.wdef.speed * (1 + (this.style.speed - 1) * 0.6);
    if (this.fury > 0) s *= 1.12;
    return s;
  }
  tryAttack(heavy) {
    if (this.downed) return false;
    if (!this.canAct) { this.buffered = { heavy, t: 0.3 }; return false; }
    if (this.action) {
      const a = this.action; const t = this.actT;
      // the next blow is queued as soon as the swing is under way, and chains the moment this one allows
      if (this.actKind === 'light' || this.actKind === 'heavy') { if (t > Math.min(0.12, a.chain * 0.3) && t < a.dur) { this.queued = heavy ? 'heavy' : 'light'; return true; } return false; }
      // pressed during a roll, a stagger or getting up: held a moment and thrown the instant he can
      this.buffered = { heavy, t: 0.35 };
      return false;
    }
    return this.beginAttack(heavy);
  }
  beginAttack(heavy) {
    const clip = heavy ? this.heavyClip : this.lights[this.combo % this.lights.length];
    const cost = clip.stamina * this.wdef.stamina;
    if (this.stamina < cost * 0.5) { this.events.push({ type: 'tired' }); return false; }
    this.stamina -= cost; this.staminaDelay = 0.9;
    // close on the nearest foe in front: turn to him and let the step of the blow carry you into reach
    this.lungeExtra = 0;
    const tg = this.findTarget ? this.findTarget(this) : null;
    if (tg) {
      const reach = (this.wdef.hitTo || 1) * 0.8 + 0.5;
      const want = Math.atan2(tg.x - this.pos.x, tg.z - this.pos.z), off = angleDiff(this.yaw, want);
      if (Math.abs(off) < 1.0) this.yaw += off * 0.85;
      this.lungeExtra = clamp(tg.dist - reach, 0, heavy ? 2.0 : 1.4);
    }
    this.startAction(clip, heavy ? 'heavy' : 'light');
    if (!heavy) this.combo = (this.combo + 1) % this.lights.length; else this.combo = 0;
    this.comboReset = 1.2;
    return true;
  }
  tryDodge(dirYaw) {
    if (!this.canAct) return false;
    if (this.action && !(this.actT >= (this.action.cancel ?? 99)) && this.actKind !== 'stagger') return false;
    const c = this.common.roll; if (this.stamina < 10) return false;
    this.stamina -= c.stamina; this.staminaDelay = 0.8;
    if (dirYaw !== undefined) this.yaw = dirYaw;
    this.startAction(c, 'roll'); this.combo = 0;
    return true;
  }
  tryRelic() {
    if (!this.canAct || this.action || this.relicCd > 0) return false;
    const r = this.loadout.relic;
    this.startAction(r === 'water' ? this.common.relicThrow : this.common.relicRaise, 'relic', { relic: r });
    this.relicCd = RELICS[r].cooldown * (this.relicMul || 1);
    return true;
  }
  salute() { if (!this.downed) this.startAction(this.common.salute, 'salute'); }

  // Incoming damage. Returns {blocked, parried, dmg}
  receiveHit(dmg, fromPos, opts = {}) {
    if (this.downed || this.dead) return { ignored: true };
    if (this.iframes > 0 || (this.action && this.action.iframes && this.actT > this.action.iframes[0] && this.actT < this.action.iframes[1])) return { dodged: true };
    const toAttacker = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
    const facing = Math.abs(angleDiff(this.yaw, toAttacker)) < 1.2;
    if (this.blocking && facing && !opts.unblockable) {
      const parry = this.blockT < 0.22;
      if (parry) { this.events.push({ type: 'parry' }); return { blocked: true, parried: true, dmg: 0 }; }
      const cost = dmg * 0.9;
      if (this.stamina >= cost) { this.stamina -= cost; this.staminaDelay = 1; this.flinch = 0.4; this.events.push({ type: 'block' }); return { blocked: true, dmg: 0 }; }
      this.stamina = 0; dmg *= 0.6; // guard broken
      this.events.push({ type: 'guardBreak' });
    }
    if (this.praying) dmg *= 0.85;
    const real = dmg / this.style.armor;
    this.hp -= real;
    this.flinch = 1; this.flinchDir = angleDiff(this.yaw, toAttacker);
    this.events.push({ type: 'hurt', dmg: real });
    if (this.hp <= 0) { this.goDown(); return { dmg: real, downed: true }; }
    const big = opts.knockdown || (opts.stagger && dmg > 20);
    if (opts.knockdown && !this.praying) { this.praying = false; this.startAction(this.common.knockdown, 'knockdown'); }
    else if (big && !this.praying && (!this.action || this.actKind === 'light')) this.startAction(this.common.stagger, 'stagger');
    if (opts.knockback) { const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z; const l = Math.hypot(dx, dz) || 1; this.vel.x += dx / l * opts.knockback; this.vel.z += dz / l * opts.knockback; }
    return { dmg: real };
  }
  goDown() {
    this.hp = 0; this.downed = true; this.downT = 0; this.reviveProgress = 0; this.praying = false; this.action = null; this.blocking = false;
    this.events.push({ type: 'downed' });
  }
  revive(hpFrac = 0.4) {
    if (!this.downed) return;
    this.downed = false; this.hp = this.maxHp * hpFrac; this.iframes = 2; this.reviveProgress = 0;
    this.startAction(this.common.knockdown, 'getup'); this.actT = 1.1;
    this.events.push({ type: 'revived' });
  }

  // ------------------------------------------------ simulation (authority side)
  // input: { mx, mz (world move vector, length<=1), aimYaw, sprint, block, pray, attack, heavy, dodge, relic }
  simulate(dt, input, world) {
    this.time += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.relicCd = Math.max(0, this.relicCd - dt);
    this.fury = Math.max(0, this.fury - dt);
    this.comboReset -= dt; if (this.comboReset < 0 && !this.action) this.combo = 0;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    if (this.downed) {
      this.downT += dt; this.vel.multiplyScalar(0.8); this.speed = 0;
      this.pos.y = standY(world, this.pos.x, this.pos.z);
      return;
    }
    // stamina
    this.staminaDelay = Math.max(0, (this.staminaDelay || 0) - dt);
    if (this.staminaDelay <= 0 && !(input.sprint && this.speed > 4)) this.stamina = Math.min(this.maxStamina, this.stamina + dt * 30 * this.style.stamina * (this.blocking ? 0.4 : 1) * (this.dreadStam || 1));

    // prayer
    const wantPray = input.pray && !this.action && world.canPrayAt(this);
    if (wantPray && !this.praying) { this.praying = true; this.prayT = 0; this.events.push({ type: 'prayStart' }); }
    if (!input.pray && this.praying) { this.praying = false; this.events.push({ type: 'prayEnd' }); }
    if (this.praying) this.prayT += dt;
    this.kneel = clamp(this.kneel + (this.praying ? dt / 0.75 : -dt / 0.5), 0, 1);

    // blocking
    const wantBlock = input.block && this.canAct && (!this.action || this.actKind === 'stagger');
    if (wantBlock) { if (!this.blocking) this.blockT = 0; this.blocking = true; this.blockT += dt; }
    else this.blocking = false;

    // actions
    if (this.buffered) { this.buffered.t -= dt; if (this.buffered.t <= 0) this.buffered = null; }
    if (this.canAct) {
      if (input.dodge) { const my = Math.hypot(input.mx, input.mz) > 0.2 ? Math.atan2(input.mx, input.mz) : this.yaw; this.tryDodge(my); }
      if (input.attack) this.tryAttack(false);
      if (input.heavy) this.tryAttack(true);
      if (!input.attack && !input.heavy && this.buffered && !this.action) { const b = this.buffered; this.buffered = null; this.tryAttack(b.heavy); }
      if (input.relic) this.tryRelic();
    }
    if (this.action) this.advanceAction(dt, input, world);

    // locomotion
    const moving = Math.hypot(input.mx, input.mz);
    let target = 0; const sp = this.style.speed;
    if (this.praying || this.kneel > 0.05) target = 0;
    else if (this.blocking) target = 2.1 * sp;
    else if (input.sprint && this.stamina > 2) { target = 6.8 * sp; this.stamina -= dt * 9; this.staminaDelay = 0.4; }
    else target = 4.3 * sp;
    let ax = input.mx * target, az = input.mz * target;
    if (moving < 0.05) { ax = 0; az = 0; }
    if (this.action) {
      const a = this.action;
      const m = sampleRange(a.moves, 't0', 't1', this.actT);
      let rm = m ? m.v : 0;
      // the extra step into reach of the target, spread over the blow's own step
      if (m && this.lungeExtra > 0 && (this.actKind === 'light' || this.actKind === 'heavy')) rm += this.lungeExtra / Math.max(0.1, (m.t1 - m.t0) / this.actionSpeed());
      // the blade bites: everything stops for a moment
      if (this.hitStop > 0) rm *= 0.1; else if (this.biteScale !== undefined && this.biteScale < 1) rm *= this.biteScale;
      if (this.actKind === 'roll') { ax = 0; az = 0; }
      else { ax *= 0.15; az *= 0.15; }
      if (a.legs === 'run') { /* charge */ }
      const f = this.forward; ax += f.x * rm; az += f.z * rm;
      this.vel.x = damp(this.vel.x, ax, 20, dt); this.vel.z = damp(this.vel.z, az, 20, dt);
    } else {
      const accel = moving > 0.05 ? 10 : 12;
      this.vel.x = damp(this.vel.x, ax, accel, dt); this.vel.z = damp(this.vel.z, az, accel, dt);
    }
    // facing
    if (!this.action || this.actT < 0.08) {
      if (this.blocking || (this.action && (this.actKind === 'light' || this.actKind === 'heavy'))) {
        this.yaw = dampAngle(this.yaw, input.aimYaw ?? this.yaw, this.action ? 30 : 14, dt);
      } else if (input.lock && !this.praying && !this.downed && !(this.action && this.actKind === 'roll')) {
        // shift lock: face where the camera looks and strafe
        this.yaw = dampAngle(this.yaw, input.aimYaw ?? this.yaw, 16, dt);
      } else if (moving > 0.1 && !this.praying) {
        this.yaw = dampAngle(this.yaw, Math.atan2(input.mx, input.mz), input.sprint ? 7 : 11, dt);
      }
    }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    world.collide(this, 0.42);
    this.pos.y = standY(world, this.pos.x, this.pos.z);
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.sprintW = damp(this.sprintW, input.sprint && this.speed > 5 && !this.action ? 1 : 0, 6, dt);
  }

  advanceAction(dt, input, world) {
    const a = this.action;
    // the blade bites: it stops dead in the body for a beat, then drags on through the cut, slow at first,
    // gathering speed as it comes clear (a club rebounds sooner)
    let hs = this.hitStop > 0 ? 0.05 : 1; this.hitStop = Math.max(0, this.hitStop - dt);
    if (this.biteT !== undefined && this.biteT < (this.biteFreeze || 0) + (this.biteDrag || 0)) {
      this.biteT += dt;
      hs = this.biteT < this.biteFreeze ? 0.05 : lerp(0.22, 1, smooth(clamp((this.biteT - this.biteFreeze) / this.biteDrag, 0, 1)));
    }
    this.biteScale = hs;
    this.actT += hs * dt * (this.actKind === 'roll' || this.actKind === 'stagger' || this.actKind === 'knockdown' || this.actKind === 'getup' ? 1 : this.actionSpeed());
    // sound cues
    if (a.sfx) while (this.sfxIdx < a.sfx.length && this.actT >= a.sfx[this.sfxIdx].t) { this.events.push({ type: 'sfx', k: a.sfx[this.sfxIdx].k }); this.sfxIdx++; }
    if (a.release !== undefined && !this.released && this.actT >= a.release) { this.released = true; this.events.push({ type: 'relic', relic: this.actExtra.relic }); }
    // ground slams
    if (a.hits) for (const h of a.hits) if (h.aoe && !this.aoeDone.has(h) && this.actT >= h.aoe.t) { this.aoeDone.add(h); this.events.push({ type: 'slam', r: h.aoe.r, dmg: h.aoe.dmg * this.dmgMul() }); }
    // combo chaining
    if (this.queued && this.actT >= a.chain) {
      const q = this.queued; this.queued = null; this.action = null;
      if (!this.beginAttack(q === 'heavy')) this.action = null;
      return;
    }
    if (this.actT >= a.dur) { this.action = null; this.queued = null; }
  }
  // a different weapon from the sutler's wagon: new steel in the hands, and the moves that go with it
  setWeapon(key, quality) {
    if (!WEAPONS[key] || key === this.loadout.weapon) return;
    this.scene.remove(this.weapon); this.weapon.traverse((o) => o.geometry?.dispose?.());
    if (this.buckler) { this.buckler.removeFromParent(); this.buckler = null; }
    this.loadout = { ...this.loadout, weapon: key }; this.wdef = WEAPONS[key];
    this.weapon = buildWeapon(key, quality); this.scene.add(this.weapon);
    if (this.wdef.buckler) { this.buckler = buildWeapon('buckler', quality); this.rig.j.handL.add(this.buckler); this.buckler.position.set(0, -0.06, 0); }
    const ms = MOVESETS[key];
    this.st = compileStance(ms, key);
    this.lights = ms.light.map((c) => compileClip(c, this.st));
    this.heavyClip = compileClip(ms.heavy, this.st);
    this.common = {}; for (const k in COMMON) this.common[k] = compileClip(COMMON[k], this.st);
    this.action = null; this.combo = 0; this.queued = null; this.hasLNow = !!this.st.stance.l; this.leftGripS = undefined;
  }
  // tempering, proofing and blessing bought from the sutler
  applyUpgrades(u) {
    this.edgeMul = 1 + 0.12 * (u.edge || 0);
    const hp0 = this.maxHp; this.maxHp = 150 + 20 * (u.proof || 0); if (this.hp > 0) this.hp = Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - hp0));
    this.relicMul = 1 - 0.15 * (u.blessing || 0);
  }
  deflectWeapon(wp, wd) {
    // capsules sized to the harness, not the body: cuirass and fauld, pauldrons, helm, cuisses and greaves
    const j = this.rig.j; this.rig.root.updateMatrixWorld(true);
    const W = (n) => new THREE.Vector3().setFromMatrixPosition(j[n].matrixWorld);
    const caps = this._caps || (this._caps = []); caps.length = 0;
    const hips = W('hips'), neck = W('neck');
    caps.push([hips.clone().lerp(neck, 0.05), neck.clone().lerp(hips, 0.12), 0.24]);
    caps.push([W('uArmR'), W('uArmL'), 0.12]);
    { const hd = W('head'); caps.push([hd, hd.clone().addScaledVector(hd.clone().sub(neck).normalize(), 0.18), 0.15]); }
    for (const sd of ['R', 'L']) { const th = W('thigh' + sd), kn = W('shin' + sd), an = W('foot' + sd); caps.push([th, kn, 0.13], [kn, an, 0.09]); }
    // how far the weapon runs back past the right hand: pommel, or the butt of a haft
    const butt = this.wdef.butt ?? (this.wdef.hand === 'pole' ? 0.62 : this.wdef.twoHanded ? 0.3 : 0.12);
    const tip = this.wdef.hitTo + 0.05, q = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), best = new THREE.Vector3();
    const ts = []; for (let i = 0; i <= 3; i++) ts.push(-butt + (butt - 0.12) * (i / 3)); for (let i = 0; i <= 12; i++) ts.push(0.2 + (tip - 0.2) * (i / 12));
    let moved = 0;
    for (let it = 0; it < 5; it++) {
      let pen = 0, bt = 0;
      for (const t of ts) {
        q.copy(wp).addScaledVector(wd, t);
        for (const [a, b, r] of caps) {
          ab.subVectors(b, a); const u = clamp(q.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); c.copy(a).addScaledVector(ab, u);
          const d = q.distanceTo(c), p = r + 0.025 - d;
          if (p > pen) { pen = p; bt = t; best.subVectors(q, c); if (d < 1e-4) best.set(0, 1, 0); best.normalize(); }
        }
      }
      if (pen < 0.006) break;
      if (bt < 0 && moved < 0.2) { wp.addScaledVector(best, pen + 0.01); moved += pen; }        // the pommel or butt: carry the whole weapon out
      else { q.copy(wp).addScaledVector(wd, bt).addScaledVector(best, (pen + 0.012) * (bt < 0 ? -1 : 1)); wd.subVectors(q, wp).multiplyScalar(bt < 0 ? -1 : 1).normalize(); }   // the blade: swing it clear about the grip
    }
  }
  dmgMul() { return this.wdef.dmg * (this.fury > 0 ? 1.5 : 1) * (this.dreadMul || 1) * (this.edgeMul || 1); }

  // Active hit windows this frame (attack authority runs collision)
  currentHits() {
    const a = this.action; if (!a || !a.hits || this.downed) return null;
    const out = this.activeHits; out.length = 0;
    for (const h of a.hits) if (this.actT >= h.t0 && this.actT <= h.t1) out.push(h);
    return out.length ? out : null;
  }

  // ------------------------------------------------ remote / AI-driven state from network
  applyNet(s, dt) {
    // s: {x,y,z,yaw,vx,vz,a:[kind,clipIdx,t],hp,st,f}
    this.netTarget = s;
  }

  // ------------------------------------------------ animation
  plantFeet(world, dt) {
    const rig = this.rig, s = rig.scale;
    const ank = [_a.setFromMatrixPosition(rig.j.footR.matrixWorld).clone(), _b.setFromMatrixPosition(rig.j.footL.matrixWorld).clone()];
    const want = [], def = [];
    for (let i = 0; i < 2; i++) {
      const lift = Math.max(0, ank[i].y - this.pos.y - 0.06 * s);
      want[i] = standY(world, ank[i].x, ank[i].z) + 0.068 * s + lift;
      def[i] = want[i] - ank[i].y;
    }
    const drop = clamp(Math.min(0, def[0], def[1]), -0.3, 0);
    this.hipDrop = damp(this.hipDrop || 0, drop, 14, dt);
    if (Math.abs(this.hipDrop) < 0.004 && Math.abs(def[0]) < 0.01 && Math.abs(def[1]) < 0.01) return;
    rig.j.hips.position.y += this.hipDrop / s;
    rig.root.updateMatrixWorld(true);
    const fwd = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    ['R', 'L'].forEach((side, i) => {
      const a = _d.setFromMatrixPosition(rig.j['foot' + side].matrixWorld);
      const ty = want[i]; if (Math.abs(ty - a.y) < 0.006) return;
      const footQ = rig.j['foot' + side].getWorldQuaternion(_wq).clone();
      rig.solveLeg(side, new THREE.Vector3(a.x, ty, a.z), fwd.clone().add(_u.set(0, 0.2, 0)));
      // keep the sole's world orientation
      rig.j['shin' + side].updateWorldMatrix(true, false);
      rig.j['foot' + side].quaternion.copy(rig.j['shin' + side].getWorldQuaternion(_hq).invert().multiply(footQ));
    });
    rig.root.updateMatrixWorld(true);
  }

  locomotion(dt) {
    const P = this.loco; P.set(this.st.stance.pose);
    // blend in carry (sprint) / block stance bodies
    const sp = this.speed;
    const run = clamp((sp - 3.0) / 3.5, 0, 1);
    // movement direction relative to facing
    let mAng = 0;
    if (sp > 0.3) mAng = angleDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z));
    let back = Math.abs(mAng) > 1.9;
    let legYaw = back ? angleDiff(0, mAng + Math.PI) : mAng;
    legYaw = clamp(legYaw, -1.25, 1.25);
    this.moveYaw = damp(this.moveYaw, sp > 0.3 ? legYaw : 0, 8, dt);
    const stride = lerp(1.35, 2.3, run);
    const dir = back ? -1 : 1;
    this.phase = (this.phase + dir * dt * sp / stride + 10) % 1;
    const amp = clamp(sp / 4.3, 0, 1);
    const ph = this.phase * TAU;
    const s = Math.sin(ph), c = Math.cos(ph);
    const s2 = Math.sin(ph + Math.PI), c2 = Math.cos(ph + Math.PI);
    const A = lerp(26, 42, run) * amp, B = lerp(38, 85, run) * amp;
    const leg = (side, ss, cc) => {
      const t = JI['thigh' + side] * 3, k = JI['shin' + side] * 3, f = JI['foot' + side] * 3;
      const thigh = -A * ss - run * 8 * amp;
      const knee = 6 + B * Math.max(0, cc) * (0.4 + 0.6 * Math.max(0, cc)) + 8 * amp * Math.max(0, -ss);
      P[t] = lerp(P[t], thigh * D2R, amp); P[k] = lerp(P[k], knee * D2R, amp);
      P[f] = lerp(P[f], (-(thigh + knee) * 0.55 + 12 * Math.max(0, -cc) * run) * D2R, amp);
    };
    leg('R', s, c); leg('L', s2, c2);
    const hips = JI.hips * 3;
    P[hips + 1] = (this.moveYaw * 0.85 + 5 * s * amp * D2R);
    P[hips + 2] = 3 * c * amp * D2R;
    const sp_i = JI.spine * 3, ch = JI.chest * 3;
    P[sp_i + 1] += -this.moveYaw * 0.5 - 3 * s * amp * D2R;
    P[ch + 1] += -this.moveYaw * 0.35 - 2 * s * amp * D2R;
    P[sp_i] += (4 * amp + 8 * run) * D2R;
    // momentum: bank into turns, lean back when braking and into the run when setting off
    const turn = angleDiff(this.prevYawL ?? this.yaw, this.yaw) / Math.max(dt, 1e-3); this.prevYawL = this.yaw;
    const vf = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    const accel = (vf - (this.prevVf ?? vf)) / Math.max(dt, 1e-3); this.prevVf = vf;
    this.leanZ = damp(this.leanZ || 0, clamp(-turn * sp * 0.035, -0.22, 0.22), 6, dt);
    this.leanX = damp(this.leanX || 0, clamp(accel * 0.012, -0.12, 0.14), 5, dt);
    P[sp_i + 2] += this.leanZ * 0.6; P[ch + 2] += this.leanZ * 0.4; P[hips + 2] += this.leanZ * 0.3;
    P[sp_i] += this.leanX * 0.6; P[ch] += this.leanX * 0.4;
    // breathing + idle sway
    const br = Math.sin(this.time * 1.7);
    P[ch] += br * 1.2 * D2R; P[JI.head * 3] -= br * 0.6 * D2R;
    P[HIP_O + 1] = -0.035 * (0.4 + run) * amp * (0.5 + 0.5 * Math.cos(2 * (ph - Math.PI / 2))) - 0.012 * (1 - amp) + br * 0.004 * (1 - amp);
    P[HIP_O] = Math.sin(this.time * 0.6) * 0.008 * (1 - amp);
    // footstep events at contact
    const cyc = this.phase;
    const crossed = (x) => (this.lastStepPhase < x && cyc >= x) || (this.lastStepPhase > cyc && (x > this.lastStepPhase || x <= cyc) && dir > 0);
    if (sp > 0.8 && (crossed(0.25) || crossed(0.75))) this.events.push({ type: 'step', run });
    this.lastStepPhase = cyc;
    // flinch (additive)
    if (this.flinch > 0) {
      const f = this.flinch * this.flinch;
      P[sp_i] -= 10 * f * D2R; P[ch] -= 8 * f * D2R; P[JI.head * 3] -= 16 * f * D2R;
      P[ch + 2] += Math.sign(this.flinchDir) * 6 * f * D2R;
    }
    // look at
    P[JI.head * 3 + 1] += this.headLook * 0.6; P[JI.neck * 3 + 1] += this.headLook * 0.4;
    return P;
  }

  animate(dt, world) {
    const P = this.pose;
    const L = this.locomotion(dt);
    // stance weapon channels: stance <-> carry (sprint) <-> block
    const bw = this.blockW = damp(this.blockW, this.blocking ? 1 : 0, 18, dt);
    // carried for running: fully when sprinting, part of the way at a run (never mid-blow or in guard)
    const runC = this.action || this.blocking ? 0 : clamp((this.speed - 3.4) / 1.6, 0, 1);
    const sw = this.carryW = damp(this.carryW || 0, Math.max(this.sprintW, runC * 0.85), 8, dt);
    const S0 = this.st.stance, S1 = this.st.carry, S2 = this.st.block;
    const W = this.wNow, Lh = this.lNow, PO = this.polesNow;
    const mixV = (out, off, a, b, c) => { for (let i = 0; i < 3; i++) out[off + i] = a[i] * (1 - sw - bw * (1 - sw)) + b[i] * sw + c[i] * bw * (1 - sw); };
    const m0 = Math.max(0, 1 - sw - bw * (1 - sw));
    for (let i = 0; i < 3; i++) {
      W[i] = S0.w.p[i] * m0 + S1.w.p[i] * sw + S2.w.p[i] * bw * (1 - sw);
      W[3 + i] = S0.w.d[i] * m0 + S1.w.d[i] * sw + S2.w.d[i] * bw * (1 - sw);
      W[6 + i] = S0.w.u[i] * m0 + S1.w.u[i] * sw + S2.w.u[i] * bw * (1 - sw);
      PO[i] = (S0.pr[i] * (1 - sw) + S1.pr[i] * sw) * (1 - bw) + S2.pr[i] * bw; PO[3 + i] = (S0.pl[i] * (1 - sw) + S1.pl[i] * sw) * (1 - bw) + S2.pl[i] * bw;
    }
    let hasL = !!S0.l;
    if (S0.l) for (let i = 0; i < 3; i++) {
      Lh[i] = S0.l.p[i] * m0 + (S1.l || S0.l).p[i] * sw + (S2.l || S0.l).p[i] * bw * (1 - sw);
      Lh[3 + i] = S0.l.d[i] * m0 + (S1.l || S0.l).d[i] * sw + (S2.l || S0.l).d[i] * bw * (1 - sw);
      Lh[6 + i] = S0.l.u[i] * m0 + (S1.l || S0.l).u[i] * sw + (S2.l || S0.l).u[i] * bw * (1 - sw);
    }
    // blend upper body toward carry/block body poses
    P.set(L);
    if (sw > 0 || bw > 0) for (const idx of UPPER_IDX) for (let k = 0; k < 3; k++) {
      const i = idx * 3 + k; P[i] += (S1.pose[i] - S0.pose[i]) * sw + (S2.pose[i] - S0.pose[i]) * bw * (1 - sw);
    }
    // weapon-bob with the stride
    W[1] += P[HIP_O + 1] * 0.6;

    // action
    let ikOff = false, freeLeft = false, spin = 0;
    const a = this.action;
    if (a) {
      const t = Math.min(this.actT, a.dur);
      const A = sampleTrack(a.times, a.pose, POSE_SIZE, t, this.tmpPose);
      const wa = sampleTrack(a.times, a.wch, 9, t, new Float32Array(9));
      const la = sampleTrack(a.times, a.lch, 9, t, new Float32Array(9));
      const pa = sampleTrack(a.times, a.poles, 6, t, new Float32Array(6));
      const bin = 0.1, bout = 0.18;
      const wIn = smooth(clamp(t / bin, 0, 1)), wOut = 1 - smooth(clamp((t - (a.dur - bout)) / bout, 0, 1));
      const inBlend = t < bin;
      const wgt = inBlend ? wIn : wOut;
      const full = a.fullBody;
      for (let j = 0; j < JOINTS.length; j++) {
        const isLower = LOWER_IDX.includes(j);
        if (isLower && !full) continue;
        for (let k = 0; k < 3; k++) {
          const i = j * 3 + k;
          const baseV = inBlend ? this.from[i] : P[i];
          let d = A[i] - baseV; if (!inBlend && Math.abs(d) > Math.PI * 1.5) d = angleDiff(baseV, A[i]);
          P[i] = baseV + d * wgt;
        }
      }
      if (full) for (let k = 0; k < 3; k++) { const i = HIP_O + k; const bv = inBlend ? this.from[i] : P[i]; P[i] = bv + (A[i] - bv) * wgt; }
      else for (let k = 0; k < 3; k++) P[HIP_O + k] += A[HIP_O + k] * wgt;
      if (a.legs === 'run') { // charge: keep running legs, override speed visuals
        this.speed = Math.max(this.speed, 6);
      }
      for (let i = 0; i < 9; i++) { const bv = inBlend ? this.wFrom[i] : W[i]; W[i] = bv + (wa[i] - bv) * wgt; }
      if (a.hasL) { for (let i = 0; i < 9; i++) { const bv = inBlend ? (hasL ? this.lFrom[i] : la[i]) : (hasL ? Lh[i] : la[i]); Lh[i] = bv + (la[i] - bv) * wgt; } hasL = true; }
      for (let i = 0; i < 6; i++) PO[i] = PO[i] + (pa[i] - PO[i]) * wgt;
      ikOff = !!a.ikOff; freeLeft = !!a.freeLeft && (!a.release || t > a.release * 0.6);
      // full turns (±2π) leave the knight facing where he started
      if (a.spin) for (const s of a.spin) { if (t >= s.t0) spin += s.a * smooth(clamp((t - s.t0) / (s.t1 - s.t0), 0, 1)); }
    }

    // prayer / kneeling overrides
    if (this.kneel > 0) this.applyKneel(P, this.kneel);
    // downed
    if (this.downed) this.applyDowned(P);

    this.lastIkOff = ikOff;
    // ---- apply
    this.rig.applyPose(P);
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw + spin, 0);
    this.group.updateMatrixWorld(true);
    // feet on the real ground: on slopes the hips sink to the lower foot and each leg reaches its own ground
    if (world && !this.downed && this.kneel < 0.05 && this.actKind !== 'roll') this.plantFeet(world, dt);
    this.renderYaw = this.yaw + spin;
    const rootQ = _rq.setFromAxisAngle(_a.set(0, 1, 0), this.yaw + spin);
    const toWorld = (x, y, z, out) => out.set(x, y, z).applyQuaternion(rootQ).add(this.pos);
    const dirWorld = (x, y, z, out) => out.set(x, y, z).applyQuaternion(rootQ);

    // weapon placement
    const planted = this.kneel > 0 ? smooth(clamp(this.kneel * 1.6 - 0.3, 0, 1)) : 0;
    const wp = toWorld(W[0], W[1], W[2], new THREE.Vector3());
    const wd = dirWorld(W[3], W[4], W[5], new THREE.Vector3()).normalize();
    const wu = dirWorld(W[6], W[7], W[8], new THREE.Vector3());
    if (planted > 0) {
      const pl = this.plantedSpec();
      const pp = toWorld(...pl.p, new THREE.Vector3()), pd = dirWorld(...pl.d, new THREE.Vector3()).normalize(), pu = dirWorld(...pl.u, new THREE.Vector3());
      wp.lerp(pp, planted); wd.lerp(pd, planted).normalize(); wu.lerp(pu, planted);
    }
    if (this.downed) {
      // weapon lies beside the fallen knight
      const ly = new THREE.Vector3(-0.5, 0.05, 0.4); toWorld(ly.x, ly.y, ly.z, wp); dirWorld(0.2, 0, 1, wd).normalize(); dirWorld(0, 1, 0, wu);
    }
    // the blade never passes through its own knight: swing it clear of legs and body, pivoting at the grip
    if (!ikOff && !this.downed && planted < 0.5) this.deflectWeapon(wp, wd);
    // keep the weapon in both hands' reach; the leading hand slides along a haft
    if (!ikOff && !this.downed && planted < 0.5) {
      let lgFit = null;
      if (this.wdef.twoHanded && !freeLeft) {
        const r = this.wdef.gripRange || [this.wdef.leftGrip, this.wdef.leftGrip];
        const want = this.rig.chooseGrip('L', wp, wd, this.wdef.leftGrip, r[0], r[1]);
        this.leftGripS = this.leftGripS === undefined ? want : damp(this.leftGripS, want, 14, dt);
        lgFit = this.leftGripS;
      }
      this.rig.fitWeapon(wp, wd, wu, lgFit);
      clearTorso(this.rig, wp, wd, this.wdef.twoHanded && !freeLeft ? lgFit : null, field('torso'));
      this.deflectWeapon(wp, wd);   // again, after the reach and torso corrections moved it
    }
    weaponQuatFrom(wd, wu, _wq);
    if (!ikOff && !this.downed) {
      // right hand to the grip (unless the sign of the cross has it)
      const crossR = this.kneel > 0.6 ? this.crossTarget() : null;
      const roll = this.wdef.roll || [0, 0];
      const TF = field('torso');
      // if an arm still cannot get round the body (the pole alone can't free a forearm folded across the chest),
      // the whole weapon is carried out away from the body and both arms solved again
      let pushed = 0;
      for (let pass = 0; pass < 3; pass++) {
        if (crossR) this.rig.solveArm('R', crossR.wrist, crossR.pole, crossR.q);
        else this.rig.gripArmClear('R', wp, wd, wu, dirWorld(PO[0], PO[1], PO[2], _c), roll[0] * D2R, TF);
        // left hand: on the haft / hilt, or free (buckler, relic)
        const twoH = this.wdef.twoHanded && !freeLeft;
        if (twoH) {
          const lg = this.kneel > 0.3 ? this.plantedSpec().lg : (this.leftGripS ?? this.wdef.leftGrip);
          const g = _b.copy(wp).addScaledVector(wd, lg);
          this.rig.gripArmClear('L', g, wd, wu, dirWorld(PO[3], PO[4], PO[5], _c), roll[1] * D2R, TF);
        } else if (hasL || freeLeft) {
          const lp = toWorld(Lh[0], Lh[1], Lh[2], new THREE.Vector3());
          const ld = dirWorld(Lh[3], Lh[4], Lh[5], new THREE.Vector3()).normalize(); const lu = dirWorld(Lh[6], Lh[7], Lh[8], new THREE.Vector3());
          if (this.kneel > 0.3 && !this.wdef.twoHanded) { const ps = this.plantedSpec(); toWorld(...ps.lp, lp); }
          this.rig.gripArmClear('L', lp, ld, lu, dirWorld(PO[3], PO[4], PO[5], _c), (freeLeft ? 60 : roll[1]) * D2R, TF);
        }
        if (crossR || planted > 0.5 || !TF) break;
        const hR = armInTorso(this.rig, 'R', TF), dR = hR.depth, dirR = _c.copy(hR.dir);
        const hL = twoH ? armInTorso(this.rig, 'L', TF) : { depth: 0 };
        const deep = Math.min(Math.max(dR, hL.depth), 0.1 - pushed); if (deep < 0.025) break;
        wp.addScaledVector(hL.depth > dR ? hL.dir : dirR, deep * 1.15); pushed += deep;
        this.rig.fitWeapon(wp, wd, wu, twoH ? (this.leftGripS ?? this.wdef.leftGrip) : null);   // never out of reach of the hands
        this.deflectWeapon(wp, wd);
      }
    }
    // smooth arm transitions (IK <-> keyed arms)
    if (ikOff !== this.prevIkOff) this.armBlend = 0.16;
    this.prevIkOff = ikOff;
    if (this.armBlend > 0) {
      this.armBlend -= dt; const k = 1 - clamp(this.armBlend / 0.16, 0, 1);
      ARM_JOINTS.forEach((j, i) => { const q = this.rig.j[j].quaternion; q.slerpQuaternions(this.armQ[i], q.clone(), k); });
    }
    ARM_JOINTS.forEach((j, i) => this.armQ[i].copy(this.rig.j[j].quaternion));
    this.dress.updateFollowers();
    this.group.updateMatrixWorld(true);

    // weapon world transform
    if (ikOff && !this.downed) {
      // weapon rides in the right hand
      const h = this.rig.j.handR; h.updateWorldMatrix(true, false);
      const hq = h.getWorldQuaternion(new THREE.Quaternion());
      const hz = new THREE.Vector3(0, 0, 1).applyQuaternion(hq), hy = new THREE.Vector3(0, 1, 0).applyQuaternion(hq);
      weaponQuatFrom(hz, hy.clone().negate(), _wq);
      h.localToWorld(wp.set(0, -0.08, 0));
    }
    this.weapon.position.copy(wp); this.weapon.quaternion.copy(_wq);
    this.weapon.updateMatrixWorld(true);
    // hit segment
    this.prevTip.copy(this.tip); this.prevBase.copy(this.base);
    const seg = (a && a.hits && a.hits[0] && a.hits[0].seg) || [this.wdef.hitFrom, this.wdef.hitTo];
    this.base.copy(wp).addScaledVector(wd, seg[0]); this.tip.copy(wp).addScaledVector(wd, seg[1]);
    this.weaponDir = wd;

    // cape
    if (this.cape) this.cape.update(dt, this.rig, world ? world.wind : { x: 1, z: 0 }, this.pos.y);
  }

  // where the weapon goes while kneeling in prayer
  plantedSpec() {
    if (this._planted) return this._planted;
    const k = this.loadout.weapon;
    const w = this.wdef;
    let spec;
    if (k === 'longsword' || k === 'zweihander') {
      const len = w.hitTo; const d = [0, -0.95, 0.3]; const dn = Math.hypot(...d); const dd = d.map((x) => x / dn);
      const tip = [0.0, 0.0, 0.66]; const p = tip.map((x, i) => x - dd[i] * len);
      spec = { p, d: dd, u: [0, 0, -1], lg: k === 'zweihander' ? 0.16 : -0.06 };
      spec.rest = p.map((x, i) => x + dd[i] * (k === 'zweihander' ? 0.06 : -0.12));
    } else if (k === 'mace') {
      spec = { p: [-0.02, 0.5, 0.5], d: [0, -1, 0.02], u: [0, 0, 1], lg: 0, lp: [0.0, 0.62, 0.48] };
      spec.rest = [0.0, 0.66, 0.46];
    } else {
      const butt = k === 'pike' ? 1.32 : k === 'halberd' ? 0.62 : 0.5;
      const d = [0.04, 1, 0.02];
      const base = [0.3, 0.0, 0.32];
      const p = [base[0] + d[0] * butt, butt, base[2] + d[2] * butt];
      spec = { p, d, u: [0, 0, 1], lg: 1.0 - butt };
      spec.rest = null;
    }
    this._planted = spec; return spec;
  }

  // the sign of the cross: forehead, breast, left shoulder, right shoulder
  crossTarget() {
    const T = 6.0; const t = this.prayT % T;
    const head = this.rig.j.head, chest = this.rig.j.chest;
    const pts = [
      head.localToWorld(new THREE.Vector3(0, 0.13, 0.19)),
      chest.localToWorld(new THREE.Vector3(0, -0.02, 0.22)),
      chest.localToWorld(new THREE.Vector3(0.12, 0.11, 0.17)),
      chest.localToWorld(new THREE.Vector3(-0.12, 0.11, 0.17)),
    ];
    const ps = this.plantedSpec();
    const rq = _rq.setFromAxisAngle(_a.set(0, 1, 0), this.renderYaw ?? this.yaw);
    let rest;
    if (ps.rest) rest = new THREE.Vector3(...ps.rest).applyQuaternion(rq).add(this.pos);
    else rest = chest.localToWorld(new THREE.Vector3(0.02, -0.06, 0.24)); // hands together at the breast
    const seq = [[0.0, rest], [0.7, pts[0]], [0.95, pts[0]], [1.45, pts[1]], [1.6, pts[1]], [2.1, pts[2]], [2.25, pts[2]], [2.75, pts[3]], [2.9, pts[3]], [3.5, rest], [T, rest]];
    if (this.prayT < 0.75) return { wrist: rest, pole: new THREE.Vector3(-0.8, -0.6, -0.2).applyQuaternion(rq), q: null };
    let i = 0; while (i < seq.length - 2 && t > seq[i + 1][0]) i++;
    const [t0, p0] = seq[i], [t1, p1] = seq[i + 1];
    const s = smooth(clamp((t - t0) / (t1 - t0), 0, 1));
    const p = p0.clone().lerp(p1, s);
    if (i === 8 && !this._crossed) { this._crossed = true; this.events.push({ type: 'cross' }); }
    if (i < 3) this._crossed = false;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()));
    const touching = !(t < 0.3 || t > 3.3);
    const q = touching ? handQuatFrom(up, fwd.clone().negate(), new THREE.Quaternion()) : null;
    return { wrist: p, pole: new THREE.Vector3(-0.9, -0.5, 0).applyQuaternion(rq), q };
  }

  applyKneel(P, k) {
    const K = smooth(k);
    const target = {
      hips: [0, 0, 0], spine: [12, 0, 0], chest: [8, 0, 0], neck: [10, 0, 0], head: [24, 0, 0],
      thighR: [6, 0, -4], shinR: [86, 0, 0], footR: [55, 0, 0],
      thighL: [-84, 0, 6], shinL: [84, 0, 0], footL: [0, 0, 0],
    };
    for (const j in target) { const i = JI[j] * 3; for (let c = 0; c < 3; c++) P[i + c] = lerp(P[i + c], target[j][c] * D2R, K); }
    // breathing / prayer motion: slight bow on each "Amen"
    const bow = Math.sin(this.prayT * 1.05) * 0.5 + 0.5;
    P[JI.head * 3] += bow * 6 * D2R * K; P[JI.chest * 3] += bow * 2 * D2R * K;
    P[HIP_O] = lerp(P[HIP_O], 0, K); P[HIP_O + 1] = lerp(P[HIP_O + 1], -0.47, K); P[HIP_O + 2] = lerp(P[HIP_O + 2], -0.03, K);
  }

  applyDowned(P) {
    const t = this.downT;
    const target = {
      hips: [-84, 0, 0], spine: [-4, 0, 6], chest: [-2, 0, 0], neck: [10, 0, 0], head: [16 + Math.sin(t * 0.8) * 6, 20, 0],
      uArmR: [-14, 0, -46], fArmR: [-30, 0, 0], uArmL: [-30 + Math.sin(t * 0.7) * 20, 0, 50], fArmL: [-50, 0, 0],
      thighR: [-20, 0, -10], shinR: [30, 0, 0], thighL: [-40, 0, 10], shinL: [60, 0, 0],
    };
    const K = smooth(clamp(t / 0.6, 0, 1));
    for (const j in target) { const i = JI[j] * 3; for (let c = 0; c < 3; c++) P[i + c] = lerp(P[i + c], target[j][c] * D2R, K); }
    P[HIP_O + 1] = lerp(P[HIP_O + 1], -0.85, K); P[HIP_O + 2] = lerp(P[HIP_O + 2], -0.3, K);
  }

  // ------------------------------------------------ net
  netState() {
    const a = this.action;
    let aIdx = -1;
    if (a) aIdx = a === this.heavyClip ? 100 : this.lights.indexOf(a) >= 0 ? this.lights.indexOf(a) : (Object.values(this.common).indexOf(a) + 200);
    return [
      +this.pos.x.toFixed(3), +this.pos.y.toFixed(3), +this.pos.z.toFixed(3), +this.yaw.toFixed(3),
      +this.vel.x.toFixed(2), +this.vel.z.toFixed(2), aIdx, +this.actT.toFixed(3),
      Math.round(this.hp), Math.round(this.stamina),
      (this.blocking ? 1 : 0) | (this.praying ? 2 : 0) | (this.downed ? 4 : 0) | (this.sprintW > 0.5 ? 8 : 0) | (this.fury > 0 ? 16 : 0),
      +this.prayT.toFixed(2), Math.round(this.reviveProgress * 100),
    ];
  }
  clipByIdx(i) {
    if (i < 0) return null; if (i === 100) return this.heavyClip; if (i < 100) return this.lights[i];
    return Object.values(this.common)[i - 200] || null;
  }
  // Drive a puppet knight from snapshots (remote player / host AI seen by a client)
  puppet(dt, s, world) {
    this.time += dt;
    if (!s) return;
    const [x, y, z, yaw, vx, vz, aIdx, actT, hp, st, f, prayT, rev] = s;
    // smooth correction toward the reported position, extrapolated by velocity
    const k = 1 - Math.exp(-12 * dt);
    this.pos.x += (x - this.pos.x) * k + vx * dt * 0.5; this.pos.z += (z - this.pos.z) * k + vz * dt * 0.5;
    this.pos.y = world ? standY(world, this.pos.x, this.pos.z) : y;
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > 4) { this.pos.x = x; this.pos.z = z; }
    this.yaw = dampAngle(this.yaw, yaw, 16, dt);
    this.vel.set(vx, 0, vz); this.speed = Math.hypot(vx, vz);
    this.hp = hp; this.stamina = st;
    this.blocking = !!(f & 1); this.praying = !!(f & 2); const down = !!(f & 4);
    if (down && !this.downed) { this.downed = true; this.downT = 0; }
    if (!down && this.downed) { this.downed = false; }
    if (this.downed) this.downT += dt;
    this.sprintW = damp(this.sprintW, f & 8 ? 1 : 0, 6, dt);
    this.fury = f & 16 ? 1 : 0;
    if (this.praying) this.prayT = prayT;
    this.kneel = clamp(this.kneel + (this.praying ? dt / 0.75 : -dt / 0.5), 0, 1);
    this.reviveProgress = rev / 100;
    const clip = this.clipByIdx(aIdx);
    if (clip) {
      if (this.action !== clip || actT + 0.15 < this.actT) { this.startAction(clip, 'net'); this.events.length = 0; }
      this.actT = Math.max(this.actT + dt * this.actionSpeed(), actT);
      if (this.actT > clip.dur) this.action = null;
      if (clip.sfx) while (this.sfxIdx < clip.sfx.length && this.actT >= clip.sfx[this.sfxIdx].t) { this.events.push({ type: 'sfx', k: clip.sfx[this.sfxIdx].k }); this.sfxIdx++; }
    } else if (this.action) this.action = null;
  }
}
