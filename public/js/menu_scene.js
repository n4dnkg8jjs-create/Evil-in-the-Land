// The title screen: a stage of its own, built for the camera out of the game's own pieces: the altar, its cross and
// its standing stones as they stand in the land when cleansed; the knights and the demons themselves. Night; a cold
// moon behind the cross; a shaft of light on it. Round the cross, close, five knights hold the last of the ground: one
// kneels at its foot and prays; one has his longsword up over his head for the blow; one has his halberd through a
// demon's neck; one has run three of them through on his pike; one smashes his mace down on a demon's skull behind his
// buckler. From all round, and from right under the camera, the horde comes on, running, arms out, in slow motion.
// Where steel meets a demon, the demon is put where the steel is (so every blow lands), and the blood hangs in the air.
import * as THREE from 'three';
import { Knight, compileClip } from './knight.js';
import { Demon } from './demons.js';
import { FX } from './fx.js';
import { World } from './world.js';
import { stoneTextures } from './textures.js';

const SLOW = 0.2;                  // the struck demons and the blood move at this speed
const HORDE = 0.16;                // and the horde comes on at this speed (slow motion, running)
const ST_CHASE = 1, ST_STAGGER = 5;
const TAU = Math.PI * 2;

export const MENU_ATMOS = { skyTop: 0x04050a, skyMid: 0x141420, skyBottom: 0x0a0709, sunColor: 0xc8d4ff, cloud: 0x0c0c12, cloudLit: 0x3a3e58, glow: 0x1a1a2a, cover: 0.7,
  sunDir: [0, 0.2, -1], sunSize: 0.012, sunLight: 0x9ab0e0, sunIntensity: 2.2, hemiSky: 0x343a52, hemiGround: 0x100a08, hemiIntensity: 0.3, fog: 0x0d0c14, fogDensity: 0.028, exposure: 1.3,
  fillColor: 0xffa060, fillIntensity: 0.25 };

// legs (as in the movesets)
const LUNGE_L = { thighL: [-50, 0, 6], shinL: [56, 0, 0], footL: [-6, 0, 0], thighR: [30, 0, -6], shinR: [26, 0, 0], footR: [24, 0, 0] };
const LUNGE_R = { thighR: [-50, 0, -6], shinR: [56, 0, 0], footR: [-6, 0, 0], thighL: [30, 0, 6], shinL: [26, 0, 0], footL: [24, 0, 0] };
const SET_L = { thighL: [-30, 0, 8], shinL: [26, 0, 0], footL: [4, 0, 0], thighR: [14, 0, -8], shinR: [30, 0, 0], footR: [-16, 0, 0] };
// the held moments: body (degrees), hips, the weapon in the right hand (p: grip, d: along the blade, u: the edge),
// the left hand (buckler) if any, elbow poles
export const POSES = {
  // vom Tag: the longsword straight up over his head, the blade back over his shoulder, left foot forward, his weight
  // gathering on the back leg, chest open, chin down at the thing in front of him
  overhead: { body: { spine: [-8, 14, 0], chest: [-12, 12, 0], neck: [6, -12, 0], head: [10, -14, 4], ...SET_L }, hip: [0, -0.07, -0.05],
    w: { p: [-0.02, 1.96, 0.1], d: [0.12, 0.72, -0.68], u: [0, 0.69, 0.72] }, pr: [-0.9, 0.2, -0.4], pl: [0.9, 0.2, -0.4] },
  // the halberd at the end of a great flat sweep, through the neck: turned right round into it, stepping in
  halberd: { body: { spine: [6, 22, 0], chest: [8, 34, 0], neck: [-4, -10, 0], head: [-6, -18, 0], ...LUNGE_L }, hip: [0, -0.13, 0.08],
    w: { p: [0.1, 1.36, 0.18], d: [0.84, -0.08, 0.54], u: [0.54, 0, -0.84] }, pr: [-0.5, -0.8, -0.3], pl: [0.6, -0.7, 0.1] },
  // the pike thrust home, low, lunging, the whole weight behind it
  pike: { body: { spine: [12, -4, 0], chest: [12, -8, 0], neck: [-8, 4, 0], head: [-10, 6, 0], ...LUNGE_L }, hip: [0, -0.17, 0.13],
    w: { p: [-0.05, 1.08, 0.42], d: [0.05, -0.42, 0.9], u: [0, 0.9, 0.42] }, pr: [-0.8, -0.6, -0.1], pl: [0.5, -0.9, 0.1] },
  // the mace come down on a skull, the buckler up and out in front of him, stepping through
  mace: { body: { spine: [18, -6, 0], chest: [12, 8, 0], neck: [-8, 0, 0], head: [-12, -4, 0], ...LUNGE_R }, hip: [0, -0.15, 0.11],
    w: { p: [0.02, 1.3, 0.55], d: [0.02, -0.4, 0.92], u: [0, -0.92, -0.4] }, l: { p: [0.2, 1.22, 0.4], d: [0, 1, 0.1], u: [0.3, 0, 1] }, pr: [-0.6, -0.7, -0.3], pl: [0.6, -0.7, -0.2] },
};

