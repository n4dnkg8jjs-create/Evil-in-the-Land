// The title screen: five knights shoulder to shoulder in a half circle on the dead land, in their guards, ready, the
// mountain over them in the storm. They face the camera, and the camera is where the horde is coming from: at the
// bottom of the picture, rising into it, the heads and reaching hands of the demons, running in slow motion.
// The land is the game's own (the Field of the Fallen: the wasteland, with the mountain near); the knights stand in
// their weapons' own guards and breathe, glance about, shift their feet as they do in play.
import * as THREE from 'three';
import { Knight } from './knight.js';
import { Demon } from './demons.js';
import { World } from './world.js';

const CHAPTER = 0;                 // the Vale of Ashes: dead land under the storm, the mountain beyond
const HORDE = 0.14;                // the demons come on in slow motion
const ST_CHASE = 1;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };

// the five, from the camera's left to its right; the middle one a little forward
const LINE = [
  { off: -2.0, back: 1.1, lo: { style: 'milanese', finish: 'bright', weapon: 'halberd', heraldry: 'azure' } },
  { off: -1.05, back: 0.32, lo: { style: 'gothic', finish: 'bright', weapon: 'zweihander', heraldry: 'vert' } },
  { off: 0, back: 0, lo: { style: 'gothic', finish: 'bright', weapon: 'longsword', heraldry: 'gules' } },
  { off: 1.05, back: 0.32, lo: { style: 'maximilian', finish: 'blued', weapon: 'mace', heraldry: 'sable' } },
  { off: 2.0, back: 1.1, lo: { style: 'milanese', finish: 'russet', weapon: 'pike', heraldry: 'purpure' } },
];

