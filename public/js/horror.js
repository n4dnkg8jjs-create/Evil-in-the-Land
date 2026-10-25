// The demons' flesh and motion. Bodies are MakeHuman humans twisted by
// tools/build_demons.py; here they get their skin, white eyes, wings and horns,
// and the movement that makes them frightening: violent head-shaking fits,
// screams with the jaw unhinged, twitches, stop-motion stutters, and the
// crawler's belly-up spider-walk.
import * as THREE from 'three';
import { demonTextures, clothTextures } from './textures.js';
import { clamp, lerp, smooth, TAU } from './util.js';
import { realHand, humanBody, headBox } from './people.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const D2R = Math.PI / 180, PI = Math.PI;
let DB = null;
const dec = (b64, Type) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); };

export async function loadDemonBodies(url = 'models/demons.json') {
  if (DB) return DB;
  const j = await (await fetch(url)).json();
  DB = { joints: j.joints, kinds: {} };
  for (const k in j.kinds) {
    const d = j.kinds[k];
    const geo = new THREE.BufferGeometry();
    const pos = d.pscale ? Float32Array.from(dec(d.position, Int16Array), (v) => v / d.pscale) : dec(d.position, Float32Array);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(dec(d.normal, Int8Array), 3, true));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(dec(d.skinIndex, Uint8Array), 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(dec(d.skinWeight, Uint8Array), 4, true));
    geo.setAttribute('region', new THREE.BufferAttribute(Float32Array.from(dec(d.region, Uint8Array)), 1));
    geo.setIndex(new THREE.BufferAttribute(dec(d.index, Uint16Array), 1));
    geo.computeBoundingSphere();
    DB.kinds[k] = { geo, joints: d.joints, bind: d.bind, eyes: d.eyes, height: d.height };
  }
  return DB;
}
export function demonBodiesReady() { return !!DB; }

// ---------------------------------------------------------------- skin
// Ash-black, sweat-wet skin; detail is projected in the body's own space, so it
// sticks to the flesh as it moves. Veins smoulder with the kind's colour.
const BUMP = `
  vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
  vec4 tri(sampler2D t, vec3 p, vec3 w){ return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }
  vec3 bumpN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = dFdx(surf_pos.xyz); vec3 vSigmaY = dFdy(surf_pos.xyz); vec3 vN = surf_norm;
    vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX); float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }`;
