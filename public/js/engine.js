// Renderer, post-processing, sky, lighting and quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { clamp, lerp } from './util.js';

export const QUALITY = {
  low:    { label: 'Low',    pixel: 0.75, shadow: 1024, shadows: true,  bloom: false, post: false, msaa: 0, tex: 512,  grass: 0.35, maxDemons: 40, particles: 0.5, terrainSeg: 140, shadowDist: 40 },
  medium: { label: 'Medium', pixel: 1.0,  shadow: 2048, shadows: true,  bloom: true,  post: true,  msaa: 0, tex: 512,  grass: 0.6,  maxDemons: 60, particles: 0.8, terrainSeg: 180, shadowDist: 55 },
  high:   { label: 'High',   pixel: 1.0,  shadow: 2048, shadows: true,  bloom: true,  post: true,  msaa: 4, tex: 1024, grass: 1.0,  maxDemons: 80, particles: 1.0, terrainSeg: 220, shadowDist: 65 },
  ultra:  { label: 'Ultra',  pixel: 1.5,  shadow: 4096, shadows: true,  bloom: true,  post: true,  msaa: 4, tex: 1024, grass: 1.4,  maxDemons: 100, particles: 1.3, terrainSeg: 256, shadowDist: 75 },
};

// Final grade: vignette, grain, chromatic fringe, damage/holy tints, desaturation.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uHoly: { value: 0 },
    uDesat: { value: 0 }, uVignette: { value: 0.32 }, uGrain: { value: 0.035 }, uAberr: { value: 0.0012 },
    uTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 }, uLift: { value: new THREE.Color(0, 0, 0) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uHoly, uDesat, uVignette, uGrain, uAberr, uFlash;
    uniform vec3 uTint, uLift; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c,c);
      float ab = uAberr * (1.0 + uHurt * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), uDesat);
      col *= uTint; col += uLift;
      // hurt: red pulse at edges
      col = mix(col, col * vec3(1.4, 0.25, 0.2) + vec3(0.12, 0.0, 0.0), uHurt * smoothstep(0.05, 0.45, r2));
      // holy: warm bloom wash
      col += vec3(1.0, 0.85, 0.55) * uHoly * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 0.5, r2)));
      col += vec3(uFlash);
      float vig = 1.0 - uVignette * smoothstep(0.08, 0.55, r2) * 1.6;
      col *= vig;
      col += (hash(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

// Sky dome: gradient + sun disc + drifting layered clouds + horizon glow
export function makeSky() {
  const uniforms = {
    uTop: { value: new THREE.Color(0x0c0d12) }, uMid: { value: new THREE.Color(0x3a2a2a) }, uBottom: { value: new THREE.Color(0x120a0a) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.2, -1).normalize() }, uSunColor: { value: new THREE.Color(0xff6a30) },
    uSunSize: { value: 0.03 }, uCloud: { value: new THREE.Color(0x1a1416) }, uCloudLit: { value: new THREE.Color(0x804030) },
    uCover: { value: 0.65 }, uTime: { value: 0 }, uGlow: { value: new THREE.Color(0x601a10) }, uFog: { value: new THREE.Color(0x2a1e1e) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      uniform vec3 uTop, uMid, uBottom, uSunDir, uSunColor, uCloud, uCloudLit, uGlow, uFog; uniform float uSunSize, uCover, uTime;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = mix(uMid, uTop, smoothstep(0.0, 0.55, h));
        col = mix(uBottom, col, smoothstep(-0.25, 0.02, h));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uGlow * pow(sd, 6.0) * 0.9 + uGlow * (1.0 - abs(h)) * 0.25;
        col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.5, sd) * 3.0;
        col += uSunColor * pow(sd, 900.0) * 0.8;
        col += uSunColor * pow(sd, 120.0) * 1.2;
        if (h > -0.05) {
          vec2 uv = d.xz / (h + 0.18) * 1.4;
          float c1 = fbm(uv + vec2(uTime * 0.006, uTime * 0.002));
          float c2 = fbm(uv * 2.3 - vec2(uTime * 0.01, 0.0));
          float cl = smoothstep(1.0 - uCover, 1.0 - uCover + 0.35, c1 * 0.7 + c2 * 0.35);
          float lit = pow(sd, 4.0) * (1.0 - c2);
          vec3 cc = mix(uCloud, uCloudLit, clamp(lit * 1.5, 0.0, 1.0));
          col = mix(col, cc, cl * smoothstep(-0.05, 0.12, h) * 0.95);
        }
        // the horizon dissolves into the same haze as the distant land, so far hills sink into the sky instead of glowing against it
        col = mix(col, uFog, (1.0 - smoothstep(-0.02, 0.16, h)) * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10;
  return { mesh, uniforms };
}

// Fog never quite swallows the land: distant hills keep a trace of their own darkness, so they stay a
// silhouette against the hazy horizon and the far mountain rises from them instead of floating in the sky.
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace('mix( gl_FragColor.rgb, fogColor, fogFactor )', 'mix( gl_FragColor.rgb, fogColor, min( fogFactor, 0.88 ) )');

export class Engine {
  constructor(canvas, qualityKey = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
    this.scene.add(this.camera);
    this.time = 0;
    this.fx = { hurt: 0, holy: 0, desat: 0, flash: 0, shake: 0, shakeT: 0, kickV: new THREE.Vector3(), kickT: 0, kickDur: 0.16, tint: new THREE.Color(1, 1, 1), lift: new THREE.Color(0, 0, 0) };

    this.sky = makeSky();
    this.scene.add(this.sky.mesh);
    this.hemi = new THREE.HemisphereLight(0x8a90a0, 0x1a1210, 0.5);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc8a0, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.fill = new THREE.DirectionalLight(0x6070a0, 0.25); // cool rim/fill opposite the sun
    this.scene.add(this.fill); this.scene.add(this.fill.target);
    this.scene.fog = new THREE.FogExp2(0x2a1e1e, 0.012);
    this.sunDir = new THREE.Vector3(0.3, 0.4, -1).normalize();
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envRT = null;
    this.setQuality(qualityKey);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(key) {
    this.qKey = key; this.q = QUALITY[key] || QUALITY.high;
    const q = this.q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * q.pixel);
    this.renderer.shadowMap.enabled = q.shadows;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== q.shadow) { sh.mapSize.set(q.shadow, q.shadow); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    const d = q.shadowDist; Object.assign(sh.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 400 });
    sh.camera.updateProjectionMatrix();
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    const q = this.q;
    if (!q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    if (q.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.55, 1.25);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  }

  // Apply a chapter's look
  setAtmosphere(a, env = true) {
    const u = this.sky.uniforms;
    u.uTop.value.set(a.skyTop); u.uMid.value.set(a.skyMid); u.uBottom.value.set(a.skyBottom);
    u.uSunColor.value.set(a.sunColor); u.uCloud.value.set(a.cloud); u.uCloudLit.value.set(a.cloudLit);
    u.uGlow.value.set(a.glow); u.uCover.value = a.cover; u.uSunSize.value = a.sunSize ?? 0.0009;
    this.sunDir.set(a.sunDir[0], a.sunDir[1], a.sunDir[2]).normalize();
    u.uSunDir.value.copy(this.sunDir);
    this.sun.color.set(a.sunLight); this.sun.intensity = a.sunIntensity;
    this.hemi.color.set(a.hemiSky); this.hemi.groundColor.set(a.hemiGround); this.hemi.intensity = a.hemiIntensity;
    this.fill.color.set(a.fillColor || 0x6070a0); this.fill.intensity = a.fillIntensity ?? 0.25;
    this.scene.fog.color.set(a.fog); this.scene.fog.density = a.fogDensity; u.uFog.value.set(a.fog);
    this.renderer.toneMappingExposure = a.exposure ?? 1.0;
    this.baseAtmos = a;
    if (env) this.buildEnvironment();
  }

  // Reflection environment for metal: render the sky into a PMREM cube.
  buildEnvironment() {
    const envScene = new THREE.Scene();
    const sky = makeSky();
    for (const k in this.sky.uniforms) { const v = this.sky.uniforms[k].value; sky.uniforms[k].value = v && v.clone ? v.clone() : v; }
    sky.mesh.scale.setScalar(0.1);
    envScene.add(sky.mesh);
    // a dim ground disc so reflections show earth below the horizon
    const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.baseAtmos?.hemiGround ?? 0x1a1210).multiplyScalar(0.6) }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -5; envScene.add(ground);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    sky.mesh.geometry.dispose(); sky.mesh.material.dispose(); ground.geometry.dispose(); ground.material.dispose();
  }

  // keep the shadow frustum centred on the action
  focusShadows(pos) {
    const s = this.sun; const d = 120;
    const snap = this.q.shadowDist * 2 / this.q.shadow; // texel snapping to stop shimmering
    const fx = Math.round(pos.x / snap) * snap, fz = Math.round(pos.z / snap) * snap;
    s.target.position.set(fx, pos.y, fz);
    s.position.set(fx + this.sunDir.x * d, pos.y + Math.max(0.25, this.sunDir.y) * d, fz + this.sunDir.z * d);
    this.fill.target.position.set(fx, pos.y, fz);
    this.fill.position.set(fx - this.sunDir.x * d, pos.y + 40, fz - this.sunDir.z * d);
  }

  shake(amount, dur = 0.35) { this.fx.shake = Math.max(this.fx.shake, amount); this.fx.shakeT = Math.max(this.fx.shakeT, dur); }
  // a directional jolt of the camera (the weight of a blow landing): snaps along dir, then springs back
  kick(dir, amount, dur = 0.16) { const f = this.fx; f.kickV.copy(dir).setLength(amount); f.kickT = dur; f.kickDur = dur; }

  render(dt) {
    this.time += dt;
    if (this.headless) return;   // automated tests: run the game without drawing it
    const fx = this.fx;
    fx.hurt = Math.max(0, fx.hurt - dt * 1.4);
    fx.flash = Math.max(0, fx.flash - dt * 3);
    fx.holy = Math.max(0, fx.holy - dt * 0.6);
    this.sky.uniforms.uTime.value = this.time;
    this.sky.mesh.position.copy(this.camera.position);
    // camera shake (applied as a temporary offset)
    let ox = 0, oy = 0;
    if (fx.shakeT > 0) {
      fx.shakeT -= dt; const a = fx.shake * clamp(fx.shakeT * 3, 0, 1);
      ox = (Math.random() - 0.5) * a; oy = (Math.random() - 0.5) * a;
      if (fx.shakeT <= 0) fx.shake = 0;
    }
    if (fx.kickT > 0) {
      fx.kickT -= dt; const u = 1 - Math.max(0, fx.kickT) / fx.kickDur;   // 0 -> 1 over the kick
      const k = u < 0.18 ? u / 0.18 : Math.exp(-(u - 0.18) * 6) * Math.cos((u - 0.18) * 9);   // snap out, damped spring back
      ox += fx.kickV.x * k; oy += fx.kickV.y * k; this._kz = fx.kickV.z * k;
    } else this._kz = 0;
    this.camera.position.x += ox; this.camera.position.y += oy; this.camera.position.z += this._kz;
    if (this.composer) {
      const g = this.grade.uniforms;
      g.uTime.value = this.time % 100; g.uHurt.value = fx.hurt; g.uHoly.value = fx.holy; g.uDesat.value = fx.desat;
      g.uFlash.value = fx.flash; g.uTint.value.copy(fx.tint); g.uLift.value.copy(fx.lift);
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.camera.position.x -= ox; this.camera.position.y -= oy; this.camera.position.z -= this._kz;
  }
}
