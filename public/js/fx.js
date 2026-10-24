// Particles (two GPU point pools: alpha-blended smoke and additive light),
// weapon trails, shockwaves, flash lights and holy beams.
import * as THREE from 'three';
import { spriteTextures } from './textures.js';
import { clamp, lerp, rng } from './util.js';

const R = Math.random;

class Pool {
  constructor(scene, n, additive) {
    this.n = n; this.count = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4); this.size = new Float32Array(n); this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.cell = new Float32Array(n); this.rot = new Float32Array(n); this.spin = new Float32Array(n);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.grow = new Float32Array(n); this.fade = new Float32Array(n);
    this.startA = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3); this.aCol = new THREE.BufferAttribute(this.col, 4);
    this.aSize = new THREE.BufferAttribute(this.size, 1); this.aCell = new THREE.BufferAttribute(this.cell, 1); this.aRot = new THREE.BufferAttribute(this.rot, 1);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aCell, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('color', this.aCol); g.setAttribute('size', this.aSize); g.setAttribute('cell', this.aCell); g.setAttribute('rot', this.aRot);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: spriteTextures() }, scale: { value: 600 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.01 } },
      vertexShader: `
        attribute float size; attribute vec4 color; attribute float cell; attribute float rot;
        uniform float scale; varying vec4 vCol; varying float vCell; varying float vRot; varying float vFog;
        void main(){
          vCol = color; vCell = cell; vRot = rot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          vFog = -mv.z;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogDensity;
        varying vec4 vCol; varying float vCell; varying float vRot; varying float vFog;
        void main(){
          vec2 p = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot);
          p = mat2(c, -s, s, c) * p + 0.5;
          vec4 t = texture2D(map, vec2((p.x + vCell) * 0.25, 1.0 - p.y));
          vec4 col = vec4(vCol.rgb * t.rgb, vCol.a * t.a);
          float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
          ${additive ? 'col.rgb *= (1.0 - f);' : 'col.rgb = mix(col.rgb, fogColor, f);'}
          if (col.a < 0.003) discard;
          gl_FragColor = col;
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 3 : 2;
    scene.add(this.points); this.geo = g;
  }
  emit(o) {
    if (this.count >= this.n) return;
    const i = this.count++;
    this.pos[i * 3] = o.x; this.pos[i * 3 + 1] = o.y; this.pos[i * 3 + 2] = o.z;
    this.vel[i * 3] = o.vx || 0; this.vel[i * 3 + 1] = o.vy || 0; this.vel[i * 3 + 2] = o.vz || 0;
    const c = o.color || [1, 1, 1];
    this.col[i * 4] = c[0]; this.col[i * 4 + 1] = c[1]; this.col[i * 4 + 2] = c[2]; this.col[i * 4 + 3] = o.a ?? 1;
    this.startA[i] = o.a ?? 1;
    this.size[i] = o.size || 0.3; this.life[i] = 0; this.maxLife[i] = o.life || 1; this.cell[i] = o.cell || 0;
    this.rot[i] = R() * 6.28; this.spin[i] = (R() - 0.5) * (o.spin ?? 1);
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav ?? 0; this.grow[i] = o.grow ?? 0; this.fade[i] = o.fadeIn ?? 0.1;
  }
  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--; this.copy(n, i); i--; continue;
      }
      const k = i * 3; const dr = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= dr; this.vel[k + 1] = this.vel[k + 1] * dr + this.grav[i] * dt; this.vel[k + 2] *= dr;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] += this.grow[i] * dt; this.rot[i] += this.spin[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      const fi = this.fade[i];
      this.col[i * 4 + 3] = this.startA[i] * Math.min(1, t / fi) * (1 - smoothT(t));
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    for (const a of [this.aPos, this.aCol, this.aSize, this.aCell, this.aRot]) a.needsUpdate = true;
  }
  copy(from, to) {
    for (let c = 0; c < 3; c++) { this.pos[to * 3 + c] = this.pos[from * 3 + c]; this.vel[to * 3 + c] = this.vel[from * 3 + c]; }
    for (let c = 0; c < 4; c++) this.col[to * 4 + c] = this.col[from * 4 + c];
    for (const arr of [this.size, this.life, this.maxLife, this.cell, this.rot, this.spin, this.drag, this.grav, this.grow, this.fade, this.startA]) arr[to] = arr[from];
  }
}
const smoothT = (t) => t * t * (3 - 2 * t);

// Ribbon behind a weapon's edge while it swings
class Trail {
  constructor(scene, color = 0xfff2d0, segs = 14) {
    this.segs = segs; this.pts = []; this.alive = 0;
    this.geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(segs * 2 * 3); this.aArr = new Float32Array(segs * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.posArr, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.aArr, 1));
    const idx = []; for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0.0 } },
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float strength; varying float vA; void main(){ gl_FragColor = vec4(color * vA * strength, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }
  update(dt, base, tip, active) {
    this.alive = active ? Math.min(1, this.alive + dt * 12) : Math.max(0, this.alive - dt * 5);
    this.mat.uniforms.strength.value = this.alive * 0.55;
    if (this.alive <= 0) { this.pts.length = 0; this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.pts.unshift([base.x, base.y, base.z, tip.x, tip.y, tip.z]);
    if (this.pts.length > this.segs) this.pts.length = this.segs;
    for (let i = 0; i < this.segs; i++) {
      const p = this.pts[Math.min(i, this.pts.length - 1)];
      this.posArr.set(p, i * 6);
      const a = (1 - i / (this.segs - 1)); this.aArr[i * 2] = a * 0.15; this.aArr[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); }
}

export class FX {
  constructor(scene, quality) {
    this.scene = scene; this.q = quality;
    const mul = quality.particles;
    this.smoke = new Pool(scene, Math.floor(3500 * mul), false);
    this.glow = new Pool(scene, Math.floor(3500 * mul), true);
    this.rings = []; this.lights = []; this.beams = []; this.decals = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa55, 0, 12, 2); l.userData.t = 0; scene.add(l); this.lights.push(l); }
    this.ringGeo = new THREE.RingGeometry(0.9, 1.0, 48, 1); this.ringGeo.rotateX(-Math.PI / 2);
    this.ashT = 0;
  }
  setFog(fog) { for (const p of [this.smoke, this.glow]) { p.mat.uniforms.fogColor.value.copy(fog.color); p.mat.uniforms.fogDensity.value = fog.density; } }
  resize(h) { const s = h * 0.9; this.smoke.mat.uniforms.scale.value = s; this.glow.mat.uniforms.scale.value = s; }

  trail(color) { return new Trail(this.scene, color); }

  flash(pos, color = 0xffaa55, intensity = 30, dur = 0.35, dist = 14) {
    let l = this.lights.find((x) => x.userData.t <= 0) || this.lights.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    l.position.copy(pos); l.color.set(color); l.userData.peak = intensity; l.userData.t = dur; l.userData.dur = dur; l.distance = dist; l.intensity = intensity;
  }
  ring(pos, color = 0xffd890, maxR = 4, dur = 0.6, additive = true) {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide }));
    m.position.copy(pos); m.position.y += 0.08; m.userData = { t: 0, dur, maxR };
    this.scene.add(m); this.rings.push(m);
  }
  beam(pos, color = 0xffe2a0, dur = 4, radius = 2.2, height = 60) {
    const g = new THREE.CylinderGeometry(radius * 0.6, radius, height, 24, 1, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, a: { value: 0 }, time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 color; uniform float a, time; varying vec2 vUv;
        void main(){ float edge = sin(vUv.x * 3.14159 * 2.0 * 6.0 + time * 2.0) * 0.15 + 0.85; float v = (1.0 - vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        gl_FragColor = vec4(color * a * v * edge * 0.8, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(g, mat); m.position.copy(pos); m.position.y += height / 2; m.userData = { t: 0, dur };
    this.scene.add(m); this.beams.push(m);
    return m;
  }

  // ---------------------------------------------------------------- presets
  ichor(pos, dir, amount = 1) { // shadow-flesh bursts into black smoke and embers
    const n = Math.round(10 * amount);
    for (let i = 0; i < n; i++) {
      const s = 1 + R() * 3;
      this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: (dir?.x || 0) * s + (R() - 0.5) * 2, vy: R() * 2, vz: (dir?.z || 0) * s + (R() - 0.5) * 2, color: [0.02, 0.015, 0.02], a: 0.85, size: 0.35 + R() * 0.4, grow: 0.8, life: 0.8 + R() * 0.6, drag: 3, grav: 0.6, cell: 0 });
    }
    for (let i = 0; i < n * 0.7; i++) this.glow.emit({ x: pos.x, y: pos.y, z: pos.z, vx: (R() - 0.5) * 5 + (dir?.x || 0) * 3, vy: R() * 4, vz: (R() - 0.5) * 5 + (dir?.z || 0) * 3, color: [1.0, 0.35, 0.08], size: 0.05 + R() * 0.05, life: 0.4 + R() * 0.5, drag: 2, grav: -6, cell: 1 });
  }
  sparks(pos, n = 14, color = [1, 0.8, 0.45]) {
    for (let i = 0; i < n; i++) this.glow.emit({ x: pos.x, y: pos.y, z: pos.z, vx: (R() - 0.5) * 9, vy: R() * 6, vz: (R() - 0.5) * 9, color, size: 0.06 + R() * 0.04, life: 0.25 + R() * 0.35, drag: 1.5, grav: -12, cell: 2, spin: 0 });
    this.glow.emit({ x: pos.x, y: pos.y, z: pos.z, color: [1, 0.85, 0.6], size: 0.9, life: 0.12, cell: 1, fadeIn: 0.01 });
  }
  wisp(pos, size = 0.4, color = [0.03, 0.02, 0.03]) {
    this.smoke.emit({ x: pos.x + (R() - 0.5) * 0.3, y: pos.y, z: pos.z + (R() - 0.5) * 0.3, vx: (R() - 0.5) * 0.4, vy: 0.4 + R() * 0.6, vz: (R() - 0.5) * 0.4, color, a: 0.5, size, grow: 0.6, life: 1.0 + R(), drag: 0.8, cell: 0 });
  }
  death(pos, scale = 1) {
    for (let i = 0; i < 30 * scale; i++) this.smoke.emit({ x: pos.x + (R() - 0.5) * 0.6 * scale, y: pos.y + R() * 1.5 * scale, z: pos.z + (R() - 0.5) * 0.6 * scale, vx: (R() - 0.5) * 3, vy: 0.5 + R() * 2.5, vz: (R() - 0.5) * 3, color: [0.02, 0.015, 0.02], a: 0.8, size: 0.5 + R() * 0.6 * scale, grow: 1.2, life: 1.2 + R() * 1.2, drag: 1.8, cell: 0 });
    for (let i = 0; i < 20 * scale; i++) this.glow.emit({ x: pos.x, y: pos.y + R() * scale, z: pos.z, vx: (R() - 0.5) * 6, vy: 1 + R() * 5, vz: (R() - 0.5) * 6, color: [1, 0.3, 0.06], size: 0.05 + R() * 0.06, life: 0.6 + R() * 0.8, drag: 1.2, grav: -3, cell: 1 });
  }
  holyMotes(pos, radius = 3, n = 6, color = [1, 0.85, 0.5]) {
    for (let i = 0; i < n; i++) {
      const a = R() * 6.28, r = Math.sqrt(R()) * radius;
      this.glow.emit({ x: pos.x + Math.cos(a) * r, y: pos.y + R() * 0.4, z: pos.z + Math.sin(a) * r, vx: 0, vy: 0.6 + R() * 1.6, vz: 0, color, size: 0.06 + R() * 0.08, life: 1.5 + R() * 2, drag: 0.2, cell: 1 });
    }
  }
  holyBurst(pos, radius = 5) {
    for (let i = 0; i < 80; i++) {
      const a = R() * 6.28, s = 4 + R() * 8;
      this.glow.emit({ x: pos.x, y: pos.y + 1, z: pos.z, vx: Math.cos(a) * s, vy: R() * 3, vz: Math.sin(a) * s, color: [1, 0.9, 0.6], size: 0.1 + R() * 0.15, life: 0.6 + R() * 0.8, drag: 2.2, cell: 1 });
    }
    this.glow.emit({ x: pos.x, y: pos.y + 1, z: pos.z, color: [1, 0.9, 0.7], size: radius * 1.6, life: 0.5, cell: 1, fadeIn: 0.02 });
    this.ring(pos, 0xffe0a0, radius, 0.7); this.flash(new THREE.Vector3(pos.x, pos.y + 1.5, pos.z), 0xffe0a0, 60, 0.6, radius * 4);
  }
  dust(pos, n = 4, color = [0.25, 0.22, 0.2]) {
    for (let i = 0; i < n; i++) this.smoke.emit({ x: pos.x + (R() - 0.5) * 0.4, y: pos.y + 0.05, z: pos.z + (R() - 0.5) * 0.4, vx: (R() - 0.5) * 1.2, vy: 0.2 + R() * 0.5, vz: (R() - 0.5) * 1.2, color, a: 0.35, size: 0.25 + R() * 0.3, grow: 0.9, life: 0.7 + R() * 0.6, drag: 2, cell: 0 });
  }
  slam(pos, r = 3) {
    this.ring(pos, 0xc0b8a8, r, 0.45, false);
    for (let i = 0; i < 40; i++) { const a = R() * 6.28, s = 3 + R() * 5; this.smoke.emit({ x: pos.x, y: pos.y + 0.1, z: pos.z, vx: Math.cos(a) * s, vy: R() * 1.5, vz: Math.sin(a) * s, color: [0.2, 0.18, 0.16], a: 0.45, size: 0.4 + R() * 0.4, grow: 1.5, life: 0.8 + R() * 0.5, drag: 3, cell: 0 }); }
    this.sparks(new THREE.Vector3(pos.x, pos.y + 0.1, pos.z), 10);
  }
  explosion(pos, r = 4, color = [1, 0.4, 0.1]) {
    for (let i = 0; i < 60; i++) { const a = R() * 6.28, e = R() * 1.4, s = 2 + R() * 9; this.glow.emit({ x: pos.x, y: pos.y + 0.6, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, color, size: 0.3 + R() * 0.7, grow: 1.4, life: 0.35 + R() * 0.4, drag: 3.5, cell: 3 }); }
    for (let i = 0; i < 40; i++) { const a = R() * 6.28, s = 1 + R() * 5; this.smoke.emit({ x: pos.x, y: pos.y + 0.6, z: pos.z, vx: Math.cos(a) * s, vy: 1 + R() * 4, vz: Math.sin(a) * s, color: [0.04, 0.03, 0.03], a: 0.8, size: 0.6 + R() * 0.8, grow: 1.6, life: 1.4 + R(), drag: 2.2, cell: 0 }); }
    this.ring(pos, 0xff7030, r, 0.4); this.flash(new THREE.Vector3(pos.x, pos.y + 1, pos.z), 0xff6020, 80, 0.5, r * 4);
  }
  fireStream(origin, dir, len = 14, spread = 0.25, rate = 1) { // the dragon's breath
    const n = Math.round(10 * rate);
    for (let i = 0; i < n; i++) {
      const s = len * (0.8 + R() * 0.6);
      const dx = dir.x + (R() - 0.5) * spread, dy = dir.y + (R() - 0.5) * spread * 0.6, dz = dir.z + (R() - 0.5) * spread;
      this.glow.emit({ x: origin.x, y: origin.y, z: origin.z, vx: dx * s, vy: dy * s, vz: dz * s, color: R() < 0.3 ? [1, 0.75, 0.3] : [1, 0.35, 0.06], size: 0.4 + R() * 0.5, grow: 3.0, life: 0.7 + R() * 0.3, drag: 1.2, grav: 1.5, cell: 3, spin: 3 });
      if (R() < 0.3) this.smoke.emit({ x: origin.x + dx * s * 0.5, y: origin.y + dy * s * 0.5, z: origin.z + dz * s * 0.5, vx: dx * s * 0.5, vy: 1.5, vz: dz * s * 0.5, color: [0.05, 0.04, 0.04], a: 0.6, size: 1, grow: 2.5, life: 1.6, drag: 1, cell: 0 });
    }
  }
  bolt(pos, color = [0.6, 0.1, 0.9]) { // wretch projectile trail
    this.glow.emit({ x: pos.x, y: pos.y, z: pos.z, color, size: 0.35, life: 0.25, cell: 1 });
    this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: (R() - 0.5) * 0.3, vy: 0.2, vz: (R() - 0.5) * 0.3, color: [0.04, 0.0, 0.06], a: 0.6, size: 0.25, grow: 0.6, life: 0.6, drag: 1, cell: 0 });
  }
  consecration(pos, r) { // the ground burning with holy fire
    for (let i = 0; i < 3; i++) { const a = R() * 6.28, d = Math.sqrt(R()) * r; this.glow.emit({ x: pos.x + Math.cos(a) * d, y: pos.y + 0.05, z: pos.z + Math.sin(a) * d, vy: 1 + R() * 1.5, color: [1, 0.85, 0.45], size: 0.25 + R() * 0.3, grow: -0.2, life: 0.7, cell: 3 }); }
  }
  hellfire(x, y, z, r) { // burning ground left by the dragon
    const a = R() * 6.28, d = Math.sqrt(R()) * r;
    this.glow.emit({ x: x + Math.cos(a) * d, y: y + 0.1, z: z + Math.sin(a) * d, vy: 1.5 + R() * 2, color: R() < 0.3 ? [1, 0.7, 0.25] : [1, 0.3, 0.05], size: 0.5 + R() * 0.6, grow: 0.5, life: 0.6 + R() * 0.4, cell: 3, spin: 2 });
    if (R() < 0.25) this.smoke.emit({ x: x + Math.cos(a) * d, y: y + 0.8, z: z + Math.sin(a) * d, vy: 1.2, color: [0.05, 0.04, 0.04], a: 0.5, size: 0.8, grow: 1.5, life: 1.5, drag: 0.5, cell: 0 });
  }
  // ambient ash/embers drifting around the camera
  ambient(dt, camPos, kind = 'ash', density = 1) {
    this.ashT += dt * 60 * density * this.q.particles;
    while (this.ashT > 1) {
      this.ashT -= 1;
      const x = camPos.x + (R() - 0.5) * 40, z = camPos.z + (R() - 0.5) * 40, y = camPos.y + R() * 12 - 2;
      if (kind === 'ash') this.smoke.emit({ x, y, z, vx: 0.6 + R() * 0.6, vy: -0.3 - R() * 0.4, vz: 0.2, color: [0.35, 0.33, 0.32], a: 0.7, size: 0.05 + R() * 0.04, life: 6, drag: 0, cell: 1, fadeIn: 0.2 });
      else if (kind === 'embers') this.glow.emit({ x, y: camPos.y - 2 + R() * 4, z, vx: (R() - 0.5) * 0.6, vy: 0.4 + R() * 0.8, vz: (R() - 0.5) * 0.6, color: [1, 0.35, 0.08], size: 0.04 + R() * 0.03, life: 4, drag: 0, cell: 1, fadeIn: 0.2 });
      else if (kind === 'snow') this.smoke.emit({ x, y, z, vx: 1.4 + R(), vy: -1 - R() * 0.8, vz: 0.4, color: [0.9, 0.92, 0.95], a: 0.9, size: 0.05 + R() * 0.05, life: 6, drag: 0, cell: 1, fadeIn: 0.2 });
      else if (kind === 'motes') this.glow.emit({ x, y: camPos.y - 1 + R() * 5, z, vx: (R() - 0.5) * 0.2, vy: 0.1 + R() * 0.3, vz: (R() - 0.5) * 0.2, color: [1, 0.9, 0.6], size: 0.03 + R() * 0.04, life: 5, drag: 0, cell: 1, fadeIn: 0.3 });
    }
  }

  update(dt) {
    this.smoke.update(dt); this.glow.update(dt);
    for (const l of this.lights) {
      if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.peak * Math.max(0, l.userData.t / l.userData.dur); }
      else l.intensity = 0;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const m = this.rings[i]; m.userData.t += dt; const t = m.userData.t / m.userData.dur;
      m.scale.setScalar(0.2 + t * m.userData.maxR); m.material.opacity = (1 - t) * 0.8;
      if (t >= 1) { this.scene.remove(m); m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const m = this.beams[i]; m.userData.t += dt; const t = m.userData.t / m.userData.dur;
      m.material.uniforms.time.value += dt;
      m.material.uniforms.a.value = Math.min(1, t * 6) * (1 - smoothT(clamp((t - 0.6) / 0.4, 0, 1)));
      if (t >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.beams.splice(i, 1); }
    }
  }
}
