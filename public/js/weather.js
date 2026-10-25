// Weather. Each chapter has its own sky that changes over minutes: clear, overcast, rain, a downpour (out in the
// country), or snow (high on the Ascent, and always on the Peak). Rain falls as streaks round the camera, splashes
// where it lands and rings the puddles; the ground darkens, turns glossy and collects water in its hollows, and dries
// again after; the rest of the world (stone, timber, rock) goes wet with it. Snow drifts down and settles. The fen's
// water is a living surface: a wave simulation on the GPU, rung by rain and pushed into wakes and ripples by
// everything that wades through it, which slows a knight down.
//
// Everything that falls is drawn in shaders (one instanced draw for rain or snow, one for the splashes); the only
// per-frame CPU work is a handful of uniforms and the wading check. Weather is each player's own (like the Dread).
import * as THREE from 'three';

// shared with the terrain and water shaders (world.js reads these when it builds them)
export const WX = {
  uWet: { value: 0 },        // how wet the ground is, 0..1 (lags the rain: wets in a minute, dries over several)
  uRain: { value: 0 },       // how hard it is raining now, 0..1 (ripples, splashes)
  uSnowAcc: { value: 0 },    // fresh snow settling on the flats
  uWTime: { value: 0 },
};
// the fen's wave field: a window of the water round the player
export const WATER_U = {
  uSim: { value: null }, uSimWin: { value: new THREE.Vector4(0, 0, 64, 0) },   // centre x, z, size, on (w)
  uSimTexel: { value: 1 / 256 },
  uWRain: WX.uRain, uWWTime: WX.uWTime,
};

const R = Math.random;
// per chapter: chance of each state, and whether its precipitation is snow
const CLIMATE = {
  vale: { rain: 0.35, heavy: 0.12 }, village: { rain: 0.35, heavy: 0.15 }, fen: { rain: 0.5, heavy: 0.2 },
  wood: { rain: 0.4, heavy: 0.15 }, field: { rain: 0.4, heavy: 0.2 },
  ascent: { snow: true, rain: 0.55, heavy: 0.2, byHeight: true }, peak: { snow: true, rain: 1, heavy: 0.45, always: true },
};