export function demonSkin(rimHex, { skin = 0x141012, glow = 1, dead = false, eyes = null } = {}) {
  const dt = demonTextures();
  const u = { uDissolve: { value: 0 }, uRim: { value: new THREE.Color(rimHex) }, uGlow: { value: glow }, uHit: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 },
    uWristR: { value: new THREE.Vector3() }, uWristL: { value: new THREE.Vector3() }, uHandR: { value: -9 }, uHandL: { value: -9 },
    uEyeL: { value: new THREE.Vector3(...(eyes ? eyes[0] : [0, -9, 0])) }, uEyeR: { value: new THREE.Vector3(...(eyes ? eyes[1] : [0, -9, 0])) }, uHeadY: { value: eyes ? eyes[2] : 99 }, uGlitch: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { tA: { value: dt.map }, tE: { value: dt.emissiveMap } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float region;\nvarying vec3 vDPos; varying vec3 vDN; varying float vReg;\nuniform vec3 uWristR, uWristL; uniform float uHandR, uHandL, uGlitch, uTime, uSeed;\nfloat gh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDPos = position; vDN = normal; vReg = region;
        #ifndef DEAD_SKIN
        // tearing into being: horizontal slices of the body slip sideways, flickering
        if (uGlitch > 0.0) { float band = floor(position.y * 13.0), tt = floor(uTime * 20.0);
          float on = step(1.0 - uGlitch * 0.55, gh(vec3(band, tt, uSeed)));
          transformed.x += (gh(vec3(band, tt + 3.1, uSeed)) - 0.5) * 0.42 * on * uGlitch; transformed.z += (gh(vec3(band, tt + 7.7, uSeed)) - 0.5) * 0.2 * on * uGlitch; }
        #endif
        #ifdef DEAD_SKIN
        // His own hands are folded away into the wrists; real hands are fixed on there instead
        { float bi = skinIndex.x, bw = skinWeight.x;
          if (skinWeight.y > bw) { bi = skinIndex.y; bw = skinWeight.y; } if (skinWeight.z > bw) { bi = skinIndex.z; bw = skinWeight.z; } if (skinWeight.w > bw) { bi = skinIndex.w; }
          if (abs(bi - uHandR) < 0.5) transformed = uWristR; else if (abs(bi - uHandL) < 0.5) transformed = uWristL; }
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDPos; varying vec3 vDN; varying float vReg;
        uniform float uDissolve, uGlow, uHit, uTime, uSeed, uHeadY, uGlitch; uniform vec3 uRim, uEyeL, uEyeR; uniform sampler2D tA, tE;
        float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }
        ${BUMP}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dnz = dn(vDPos * 7.0) * 0.65 + dn(vDPos * 19.0) * 0.35;
        if (uDissolve > 0.0 && dnz < uDissolve) discard;
        vec3 tw = triW(normalize(vDN));
        vec4 skinA = tri(tA, vDPos * 2.3, tw);
        vec4 skinB = tri(tA, vDPos * 7.1 + 0.37, tw);
        float veins = tri(tE, vDPos * 1.7, tw).r;
        float hgt = clamp((dot(skinA.rgb, vec3(0.33)) * 0.55 + dot(skinB.rgb, vec3(0.33)) * 0.45 - 0.05) * 9.0, 0.0, 1.0);
        float teeth = step(0.5, vReg);
        #ifdef DEAD_SKIN
        if (teeth > 0.5) discard;   // no fangs on Him: a shut, bloodless mouth
        #else
        if (uGlitch > 0.0 && dh(vec3(floor(vDPos.y * 55.0), floor(uTime * 28.0), uSeed)) < uGlitch * 0.22) discard;
        // starved: every rib stands out under skin stretched tight over them, the belly sunk in beneath
        { float ey = (uEyeL.y + uEyeR.y) * 0.5; float ry = vDPos.y + abs(vDPos.x) * 0.4;
          float band = smoothstep(ey * 0.6, ey * 0.65, ry) * (1.0 - smoothstep(ey * 0.79, ey * 0.83, ry));
          float wide = 1.0 - smoothstep(ey * 0.085, ey * 0.12, abs(vDPos.x));
          float rib = pow(0.5 + 0.5 * sin(ry / (ey * 0.03) * 6.2832), 2.5);
          hgt = mix(hgt, hgt * 0.4 + rib * 0.75, band * wide * 0.85);
          float belly = smoothstep(ey * 0.5, ey * 0.56, vDPos.y) * (1.0 - smoothstep(ey * 0.6, ey * 0.64, vDPos.y)) * wide;
          hgt *= 1.0 - belly * 0.5; }
        #endif`)
      .replace('#include <map_fragment>', `
        #ifdef DEAD_SKIN
          float bleed = 0.0;
          // a corpse's face: waxy grey-white, the blood settled blue-grey under it, veins showing through,
          // bruised hollows round the eyes, the lips dry and dark (no teeth showing, nothing shining)
          float ash = smoothstep(0.3, 0.95, hgt);
          vec3 base = diffuseColor.rgb * mix(0.8, 1.15, ash);
          base = mix(base, base * vec3(0.78, 0.84, 0.9), smoothstep(0.4, 0.8, dn(vDPos * 3.0)) * 0.6);   // livor, mottled
          base *= 1.0 - smoothstep(0.62, 0.95, veins) * 0.09 * vec3(0.9, 0.8, 0.6);                      // faint veins under the skin
          float sock = min(length(vDPos - uEyeL), length(vDPos - uEyeR));
          base *= mix(vec3(0.6, 0.58, 0.68), vec3(1.0), smoothstep(0.03, 0.09, sock));                  // sunken sockets, the skin there bruised grey-violet
          diffuseColor.rgb = mix(base, vec3(0.16, 0.11, 0.12), teeth);
        #else
        // ash-grey where the skin is stretched over bone, near black in the folds
        float ash = smoothstep(0.35, 0.9, hgt);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, diffuseColor.rgb * 2.4 + vec3(0.03, 0.025, 0.02), ash);
        // deep black sockets round the eyes, and black blood run from them down the face in streaks
        float dl = length(vDPos - uEyeL), dr2 = length(vDPos - uEyeR);
        diffuseColor.rgb *= mix(0.12, 1.0, smoothstep(0.03, 0.075, min(dl, dr2)));
        // the lids raw and red round the staring eyes, wet with it
        float sockRing = smoothstep(0.026, 0.032, min(dl, dr2)) * (1.0 - smoothstep(0.036, 0.05, min(dl, dr2)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.022, 0.024), sockRing * 0.55);   // the lids dark and wet (no red)
        float bleed = 0.0;
        for (int e = 0; e < 2; e++) {
          vec3 E = e == 0 ? uEyeL : uEyeR; vec3 q = vDPos - E;
          float wob = (dn(vec3(vDPos.y * 18.0, E.x * 9.0, 1.0)) - 0.5) * 0.02;
          float runLen = 0.16 + 0.12 * dh(E * 3.1);
          bleed = max(bleed, smoothstep(0.012, 0.0, abs(q.x + wob)) * step(q.y, 0.0) * smoothstep(-runLen, -runLen * 0.5, q.y) * step(-0.06, q.z));
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.016, 0.016), bleed * 0.92);
        // teeth: yellowed, broken, each one separate, black gaps between and rotten gums
        float tooth = smoothstep(0.08, 0.3, abs(fract(vDPos.x * 75.0 + dn(vDPos * 40.0) * 0.6) - 0.5) * 2.0);
        vec3 tc = mix(vec3(0.03, 0.01, 0.01), vec3(0.34, 0.27, 0.16) * (0.6 + 0.6 * dn(vDPos * 90.0)), 1.0 - tooth);
        diffuseColor.rgb = mix(diffuseColor.rgb, tc, teeth);
        #endif
        #ifdef DEAD_SKIN
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.035, 0.03, 0.032);
        #else
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.03, 0.0, 0.0);   // throat and sockets
        #endif`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(clamp(roughness + (0.5 - hgt) * 0.45, 0.25, 0.9), 0.28, teeth);\n#ifndef DEAD_SKIN\nroughnessFactor = mix(roughnessFactor, 0.12, bleed);\nroughnessFactor = mix(roughnessFactor, 0.16, (1.0 - hgt) * 0.55 + sockRing * 0.5);\n#endif')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt)) * 0.007 * (1.0 - teeth) * (gl_FrontFacing ? 1.0 : 0.0);
        normal = bumpN(-vViewPosition, normal, dHdxy, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pulse = 0.55 + 0.45 * sin(uTime * 2.3 + uSeed + vDPos.y * 4.0);
        float ff = gl_FrontFacing ? 1.0 : 0.0;
        #ifndef DEAD_SKIN
        totalEmissiveRadiance += uRim * pow(veins, 4.0) * 0.35 * pulse * uGlow * (1.0 - teeth) * ff;
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uRim * fres * 0.18 * uGlow * ff;
        #endif
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit * 1.6;
        if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 6.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dnz));`);
  };
  if (dead) { mat.defines = { DEAD_SKIN: '' }; mat.roughness = 0.62; }
  mat.customProgramCacheKey = () => dead ? 'demonSkin-dead-v3' : 'demonSkin-v5';
  return mat;
}
// Eyes: blank, white, burning. Shared by every demon.
// white-hot, bloodshot: the whites shot through with red veins from every side, staring
function bloodshotTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 128);
  const cx = 64, cy = 64;   // the front of the sphere: u .25, v .5
  for (let i = 0; i < 70; i++) {
    let a = Math.random() * Math.PI * 2, r = 46 + Math.random() * 20; let px = cx + Math.cos(a) * r * 1.6, py = cy + Math.sin(a) * r;
    x.strokeStyle = `rgba(${150 + Math.random() * 80},0,0,${0.5 + Math.random() * 0.5})`; x.lineWidth = 0.6 + Math.random() * 1.6; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 9; k++) { const dx = cx - px, dy = cy - py, l = Math.hypot(dx, dy) || 1; px += dx / l * 4 + (Math.random() - 0.5) * 6; py += dy / l * 2.5 + (Math.random() - 0.5) * 4; x.lineTo(px, py); if (l < 18) break; }
    x.stroke();
  }
  const g = x.createRadialGradient(cx, cy, 20, cx, cy, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(160,10,0,0.55)'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
  x.fillStyle = 'rgba(140,0,0,0.7)'; x.fillRect(128, 0, 128, 128);   // the back of the eye, never seen
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const EYE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(4), map: typeof document !== 'undefined' ? bloodshotTex() : null, toneMapped: false });
const EYE_GEO = new THREE.SphereGeometry(1, 14, 10);
const PUPIL_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.02).multiplyScalar(3), toneMapped: false });
// His eyes are not lamps: real, wet eyes, the whites shot with red veins from the corners, the iris milked over
// almost to white like a dead man's, a faint grey pupil. Painted once onto the sphere (the front is u .25, v .5).
let _realEye = null;
function realEyeMat() {
  if (_realEye) return _realEye;
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const sc = x.createRadialGradient(W * 0.25, H * 0.5, 4, W * 0.25, H * 0.5, W * 0.3);
  sc.addColorStop(0, '#e4e2da'); sc.addColorStop(0.6, '#d6cfc2'); sc.addColorStop(1, '#a89484');
  x.fillStyle = sc; x.fillRect(0, 0, W, H);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // veins creeping in from the corners toward the iris, forking as they go
  const vein = (px, py, ang, len, w) => {
    x.strokeStyle = `rgba(${150 + rnd() * 40 | 0}, ${20 + rnd() * 25 | 0}, ${25 + rnd() * 20 | 0}, ${0.35 + rnd() * 0.4})`; x.lineWidth = w; x.beginPath(); x.moveTo(px, py);
    let a = ang, X = px, Y = py;
    for (let i = 0; i < len; i++) { a += (rnd() - 0.5) * 0.7; X += Math.cos(a) * 4; Y += Math.sin(a) * 2.2; x.lineTo(X, Y); if (w > 0.6 && rnd() < 0.08) vein(X, Y, a + (rnd() - 0.5) * 1.6, len * 0.5, w * 0.6); }
    x.stroke();
  };
  for (let k = 0; k < 26; k++) { const side = k % 2 ? 1 : -1; const px = W * 0.25 + side * (W * 0.12 + rnd() * W * 0.08), py = H * (0.3 + rnd() * 0.4); vein(px, py, side > 0 ? Math.PI + (rnd() - 0.5) * 0.8 : (rnd() - 0.5) * 0.8, 6 + rnd() * 10, 1.2 + rnd() * 1.4); }
  // the iris, filmed over; a limbal ring; a dim pupil
  const ir = x.createRadialGradient(W * 0.25, H * 0.5, 2, W * 0.25, H * 0.5, 34);
  ir.addColorStop(0, 'rgba(120,124,128,0.9)'); ir.addColorStop(0.25, 'rgba(176,182,186,0.85)'); ir.addColorStop(0.8, 'rgba(198,204,206,0.8)'); ir.addColorStop(0.95, 'rgba(120,124,126,0.85)'); ir.addColorStop(1, 'rgba(120,124,126,0)');
  x.fillStyle = ir; x.beginPath(); x.ellipse(W * 0.25, H * 0.5, 34, 30, 0, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  _realEye = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.12, metalness: 0, envMapIntensity: 0.8 });
  return _realEye;
}
const REAL_EYE_GEO = new THREE.SphereGeometry(1, 32, 20);

// ---------------------------------------------------------------- extras
function wingGeometry(s, span) {
  // membrane between three bones, scalloped along the trailing edge; x along the span
  const g = new THREE.BufferGeometry(); const pos = [], ind = [], sk = [], sw = [];
  const cols = 14, rows = 6;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const u = c / cols, v = r / rows;
    const x = s * u * span;
    const drop = (0.25 + 1.0 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85)) * span * 0.55;
    const scallop = r === rows ? Math.abs(Math.sin(u * Math.PI * 4.5)) * 0.2 * span : 0;
    const y = Math.sin(u * 2.6) * 0.1 * span * (1 - v) - v * drop + scallop;
    pos.push(x, y, -v * 0.1 * span - Math.sin(u * Math.PI) * 0.04 * span);
    // bones: 0 shoulder, 1 elbow (u .38), 2 wrist (u .7)
    const w1 = clamp((u - 0.15) / 0.3, 0, 1), w2 = clamp((u - 0.55) / 0.25, 0, 1);
    sk.push(0, 1, 2, 0); sw.push((1 - w1), w1 * (1 - w2), w1 * w2, 0);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c; ind.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1); }
  // finger bones along the membrane's struts
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ind);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sk, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.computeVertexNormals();
  return g;
}
const WING_MAT = new THREE.MeshStandardMaterial({ color: 0x241618, emissive: 0x120202, roughness: 0.65, side: THREE.DoubleSide });
const BONE_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1614, roughness: 0.5 });
function addWings(B, root, span) {
  const chest = B.chest; const wings = {};
  for (const [k, s] of [['R', -1], ['L', 1]]) {
    const b0 = new THREE.Bone(), b1 = new THREE.Bone(), b2 = new THREE.Bone();
    b0.position.set(s * 0.08, 0.12, -0.12); b1.position.set(s * span * 0.38, 0, 0); b2.position.set(s * span * 0.32, 0, 0);
    for (const b of [b0, b1, b2]) b.rotation.order = 'YXZ';
    chest.add(b0); b0.add(b1); b1.add(b2);
    const g = wingGeometry(s, span);
    const m = new THREE.SkinnedMesh(g, WING_MAT); m.castShadow = true; m.frustumCulled = false;
    root.add(m);
    // the bony frame: humerus, forearm and three long fingers to the scalloped edge
    const strut = (a, b, r0, r1) => { const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); const c = new THREE.CylinderGeometry(r1, r0, len, 6); c.translate(0, len / 2, 0); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); c.translate(a.x, a.y, a.z); return new THREE.Mesh(c, BONE_MAT); };
    const P = (u, v) => { const x = s * u * span, drop = (0.25 + 1.0 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85)) * span * 0.55; return new THREE.Vector3(x, Math.sin(u * 2.6) * 0.1 * span * (1 - v) - v * drop, -v * 0.1 * span - Math.sin(u * Math.PI) * 0.04 * span); };
    const e0 = P(0.38, 0), e1 = P(0.7, 0);
    b0.add(strut(new THREE.Vector3(), e0, 0.03, 0.022));
    const f1 = strut(new THREE.Vector3(), e1.clone().sub(e0), 0.022, 0.014); b1.add(f1);
    for (const u of [0.48, 0.74, 1.0]) b2.add(strut(new THREE.Vector3(), P(u, 1).sub(e1), 0.012, 0.003));
    b2.add(strut(new THREE.Vector3(), P(1.0, 0).sub(e1), 0.013, 0.002));
    wings[k] = { b0, b1, b2, mesh: m, s };
  }
  return wings;
}
function bindWings(wings, root) {
  // the membranes are authored in each wing's shoulder-bone space; bind them in the body's space
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  for (const k in wings) {
    const w = wings[k];
    w.mesh.geometry.applyMatrix4(inv.clone().multiply(w.b0.matrixWorld));
    w.mesh.updateMatrixWorld(true);
    w.mesh.bind(new THREE.Skeleton([w.b0, w.b1, w.b2]), w.mesh.matrixWorld);
  }
}
function hornGeo(len, r, curl, seg = 12) {
  const pts = []; for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push(new THREE.Vector3(0, Math.sin(t * curl) * len * 0.55, -(1 - Math.cos(t * curl)) * len * 0.5 + t * len * 0.15)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tg = new THREE.TubeGeometry(curve, seg * 2, r, 7, false);
  const pos = tg.attributes.position; const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const ring = Math.floor(i / 8); const t = ring / (seg * 2); const c = curve.getPoint(t); v.fromBufferAttribute(pos, i).sub(c).multiplyScalar(1 - t * 0.94).add(c); pos.setXYZ(i, v.x, v.y, v.z); }
  tg.computeVertexNormals(); return tg;
}
const HORN_MAT = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.55 });
const CLOTH_MAT = new THREE.MeshStandardMaterial({ color: 0x0d0b0a, roughness: 0.95, side: THREE.DoubleSide });
function robeGeo(top, bottom, len) {
  const g = new THREE.CylinderGeometry(top, bottom, len, 18, 8, true); g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i)); const t = -y / len;
    const fold = Math.sin(a * 9) * 0.025 * t + Math.sin(a * 4 + 1) * 0.02 * t;
    const r = Math.hypot(p.getX(i), p.getZ(i)) + fold;
    p.setXYZ(i, Math.cos(a) * r, y + (t > 0.85 ? Math.abs(Math.sin(a * 7.3) * Math.sin(a * 3.1)) * 0.16 : 0), Math.sin(a) * r);
  }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- build a body
export function buildHorror(kind, def) {
  const K = DB.kinds[kind];
  const mat = demonSkin(def.rim, { skin: def.skin ?? 0x141012, dead: !!def.dead });
  const bones = K.joints.map((j) => { const b = new THREE.Bone(); b.name = j.name; b.position.fromArray(j.pos); b.rotation.order = 'YXZ'; return b; });
  const idx = {}; K.joints.forEach((j, i) => (idx[j.name] = i));
  K.joints.forEach((j, i) => { if (j.parent) bones[idx[j.parent]].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(K.geo, mat);
  mesh.add(bones[0]);
  bones.forEach((b, i) => { const q = K.bind[K.joints[i].name]; b.quaternion.set(q[0], q[1], q[2], q[3]); });
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
  const B = {}; K.joints.forEach((j, i) => (B[j.name] = bones[i]));
  // eyes, sunk in the sockets
  for (const e of K.eyes) {
    const real = !!def.realEyes;
    const m = new THREE.Mesh(real ? REAL_EYE_GEO : EYE_GEO, real ? dissolvable(realEyeMat().clone(), mat.userData.u.uDissolve) : EYE_MAT); m.scale.setScalar(e[3] * (real ? 1.0 : 0.92)); m.position.set(e[0], e[1], e[2] - e[3] * (real ? 0.32 : 0.1));
    if (real) m.rotation.y = e[0] * 1.5;   // a slight outward turn: eyes that look past you as much as at you
    m.userData.eye = true; B.head.add(m);
  }
  if (def.dead) {   // the wrists, in the mesh's bind space, for folding the old hands away
    mesh.updateMatrixWorld(true); const u = mat.userData.u;
    u.uWristR.value.copy(B.handR.getWorldPosition(new THREE.Vector3())); u.uWristL.value.copy(B.handL.getWorldPosition(new THREE.Vector3()));
    u.uHandR.value = K.joints.findIndex((j) => j.name === 'handR'); u.uHandL.value = K.joints.findIndex((j) => j.name === 'handL');
  }
  {   // where the eyes sit in the mesh's own space: sockets, and what runs down from them
    mesh.updateMatrixWorld(true); const ey = B.head.children.filter((m) => m.userData.eye).map((m) => m.getWorldPosition(new THREE.Vector3()));
    if (ey.length === 2) { mat.userData.u.uEyeL.value.copy(ey[0]); mat.userData.u.uEyeR.value.copy(ey[1]); }
  }
  // extras that ride on the bones (in their bind-pose frames)
  const extras = [];
  const headLocal = (x, y, z) => new THREE.Vector3(x, y, z);
  const eyeY = K.eyes[0][1], eyeZ = K.eyes[0][2];
  const hs = K.height / 1.78;   // the head grows with the body; so do its horns
  if (def.horns && !def.hooded) {
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(hornGeo(def.horns[0], def.horns[1], def.horns[2]), HORN_MAT); h.castShadow = true; h.scale.setScalar(hs);
      h.position.copy(headLocal(s * 0.055 * hs, eyeY + 0.06 * hs, eyeZ - 0.06 * hs)); h.rotation.set(-0.25, s * 0.5, -s * 0.55);
      B.head.add(h); extras.push(h);
    }
  }
  if (def.crown) {
    for (let i = 0; i < 7; i++) {
      const a = (i - 3) * 0.32;
      const h = new THREE.Mesh(hornGeo(0.12 + (i === 3 ? 0.08 : 0) + (3 - Math.abs(i - 3)) * 0.02, 0.012, 1.0, 8), HORN_MAT); h.scale.setScalar(hs * 1.3);
      h.position.set(Math.sin(a) * 0.08 * hs, eyeY + 0.07 * hs, eyeZ - (0.07 + Math.cos(a) * 0.04) * hs); h.rotation.set(-0.5, 0, -a * 0.9);
      B.head.add(h);
    }
  }
  if (def.spikes) {
    for (let i = 0; i < 6; i++) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(0.03 + (i % 3) * 0.01, 0.18 + (i % 3) * 0.06, 5), HORN_MAT);
      const b = i < 3 ? B.chest : B.spine; h.position.set((i % 2 ? 1 : -1) * 0.05, 0.05 + (i % 3) * 0.1, -0.14); h.rotation.set(-1.1, 0, (i % 2 ? -1 : 1) * 0.3);
      b.add(h);
    }
  }
  if (def.robe) {
    const r = new THREE.Mesh(robeGeo(0.2, 0.46, 0.95), CLOTH_MAT); r.position.set(0, 0.12, 0); r.castShadow = true; B.hips.add(r); extras.push(r);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.68), CLOTH_MAT);
    hood.scale.set(1.05, 1.2, 1.25); hood.position.set(0, eyeY + 0.0, eyeZ - 0.09); hood.rotation.x = -0.35; B.head.add(hood);
    const shawl = new THREE.Mesh(robeGeo(0.12, 0.3, 0.45), CLOTH_MAT); shawl.position.set(0, 0.25, 0); B.chest.add(shawl);
  }
  if (def.boils) {
    // weeping pustules half-sunk in the swollen flesh
    const bm = new THREE.MeshStandardMaterial({ color: 0x4a3418, emissive: new THREE.Color(def.rim).multiplyScalar(0.12), roughness: 0.18 });
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.018 + (i % 3) * 0.01, 8, 6), bm);
      const a = i * 2.4, y = -0.08 + (i % 5) * 0.06; s.position.set(Math.sin(a) * 0.2, y, Math.cos(a) * 0.17 + 0.1); s.scale.set(1, 1, 0.6); s.lookAt(0, y, 0.05); B.spine.add(s);
    }
  }
  if (def.cloak) {
    // a long ragged cloak hung from the shoulders, open at the front
    const L = def.cloak, g = new THREE.CylinderGeometry(0.34 * hs, 0.9 * hs, L, 24, 10, true, PI * 0.28, PI * 1.44); g.translate(0, -L / 2 + 0.05, -0.02);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), a = Math.atan2(p.getX(i), p.getZ(i)), t = clamp(-y / L, 0, 1);
      const r = Math.hypot(p.getX(i), p.getZ(i)) + Math.sin(a * 11) * 0.04 * t + Math.sin(a * 5 + 2) * 0.05 * t;
      p.setXYZ(i, Math.sin(a) * r, y + (t > 0.8 ? Math.abs(Math.sin(a * 13.7) * Math.sin(a * 5.3)) * 0.4 * hs : 0), Math.cos(a) * r);
    }
    g.computeVertexNormals();
    const c = new THREE.Mesh(g, CLOTH_MAT); c.position.set(0, 0.22 * hs, 0); c.castShadow = true; B.chest.add(c);
  }
  if (def.eyeScale) for (const m of B.head.children) if (m.userData.eye) {
    m.scale.multiplyScalar(def.eyeScale);
    // a pinprick of red at the centre of each (He alone has eyes of pure white)
    if (!def.hooded) { const pu = new THREE.Mesh(EYE_GEO, PUPIL_MAT); pu.scale.setScalar(0.22); pu.position.set(0, 0, 0.93); m.add(pu); }
  }
  let wings = null;
  if (def.wings) wings = addWings(B, mesh, def.wings);
  mesh.updateMatrixWorld(true);
  if (wings) bindWings(wings, mesh);
  // back to rest: limbs straight, the animation works from here
  for (const b of bones) { b.quaternion.identity(); b.userData.rest = b.position.clone(); }
  // hands too big and fingers too long for any man
  if (!def.dead && !def.big && B.handR) for (const k of ['R', 'L']) B['hand' + k].scale.set(1.2, 1.45, 1.2);
  if (def.hooded) { dressDevil.horn = null; dressDevil(B, K, def, def.dead ? mat.userData.u.uDissolve : null); }
  if (def.dead) {   // long, bony, real hands: pale skin over the knuckles, yellowed nails
    const DU = mat.userData.u.uDissolve;
    const skin = dissolvable(new THREE.MeshStandardMaterial({ color: def.skin ?? 0x8e9592, roughness: 0.6 }), DU), nail = dissolvable(new THREE.MeshStandardMaterial({ color: 0x6a6252, roughness: 0.4 }), DU);
    for (const [k, side] of [['R', -1], ['L', 1]]) { const h = mergeByMaterial(realHand(side, { skin, nail, scale: K.height / 1.78 * 0.95, long: def.fingers || 1.55, thin: 0.8, curl: 0.4 })); B['hand' + k].add(h); }
  }
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return { mesh, B, mat, wings, height: K.height };
}

// ---------------------------------------------------------------- Him, on a man's body
// The same MakeHuman body the knights and the priest are made from, but dead: grey and waxen, the eyes clouded,
// drawn out far too tall and thin, the forearms and fingers too long. His robe, hood and horns over it.
export function buildHumanDevil(def) {
  const H = humanBody({ skin: def.skin ?? 0x8e9592, hair: 0x14100e, cloth: 0x6c726f, age: 1, dead: 1 }); if (!H) return null;
  const { rig, mesh } = H, B = { ...rig.j }, mat = mesh.material;
  const DU = { value: 0 }; mat.userData.u = { uDissolve: DU, uTime: { value: 0 } }; dissolvable(mat, DU);
  B.jaw = new THREE.Object3D(); B.head.add(B.jaw);
  for (const b of Object.values(rig.j)) b.rotation.order = 'YXZ';
  // gaunt: the limbs drawn out (the skin stretches with them), hands and fingers long
  for (const k of ['R', 'L']) { B['fArm' + k].position.multiplyScalar(1.12); B['hand' + k].scale.set(1.08, 1.35, 1.08); B['shin' + k].position.multiplyScalar(1.06); B['foot' + k].position.multiplyScalar(1.04); }
  B.neck.position.multiplyScalar(1.25);
  const root = new THREE.Group(); root.add(rig.root); root.updateMatrixWorld(true);
  // stand him on his soles
  { const v = new THREE.Vector3(); let low = 1e9; const n = mesh.geometry.attributes.position.count; for (let i = 0; i < n; i += 5) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); low = Math.min(low, v.y); } rig.root.position.y -= low; root.updateMatrixWorld(true); }
  // fit the hood (made for the old skull: centre about (0, 0.065, 0.11), ±0.17 across) to this head
  const hb = headBox(mesh), hc = hb.getCenter(new THREE.Vector3()), hz = hb.getSize(new THREE.Vector3());
  const sc = (hz.x / 2 + 0.012) / 0.17;
  const fit = { ...def, headFit: { s: sc, off: new THREE.Vector3(hc.x, hc.y - 0.065 * sc + 0.01, hc.z - 0.11 * sc) }, robeW: 0.56, sleeveW: 0.62 };
  dressDevil.horn = null; dressDevil(B, null, fit, DU);
  for (const b of Object.values(rig.j)) b.userData.rest = b.position.clone();
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  return { mesh: root, B, mat, wings: null, height: 2.0 };
}

// ---------------------------------------------------------------- His garb
// A deep hood over a pale, human face; a robe that pools on the ground; long sleeves the
// white hands hang out of; ram horns rooted in the skull, breaking out through the cloth.
// Built at rest (bones unrotated, so every bone frame is the model frame).
// heavy black wool: a coarse weave in the normal map, a faint sheen at grazing angles, and a slow stir of wind
// that grows toward the hem (y below the garment's top, in its own space, scaled by uSway)
let _robeMat = null;
// The Devil's garments, horns, eyes and hands come and go with his flesh: the same burning dissolve as his skin,
// driven by the same uniform, so nothing pops in whole while the face is still forming out of the air.
export function dissolvable(mat, DU) {
  if (!DU) return mat;
  const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : mat.type;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    sh.uniforms.uDissolve = DU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vDsP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDsP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vDsP; uniform float uDissolve;
      float dsh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float dsn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(dsh(i), dsh(i+vec3(1,0,0)), f.x), mix(dsh(i+vec3(0,1,0)), dsh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(dsh(i+vec3(0,0,1)), dsh(i+vec3(1,0,1)), f.x), mix(dsh(i+vec3(0,1,1)), dsh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  float dsz = dsn(vDsP * 7.0) * 0.65 + dsn(vDsP * 19.0) * 0.35; if (uDissolve > 0.0 && dsz < uDissolve) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 5.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dsz));');
  };
  mat.customProgramCacheKey = () => key + '|dslv';
  return mat;
}
// bake a hand built of many little meshes into one mesh per material (two draw calls instead of ~40)
function mergeByMaterial(group) {
  group.updateMatrixWorld(true); const inv = group.matrixWorld.clone().invert(); const by = new Map();
  group.traverse((o) => { if (!o.isMesh) return; const g = o.geometry.clone(); for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); const ng = g.index ? g.toNonIndexed() : g; ng.applyMatrix4(inv.clone().multiply(o.matrixWorld)); if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(ng); });
  for (const c of [...group.children]) group.remove(c);
  for (const [m, gs] of by) { const mesh = new THREE.Mesh(mergeGeometries(gs), m); mesh.castShadow = true; group.add(mesh); }
  return group;
}
const ROBE_U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0, 0) } };
function robeMat(sway, top, DU) {
  const ct = clothTextures([26, 22, 24], false, 256, 'devilwool');
  const m = new THREE.MeshPhysicalMaterial({ color: 0x0d0b0c, map: ct.map, normalMap: ct.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.92, sheen: 0.5, sheenRoughness: 0.75, sheenColor: new THREE.Color(0x2a2630), side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ROBE_U.uTime; sh.uniforms.uWind = ROBE_U.uWind; sh.uniforms.uSway = { value: sway }; sh.uniforms.uTop = { value: top };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uSway, uTop;\nuniform vec2 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float hang = max(0.0, uTop - position.y); float w = hang * hang * uSway;
        float ang = atan(position.x, position.z);
        transformed.x += w * (sin(uTime * 0.9 + ang * 2.0 + position.y * 1.3) * 0.6 + sin(uTime * 2.3 + ang * 5.0) * 0.25);
        transformed.z += w * (cos(uTime * 0.7 + ang * 3.0 + position.y * 1.1) * 0.5);
        // a hard wind from one side: the cloth streams out, gusting, rippling along its length
        float gust = 0.75 + 0.25 * sin(uTime * 1.7) + 0.15 * sin(uTime * 4.3 + 1.0);
        float flap = sin(uTime * 7.0 - hang * 9.0 + ang * 2.0) * 0.18 + sin(uTime * 11.0 - hang * 14.0) * 0.08;
        float lee = 0.6 + 0.4 * dot(normalize(vec2(position.x, position.z) + 1e-4), normalize(uWind + 1e-4));
        vec2 wd = uWind * hang * (0.6 + hang * 0.5) * gust * lee;
        transformed.x += wd.x + flap * uWind.y * hang; transformed.z += wd.y + flap * uWind.x * hang;
        transformed.y += length(wd) * 0.35 * hang;`);
  };
  m.customProgramCacheKey = () => 'devilRobe';   // sway and top are uniforms: one shader for every garment
  return dissolvable(m, DU);
}
export function tickRobes(time) { ROBE_U.uTime.value = time; }
// The robe hangs. Whatever the body inside it is doing (stooped, lunging, crouched), the cloth falls plumb from the
// collar and its hem lies on the ground, gathered a little there (sink), rather than swinging stiffly with the chest
// and lifting off the earth behind him. root: the model's own group, whose y = 0 is the ground under him.
const _rbM = new THREE.Matrix4(), _rbQ = new THREE.Quaternion(), _rbP = new THREE.Vector3(), _rbS = new THREE.Vector3(), _rbC = new THREE.Vector3();
export function plantRobe(B, root, sink = 0.04) {
  const robe = B.robe; if (!robe || !robe.visible || robe.userData.L === undefined) return;
  const u = robe.userData;
  root.updateMatrixWorld(true);
  // the chest in the model's own (unscaled) frame: a rigid transform, the chain of bones down from the hips
  _rbM.copy(root.matrixWorld).invert().multiply(B.chest.matrixWorld); _rbM.decompose(_rbP, _rbQ, _rbS);
  // where the collar sits on him now, in that frame
  _rbC.copy(u.pos0); _rbC.y += u.top; _rbC.applyQuaternion(_rbQ).add(_rbP);
  // the length that takes it from the collar to the ground
  const sy = clamp((_rbC.y + sink) / (u.top + u.L), 0.55, 1.25);
  // undo the chest's turn so the robe is upright in the model's frame, hanging from the collar
  _rbQ.invert(); robe.quaternion.copy(_rbQ);
  robe.scale.set(u.base.x, sy, u.base.z);
  // position (chest frame) = R^-1 (collar - scale * collar-in-robe - chest origin)
  robe.position.set(_rbC.x - _rbP.x, _rbC.y - sy * u.top - _rbP.y, _rbC.z - _rbP.z).applyQuaternion(_rbQ);
}
// wind on the Devil's robes, in his own frame (+x his left)
export function robeWind(x, z) { ROBE_U.uWind.value.set(x, z); }
function lathe(profile, segs, shape) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v, Math.atan2(v.x, v.z)); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
// a little value noise for wrinkles
const wn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, g2 = y - j; const h = (a, b) => { const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return t - Math.floor(t); }; const u = f * f * (3 - 2 * f), v = g2 * g2 * (3 - 2 * g2); return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
function dressDevil(B, K, def, DU) {
  const chestY = B.chest.getWorldPosition(new THREE.Vector3()).y;   // mesh is at the origin, at rest
  const neckTop = B.neck.position.y;                                    // neck base, in the chest's frame
  const L = chestY - 0.02;                                              // to the ground
  // the robe: gathered at the throat, broad over the shoulders, then falling in deep pleats to a hem that pools and drags
  const prof = [[0.15, neckTop + 0.03], [0.38, neckTop - 0.07], [0.58, 0.17], [0.55, 0.03], [0.42, -0.2], [0.41, -0.5], [0.45, -0.8], [0.54, -1.25], [0.7, -1.85], [0.9, -L + 0.06], [0.98, -L]];
  const pts = []; for (let i = 0; i < prof.length - 1; i++) for (let k = 0; k < 4; k++) { const t = k / 4; pts.push([lerp(prof[i][0], prof[i + 1][0], t), lerp(prof[i][1], prof[i + 1][1], t)]); } pts.push(prof[prof.length - 1]);
  const robeGeo = lathe(pts, 96, (v, a) => {
    const t = clamp(-v.y / L, 0, 1);
    // pleats: few and soft at the shoulders, deep and many below the waist, each one wandering
    const pleat = Math.sin(a * 11 + Math.sin(v.y * 2.1 + a) * 0.9) * (0.012 + 0.06 * t) + Math.sin(a * 5 + 1.3 + v.y * 0.7) * 0.035 * t;
    // wrinkles where the cloth breaks over the shoulders and bunches at the waist
    const wr = (wn(a * 6, v.y * 9) - 0.5) * 0.03 * (Math.exp(-(((v.y - 0.12) / 0.12) ** 2)) + Math.exp(-(((v.y + 0.45) / 0.15) ** 2)));
    const r = Math.hypot(v.x, v.z) + pleat + wr;
    v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.82 + 0.07;
    if (t > 0.96) v.y += Math.abs(Math.sin(a * 7.3) * Math.sin(a * 3.1)) * 0.1 - 0.02;   // the hem, uneven, dragging
  });
  const robe = new THREE.Mesh(robeGeo, robeMat(0.03, neckTop, DU)); robe.castShadow = true; B.chest.add(robe); B.robe = robe; if (def.robeW) { robe.scale.set(def.robeW, 1, def.robeW * 1.45); robe.position.z += 0.04; }
  robe.userData.base = robe.scale.clone(); robe.userData.pos0 = robe.position.clone(); robe.userData.top = neckTop + 0.03; robe.userData.L = L;
  // sleeves: wide and long, falling in folds, the hands hang out of them
  for (const k of ['R', 'L']) {
    const ul = Math.abs(B['fArm' + k].position.y), fl = Math.abs(B['hand' + k].position.y);
    const up = new THREE.Mesh(lathe([[0.15, 0.06], [0.16, -ul * 0.3], [0.155, -ul * 0.65], [0.165, -ul - 0.02]], 24, (v, a) => { const r = Math.hypot(v.x, v.z) + Math.sin(a * 6 + v.y * 4) * 0.012 + (wn(a * 4, v.y * 12) - 0.5) * 0.02; v.x = Math.sin(a) * r; v.z = Math.cos(a) * r; }), robeMat(0.0, 0, DU)); B['uArm' + k].add(up);
    const lo = new THREE.Mesh(lathe([[0.16, 0.02], [0.19, -fl * 0.4], [0.27, -fl * 0.75], [0.31, -fl * 0.88], [0.3, -fl * 0.92]], 28, (v, a) => {
      const t = -v.y / fl; const r = Math.hypot(v.x, v.z) + Math.sin(a * 7 + v.y * 3) * 0.018 * t + (wn(a * 5, v.y * 10) - 0.5) * 0.02;
      v.x = Math.sin(a) * r; v.z = Math.cos(a) * r; if (t > 0.85) v.y += Math.abs(Math.sin(a * 5.1)) * 0.06 - Math.max(0, -Math.cos(a)) * 0.08;   // the cuff hangs lower behind
    }), robeMat(0.06, 0, DU));
    B['fArm' + k].add(lo); up.castShadow = lo.castShadow = true;
    (B.sleeves ||= []).push(up, lo);
    if (def.sleeveW) { up.scale.set(def.sleeveW, 1, def.sleeveW); lo.scale.set(def.sleeveW, 1, def.sleeveW); }
  }
  // the hood. It rests on the skull and comes down over the brow, so the face is a pale shape in its shadow:
  // a little of the eyes beneath the edge, the cheekbones, the mouth. Below the jaw the cowl falls onto the shoulders.
  // (the skull runs about ±0.17 across, -0.15..0.28 up and -0.09..0.31 front to back of the head joint)
  const NU = 56, NV = 30, pos = [], idx = [];
  const C = [0, 0.07, 0.035], RX = 0.215, RY = 0.27, RZ = 0.255;
  const openW = (t) => t < 0.52 ? -1 : 0.36 + (t - 0.52) * 0.55;          // half-width of the face opening (radians) by depth
  for (let j = 0; j <= NV; j++) {
    const t = j / NV, ph = t * Math.PI * 0.86;
    for (let i = 0; i <= NU; i++) {
      const a = (i / NU) * Math.PI * 2 - Math.PI;                          // 0 = straight ahead
      let rx = RX, rz = RZ, y = C[1] + Math.cos(ph) * RY;
      const sp = Math.sin(ph);
      // the brow: the front edge of the cowl overhangs the eyes
      const front = Math.max(0, Math.cos(a)) ** 3, brim = Math.exp(-(((t - 0.52) / 0.09) ** 2));
      rz += front * brim * 0.06; y -= front * brim * 0.025;
      // the peak at the back, and the cowl sagging there in a long fold
      const back = Math.max(0, -Math.cos(a));
      if (t < 0.45) y += back * back * (0.45 - t) * 0.12;
      // below the jaw it spreads over the shoulders
      if (t > 0.68) { const f = (t - 0.68) / 0.32; rx *= 1 + f * 0.9; rz *= 1 + f * 0.55; y -= f * f * 0.12; }
      // folds and creases: radial ripples that deepen toward the bottom, a crumple at the nape
      const fold = Math.sin(a * 9 + t * 4) * 0.012 * t + (wn(a * 5 + 3, t * 8) - 0.5) * 0.03 * t + Math.exp(-(((a - Math.PI) / 0.5) ** 2 + ((t - 0.6) / 0.12) ** 2)) * 0.03;
      const r = 1 + fold / 0.22;
      pos.push(C[0] + Math.sin(a) * sp * rx * r, y, C[2] + Math.cos(a) * sp * rz * r);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const t = (j + 0.5) / NV, a = ((i + 0.5) / NU) * Math.PI * 2 - Math.PI;
    if (Math.abs(a) < openW(t)) continue;                                  // the opening for the face
    const p0 = j * (NU + 1) + i, p1 = p0 + 1, p2 = p0 + NU + 1, p3 = p2 + 1;
    idx.push(p0, p2, p1, p1, p2, p3);
  }
  const hood = new THREE.BufferGeometry(); hood.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv = []; for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) uv.push(i / NU * 3, j / NV * 2); hood.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hood.setIndex(idx); hood.computeVertexNormals();
  const hg = new THREE.Group(); B.head.add(hg);
  if (def.headFit) { hg.scale.setScalar(def.headFit.s); hg.position.copy(def.headFit.off); }
  const hm = new THREE.Mesh(hood, robeMat(0.02, 0.0, DU)); hm.castShadow = true; hg.add(hm);
  // ram horns rooted inside the skull above the temples, breaking out through the hood and curling back
  if (def.horns) for (const s of [-1, 1]) {
    const h = new THREE.Mesh(hornGeo(def.horns[0], def.horns[1], def.horns[2]), DU ? (dressDevil.horn ||= dissolvable(HORN_MAT.clone(), DU)) : HORN_MAT); h.castShadow = true;
    h.position.set(s * 0.11, 0.19, 0.05); h.rotation.set(-0.15, s * 0.75, -s * 1.15);   // out to the sides, then back and down round the hood, a ram's curl
    if (def.headFit) h.scale.setScalar(1.45);
    hg.add(h);
  }
}

