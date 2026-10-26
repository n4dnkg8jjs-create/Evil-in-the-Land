// Particles (two GPU point pools: alpha-blended smoke and additive light),
// weapon trails, shockwaves, flash lights and holy beams.
import * as THREE from 'three';
import { spriteTextures } from './textures.js';
import { clamp, lerp, rng } from './util.js';
import { WX } from './weather.js';

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


// ================================================================ BLOOD
// What runs in them is black-red. Three parts: droplets in flight (velocity-stretched streaks, simulated on the
// CPU), splats where each droplet actually lands (irregular, elongated by the angle it struck at, with satellite
// drops), and pools that spread under the fallen. Splats and pools share one lit material: wet and glossy with a
// raised rim, darker at the centre and thinner at the edge, dimpled by rain, drying dark and matte, then fading.
const BLOOD_T = { value: 0 };   // seconds, the clock the decals age by
const BLOOD_GLSL = `
  uniform float uBT, uBRain; varying vec4 vD; varying vec4 vD2; varying vec2 vDuv;
  float bH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float bN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bH(i), bH(i + vec2(1, 0)), f.x), mix(bH(i + vec2(0, 1)), bH(i + vec2(1, 1)), f.x), f.y); }
  float bF(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * bN(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  // 0..1: how much blood lies here (1 = thick at the heart of it)
  float bloodField(vec2 p) {
    float seed = vD.x, el = vD.y, age = uBT - vD.z;
    if (vD.w < 0.5) {
      // a splat: the main drop squashed along the line it travelled (+x), a ragged crown, a tail and satellites
      vec2 q = vec2((p.x + 0.18 * el) / (0.55 + 0.25 * el), p.y / 0.55);
      float n = bF(q * 3.0 + seed * 17.0);
      float r = length(q) + (n - 0.5) * 0.55;
      float f = smoothstep(0.62, 0.3, r);
      // fingers thrown out along the direction of travel
      float a = atan(q.y, q.x), sp = bN(vec2(a * 3.2 + seed * 5.0, seed));
      f = max(f, smoothstep(0.8, 0.45, r - sp * (0.35 + 0.5 * el) * smoothstep(-0.4, 1.0, cos(a))));
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        vec2 c = vec2(bH(vec2(seed, fi)) * 1.6 - 0.35 + el * 0.25, (bH(vec2(fi, seed)) * 2.0 - 1.0) * (0.75 - el * 0.25));
        float rr = 0.025 + 0.06 * bH(vec2(seed + fi, 3.0));
        f = max(f, smoothstep(rr, rr * 0.35, length((p - c) * vec2(1.0 / (1.0 + el * 0.6), 1.0))));
      }
      return f;
    }
    // a pool: spreads out over vD2.y seconds from where the body fell, its edge lobed and creeping
    float grow = 1.0 - exp(-max(0.0, age) / max(0.1, vD2.y));
    float n = bF(p * 2.2 + seed * 9.0), n2 = bN(p * 7.0 + seed);
    float R = (0.18 + 0.72 * grow) * (0.72 + 0.42 * n);
    return smoothstep(R, R - 0.22 - 0.1 * n2, length(p));
  }
`;
function bloodMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, envMapIntensity: 0.15, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBT = BLOOD_T; sh.uniforms.uBRain = WX.uRain;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 aD; attribute vec4 aD2; varying vec4 vD; varying vec4 vD2; varying vec2 vDuv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vD = aD; vD2 = aD2; vDuv = uv * 2.0 - 1.0;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      ${BLOOD_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      float bf = bloodField(vDuv);
      if (bf < 0.02) discard;
      float bAge = uBT - vD.z, bLife = vD2.x;
      float bDry = smoothstep(bLife * 0.2, bLife * 0.85, bAge);
      float bFade = 1.0 - smoothstep(bLife, bLife + 12.0, bAge);
      float bWet = 1.0 - bDry, bRain = uBRain * bWet;
      // thick centre almost black, the thin edge a deep red; dried it goes brown-black
      vec3 bC = mix(vec3(0.016, 0.015, 0.017), vec3(0.004, 0.004, 0.005), smoothstep(0.03, 0.4, bf));
      bC = mix(bC, vec3(0.022, 0.021, 0.02), bDry);
      // rain thins the edge to a pinkish wash
      bC = mix(bC, bC * 1.7 + vec3(0.03, 0.03, 0.032), bRain * (1.0 - smoothstep(0.1, 0.6, bf)) * 0.7);
      diffuseColor.rgb = bC;
      diffuseColor.a = smoothstep(0.02, 0.12, bf) * bFade * (0.97 - 0.3 * bRain * (1.0 - bf));
      // thickness for the surface: a raised meniscus at the rim, a dome in the middle, rain rings on pools
      float bh = smoothstep(0.02, 0.12, bf) * 0.7 + bf * 0.3;
      if (vD.w > 0.5) { vec2 cp = vDuv * 6.0; vec2 ci = floor(cp); vec2 cf = fract(cp) - 0.5; float ph = fract(uBT * 0.9 + bH(ci) * 7.0); float rd = length(cf - (vec2(bH(ci + 1.3), bH(ci + 2.7)) - 0.5) * 0.5);
        bh += uBRain * bWet * sin((rd - ph * 0.45) * 60.0) * (1.0 - ph) * smoothstep(0.45 * ph + 0.05, 0.0, abs(rd - ph * 0.45)) * 0.25; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(0.16, 0.85, bDry);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      { vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
        vec3 g = sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2) * (0.006 * (1.0 - 0.7 * bDry)); normal = normalize(abs(det) * normal - g); }`);
  };
  m.customProgramCacheKey = () => 'blood-decal-v1';
  return m;
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _s = new THREE.Vector3();
const groundNormal = (ground, x, z, out) => { const e = 0.25; return out.set(ground(x - e, z) - ground(x + e, z), 2 * e, ground(x, z - e) - ground(x, z + e)).normalize(); };

class Blood {
  constructor(scene, q) {
    this.scene = scene;
    const low = q.particles < 0.7;
    // ---- droplets in flight
    this.maxDrops = low ? 260 : 700; this.drops = [];
    const qg = new THREE.PlaneGeometry(1, 1), ig = new THREE.InstancedBufferGeometry(); ig.index = qg.index; ig.attributes.position = qg.attributes.position;
    this.dP = new Float32Array(this.maxDrops * 3); this.dV = new Float32Array(this.maxDrops * 3); this.dS = new Float32Array(this.maxDrops * 2);
    this.aP = new THREE.InstancedBufferAttribute(this.dP, 3); this.aV = new THREE.InstancedBufferAttribute(this.dV, 3); this.aS = new THREE.InstancedBufferAttribute(this.dS, 2);
    for (const a of [this.aP, this.aV, this.aS]) a.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('iP', this.aP); ig.setAttribute('iV', this.aV); ig.setAttribute('iS', this.aS); ig.instanceCount = 0;
    this.dropMat = new THREE.ShaderMaterial({
      uniforms: { fogColor: { value: new THREE.Color() }, fogDensity: { value: 0.01 } },
      vertexShader: `attribute vec3 iP; attribute vec3 iV; attribute vec2 iS; varying vec2 vUv; varying float vA; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iP, 1.0); vec3 vv = (modelViewMatrix * vec4(iV, 0.0)).xyz;
          vec2 d = vv.xy; float L = length(d); d = L > 1e-4 ? d / L : vec2(0.0, 1.0); vec2 n = vec2(-d.y, d.x);
          float len = iS.x * 2.0 + L * 0.022;                       // streaked along the way it is moving (a 1/45 s exposure)
          mv.xy += d * position.y * len + n * position.x * iS.x * 2.0;
          vUv = position.xy * 2.0; vA = iS.y; vFog = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 fogColor; uniform float fogDensity; varying vec2 vUv; varying float vA; varying float vFog;
        void main(){
          float r = length(vec2(vUv.x, vUv.y * 0.9)); float a = smoothstep(1.0, 0.55, r) * vA; if (a < 0.02) discard;
          vec3 c = mix(vec3(0.035, 0.034, 0.037), vec3(0.006, 0.006, 0.007), smoothstep(0.0, 0.9, r));
          c += vec3(0.3, 0.3, 0.32) * smoothstep(0.35, 0.0, length(vUv - vec2(-0.3, 0.35))) * 0.6;   // the glint of a wet bead
          float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog); gl_FragColor = vec4(mix(c, fogColor, f), a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.dropMesh = new THREE.Mesh(ig, this.dropMat); this.dropMesh.frustumCulled = false; this.dropMesh.renderOrder = 2; scene.add(this.dropMesh);
    this.dropGeo = ig;
    // ---- splats
    this.mat = bloodMaterial();
    this.maxSplats = low ? 160 : 480; this.splatI = 0;
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.sD = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSplats * 4), 4); this.sD2 = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSplats * 4), 4);
    sg.setAttribute('aD', this.sD); sg.setAttribute('aD2', this.sD2);
    this.splats = new THREE.InstancedMesh(sg, this.mat, this.maxSplats); this.splats.count = 0; this.splats.frustumCulled = false; this.splats.renderOrder = 1; this.splats.receiveShadow = true;
    this.splats.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(this.splats);
    // ---- pools: each a little grid draped over the ground
    this.maxPools = low ? 14 : 40; this.pools = [];
  }
  setFog(fog) { this.dropMat.uniforms.fogColor.value.copy(fog.color); this.dropMat.uniforms.fogDensity.value = fog.density; }
  drop(x, y, z, vx, vy, vz, r, ground) {
    if (this.drops.length >= this.maxDrops) this.drops.shift();
    this.drops.push({ x, y, z, vx, vy, vz, r, ground, t: 0 });
  }
  splat(x, z, ground, size, dirX = 1, dirZ = 0, el = 0) {
    if (!ground) return;
    const i = this.splatI; this.splatI = (this.splatI + 1) % this.maxSplats; this.splats.count = Math.max(this.splats.count, i + 1);
    const y = ground(x, z); groundNormal(ground, x, z, _n);
    _q.setFromUnitVectors(_up, _n); _q2.setFromAxisAngle(_up, Math.atan2(-dirZ, dirX)); _q.multiply(_q2);
    _s.set(size * (1 + el * 1.4), 1, size); _m.compose(_v.set(x, y + 0.012, z).addScaledVector(_n, 0.006), _q, _s);
    this.splats.setMatrixAt(i, _m); this.splats.instanceMatrix.needsUpdate = true;
    this.sD.setXYZW(i, Math.random() * 100, el, BLOOD_T.value, 0); this.sD2.setXYZW(i, 70 + Math.random() * 40, 0, 0, 0);
    this.sD.needsUpdate = true; this.sD2.needsUpdate = true;
  }
  pool(x, z, ground, r = 0.6, spread = 4, delay = 0, life = 90) {
    if (!ground) return;
    if (this.pools.length >= this.maxPools) { const o = this.pools.shift(); this.scene.remove(o); o.geometry.dispose(); }
    const N = 10, g = new THREE.PlaneGeometry(2 * r, 2 * r, N, N); g.rotateX(-Math.PI / 2);
    const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const px = x + P.getX(i), pz = z + P.getZ(i); P.setY(i, ground(px, pz) + 0.014); P.setX(i, px); P.setZ(i, pz); }
    g.computeVertexNormals();
    const seed = Math.random() * 100, born = BLOOD_T.value + delay, n = P.count;
    const d = new Float32Array(n * 4), d2 = new Float32Array(n * 4); for (let i = 0; i < n; i++) { d.set([seed, 0, born, 1], i * 4); d2.set([life, spread, 0, 0], i * 4); }
    g.setAttribute('aD', new THREE.BufferAttribute(d, 4)); g.setAttribute('aD2', new THREE.BufferAttribute(d2, 4));
    const m = new THREE.Mesh(g, this.mat); m.renderOrder = 1; m.receiveShadow = true; m.userData.end = born + life + 14; this.scene.add(m); this.pools.push(m);
  }
  update(dt) {
    BLOOD_T.value += dt;
    // pools that have soaked away
    for (let i = this.pools.length - 1; i >= 0; i--) if (BLOOD_T.value > this.pools[i].userData.end) { const o = this.pools[i]; this.scene.remove(o); o.geometry.dispose(); this.pools.splice(i, 1); }
    // droplets: fall, and where they meet the ground, spatter
    let n = 0; const D = this.drops;
    for (let i = 0; i < D.length; i++) {
      const d = D[i]; d.t += dt;
      const dr = Math.exp(-0.35 * dt); d.vx *= dr; d.vz *= dr; d.vy = d.vy * dr - 9.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const gy = d.ground ? d.ground(d.x, d.z) : -1e9;
      if (d.y <= gy + 0.01 || d.t > 3) {
        if (d.y <= gy + 0.02 && d.ground && (d.r > 0.012 || Math.random() < 0.45)) {
          const vh = Math.hypot(d.vx, d.vz), el = Math.min(1.6, vh / Math.max(1, -d.vy) * 0.9);
          this.splat(d.x, d.z, d.ground, d.r * (5 + Math.min(6, -d.vy * 0.6)), d.vx / (vh || 1), d.vz / (vh || 1), el);
        }
        continue;
      }
      D[n++] = d;
    }
    D.length = n;
    for (let i = 0; i < n; i++) { const d = D[i]; this.dP.set([d.x, d.y, d.z], i * 3); this.dV.set([d.vx, d.vy, d.vz], i * 3); this.dS[i * 2] = d.r; this.dS[i * 2 + 1] = 0.95; }
    this.dropGeo.instanceCount = n; this.aP.needsUpdate = true; this.aV.needsUpdate = true; this.aS.needsUpdate = true;
  }
}