// ---------------------------------------------------------------- the falling streaks/flakes
export function precipitation(max) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(max * 4); for (let i = 0; i < max; i++) { seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = i / max; }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = max;
  const U = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uSnow: { value: 0 }, uWind: { value: new THREE.Vector2() },
    uHeight: { value: null }, uHalf: { value: 150 }, uN: { value: 257 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform vec3 uCam; uniform float uTime, uAmt, uSnow, uHalf, uN; uniform vec2 uWind; uniform sampler2D uHeight;
      attribute vec4 aSeed; varying vec2 vUv; varying float vA;
      float hAt(vec2 p){ vec2 f = clamp((p + uHalf) / (2.0 * uHalf) * (uN - 1.0), 0.0, uN - 1.001); vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uN).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uN).r, c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uN).r, d = texture2D(uHeight, (i + 1.5) / uN).r;
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }
      void main(){
        vUv = uv; vA = 0.0;
        if (aSeed.w > uAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float B = mix(34.0, 26.0, uSnow), H = mix(22.0, 16.0, uSnow);
        float speed = mix(15.0 + aSeed.y * 6.0, 1.1 + aSeed.y * 0.9, uSnow);
        float fall = mod(aSeed.y * H + uTime * speed, H);
        vec2 xz = uCam.xz + mod(vec2(aSeed.x, aSeed.z) * B - uCam.xz + B * 0.5, B) - B * 0.5;
        float drop = H * 0.55 - fall;
        vec3 wp = vec3(xz.x, uCam.y + drop, xz.y);
        wp.xz += uWind * (drop / speed) * mix(1.0, 3.0, uSnow);
        wp.x += uSnow * sin(uTime * 0.9 + aSeed.x * 40.0) * 0.6; wp.z += uSnow * cos(uTime * 0.7 + aSeed.z * 40.0) * 0.6;
        float ground = hAt(wp.xz);
        if (wp.y < ground) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 wv = uWind * mix(1.0, 0.2, uSnow); vec3 vel = normalize(vec3(wv.x, -speed, wv.y));   // falling (y), blown sideways by the wind (x, z)
        vec3 toCam = normalize(cameraPosition - wp);
        vec3 side = normalize(cross(vel, toCam));
        float len = mix(0.55 + speed * 0.025, 0.06, uSnow), wid = mix(0.02, 0.06, uSnow);
        vec3 p = wp + side * (position.x * wid) - vel * (position.y * len) * (1.0 - uSnow) + vec3(0.0, position.y * len, 0.0) * uSnow;
        float d = length(cameraPosition - wp);
        vA = (1.0 - smoothstep(B * 0.35, B * 0.5, d)) * smoothstep(0.9, 2.6, d);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uSnow; uniform vec3 uLight; varying vec2 vUv; varying float vA;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;
        float a = uSnow > 0.5 ? (1.0 - smoothstep(0.3, 1.0, length(vUv - 0.5) * 2.0)) * 0.85 : (1.0 - x) * 0.42 * smoothstep(0.0, 0.3, vUv.y);
        vec3 c = mix(vec3(0.75, 0.79, 0.86), vec3(0.92, 0.94, 0.98), uSnow) * uLight;
        gl_FragColor = vec4(c, a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, U, max };
}
// splashes: little crowns of water thrown up where drops land, round the camera
export function splashes(max) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(max * 4); for (let i = 0; i < max; i++) { seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = i / max; }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = max;
  const U = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uHeight: { value: null }, uHalf: { value: 150 }, uN: { value: 257 }, uWaterY: { value: -9999 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    vertexShader: `
      uniform vec3 uCam; uniform float uTime, uAmt, uHalf, uN, uWaterY; uniform sampler2D uHeight;
      attribute vec4 aSeed; varying vec2 vUv; varying float vT, vA;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hAt(vec2 p){ vec2 f = clamp((p + uHalf) / (2.0 * uHalf) * (uN - 1.0), 0.0, uN - 1.001); vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uN).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uN).r, c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uN).r, d = texture2D(uHeight, (i + 1.5) / uN).r;
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }
      void main(){
        vUv = uv; vA = 0.0; vT = 0.0;
        // each instance owns a fixed patch of ground in the world (a 16 x 16 grid of cells round the camera, wrapping, so
        // a cell keeps the same instance as you move): every drop lands somewhere new in that patch and stays put there
        const float C = 1.4; float id = floor(aSeed.w * 256.0 + 0.5); vec2 ij = vec2(mod(id, 16.0), floor(id / 16.0));
        vec2 base = floor(uCam.xz / C) - 8.0; vec2 cell = base + mod(ij - base, 16.0);
        float rate = 2.2 + hh(cell * 0.37) * 1.5, cyc = uTime * rate + hh(cell + 3.1) * 7.0, n = floor(cyc); float t = fract(cyc); vT = t;
        if (hh(cell * 1.7 + n) > uAmt * 0.95 + 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec2 xz = (cell + vec2(hh(cell + n * 0.71), hh(cell.yx + n * 1.37))) * C;
        float gy = hAt(xz); if (uWaterY > gy) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // on water a drop makes a ring, not a crown
        float y = gy;
        float s = 0.05 + t * 0.12;
        vec3 toCam = normalize(vec3(cameraPosition.x - xz.x, 0.0, cameraPosition.z - xz.y)); vec3 side = vec3(toCam.z, 0.0, -toCam.x);
        vec3 p = vec3(xz.x, y, xz.y) + side * position.x * s * 1.6 + vec3(0.0, position.y * s * (1.0 - t * 0.4), 0.0);
        vA = 1.0 - smoothstep(6.0, 11.0, length(cameraPosition.xz - xz));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uLight; varying vec2 vUv; varying float vT, vA;
      void main(){
        vec2 q = vUv - vec2(0.5, 0.0); float r = length(q * vec2(1.0, 1.6));
        float crown = smoothstep(0.5, 0.35, r) * smoothstep(0.1, 0.3, r + vUv.y * 0.4) ;
        float a = crown * (1.0 - vT) * 0.55 * vA;
        gl_FragColor = vec4(vec3(0.7, 0.74, 0.8) * uLight, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, U };
}

// ---------------------------------------------------------------- water: a wave field round the player
// A small height field (24 m across, ~9 cm a texel; 19 cm on low quality) that follows the player in whole
// texels. It is stepped at a fixed 60 Hz with a slow, well-damped wave equation, so a ring from a footstep runs
// out at about a metre a second and has gone in a second or so; a body moving faster than that pulls a V behind it.
// Everything that wades presses into it; the water's shaders read its slope for their normals.
const SIM_HZ = 60;
export class WaterSim {
  constructor(renderer, low) {
    this.renderer = renderer; this.N = low ? 128 : 256; this.size = 24; this.ok = true; this.acc = 0;
    const texel = this.size / this.N, speed = 1.1;                     // ring speed, m/s
    const c = Math.min(0.6, speed / (texel * SIM_HZ));                 // texels per step
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(this.N, this.N, opts), new THREE.WebGLRenderTarget(this.N, this.N, opts)]; this.i = 0;
    this.drops = Array.from({ length: 32 }, () => new THREE.Vector4(0, 0, 0, 0));
    this.U = { uPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uTexel: { value: 1 / this.N }, uDrops: { value: this.drops }, uC2: { value: c * c }, uDamp: { value: 0.98 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D uPrev; uniform vec2 uShift; uniform float uTexel, uC2, uDamp; uniform vec4 uDrops[32]; varying vec2 vUv;
        vec2 S(vec2 uv){ return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec2(0.0) : texture2D(uPrev, uv).rg; }
        void main(){
          vec2 uv = vUv + uShift; vec2 cp = S(uv); float c = cp.x, prev = cp.y;
          float n = S(uv + vec2(uTexel, 0.0)).x + S(uv - vec2(uTexel, 0.0)).x + S(uv + vec2(0.0, uTexel)).x + S(uv - vec2(0.0, uTexel)).x;
          float h = (2.0 * c - prev + uC2 * (n - 4.0 * c)) * uDamp;
          h = mix(h, n * 0.25, 0.02);                                      // a touch of viscosity: no grid shimmer
          for (int i = 0; i < 32; i++) { vec4 d = uDrops[i]; if (d.w == 0.0) continue; float r = length(vUv - d.xy) / d.z; h -= d.w * exp(-r * r); }
          float edge = smoothstep(0.0, 0.08, min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y)));
          gl_FragColor = vec4(clamp(h * edge, -1.0, 1.0), c, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); quad.frustumCulled = false; this.scene.add(quad);
    this.cx = 0; this.cz = 0; this.nd = 0;
    WATER_U.uSimTexel.value = 1 / this.N;
  }
  // press the water down at (x, z): radius in metres, strength ~0.02 (a wading leg, each step) .. 0.3 (a fall)
  drop(x, z, radius, strength) {
    if (this.nd >= 32) return;
    const u = (x - this.cx) / this.size + 0.5, v = (z - this.cz) / this.size + 0.5;
    if (u < 0.02 || v < 0.02 || u > 0.98 || v > 0.98) return;
    this.drops[this.nd++].set(u, v, Math.max(radius, 1.5 * this.size / this.N) / this.size, strength);
  }
  step(dt, center) {
    const t = this.size / this.N;
    const nx = Math.round(center.x / t) * t, nz = Math.round(center.z / t) * t;
    let sx = (nx - this.cx) / this.size, sz = (nz - this.cz) / this.size; this.cx = nx; this.cz = nz;
    if (Math.abs(sx) > 0.5 || Math.abs(sz) > 0.5) sx = sz = 0;            // teleported: the old field is meaningless anyway
    this.acc = Math.min(this.acc + dt, 4 / SIM_HZ);
    let steps = Math.floor(this.acc * SIM_HZ); this.acc -= steps / SIM_HZ;
    if (!steps && (sx || sz)) steps = 1;                                   // keep the field under the window when it moves
    const r = this.renderer, prevT = r.getRenderTarget();
    for (let k = 0; k < steps; k++) {
      this.U.uPrev.value = this.rt[this.i].texture; this.U.uShift.value.set(k ? 0 : sx, k ? 0 : sz);
      if (k === 1) for (const d of this.drops) d.w = 0;
      r.setRenderTarget(this.rt[1 - this.i]); r.render(this.scene, this.cam); this.i = 1 - this.i;
    }
    r.setRenderTarget(prevT);
    if (steps) { for (const d of this.drops) d.w = 0; this.nd = 0; }
    WATER_U.uSim.value = this.rt[this.i].texture; WATER_U.uSimWin.value.set(this.cx, this.cz, this.size, 1);
  }
  dispose() { for (const t of this.rt) t.dispose(); this.mat.dispose(); WATER_U.uSimWin.value.w = 0; WATER_U.uSim.value = null; }
}

// What every water surface's shader shares (the fen, the cave's pools): declarations, rain rings, and the normal.
// Use: put WATER_GLSL after #include <common>; then `nn = waterNormal(nn, vW, uRainOn);` with nn a tangent-space
// normal (z up) and vW the world xz. Needs WATER_U in the uniforms and a float uRainOn (0 under a roof).
export const WATER_GLSL = `
  uniform sampler2D uSim; uniform vec4 uSimWin; uniform float uSimTexel, uWRain, uWWTime;
  float wrh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // rain rings: each cell (p in cells) gets a drop now and then; a few small rings run out from it and die fast
  vec2 wRings(vec2 p, float t, float amt){
    vec2 g = vec2(0.0); vec2 c0 = floor(p - 0.5);
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec2 c = c0 + vec2(float(i), float(j)); float r0 = wrh(c);
      float ph = t * (1.1 + r0 * 0.9) + r0 * 7.0, n = floor(ph), f = fract(ph);
      if (wrh(c + n * 0.37) > amt) continue;
      vec2 ctr = c + 0.15 + 0.7 * vec2(wrh(c + n * 1.7), wrh(c + n * 3.1 + 5.0));
      vec2 d = p - ctr; float L = length(d) + 1e-4, R = sqrt(f) * 0.48;
      float q = (L - R) * 9.0; float w = sin((L - R) * 30.0) * exp(-q * q) * (1.0 - f) * (1.0 - f);
      g += d / L * w;
    }
    return g;
  }
  vec3 waterNormal(vec3 nn, vec2 w, float rainOn){
    if (uSimWin.w > 0.5) {
      vec2 suv = (w - uSimWin.xy) / uSimWin.z + 0.5;
      if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) {
        float e = uSimTexel;
        float hx = texture2D(uSim, suv + vec2(e, 0.0)).r - texture2D(uSim, suv - vec2(e, 0.0)).r;
        float hz = texture2D(uSim, suv + vec2(0.0, e)).r - texture2D(uSim, suv - vec2(0.0, e)).r;
        float fade = smoothstep(0.0, 0.12, min(min(suv.x, suv.y), min(1.0 - suv.x, 1.0 - suv.y)));
        vec2 sg = vec2(-hx, hz) * 7.0 * fade;    // tangent y is world -z
        nn.xy += sg / (1.0 + length(sg) * 1.6);  // soft limit: the water never tips past ~30 degrees
      }
    }
    float ra = uWRain * rainOn;
    if (ra > 0.01) {                                                     // two sizes of cell, 40 and 28 cm (rings out to ~18 cm)
      vec2 p1 = w * 2.5, p2 = w * 3.6 + 3.3;
      float far = 1.0 - smoothstep(0.08, 0.3, length(fwidth(p1)));      // past where a ring is a pixel, let them go (no glitter)
      vec2 g = wRings(p1, uWWTime, ra * 0.95) + wRings(p2, uWWTime * 1.13 + 2.0, ra * 0.8) * 0.7;
      nn.xy += vec2(-g.x, g.y) * 0.16 * far;
    }
    return normalize(nn);
  }`;

// ---------------------------------------------------------------- the wet look for everything else
const WET_MATS = new WeakSet();
export function wetten(m) {
  if (!m || WET_MATS.has(m) || !m.isMeshStandardMaterial || m.transparent || m.userData.noWet) return;
  WET_MATS.add(m);
  const prev = m.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : null;
  const prevSrc = prev ? prev.toString() : '', prevKey = () => (own ? own() : prevSrc);
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    if (sh.fragmentShader.includes('uWxWet') || sh.fragmentShader.includes('wxRipples')) return;   // already has its own wet ground (the terrain and its kin)
    sh.uniforms.uWxWet = WX.uWet;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWxWet;')
      .replace('#include <lights_physical_fragment>', `
        { vec3 wn = inverseTransformDirection(normal, viewMatrix); float up = 0.45 + 0.55 * clamp(wn.y, 0.0, 1.0);
          float wk = uWxWet * up; diffuseColor.rgb *= 1.0 - 0.38 * wk; roughnessFactor = mix(roughnessFactor, 0.22, wk * 0.85); }
        #include <lights_physical_fragment>`);
  };
  m.customProgramCacheKey = () => prevKey() + '|wet';
  m.needsUpdate = true;
}