// ---------------------------------------------------------------- motion
const e = (b, x, y, z) => b.rotation.set(x * D2R, y * D2R, z * D2R);
const add = (b, x, y, z) => { b.rotation.x += x * D2R; b.rotation.y += y * D2R; b.rotation.z += z * D2R; };
const sinp = (t) => Math.sin(t * TAU);
const H = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const ST = { spawn: 0, chase: 1, windup: 2, strike: 3, recover: 4, stagger: 5, dead: 6, special: 7, flee: 8, leap: 9 };

// Fits, twitches and stutters run on every client independently: they are
// performance, not gameplay. Screams are reported so the audio can play them.
export function horrorTick(d, dt, time, near) {
  const h = d.h || (d.h = { shake: 0, shakeDur: 0, twitch: 0, tw: [0, 0, 0, 0], stutter: 0, next: 2 + Math.random() * 6, nextTw: 0.5, tilt: (Math.random() - 0.5) * 50 });
  if (d.state === ST.dead) return h;
  h.next -= dt; h.nextTw -= dt;
  if (h.shake > 0) h.shake -= dt;
  if (h.twitch > 0) h.twitch -= dt;
  if (h.stutter > 0) h.stutter -= dt;
  if (h.next <= 0 && near) {
    h.next = 5 + Math.random() * 9;
    if (Math.random() < 0.6) { h.shakeDur = h.shake = 0.6 + Math.random() * 0.9; d.wantScream = 'shake'; }
    else { h.stutter = 0.1 + Math.random() * 0.22; }
  }
  if (h.nextTw <= 0) { h.nextTw = 0.25 + Math.random() * 1.6; h.twitch = 0.07 + Math.random() * 0.08; h.tw = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]; }
  return h;
}
// head shaking fit + twitches layered on whatever the body is doing
function overlay(d, B, time, k = 1) {
  const h = d.h; if (!h) return;
  if (h.shake > 0) {
    const env = Math.sin(clamp(1 - h.shake / h.shakeDur, 0, 1) * Math.PI) ** 0.5 * k;
    const t = time * TAU;
    add(B.head, Math.sin(t * 7.3) * 14 * env, Math.sin(t * 13) * 42 * env, Math.sin(t * 9.1 + 1) * 24 * env);
    add(B.neck, 0, Math.sin(t * 13 + 0.6) * 16 * env, Math.sin(t * 6) * 8 * env);
    add(B.jaw, 45 * env, 0, Math.sin(t * 17) * 6 * env);
    add(B.chest, -8 * env, Math.sin(t * 6.5) * 6 * env, 0);
  }
  if (h.twitch > 0) {
    const a = h.twitch * 12 * k;
    add(B.head, h.tw[0] * 40 * a, h.tw[1] * 60 * a, h.tw[2] * 50 * a);
    add(B.uArmR, h.tw[3] * 40 * a, 0, h.tw[0] * 25 * a); add(B.uArmL, h.tw[1] * 40 * a, 0, h.tw[2] * 25 * a);
    add(B.chest, 0, h.tw[2] * 15 * a, h.tw[3] * 10 * a);
  }
}

