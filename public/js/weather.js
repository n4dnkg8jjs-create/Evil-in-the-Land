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
};

const R = Math.random;
// per chapter: chance of each state, and whether its precipitation is snow
const CLIMATE = {
  vale: { rain: 0.35, heavy: 0.12 }, village: { rain: 0.35, heavy: 0.15 }, fen: { rain: 0.5, heavy: 0.2 },
  wood: { rain: 0.4, heavy: 0.15 }, field: { rain: 0.4, heavy: 0.2 },
  ascent: { snow: true, rain: 0.55, heavy: 0.2, byHeight: true }, peak: { snow: true, rain: 1, heavy: 0.45, always: true },
};

// ---------------------------------------------------------------- the falling streaks/flakes
function precipitation(max) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(max * 4); for (let i = 0; i < max; i++) { seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = i / max; }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = max;
  const U = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uSnow: { value: 0 }, uWind: { value: new THREE.Vector2() },
    uHeight: { value: null }, uHalf: { value: 150 }, uN: { value: 257 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
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
        vec3 wp = vec3(xz, uCam.y + drop);
        wp.xz += uWind * (drop / speed) * mix(1.0, 3.0, uSnow);
        wp.x += uSnow * sin(uTime * 0.9 + aSeed.x * 40.0) * 0.6; wp.z += uSnow * cos(uTime * 0.7 + aSeed.z * 40.0) * 0.6;
        float ground = hAt(wp.xz);
        if (wp.y < ground) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 vel = normalize(vec3(uWind * mix(1.0, 0.2, uSnow), -speed));
        vec3 toCam = normalize(cameraPosition - wp);
        vec3 side = normalize(cross(vel, toCam));
        float len = mix(0.55 + speed * 0.025, 0.06, uSnow), wid = mix(0.012, 0.06, uSnow);
        vec3 p = wp + side * (position.x * wid) - vel * (position.y * len) * (1.0 - uSnow) + vec3(0.0, position.y * len, 0.0) * uSnow;
        float d = length(cameraPosition - wp);
        vA = (1.0 - smoothstep(B * 0.35, B * 0.5, d)) * smoothstep(0.3, 1.2, d);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uSnow; uniform vec3 uLight; varying vec2 vUv; varying float vA;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;
        float a = uSnow > 0.5 ? (1.0 - smoothstep(0.3, 1.0, length(vUv - 0.5) * 2.0)) * 0.85 : (1.0 - x) * 0.32 * smoothstep(0.0, 0.3, vUv.y);
        vec3 c = mix(vec3(0.62, 0.66, 0.72), vec3(0.92, 0.94, 0.98), uSnow) * uLight;
        gl_FragColor = vec4(c, a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 5;
  return { mesh, U, max };
}
// splashes: little crowns of water thrown up where drops land, round the camera
function splashes(max) {
  const base = new THREE.PlaneGeometry(1, 1); base.translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
  const seed = new Float32Array(max * 4); for (let i = 0; i < max; i++) { seed[i * 4] = R(); seed[i * 4 + 1] = R(); seed[i * 4 + 2] = R(); seed[i * 4 + 3] = i / max; }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.instanceCount = max;
  const U = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmt: { value: 0 }, uHeight: { value: null }, uHalf: { value: 150 }, uN: { value: 257 }, uWaterY: { value: -9999 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  const m = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: `
      uniform vec3 uCam; uniform float uTime, uAmt, uHalf, uN, uWaterY; uniform sampler2D uHeight;
      attribute vec4 aSeed; varying vec2 vUv; varying float vT, vA;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float hAt(vec2 p){ vec2 f = clamp((p + uHalf) / (2.0 * uHalf) * (uN - 1.0), 0.0, uN - 1.001); vec2 i = floor(f), t = f - i;
        float a = texture2D(uHeight, (i + 0.5) / uN).r, b = texture2D(uHeight, (i + vec2(1.5, 0.5)) / uN).r, c = texture2D(uHeight, (i + vec2(0.5, 1.5)) / uN).r, d = texture2D(uHeight, (i + 1.5) / uN).r;
        return mix(mix(a, b, t.x), mix(c, d, t.x), t.y); }
      void main(){
        vUv = uv; vA = 0.0; vT = 0.0;
        if (aSeed.w > uAmt) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float rate = 2.2 + aSeed.y * 1.5, cyc = uTime * rate + aSeed.z * 7.0, n = floor(cyc); float t = fract(cyc); vT = t;
        vec2 off = vec2(hh(vec2(n, aSeed.x * 91.0)), hh(vec2(aSeed.z * 53.0, n))) - 0.5;
        vec2 xz = uCam.xz + off * 22.0;
        float y = max(hAt(xz), uWaterY + 0.02);
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

// ---------------------------------------------------------------- the fen's wave field
class WaterSim {
  constructor(renderer, level) {
    this.renderer = renderer; this.level = level; this.N = 256; this.size = 64; this.ok = true;
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(this.N, this.N, opts), new THREE.WebGLRenderTarget(this.N, this.N, opts)]; this.i = 0;
    this.drops = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0));
    this.U = { uPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uTexel: { value: 1 / this.N }, uDrops: { value: this.drops }, uRain: { value: 0 }, uTime: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D uPrev; uniform vec2 uShift; uniform float uTexel, uRain, uTime; uniform vec4 uDrops[16]; varying vec2 vUv;
        float hh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float H(vec2 uv){ return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(uPrev, uv).r; }
        void main(){
          vec2 uv = vUv + uShift;
          float c = H(uv), prev = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(uPrev, uv).g;
          float n = H(uv + vec2(uTexel, 0.0)) + H(uv - vec2(uTexel, 0.0)) + H(uv + vec2(0.0, uTexel)) + H(uv - vec2(0.0, uTexel));
          float h = (n * 0.5 - prev) * 0.986;
          for (int i = 0; i < 16; i++) { vec4 d = uDrops[i]; if (d.w == 0.0) continue; float r = length(vUv - d.xy) / max(d.z, 1e-4); h += d.w * exp(-r * r); }
          if (uRain > 0.0 && hh(floor(vUv / uTexel) + fract(uTime * 7.31) * 913.0) > 1.0 - uRain * 0.0012) h -= 0.25;
          float edge = smoothstep(0.0, 0.05, min(min(vUv.x, vUv.y), min(1.0 - vUv.x, 1.0 - vUv.y)));
          gl_FragColor = vec4(h * edge, c, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.scene = new THREE.Scene(); this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat); quad.frustumCulled = false; this.scene.add(quad);
    this.cx = 0; this.cz = 0; this.nd = 0;
    WATER_U.uSimTexel.value = 1 / this.N;
  }
  drop(x, z, radius, strength) {
    if (this.nd >= 16) return;
    const u = (x - this.cx) / this.size + 0.5, v = (z - this.cz) / this.size + 0.5;
    if (u < 0 || v < 0 || u > 1 || v > 1) return;
    this.drops[this.nd++].set(u, v, radius / this.size, strength);
  }
  step(dt, center, rain, time) {
    // follow the player, a whole texel at a time (the field is shifted under the window as it moves)
    const t = this.size / this.N;
    const nx = Math.round(center.x / t) * t, nz = Math.round(center.z / t) * t;
    const sx = (nx - this.cx) / this.size, sz = (nz - this.cz) / this.size; this.cx = nx; this.cz = nz;
    const r = this.renderer, prevT = r.getRenderTarget();
    for (let k = 0; k < 2; k++) {
      this.U.uPrev.value = this.rt[this.i].texture; this.U.uShift.value.set(k ? 0 : sx, k ? 0 : sz);
      this.U.uRain.value = rain; this.U.uTime.value = time + k * 0.013;
      if (k === 1) for (const d of this.drops) d.w = 0;
      r.setRenderTarget(this.rt[1 - this.i]); r.render(this.scene, this.cam); this.i = 1 - this.i;
    }
    r.setRenderTarget(prevT);
    for (const d of this.drops) d.w = 0; this.nd = 0;
    WATER_U.uSim.value = this.rt[this.i].texture; WATER_U.uSimWin.value.set(this.cx, this.cz, this.size, 1);
  }
  dispose() { for (const t of this.rt) t.dispose(); this.mat.dispose(); WATER_U.uSimWin.value.w = 0; WATER_U.uSim.value = null; }
}

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
    this.spl = splashes(260); this.spl.U.uHeight.value = this.htex; this.spl.U.uN.value = N;
    if (W.waterLevel > -100 && W.water) this.spl.U.uWaterY.value = W.waterLevel;
    game.scene.add(this.fall.mesh); game.scene.add(this.spl.mesh);
    WX.uWet.value = 0; WX.uRain.value = 0; WX.uSnowAcc.value = 0;
    // everything in the land goes wet with it (the terrain and water have their own)
    W.group.traverse((o) => { if (o.isMesh && o !== W.terrain && o !== W.water && o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(wetten); });
    // the fen: a wave field under the water
    if (W.water && ch.terrain.water !== undefined) { try { this.sim = new WaterSim(game.engine.renderer, W.waterLevel); } catch (e) { this.sim = null; } }
    this.last = new Map();
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
    if (this.sim) this.water(dt, time);
  }
  water(dt, time) {
    const g = this.g, W = this.W, L = W.waterLevel, me = g.me;
    const bodies = [...g.knightList, ...g.horde.list.filter((d) => d.alive)];
    for (const b of bodies) {
      const depth = L - W.heightAt(b.pos.x, b.pos.z); if (depth < 0.05) { this.last.set(b, b.pos.clone()); continue; }
      const lp = this.last.get(b); const v = lp ? Math.hypot(b.pos.x - lp.x, b.pos.z - lp.z) / Math.max(dt, 1e-3) : 0;
      // the water drags at your legs
      if (lp && depth > 0.2 && g.knightList.includes(b) && !b.downed) { const k = Math.min(0.4, depth * 0.55); b.pos.x -= (b.pos.x - lp.x) * k; b.pos.z -= (b.pos.z - lp.z) * k; }
      if (v > 0.3) { this.sim.drop(b.pos.x, b.pos.z, 0.45, Math.min(0.6, v * 0.08)); if (R() < dt * v * 0.8) g.fx.dust?.(b.pos.clone().setY(L + 0.05), 2, [0.3, 0.33, 0.32]); }
      this.last.set(b, b.pos.clone());
    }
    this.sim.step(dt, me.pos, WX.uRain.value, time);
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
