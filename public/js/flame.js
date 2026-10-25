// Real-looking fire: several tongues of flame drawn as camera-facing sheets whose shape and colour come from a
// rising, domain-warped turbulence (a white-yellow core, orange body, red licking edges, ragged and torn off at
// the top), with sparks and embers that climb and curl and wink out, and a little dark smoke. Additive and HDR,
// so it glows. One geometry and two shaders are shared by every fire.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = `
  uniform float uTime, uSeed, uInt, uLean; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
  void main(){
    vec2 uv = vUv; float t = uTime * 1.9 + uSeed * 17.0;
    vec2 q = vec2(uv.x * 2.0 - 1.0, uv.y);
    vec2 p = vec2(q.x * 1.7, q.y * 2.4 - t);
    float w = fbm(p * 1.2 + vec2(0.0, -t * 0.4));
    float w2 = fbm(p * 2.6 + vec2(w * 1.8, w * 1.2) + vec2(uSeed * 3.0, -t * 0.9));
    // the fire is not one blob but several tongues: how far the flame reaches up varies across it and in time
    float reach = 0.42 + 0.58 * smoothstep(0.15, 0.85, n(vec2(q.x * 2.6 + uSeed * 7.0, t * 0.55)) * 0.75 + n(vec2(q.x * 6.0 - uSeed, t * 1.3)) * 0.35);
    float yy = clamp(uv.y / reach, 0.0, 1.5);
    float width = mix(0.8, 0.06, pow(min(yy, 1.0), 0.85));
    float x = q.x + (w2 - 0.5) * 0.7 * uv.y + sin(uv.y * 5.0 - t * 1.7 + uSeed * 6.0) * 0.07 * uv.y - uLean * uv.y * uv.y;
    float body = 1.0 - smoothstep(width * 0.35, width, abs(x));
    float heat = body * (1.0 - smoothstep(0.15, 1.05, yy + (w - 0.5) * 0.85));
    heat *= smoothstep(0.0, 0.1, uv.y);
    heat = clamp(heat * 1.75 - (w2 - 0.35) * 0.75, 0.0, 1.0);
    // torn-off licks of flame above the body
    float lick = smoothstep(0.62, 0.8, fbm(vec2(q.x * 3.0, uv.y * 3.5 - t * 1.6) + w)) * smoothstep(0.35, 0.7, uv.y) * (1.0 - smoothstep(0.75, 1.0, uv.y)) * (1.0 - smoothstep(0.1, 0.45, abs(x)));
    heat = max(heat, lick * 0.5);
    vec3 col = mix(vec3(0.45, 0.04, 0.01), vec3(1.0, 0.32, 0.04), smoothstep(0.08, 0.4, heat));
    col = mix(col, vec3(1.0, 0.6, 0.18), smoothstep(0.42, 0.75, heat));
    col = mix(col, vec3(1.0, 0.88, 0.62), smoothstep(0.88, 1.0, heat));
    float a = smoothstep(0.03, 0.3, heat);
    gl_FragColor = vec4(col * (0.4 + heat * 1.1) * uInt * a, 1.0);
  }`;
const EMB_V = `
  uniform float uTime, uH, uInt; attribute float aSeed; varying float vA; varying float vHot;
  float h1(float x){ return fract(sin(x * 91.3) * 47453.5); }
  void main(){
    float life = 1.2 + h1(aSeed) * 1.6; float ph = fract(uTime / life + h1(aSeed * 3.1));
    float r = h1(aSeed * 7.7) * 0.25;
    vec3 p = vec3((h1(aSeed * 2.3) - 0.5) * 0.3, 0.0, (h1(aSeed * 5.1) - 0.5) * 0.3);
    p.y = ph * uH * (1.6 + h1(aSeed * 9.3) * 2.0);
    p.x += sin(ph * 9.0 + aSeed * 13.0) * (0.1 + ph * 0.35) + ph * ph * (h1(aSeed * 4.4) - 0.5) * 1.2;
    p.z += cos(ph * 7.0 + aSeed * 11.0) * (0.1 + ph * 0.35);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vA = (1.0 - ph) * smoothstep(0.0, 0.05, ph) * step(0.35, h1(aSeed * 13.1 + floor(uTime / life + h1(aSeed * 3.1)))) * uInt; vHot = 1.0 - ph;
    gl_PointSize = (1.2 + 2.2 * h1(aSeed * 6.6)) * (1.0 - ph * 0.6) * 9.0 / max(0.4, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const EMB_F = `varying float vA; varying float vHot;
  void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; float k = 1.0 - d * 4.0;
    vec3 col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.8, 0.4), vHot * vHot); gl_FragColor = vec4(col * 3.0 * k * vA, 1.0); }`;

// a column of dark smoke over the fire: alpha-blended, rolling up and spreading, lit warm from beneath
const SMOKE_F = `
  uniform float uTime, uSeed, uInt; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; } return s; }
  void main(){
    vec2 uv = vUv; float t = uTime * 0.32 + uSeed * 5.0;
    float spread = mix(0.14, 0.48, uv.y);
    float x = uv.x - 0.5 - (fbm(vec2(uv.y * 2.0 - t * 0.5, uSeed)) - 0.5) * 0.35 * uv.y;
    vec2 p = vec2(x * 3.0 / (0.5 + uv.y), uv.y * 2.6 - t);
    float dns = fbm(p + vec2(fbm(p * 0.7 + t * 0.15) * 1.6, 0.0));
    float shape = (1.0 - smoothstep(spread * 0.4, spread, abs(x))) * smoothstep(0.0, 0.2, uv.y) * (1.0 - smoothstep(0.5, 1.0, uv.y));
    float a = smoothstep(0.32, 0.72, dns) * shape * 0.62 * uInt;
    vec3 col = vec3(0.05, 0.045, 0.042) * (0.7 + dns * 0.6) + vec3(0.5, 0.16, 0.03) * (1.0 - smoothstep(0.12, 0.38, uv.y)) * uInt;
    gl_FragColor = vec4(col, a);
  }`;

let QUAD = null, EMB_GEO = null;
function quad() {
  if (QUAD) return QUAD;
  QUAD = new THREE.PlaneGeometry(1, 1, 1, 1); QUAD.translate(0, 0.5, 0); return QUAD;
}
function embers(n) {
  if (EMB_GEO && EMB_GEO.attributes.aSeed.count === n) return EMB_GEO;
  const g = new THREE.BufferGeometry(); const s = new Float32Array(n), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) s[i] = i * 1.618 + 0.37;
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 4); EMB_GEO = g; return g;
}