// the head never still: it snaps to a new angle every fraction of a second as if wrenched by something inside,
// trembles there, and now and then thrashes violently; the jaw hangs open and chatters
function spasm(d, B, time, dt, k = 1) {
  const S = d.sp || (d.sp = { t: 0, tg: [0, 0, 0], cur: [0, 0, 0] });
  S.t -= dt;
  if (S.t <= 0) {
    const big = Math.random() < 0.12;
    S.t = big ? 0.06 + Math.random() * 0.08 : 0.12 + Math.random() * 0.45;
    const m = big ? 2.2 : 1;
    S.tg = [(Math.random() - 0.5) * 34 * m, (Math.random() - 0.5) * 70 * m, (Math.random() - 0.5) * 60 * m];
  }
  for (let i = 0; i < 3; i++) S.cur[i] += (S.tg[i] - S.cur[i]) * Math.min(1, dt * 38);   // a snap, not a turn
  const tr = Math.sin(time * 47 + d.seed) * 3 + Math.sin(time * 31) * 2;
  add(B.head, (S.cur[0] + tr) * k, (S.cur[1] + tr * 0.6) * k, (S.cur[2] + tr) * k);
  add(B.neck, S.cur[0] * 0.35 * k, S.cur[1] * 0.3 * k, S.cur[2] * 0.25 * k);
  if (B.jaw) add(B.jaw, (14 + Math.max(0, Math.sin(time * 21 + d.seed)) * 18 + Math.abs(S.cur[1]) * 0.2) * k, 0, Math.sin(time * 17) * 4 * k);
}
// a loping, hunched biped gait
function legs(B, ph, run, o = {}) {
  const stride = o.stride ?? 1, crouch = o.crouch ?? 15;
  for (const [k, sg, off] of [['R', -1, 0], ['L', 1, 0.5]]) {
    const p = (ph + off) % 1, sw = sinp(p), cw = Math.cos(p * TAU);
    e(B['thigh' + k], -sw * 42 * run * stride - crouch - (o.wide ? 0 : 0), 0, sg * (4 + (o.wide || 0)));
    e(B['shin' + k], crouch * 1.4 + Math.max(0, cw) * 75 * run * stride + 6, 0, 0);
    e(B['foot' + k], -crouch * 0.4 + sw * 18 * run - 6, 0, 0);
  }
}
function arms(B, ph, run, time, seed, mode = 'trail') {
  for (const [k, sg, off] of [['R', -1, 0.5], ['L', 1, 0]]) {
    const p = (ph + off) % 1, sw = sinp(p);
    const idle = Math.sin(time * 1.7 + seed + off * 7) * 6;
    if (mode === 'trail') { // flung back while sprinting, dangling and clawing at rest
      e(B['clav' + k], 0, 0, sg * -6); e(B['uArm' + k], lerp(-12 + idle, 52 + sw * 14, run), sg * 10 * run, sg * (10 + 16 * run));
      e(B['fArm' + k], lerp(-28, -12, run), 0, 0); e(B['hand' + k], lerp(-15, 25, run), 0, sg * 8);
    } else if (mode === 'reach') { // reaching out ahead, clawing the air
      const claw = Math.sin(time * 9 + seed + off * 4) * 12;
      e(B['clav' + k], -10, 0, sg * -8); e(B['uArm' + k], -75 + sw * 18 * run + claw * 0.5, -sg * 12, sg * 14);
      e(B['fArm' + k], -25 - claw, 0, 0); e(B['hand' + k], -20 + claw, 0, 0);
    } else if (mode === 'grasp') { // sprinting at you with both arms thrust out ahead, hands clawing, snatching on each stride
      const snatch = Math.max(0, sinp((ph + off + 0.25) % 1)) * run;
      const claw = Math.sin(time * 13 + seed + off * 5) * 0.5 + Math.sin(time * 29 + off * 3) * 0.5;
      e(B['clav' + k], -14 * run, 0, sg * -10 * run);
      e(B['uArm' + k], lerp(-12 + idle, -128 - snatch * 18 + claw * 5, run), -sg * 16 * run, sg * lerp(10, 6 + snatch * 6, run));   // the body is pitched far forward: this holds the arms out level, at you
      e(B['fArm' + k], lerp(-28, -4 - (1 - snatch) * 18, run), 0, 0);
      e(B['hand' + k], lerp(-15, 35 + claw * 30, run), 0, sg * claw * 12 * run);
    } else if (mode === 'swing') { // heavy pendulum (brute)
      e(B['clav' + k], 0, 0, 0); e(B['uArm' + k], -sw * 30 * run - 10 + idle, 0, sg * 16); e(B['fArm' + k], -25 - Math.max(0, -sw) * 30 * run, 0, 0); e(B['hand' + k], -10, 0, 0);
    } else { // hanging limp
      e(B['clav' + k], 0, 0, 0); e(B['uArm' + k], idle * 0.5 - 5, 0, sg * 6); e(B['fArm' + k], -10, 0, 0); e(B['hand' + k], -5, 0, 0);
    }
  }
}
function torso(B, ph, run, lean, time, seed, o = {}) {
  B.hips.position.copy(B.hips.userData.rest);
  B.hips.position.y -= (o.drop ?? 0.06) + Math.abs(Math.sin(ph * TAU)) * 0.07 * run;
  e(B.hips, 4 + lean * 0.2 * run, sinp(ph) * 10 * run, 0);
  e(B.spine, lean * 0.5 + 8 * run, -sinp(ph) * 6 * run, Math.sin(time * 0.7 + seed) * 4);
  e(B.chest, lean * 0.5 + 6 * run, -sinp(ph) * 8 * run, 0);
  e(B.neck, -lean * 0.45 - 6 * run, 0, 0);
  e(B.head, -lean * 0.35 - 4 * run, 0, 0);
}
function attackPose(d, B, T, o = {}) {
  const st = d.state;
  const w = st === ST.windup ? smooth(clamp(T / (o.wind || 0.4), 0, 1)) : st === ST.leap ? 1 : 0;
  const sk = st === ST.strike ? smooth(clamp(T / 0.16, 0, 1)) : st === ST.recover ? 1 - smooth(clamp(T / 0.45, 0, 1)) * 0.7 : 0;
  // wind up: rear back screaming, arms spread wide; strike: both claws rake down
  for (const [k, sg] of [['R', -1], ['L', 1]]) {
    const up = lerp(-60, -165, w), down = -25;
    const x = st === ST.windup || st === ST.leap ? up : lerp(-165, down, sk);
    e(B['uArm' + k], x, -sg * 10 * sk, sg * lerp(20, 55, w) * (1 - sk * 0.6));
    e(B['fArm' + k], -55 * w - 20 * (1 - sk), 0, 0); e(B['hand' + k], 25 * w - 30 * sk, 0, 0);
  }
  add(B.spine, -14 * w + 30 * sk, 0, 0); add(B.chest, -16 * w + 26 * sk, 0, 0);
  e(B.head, -30 * w + 12 * sk, 0, 0); e(B.jaw, 30 + 40 * w, 0, 0);
  if (st === ST.leap) { e(B.thighR, -75, 0, -6); e(B.thighL, -55, 0, 6); e(B.shinR, 110, 0, 0); e(B.shinL, 85, 0, 0); }
  return w + sk;
}
function deathPose(d, B, T, time) {
  const k = smooth(clamp(T / 0.6, 0, 1));
  B.hips.position.copy(B.hips.userData.rest); B.hips.position.y *= 1 - 0.62 * k;
  const conv = Math.sin(time * 37) * (1 - k) * 12 + Math.sin(time * 23) * 4 * clamp(1 - T, 0, 1);
  e(B.hips, -25 * k, 0, 10 * k); e(B.spine, 30 * k, 0, conv); e(B.chest, 20 * k, 0, -conv); e(B.head, 45 * k + conv, conv * 2, 20 * k); e(B.jaw, 50, 0, 0);
  for (const [k2, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k2], -30 * k + conv, 0, sg * 70 * k); e(B['fArm' + k2], -40, 0, 0); e(B['thigh' + k2], -70 * k, 0, sg * 10); e(B['shin' + k2], 90 * k, 0, 0); }
}
function spawnPose(d, B, T, time) {
  // clawing up out of the earth, head snapping about
  const k = clamp(T / 1.1, 0, 1);
  for (const [k2, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k2], -170 + k * 120 + Math.sin(time * 14 + sg) * 15, 0, sg * 25); e(B['fArm' + k2], -30, 0, 0); e(B['hand' + k2], -40, 0, 0); }
  e(B.spine, 45 - k * 35, 0, 0); e(B.head, -40 + Math.sin(time * 19) * 25 * (1 - k), Math.sin(time * 11) * 40 * (1 - k), 0); e(B.jaw, 55, 0, 0);
}