export class MenuStage {
  constructor(engine, quality) {
    this.e = engine; this.q = quality; this.scene = engine.scene; this.t = 0;
    const W = this.world = new World(engine, quality, CHAPTER);
    // stand them on the road, their backs to the mountain
    const t = 0.32, p = W.path.at(t);   // between the first altar and the second, on open ground
    const m = W.vista?.mountain ? W.vista.mountain.position : new THREE.Vector3(p.x, 0, p.z - 1000);
    const toM = new THREE.Vector3(m.x - p.x, 0, m.z - p.z).normalize();
    this.c = new THREE.Vector3(p.x, W.heightAt(p.x, p.z), p.z); this.toM = toM;
    this.face = Math.atan2(-toM.x, -toM.z);                 // they face away from the mountain, toward the camera
    this.side = new THREE.Vector3(-toM.z, 0, toM.x);
    this.W = { heightAt: (x, z) => W.heightAt(x, z), collide() {}, wind: W.wind, canPrayAt: () => false };
    this.altar = { x: p.x, y: this.c.y, z: p.z };
    this.lobbyPos = this.c.clone(); this.lobbyYaw = this.face;
    engine.renderer.toneMappingExposure = (W.ch.atmos.exposure || 1) * 1.35;
    // light for the picture: fire-light from in front and low (the horde's side), and a cold rim from the storm behind
    this.lights = new THREE.Group(); this.scene.add(this.lights);
    const key = new THREE.SpotLight(0xffa860, 26, 30, 0.5, 0.8, 1.2); key.position.copy(this.at(-4, -9)).add(new THREE.Vector3(0, 4.5, 0)); key.target.position.copy(this.at(0, 0.3)).add(new THREE.Vector3(0, 1.3, 0)); this.lights.add(key, key.target);
    const rim = new THREE.SpotLight(0xa8c0ff, 80, 30, 0.6, 0.7, 1.2); rim.position.copy(this.at(2, 7)).add(new THREE.Vector3(0, 6, 0)); rim.target.position.copy(this.at(0, 0)).add(new THREE.Vector3(0, 1.4, 0)); this.lights.add(rim, rim.target);
    const low = new THREE.PointLight(0xff5a20, 14, 9, 1.5); low.position.copy(this.at(0, -5.5)).add(new THREE.Vector3(0, 0.6, 0)); this.lights.add(low); this.low = low;
    this.buildAltar();
    this.buildKnights();
    this.buildHorde();
  }
  // the altar behind them, as the game builds it, cleansed: candles lit, the blight gone; and a holy light falling
  // out of the storm on it and on them, a shaft of it in the air
  buildAltar() {
    const G = this.lights, ap = this.at(0, 5.2);
    const fake = { ch: { seed: 1101 }, altarT: [{ x: 0, y: 0, z: 0, t: 0 }], group: new THREE.Group(), addCollider() {} };
    try {
      World.prototype.buildAltars.call(fake); const A = fake.altars[0];
      if (A.corr) A.corr.visible = false; if (A.evilLight) { A.evilLight.visible = false; A.evilLight.intensity = 0; } if (A.candles) A.candles.visible = true;
      if (A.crossMesh) A.crossMesh.rotation.y = this.face;
      // only the steps, cross and candles: not the ring of stones (they would stand among the knights)
      for (const o of [...A.group.children]) { const r = Math.hypot(o.position.x, o.position.z); if (r > 5) o.visible = false; }
      A.group.position.copy(ap); A.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); G.add(A.group); this.A = A;
    } catch (e) { console.warn('menu altar', e); }
    const top = ap.clone().add(new THREE.Vector3(0, 20, 0)).addScaledVector(this.toM, -3), aim = this.at(0, 1.6).add(new THREE.Vector3(0, 1, 0));
    const holy = new THREE.SpotLight(0xfff0d0, 220, 40, 0.34, 0.75, 1.2); holy.position.copy(top); holy.target.position.copy(aim);
    holy.castShadow = true; holy.shadow.mapSize.set(1024, 1024); holy.shadow.bias = -0.0003; G.add(holy, holy.target);
    const beamMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ float edge = pow(abs(dot(vN, vV)), 2.5); float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y)); float dust = 0.8 + 0.2 * sin(uTime * 0.5 + vUv.y * 8.0 + vUv.x * 25.0); gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * edge * along * 0.2 * dust, 1.0); }' });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 4.6, 20, 40, 1, true), beamMat);
    beam.position.copy(top).add(aim).multiplyScalar(0.5); beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(aim).normalize()); beam.renderOrder = 4; G.add(beam); this.beam = beam;
  }
  at(off, back) { const v = this.c.clone().addScaledVector(this.side, off).addScaledVector(this.toM, back); v.y = this.world.heightAt(v.x, v.z); return v; }
  buildKnights() {
    this.knights = LINE.map((s, i) => {
      const k = new Knight(this.scene, this.q, { ...s.lo, relic: 'water', cape: true, plume: true }, { id: 300 + i, name: '' });
      k.pos.copy(this.at(s.off, s.back)); k.yaw = this.face - s.off * 0.2;   // the half circle: the ends turned in a little
      return { k, s, look: 0, next: 1 + Math.random() * 3 };
    });
    for (let i = 0; i < 40; i++) this.poseKnights(1 / 30);
  }
  // standing in guard: no input, so each holds his weapon's own stance and breathes, his weight shifting; now and then
  // one glances along the line or out to the side, and back to the front
  poseKnights(dt) {
    for (const P of this.knights) {
      const { k } = P;
      P.next -= dt; if (P.next <= 0) { P.next = 2 + Math.random() * 4; P.look = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 1.0; }
      const aim = this.face - P.s.off * 0.2 + P.look;
      k.simulate(dt, { mx: 0, mz: 0, aimYaw: aim, sprint: false, block: false, pray: false, attack: false, heavy: false, dodge: false, relic: false }, this.W);
      k.events.length = 0; k.animate(dt, this.W); k.events.length = 0;
    }
  }
  // the horde, coming up from under the camera: only their heads and hands get into the bottom of the picture
  buildHorde() {
    this.demons = []; let id = 9700;
    const types = ['shade', 'crawler', 'shade', 'shade', 'crawler', 'shade', 'shade', 'crawler', 'shade', 'shade', 'crawler', 'shade', 'shade', 'crawler', 'shade', 'shade', 'crawler', 'shade', 'shade', 'shade'];
    // and more on the left, crowding in round that end of the line
    for (let k = 0; k < 8; k++) types.push(k % 3 ? 'shade' : 'crawler');
    types.forEach((ty, i) => {
      const d = new Demon(ty, id++, this.scene);
      const left = i >= 20, row = i % 2, k2 = i >> 1; let lane = left ? -1.6 - (i - 20) * 0.5 + (Math.random() - 0.5) * 0.3 : (k2 / 9 - 0.5) * (row ? 7.4 : 5.6) + (Math.random() - 0.5) * 0.4; if (Math.abs(lane) < (row ? 0.6 : 0.8)) lane = Math.sign(lane || 1) * (0.8 + Math.random() * 0.3);   // the very middle kept clear
      d.lane = lane; d.dist = (left ? 3.6 + (i % 3) * 0.9 : (row ? 5.0 : 3.9)) + Math.random() * 1.5;        // distance in front of the line, toward the camera
      d.yaw = this.face + Math.PI; d.setState(ST_CHASE); d.stateT = 1; d.phase = Math.random();
      d.vel.copy(this.toM).multiplyScalar(d.def.speed); d.fade = 0;
      this.place(d); this.demons.push(d);
    });
  }
  place(d) { const p = this.at(d.lane, -d.dist); d.pos.copy(p); }
  update(dt, cam) {
    this.t += dt;
    if (this.beam) this.beam.material.uniforms.uTime.value = this.t;
    if (this.A?.candles) this.A.candles.traverse((o) => { if (o.isPointLight) o.intensity = (o.userData.base ??= o.intensity) * (0.85 + 0.15 * Math.sin(this.t * 9 + o.id)); });
    this.low.intensity = 14 * (0.8 + 0.2 * Math.sin(this.t * 7.7) * Math.sin(this.t * 3.3));
    this.poseKnights(dt);
    this.world.update(dt, cam);
    for (const d of this.demons) {
      // they run at the knights in slow motion; as one gets in among them it burns away and another comes up behind
      d.dist -= d.def.speed * dt * HORDE * 0.35;
      d.fade = d.dist < 3.0 ? Math.min(1, d.fade + dt * 0.8) : Math.max(0, d.fade - dt * 0.6);
      if (d.fade >= 1) { d.dist = 5.4 + Math.random() * 1.0; d.fade = 0.999; }
      this.place(d);
      d.animate(dt * HORDE, this.t, this.W, null, cam);
      if (d.mat.userData.u.uDissolve) d.mat.userData.u.uDissolve.value = d.fade * 0.98;
    }
  }
  // the camera: low, just behind the front of the horde, looking up past their heads at the knights and the mountain
  camera(c, dt) {
    const t = this.t, sway = Math.sin(t * 0.05) * 0.6;
    const want = this.at(sway, -7.0); want.y += 1.95 + Math.sin(t * 0.07) * 0.06;
    const look = this.at(sway * 0.3, 0); look.y += 1.75;
    if (this.intro) { this.introCamera(c, want, look); this.snapped = true; return; }
    c.position.lerp(want, this.snapped ? 1 - Math.exp(-1.5 * dt) : 1); this.snapped = true;
    c.lookAt(look);
    if (Math.abs(c.fov - 44) > 0.1) { c.fov = 44; c.updateProjectionMatrix(); }
  }
  // the opening shot (intro.js drives this.intro.u from 0 to 1): high in the storm over the dead land, looking at the
  // mountain; then down out of the sky, over the horde, to the five before the altar, ending on the title's own camera
  introCamera(c, P1, L1) {
    const I = this.intro, u = Math.min(1, Math.max(0, I.u)), drift = I.drift || 0;
    if (!I.path) {
      const P0 = this.at(6, -84); P0.y += 34;
      const Pm = this.at(-5, -30); Pm.y += 9;
      const V = this.world.vista, m = V?.mountain?.position, pk = V?.peakPos;
      const L0 = m && pk ? m.clone().lerp(pk, 0.5) : this.c.clone().addScaledVector(this.toM, 600).add(new THREE.Vector3(0, 90, 0));
      I.path = { P0, Pm, L0 };
    }
    const { P0, Pm, L0 } = I.path;
    const p0 = P0.clone(); p0.y += drift * 1.2; p0.addScaledVector(this.toM, drift * 2.5);   // drifting slowly in, before the dive
    const curve = new THREE.CatmullRomCurve3([p0, Pm, P1.clone()], false, 'centripetal');
    const pos = curve.getPoint(u);
    pos.y = Math.max(pos.y, this.world.heightAt(pos.x, pos.z) + 1.6);
    c.position.copy(pos);
    // turn from the mountain down to the knights by direction, not by sliding the aim point (which would whip round at the end)
    const d0 = L0.clone().sub(pos).normalize(), d1 = L1.clone().sub(pos).normalize();
    const w = smooth(0.18, 0.92, u);
    const dir = d0.lerp(d1, w).normalize();
    c.lookAt(pos.clone().add(dir));
    const fov = 52 - 8 * smooth(0.4, 1, u);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }
  get focus() { return this.c; }
  setVisible(v) {
    for (const { k } of this.knights) { k.group.visible = v; if (k.weapon) k.weapon.visible = v; if (k.cape) k.cape.mesh.visible = v; }
    for (const d of this.demons) d.mesh.visible = v;
  }
  dispose() {
    for (const { k } of this.knights) k.dispose();
    for (const d of this.demons) this.scene.remove(d.mesh);
    this.scene.remove(this.lights); this.world.dispose();
  }
}