// height/width in metres; tongues: how many sheets; sparks: how many embers
export function makeFlame({ height = 0.5, width = 0.3, tongues = 3, sparks = 30, lean = 0, smoke = false } = {}) {
  const group = new THREE.Group(); const sheets = [];
  if (smoke) for (let i = 0; i < 2; i++) {
    const u = { uTime: { value: 0 }, uSeed: { value: Math.random() * 10 }, uInt: { value: 1 } };
    const m = new THREE.Mesh(quad(), new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: SMOKE_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.scale.set(width * 3.2, height * 4.2, 1); m.position.set(0, height * 0.35, 0); m.renderOrder = 9; m.frustumCulled = false; group.add(m); sheets.push(m);
  }
  for (let i = 0; i < tongues; i++) {
    const u = { uTime: { value: 0 }, uSeed: { value: Math.random() * 10 }, uInt: { value: 1 }, uLean: { value: lean } };
    const m = new THREE.Mesh(quad(), new THREE.ShaderMaterial({ uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    const k = i === 0 ? 1 : 0.55 + Math.random() * 0.4;
    const a = (i / tongues) * Math.PI * 2, rr = i === 0 ? 0 : width * 0.22;
    m.scale.set(width * (i === 0 ? 1.15 : 0.9), height * k, 1); m.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    m.renderOrder = 10; m.frustumCulled = false; group.add(m); sheets.push(m);
  }
  let pts = null;
  if (sparks) {
    const eu = { uTime: { value: 0 }, uH: { value: height }, uInt: { value: 1 } };
    pts = new THREE.Points(embers(sparks), new THREE.ShaderMaterial({ uniforms: eu, vertexShader: EMB_V, fragmentShader: EMB_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
    pts.frustumCulled = false; group.add(pts);
  }
  const _w = new THREE.Vector3();
  return {
    group,
    // camPos: the camera's world position (the sheets turn to face it about the vertical); intensity 0..1+
    update(time, camPos, intensity = 1) {
      group.getWorldPosition(_w);
      const yaw = camPos ? Math.atan2(camPos.x - _w.x, camPos.z - _w.z) : 0;
      // the group may be turned (a torch in a hand): face the camera in world terms
      const parentYaw = group.parent ? new THREE.Euler().setFromQuaternion(group.parent.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y : 0;
      sheets.forEach((m, i) => { m.rotation.set(0, yaw - parentYaw + i * 0.45, 0); m.material.uniforms.uTime.value = time; m.material.uniforms.uInt.value = intensity; });
      if (pts) { pts.material.uniforms.uTime.value = time; pts.material.uniforms.uInt.value = Math.min(1, intensity); }
    },
  };
}
