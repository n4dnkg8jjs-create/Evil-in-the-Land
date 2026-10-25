// The title screen: a stage of its own, built for the camera. Night; a ring of old flagstones on a bare hill; an
// altar of three steps with a stone cross on it, and a shaft of light falling on the cross out of the dark. Round the
// cross, close, five knights hold the last of the ground: one kneels at its foot and prays; one has his longsword up
// over his head for the blow; one has his halberd through a demon's neck, the head going; one has run three of them
// through on his pike; one smashes his mace into a demon's skull behind his buckler. Out in the fog the rest come on,
// arms out. It all moves slowly, as in a held breath: blood in the air, capes and smoke drifting, the braziers and
// the candles breathing, the camera turning round them.
import * as THREE from 'three';
import { Knight, compileClip } from './knight.js';
import { Demon } from './demons.js';
import { FX } from './fx.js';
import { makeFlame } from './flame.js';
import { stoneTextures, cloudTexture } from './textures.js';

const SLOW = 0.22;                 // the struck demons and the blood move at this speed
const HORDE = 0.14;                // and the horde comes on at this speed (slow motion, running)
const ST_CHASE = 1, ST_STAGGER = 5;
const TAU = Math.PI * 2;

// night on the hill: a cold moon low behind the cross, everything else from fire and from the light on the cross
export const MENU_ATMOS = { skyTop: 0x04050a, skyMid: 0x141420, skyBottom: 0x0a0709, sunColor: 0xc8d4ff, cloud: 0x0c0c12, cloudLit: 0x3a3e58, glow: 0x1a1a2a, cover: 0.7,
  sunDir: [0, 0.22, -1], sunSize: 0.012, sunLight: 0x8ea4d8, sunIntensity: 1.7, hemiSky: 0x2a2e40, hemiGround: 0x0c0806, hemiIntensity: 0.22, fog: 0x0b0a10, fogDensity: 0.034, exposure: 1.25,
  fillColor: 0xffa060, fillIntensity: 0.15 };

// the five, from left to right as the camera first sees them: [bearing from the front (deg), loadout, pose]
const RING = [
  { a: -72, lo: { style: 'milanese', finish: 'bright', weapon: 'halberd', heraldry: 'azure' }, pose: 'halberd' },
  { a: -36, lo: { style: 'gothic', finish: 'bright', weapon: 'longsword', heraldry: 'gules' }, pose: 'overhead' },
  { a: 0, lo: { style: 'gothic', finish: 'blackened', weapon: 'longsword', heraldry: 'argent' }, pose: 'pray' },
  { a: 36, lo: { style: 'maximilian', finish: 'blued', weapon: 'mace', heraldry: 'sable' }, pose: 'mace' },
  { a: 72, lo: { style: 'milanese', finish: 'russet', weapon: 'pike', heraldry: 'vert' }, pose: 'pike' },
];

export class MenuStage {
  constructor(engine, quality) {
    this.e = engine; this.q = quality; this.scene = engine.scene; this.t = 0;
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.fx = new FX(this.scene, quality);
    this.ground = (x, z) => this.heightAt(x, z);
    this.altar = { x: 0, y: 0, z: 0 }; this.front = 0; this.fv = new THREE.Vector3(0, 0, 1);
    this.W = { heightAt: (x, z) => this.heightAt(x, z), collide() {}, wind: new THREE.Vector3(0.5, 0, 0.15), canPrayAt: () => true, standAt: (x, z) => this.heightAt(x, z), groundAt: (x, z) => this.heightAt(x, z), colGrid: null };
    engine.setAtmosphere(MENU_ATMOS);
    this.buildSet();
    this.buildLight();
    this.buildKnights();
    this.buildDemons();
  }
  // the altar's steps are the only ground that is not flat
  heightAt(x, z) { const r = Math.hypot(x, z); return r < 1.25 ? 0.66 : r < 1.65 ? 0.44 : r < 2.05 ? 0.22 : 0; }