// ---------------------------------------------------------------- the system
export class Weather {
  constructor(game) {
    this.g = game; const W = this.W = game.world, ch = W.ch;
    this.cl = CLIMATE[ch.id] || { rain: 0 };
    this.state = 'clear'; this.target = { rain: 0, cover: 0, dark: 0 }; this.cur = { rain: 0, cover: 0, dark: 0 }; this.next = 0;
    this.pick(true);
    // the heightfield as a texture, so the shaders can find the ground
    const H = W.H, N = Math.round(Math.sqrt(H.length));
    this.htex = new THREE.DataTexture(H, N, N, THREE.RedFormat, THREE.FloatType); this.htex.needsUpdate = true;
    this.fall = precipitation(game.engine.q?.post === false ? 3500 : 7000); this.fall.U.uHeight.value = this.htex; this.fall.U.uN.value = N; this.fall.U.uSnow.value = this.cl.snow ? 1 : 0;
    this.spl = splashes(256); this.spl.U.uHeight.value = this.htex; this.spl.U.uN.value = N;
    if (W.waterLevel > -100 && W.water) this.spl.U.uWaterY.value = W.waterLevel;
    game.scene.add(this.fall.mesh); game.scene.add(this.spl.mesh);
    WX.uWet.value = 0; WX.uRain.value = 0; WX.uSnowAcc.value = 0;
    // everything in the land goes wet with it (the terrain and water have their own)
    W.group.traverse((o) => { if (o.isMesh && o !== W.terrain && o !== W.water && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(wetten); });
    // the fen: a wave field under the water
    this.pools = (game.cave?.pools || []).filter((P) => !P.mud);
    this.hasWater = !!(W.water && ch.terrain.water !== undefined) || this.pools.length > 0;
    if (this.hasWater) { try { this.sim = new WaterSim(game.engine.renderer, game.engine.q?.post === false); } catch (e) { this.sim = null; } }
    this.last = new Map(); this.walked = new Map();
  }
  // choose the next weather: how long it holds, and what it is
  pick(first) {
    const cl = this.cl, r = R();
    let s = 'clear';
    if (cl.always) s = r < cl.heavy ? 'heavy' : 'rain';
    else if (r < cl.heavy) s = 'heavy'; else if (r < cl.rain) s = 'rain'; else if (r < cl.rain + 0.25) s = 'overcast';
    if (first && !cl.always && R() < 0.5) s = 'clear';
    this.state = s;
    this.target = { clear: { rain: 0, cover: 0, dark: 0 }, overcast: { rain: 0, cover: 0.25, dark: 0.08 }, rain: { rain: 0.5, cover: 0.35, dark: 0.16 }, heavy: { rain: 1, cover: 0.5, dark: 0.26 } }[s];
    this.next = (first ? 60 : 90) + R() * 150;
  }
  update(dt, time) {
    const g = this.g, W = this.W, e = g.engine, cam = e.camera.position;
    this.next -= dt; if (this.next <= 0) this.pick(false);
    // ease toward it (a front comes in over half a minute)
    for (const k of ['rain', 'cover', 'dark']) this.cur[k] += (this.target[k] - this.cur[k]) * Math.min(1, dt / 25);
    let rain = this.cur.rain;
    // on the Ascent the snow comes with height: down in the valley it falls as rain
    let snow = this.cl.snow ? 1 : 0;
    if (this.cl.byHeight) { const k = Math.min(1, Math.max(0, (cam.y - 30) / 40)); snow = k; }
    // under the mountain, no sky
    const under = g.cave?.inCam || 0; rain *= 1 - under;
    const isSnow = snow > 0.5;
    WX.uWTime.value = time;
    WX.uRain.value = isSnow ? 0 : rain;
    // the ground wets in about a minute of rain and takes several to dry
    const wetT = isSnow ? 0 : Math.min(1, this.cur.rain * 1.4);
    WX.uWet.value += (wetT - WX.uWet.value) * Math.min(1, dt / (wetT > WX.uWet.value ? 40 : 160));
    if (isSnow) WX.uSnowAcc.value = Math.min(1, WX.uSnowAcc.value + dt * rain * 0.004); else WX.uSnowAcc.value = Math.max(0, WX.uSnowAcc.value - dt * 0.002);
    // the falling stuff
    const F = this.fall.U; F.uCam.value.copy(cam); F.uTime.value = time; F.uSnow.value = isSnow ? 1 : 0; F.uAmt.value = rain * (isSnow ? 0.7 : 1);
    const wind = g.world.ch.wind || [1, 0.3]; F.uWind.value.set(wind[0] * (0.6 + rain), wind[1] * (0.6 + rain));
    const lit = 0.35 + 0.65 * Math.min(1, e.hemi.intensity / 0.8); F.uLight.value.setScalar(lit); this.spl.U.uLight.value.setScalar(lit);
    this.fall.mesh.visible = F.uAmt.value > 0.002;
    const S = this.spl.U; S.uCam.value.copy(cam); S.uTime.value = time; S.uAmt.value = isSnow ? 0 : rain; this.spl.mesh.visible = !isSnow && rain > 0.02;
    // the sky closes in: more cloud, a little less light (tracked, so the chapter's own sky changes still come through)
    const u = e.sky.uniforms;
    if (this.coverSet === undefined || Math.abs(u.uCover.value - this.coverSet) > 1e-4) this.coverBase = u.uCover.value;
    this.coverSet = Math.min(0.98, this.coverBase + this.cur.cover * (1 - this.coverBase)); u.uCover.value = this.coverSet;
    const ex = e.renderer.toneMappingExposure;
    if (this.expSet === undefined || Math.abs(ex - this.expSet) > 1e-4) this.expBase = ex;
    this.expSet = this.expBase * (1 - this.cur.dark * (1 - under)); e.renderer.toneMappingExposure = this.expSet;
    // the sound of it
    this.sound(isSnow ? 0 : rain, dt);
    if (!isSnow && this.cur.rain > 0.8 && R() < dt / 40) g.audio.thunder?.(0.5 + R() * 0.4, 1 + R() * 4);
    // the fen
    if (this.hasWater) this.water(dt, time);
  }
  // how deep the water is over the ground at (x, z); below zero when dry
  waterDepth(x, z) {
    const W = this.W; let d = -1;
    if (W.water && W.waterLevel > -100) d = W.waterLevel - W.heightAt(x, z);
    for (const P of this.pools || []) if ((x - P.x) ** 2 + (z - P.z) ** 2 < P.r * P.r) d = Math.max(d, P.y - W.heightAt(x, z));
    return d;
  }
  surfaceY(x, z) { const d = this.waterDepth(x, z); return d > 0 ? this.W.heightAt(x, z) + d : null; }
  // a foot coming down in water: a ring, a few drops thrown up, the slosh of it
  footSplash(pos, depth, run = 0, gain = 1) {
    const y = this.W.heightAt(pos.x, pos.z) + depth;
    if (this.sim) this.sim.drop(pos.x + (R() - 0.5) * 0.25, pos.z + (R() - 0.5) * 0.25, 0.14, 0.05 + run * 0.05);
    const fx = this.g.fx, n = Math.round(2 + run * 6);
    for (let i = 0; i < n; i++) { const a = R() * 6.28, s = 0.4 + R() * (0.8 + run * 1.6);
      fx.smoke.emit({ x: pos.x, y: y + 0.03, z: pos.z, vx: Math.cos(a) * s, vy: 1.2 + R() * (1.2 + run * 2), vz: Math.sin(a) * s, color: [0.42, 0.46, 0.48], a: 0.7, size: 0.025 + R() * 0.03, life: 0.5 + R() * 0.3, drag: 0.6, grav: -10, cell: 2, spin: 4, fadeIn: 0.01 }); }
    const A = this.g.audio; if (!A.play?.('splash', pos, (0.35 + run * 0.3) * gain * Math.min(1.4, 0.6 + depth * 1.5), 0.08, 0.9 + R() * 0.2)) A.footstep?.(pos, true, 0.6);
  }
  water(dt, time) {
    const g = this.g;
    const bodies = [...g.knightList, ...g.horde.list.filter((d) => d.alive)];
    if (g.boss?.pos) bodies.push(g.boss);
    for (const b of bodies) {
      const depth = this.waterDepth(b.pos.x, b.pos.z), lp = this.last.get(b);
      if (depth < 0.04) { if (lp) lp.copy(b.pos); else this.last.set(b, b.pos.clone()); continue; }
      const dx = lp ? b.pos.x - lp.x : 0, dz = lp ? b.pos.z - lp.z : 0, step = Math.hypot(dx, dz), v = step / Math.max(dt, 1e-3);
      const isKnight = g.knightList.includes(b), big = b === g.boss ? 3 : 1;
      // the water drags at your legs
      if (lp && depth > 0.2 && isKnight && !b.downed) { const k = Math.min(0.4, depth * 0.55); b.pos.x -= dx * k; b.pos.z -= dz * k; }
      if (this.sim && v > 0.15 && v < 30) {
        // the legs push the water aside as they go: a small, steady press that the wave field turns into a V
        const r = (0.12 + Math.min(depth, 0.6) * 0.15) * big;
        this.sim.drop(b.pos.x, b.pos.z, r, Math.min(0.016, v * 0.004) * big);
        // and a foot comes down every stride (knights get theirs from their own footstep events)
        if (!isKnight) { const w = (this.walked.get(b) || 0) + step; if (w > 0.75 * big) { this.walked.set(b, 0); this.sim.drop(b.pos.x, b.pos.z, 0.14 * big, 0.06 * big); } else this.walked.set(b, w); }
        // spray from the shins when running through it
        if (v > 2.6 && R() < dt * v * 3) {
          const y = this.W.heightAt(b.pos.x, b.pos.z) + depth, f = 1 / (v || 1);
          for (let i = 0; i < 3; i++) g.fx.smoke.emit({ x: b.pos.x + dx * f * 0.3, y: y + 0.05, z: b.pos.z + dz * f * 0.3, vx: dx * f * 1.5 + (R() - 0.5) * 1.6, vy: 1 + R() * 1.8, vz: dz * f * 1.5 + (R() - 0.5) * 1.6, color: [0.42, 0.46, 0.48], a: 0.6, size: 0.02 + R() * 0.03, life: 0.45 + R() * 0.3, drag: 0.5, grav: -10, cell: 2, spin: 4, fadeIn: 0.01 });
        }
      }
      if (lp) lp.copy(b.pos); else this.last.set(b, b.pos.clone());
    }
    for (const b of this.last.keys()) if (!b.alive && !g.knightList.includes(b) && b !== g.boss) { this.last.delete(b); this.walked.delete(b); }
    if (this.sim) this.sim.step(dt, g.cam?.look && g.cinema?.active ? g.cam.look : g.me.pos);
  }
  sound(amt, dt) {
    const A = this.g.audio, ctx = A.ctx; if (!ctx || !A.amb) return;
    if (!this.snd) {
      const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); let b0 = 0, b1 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99 * b0 + w * 0.05; b1 = 0.9 * b1 + w * 0.3; d[i] = (b0 + b1 * 0.4 + w * 0.15) * 0.6; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const gn = ctx.createGain(); gn.gain.value = 0; src.connect(hp).connect(lp).connect(gn).connect(A.amb); src.start();
      this.snd = { src, gn };
    }
    this.snd.gn.gain.setTargetAtTime(amt * 0.55, ctx.currentTime, 0.8);
  }
  dispose() {
    this.fall.mesh.removeFromParent(); this.spl.mesh.removeFromParent(); this.fall.mesh.geometry.dispose(); this.spl.mesh.geometry.dispose(); this.htex.dispose();
    if (this.sim) this.sim.dispose();
    if (this.snd) { try { this.snd.src.stop(); } catch {} this.snd.gn.disconnect(); }
    const e = this.g.engine;
    if (this.expSet !== undefined && Math.abs(e.renderer.toneMappingExposure - this.expSet) < 1e-4) e.renderer.toneMappingExposure = this.expBase;
    if (this.coverSet !== undefined && Math.abs(e.sky.uniforms.uCover.value - this.coverSet) < 1e-4) e.sky.uniforms.uCover.value = this.coverBase;
    WX.uWet.value = 0; WX.uRain.value = 0; WX.uSnowAcc.value = 0;
  }
}