export const ANIM = {
  // gaunt sprinter: arms flung back, head low and level, jaw hanging
  shade(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    // a lurching, uneven stride: one leg seems to drag, then it lunges on
    this.phase += dt * s / 2.9 * (1 + 0.35 * Math.sin(time * 2.6 + this.seed) + 0.2 * Math.sin(time * 7.1));
    const ph = this.phase, run = clamp(s / 5, 0, 1);
    torso(B, ph, run, 34 + 12 * run, time, this.seed);
    add(B.hips, 0, 0, Math.sin(ph * TAU * 0.5 + this.seed) * 9 * run); add(B.spine, 0, 0, -Math.sin(ph * TAU * 0.5 + this.seed) * 7 * run);
    legs(B, ph, run, { crouch: 14, stride: 1.2 });
    arms(B, ph, run, time, this.seed, run > 0.3 ? 'grasp' : 'trail');
    e(B.head, -24 - 6 * run, 0, this.h ? this.h.tilt * (1 - run) : 0); e(B.jaw, 26 + Math.max(0, Math.sin(time * 4 + this.seed)) * 18, 0, 0);
    spasm(this, B, time, dt, 0.5 + 0.6 * run);
    if (st === ST.windup || st === ST.strike || st === ST.recover || st === ST.leap) attackPose(this, B, T, { wind: 0.4 });
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (st === ST.stagger) { add(B.chest, -25, 0, 15 * this.flinchDir); add(B.head, -35, 20 * this.flinchDir, 0); }
    if (this.flinch > 0) { B.chest.rotation.x -= this.flinch * 0.35; B.head.rotation.z += this.flinch * 0.4 * this.flinchDir; }
    if (st === ST.dead) deathPose(this, B, T, time);
    else overlay(this, B, time);
  },
  // belly-up spider-walk, head twisted round to face where it goes
  crawler(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 1.5;
    const ph = this.phase, run = clamp(s / 4, 0, 1);
    const r = B.hips.userData.rest;
    B.hips.position.set(r.x, 0.6 + Math.abs(Math.sin(ph * TAU * 2)) * 0.04 * run, r.z - 0.45);
    // belly to the sky: the torso lies level, head end first
    e(B.hips, -90 + Math.sin(time * 3 + this.seed) * 3, 180, Math.sin(ph * TAU) * 6 * run);
    e(B.spine, 4, Math.sin(ph * TAU) * 7 * run, 0); e(B.chest, 6, -Math.sin(ph * TAU) * 7 * run, 0);
    // the head bent all the way back, so it watches you upside down
    e(B.neck, 30, 0, 0); e(B.head, -95 + Math.sin(time * 6 + this.seed) * 8, Math.sin(time * 2.1 + this.seed) * 22 * (1 - run * 0.5), Math.sin(time * 9 + this.seed) * 10);
    e(B.jaw, 45 + Math.max(0, Math.sin(time * 5 + this.seed)) * 25, 0, 0);
    spasm(this, B, time, dt, 0.5);
    // diagonal pairs scuttle; knees and elbows jut up
    for (const [k, sg, off] of [['R', -1, 0], ['L', 1, 0.5]]) {
      const pa = (ph + off) % 1, la = Math.max(0, Math.sin(pa * TAU)) * run, sa = Math.cos(pa * TAU) * run;
      e(B['clav' + k], 0, 0, 0);
      e(B['uArm' + k], 112 - sa * 22 - la * 25, sg * 15, sg * (40 + la * 15)); e(B['fArm' + k], -55 - la * 30, 0, 0); e(B['hand' + k], 70, 0, sg * 10);
      const pl = (ph + off + 0.5) % 1, ll = Math.max(0, Math.sin(pl * TAU)) * run, sl = Math.cos(pl * TAU) * run;
      e(B['thigh' + k], 8 - ll * 35 + sl * 18, 0, sg * (30 + ll * 10)); e(B['shin' + k], 100 + ll * 25, 0, 0); e(B['foot' + k], -30, 0, 0);
    }
    if (st === ST.windup || st === ST.leap || st === ST.strike) {
      const w = st === ST.windup ? smooth(clamp(T / 0.25, 0, 1)) : 1;
      add(B.hips, 20 * w, 0, 0); e(B.jaw, 70 * w, 0, 0); add(B.head, -20 * w, 0, 0);
      add(B.uArmR, 40 * w, 0, -20 * w); add(B.uArmL, 40 * w, 0, 20 * w);
    }
    if (st === ST.spawn) { B.hips.position.y -= (1 - clamp(T / 1.1, 0, 1)) * 0.4; }
    if (this.flinch > 0) add(B.chest, 0, 0, this.flinch * 25 * this.flinchDir);
    if (st === ST.dead) { const k = smooth(clamp(T / 0.5, 0, 1)); B.hips.position.y = 0.6 - 0.42 * k; add(B.hips, 0, 0, k * 40); for (const k2 of ['R', 'L']) { add(B['shin' + k2], 40 * k, 0, 0); add(B['fArm' + k2], -40 * k, 0, 0); } add(B.head, Math.sin(time * 30) * 15 * (1 - k), 0, 0); }
    else overlay(this, B, time, 0.8);
  },
  // the hag lurches, one arm forever reaching
  wretch(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 1.4;
    const ph = this.phase, run = clamp(s / 3.5, 0, 1);
    torso(B, ph, run, 40, time, this.seed, { drop: 0.1 });
    add(B.spine, 0, 0, 10); add(B.chest, 0, 0, -6);
    legs(B, ph, run, { crouch: 20, stride: 0.8 });
    arms(B, ph, run, time, this.seed, 'hang');
    e(B.uArmL, -70 + Math.sin(time * 3 + this.seed) * 10, -10, 16); e(B.fArmL, -20, 0, 0); e(B.handL, -40 + Math.sin(time * 11) * 10, 0, 0);
    e(B.head, -10, 0, 25 + (this.h ? this.h.tilt * 0.5 : 0)); e(B.jaw, 20 + Math.sin(time * 1.3 + this.seed) * 10, 0, 0);
    spasm(this, B, time, dt, 0.6);
    if (st === ST.windup) { const w = smooth(clamp(T / 0.6, 0, 1)); for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k], -150 * w, 0, sg * 30 * w); e(B['fArm' + k], -30, 0, 0); e(B['hand' + k], 40 * w, 0, 0); } e(B.head, -45 * w, 0, 0); e(B.jaw, 70 * w, 0, 0); }
    if (st === ST.strike) { const k = smooth(clamp(T / 0.15, 0, 1)); for (const [k2, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k2], -150 + 80 * k, 0, sg * 30); } e(B.jaw, 70, 0, 0); }
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (this.flinch > 0) add(B.chest, -this.flinch * 25, 0, 0);
    if (st === ST.dead) deathPose(this, B, T, time); else overlay(this, B, time);
  },
  // bloated, waddling, swelling before it bursts
  husk(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 1.1;
    const ph = this.phase, run = clamp(s / 3, 0, 1);
    torso(B, ph, run, 8, time, this.seed, { drop: 0.04 });
    add(B.hips, 0, 0, sinp(ph) * 10 * run); add(B.chest, 0, 0, -sinp(ph) * 8 * run);
    legs(B, ph, run, { crouch: 10, stride: 0.7, wide: 10 });
    arms(B, ph, run, time, this.seed, 'reach');
    e(B.head, -10 + Math.sin(time * 2 + this.seed) * 8, Math.sin(time * 1.1 + this.seed) * 20, Math.sin(time * 1.7) * 10); e(B.jaw, 35, 0, 0);
    spasm(this, B, time, dt, 0.45);
    const swell = st === ST.special ? 1 + smooth(clamp(T / 1.1, 0, 1)) * 0.35 + Math.sin(time * 40) * 0.03 * T : 1;
    B.spine.scale.set(swell, 1 + (swell - 1) * 0.6, swell);
    if (st === ST.special) { add(B.head, -30, Math.sin(time * 25) * 30, 0); e(B.jaw, 75, 0, 0); for (const [k, sg] of [['R', -1], ['L', 1]]) e(B['uArm' + k], -40, 0, sg * 60); }
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (this.flinch > 0) add(B.chest, -this.flinch * 20, 0, 0);
    if (st === ST.dead) deathPose(this, B, T, time); else overlay(this, B, time);
  },
  // a hunched giant: knuckles near the ground, slow terrible weight
  brute(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 3.6;
    const ph = this.phase, run = clamp(s / 4, 0, 1);
    torso(B, ph, run, 30, time, this.seed, { drop: 0.12 });
    legs(B, ph, run, { crouch: 18, stride: 0.9, wide: 6 });
    arms(B, ph, run, time, this.seed, 'swing');
    e(B.head, -18, Math.sin(time * 0.6 + this.seed) * 20, 0); e(B.jaw, 15 + Math.max(0, Math.sin(time * 1.5)) * 20, 0, 0);
    spasm(this, B, time, dt, 0.3);
    if (st === ST.special) { // paw, roar, charge
      if (T < 0.9) { const w = smooth(clamp(T / 0.4, 0, 1)); add(B.chest, -30 * w, 0, 0); e(B.head, -50 * w, 0, 0); e(B.jaw, 75 * w, 0, 0); for (const [k, sg] of [['R', -1], ['L', 1]]) e(B['uArm' + k], -40 * w, 0, sg * 70 * w); }
      else { add(B.spine, 30, 0, 0); add(B.chest, 20, 0, 0); e(B.head, -30, 0, 0); e(B.jaw, 60, 0, 0); }
    } else if (st === ST.windup || st === ST.strike || st === ST.recover) {
      const big = this.atk === 1;
      const w = st === ST.windup ? smooth(clamp(T / (big ? 0.85 : 0.5), 0, 1)) : 0;
      const sk = st === ST.strike ? smooth(clamp(T / 0.15, 0, 1)) : st === ST.recover ? 1 - smooth(clamp(T / 0.8, 0, 1)) : 0;
      if (big) { for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k], lerp(-175 * w, -40, sk), 0, sg * 25); e(B['fArm' + k], -40 * w, 0, 0); } add(B.spine, -20 * w + 45 * sk, 0, 0); }
      else { e(B.uArmR, lerp(-130 * w, -20, sk), 30 * w, -50 * w + 20 * sk); e(B.fArmR, -70 * w, 0, 0); add(B.chest, 0, 40 * w - 70 * sk, 0); }
      e(B.jaw, 70, 0, 0); e(B.head, -35, 0, 0);
    }
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (st === ST.stagger) { add(B.chest, -20, 0, 0); add(B.head, -20, 0, 15); }
    if (st === ST.dead) deathPose(this, B, T, time); else overlay(this, B, time, 0.7);
  },
  // winged, grounded: stalks low with wings mantled, spreads them to scream
  wraith(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 2.4;
    const ph = this.phase, run = clamp(s / 4.5, 0, 1);
    torso(B, ph, run, 42, time, this.seed, { drop: 0.16 });
    legs(B, ph, run, { crouch: 26, stride: 1.0 });
    arms(B, ph, run, time, this.seed, 'reach');
    e(B.head, -20, Math.sin(time * 0.9 + this.seed) * 30 * (1 - run), this.h ? this.h.tilt * 0.6 : 0); e(B.jaw, 20 + Math.max(0, Math.sin(time * 3 + this.seed)) * 25, 0, 0);
    spasm(this, B, time, dt, 0.55);
    let spread = 0;
    if (st === ST.windup) { spread = smooth(clamp(T / 0.5, 0, 1)); for (const [k, sg] of [['R', -1], ['L', 1]]) { e(B['uArm' + k], -100 * spread, 0, sg * 50 * spread); } e(B.head, -40 * spread, 0, 0); e(B.jaw, 75 * spread, 0, 0); }
    if (st === ST.strike) spread = 1 - smooth(clamp(T / 0.5, 0, 1));
    if (st === ST.flee) spread = 1;
    wingsPose(this, spread, run, time);
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (this.flinch > 0) add(B.chest, -this.flinch * 25, 0, 0);
    if (st === ST.dead) { deathPose(this, B, T, time); wingsPose(this, 0.3 * (1 - T), 0, time); } else overlay(this, B, time);
  },
  // the herald: tall, crowned and winged; bounds on the ground with wing beats
  herald(dt, time) {
    const B = this.B, s = this.speedVis, st = this.state, T = this.stateT;
    this.phase += dt * s / 3.2;
    const ph = this.phase, run = clamp(s / 6, 0, 1);
    torso(B, ph, run, 22, time, this.seed, { drop: 0.06 });
    legs(B, ph, run, { crouch: 16, stride: 1.2 });
    arms(B, ph, run, time, this.seed, run > 0.4 ? 'grasp' : 'trail');
    e(B.head, -12, Math.sin(time * 0.7 + this.seed) * 20, 0); e(B.jaw, 10 + Math.max(0, Math.sin(time * 2.2)) * 20, 0, 0);
    spasm(this, B, time, dt, 0.35);
    let spread = 0.15 + run * 0.25;
    if (st === ST.windup || st === ST.flee) { const w = smooth(clamp(T / 0.5, 0, 1)); spread = 1; add(B.chest, -25 * w, 0, 0); e(B.head, -45 * w, 0, 0); e(B.jaw, 80 * w, 0, 0); for (const [k, sg] of [['R', -1], ['L', 1]]) e(B['uArm' + k], -60 * w, 0, sg * 75 * w); }
    if (st === ST.strike || st === ST.leap) { spread = 0.8; attackPose(this, B, Math.min(T, 0.3)); }
    wingsPose(this, spread, run, time, st === ST.leap || st === ST.strike ? 1 : 0);
    if (st === ST.spawn) spawnPose(this, B, T, time);
    if (this.flinch > 0) add(B.chest, -this.flinch * 20, 0, 0);
    if (st === ST.dead) { deathPose(this, B, T, time); wingsPose(this, 0.4, 0, time); } else overlay(this, B, time, 0.7);
  },
};
// wings: 0 = folded tight over the back like a cloak, 1 = spread wide; beat > 0 flaps
function wingsPose(d, spread, run, time, beat = 0) {
  const W = d.wings; if (!W) return;
  for (const k of ['R', 'L']) {
    const w = W[k], s = w.s;
    const flap = beat ? Math.sin(time * 14) * 35 * beat : Math.sin(time * 1.3 + d.seed) * 4;
    // folded: the arm swings back and down, the forearm folds forward along the body
    e(w.b0, lerp(25, -10, spread), s * lerp(-70, -15, spread), s * (lerp(-55, 10, spread) + flap));
    e(w.b1, 0, s * lerp(150, 20, spread), s * lerp(-10, 5, spread));
    e(w.b2, 0, s * lerp(25, 10, spread), s * lerp(-35, -5, spread));
  }
}
export function horrorSetTime(d, time) { d.mat.userData.u.uTime.value = time; }
