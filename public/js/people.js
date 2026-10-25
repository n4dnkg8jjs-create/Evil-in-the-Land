// People who are not knights: the sutler on his wagon, the priest at the sanctuary. They wear the same
// MakeHuman body the knights do (under their clothes), a face (the knights' own head model), real hands, and
// robes of cloth; and a realistic hand for anyone who needs one, the Devil included.
import * as THREE from 'three';
import { Rig, JOINTS } from './rig.js';
import { dressBody } from './body.js';
import { clothTextures } from './textures.js';
import { lerp } from './util.js';
import { Cloth } from './cloth.js';

const D2R = Math.PI / 180;
const smoothstep01 = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// ---------------------------------------------------------------- hands
// A hand hanging from the wrist (local -y), palm toward the body (-x for the left hand, +x for the right), thumb forward
// (pass side = 1 for the left hand, -1 for the right). Palm, four fingers of three tapering phalanges with
// knuckles, a thumb, nails. `long` stretches the fingers (the Devil's are far too long), `curl` bends them.
export function realHand(side, { skin, nail, scale = 1, long = 1, curl = 0.35, thin = 1 } = {}) {
  // proportions of an adult hand (metres): palm 9.5 cm long, 8.4 wide, 2.6 thick at the heel thinning to 2 at the knuckles;
  // fingers index 7.0, middle 7.8, ring 7.3, little 5.8 cm in three phalanges (45 / 30 / 25 %), each tapering
  const g = new THREE.Group();
  const sk = skin || new THREE.MeshStandardMaterial({ color: 0x9a7a66, roughness: 0.6 });
  const nm = nail || new THREE.MeshStandardMaterial({ color: 0xb8a898, roughness: 0.35 });
  const add = (geo, m, parent) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; (parent || g).add(o); return o; };
  // the palm: a rounded slab, x = thickness (palm toward the body at -side), y down the hand, z across it
  const W = 0.084 * thin, PL = 0.095;
  const palm = new THREE.BoxGeometry(1, 1, 1, 6, 10, 8); const pp = palm.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
    const t = y + 0.5;                                            // 1 at the wrist, 0 at the knuckles
    const th = lerp(0.02, 0.026, t), wd = lerp(W, W * 0.82, t * t);
    // round every edge: push the box toward a superellipse in each section
    const rz = Math.abs(z) * 2, rx = Math.abs(x) * 2; const k = Math.pow(1 - Math.min(1, rz ** 4 + rx ** 4) * 0.0, 1);
    x = x * th * (1 - 0.35 * rz ** 3); z = z * wd * (1 - 0.12 * rx ** 2) * k;
    x += -side * 0.004 * (1 - rz * rz);                           // the palm a little hollowed toward the body side
    pp.setXYZ(i, x, -(1 - t) * PL - 0.006, z);
  }
  palm.computeVertexNormals(); add(palm, sk);
  const fingers = [[-0.375, 0.070], [-0.125, 0.078], [0.125, 0.073], [0.375, 0.058]];   // across the knuckles (fraction of width), length
  for (const [fz, fl] of fingers) {
    let parent = new THREE.Group(); parent.position.set(0, -PL, fz * W * 0.92); parent.rotation.x = fz * 0.12; g.add(parent);
    const lens = [0.45, 0.3, 0.25].map((f) => f * fl * long);
    lens.forEach((len, k) => {
      const r0 = (0.0092 - k * 0.0011) * (fl / 0.078) ** 0.4 * thin, r1 = r0 * 0.86;
      const seg = new THREE.Group(); seg.rotation.z = side * curl * [0.45, 0.65, 0.4][k]; parent.add(seg);   // fingers curl toward the palm
      add(new THREE.SphereGeometry(r0 * 1.02, 10, 8), sk, seg);                                           // the joint
      const bone = new THREE.CylinderGeometry(r1, r0, len, 10); bone.translate(0, -len / 2, 0); add(bone, sk, seg);
      if (k === 2) { const tip = new THREE.SphereGeometry(r1, 10, 8); tip.translate(0, -len, 0); add(tip, sk, seg);
        const n = new THREE.SphereGeometry(r1 * 0.9, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2); n.scale(0.45, 1.5, 0.95); n.rotateZ(side * Math.PI / 2); n.translate(side * r1 * 0.55, -len * 0.82, 0); add(n, nm, seg); }
      const next = new THREE.Group(); next.position.y = -len; seg.add(next); parent = next;
    });
  }
  // the thumb: its root low on the palm, toward the front, angled out and across the palm
  let tp = new THREE.Group(); tp.position.set(side * -0.006, -0.03, W * 0.46); tp.rotation.set(-0.38, 0, side * 0.28); g.add(tp);
  [0.04, 0.03, 0.024].forEach((len, k) => {
    const r0 = [0.0125, 0.0105, 0.0092][k] * thin, L2 = len * Math.sqrt(long);
    const seg = new THREE.Group(); seg.rotation.z = side * curl * 0.35 * k; seg.rotation.x = k ? 0.15 : 0; tp.add(seg);
    add(new THREE.SphereGeometry(r0, 10, 8), sk, seg);
    const b = new THREE.CylinderGeometry(r0 * 0.88, r0, L2, 10); b.translate(0, -L2 / 2, 0); add(b, sk, seg);
    if (k === 2) { const tip = new THREE.SphereGeometry(r0 * 0.88, 10, 8); tip.translate(0, -L2, 0); add(tip, sk, seg); }
    const nx = new THREE.Group(); nx.position.y = -L2; seg.add(nx); tp = nx;
  });
  g.scale.setScalar(scale);
  return g;
}

