// The demons' flesh and motion. Bodies are MakeHuman humans twisted by
// tools/build_demons.py; here they get their skin, white eyes, wings and horns,
// and the movement that makes them frightening: violent head-shaking fits,
// screams with the jaw unhinged, twitches, stop-motion stutters, and the
// crawler's belly-up spider-walk.
import * as THREE from 'three';
import { demonTextures } from './textures.js';
import { clamp, lerp, smooth, TAU } from './util.js';

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
export function demonSkin(rimHex, { skin = 0x141012, glow = 1 } = {}) {
  const dt = demonTextures();
  const u = { uDissolve: { value: 0 }, uRim: { value: new THREE.Color(rimHex) }, uGlow: { value: glow }, uHit: { value: 0 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 10 } };
  const mat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide });
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { tA: { value: dt.map }, tE: { value: dt.emissiveMap } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float region;\nvarying vec3 vDPos; varying vec3 vDN; varying float vReg;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position; vDN = normal; vReg = region;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vDPos; varying vec3 vDN; varying float vReg;
        uniform float uDissolve, uGlow, uHit, uTime, uSeed; uniform vec3 uRim; uniform sampler2D tA, tE;
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
        float teeth = step(0.5, vReg);`)
      .replace('#include <map_fragment>', `
        // ash-grey where the skin is stretched over bone, near black in the folds
        float ash = smoothstep(0.35, 0.9, hgt);
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.55, diffuseColor.rgb * 2.4 + vec3(0.03, 0.025, 0.02), ash);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.55, 0.42), teeth);
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.03, 0.0, 0.0);   // throat and sockets`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(clamp(roughness + (0.5 - hgt) * 0.45, 0.25, 0.9), 0.28, teeth);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 dHdxy = vec2(dFdx(hgt), dFdy(hgt)) * 0.007 * (1.0 - teeth) * (gl_FrontFacing ? 1.0 : 0.0);
        normal = bumpN(-vViewPosition, normal, dHdxy, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float pulse = 0.55 + 0.45 * sin(uTime * 2.3 + uSeed + vDPos.y * 4.0);
        float ff = gl_FrontFacing ? 1.0 : 0.0;
        totalEmissiveRadiance += uRim * pow(veins, 4.0) * 0.35 * pulse * uGlow * (1.0 - teeth) * ff;
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uRim * fres * 0.18 * uGlow * ff;
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit * 1.6;
        if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 6.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dnz));`);
  };
  mat.customProgramCacheKey = () => 'demonSkin-v3';
  return mat;
}
// Eyes: blank, white, burning. Shared by every demon.
const EYE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(5), toneMapped: false });
const EYE_GEO = new THREE.SphereGeometry(1, 14, 10);
const PUPIL_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.05, 0.02).multiplyScalar(3), toneMapped: false });

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
  const mat = demonSkin(def.rim, { skin: def.skin ?? 0x141012 });
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
    const m = new THREE.Mesh(EYE_GEO, EYE_MAT); m.scale.setScalar(e[3] * 0.92); m.position.set(e[0], e[1], e[2] - e[3] * 0.1);
    B.head.add(m);
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
  if (def.eyeScale) for (const m of B.head.children) if (m.material === EYE_MAT) {
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
  if (def.hooded) dressDevil(B, K, def);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return { mesh, B, mat, wings, height: K.height };
}

// ---------------------------------------------------------------- His garb
// A deep hood over a pale, human face; a robe that pools on the ground; long sleeves the
// white hands hang out of; ram horns rooted in the skull, breaking out through the cloth.
// Built at rest (bones unrotated, so every bone frame is the model frame).
const ROBE_MAT = new THREE.MeshStandardMaterial({ color: 0x0b0909, roughness: 0.97, side: THREE.DoubleSide });
function lathe(profile, segs, shape) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v, Math.atan2(v.x, v.z)); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
function dressDevil(B, K, def) {
  const chestY = B.chest.getWorldPosition(new THREE.Vector3()).y;   // mesh is at the origin, at rest
  const neckTop = B.neck.position.y;                                    // neck base, in the chest's frame
  const L = chestY - 0.02;                                              // to the ground
  // the robe: narrow at the throat, broad over the shoulders, falling straight and heavy to a ragged hem
  const prof = [[0.15, neckTop + 0.03], [0.36, neckTop - 0.07], [0.54, 0.17], [0.52, 0.03], [0.41, -0.2], [0.4, -0.5], [0.44, -0.8], [0.52, -1.25], [0.68, -1.85], [0.86, -L]];
  const robe = new THREE.Mesh(lathe(prof, 40, (v, a) => {
    const t = clamp(-v.y / L, 0, 1);
    const r = Math.hypot(v.x, v.z) * (1 + Math.sin(a * 9 + 0.7) * 0.05 * t + Math.sin(a * 4 + 2) * 0.04 * t);
    v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.8 + 0.07;
    if (t > 0.93) v.y += Math.abs(Math.sin(a * 7.3) * Math.sin(a * 3.1)) * 0.18;
  }), ROBE_MAT);
  robe.castShadow = true; B.chest.add(robe);
  // sleeves: wide and long, the hands hang out of them
  for (const k of ['R', 'L']) {
    const ul = Math.abs(B['fArm' + k].position.y), fl = Math.abs(B['hand' + k].position.y);
    const up = new THREE.Mesh(lathe([[0.15, 0.06], [0.155, -ul * 0.5], [0.16, -ul - 0.02]], 14, (v, a) => { v.x += Math.sin(a * 5) * 0.008; }), ROBE_MAT); B['uArm' + k].add(up);
    const lo = new THREE.Mesh(lathe([[0.155, 0.02], [0.18, -fl * 0.5], [0.27, -fl * 0.86], [0.28, -fl * 0.9]], 14, (v, a) => { const t = -v.y / fl; if (t > 0.8) v.y += Math.abs(Math.sin(a * 5.1)) * 0.06; }), ROBE_MAT);
    B['fArm' + k].add(lo); up.castShadow = lo.castShadow = true;
  }
  // the hood: a deep cowl open at the front, peaked at the back, its skirt spreading onto the shoulders
  // (the skull runs about ±0.17 across, -0.15..0.28 up and -0.09..0.31 front to back of the head joint)
  const cx = 0, cy = 0.08, cz = 0.07;
  const hood = new THREE.SphereGeometry(0.15, 28, 18, Math.PI * 0.5 + 0.62, Math.PI * 2 - 1.24, 0, Math.PI * 0.78);
  { const p = hood.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const th = Math.acos(clamp(v.y / 0.15, -1, 1)) / Math.PI;            // 0 at the crown
      v.x *= 1.62; v.y *= 1.75; v.z *= 2.0;
      if (v.z < 0 && v.y > 0) { v.y += -v.z * 0.45 * (v.y / 0.26); v.z -= v.y * 0.25; }   // the peak
      if (th > 0.55) { const f = (th - 0.55) / 0.23; v.x *= 1 + f * 0.75; v.z = v.z * (1 + f * 0.45) - f * 0.04; v.y -= f * 0.14; }  // onto the shoulders
      p.setXYZ(i, v.x + cx, v.y + cy, v.z + cz);
    }
    hood.computeVertexNormals(); }
  const hm = new THREE.Mesh(hood, ROBE_MAT); hm.castShadow = true; B.head.add(hm);
  // ram horns rooted inside the skull above the temples, breaking out through the hood and curling back
  if (def.horns) for (const s of [-1, 1]) {
    const h = new THREE.Mesh(hornGeo(def.horns[0], def.horns[1], def.horns[2]), HORN_MAT); h.castShadow = true;
    h.position.set(s * 0.09, 0.19, 0.1); h.rotation.set(-0.55, s * 0.3, -s * 0.42);
    B.head.add(h);
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
    this.phase += dt * s / 2.9;
    const ph = this.phase, run = clamp(s / 5, 0, 1);
    torso(B, ph, run, 34, time, this.seed);
    legs(B, ph, run, { crouch: 14, stride: 1.15 });
    arms(B, ph, run, time, this.seed, 'trail');
    e(B.head, -24 - 10 * run, 0, this.h ? this.h.tilt * (1 - run) : 0); e(B.jaw, 18 + Math.max(0, Math.sin(time * 4 + this.seed)) * 15, 0, 0);
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
    arms(B, ph, run, time, this.seed, 'trail');
    e(B.head, -12, Math.sin(time * 0.7 + this.seed) * 20, 0); e(B.jaw, 10 + Math.max(0, Math.sin(time * 2.2)) * 20, 0, 0);
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