// the five, round the cross from the camera's left to its right: bearing from the front (deg), loadout, pose
const RING = [
  { a: -66, lo: { style: 'milanese', finish: 'bright', weapon: 'halberd', heraldry: 'azure' }, pose: 'halberd' },
  { a: -32, lo: { style: 'gothic', finish: 'bright', weapon: 'longsword', heraldry: 'gules' }, pose: 'overhead' },
  { a: 0, lo: { style: 'gothic', finish: 'blackened', weapon: 'longsword', heraldry: 'argent' }, pose: 'pray' },
  { a: 32, lo: { style: 'maximilian', finish: 'blued', weapon: 'mace', heraldry: 'sable' }, pose: 'mace' },
  { a: 66, lo: { style: 'milanese', finish: 'russet', weapon: 'pike', heraldry: 'vert' }, pose: 'pike' },
];

export class MenuStage {
  constructor(engine, quality) {
    this.e = engine; this.q = quality; this.scene = engine.scene; this.t = 0;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.fx = new FX(this.scene, quality);
    this.ground = (x, z) => this.heightAt(x, z);
    this.altar = { x: 0, y: 0, z: 0 }; this.front = 0;
    this.W = { heightAt: (x, z) => this.heightAt(x, z), collide() {}, wind: new THREE.Vector3(0.6, 0, 0.2), canPrayAt: () => true, standAt: (x, z) => this.heightAt(x, z), groundAt: (x, z) => this.heightAt(x, z), colGrid: null };
    engine.setAtmosphere(MENU_ATMOS);
    this.buildSet();
    this.buildLight();
    this.buildKnights();
    this.buildDemons();
  }
  // the altar's three steps (as the game builds them: 3.2, 2.6 and 2.0 m across the flats, 0.26 m each)
  heightAt(x, z) { const r = Math.hypot(x, z); return r < 2.0 ? 0.78 : r < 2.6 ? 0.52 : r < 3.2 ? 0.26 : 0; }