// ---------------------------------------------------------------- clothing
function lathe(profile, segs, shape) {
  const gg = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const p = gg.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v, Math.atan2(v.x, v.z)); p.setXYZ(i, v.x, v.y, v.z); }
  gg.computeVertexNormals(); return gg;
}
function clothMat(rgb, key) {
  const t = clothTextures(rgb, false, 256, key);
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, side: THREE.DoubleSide });
}
// a robe from the shoulders: pleated, longer behind, open below for a seated figure if asked
function robe(rig, mat, { length = 1.25, flare = 0.36, seated = false } = {}) {
  const L = length;
  const prof = [[0.08, 0.2], [0.2, 0.16], [0.24, 0.05], [0.2, -0.2], [0.19, -0.45], [0.22, -0.7], [flare, -L]];
  const gg = lathe(prof, 40, (v, a) => {
    const t = Math.max(0, -v.y / L);
    const r = Math.hypot(v.x, v.z) + Math.sin(a * 9 + v.y * 2) * 0.012 * t + Math.sin(a * 4 + 1) * 0.02 * t;
    v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.8 + 0.01;
  });
  const m = new THREE.Mesh(gg, mat); m.castShadow = true; rig.j.chest.add(m);
  if (seated) m.scale.y = 0.62;   // bunched in the lap
  return m;
}