  // ---------------------------------------------------------------- the set
  buildSet() {
    const G = this.group, st = stoneTextures(512, true), rough = stoneTextures(512, false);
    const rep = (t, n) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(n, n); c.needsUpdate = true; return c; };
    // the hill: earth and stone, dark and wet; the old paving round the altar
    const earth = new THREE.Mesh(new THREE.CircleGeometry(70, 64), new THREE.MeshStandardMaterial({ map: rep(rough.map, 26), normalMap: rep(rough.normalMap, 26), color: 0x3a3430, roughness: 0.92 }));
    earth.rotation.x = -Math.PI / 2; earth.receiveShadow = true; G.add(earth);
    const flags = new THREE.Mesh(new THREE.RingGeometry(2.05, 6.5, 64, 4), new THREE.MeshStandardMaterial({ map: rep(st.map, 5), normalMap: rep(st.normalMap, 5), color: 0x8a8278, roughness: 0.6 }));
    flags.rotation.x = -Math.PI / 2; flags.position.y = 0.006; flags.receiveShadow = true; G.add(flags);
    // the altar: three octagonal steps and the cross
    const stone = new THREE.MeshStandardMaterial({ map: rep(st.map, 1.5), normalMap: rep(st.normalMap, 1.5), color: 0xb0a898, roughness: 0.7 });
    [[2.05, 0.22], [1.65, 0.44], [1.25, 0.66]].forEach(([r, y]) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.03, 0.22, 8), stone); s.position.y = y - 0.11; s.rotation.y = Math.PI / 8; s.castShadow = s.receiveShadow = true; G.add(s); });
    const crossMat = new THREE.MeshStandardMaterial({ map: rep(rough.map, 1), normalMap: rep(rough.normalMap, 1), color: 0xcfc6b4, roughness: 0.62 });
    const cross = new THREE.Group(); cross.position.y = 0.66;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.9, 0.26, 2, 8, 2), crossMat); shaft.position.y = 1.45;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.26, 6, 2, 2), crossMat); arm.position.y = 2.15;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.5), crossMat); base.position.y = 0.15;
    for (const m of [shaft, arm, base]) { m.castShadow = m.receiveShadow = true; cross.add(m); }
    G.add(cross); this.cross = cross;
    // candles on the steps, burning
    const wax = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 });
    this.flames = [];
    for (let k = 0; k < 10; k++) {
      const ang = this.front + Math.PI * (0.25 + (k / 9) * 1.5), r = k % 2 ? 1.45 : 1.85, y = r < 1.65 ? 0.44 : 0.22, h = 0.18 + (k * 37 % 5) * 0.04;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, h, 8), wax); c.position.set(Math.sin(ang) * r, y + h / 2, Math.cos(ang) * r); G.add(c);
      const f = makeFlame({ height: 0.09, width: 0.04, tongues: 2, sparks: 0 }); f.group.position.set(c.position.x, y + h, c.position.z); G.add(f.group); this.flames.push({ fl: f, k: 0.8 });
    }
    // braziers either side, a little in front
    const iron = new THREE.MeshStandardMaterial({ color: 0x16120e, roughness: 0.55, metalness: 0.75 });
    this.lights = [];
    for (const sd of [-1, 1]) {
      const ang = this.front + sd * 0.95, R = 4.2, x = Math.sin(ang) * R, z = Math.cos(ang) * R;
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.22, 0.28, 16, 1, true), iron); bowl.position.set(x, 1.1, z); bowl.castShadow = true; G.add(bowl);
      for (let l = 0; l < 3; l++) { const la = l / 3 * TAU; const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.12, 6), iron); leg.position.set(x + Math.cos(la) * 0.17, 0.52, z + Math.sin(la) * 0.17); leg.rotation.set(Math.sin(la) * 0.25, 0, -Math.cos(la) * 0.25); G.add(leg); }
      const fl = makeFlame({ height: 1.0, width: 0.55, tongues: 4, sparks: 50 }); fl.group.position.set(x, 1.18, z); G.add(fl.group); this.flames.push({ fl, k: 0.75 });
      const L = new THREE.PointLight(0xff7a30, 18, 14, 1.7); L.position.set(x, 1.8, z); G.add(L); this.lights.push({ L, base: 18, ph: sd * 3 });
    }
    // the ruins of a chapel behind, and broken stones about the hill
    const ruin = new THREE.MeshStandardMaterial({ map: rep(st.map, 2), normalMap: rep(st.normalMap, 2), color: 0x6a6460, roughness: 0.85 });
    // broken columns of a chapel nave, two rows running back into the dark, their tops sheared off
    const col = (x, z, h, r, seed) => {
      const g = new THREE.CylinderGeometry(r * 0.92, r, h, 14, 6); const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const y = P.getY(i), a = Math.atan2(P.getZ(i), P.getX(i)); if (y > h / 2 - 0.01) P.setY(i, y - (0.25 + 0.6 * Math.abs(Math.sin(a * 2 + seed))) * r * 1.4); const k = 1 + Math.sin(a * 16) * 0.03; P.setX(i, P.getX(i) * k); P.setZ(i, P.getZ(i) * k); }
      g.computeVertexNormals(); const m = new THREE.Mesh(g, ruin); m.position.set(x, h / 2 - 0.05, z); m.castShadow = m.receiveShadow = true; G.add(m);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.25, 8), ruin); cap.position.set(x, 0.12, z); G.add(cap);
    };
    [[-4.2, -7, 6.2], [-4.4, -12, 3.4], [-4.6, -17, 7.4], [4.2, -7.5, 4.6], [4.4, -12.5, 7.8], [4.6, -17.5, 2.6]].forEach(([x, z, h], i) => col(x, z, h, 0.42, i * 1.7));
    // fallen drums of columns, broken stones
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * TAU, r = 6 + Math.random() * 12, s = 0.15 + Math.random() * 0.5;
      if (Math.cos(a - this.front) > 0.55 && r < 13) continue;   // keep the camera's side clear
      const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), ruin); rk.position.set(Math.sin(a) * r, s * 0.3, Math.cos(a) * r); rk.rotation.set(Math.random() * 3, Math.random() * 3, 0); rk.castShadow = rk.receiveShadow = true; G.add(rk);
    }
    for (const [x, z, a] of [[-6.5, -4, 0.4], [6.8, -5, -0.9], [-2.5, -14, 1.3]]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 1.1, 14), ruin); d.position.set(x, 0.38, z); d.rotation.set(Math.PI / 2, a, 0); d.castShadow = true; G.add(d); }
    // ground mist, drifting in sheets
    const ct = cloudTexture(256); this.mist = [];
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: ct, color: 0x8890a8, transparent: true, opacity: 0.16, depthWrite: false, fog: true }));
      const a = Math.random() * TAU, r = 3 + Math.random() * 10; m.position.set(Math.sin(a) * r, 0.25 + Math.random() * 0.5, Math.cos(a) * r); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * TAU; m.renderOrder = 1; G.add(m);
      this.mist.push({ m, w: (Math.random() - 0.5) * 0.04 });
    }
  }
  // ---------------------------------------------------------------- the light
  buildLight() {
    const G = this.group;
    // a shaft of light falling on the cross out of the dark
    const spot = new THREE.SpotLight(0xffe0a8, 90, 30, 0.32, 0.75, 1.4); spot.position.set(0.6, 16, 2.2); spot.target.position.set(0, 1.4, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.camera.near = 6; spot.shadow.camera.far = 26; G.add(spot, spot.target); this.spot = spot;
    // and the beam itself in the air: a cone of faint light, brightest along its middle
    const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 2.2); float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y)); float flick = 0.85 + 0.15 * sin(uTime * 0.7 + vUv.y * 6.0); gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * edge * along * 0.16 * flick, 1.0); }' });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.6, 16, 32, 1, true), beamMat); beam.position.set(0.3, 8.6, 1.1); beam.lookAt(0.6, 16, 2.2); beam.rotateX(Math.PI / 2); beam.renderOrder = 4; G.add(beam); this.beam = beam;
    // the cross glows a little where the light is on it
    const hl = new THREE.PointLight(0xffd8a0, 6, 6, 2); hl.position.set(0, 2.9, 0.6); G.add(hl);
    // a cold rim from the moon behind, to cut the knights out of the dark
    const rim = new THREE.DirectionalLight(0x8aa0e0, 1.4); rim.position.set(-6, 9, -14); rim.target.position.set(0, 1, 0); G.add(rim, rim.target);
  }
  // ---------------------------------------------------------------- the knights
  buildKnights() {
    this.knights = RING.map((s, i) => {
      const k = new Knight(this.scene, this.q, { ...s.lo, relic: 'water', cape: true, plume: s.pose !== 'pray' }, { id: 200 + i, name: '' });
      const ang = this.front + s.a * Math.PI / 180, R = s.pose === 'pray' ? 2.45 : 2.75;
      k.pos.set(Math.sin(ang) * R, 0, Math.cos(ang) * R);
      k.yaw = ang + (s.pose === 'pray' ? 0 : -Math.sign(s.a) * 0.12);
      const P = { k, s, ang, ph: Math.random() * 10 };
      if (s.pose === 'pray') { k.praying = true; k.kneel = 1; k.prayT = 3; }
      else {
        const C = {
          // the longsword straight up over his head in both hands: the blow about to fall
          overhead: () => ({ clip: compileClip({ name: 'Overhead', dur: 1, keys: [{ t: 0.5, body: { spine: [-12, 4, 0], chest: [-16, 2, 0], neck: [6, 0, 0], head: [10, -4, 0], thighR: [-26, 0, -6], shinR: [24, 0, 0], footR: [6, 0, 0], thighL: [16, 0, 6], shinL: [8, 0, 0] }, hip: [0, -0.07, -0.04], w: { p: [-0.02, 2.0, 0.08], d: [0, 0.94, 0.34], u: [0, -0.34, 0.94] } }] }, k.st), t: 0.5 }),
          halberd: () => ({ clip: k.lights[0], t: 0.47 }),
          pike: () => ({ clip: k.lights[0], t: 0.31 }),
          mace: () => ({ clip: k.lights[0], t: 0.25 }),
        }[s.pose]();
        P.clip = C.clip; P.t = C.t; k.startAction(C.clip, 'held'); k.actT = C.t;
      }
      return P;
    });
    for (let i = 0; i < 45; i++) this.poseKnights(1 / 30);
  }
  poseKnights(dt) {
    for (const P of this.knights) {
      const { k } = P;
      if (P.s.pose === 'pray') {
        k.simulate(dt, { mx: 0, mz: 0, aimYaw: k.yaw, sprint: false, block: false, pray: true, attack: false, heavy: false, dodge: false, relic: false }, this.W);
      } else {
        if (k.action !== P.clip) k.startAction(P.clip, 'held');
        // held at the moment of the blow, but alive: breathing, the weight settling, the blade trembling with the effort
        k.actT = P.t + Math.sin(this.t * 0.9 + P.ph) * 0.006 + Math.sin(this.t * 0.37 + P.ph * 2) * 0.004;
      }
      k.events.length = 0; k.animate(dt, this.W); k.events.length = 0;
    }
  }
  // ---------------------------------------------------------------- the demons
  buildDemons() {
    this.demons = []; let id = 9500;
    const mk = (type, x, z, yaw, state) => { const d = new Demon(type, id++, this.scene); d.pos.set(x, 0, z); d.yaw = yaw; d.setState(state); d.stateT = 0.4; d.staggerDur = 99; this.demons.push(d); return d; };
    const ahead = (K, f, s = 0) => { const fw = new THREE.Vector3(Math.sin(K.yaw), 0, Math.cos(K.yaw)), sd = new THREE.Vector3(fw.z, 0, -fw.x); return K.pos.clone().addScaledVector(fw, f).addScaledVector(sd, s); };
    const byPose = (p) => this.knights.find((P) => P.s.pose === p).k;
    // the halberdier's: the head coming off
    const H = byPose('halberd'), hp = ahead(H, 1.7, -0.3);
    this.cut = mk('shade', hp.x, hp.z, H.yaw + Math.PI + 0.35, ST_STAGGER);
    // the pikeman's: three on the pike
    const PK = byPose('pike'); this.skewered = ['husk', 'wretch', 'shade'].map((ty, i) => { const p = ahead(PK, 1.3 + i * 0.85, (i - 1) * 0.05); return mk(ty, p.x, p.z, PK.yaw + Math.PI + (i - 1) * 0.3, ST_STAGGER); });
    // the mace's: its skull caving under the blow
    const M = byPose('mace'), mp = ahead(M, 1.15, 0.12); this.bashed = mk('wretch', mp.x, mp.z, M.yaw + Math.PI - 0.2, ST_STAGGER);
    // and the horde coming on out of the fog, round the ends of the line and between them
    this.horde = [];
    ['shade', 'crawler', 'shade', 'husk', 'wretch', 'shade', 'crawler', 'shade', 'brute'].forEach((ty, i) => {
      const sd = i % 2 ? 1 : -1, ang = this.front + sd * (0.35 + (i >> 1) * 0.32 + Math.random() * 0.1), R0 = ty === 'brute' ? 11 : 6.5 + Math.random() * 3.5;
      const d = mk(ty, Math.sin(ang) * R0, Math.cos(ang) * R0, ang + Math.PI, ST_CHASE); d.home = { ang, R0 }; d.vel.set(-Math.sin(ang), 0, -Math.cos(ang)).multiplyScalar(d.def.speed); this.horde.push(d);
    });
    for (const d of this.demons) d.animate(1 / 60, 0, this.W, this.fx, this.e.camera.position);
    this.cut.sever(this.cut.chest.add(new THREE.Vector3(0, 0.55, 0)), new THREE.Vector3(Math.cos(H.yaw), 0.4, -Math.sin(H.yaw)), this.fx, this.ground);
    this.cutT = 0; this.bleed = 0;
  }
  update(dt, cam) {
    this.t += dt; const sdt = dt * SLOW;
    this.poseKnights(dt);
    // the horde comes on in slow motion, running; as one reaches the knights it burns away to smoke and another forms
    // out of the fog behind
    for (const d of this.horde) {
      d.pos.addScaledVector(d.vel, dt * HORDE);
      const r = Math.hypot(d.pos.x, d.pos.z), u = d.mat.userData.u;
      if (r < 5.0) d.fade = Math.min(1, (d.fade || 0) + dt * 0.8);
      else d.fade = Math.max(0, (d.fade || 0) - dt * 0.6);
      if (d.fade >= 1) { const h = d.home; d.pos.set(Math.sin(h.ang) * (h.R0 + 2), 0, Math.cos(h.ang) * (h.R0 + 2)); d.fade = 0.999; }
      d.dissolve = 0; if (u.uDissolve) u.uDissolve.value = d.fade * 0.98;
    }
    for (const d of this.demons) {
      if (d.state === ST_STAGGER) d.stateT = 0.3 + Math.sin(this.t * 0.4 + d.id) * 0.05; else d.stateT += dt * HORDE;
      d.animate(d.state === ST_CHASE ? dt * HORDE : sdt, this.t, this.W, this.fx, cam);
      if (d.fade !== undefined && d.mat.userData.u.uDissolve) d.mat.userData.u.uDissolve.value = d.fade * 0.98;
    }
    // after a while it all starts over (a fresh head to lose)
    this.cutT += dt; if (this.cutT > 22) { for (const d of this.demons) this.scene.remove(d.mesh); this.buildDemons(); }
    // blood in the air where the steel is in them
    this.bleed -= dt;
    if (this.bleed <= 0) {
      this.bleed = 0.35;
      const n = this.cut.B.neck || this.cut.B.chest, np = n.getWorldPosition(new THREE.Vector3());
      this.fx.blood(np, new THREE.Vector3(0.4, 1, 0.2), new THREE.Vector3(0, 1, 0), 1.2, this.ground);
      for (const d of this.skewered) this.fx.blood(d.chest, new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0, -0.4, 0), 0.5, this.ground);
      const hb = this.bashed.B.head?.getWorldPosition(new THREE.Vector3()); if (hb) { this.fx.blood(hb, new THREE.Vector3(0.6, 0.6, 0), new THREE.Vector3(0, 0.5, 0), 0.8, this.ground); if (Math.random() < 0.3) this.fx.sparks(hb, 3); }
    }
    this.fx.ambient(dt, cam, 'embers', 0.25);
    this.fx.update(sdt);
    for (const f of this.flames) f.fl.update(this.t, cam, f.k);
    for (const l of this.lights) l.L.intensity = l.base * (0.82 + 0.1 * Math.sin(this.t * 8.1 + l.ph) + 0.08 * Math.sin(this.t * 13.7 + l.ph * 2));
    for (const m of this.mist) m.m.rotation.z += m.w * dt;
    this.beam.material.uniforms.uTime.value = this.t;
  }
  // the camera turns slowly round them, low, looking up at the cross over the kneeling knight
  camera(c, dt) {
    const t = this.t, sw = Math.sin(t * 0.05) * 0.5, ang = this.front + sw, R = 7.6 + Math.sin(t * 0.07) * 0.5;
    const want = new THREE.Vector3(Math.sin(ang) * R, 1.15 + Math.sin(t * 0.09) * 0.2, Math.cos(ang) * R);
    c.position.lerp(want, this.snapped ? 1 - Math.exp(-1.5 * dt) : 1); this.snapped = true;
    c.lookAt(Math.sin(ang) * 0.6, 1.75, Math.cos(ang) * 0.6);
    if (Math.abs(c.fov - 46) > 0.1) { c.fov = 46; c.updateProjectionMatrix(); }
  }
  setVisible(v) {
    this.showing = v;
    for (const { k } of this.knights) { k.group.visible = v; if (k.weapon) k.weapon.visible = v; if (k.cape) k.cape.mesh.visible = v; }
    for (const d of this.demons) d.mesh.visible = v;
  }
  dispose() {
    for (const { k } of this.knights) k.dispose();
    for (const d of this.demons) this.scene.remove(d.mesh);
    const F = this.fx; for (const P of [F.smoke, F.glow]) { this.scene.remove(P.points); P.geo.dispose(); }
    for (const l of F.lights) this.scene.remove(l);
    for (const m of [...F.rings, ...(F.pools || []).map((p) => p.m), ...(F.gibs || []).map((g) => g.mesh || g.m)]) if (m) this.scene.remove(m);
    this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose?.(); });
  }
}