// blood on a knight's weapon: the edge darkens with every kill, then rain and time wash it off
export function bloodyWeapon(k, add = 0.1) {
  if (!k || !k.weapon) return;
  let B = k._blood;
  if (!B || B.w !== k.weapon) {
    B = k._blood = { w: k.weapon, u: { uBlood: { value: 0 }, uBloodT: { value: BLOOD_T.value } }, level: 0, t: BLOOD_T.value };
    k.weapon.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.metalness < 0.5) return;
      const m = o.material.clone(); o.material = m;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uBlood = B.u.uBlood; sh.uniforms.uBloodT = B.u.uBloodT; sh.uniforms.uBT = BLOOD_T; sh.uniforms.uBRain = WX.uRain;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          uniform float uBlood, uBloodT, uBT, uBRain; varying vec3 vBP;
          float wbH(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float wbN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(wbH(i), wbH(i + vec3(1,0,0)), f.x), mix(wbH(i + vec3(0,1,0)), wbH(i + vec3(1,1,0)), f.x), f.y), mix(mix(wbH(i + vec3(0,0,1)), wbH(i + vec3(1,0,1)), f.x), mix(wbH(i + vec3(0,1,1)), wbH(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          // how much is left: washed by rain and by time since the last kill
          float wbL = uBlood * exp(-(uBT - uBloodT) * (0.006 + uBRain * 0.05));
          // it gathers toward the business end, runs down in streaks, and lies thicker in the hollows
          float wbn = wbN(vBP * vec3(90.0, 7.0, 90.0)) * 0.55 + wbN(vBP * 220.0) * 0.45;
          float wbm = smoothstep(0.86 - wbL * 0.38, 0.9 - wbL * 0.3, wbn) * smoothstep(0.0, 0.25, wbL);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.008, 0.009), wbm);
          roughnessFactor = mix(roughnessFactor, 0.3, wbm);
          metalnessFactor = mix(metalnessFactor, 0.0, wbm);`);
      };
      m.customProgramCacheKey = () => 'bloody-weapon-' + o.material.uuid;
    });
  }
  // bank what is left, then add the new blood
  const left = B.u.uBlood.value * Math.exp(-(BLOOD_T.value - B.u.uBloodT.value) * (0.006 + WX.uRain.value * 0.05));
  B.u.uBlood.value = Math.min(1, left + add); B.u.uBloodT.value = BLOOD_T.value;
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
    this.gore = new Blood(scene, quality);
  }
  setFog(fog) { for (const p of [this.smoke, this.glow]) { p.mat.uniforms.fogColor.value.copy(fog.color); p.mat.uniforms.fogDensity.value = fog.density; } this.gore.setFog(fog); }
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
  // blood thrown off a wound: an arterial spray along the line of the blade and out of the wound, droplets that
  // streak, fall and spatter where they land; a mist; flecks of flesh. kind: 'cut' | 'pierce' | 'blunt'
  blood(pos, cut, out, amount = 1, ground = null, kind = 'cut') {
    const cx = cut?.x || 0, cy = cut?.y || 0, cz = cut?.z || 0, ox = out?.x || 0, oy = out?.y || 0, oz = out?.z || 0;
    const G = this.gore, mul = this.q.particles < 0.7 ? 0.55 : 1;
    // the spray: a cut throws it along the blade, a thrust jets it back out of the wound, a blow bursts it round
    const along = kind === 'pierce' ? 0.6 : kind === 'blunt' ? 0.4 : 1, outw = kind === 'pierce' ? 1.6 : kind === 'blunt' ? 1.1 : 0.8;
    const n = Math.round((26 + 30 * amount) * mul);
    for (let i = 0; i < n; i++) {
      const sA = (2 + R() * 6.5) * along, sO = (0.8 + R() * 3) * outw, j = kind === 'blunt' ? 2.6 : 1.1;
      const r = R() < 0.12 ? 0.012 + R() * 0.016 : 0.004 + R() * 0.008;
      G.drop(pos.x + (R() - 0.5) * 0.08, pos.y + (R() - 0.5) * 0.08, pos.z + (R() - 0.5) * 0.08,
        cx * sA + ox * sO + (R() - 0.5) * j, cy * sA + oy * sO + 0.6 + R() * 2.4, cz * sA + oz * sO + (R() - 0.5) * j, r, ground);
    }
    // gouts: a few heavy ropes of it, slower, falling close
    for (let i = 0; i < Math.round((2 + 3 * amount) * mul); i++) G.drop(pos.x, pos.y, pos.z, ox * (1 + R() * 1.5) + cx * R() * 2, 0.3 + R() * 1.5, oz * (1 + R() * 1.5) + cz * R() * 2, 0.018 + R() * 0.014, ground);
    // a fine red mist where the blade went through
    for (let i = 0; i < 5 * amount * mul; i++) this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: cx * 1.4 + (R() - 0.5) * 0.8, vy: R() * 0.5, vz: cz * 1.4 + (R() - 0.5) * 0.8, color: [0.02, 0.02, 0.022], a: 0.28, size: 0.18 + R() * 0.25, grow: 1.1, life: 0.5 + R() * 0.5, drag: 3.5, cell: 0 });
    // flecks of flesh
    for (let i = 0; i < 4 * amount * mul; i++) this.smoke.emit({ x: pos.x, y: pos.y, z: pos.z, vx: cx * 3 + ox * 2 + (R() - 0.5) * 2, vy: 1.5 + R() * 2.5, vz: cz * 3 + oz * 2 + (R() - 0.5) * 2, color: [0.07, 0.025, 0.025], a: 1, size: 0.045 + R() * 0.035, life: 0.8 + R() * 0.3, drag: 0.4, grav: -11, cell: 2, spin: 6, fadeIn: 0.01 });
    // what runs straight down the body to its feet
    if (ground) for (let k = 0; k < Math.ceil(amount); k++) { const x = pos.x + (R() - 0.5) * 0.4, z = pos.z + (R() - 0.5) * 0.4; G.splat(x, z, ground, 0.12 + R() * 0.15, R() - 0.5, R() - 0.5, R() * 0.4); }
  }
  // a pool spreading under one that has fallen
  corpsePool(pos, ground, size = 1) { this.gore.pool(pos.x, pos.z, ground, 0.55 + 0.45 * size, 3 + 3 * size, 0.35, 80 + R() * 30); }
  // a dark wet stain on the ground (older callers): now a small pool draped on the ground
  bloodPool(x, y, z, r = 0.3, delay = 0, ground = null) {
    const gr = ground || (() => y);
    if (r < 0.28) this.gore.splat(x, z, gr, r * 2.2, R() - 0.5, R() - 0.5, R() * 0.5);
    else this.gore.pool(x, z, gr, r * 1.3, 1.2, delay, 50 + R() * 20);
  }
  // a severed part: thrown off, tumbling, bleeding from the stump, coming to rest on the ground
  gib(mesh, vel, spin, ground, bleed = 1.6) {
    this.scene.add(mesh); (this.gibs || (this.gibs = [])).push({ m: mesh, v: vel.clone(), w: spin.clone(), ground, t: 0, bleed, rest: false });
    if (this.gibs.length > 24) { const g = this.gibs.shift(); this.scene.remove(g.m); }
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
    this.gore.update(dt);
    if (this.gibs) for (let i = this.gibs.length - 1; i >= 0; i--) {
      const G = this.gibs[i], m = G.m; G.t += dt;
      if (!G.rest) {
        G.v.y -= 9.8 * dt; m.position.addScaledVector(G.v, dt);
        m.rotation.x += G.w.x * dt; m.rotation.y += G.w.y * dt; m.rotation.z += G.w.z * dt;
        const gy = G.ground ? G.ground(m.position.x, m.position.z) + 0.05 : 0.05;
        if (m.position.y < gy) { m.position.y = gy; if (Math.abs(G.v.y) > 1.5) { G.v.y *= -0.25; G.v.x *= 0.5; G.v.z *= 0.5; G.w.multiplyScalar(0.5); this.bloodPool(m.position.x, gy, m.position.z, 0.2 + R() * 0.2, 0, G.ground); } else { G.rest = true; m.userData.settle?.(G.ground); this.bloodPool(m.position.x, gy, m.position.z, 0.35 + R() * 0.25, 0.3, G.ground); } }
      }
      // the stump bleeds for a while
      if (G.t < G.bleed && R() < dt * 40) this.gore.drop(m.position.x, m.position.y, m.position.z, (R() - 0.5) * 0.8, 0.4 + R(), (R() - 0.5) * 0.8, 0.005 + R() * 0.008, G.ground);
      if (G.t > 18) { const k = clamp((G.t - 18) / 3, 0, 1); m.position.y -= dt * 0.08; if (k >= 1) { this.scene.remove(m); this.gibs.splice(i, 1); } }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const m = this.beams[i]; m.userData.t += dt; const t = m.userData.t / m.userData.dur;
      m.material.uniforms.time.value += dt;
      m.material.uniforms.a.value = Math.min(1, t * 6) * (1 - smoothT(clamp((t - 0.6) / 0.4, 0, 1)));
      if (t >= 1) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.beams.splice(i, 1); }
    }
  }
}