// ---------------------------------------------------------------- a person
// The whole body is MakeHuman's (CC0, tools/build_person.py): the face, the hands with every finger, the feet,
// MakeHuman's eyes with their iris texture. Regions in the mesh say what is skin, hair, brow, shoe, eye, and what
// the robe covers (a linen shirt and hose).
let PEOPLE = null;
const dec = (b64, Type) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); };
export async function loadPeople(url = 'models/people.json') {
  if (PEOPLE) return PEOPLE;
  try {
    const j = await (await fetch(url)).json(); const out = {};
    const map = j.joints.map((n) => JOINTS.indexOf(n));
    for (const [name, v] of Object.entries(j.variants)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(dec(v.position, Float32Array), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(dec(v.normal, Int8Array), 3, true));
      geo.setAttribute('uv', new THREE.BufferAttribute(dec(v.uv, Float32Array), 2));
      geo.setAttribute('skinIndex', new THREE.BufferAttribute(dec(v.skinIndex, Uint8Array).map((x) => Math.max(0, map[x])), 4));
      geo.setAttribute('skinWeight', new THREE.BufferAttribute(dec(v.skinWeight, Uint8Array), 4, true));
      geo.setAttribute('region', new THREE.BufferAttribute(Float32Array.from(dec(v.region, Uint8Array)), 1));
      geo.setAttribute('hairAmt', new THREE.BufferAttribute(dec(v.hair, Uint8Array), 1, true));
      geo.setIndex(new THREE.BufferAttribute(dec(v.index, Uint32Array), 1));
      geo.computeBoundingSphere();
      out[name] = { geo, bind: v.bind, eyes: v.eyes };
    }
    PEOPLE = out;
  } catch (e) { console.warn('people model', e); }
  return PEOPLE;
}
let EYE_TEX = null;
function personMat(look) {
  if (!EYE_TEX) { EYE_TEX = new THREE.TextureLoader().load('models/eye.png'); EYE_TEX.colorSpace = THREE.SRGBColorSpace; }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  const U = { uFrozen: { value: look.frozen || 0 }, uDead: { value: look.dead || 0 }, uAge: { value: look.age || 0 }, uEyeL: { value: new THREE.Vector3(...(look.eyes?.[0] || [0, 0, 0])) }, uEyeR: { value: new THREE.Vector3(...(look.eyes?.[1] || [0, 0, 0])) }, uSkin: { value: new THREE.Color(look.skin) }, uHair: { value: new THREE.Color(look.hair) }, uCloth: { value: new THREE.Color(look.cloth) }, uShoe: { value: new THREE.Color(0x2a1d14) }, uEye: { value: EYE_TEX } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nattribute float hairAmt;\nflat varying float vReg;\nvarying float vHair;\nvarying vec2 vUv0;\nvarying vec3 vObj;\nvarying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvReg = region; vHair = hairAmt; vUv0 = uv; vObj = position;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vReg; varying float vHair; varying vec2 vUv0; varying vec3 vObj; varying vec3 vWN;
        uniform vec3 uSkin, uHair, uCloth, uShoe, uEyeL, uEyeR; uniform sampler2D uEye; uniform float uAge, uFrozen, uDead;
        float ph(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float pn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(ph(i), ph(i+vec3(1,0,0)), f.x), mix(ph(i+vec3(0,1,0)), ph(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(ph(i+vec3(0,0,1)), ph(i+vec3(1,0,1)), f.x), mix(ph(i+vec3(0,1,1)), ph(i+vec3(1,1,1)), f.x), f.y), f.z); }
        float isR(float k){ return step(abs(vReg - k), 0.4); }
        // the lines of an old face, worked out round the eyes: furrowed brow, frown lines, crow's feet, bags under
        // the eyes, deep folds from nose to mouth, a creased neck
        float wrinkle(vec3 p){
          vec3 ec = (uEyeL + uEyeR) * 0.5; vec3 q = p - ec; float w = 0.0;
          float front = smoothstep(-0.02, 0.01, q.z);
          float fh = smoothstep(0.028, 0.042, q.y) * (1.0 - smoothstep(0.075, 0.09, q.y)) * (1.0 - smoothstep(0.045, 0.065, abs(q.x))) * front;
          w += fh * pow(0.5 + 0.5 * sin(q.y * 470.0 + sin(q.x * 55.0) * 1.6), 4.0) * 0.75;
          w += smoothstep(0.004, 0.0, abs(abs(q.x) - 0.007)) * smoothstep(0.01, 0.018, q.y) * (1.0 - smoothstep(0.035, 0.045, q.y)) * front * 0.5;
          for (int i = 0; i < 2; i++) {
            vec3 e = i == 0 ? uEyeL : uEyeR; float s = sign(e.x - ec.x);
            vec3 d = p - (e + vec3(s * 0.021, 0.0, -0.012)); float r = length(d.xy); float a = atan(d.y, d.x * s);
            w += smoothstep(0.02, 0.008, r) * smoothstep(0.003, 0.008, r) * smoothstep(-0.002, 0.004, d.x * s) * pow(0.5 + 0.5 * sin(a * 11.0), 4.0) * 0.5;
            vec3 b = p - e; w += smoothstep(0.005, 0.0, abs(b.y + 0.017 + b.x * b.x * 9.0)) * (1.0 - smoothstep(0.012, 0.022, abs(b.x))) * front * 0.6;
          }
          float nl = abs(abs(q.x) - (0.021 + (-0.032 - q.y) * 0.38));
          w += smoothstep(0.007, 0.0, nl) * smoothstep(-0.03, -0.04, q.y) * (1.0 - smoothstep(-0.075, -0.088, q.y)) * front * 0.7;
          // hollow cheeks under the cheekbones, and jowls
          w += smoothstep(0.03, 0.045, abs(q.x)) * (1.0 - smoothstep(0.055, 0.07, abs(q.x))) * smoothstep(-0.025, -0.04, q.y) * (1.0 - smoothstep(-0.065, -0.08, q.y)) * front * 0.35;
          float nk = smoothstep(-0.11, -0.13, q.y) * (1.0 - smoothstep(-0.2, -0.22, q.y)) * smoothstep(-0.08, -0.03, q.z);
          w += nk * smoothstep(0.55, 1.0, sin(q.y * 300.0 + q.x * 25.0)) * 0.8;
          return clamp(w, 0.0, 1.0);
        }`)
      .replace('#include <map_fragment>', `
        float rS0 = isR(0.0), rShoe = isR(3.0), rE = isR(4.0), rC = isR(6.0);
        // skin: blotchy, ruddier on the cheeks, nose and knuckles, pores
        float blot = pn(vObj * 38.0) * 0.6 + pn(vObj * 110.0) * 0.4;
        vec3 skin = uSkin * (0.86 + 0.24 * blot);
        float wr = uAge > 0.0 ? wrinkle(vObj) * uAge : 0.0;
        skin *= 1.0 - 0.25 * wr;
        // liver spots on an old man's scalp, temples and hands
        skin = mix(skin, skin * vec3(0.82, 0.74, 0.66), smoothstep(0.8, 0.9, pn(vObj * 110.0 + 9.0)) * uAge * 0.6);
        skin = mix(skin, skin * vec3(1.12, 0.86, 0.82), smoothstep(0.55, 0.85, pn(vObj * 14.0 + 3.0)) * 0.6);
        // hair: fine strands running down the head
        float strand = pn(vec3(vObj.x * 420.0, vObj.y * 30.0, vObj.z * 420.0));
        vec3 hair = uHair * (0.6 + 0.7 * strand);
        float rH = rS0 * smoothstep(0.15, 0.6, vHair * (0.75 + 0.5 * strand)); float rS = rS0 - rH;
        vec3 cloth = uCloth * (0.75 + 0.35 * pn(vObj * vec3(160.0, 40.0, 160.0)));
        vec3 shoe = uShoe * (0.8 + 0.4 * pn(vObj * 60.0));
        vec3 eye = texture2D(uEye, vUv0).rgb;
        eye = mix(eye, vec3(0.78, 0.8, 0.74) * (0.85 + 0.25 * dot(eye, vec3(0.3, 0.6, 0.1))), uDead * 0.85);   // dead: clouded over, milky
        // frozen dead: the flesh grey-blue and waxen, lips and nail-beds dark, rime and ice on every face that the snow
        // fell on, glittering
        float fz = uFrozen;
        // dead: grey, waxen, the veins showing dark through it
        skin = mix(skin, uSkin * (0.7 + 0.4 * blot) * (1.0 - 0.3 * smoothstep(0.62, 0.7, pn(vObj * vec3(30.0, 90.0, 30.0)))), uDead);
        skin = mix(skin, vec3(0.5, 0.56, 0.62) * (0.75 + 0.35 * blot) + vec3(0.06, 0.0, 0.03) * pn(vObj * 20.0), fz * 0.9);
        hair = mix(hair, vec3(0.75, 0.78, 0.82) * (0.7 + 0.5 * strand), fz * 0.6);
        shoe = mix(shoe, skin * 0.8, uDead); cloth = mix(cloth, skin * 0.95, uDead);
        vec3 col0 = skin * rS + hair * rH + shoe * rShoe + eye * rE + cloth * rC;
        float rime = fz * smoothstep(0.25, 0.75, normalize(vWN).y + (pn(vObj * 45.0) - 0.5) * 0.5);
        float glint = fz * step(0.975, ph(floor(vObj * 260.0))) * rime;
        col0 = mix(col0, vec3(0.86, 0.9, 0.95), rime * 0.8) + glint * 0.6;
        col0 = mix(col0, col0 * vec3(0.8, 0.9, 1.05), fz * 0.4);
        diffuseColor.rgb = col0;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uAge > 0.0 && rS > 0.5) {
          float hw = wrinkle(vObj) * uAge;
          vec3 sx = normalize(dFdx(-vViewPosition)), sy = normalize(dFdy(-vViewPosition));
          vec3 R1 = cross(sy, normal), R2 = cross(normal, sx); float det = dot(sx, R1);
          vec3 grad = sign(det) * (dFdx(hw) * R1 + dFdy(hw) * R2) * 0.55;
          normal = normalize(abs(det) * normal + grad);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.62 * rS + 0.75 * rH + 0.55 * rShoe + 0.08 * rE + 0.95 * rC - 0.08 * blot * rS, 0.28, uFrozen * 0.7);')
      // light through the skin: a warm wrap where it turns from the light
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += rS * uSkin * vec3(0.10, 0.03, 0.02) * (1.0 - uFrozen);`);
  };
  mat.customProgramCacheKey = () => 'personSkin-v4';
  return mat;
}
function personMesh(rig, P, look) {
  const saved = JOINTS.map((n) => rig.j[n].quaternion.clone()), savedHip = rig.j.hips.position.clone();
  for (const n of JOINTS) { const q = P.bind[n]; rig.j[n].quaternion.set(q[0], q[1], q[2], q[3]); }
  rig.j.hips.position.copy(rig.basePos);
  const root = rig.root; root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1); root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(P.geo, personMat(look));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; root.add(mesh); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(JOINTS.map((n) => rig.j[n])), mesh.matrixWorld);
  JOINTS.forEach((n, i) => rig.j[n].quaternion.copy(saved[i])); rig.j.hips.position.copy(savedHip); root.updateMatrixWorld(true);
  return mesh;
}

// a bare MakeHuman body on its own rig (for the Devil, who wears his own garb over it)
export function humanBody(look, variant = 'priest') {
  const P = PEOPLE?.[variant]; if (!P) return null;
  const rig = new Rig(1), mesh = personMesh(rig, P, { ...look, eyes: P.eyes });
  return { rig, mesh, P };
}
// the extent of the skinned head in the head bone's frame (for fitting a hood over it)
export function headBox(mesh) {
  const hi = JOINTS.indexOf('head'), inv = mesh.skeleton.boneInverses[hi], g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) if (SI.getX(i) === hi && SW.getX(i) > 0.8) box.expandByPoint(v.fromBufferAttribute(P, i).applyMatrix4(inv));
  return box;
}
// standing: turn each foot so its sole lies flat (heel and toe level), and report how far the soles sit above or
// below the root, so he can be stood exactly on the ground
function levelFeet(mesh, rig) {
  const g = mesh.geometry, SI = g.attributes.skinIndex, v = new THREE.Vector3(); let low = 1e9;
  for (const k of ['R', 'L']) {
    const fi = JOINTS.indexOf('foot' + k), foot = rig.j['foot' + k];
    for (let pass = 0; pass < 3; pass++) {
      rig.root.updateMatrixWorld(true);
      let heel = 1e9, toe = 1e9, zMin = 1e9, zMax = -1e9; const pts = [];
      for (let i = 0; i < g.attributes.position.count; i++) if (SI.getX(i) === fi) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); pts.push(v.clone()); zMin = Math.min(zMin, v.z); zMax = Math.max(zMax, v.z); }
      for (const p of pts) { if (p.z < zMin + (zMax - zMin) * 0.3) heel = Math.min(heel, p.y); if (p.z > zMax - (zMax - zMin) * 0.3) toe = Math.min(toe, p.y); }
      const L = (zMax - zMin) * 0.7; if (!(L > 0.02)) break;
      const tilt = Math.atan2(toe - heel, L); if (Math.abs(tilt) < 0.005) break;
      foot.rotation.x += tilt;   // pitch the toes down onto the ground (or up, if they dig in)
    }
    rig.root.updateMatrixWorld(true);
    for (let i = 0; i < g.attributes.position.count; i++) if (SI.getX(i) === fi) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); low = Math.min(low, v.y); }
  }
  return isFinite(low) ? -low + rig.root.position.y : 0;
}
// the posed body's outline in the hips' frame: for each height and bearing, how far out the flesh reaches
// (arms and hands left out), widened a little across neighbouring bearings
function measureHull(mesh, rig, H) {
  rig.root.updateMatrixWorld(true); mesh.skeleton.update?.();
  const inv = new THREE.Matrix4().copy(H.bone.matrixWorld).invert().multiply(mesh.matrixWorld);
  const g = mesh.geometry, SI = g.attributes.skinIndex, v = new THREE.Vector3();
  const arm = new Set(['clavR', 'uArmR', 'fArmR', 'handR', 'clavL', 'uArmL', 'fArmL', 'handL', 'head', 'neck'].map((n) => JOINTS.indexOf(n)));
  const R = H.R; R.fill(0);
  for (let i = 0; i < g.attributes.position.count; i++) {
    if (arm.has(SI.getX(i))) continue;
    mesh.getVertexPosition(i, v); v.applyMatrix4(inv);
    const yi = Math.round((v.y - H.y0) / H.dy); if (yi < 0 || yi >= H.nY) continue;
    let an = Math.atan2(v.x, v.z); if (an < 0) an += Math.PI * 2; const ai = Math.round(an / (Math.PI * 2) * H.nA) % H.nA;
    const r = Math.hypot(v.x, v.z); const k = yi * H.nA + ai; if (r > R[k]) R[k] = r;
  }
  // a cassock does not dip between the legs: each height's outline is the ellipse round its widest reach side to
  // side and front to back (and never inside what was measured)
  for (let y = 0; y < H.nY; y++) {
    let ax = 0, az = 0;
    for (let a = 0; a < H.nA; a++) { const an = a / H.nA * Math.PI * 2, r = R[y * H.nA + a]; ax = Math.max(ax, Math.abs(Math.sin(an)) * r); az = Math.max(az, Math.abs(Math.cos(an)) * r); }
    if (ax > 0 && az > 0) for (let a = 0; a < H.nA; a++) { const an = a / H.nA * Math.PI * 2; const e = 1 / Math.sqrt((Math.sin(an) / ax) ** 2 + (Math.cos(an) / az) ** 2); R[y * H.nA + a] = Math.max(R[y * H.nA + a], e); }
  }
  // fill and widen: each cell takes the most of its neighbours (a bearing with no vertex inherits from beside it)
  const out = new Float32Array(R.length);
  for (let y = 0; y < H.nY; y++) for (let a = 0; a < H.nA; a++) { let m = 0; for (let dy = -1; dy <= 1; dy++) for (let da = -2; da <= 2; da++) { const yy = y + dy; if (yy < 0 || yy >= H.nY) continue; m = Math.max(m, R[yy * H.nA + (a + da + H.nA) % H.nA]); } out[y * H.nA + a] = m; }
  R.set(out);
}
// put something (a hat) on the top of the head: find the crown of the skinned head in the head bone's own frame
function seatOnCrown(obj, mesh, rig, sink) {
  const hi = JOINTS.indexOf('head');
  if (!mesh) { obj.position.set(0, 0.2, 0); return; }
  const inv = mesh.skeleton.boneInverses[hi]; const g = mesh.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const U = new THREE.Vector3(0, 1, 0).transformDirection(inv), F = new THREE.Vector3(0, 0, 1).transformDirection(inv);
  const v = new THREE.Vector3(); let top = -1e9; const pts = [];
  for (let i = 0; i < P.count; i++) if (SI.getX(i) === hi && SW.getX(i) > 0.9) { v.fromBufferAttribute(P, i).applyMatrix4(inv); const h = v.dot(U); pts.push([v.clone(), h]); if (h > top) top = h; }
  const c = new THREE.Vector3(); let n = 0; for (const [p, h] of pts) if (h > top - 0.05) { c.add(p); n++; } c.divideScalar(n || 1);
  c.addScaledVector(U, top - sink - c.dot(U));
  const Fz = F.clone().addScaledVector(U, -F.dot(U)).normalize(), X = new THREE.Vector3().crossVectors(U, Fz);
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, Fz)); obj.position.copy(c);
}

// kind: 'sutler' (sits on the box seat, felt hat and russet cloak) or 'priest' (stands, black cassock, tonsure)
export function makePerson(kind, quality) {
  const rig = new Rig(1);
  const sutler = kind === 'sutler';
  const P = PEOPLE?.[kind];
  const body = P ? personMesh(rig, P, sutler ? { skin: 0xb88a6c, hair: 0x3a2618, cloth: 0x6a5a44, eyes: P.eyes } : { skin: 0xb59a8c, hair: 0xd8d2c8, cloth: 0x1c1a18, eyes: P.eyes, age: 1 }) : null;
  if (!P) dressBody(rig, sutler ? [84, 62, 40] : [30, 26, 26], quality);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.9 });
  if (sutler) {   // a broad felt hat, set down on his crown (found from the head of the mesh itself)
    const prof = [[0.18, -0.004], [0.178, 0.008], [0.112, 0.012], [0.104, 0.022], [0.1, 0.075], [0.088, 0.105], [0.05, 0.12], [0.0, 0.123]];
    const hg = lathe(prof, 28, (v, a) => { const rr = Math.hypot(v.x, v.z); if (rr > 0.11) v.y -= Math.cos(a) ** 2 * 0.022 * (rr - 0.11) / 0.07; if (rr < 0.1 && v.y > 0.09) v.y -= Math.cos(a * 2) * 0.006; });
    const hat = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ color: 0x2c231c, roughness: 0.95, side: THREE.DoubleSide })); hat.castShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.1085, 0.109, 0.018, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x5a2a1a, roughness: 0.8 })); band.position.y = 0.03; hat.add(band);
    seatOnCrown(hat, body, rig, 0.058); rig.j.head.add(hat);
  }
  const mat = sutler ? clothMat([96, 74, 52], 'sutlertunic') : clothMat([20, 18, 18], 'cassock');
  const J = rig.j, cloths = [];
  // the fitted upper garment, folded where it gathers at the waist; skirts, cloak and cape are simulated cloth
  const bodice = lathe([[0.075, 0.2], [0.17, 0.165], [0.215, 0.07], [0.2, -0.12], [0.18, -0.3], [0.19, -0.44]], 36, (v, an) => {
    const t = Math.max(0, -v.y); const r = Math.hypot(v.x, v.z) + Math.sin(an * 14) * 0.004 * t + Math.max(0, Math.sin(an * 7 + 1)) * 0.006 * Math.max(0, t - 0.15);
    v.x = Math.sin(an) * r; v.z = Math.cos(an) * r * 0.78 + 0.012;
  });
  const bm = new THREE.Mesh(bodice, mat); bm.castShadow = true; J.chest.add(bm);
  const fold = (v, an) => { const r = Math.hypot(v.x, v.z) * (1 + Math.sin(an * 9 + v.y * 20) * 0.04); v.x = Math.sin(an) * r; v.z = Math.cos(an) * r; };
  for (const k of ['R', 'L']) {   // sleeves, creased at the elbow, the priest's wide at the cuff
    J['uArm' + k].add(new THREE.Mesh(lathe([[0.072, 0.03], [0.078, -0.12], [0.074, -0.3]], 16, fold), mat));
    J['fArm' + k].add(new THREE.Mesh(lathe(sutler ? [[0.072, 0.02], [0.074, -0.12], [0.06, -0.2], [0.055, -0.235]] : [[0.072, 0.02], [0.085, -0.12], [0.11, -0.25]], 16, fold), mat));
  }
  const beltM = new THREE.MeshStandardMaterial({ color: sutler ? 0x3a2414 : 0x101010, roughness: 0.85 });
  // the body's own outline round the hips, measured from the skinned mesh once he is posed (see measureHull):
  // skirts are pinned just outside it and never fall inside it, so the cloth hangs all round, back as well as front
  const hull = { bone: J.hips, nA: 36, nY: 32, y0: -1.12, dy: 0.04, R: new Float32Array(36 * 32) };
  const hullR = (an, y) => { const yi = Math.max(0, Math.min(hull.nY - 1, Math.round((y - hull.y0) / hull.dy))); let a = an % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return hull.R[yi * hull.nA + Math.round(a / (Math.PI * 2) * hull.nA) % hull.nA]; };
  const ring = (rx, rz, y, bone, useHull = true) => (i, n) => { const an = (i / n) * Math.PI * 2; const r0 = Math.hypot(Math.sin(an) * rx, Math.cos(an) * rz); const r = useHull ? Math.max(r0, hullR(an, y) + 0.025) : r0; return { bone, local: new THREE.Vector3(Math.sin(an) * r, y, Math.cos(an) * r), flare: new THREE.Vector3(Math.sin(an), 0, Math.cos(an)).multiplyScalar(0.16) }; };
  const legCaps = (c, r = 1) => { for (const k of ['R', 'L']) { c.addCapsule({ a: J['thigh' + k], b: J['shin' + k], r: 0.095 * r }); c.addCapsule({ a: J['shin' + k], b: J['foot' + k], r: 0.07 * r }); } c.addCapsule({ a: J.hips, ao: new THREE.Vector3(0, 0.02, 0), r: 0.16 }); return c; };
  if (!sutler) {
    // the cassock's skirt, to the ankles, swinging and settling round his legs
    const n = 30, pin = ring(0.19, 0.15, 0.03, J.hips);
    const skirt = legCaps(new Cloth({ cols: n, rows: 18, ring: true, len: 0.98, material: mat, pins: (i) => pin(i, n), hull, axis: J.hips, hold: 0.9 }));
    cloths.push(skirt);
    // a short shoulder cape (mozzetta) over the arms
    const cn = 26; const cpin = (i) => { const an = (i / cn) * Math.PI * 2; return { bone: J.chest, local: new THREE.Vector3(Math.sin(an) * 0.1, 0.19, Math.cos(an) * 0.085 + 0.01), flare: new THREE.Vector3(Math.sin(an), 0, Math.cos(an)).multiplyScalar(1.1) }; };
    const cape = new Cloth({ cols: cn, rows: 9, ring: true, len: 0.34, material: mat, pins: cpin, stiff: 0.98 });
    cape.addCapsule({ a: J.spine, b: J.chest, bo: new THREE.Vector3(0, 0.08, 0), r: 0.17 });
    for (const k of ['R', 'L']) cape.addCapsule({ a: J['uArm' + k], b: J['fArm' + k], r: 0.08 });
    cloths.push(cape);
    // a rope cincture with its tassels, buttons down the front
    const cin = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 6, 32), beltM); cin.rotation.x = Math.PI / 2; cin.scale.set(1, 0.8, 1); cin.position.set(0, 0.06, 0.01); J.hips.add(cin);
    
    const btn = new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.4 });
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), btn); b.position.set(0, 0.17 - i * 0.065, 0.185 - Math.max(0, 0.1 - i * 0.065) * 0.3); J.chest.add(b); }
    const cr = new THREE.Group(); const wd = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 });
    cr.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.01), wd)); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.01), wd); arm.position.y = 0.02; cr.add(arm);
    cr.position.set(0, 0.02, 0.2); J.chest.add(cr);
  } else {
    // the tunic's skirt, falling over his knees as he sits
    const n = 26, pin = ring(0.2, 0.16, 0.04, J.hips, false);
    cloths.push(legCaps(new Cloth({ cols: n, rows: 9, ring: true, len: 0.42, material: mat, pins: (i) => pin(i, n), axis: J.hips, hold: 0.85 })));
    // a heavy russet cloak from his shoulders, hanging down his back and over the seat
    const cm = clothMat([110, 62, 38], 'sutlercloak'); const cn = 20;
    const cpin = (i) => { const t = i / (cn - 1), an = lerp(-1.75, 1.75, t) + Math.PI; return { bone: J.chest, local: new THREE.Vector3(Math.sin(an) * 0.2, 0.17, Math.cos(an) * 0.13), flare: new THREE.Vector3(Math.sin(an), 0, Math.cos(an)).multiplyScalar(0.3) }; };
    const cloak = new Cloth({ cols: cn, rows: 16, len: 1.05, material: cm, pins: cpin });
    cloak.addCapsule({ a: J.spine, b: J.chest, bo: new THREE.Vector3(0, 0.1, 0), r: 0.19 }); cloak.addCapsule({ a: J.hips, r: 0.19 });
    for (const k of ['R', 'L']) { cloak.addCapsule({ a: J['uArm' + k], b: J['fArm' + k], r: 0.085 }); cloak.addCapsule({ a: J['thigh' + k], b: J['shin' + k], r: 0.1 }); }
    cloths.push(cloak);
    // a broad belt with a purse and a knife
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 4, 32), beltM); belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.8, 1); belt.position.set(0, 0.07, 0.01); J.hips.add(belt);
    const purse = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), beltM); purse.scale.set(1, 1.2, 0.6); purse.position.set(0.14, -0.02, 0.12); J.hips.add(purse);
    const knife = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.015), beltM); knife.position.set(-0.17, -0.04, 0.06); knife.rotation.z = 0.2; J.hips.add(knife);
  }
  for (const c of cloths) c.wind.set(1.6, 0, 0.6);
  const e = (j, x, y, z) => rig.j[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  if (sutler) {   // sitting on the box, forearms on his knees, head a little bowed
    e('spine', 12, 0, 0); e('chest', 8, 0, 0); e('neck', 6, 0, 0); e('head', 6, -15, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('thigh' + k, -88, 0, s * 6); e('shin' + k, 82, 0, 0); e('foot' + k, 6, 0, 0); e('uArm' + k, -38, 0, s * 8); e('fArm' + k, -62, 0, 0); e('hand' + k, 10, 0, 0); }
  } else {        // an old man, a little stooped, hands folded before him
    e('spine', 6, 0, 0); e('chest', 9, 0, 0); e('neck', 14, 0, 0); e('head', -8, 0, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('uArm' + k, -14, 0, s * 4); e('fArm' + k, -85, -s * 32, 0); e('hand' + k, 0, -s * 15, 0); }
  }
  let groundOffset = 0;
  if (body && !sutler) groundOffset = levelFeet(body, rig);
  if (body) measureHull(body, rig, hull);
  // alive: he breathes, shifts his weight, and turns his head to watch whoever comes near
  const base = {}; for (const n of ['spine', 'chest', 'neck', 'head', 'hips', 'uArmR', 'fArmR', 'handR', 'uArmL', 'fArmL', 'handL', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']) base[n] = rig.j[n].rotation.clone();
  let t0 = Math.random() * 10, look = 0, act = null;
  const setE = (j, x, y, z) => rig.j[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  const blendE = (j, x, y, z, w) => { const b = base[j]; rig.j[j].rotation.set(lerp(b.x, x * D2R, w), lerp(b.y, y * D2R, w), lerp(b.z, z * D2R, w), 'YXZ'); };
  // the blessing: he raises his right hand and makes the sign of the cross over the knight, head to breast, shoulder to shoulder
  const bless = () => { act = { kind: 'bless', t: 0 }; };
  // walking to a point (world space), then whatever comes next
  const walkTo = (target, done, ground) => { act = { kind: 'walk', target: target.clone(), done, ground, t: 0 }; };
  // sat down on a bench: the sutler's pose
  const sit = () => {
    act = null;
    setE('spine', 4, 0, 0); setE('chest', 6, 0, 0); setE('neck', 10, 0, 0); setE('head', -4, 0, 0); setE('hips', 0, 0, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { setE('thigh' + k, -88, 0, s * 6); setE('shin' + k, 84, 0, 0); setE('foot' + k, 6, 0, 0); setE('uArm' + k, -30, 0, s * 8); setE('fArm' + k, -70, -s * 25, 0); setE('hand' + k, 0, 0, 0); }
    for (const n in base) base[n] = rig.j[n].rotation.clone();
  };
  const update = (dt, camPos, watch) => {
    t0 += dt; const br = Math.sin(t0 * 1.3);
    if (act?.kind === 'bless') {
      const T = (act.t += dt), D = 3.4;
      const w = smoothstep01(T / 0.5) * (1 - smoothstep01((T - (D - 0.5)) / 0.5));
      // the hand traces: up at the brow, down to the breast, then from his left shoulder across to his right
      let ux = -78, uy = 8, fx = -48;
      if (T > 0.9 && T < 1.5) ux = lerp(-78, -42, smoothstep01((T - 0.9) / 0.6));
      else if (T >= 1.5 && T < 1.85) ux = lerp(-42, -62, smoothstep01((T - 1.5) / 0.35));
      if (T >= 1.85) { ux = -62; uy = lerp(30, -22, smoothstep01((T - 1.85) / 0.7)); }
      blendE('uArmR', ux, uy, -6, w); blendE('fArmR', fx, 15, 0, w); blendE('handR', -10, 0, -70, w);
      blendE('uArmL', -18, 0, 4, w); blendE('fArmL', -100, -48, 0, w);   // the left hand to his breast
      if (T > D) { act = null; for (const n of ['uArmR', 'fArmR', 'handR', 'uArmL', 'fArmL']) rig.j[n].rotation.copy(base[n]); }
    } else if (act?.kind === 'walk') {
      const root = rig.root, d = new THREE.Vector3(act.target.x - root.position.x, 0, act.target.z - root.position.z), L = d.length();
      act.t += dt; const a = Math.sin(act.t * 7.5);
      if (L < 0.12) { const done = act.done; act = null; J.hips.position.y = rig.basePos.y; for (const n of ['thighR', 'shinR', 'thighL', 'shinL', 'uArmR', 'uArmL']) rig.j[n].rotation.copy(base[n]); done?.(); }
      else {
        const step = Math.min(L, dt * 1.25); d.multiplyScalar(step / L); root.position.add(d);
        let ry = Math.atan2(d.x, d.z) - root.rotation.y; ry = Math.atan2(Math.sin(ry), Math.cos(ry)); root.rotation.y += ry * Math.min(1, dt * 6);
        if (act.ground) root.position.y = act.ground(root.position.x, root.position.z);
        setE('thighR', a * 24, 0, 0); setE('thighL', -a * 24, 0, 0); setE('shinR', Math.max(0, -a) * 35, 0, 0); setE('shinL', Math.max(0, a) * 35, 0, 0);
        J.hips.position.y = rig.basePos.y + Math.abs(a) * 0.015;
      }
    }
    J.chest.rotation.x = base.chest.x - br * 0.02; J.spine.rotation.z = base.spine.z + Math.sin(t0 * 0.23) * 0.02;
    if (!sutler) J.hips.rotation.z = base.hips.z + Math.sin(t0 * 0.23) * 0.015;
    let want = 0;
    if (watch) { J.neck.updateWorldMatrix(true, false); const p = new THREE.Vector3().setFromMatrixPosition(J.neck.matrixWorld); const ry = new THREE.Euler().setFromQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
      let a = Math.atan2(watch.x - p.x, watch.z - p.z) - ry; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.hypot(watch.x - p.x, watch.z - p.z) < 14) want = Math.max(-1.1, Math.min(1.1, a)); }
    look += (want - look) * Math.min(1, dt * 2);
    J.head.rotation.y = base.head.y + look * 0.65; J.neck.rotation.y = base.neck.y + look * 0.35;
    if (!camPos || rig.root.getWorldPosition(new THREE.Vector3()).distanceTo(camPos) < 70) for (const c of cloths) c.update(dt);
  };
  rig.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { rig, root: rig.root, hipsY: rig.j.hips.position.y, groundOffset, kind, cloths, update, bless, walkTo, sit, get busy() { return !!act; }, dispose: () => cloths.forEach((c) => c.dispose()) };
}


// ---------------------------------------------------------------- the frozen dead
// One of the Emperor's men, frozen where he stopped: a whole body (MakeHuman, like the living), grey-blue and
// rimed with ice, in a stiff frozen doublet and cloak and a morion helmet, posed as he died: sitting hunched with
// his arms round his knees, curled on his side, kneeling with his head bowed, or slumped back against the rock.
function frostMat(color, rough = 0.85, metal = 0) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFN; varying vec3 vFP;').replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvFN = normalize(mat3(modelMatrix) * objectNormal);').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFN; varying vec3 vFP;\nfloat fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat rime = smoothstep(0.2, 0.75, normalize(vFN).y + (fh(floor(vFP * 18.0)) - 0.5) * 0.35);\ndiffuseColor.rgb = mix(diffuseColor.rgb * 0.8, vec3(0.86, 0.9, 0.95), rime * 0.85) + step(0.985, fh(floor(vFP * 140.0))) * rime * 0.5;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, rime);');
  };
  m.customProgramCacheKey = () => 'frost' + metal;
  return m;
}
export function makeFrozen(pose = 'sit', seed = 0) {
  const kind = seed % 2 ? 'sutler' : 'priest', P = PEOPLE?.[kind];
  if (!P) return null;
  const rig = new Rig(1), J = rig.j;
  const body = personMesh(rig, P, { skin: 0x9aa0a6, hair: 0x2a2420, cloth: 0x4a1a14, eyes: P.eyes, frozen: 1 });
  const doublet = frostMat(seed % 3 === 0 ? 0x5a1a14 : seed % 3 === 1 ? 0x2a2a30 : 0x4a3a20), iron = frostMat(0x4a4642, 0.55, 0.7);
  // the doublet, puffed sleeves, a cloak frozen stiff about the shoulders
  J.chest.add(new THREE.Mesh(lathe([[0.08, 0.2], [0.18, 0.165], [0.22, 0.07], [0.205, -0.12], [0.19, -0.3], [0.2, -0.44]], 28, (v, a) => { const r = Math.hypot(v.x, v.z) * (1 + Math.sin(a * 10) * 0.02); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.8 + 0.012; }), doublet));
  for (const k of ['R', 'L']) { J['uArm' + k].add(new THREE.Mesh(lathe([[0.075, 0.03], [0.095, -0.12], [0.08, -0.3]], 14, () => {}), doublet)); J['fArm' + k].add(new THREE.Mesh(lathe([[0.07, 0.02], [0.065, -0.2]], 12, () => {}), doublet)); }
  for (const k of ['R', 'L']) J['thigh' + k].add(new THREE.Mesh(lathe([[0.1, 0.05], [0.11, -0.2], [0.085, -0.42]], 14, () => {}), doublet));
  const cloak = new THREE.Mesh(lathe([[0.12, 0.2], [0.24, 0.12], [0.32, -0.25], [0.36, -0.7]], 24, (v, a) => { if (Math.cos(a) > 0.55) { v.x *= 0.2; v.z *= 0.2; } const r = Math.hypot(v.x, v.z) * (1 + Math.sin(a * 7 + v.y * 4) * 0.05); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.85 - 0.03; }), frostMat(0x2a2622, 0.9));
  J.chest.add(cloak);
  // the morion: crest, brim turned up fore and aft
  const mor = new THREE.Mesh(lathe([[0, 0.14], [0.06, 0.135], [0.1, 0.1], [0.115, 0.04], [0.12, 0.0], [0.2, -0.01], [0.21, 0.01]], 22, (v, a) => { if (Math.hypot(v.x, v.z) > 0.13) v.y += Math.cos(a) ** 2 * 0.06; v.z *= 1.3; }), iron);
  const crest = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.11, 0), iron); mor.add(crest);
  seatOnCrown(mor, body, rig, 0.06); J.head.add(mor);
  const e = (j, x, y, z) => J[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  const lr = (fn) => { fn('R', -1); fn('L', 1); };
  if (pose === 'sit') {   // hunched on the ground, knees up, arms round them, head down on them
    e('spine', 35, 0, 0); e('chest', 25, 0, 0); e('neck', 30, 0, 0); e('head', 25, 0, 0);
    lr((k, s) => { e('thigh' + k, -115, 0, s * 8); e('shin' + k, 135, 0, 0); e('foot' + k, -20, 0, 0); e('uArm' + k, -60, 0, s * 18); e('fArm' + k, -85, -s * 50, 0); e('hand' + k, 0, 0, 0); });
    J.hips.position.y = rig.basePos.y - 0.72;
  } else if (pose === 'kneel') {   // on his knees, head bowed, hands together
    e('spine', 10, 0, 0); e('chest', 12, 0, 0); e('neck', 30, 0, 0); e('head', 20, 0, 0);
    lr((k, s) => { e('thigh' + k, -8, 0, s * 6); e('shin' + k, 110, 0, 0); e('foot' + k, 40, 0, 0); e('uArm' + k, -25, 0, s * 6); e('fArm' + k, -95, -s * 35, 0); });
    J.hips.position.y = rig.basePos.y - 0.42;
  } else if (pose === 'slump') {   // sat back against the rock, legs out, head fallen sideways
    e('spine', -12, 0, 0); e('chest', -6, 0, 0); e('neck', 10, 0, 22); e('head', 15, 20, 18);
    lr((k, s) => { e('thigh' + k, -88, s * 8, s * 10); e('shin' + k, 12, 0, 0); e('foot' + k, -10, 0, 0); e('uArm' + k, 8, 0, s * 12); e('fArm' + k, -25, 0, 0); });
    J.hips.position.y = rig.basePos.y - 0.86;
  } else {   // curled on his side
    rig.root.rotation.z = Math.PI / 2 * 0.98;
    e('spine', 30, 0, 0); e('chest', 25, 0, 0); e('neck', 25, 0, 0); e('head', 30, 0, 0);
    lr((k, s) => { e('thigh' + k, -80, 0, s * 4); e('shin' + k, 100, 0, 0); e('uArm' + k, -70, 0, s * 10); e('fArm' + k, -100, -s * 40, 0); });
  }
  // stand him on the ground: the lowest point of the posed body sits at the root's height
  const wrap = new THREE.Group(); wrap.add(rig.root); wrap.updateMatrixWorld(true);
  const v = new THREE.Vector3(); let low = 1e9; const n = body.geometry.attributes.position.count;
  for (let i = 0; i < n; i += 9) { body.getVertexPosition(i, v); v.applyMatrix4(body.matrixWorld); if (v.y < low) low = v.y; }
  rig.root.position.y -= low - 0.02;
  wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root: wrap, rig, head: J.head };
}