  // ---------------------------------------------------------------- the set
  buildSet() {
    const G = this.group;
    // the altar exactly as the game builds it, cleansed: candles lit, no blight on it
    const fake = { ch: { seed: 1101 }, altarT: [{ x: 0, y: 0, z: 0, t: 0 }], group: G, addCollider() {} };
    try {
      World.prototype.buildAltars.call(fake);
      const A = fake.altars[0]; this.A = A;
      if (A.corr) A.corr.visible = false; if (A.evilLight) { A.evilLight.visible = false; A.evilLight.intensity = 0; }
      if (A.candles) A.candles.visible = true;
      if (A.crossMesh) A.crossMesh.rotation.y = 0;
      A.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // the standing stones on the camera's side would stand right in front of it: take those away
      for (const o of [...A.group.children]) { const r = Math.hypot(o.position.x, o.position.z); if (r > 7 && r < 9.5 && o.position.z > 2.5) o.visible = false; }
    } catch (e) { console.warn('menu altar', e); }
    // the hill: earth and old stones
    const rough = stoneTextures(512, false), st = stoneTextures(512, true);
    const rep = (t, n) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(n, n); c.needsUpdate = true; return c; };
    const earth = new THREE.Mesh(new THREE.CircleGeometry(80, 72), new THREE.MeshStandardMaterial({ map: rep(rough.map, 34), normalMap: rep(rough.normalMap, 34), color: 0x3a342e, roughness: 0.9 }));
    earth.rotation.x = -Math.PI / 2; earth.receiveShadow = true; G.add(earth);
    const flags = new THREE.Mesh(new THREE.RingGeometry(3.15, 9.0, 72, 6), new THREE.MeshStandardMaterial({ map: rep(st.map, 7), normalMap: rep(st.normalMap, 7), color: 0x7c766e, roughness: 0.55 }));
    flags.rotation.x = -Math.PI / 2; flags.position.y = 0.005; flags.receiveShadow = true; G.add(flags);
  }
  // ---------------------------------------------------------------- the light
  buildLight() {
    const G = this.group;
    // a shaft of light falling on the cross out of the dark, and the beam of it in the air
    const spot = new THREE.SpotLight(0xffe2b0, 160, 34, 0.3, 0.8, 1.3); spot.position.set(0.8, 18, 3.0); spot.target.position.set(0, 2.2, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0003; spot.shadow.camera.near = 8; spot.shadow.camera.far = 30; G.add(spot, spot.target);
    const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 3.0); float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y)); float dust = 0.8 + 0.2 * sin(uTime * 0.6 + vUv.y * 9.0 + vUv.x * 30.0); gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * edge * along * 0.22 * dust, 1.0); }' });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.4, 18, 40, 1, true), beamMat);
    const top = new THREE.Vector3(0.8, 18, 3.0), bot = new THREE.Vector3(0, 2.0, 0);
    beam.position.copy(top).add(bot).multiplyScalar(0.5); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize()); beam.renderOrder = 4; G.add(beam); this.beam = beam;
    // the cross gives back a little of it
    const hl = new THREE.PointLight(0xffd8a0, 10, 7, 2); hl.position.set(0, 3.6, 1.0); G.add(hl);
    // a cold rim from the moon, behind and above, and a warm low one from the right (fires off in the dark)
    const rim = new THREE.DirectionalLight(0x9ab4f0, 2.0); rim.position.set(-4, 10, -16); rim.target.position.set(0, 1, 0); G.add(rim, rim.target);
    const warm = new THREE.PointLight(0xff6a28, 30, 22, 1.6); warm.position.set(9, 2.2, 3); G.add(warm); this.warm = warm;
    const warm2 = new THREE.PointLight(0xff8a40, 18, 18, 1.6); warm2.position.set(-8, 1.6, 5); G.add(warm2); this.warm2 = warm2;
    const key = new THREE.SpotLight(0xffb070, 40, 22, 0.55, 0.9, 1.2); key.position.set(-3, 3.2, 11); key.target.position.set(0, 1.4, 2); G.add(key, key.target);
  }
  // ---------------------------------------------------------------- the knights
  buildKnights() {
    this.knights = RING.map((s, i) => {
      const k = new Knight(this.scene, this.q, { ...s.lo, relic: 'water', cape: true, plume: s.pose !== 'pray' }, { id: 200 + i, name: '' });
      const ang = this.front + s.a * Math.PI / 180, R = s.pose === 'pray' ? 3.55 : 3.85;
      k.pos.set(Math.sin(ang) * R, 0, Math.cos(ang) * R);
      k.yaw = s.pose === 'pray' ? ang : this.front + (ang - this.front) * 0.55;   // facing out, but toward the front where they come from
      const P = { k, s, ang, ph: i * 1.7 };
      if (s.pose === 'pray') { k.praying = true; k.kneel = 1; k.prayT = 3; }
      else { P.spec = POSES[s.pose]; P.clip = this.compile(k, P.spec); k.startAction(P.clip, 'held'); k.actT = 0.6; }
      return P;
    });
    for (let i = 0; i < 60; i++) this.poseKnights(1 / 30);
  }
  // two keys a breath apart: the pose, and the pose with the chest risen, the weight eased onto the other leg and the
  // weapon drawn back a hair; the held moment rocks between them, so they breathe and strain (arms and weapon too)
  compile(k, spec) {
    const add = (b, d) => { const o = {}; for (const j in b) o[j] = b[j].slice(); for (const j in d) o[j] = (o[j] || [0, 0, 0]).map((v, i) => v + d[j][i]); return o; };
    const A = { t: 0.5, body: spec.body, hip: spec.hip, w: spec.w, l: spec.l, pr: spec.pr, pl: spec.pl };
    const B = { t: 0.7, body: add(spec.body, { chest: [-3, 2, 0], spine: [-1, -2, 1.5], head: [2, 3, 0] }), hip: [spec.hip[0] + 0.008, spec.hip[1] - 0.012, spec.hip[2]],
      w: { ...spec.w, p: [spec.w.p[0], spec.w.p[1] + 0.012, spec.w.p[2] - 0.02] }, l: spec.l && { ...spec.l, p: [spec.l.p[0], spec.l.p[1] + 0.01, spec.l.p[2] - 0.01] }, pr: spec.pr, pl: spec.pl };
    return compileClip({ name: 'Held', dur: 1, fullBody: true, keys: [A, B] }, k.st);
  }
  poseKnights(dt) {
    for (const P of this.knights) {
      const { k } = P;
      if (P.s.pose === 'pray') k.simulate(dt, { mx: 0, mz: 0, aimYaw: k.yaw, sprint: false, block: false, pray: true, attack: false, heavy: false, dodge: false, relic: false }, this.W);
      else {
        if (k.action !== P.clip) k.startAction(P.clip, 'held');
        // breathing hard, held at the blow: a slow heave, and under it a faint tremor of effort
        k.actT = 0.6 + Math.sin(this.t * 1.25 + P.ph) * 0.085 + Math.sin(this.t * 7.3 + P.ph) * 0.004;
      }
      k.events.length = 0; k.animate(dt, this.W); k.events.length = 0;
    }
  }
  // where along the weapon (in the weapon's own frame, y up the blade from the grip) the far end is
  weaponTop(k) {
    k.weapon.updateMatrixWorld(true); const inv = k.weapon.matrixWorld.clone().invert(), box = new THREE.Box3(), b = new THREE.Box3();
    k.weapon.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv); box.union(b); } });
    return box.max.y;
  }
  at(k, y, x = 0) { k.weapon.updateMatrixWorld(true); return k.weapon.localToWorld(new THREE.Vector3(x, y, 0)); }
  // ---------------------------------------------------------------- the demons
  buildDemons() {
    this.demons = []; let id = 9500;
    const mk = (type, x, z, yaw, state) => { const d = new Demon(type, id++, this.scene); d.pos.set(x, 0, z); d.yaw = yaw; d.setState(state); d.stateT = 0.35; d.staggerDur = 99; this.demons.push(d); return d; };
    const by = (p) => this.knights.find((P) => P.s.pose === p).k;
    const cam = this.e.camera.position;
    // put a demon so that one of its bones is at a point (scaled a little, so the height is right too)
    const fit = (d, bone, target) => {
      for (let it = 0; it < 3; it++) {
        d.animate(1 / 60, this.t, this.W, this.fx, cam); d.mesh.updateMatrixWorld(true);
        const b = (d.B[bone] || d.B.chest).getWorldPosition(new THREE.Vector3());
        if (it === 0) { const s = THREE.MathUtils.clamp(target.y / Math.max(0.3, b.y), 0.8, 1.25); d.scale *= s; d.mesh.scale.setScalar(d.scale); continue; }
        d.pos.x += target.x - b.x; d.pos.z += target.z - b.z;
      }
    };
    // the halberdier's: the blade through its neck, the head going
    const H = by('halberd'), hTop = this.weaponTop(H), blade = this.at(H, hTop - 0.42, 0.12);
    this.cut = mk('shade', blade.x, blade.z, H.yaw + Math.PI + 0.5, ST_STAGGER); fit(this.cut, 'neck', blade);
    // the pikeman's: three of them, one behind another, on the shaft
    const PK = by('pike'), pTop = this.weaponTop(PK);
    this.skewered = ['husk', 'wretch', 'shade'].map((ty, i) => { const p = this.at(PK, pTop - 0.45 - i * 0.82); const d = mk(ty, p.x, p.z, PK.yaw + Math.PI + (i - 1) * 0.35, ST_STAGGER); fit(d, 'chest', p); return d; });
    // the mace's: its head come down on the skull
    const M = by('mace'), mTop = this.weaponTop(M), mh = this.at(M, mTop - 0.06); mh.y -= 0.12;
    this.bashed = mk('wretch', mh.x, mh.z, M.yaw + Math.PI - 0.15, ST_STAGGER); fit(this.bashed, 'head', mh);
    // the longsword's: one coming at him, just short of the blow
    const O = by('overhead'), of = new THREE.Vector3(Math.sin(O.yaw), 0, Math.cos(O.yaw)), op = O.pos.clone().addScaledVector(of, 1.6);
    this.next = mk('shade', op.x, op.z, O.yaw + Math.PI, ST_CHASE); this.next.vel.copy(of).multiplyScalar(-0.01); this.next.lunge = true;
    // and the horde: from all round, and charging in from right under the camera
    this.horde = [];
    const add = (ty, ang, R0) => { const d = mk(ty, Math.sin(ang) * R0, Math.cos(ang) * R0, ang + Math.PI, ST_CHASE); d.home = { ang, R0 }; d.vel.set(-Math.sin(ang), 0, -Math.cos(ang)).multiplyScalar(d.def.speed * (R0 > 7.1 && R0 < 8.5 ? 0.22 : 1)); d.fade = 0; this.horde.push(d); };
    // in front, right under the camera (their backs to it, heads and reaching arms at the bottom of the picture)
    [['crawler', -0.1, 7.6], ['shade', 0.13, 7.9], ['crawler', 0.03, 7.2], ['wretch', -0.2, 8.1], ['shade', 0.24, 7.5]].forEach(([t, a, R]) => add(t, this.front + a, R));
    // between the knights and out round the ends of the line
    [['shade', -0.62, 6.2], ['husk', 0.64, 6.4], ['wretch', -1.0, 7.2], ['shade', 1.02, 7.0], ['shade', -1.5, 9], ['husk', 1.55, 9.5], ['brute', -2.4, 12], ['wretch', 2.3, 11], ['shade', -1.15, 11], ['shade', 1.2, 12]].forEach(([t, a, R]) => add(t, this.front + a, R));
    for (const d of this.horde) d.animate(1 / 60, 0, this.W, this.fx, cam);
    this.cut.sever(this.cut.B.neck.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0)), new THREE.Vector3(H.pos.x, 0, H.pos.z).normalize().add(new THREE.Vector3(0, 0.4, 0)), this.fx, this.ground);   // the head goes out away from the others
    this.cutT = 0; this.bleed = 0;
  }
  update(dt, cam) {
    this.t += dt; const sdt = dt * SLOW;
    this.poseKnights(dt);
    // the horde comes on in slow motion; as one reaches the knights it burns away to smoke and another forms behind
    for (const d of this.horde) {
      d.pos.addScaledVector(d.vel, dt * HORDE);
      const r = Math.hypot(d.pos.x, d.pos.z);
      d.fade = r < (d.home.R0 > 7.1 && d.home.R0 < 8.5 ? 5.7 : 5.1) ? Math.min(1, d.fade + dt * 0.7) : Math.max(0, d.fade - dt * 0.5);
      if (d.fade >= 1) { const h = d.home; d.pos.set(Math.sin(h.ang) * (h.R0 + 1.5), 0, Math.cos(h.ang) * (h.R0 + 1.5)); d.fade = 0.999; }
    }
    for (const d of this.demons) {
      if (d.state === ST_STAGGER) d.stateT = 0.3 + Math.sin(this.t * 0.4 + d.id) * 0.04; else d.stateT += dt * HORDE;
      d.animate(d.state === ST_CHASE ? dt * HORDE : sdt, this.t, this.W, this.fx, cam);
      if (d.fade !== undefined && d.mat.userData.u.uDissolve) d.mat.userData.u.uDissolve.value = d.fade * 0.98;
    }
    this.cutT += dt; if (this.cutT > 24) { for (const d of this.demons) this.scene.remove(d.mesh); this.buildDemons(); }
    // blood in the air where the steel is in them
    this.bleed -= dt;
    if (this.bleed <= 0) {
      this.bleed = 0.3;
      const np = (this.cut.B.neck || this.cut.B.chest).getWorldPosition(new THREE.Vector3());
      this.fx.blood(np, new THREE.Vector3(0.5, 1, 0.3), new THREE.Vector3(0, 1.2, 0), 1.4, this.ground);
      for (const d of this.skewered) this.fx.blood(d.chest, new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, -0.5, 0), 0.6, this.ground);
      const hb = this.bashed.B.head?.getWorldPosition(new THREE.Vector3()); if (hb) { this.fx.blood(hb, new THREE.Vector3(0.4, 0.8, 0), new THREE.Vector3(0, 0.6, 0), 1.0, this.ground); if (Math.random() < 0.25) this.fx.sparks(hb, 4); }
    }
    this.fx.ambient(dt, cam, 'embers', 0.3);
    this.fx.update(sdt);
    if (this.A?.candles) this.A.candles.traverse((o) => { if (o.isPointLight) o.intensity = (o.userData.base ??= o.intensity) * (0.85 + 0.15 * Math.sin(this.t * 9 + o.id)); });
    this.warm.intensity = 30 * (0.85 + 0.15 * Math.sin(this.t * 7.3) * Math.sin(this.t * 3.1));
    this.beam.material.uniforms.uTime.value = this.t;
  }
  // the camera turns slowly round in front of them, low, looking up at the cross over the kneeling knight
  camera(c, dt) {
    const t = this.t, ang = this.front + Math.sin(t * 0.045) * 0.3, R = 8.8 + Math.sin(t * 0.06) * 0.4;
    const want = new THREE.Vector3(Math.sin(ang) * R, 2.1 + Math.sin(t * 0.08) * 0.12, Math.cos(ang) * R);
    c.position.lerp(want, this.snapped ? 1 - Math.exp(-1.5 * dt) : 1); this.snapped = true;
    c.lookAt(Math.sin(ang) * 1.2, 1.75, Math.cos(ang) * 1.2);
    if (Math.abs(c.fov - 47) > 0.1) { c.fov = 47; c.updateProjectionMatrix(); }
  }
  setVisible(v) {
    for (const { k } of this.knights) { k.group.visible = v; if (k.weapon) k.weapon.visible = v; if (k.cape) k.cape.mesh.visible = v; }
    for (const d of this.demons) d.mesh.visible = v;
  }
  dispose() {
    for (const { k } of this.knights) k.dispose();
    for (const d of this.demons) this.scene.remove(d.mesh);
    const F = this.fx; for (const P of [F.smoke, F.glow]) { this.scene.remove(P.points); P.geo.dispose(); }
    for (const l of F.lights) this.scene.remove(l);
    for (const m of [...F.rings, ...(F.pools || []).map((p) => p.m), ...(F.gibs || []).map((g) => g.mesh || g.m)]) if (m) this.scene.remove(m);
    this.scene.remove(this.group);
  }
}
