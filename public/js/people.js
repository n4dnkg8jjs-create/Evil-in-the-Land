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
  const U = { uFrozen: { value: look.frozen || 0 }, uDead: { value: look.dead || 0 }, uBrow: { value: look.brow ?? 1 }, uShade: { value: look.shade ?? 1 }, uAge: { value: look.age || 0 }, uEyeL: { value: new THREE.Vector3(...(look.eyes?.[0] || [0, 0, 0])) }, uEyeR: { value: new THREE.Vector3(...(look.eyes?.[1] || [0, 0, 0])) }, uSkin: { value: new THREE.Color(look.skin) }, uHair: { value: new THREE.Color(look.hair) }, uCloth: { value: new THREE.Color(look.cloth) }, uShoe: { value: new THREE.Color(0x2a1d14) }, uEye: { value: EYE_TEX } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nattribute float hairAmt;\nflat varying float vReg;\nvarying float vHair;\nvarying vec2 vUv0;\nvarying vec3 vObj;\nvarying vec3 vWN;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvReg = region; vHair = hairAmt; vUv0 = uv; vObj = position;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vReg; varying float vHair; varying vec2 vUv0; varying vec3 vObj; varying vec3 vWN;
        uniform vec3 uSkin, uHair, uCloth, uShoe, uEyeL, uEyeR; uniform sampler2D uEye; uniform float uAge, uFrozen, uDead, uBrow, uShade;
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
        float rH = rS0 * smoothstep(0.15, 0.6, vHair * (0.75 + 0.5 * strand)) * (1.0 - uDead);   // the dead one: not a hair on him, not even brows
        // brows: thinned to separate hairs, skin showing through, a little lighter than the hair (uBrow < 1)
        { vec3 bq = vObj - (uEyeL + uEyeR) * 0.5; float bz = smoothstep(0.004, 0.012, bq.y) * (1.0 - smoothstep(0.03, 0.04, bq.y)) * (1.0 - smoothstep(0.05, 0.065, abs(bq.x))) * smoothstep(-0.02, 0.0, bq.z);
          float hairs = smoothstep(0.35, 0.75, pn(vec3(vObj.x * 900.0, vObj.y * 140.0, vObj.z * 900.0)));
          rH *= mix(1.0, uBrow * (0.35 + 0.65 * hairs), bz); hair = mix(hair, hair * 1.35 + vec3(0.03, 0.02, 0.01), bz * (1.0 - uBrow)); }
        float rS = rS0 - rH;
        vec3 cloth = uCloth * (0.75 + 0.35 * pn(vObj * vec3(160.0, 40.0, 160.0)));
        vec3 shoe = uShoe * (0.8 + 0.4 * pn(vObj * 60.0));
        vec3 eye = texture2D(uEye, vUv0).rgb;
        eye = mix(eye, vec3(0.78, 0.8, 0.74) * (0.85 + 0.25 * dot(eye, vec3(0.3, 0.6, 0.1))), uDead * 0.85);   // dead: clouded over, milky
        // frozen dead: the flesh grey-blue and waxen, lips and nail-beds dark, rime and ice on every face that the snow
        // fell on, glittering
        float fz = uFrozen;
        // dead: grey, waxen, the veins showing dark through it
        skin = mix(skin, uSkin * (0.7 + 0.4 * blot) * (1.0 - 0.3 * smoothstep(0.62, 0.7, pn(vObj * vec3(30.0, 90.0, 30.0)))), uDead);
        // the dead one's face is a skull under skin: sockets sunk deep and dark, the cheeks hollowed under the bones,
        // the temples fallen in, the eyelids bruised, and black under the jaw
        if (uDead > 0.0) {
          vec3 ec = (uEyeL + uEyeR) * 0.5, q = vObj - ec; float ax = abs(q.x);
          float sock = 0.0, lid = 0.0;
          for (int i = 0; i < 2; i++) { vec3 e = i == 0 ? uEyeL : uEyeR; vec3 d = (vObj - e) * vec3(1.0, 1.3, 1.0);
            float r = length(d.xy); sock = max(sock, 1.0 - smoothstep(0.012, 0.042, r)); lid = max(lid, (1.0 - smoothstep(0.008, 0.022, r)) * smoothstep(0.012, 0.0, abs(d.y + 0.012))); }
          float front = smoothstep(-0.04, 0.0, q.z);
          float cheek = smoothstep(0.022, 0.04, ax) * (1.0 - smoothstep(0.058, 0.074, ax)) * smoothstep(-0.018, -0.034, q.y) * (1.0 - smoothstep(-0.068, -0.085, q.y)) * front;
          float temple = smoothstep(0.046, 0.06, ax) * (1.0 - smoothstep(0.08, 0.095, ax)) * smoothstep(-0.015, 0.002, q.y) * (1.0 - smoothstep(0.035, 0.06, q.y));
          float nose = smoothstep(0.012, 0.0, abs(ax - 0.016)) * smoothstep(-0.03, -0.045, q.y) * (1.0 - smoothstep(-0.06, -0.07, q.y)) * front;
          float jaw = smoothstep(-0.095, -0.115, q.y) * (1.0 - smoothstep(-0.17, -0.19, q.y));
          float shade = clamp(sock * 0.9 + lid * 0.3 + cheek * 0.75 + temple * 0.6 + nose * 0.4 + jaw * 0.6, 0.0, 0.92);
          skin = mix(skin, skin * vec3(0.3, 0.24, 0.27), shade * uDead);
        }
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
        reflectedLight.indirectDiffuse += rS * uSkin * vec3(0.10, 0.03, 0.02) * (1.0 - uFrozen) * (1.0 - uDead);
        reflectedLight.indirectDiffuse *= 1.0 - 0.45 * uDead;   // the dead one: no fill in the hollows, only hard light and dark
        reflectedLight.directDiffuse *= uShade; reflectedLight.indirectDiffuse *= uShade; reflectedLight.directSpecular *= mix(uShade, 1.0, 0.35); reflectedLight.indirectSpecular *= uShade;   // in the dark of a helmet`);
  };
  mat.customProgramCacheKey = () => 'personSkin-v7';
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

// a MakeHuman head (and neck) skinned onto someone else's rig: the face of the man inside a knight's helmet. Only
// the triangles that ride on the head and neck are kept (the armour hides the rest); the rig keeps its own pose,
// place and scale.
const HEAD_SUB = {};
export function headOnRig(rig, look = {}, variant = 'sutler') {
  const P = PEOPLE?.[variant]; if (!P) return null;
  let sub = HEAD_SUB[variant];
  if (!sub) {
    const g = P.geo, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, idx = g.index.array;
    // the eyeballs ride bones this rig does not have, so take them by place: anything close round either eye
    const keep = new Set(['head', 'neck'].map((n) => JOINTS.indexOf(n))), PA = g.attributes.position, RG = g.attributes.region;
    const eyes = (P.eyes || []).map((e) => new THREE.Vector3(...e)), w = new THREE.Vector3();
    const nearEye = (v) => { w.fromBufferAttribute(PA, v); return eyes.some((e) => e.distanceTo(w) < 0.02); };
    const ok = (v) => (keep.has(SI.getX(v)) && SW.getX(v) > 0.45) || nearEye(v);
    const tris = []; for (let i = 0; i < idx.length; i += 3) if (ok(idx[i]) && ok(idx[i + 1]) && ok(idx[i + 2])) tris.push(idx[i], idx[i + 1], idx[i + 2]);
    sub = HEAD_SUB[variant] = new THREE.BufferGeometry(); for (const k in g.attributes) sub.setAttribute(k, g.attributes[k]);
    sub.setIndex(tris); sub.computeBoundingSphere();
  }
  // look.tuck: under a mail coif the neck is drawn in a little toward its own axis, so no skin can push out through the mail
  if (look.tuck) {
    const key = variant + '|tuck';
    if (!HEAD_SUB[key]) {
      const g = P.geo, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, PA = g.attributes.position.clone(), ni = JOINTS.indexOf('neck');
      let cx = 0, cz = 0, n = 0; for (let i = 0; i < PA.count; i++) if (SI.getX(i) === ni && SW.getX(i) > 0.5) { cx += PA.getX(i); cz += PA.getZ(i); n++; }
      cx /= n || 1; cz /= n || 1;
      for (let i = 0; i < PA.count; i++) {
        let w = 0; for (let c = 0; c < 4; c++) if (SI.array[i * 4 + c] === ni) w += SW.array[i * 4 + c];
        if (w <= 0.05) continue; const s = 1 - 0.13 * Math.min(1, w * 1.4);
        PA.setX(i, cx + (PA.getX(i) - cx) * s); PA.setZ(i, cz + (PA.getZ(i) - cz) * s);
      }
      const t = HEAD_SUB[key] = new THREE.BufferGeometry(); for (const k in sub.attributes) t.setAttribute(k, k === 'position' ? PA : sub.attributes[k]);
      t.setIndex(sub.index); t.computeBoundingSphere();
    }
    sub = HEAD_SUB[key];
  }
  const root = rig.root, sp = root.position.clone(), sq = root.quaternion.clone(), ss = root.scale.clone();
  const saved = JOINTS.map((n) => rig.j[n].quaternion.clone()), savedHip = rig.j.hips.position.clone();
  for (const n of JOINTS) { const q = P.bind[n]; rig.j[n].quaternion.set(q[0], q[1], q[2], q[3]); }
  rig.j.hips.position.copy(rig.basePos); root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1); root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(sub, personMat({ ...look, eyes: P.eyes }));
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; root.add(mesh);
  // seated a little back and down in the helmet, so the nose and lips stay behind the bevor (the offset is bound in)
  if (look.seat) { mesh.position.fromArray(look.seat); if (look.seatScale) mesh.scale.setScalar(look.seatScale); }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(JOINTS.map((n) => rig.j[n])), mesh.matrixWorld);
  JOINTS.forEach((n, i) => rig.j[n].quaternion.copy(saved[i])); rig.j.hips.position.copy(savedHip);
  root.position.copy(sp); root.quaternion.copy(sq); root.scale.copy(ss); root.updateMatrixWorld(true);
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
// ---------------------------------------------------------------- rope
// A laid three-strand rope along a line of points: each strand a helical ridge winding along it, so the twist
// shows in the light. The tube is rebuilt in place (fixed topology), so a hanging end can swing.
function ropeGeometry(nPts, radial = 12) {
  const g = new THREE.BufferGeometry(), idx = [];
  for (let i = 0; i < nPts - 1; i++) for (let j = 0; j < radial; j++) { const a = i * radial + j, b = i * radial + (j + 1) % radial, c = a + radial, d = b + radial; idx.push(a, b, c, b, d, c); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nPts * radial * 3), 3).setUsage(THREE.DynamicDrawUsage)); g.setIndex(idx);
  g.userData.rope = { nPts, radial };
  return g;
}
const _rT = new THREE.Vector3(), _rN = new THREE.Vector3(), _rB = new THREE.Vector3();
// pts: the rope's centre line; twist: radians of lay per metre; prof(u, th): radius scale along it (knots, the frayed end)
function ropeFill(g, pts, rad, twist, prof, closed = false) {
  const { nPts, radial } = g.userData.rope, P = g.attributes.position.array;
  let s = 0;
  for (let i = 0; i < nPts; i++) {
    const p = pts[i], a = i > 0 ? pts[i - 1] : closed ? pts[nPts - 2] : p, b = i < nPts - 1 ? pts[i + 1] : closed ? pts[1] : p;
    _rT.subVectors(b, a).normalize();
    if (i === 0) { _rN.set(0, 1, 0); if (Math.abs(_rT.y) > 0.9) _rN.set(1, 0, 0); _rN.cross(_rT).normalize(); }
    else { _rN.addScaledVector(_rT, -_rN.dot(_rT)).normalize(); s += p.distanceTo(a); }   // carried along without spin
    _rB.crossVectors(_rT, _rN);
    const u = i / (nPts - 1);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2, k = prof ? prof(u, th) : 1;
      const r = rad * k * (0.94 + 0.17 * Math.cos(3 * (th - s * twist)));   // three strands, laid right-handed
      const c = Math.cos(th) * r, sn = Math.sin(th) * r, o = (i * radial + j) * 3;
      P[o] = p.x + _rN.x * c + _rB.x * sn; P[o + 1] = p.y + _rN.y * c + _rB.y * sn; P[o + 2] = p.z + _rN.z * c + _rB.z * sn;
    }
  }
  g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}
// The two ends of the cincture, hanging from its knot: chains of points under gravity (verlet), held off the
// swinging cassock and its wearer's legs, each ending in a knot and a frayed tassel. Shaped like a Cloth (mesh,
// wind, ground, update, dispose) so whoever adds his cloth to the scene and steps it does the same for these.
function ropeTails(bone, local, side, mat, skirt) {
  const N = 15, tails = [{ len: 0.62, off: -0.014 }, { len: 0.5, off: 0.014 }].map((t) => ({ ...t, seg: t.len / (N - 1), p: [], q: [], geo: ropeGeometry(N, 10) }));
  const mesh = new THREE.Group();
  for (const t of tails) { const m = new THREE.Mesh(t.geo, mat); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; mesh.add(m); }
  const o = { mesh, wind: new THREE.Vector3(), ground: -1e9, inited: false, time: Math.random() * 9 };
  const A = new THREE.Vector3(), H = new THREE.Vector3(), X = new THREE.Vector3(), d = new THREE.Vector3(), out = new THREE.Vector3(), q = new THREE.Vector3();
  // a fat knot a little above the end, then the rope unlaid into a frayed tassel
  const prof = (u, th) => u < 0.82 ? 1 : u < 0.9 ? 1 + Math.sin(((u - 0.82) / 0.08) * Math.PI) * (0.95 + Math.cos(th * 2) * 0.12) : 1.05 + ((u - 0.9) / 0.1) * 0.45 + Math.max(0, Math.cos(th * 7)) * 0.25 * (u - 0.9) / 0.1;
  const twist = (Math.PI * 2) / 0.075;
  o.update = (dt) => {
    bone.updateWorldMatrix(true, false); const M = bone.matrixWorld;
    A.copy(local).applyMatrix4(M); H.setFromMatrixPosition(M); X.copy(side).transformDirection(M);
    const h = Math.min(dt, 1 / 30); o.time += h;
    const wind = Math.sin(o.time * 1.7) * 0.5 + 0.5;
    for (const t of tails) {
      const a0 = d.copy(A).addScaledVector(X, t.off);
      if (!o.inited) { for (let i = 0; i < N; i++) { t.p.push(a0.clone().add(new THREE.Vector3(0, -i * t.seg, 0))); t.q.push(t.p[i].clone()); } }
      for (let i = 1; i < N; i++) {   // verlet: what it was moving, damped, with gravity and a breath of the wind
        const p = t.p[i], pv = t.q[i];
        const vx = (p.x - pv.x) * 0.965, vy = (p.y - pv.y) * 0.965, vz = (p.z - pv.z) * 0.965; pv.copy(p);
        p.x += vx + o.wind.x * 0.004 * wind * h; p.y += vy - 9.8 * h * h; p.z += vz + o.wind.z * 0.004 * wind * h;
      }
      for (let it = 0; it < 8; it++) {
        t.p[0].copy(a0);
        for (let i = 1; i < N; i++) {
          const a = t.p[i - 1], b = t.p[i]; q.subVectors(b, a); const l = q.length() || 1e-6, e = (l - t.seg) / l;
          if (i === 1) b.addScaledVector(q, -e); else { a.addScaledVector(q, e * 0.5); b.addScaledVector(q, -e * 0.5); }
        }
      }
      t.p[0].copy(a0);
      // never inside the cassock: push each point out past the nearest cloth of the skirt, away from his middle
      if (skirt?.inited) {
        const C = skirt.cols, R = skirt.rows, S = skirt.pos;
        for (let i = 1; i < N; i++) {
          const p = t.p[i], jc = Math.round((A.y - p.y) / skirt.lenAlong); let best = 1e9, bi = -1;
          for (let j = Math.max(0, jc - 2); j <= Math.min(R - 1, jc + 2); j++) for (let c = 0; c < C; c++) { const k = (j * C + c) * 3, dd = (S[k] - p.x) ** 2 + (S[k + 1] - p.y) ** 2 + (S[k + 2] - p.z) ** 2; if (dd < best) { best = dd; bi = k; } }
          if (bi < 0) continue;
          q.set(S[bi], S[bi + 1], S[bi + 2]); out.set(q.x - H.x, 0, q.z - H.z); const ol = out.length(); if (ol < 1e-4) continue; out.divideScalar(ol);
          const pen = (p.x - q.x) * out.x + (p.z - q.z) * out.z;
          if (pen < 0.02) { p.x += out.x * (0.02 - pen); p.z += out.z * (0.02 - pen); }
        }
      }
      for (let i = 1; i < N; i++) if (t.p[i].y < o.ground + 0.012) t.p[i].y = o.ground + 0.012;
      ropeFill(t.geo, t.p, 0.0105, twist, prof);
    }
    o.inited = true;
  };
  o.dispose = () => { mesh.removeFromParent(); for (const t of tails) t.geo.dispose(); };
  return o;
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
    // buttons down the front (the rope cincture is laid round him below, once his outline is measured)
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
  const base = {}; for (const n of ['spine', 'chest', 'neck', 'head', 'hips', 'uArmR', 'fArmR', 'handR', 'uArmL', 'fArmL', 'handL', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL']) base[n] = rig.j[n].rotation.clone();
  const setE = (j, x, y, z) => rig.j[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  const dispose = () => cloths.forEach((c) => c.dispose());
  rig.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  if (sutler) {
    // alive: he breathes, shifts on his seat, and turns his head to watch whoever comes near
    let t0 = Math.random() * 10, look = 0;
    const update = (dt, camPos, watch) => {
      t0 += dt; const br = Math.sin(t0 * 1.3);
      J.chest.rotation.x = base.chest.x - br * 0.02; J.spine.rotation.z = base.spine.z + Math.sin(t0 * 0.23) * 0.02;
      let want = 0;
      if (watch) { J.neck.updateWorldMatrix(true, false); const p = new THREE.Vector3().setFromMatrixPosition(J.neck.matrixWorld); const ry = new THREE.Euler().setFromQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
        let a = Math.atan2(watch.x - p.x, watch.z - p.z) - ry; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.hypot(watch.x - p.x, watch.z - p.z) < 14) want = Math.max(-1.1, Math.min(1.1, a)); }
      look += (want - look) * Math.min(1, dt * 2);
      J.head.rotation.y = base.head.y + look * 0.65; J.neck.rotation.y = base.neck.y + look * 0.35;
      if (!camPos || rig.root.getWorldPosition(new THREE.Vector3()).distanceTo(camPos) < 70) for (const c of cloths) c.update(dt);
    };
    return { rig, root: rig.root, hipsY: rig.j.hips.position.y, groundOffset, kind, cloths, update, bless() {}, sit() {}, busy: false, dispose };
  }

  // ---------------------------------------------------------------- the cincture
  // A laid hemp rope round his waist over the cassock, lying just outside the measured outline of his body and
  // over the seam where the skirt is gathered, knotted at his left front; its two ends hang from the knot and swing.
  {
    const hemp = new THREE.MeshStandardMaterial({ color: 0x9c8864, roughness: 0.92, side: THREE.DoubleSide });
    const n = 120, yL = 0.045, rr = [];
    for (let i = 0; i < n; i++) { const an = (i / n) * Math.PI * 2; rr.push(Math.max(Math.hypot(Math.sin(an) * 0.198, Math.cos(an) * 0.162), hullR(an, yL) + 0.04)); }
    for (let pass = 0; pass < 4; pass++) { const r0 = rr.slice(); for (let i = 0; i < n; i++) rr[i] = Math.max(r0[i], (r0[(i + n - 1) % n] + r0[i] + r0[(i + 1) % n]) / 3); }
    const at = (an, out = 0) => { const r = rr[Math.round((((an % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n) % n] + out; return new THREE.Vector3(Math.sin(an) * r, yL - Math.max(0, Math.cos(an)) * 0.012, Math.cos(an) * r + 0.006); };
    const pts = []; for (let i = 0; i <= n; i++) pts.push(at(((i % n) / n) * Math.PI * 2));
    let L = 0; for (let i = 1; i <= n; i++) L += pts[i].distanceTo(pts[i - 1]);
    const loop = ropeGeometry(n + 1, 12); ropeFill(loop, pts, 0.0115, (Math.round((3 * L) / 0.075) * Math.PI * 2) / (3 * L), null, true);
    const lm = new THREE.Mesh(loop, hemp); lm.castShadow = true; lm.receiveShadow = true; J.hips.add(lm);
    // the knot, at his left front, and the ends hanging from it
    const ka = 0.8, ko = new THREE.Vector3(Math.sin(ka), 0, Math.cos(ka));
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.016, 0.0085, 72, 8, 2, 3), hemp); knot.position.copy(at(ka, 0.014)); knot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ko); knot.scale.set(1, 1.15, 0.75); knot.castShadow = true; J.hips.add(knot);
    const tails = ropeTails(J.hips, at(ka, 0.022).add(new THREE.Vector3(0, -0.018, 0)), new THREE.Vector3(Math.cos(ka), 0, -Math.sin(ka)), hemp, cloths[0]);
    tails.wind.set(1.6, 0, 0.6); cloths.push(tails);
  }

  // ---------------------------------------------------------------- the priest in motion
  // His feet are set down in the world and his legs found from them by IK, so they never slide or float: a foot
  // moves only by stepping, one at a time, lifting and setting down where his body is going, and his hips sink
  // when a leg must reach. Over this the upper body is posed (idle, walking, climbing, sitting) and blended.
  const V3 = THREE.Vector3, Q = THREE.Quaternion, root = rig.root;
  const SIDES = [['R', -1], ['L', 1]];
  const lr = (f) => { const o = {}; for (const [k, s] of SIDES) Object.assign(o, f(k, s)); return o; };
  const torso = (sp, ch, nk, hd) => ({ spine: [sp, 0, 0], chest: [ch, 0, 0], neck: [nk, 0, 0], head: [hd, 0, 0] });
  const foldA = lr((k, s) => ({ ['uArm' + k]: [-14, 0, s * 4], ['fArm' + k]: [-85, -s * 32, 0], ['hand' + k]: [0, -s * 15, 0] }));
  const POSE = {
    stand: { ...torso(6, 9, 14, -8), ...foldA },                                                                                   // hands folded at his breast
    low: { ...torso(5, 8, 17, -4), ...lr((k, s) => ({ ['uArm' + k]: [-6, 0, s * 5], ['fArm' + k]: [-60, -s * 40, 0], ['hand' + k]: [0, -s * 12, 0] })) },   // clasped low before him
    walk: { ...torso(11, 8, 12, -2), ...foldA },
    climb: { ...torso(24, 12, 2, 16), ...lr((k, s) => ({ ['uArm' + k]: [-45, 0, s * 10], ['fArm' + k]: [-50, 0, 0], ['hand' + k]: [0, 0, 0] })) },
    sit: { ...torso(3, 6, 10, -4), ...lr((k, s) => ({ ['uArm' + k]: [-26, 0, s * 8], ['fArm' + k]: [-74, -s * 30, 0], ['hand' + k]: [0, -s * 12, 0] })) },
  };
  const PJ = Object.keys(POSE.stand), cur = {};
  const mix = (list) => { for (const j of PJ) { let x = 0, y = 0, z = 0, W = 0; for (const [p, w] of list) { const v = p[j]; if (!v || !(w > 0)) continue; x += v[0] * w; y += v[1] * w; z += v[2] * w; W += w; } cur[j] = W > 0 ? [x / W, y / W, z / W] : [0, 0, 0]; } };
  const over = (j, v, w) => { const c = cur[j]; cur[j] = [lerp(c[0], v[0], w), lerp(c[1], v[1], w), lerp(c[2], v[2], w)]; };
  // where each ankle sits standing, in his own frame, and how the foot is turned
  root.updateMatrixWorld(true);
  const rq = root.getWorldQuaternion(new Q()).invert(), rest = {};
  for (const [k] of SIDES) { const f = J['foot' + k]; const a = root.worldToLocal(f.getWorldPosition(new V3())); rest[k] = { x: a.x, z: a.z, h: a.y + groundOffset, q: rq.clone().multiply(f.getWorldQuaternion(new Q())) }; }
  const hips0 = J.hips.position.clone(), REACH = 0.86;
  const feet = {}; for (const [k] of SIDES) feet[k] = { p: new V3(), yaw: 0, pitch: 0, sw: null };
  let space = null, mode = 'stand', planted = false, lastStep = 'L', ground = null, drop = 0, gap = 0, act = null, walk = null, script = null;
  let t0 = Math.random() * 10, look = 0, lookX = 0, gaze = 0, gazeDown = 0, gazeT = 2, lowW = 0, lowGoal = 0, lowT = 6 + Math.random() * 6, turning = false, hipSh = 0;
  const vel = new V3(), prev = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _q = new Q(), _q2 = new Q(), _q3 = new Q(), _e = new THREE.Euler(), _X = new V3(1, 0, 0);
  const angD = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const yawOf = (o) => _e.setFromQuaternion(o.getWorldQuaternion(_q3), 'YXZ').y;
  const spaceYaw = () => space ? yawOf(space) : 0;
  const toWorld = (v, o) => space ? o.copy(v).applyMatrix4(space.matrixWorld) : o.copy(v);
  const toSpace = (v, o) => space ? space.worldToLocal(o.copy(v)) : o.copy(v);
  const plantHere = () => {
    root.updateMatrixWorld(true); const ry = yawOf(root) - spaceYaw();
    for (const [k] of SIDES) { const r = rest[k], w = root.localToWorld(_a.set(r.x, -groundOffset, r.z)); if (ground && !space) w.y = ground(w.x, w.z); toSpace(w, feet[k].p); feet[k].yaw = ry; feet[k].sw = null; }
    prev.copy(root.position); planted = true;
  };
  // the frame the feet are kept in: the world, or the wagon once he climbs onto it (so he rides with it)
  const setSpace = (s) => {
    const all = []; for (const [k] of SIDES) { const f = feet[k]; all.push(f.p, ...(f.sw ? [f.sw.from, f.sw.to] : [])); f.yaw += spaceYaw(); if (f.sw) { f.sw.y0 += spaceYaw(); f.sw.y1 += spaceYaw(); } }
    for (const v of all) toWorld(v, v);
    space = s; if (s) s.updateWorldMatrix(true, false);
    for (const v of all) toSpace(v, v);
    for (const [k] of SIDES) { const f = feet[k]; f.yaw -= spaceYaw(); if (f.sw) { f.sw.y0 -= spaceYaw(); f.sw.y1 -= spaceYaw(); } }
  };
  const step = (k, to, yaw, D, lift = 0.06) => { const f = feet[k]; f.sw = { from: f.p.clone(), to: to.clone(), y0: f.yaw, y1: yaw, t: 0, D, lift }; lastStep = k; };
  const advanceSteps = (dt) => {
    for (const [k] of SIDES) {
      const f = feet[k], S = f.sw; if (!S) continue;
      S.t += dt; const s = Math.min(1, S.t / S.D), hz = smoothstep01((s - 0.1) / 0.8);
      // up a step the foot rises first and then goes in; down, it goes out first and then drops
      const vy = S.to.y > S.from.y + 0.05 ? smoothstep01(s * 1.6) : S.to.y < S.from.y - 0.05 ? smoothstep01((s - 0.3) / 0.7) : s;
      f.p.set(lerp(S.from.x, S.to.x, hz), lerp(S.from.y, S.to.y, vy) + S.lift * Math.sin(Math.PI * s), lerp(S.from.z, S.to.z, hz));
      f.yaw = S.y0 + angD(S.y1, S.y0) * hz; f.pitch = Math.sin(Math.PI * 2 * s) * 0.32;   // toe down as it leaves the ground, up as the heel comes down
      if (s >= 1) { f.p.copy(S.to); f.yaw = S.y1; f.pitch = 0; f.sw = null; }
    }
  };
  const swingOf = () => { for (const [k, s] of SIDES) if (feet[k].sw) return { k, s, u: Math.min(1, feet[k].sw.t / feet[k].sw.D) }; return null; };
  // on the ground: step whichever foot has been left behind (or turned from) by where his body has gone
  const autoStep = (moving) => {
    if (feet.R.sw || feet.L.sw) return true;
    const ry = root.rotation.y, c = Math.cos(ry), s = Math.sin(ry), D = moving ? 0.46 : 0.42;
    let best = null, bs = 0, any = false;
    for (const [k] of SIDES) {
      const r = rest[k], f = feet[k], hx = root.position.x + r.x * c + r.z * s, hz = root.position.z - r.x * s + r.z * c;
      const need = Math.hypot(f.p.x - hx, f.p.z - hz) / (moving ? 0.15 : 0.07) + Math.abs(angD(f.yaw, ry)) / 0.42;
      if (need <= 1) continue;
      any = true; const sc = need - (k === lastStep ? 0.5 : 0);
      if (sc > bs) { bs = sc; const lead = moving ? D + 0.25 : 0; best = [k, hx + vel.x * lead, hz + vel.z * lead]; }
    }
    if (best && gap <= 0) { const [k, x, z] = best; step(k, _c.set(x, ground ? ground(x, z) : feet[k].p.y, z), ry, D, moving ? 0.075 : 0.05); gap = moving ? 0.05 : 0.12; }
    return any;
  };
  // the legs: hips sunk as far as the farther foot needs, each ankle put on its foot's place, the foot set flat
  const legs = (dt, lift = 0) => {
    if (space) space.updateWorldMatrix(true, false);
    J.hips.position.y = hips0.y + lift; root.updateMatrixWorld(true);
    let need = 0;
    for (const [k] of SIDES) {
      toWorld(feet[k].p, _a); _a.y += rest[k].h; J['thigh' + k].getWorldPosition(_b);
      const h2 = (_a.x - _b.x) ** 2 + (_a.z - _b.z) ** 2, dy = _b.y - _a.y, dd = REACH * REACH > h2 ? dy - Math.sqrt(REACH * REACH - h2) : dy;
      need = Math.max(need, dd);
    }
    drop = need > drop ? need : Math.max(need, drop - dt * 0.6); drop = Math.min(drop, 0.5);
    J.hips.position.y = hips0.y + lift - drop;
    root.updateMatrixWorld(true);
    const ry = yawOf(root), sy = spaceYaw();
    for (const [k, s] of SIDES) {
      const f = feet[k]; toWorld(f.p, _a); _a.y += rest[k].h;
      const ox = s * 0.25;   // knees forward, a little out
      _b.set(ox * Math.cos(ry) + Math.sin(ry), 0, -ox * Math.sin(ry) + Math.cos(ry));
      rig.solveLeg(k, _a, _b);
      _q.setFromEuler(_e.set(0, sy + f.yaw, 0, 'YXZ')).multiply(rest[k].q);
      if (f.pitch) _q.multiply(_q2.setFromAxisAngle(_X, f.pitch));
      const sh = J['shin' + k]; sh.updateWorldMatrix(true, false);
      J['foot' + k].quaternion.copy(sh.getWorldQuaternion(_q2).invert().multiply(_q));
    }
  };
  // a hand to a world point (a grab iron, the seat's edge), blended over the posed arm by w
  const reachArm = (k, s, tgt, w) => {
    if (!(w > 0.002)) return;
    const U = J['uArm' + k], F = J['fArm' + k], qu = U.quaternion.clone(), qf = F.quaternion.clone();
    U.getWorldPosition(_a); _b.copy(tgt).sub(_a); const l = _b.length(); _b.multiplyScalar(Math.max(0.05, l - 0.075) / (l || 1)).add(_a);
    const ry = yawOf(root), ox = s * 0.7; _c.set(ox * Math.cos(ry) - 0.4 * Math.sin(ry), -1, -ox * Math.sin(ry) - 0.4 * Math.cos(ry));   // elbow down, out and back
    rig.solveArm(k, _b, _c);
    U.quaternion.copy(qu.slerp(U.quaternion, w)); F.quaternion.copy(qf.slerp(F.quaternion, w));
  };

  // the blessing: he raises his right hand and makes the sign of the cross over the knight, head to breast, shoulder to shoulder
  const bless = () => { if (mode === 'stand') act = { kind: 'bless', t: 0 }; };
  const blessPose = (dt) => {
    const T = (act.t += dt), D = 3.6;
    const w = smoothstep01((T - 0.2) / 0.55) * (1 - smoothstep01((T - (D - 0.55)) / 0.55));
    // the hand traces: up at the brow, down to the breast, then from his left shoulder across to his right
    let ux = -78, uy = 8; const fx = -48;
    if (T > 1.0 && T < 1.6) ux = lerp(-78, -42, smoothstep01((T - 1.0) / 0.6));
    else if (T >= 1.6 && T < 1.95) ux = lerp(-42, -62, smoothstep01((T - 1.6) / 0.35));
    if (T >= 1.95) { ux = -62; uy = lerp(30, -22, smoothstep01((T - 1.95) / 0.75)); }
    over('uArmR', [ux, uy, -6], w); over('fArmR', [fx, 15, 0], w); over('handR', [-10, 0, -70], w);
    over('uArmL', [-18, 0, 4], w); over('fArmL', [-100, -48, 0], w);   // the left hand to his breast
    // he bows his head as he begins, looks up at the knight to bless him, and bows again at the end
    const bow = smoothstep01(T / 0.4) * (1 - smoothstep01((T - 0.8) / 0.4)) + smoothstep01((T - (D - 0.7)) / 0.3) * (1 - smoothstep01((T - D) / 0.4));
    over('head', [cur.head[0] + 22, 0, 0], bow); over('chest', [cur.chest[0] + 5, 0, 0], Math.max(bow, w * 0.6));
    if (T > D + 0.4) act = null;
  };
  // walking to a point (world space), turning at the end to face `face` (a world yaw) if given, then whatever comes next
  const walkTo = (target, done, gfn, face) => { if (gfn) ground = gfn; if (space) setSpace(null); mode = 'walk'; act = null; walk = { target: target.clone(), done, face, v: 0, settle: 0 }; };
  const walkUpdate = (dt) => {
    const W = walk, dx = W.target.x - root.position.x, dz = W.target.z - root.position.z, L = Math.hypot(dx, dz);
    if (L > 0.05) {
      const h = Math.atan2(dx, dz), da = angD(h, root.rotation.y);
      root.rotation.y += Math.sign(da) * Math.min(Math.abs(da), dt * 2.0);
      const want = Math.min(0.85, L * 0.8 + 0.12) * Math.max(0.15, 1 - Math.abs(da) * 0.7);
      W.v += Math.max(-dt * 1.6, Math.min(dt * 0.9, want - W.v));
      const st = Math.min(L, W.v * dt); root.position.x += (dx / L) * st; root.position.z += (dz / L) * st;
    } else {
      W.v = 0;
      if (W.face !== undefined) { const da = angD(W.face, root.rotation.y); root.rotation.y += Math.sign(da) * Math.min(Math.abs(da), dt * 1.5); }
    }
    if (ground) root.position.y += (ground(root.position.x, root.position.z) + groundOffset - root.position.y) * Math.min(1, dt * 10);
    const moving = W.v > 0.08, needs = autoStep(moving);
    const faced = W.face === undefined || Math.abs(angD(W.face, root.rotation.y)) < 0.03;
    W.settle = L <= 0.05 && faced && !needs && !feet.R.sw && !feet.L.sw ? W.settle + dt : 0;
    if (W.settle > 0.15) { const done = W.done; walk = null; mode = 'stand'; done?.(); }
  };

  // ---- climbing up onto the wagon's box and sitting down beside the sutler
  // S: places on the wagon in its own frame: stand [x, z] on the ground beside the step; step, fbR, fbL (where his
  // feet go on the step iron and the footboard), turnR, turnL (his feet once he has turned to face forward),
  // grip (the grab iron), grip2 (the seat's end), seat (where his hips come to rest)
  const board = (wagon, S, done, gfn) => {
    if (gfn) ground = gfn;
    wagon.updateMatrixWorld(true);
    const st = new V3(S.stand[0], 0, S.stand[1]).applyMatrix4(wagon.matrixWorld); if (ground) st.y = ground(st.x, st.z);
    walkTo(st, () => startBoard(wagon, S, done), ground, yawOf(wagon) - Math.PI / 2);
  };
  const startBoard = (wagon, S, done) => {
    setSpace(wagon); mode = 'board';
    const v = (a) => new V3(a[0], a[1], a[2]), go = groundOffset;
    const r0 = wagon.worldToLocal(root.position.clone()), y0 = angD(root.rotation.y, spaceYaw());
    const haul = new V3(S.step[0] + 0.16, S.step[1] + go - 0.03, S.step[2] - 0.1);
    const top = new V3((S.fbR[0] + S.fbL[0]) / 2, S.fbR[1] + go, (S.fbR[2] + S.fbL[2]) / 2);
    const turned = new V3((S.turnR[0] + S.turnL[0]) / 2, S.turnR[1] + go, (S.turnR[2] + S.turnL[2]) / 2 - 0.02);
    const seat = new V3(S.seat[0] - hips0.x, S.seat[1] - hips0.y, S.seat[2] - hips0.z);
    const lean = r0.clone().add(new V3(-0.06, 0, 0));
    script = { wagon, done, i: 0, t: 0, from: r0.clone(), yawFrom: y0, grip: v(S.grip), grip2: v(S.grip2), phases: [
      // he takes hold of the grab iron with his right hand, looking down at the step
      { D: 0.8, root: lean, yaw: y0, climb: (s) => s * 0.7, hR: (s) => smoothstep01(s / 0.85), hL: () => 0 },
      // left foot up onto the step iron
      { D: 0.75, root: lean, yaw: y0, climb: () => 0.7, hR: () => 1, hL: () => 0, steps: [[0, 'L', v(S.step), y0, 0.68, 0.16]] },
      // hauls himself up on it, the right foot coming up onto the footboard, the left hand to the seat's end
      { D: 1.25, root: haul, yaw: y0, climb: (s) => 0.7 + s * 0.3, hR: () => 1, hL: (s) => smoothstep01((s - 0.25) / 0.5), steps: [[0.28, 'R', v(S.fbR), y0, 0.78, 0.15]], ease: (s) => smoothstep01(s * 1.1) },
      // and up onto the footboard, the left foot after it, letting go
      { D: 1.15, root: top, yaw: y0, climb: (s) => 1 - s * 0.6, hR: (s) => 1 - smoothstep01((s - 0.45) / 0.4), hL: (s) => 1 - smoothstep01((s - 0.3) / 0.4), steps: [[0.18, 'L', v(S.fbL), y0, 0.72, 0.14]], ease: (s) => smoothstep01(s * 1.15) },
      // turns round on the footboard to face the horses, his back to the seat
      { D: 1.0, root: turned, yaw: 0, climb: (s) => 0.4 * (1 - s), hR: () => 0, hL: () => 0, steps: [[0.0, 'R', v(S.turnR), 0, 0.45, 0.05], [0.5, 'L', v(S.turnL), 0, 0.45, 0.05]] },
      // and sits down, reaching back for the seat with his right hand
      { D: 1.3, root: seat, yaw: 0, climb: (s) => Math.sin(Math.PI * s) * 0.55, sit: (s) => smoothstep01(s), hR: (s) => Math.sin(Math.PI * Math.min(1, s * 1.2)) * 0.8, hL: () => 0, grip3: v([S.seat[0] - 0.22, S.seat[1] - 0.05, S.seat[2] - 0.1]), ease: (s) => smoothstep01(s) },
    ] };
    for (const P of script.phases) if (P.steps) P.steps = P.steps.map((s) => ({ at: s[0], k: s[1], to: s[2], yaw: s[3], D: s[4], lift: s[5], go: false }));
  };
  const seated = () => {
    const w = script.wagon, done = script.done; script = null;
    w.attach(root); mode = 'seated'; for (const n of PJ) base[n] = rig.j[n].rotation.clone();
    done?.();
  };
  // if something has gone wrong and he cannot be walked there: put him on the seat (the old way), feet on the footboard
  const seatNow = (wagon, S) => {
    act = null; walk = null; script = null; wagon.updateMatrixWorld(true);
    if (root.parent !== wagon) { if (root.parent) root.removeFromParent(); wagon.add(root); }
    root.position.set(S.seat[0] - hips0.x, S.seat[1] - hips0.y, S.seat[2] - hips0.z); root.rotation.set(0, 0, 0);
    space = wagon; for (const [k, key] of [['R', 'turnR'], ['L', 'turnL']]) { feet[k].p.set(...S[key]); feet[k].yaw = 0; feet[k].sw = null; }
    planted = true; mode = 'seated';
  };
  const boardUpdate = (dt) => {
    const B = script, P = B.phases[B.i]; B.t += dt; const s = Math.min(1, B.t / P.D);
    for (const st of P.steps || []) if (!st.go && s >= st.at) { st.go = true; step(st.k, st.to, st.yaw, st.D, st.lift); }
    const e = (P.ease || smoothstep01)(s);
    _a.copy(B.from).lerp(P.root, e); const yaw = B.yawFrom + angD(P.yaw, B.yawFrom) * e;
    B.wagon.updateMatrixWorld(true); root.position.copy(B.wagon.localToWorld(_a)); root.rotation.set(0, yawOf(B.wagon) + yaw, 0);
    const climb = P.climb(s), sit = P.sit ? P.sit(s) : 0;
    mix([[POSE.stand, Math.max(0, 1 - climb - sit)], [POSE.climb, climb], [POSE.sit, sit]]);
    B.cur = { hR: P.hR(s), hL: P.hL(s), P };
    if (s >= 1 && !(P.steps || []).some((st) => feet[st.k].sw)) {
      B.from = P.root.clone(); B.yawFrom = P.yaw; B.t = 0; B.i++;
      if (B.i >= B.phases.length) return true;
    }
    return false;
  };

  const update = (dt, camPos, watch) => {
    dt = Math.min(dt, 0.1); t0 += dt; gap -= dt;
    if (!planted) plantHere();
    advanceSteps(dt);
    const br = Math.sin(t0 * 1.25);
    let lift = 0, finished = false;
    if (mode === 'walk' && walk) {
      walkUpdate(dt);
      mix([[POSE.walk, 1]]);
    } else if (mode === 'board' && script) {
      finished = boardUpdate(dt);
    } else if (mode === 'seated') {
      mix([[POSE.sit, 1]]);
    } else {
      // standing: now and then he lets his folded hands down before him and takes them up again
      lowT -= dt; if (lowT < 0) { lowT = 8 + Math.random() * 9; lowGoal = 1 - lowGoal; }
      lowW += (lowGoal - lowW) * Math.min(1, dt * 1.1);
      mix([[POSE.stand, 1 - lowW], [POSE.low, lowW]]);
      // he turns to face a knight who comes to him, stepping round
      if (watch && !act) {
        const dx = watch.x - root.position.x, dz = watch.z - root.position.z, dd = Math.hypot(dx, dz);
        if (dd < 6 && dd > 0.7) { const da = angD(Math.atan2(dx, dz), root.rotation.y); if (Math.abs(da) > 0.6) turning = true; if (Math.abs(da) < 0.1) turning = false; if (turning) root.rotation.y += Math.sign(da) * Math.min(Math.abs(da), dt * 1.2); }
        else turning = false;
      }
      if (ground) root.position.y += (ground(root.position.x, root.position.z) + groundOffset - root.position.y) * Math.min(1, dt * 10);
      autoStep(false);
      if (act?.kind === 'bless') blessPose(dt);
    }
    // weight: over the foot that is standing while the other steps; idling, shifted slowly from one to the other
    const sw = swingOf();
    if (mode === 'walk' || mode === 'board') { hipSh += ((sw ? -sw.s * 0.03 * Math.sin(Math.PI * sw.u) : 0) - hipSh) * Math.min(1, dt * 8); if (sw && mode === 'walk') lift = -0.012 + 0.016 * Math.sin(Math.PI * sw.u); else if (mode === 'walk') lift = -0.012; }
    else if (mode === 'stand') hipSh += (Math.sin(t0 * 0.37) * 0.026 - hipSh) * Math.min(1, dt * 3);
    else hipSh *= 0.9;
    J.hips.position.x = hips0.x + hipSh;
    J.hips.rotation.set(base.hips.x, base.hips.y + (sw && mode === 'walk' ? sw.s * 0.06 * Math.sin(Math.PI * sw.u) : 0), base.hips.z - hipSh * 0.9, 'YXZ');
    // breathing, the shoulders rising with it; his head turned toward whoever is near, or wandering
    cur.chest[0] -= br * 1.2; cur.spine[2] += Math.sin(t0 * 0.23) * 1.0;
    for (const [k, s] of SIDES) cur['uArm' + k][2] += s * br * 0.8;
    let want = 0, wantX = 0;
    if (watch && mode !== 'board') {
      J.neck.updateWorldMatrix(true, false); const p = _a.setFromMatrixPosition(J.neck.matrixWorld), ry = yawOf(root);
      const a = angD(Math.atan2(watch.x - p.x, watch.z - p.z), ry), dd = Math.hypot(watch.x - p.x, watch.z - p.z);
      if (dd < 14) { want = Math.max(-1.1, Math.min(1.1, a)); wantX = Math.max(-12, Math.min(14, (p.y - (watch.y + 1.5)) / Math.max(1, dd) * 40)); }
    }
    if (!want && mode === 'stand' && !act) { gazeT -= dt; if (gazeT < 0) { gazeT = 2.5 + Math.random() * 4; gaze = (Math.random() - 0.5) * 1.0; gazeDown = Math.random() < 0.3 ? 16 : 0; } want = gaze; wantX = gazeDown; }
    if (mode === 'board') { want = 0; wantX = 12; }
    look += (want - look) * Math.min(1, dt * 2.2); lookX += (wantX - lookX) * Math.min(1, dt * 2);
    cur.head[1] += look * 0.62 / D2R; cur.neck[1] += look * 0.33 / D2R; cur.chest[1] += (mode === 'stand' ? look * 0.12 : 0) / D2R;
    cur.head[0] += lookX * 0.6; cur.neck[0] += lookX * 0.4;
    for (const j of PJ) setE(j, cur[j][0], cur[j][1], cur[j][2]);
    // the legs, from the feet
    legs(dt, lift);
    // and the hands to whatever he is holding on to as he climbs
    if (script?.cur) {
      root.updateMatrixWorld(true); const W = script.wagon, C = script.cur;
      reachArm('R', -1, W.localToWorld(_c.copy(C.P.grip3 || script.grip)).clone(), C.hR);
      reachArm('L', 1, W.localToWorld(_c.copy(script.grip2)).clone(), C.hL);
    }
    if (finished) seated();
    prev.sub(root.position).multiplyScalar(-1 / Math.max(dt, 1e-3)); vel.lerp(prev.setY(0), Math.min(1, dt * 6)); prev.copy(root.position);
    if (!camPos || root.getWorldPosition(_a).distanceTo(camPos) < 70) for (const c of cloths) c.update(dt);
  };
  return { rig, root, hipsY: J.hips.position.y, groundOffset, kind, cloths, update, bless, walkTo, board, seatNow, sit: () => {}, setGround: (f) => { ground = f; }, get busy() { return !!act || mode !== 'stand'; }, get mode() { return mode; }, feet, rest, dispose };
}


// ---------------------------------------------------------------- the frozen dead
// The Emperor's men who went up before you, dead where they stopped: whole MakeHuman bodies, grey-blue and rimed,
// dressed as Landsknechts and pikemen of the 1520s: a quilted gambeson or a doublet with slashed, puffed sleeves,
// puffed and slashed upper hose, a breastplate on some; a kettle hat or a cabasset, or bareheaded with the helmet
// fallen beside him. Posed as men really lie dead (curled on the side, face down with an arm caught under him,
// hunched sitting, slumped back against the rock), dirt and old blood in the cloth, and settled onto the ground
// under them (tilted to the slope, the lowest flesh resting on it) with what they dropped lying round them.
function frostMat(color, rough = 0.85, metal = 0, grime = 1) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrime = { value: grime };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFN; varying vec3 vFP;').replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvFN = normalize(mat3(modelMatrix) * objectNormal);').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFN; varying vec3 vFP; uniform float uGrime;
float fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y), mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float n1 = vn(vFP * 7.0) * 0.6 + vn(vFP * 23.0) * 0.4;
// dirt worked into the cloth, darker low down, and old blood dried near-black in blotches
diffuseColor.rgb *= mix(1.0, 0.55 + n1 * 0.35, uGrime);
float bl = smoothstep(0.66, 0.74, vn(vFP * 3.1 + 7.3)) * uGrime;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.025, 0.02), bl * 0.85);
float rime = smoothstep(0.25, 0.8, normalize(vFN).y + (fh(floor(vFP * 18.0)) - 0.5) * 0.35 + (n1 - 0.5) * 0.4);
diffuseColor.rgb = mix(diffuseColor.rgb * 0.85, vec3(0.86, 0.9, 0.95), rime * 0.8) + step(0.985, fh(floor(vFP * 140.0))) * rime * 0.5;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, rime);');
  };
  m.customProgramCacheKey = () => 'frost2' + metal + grime;
  return m;
}
// a garment round a bone, cut into panels with gaps (the slashes); the lining puffs out between them
function slashed(J, bone, profile, outer, inner, panels, shape = () => {}) {
  const g = new THREE.Group(), seg = Math.max(2, Math.round(28 / panels));
  for (let k = 0; k < panels; k++) {
    const ph = (k / panels) * Math.PI * 2, geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r * 1.04, y)), seg, ph, (Math.PI * 2 / panels) * 0.62);
    const p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); shape(v); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, outer));
  }
  // the lining: puffed fuller between the slashes
  g.add(new THREE.Mesh(lathe(profile.map(([r, y], i) => [r * (i && i < profile.length - 1 ? 0.99 : 0.9), y]), 24, (v, a) => { const r = Math.hypot(v.x, v.z) * (1 + Math.max(0, Math.sin(a * panels)) * 0.05); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r; shape(v); }), inner));
  J[bone].add(g); return g;
}
const HOSE = [0x3e3a32, 0x4a2a22, 0x2e3236, 0x564634, 0x3a3328];
const DOUBLET = [[0x6a2a20, 0xb8a888], [0x8a6a32, 0x5a1a14], [0x34404a, 0x9a8a70], [0x5a4a38, 0x6a2a20], [0x7a7462, 0x3a2a20]];
function kettleHat(iron) {   // the Eisenhut: a round skull with a broad brim sloping down all round
  const g = lathe([[0, 0.135], [0.06, 0.13], [0.105, 0.095], [0.122, 0.04], [0.125, 0.0], [0.135, -0.008], [0.2, -0.04], [0.215, -0.05], [0.212, -0.056]], 24, () => {});
  return new THREE.Mesh(g, iron);
}
function cabasset(iron) {   // tall almond-shaped skull with a little stalk on top and a narrow flat brim
  const g = lathe([[0, 0.24], [0.012, 0.235], [0.02, 0.22], [0.06, 0.19], [0.1, 0.12], [0.118, 0.05], [0.12, 0.0], [0.13, -0.005], [0.165, -0.012], [0.168, -0.02]], 22, (v) => { v.z *= 1.18; });
  return new THREE.Mesh(g, iron);
}
export function makeFrozen(pose = 'sit', seed = 0) {
  if (pose === 'kneel') pose = 'prone';   // no one dies kneeling neatly
  const kind = seed % 2 ? 'sutler' : 'priest', P = PEOPLE?.[kind];
  if (!P) return null;
  let rs = (seed * 9301 + 49297) % 233280; const rnd = () => { rs = (rs * 9301 + 49297) % 233280; return rs / 233280; };
  const pick = (a) => a[Math.floor(rnd() * a.length) % a.length], jit = (d) => (rnd() - 0.5) * 2 * d;
  const rig = new Rig(1), J = rig.j;
  const hose = pick(HOSE);
  const body = personMesh(rig, P, { skin: 0x9aa0a6, hair: [0x2a2420, 0x4a3420, 0x1c1814, 0x6a5038][seed % 4], cloth: hose, eyes: P.eyes, frozen: 1, dead: 1 });
  const iron = frostMat(0x4a4540, 0.6, 0.65, 0.6), parts = [];
  const gambeson = seed % 3 === 1, plate = seed % 3 === 0 || seed % 5 === 0;
  const [cO, cI] = pick(DOUBLET);
  if (gambeson) {   // quilted linen, stitched in vertical channels, stained
    const q = frostMat(pick([0x8a7f66, 0x6e6450, 0x7a6a50]), 0.95);
    J.chest.add(new THREE.Mesh(lathe([[0.09, 0.21], [0.19, 0.17], [0.225, 0.07], [0.215, -0.12], [0.2, -0.3], [0.215, -0.5]], 36, (v, a) => { const r = Math.hypot(v.x, v.z) * (1 + Math.abs(Math.sin(a * 12)) * 0.03); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.8 + 0.012; }), q));
    for (const k of ['R', 'L']) { J['uArm' + k].add(new THREE.Mesh(lathe([[0.08, 0.03], [0.088, -0.12], [0.078, -0.3]], 18, (v, a) => { const r = Math.hypot(v.x, v.z) * (1 + Math.abs(Math.sin(v.y * 40)) * 0.04); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r; }), q)); J['fArm' + k].add(new THREE.Mesh(lathe([[0.068, 0.02], [0.062, -0.2]], 14, () => {}), q)); }
  } else {          // a doublet; the sleeves puffed and slashed to show the lining
    const o = frostMat(cO, 0.9), i = frostMat(cI, 0.9);
    J.chest.add(new THREE.Mesh(lathe([[0.08, 0.2], [0.18, 0.165], [0.215, 0.07], [0.2, -0.12], [0.185, -0.3], [0.2, -0.42]], 28, (v, a) => { const r = Math.hypot(v.x, v.z); v.x = Math.sin(a) * r; v.z = Math.cos(a) * r * 0.8 + 0.012; }), o));
    for (const k of ['R', 'L']) { slashed(J, 'uArm' + k, [[0.07, 0.03], [0.1, -0.06], [0.105, -0.16], [0.085, -0.3]], o, i, 7); slashed(J, 'fArm' + k, [[0.07, 0.02], [0.075, -0.08], [0.062, -0.2]], o, i, 6); }
  }
  // the upper hose: puffed and slashed to above the knee (the Landsknecht's pluderhose)
  { const o = frostMat(hose, 0.92), i = frostMat(pick([0x8a2a20, 0xa89878, 0x5a5a62]), 0.9);
    for (const k of ['R', 'L']) slashed(J, 'thigh' + k, [[0.1, 0.06], [0.125, -0.08], [0.122, -0.26], [0.09, -0.4]], o, i, 6);
    // and the close nether-hose below, wrinkled at the ankle
    const lo = frostMat(hose, 0.92); for (const k of ['R', 'L']) J['shin' + k].add(new THREE.Mesh(lathe([[0.066, 0.04], [0.064, -0.06], [0.058, -0.2], [0.042, -0.36], [0.04, -0.42]], 14, () => {}), lo)); }
  // shoes: plain leather, broad at the toe
  { const lea = frostMat(0x2a1e16, 0.75, 0, 0.6);
    for (const k of ['R', 'L']) { const g = new THREE.SphereGeometry(0.06, 14, 10).scale(0.95, 0.75, 2.0).translate(0, -0.055, 0.075); J['foot' + k].add(new THREE.Mesh(g, lea)); } }
  // a belt
  J.hips.add(new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.016, 6, 24).rotateX(Math.PI / 2).scale(1, 1, 0.82).translate(0, 0.06, 0.012), frostMat(0x2a2018, 0.7)));
  // a breastplate over the doublet on some: a rounded peascod front, strapped at the back
  if (plate) {
    const bg = new THREE.LatheGeometry([[0.1, 0.16], [0.17, 0.13], [0.215, 0.04], [0.22, -0.1], [0.21, -0.24], [0.225, -0.3]].map(([r, y]) => new THREE.Vector2(r, y)), 26, -Math.PI * 0.55, Math.PI * 1.1);
    { const p = bg.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z), c = Math.cos(a); v.x = Math.sin(a) * r * 1.03; v.z = c * r * 0.84 + 0.03 + Math.max(0, c) * Math.max(0, -v.y - 0.08) * 0.12; p.setXYZ(i, v.x, v.y, v.z); } bg.computeVertexNormals(); }
    J.chest.add(new THREE.Mesh(bg, iron));
  }
  // head: kettle hat, cabasset, or bare
  const lying = pose === 'prone' || pose === 'lie';
  const hatKind = seed % 4 === 2 ? 0 : seed % 4 === 1 || seed % 4 === 3 ? 2 : 1;
  const hat = lying || !hatKind ? null : hatKind === 2 ? cabasset(iron) : kettleHat(iron);
  if (hat) { seatOnCrown(hat, body, rig, 0.075); hat.rotation.x += jit(0.12); hat.rotation.z += jit(0.1); J.head.add(hat); }
  const e = (j, x, y, z) => J[j].rotation.set((x + jit(4)) * D2R, (y + jit(4)) * D2R, (z + jit(4)) * D2R, 'YXZ');
  const lr = (fn) => { fn('R', -1); fn('L', 1); };
  if (pose === 'sit') {   // hunched on the ground, knees drawn up, arms round them, head down on them
    e('spine', 32, 0, jit(8)); e('chest', 22, 0, 0); e('neck', 28, 0, jit(10)); e('head', 22, jit(15), jit(10));
    lr((k, s) => { e('thigh' + k, -112, 0, s * 10); e('shin' + k, 130, 0, 0); e('foot' + k, -15, 0, s * 8); e('uArm' + k, -58, 0, s * 20); e('fArm' + k, -82, -s * 48, 0); e('hand' + k, 15, 0, s * 10); });
  } else if (pose === 'slump') {   // sat against the rock where he stopped, legs out unevenly, head fallen onto his shoulder
    const lean = jit(1) > 0 ? 1 : -1;
    e('spine', -4, 0, lean * 4); e('chest', 6, 0, lean * 3); e('neck', 22, 0, lean * 26); e('head', 18, lean * 10, lean * 22);
    lr((k, s) => { const bent = (s === lean); e('thigh' + k, bent ? -110 : -84, s * 10, s * 14); e('shin' + k, bent ? 70 : 10, 0, 0); e('foot' + k, -20, 0, s * 20); e('uArm' + k, 6, 0, s * 10); e('fArm' + k, -18, 0, 0); e('hand' + k, 10, 0, s * 20); });
  } else if (pose === 'prone') {   // face down where he fell forward, one arm under him, the other flung out past his head; his cheek on the ground
    rig.root.rotation.x = Math.PI / 2;
    const s0 = rnd() < 0.5 ? 1 : -1;
    e('spine', -4, 0, s0 * 5); e('chest', -4, 0, 0); e('neck', 12, s0 * 35, -s0 * 10); e('head', 6, s0 * 45, -s0 * 12);
    lr((k, s) => {
      if (s === s0) { e('uArm' + k, -125, 0, s * 40); e('fArm' + k, -20, 0, 0); e('hand' + k, 0, 0, s * 10); }   // flung up beside the head
      else { e('uArm' + k, 6, 0, s * 4); e('fArm' + k, -8, 0, 0); e('hand' + k, 0, 0, 0); }   // down his side, the hand under his hip
      e('thigh' + k, s === s0 ? -18 : 0, 0, s * (s === s0 ? 34 : 6)); e('shin' + k, s === s0 ? 40 : 4, 0, 0); e('foot' + k, 30, s * 30, 0);
    });
  } else {   // curled on his side as men lie when the cold takes them
    rig.root.rotation.z = Math.PI / 2 * 0.98;
    e('spine', 26, 0, 0); e('chest', 20, 0, 0); e('neck', 22, 0, -8); e('head', 26, 0, -10);
    lr((k, s) => { e('thigh' + k, s < 0 ? -78 : -64, 0, s * 4); e('shin' + k, s < 0 ? 96 : 80, 0, 0); e('foot' + k, 15, 0, 0); e('uArm' + k, s < 0 ? -55 : -80, 0, s * 8); e('fArm' + k, -95, -s * 35, 0); e('hand' + k, 20, 0, 0); });
  }
  const wrap = new THREE.Group(); wrap.add(rig.root);
  wrap.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // what he dropped: his helmet if it is not on him, a pike broken in two, his sword-belt's purse; and a dark pool on some
  const gear = [];
  const wood = frostMat(0x4a3826, 0.85, 0, 0.5);
  if (!hat && (hatKind || rnd() < 0.5)) gear.push({ obj: hatKind === 2 ? cabasset(iron) : kettleHat(iron), at: [jit(0.7) + 0.6, jit(0.5) - 0.2], lift: 0.04, tilt: [jit(0.5) + Math.PI * (rnd() < 0.4 ? 1 : 0), 0, jit(0.4) + 0.35] });
  if (rnd() < 0.7) {
    const L1 = 1.1 + rnd() * 0.8, L2 = 0.8 + rnd() * 0.6, sh = (L) => new THREE.CylinderGeometry(0.017, 0.019, L, 6).rotateZ(Math.PI / 2);
    const a = new THREE.Mesh(sh(L1), wood), tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.22, 4).rotateZ(-Math.PI / 2).translate(L1 / 2 + 0.1, 0, 0), iron); a.add(tip);
    gear.push({ obj: a, at: [jit(0.5) - 0.9, jit(1.0)], lift: 0.018, tilt: [0, jit(Math.PI), 0] });
    gear.push({ obj: new THREE.Mesh(sh(L2), wood), at: [jit(0.6) + 0.5, jit(1.2) + 0.6], lift: 0.018, tilt: [0, jit(Math.PI), 0] });
  }
  if (seed % 3 !== 1) {
    const pg = new THREE.CircleGeometry(0.5, 40), pp = pg.attributes.position, ph = [rnd() * 6, rnd() * 6, rnd() * 6]; for (let i = 1; i < pp.count; i++) { const a = Math.atan2(pp.getY(i), pp.getX(i)), f = 0.8 + 0.18 * Math.sin(a * 2 + ph[0]) + 0.1 * Math.sin(a * 3 + ph[1]) + 0.05 * Math.sin(a * 7 + ph[2]); pp.setXY(i, pp.getX(i) * f * 1.25, pp.getY(i) * f); }
    const pool = new THREE.Mesh(pg.rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x220405, roughness: 0.35, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false, transparent: true, opacity: 0.92 }));
    pool.receiveShadow = true; gear.push({ obj: pool, at: [jit(0.15), 0.1], lift: 0.012, tilt: [0, jit(Math.PI), 0], flat: true });
  }
  // lay him on the ground at x,z facing yaw. The body comes to rest as a dead weight would: dropped until it touches,
  // then turned about what it touches until the parts that bear his weight are all down; then each limb that
  // should lie on the ground is let down onto it (or lifted out of it) at its shoulder, hip or neck.
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _qy = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  const SI = body.geometry.attributes.skinIndex, SW = body.geometry.attributes.skinWeight, PC = body.geometry.attributes.position.count, byBone = {};
  for (let i = 0; i < PC; i++) if (SW.getX(i) > 0.6) (byBone[JOINTS[SI.getX(i)]] ||= []).push(i);
  const all = []; for (let i = 0; i < PC; i += 4) all.push(i);
  // the lowest point (relative to the ground) among some vertices
  const lowOf = (ground, ids, out) => { let best = 1e9; for (const i of ids) { body.getVertexPosition(i, _v); _v.applyMatrix4(body.matrixWorld); const d = _v.y - ground(_v.x, _v.z); if (d < best) { best = d; out?.copy(_v); } } return best; };
  const CONTACT = { sit: { rest: ['hips', 'footR', 'footL'], limb: [] }, slump: { rest: ['hips', 'footR', 'footL'], limb: ['handR', 'handL'] },
    prone: { rest: ['chest', 'hips', 'thighR', 'thighL'], limb: ['head', 'handR', 'handL', 'footR', 'footL', 'shinR', 'shinL', 'fArmR', 'fArmL'] },
    lie: { rest: ['chest', 'hips', 'thighR', 'thighL', 'shinR', 'shinL'], limb: ['head', 'handR', 'handL', 'fArmR', 'fArmL'] } }[pose];
  const LIMB = { handR: 'uArmR', handL: 'uArmL', fArmR: 'uArmR', fArmL: 'uArmL', footR: 'thighR', footL: 'thighL', shinR: 'thighR', shinL: 'thighL', head: 'neck' };
  const settle = (ground, x, z, yaw, sink = 0.012) => {
    wrap.position.set(x, 0, z); _qy.setFromAxisAngle(UP, yaw); wrap.quaternion.copy(_qy);
    const restIds = CONTACT.rest.flatMap((n) => byBone[n] || []).concat(['spine', 'chest', 'hips'].flatMap((n) => (byBone[n] || []).filter((_, k) => k % 2 === 0)));
    const drop = (ids = restIds) => { wrap.updateMatrixWorld(true); wrap.position.y -= lowOf(ground, ids) + sink; wrap.updateMatrixWorld(true); };
    drop();
    // rigid rest: turn about the lowest bearing point to bring the highest one down, a few times over
    const piv = new THREE.Vector3(), far = new THREE.Vector3(), q = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (let it = 0; it < 14; it++) {
      let lo = 1e9, hi = -1e9; for (const b of CONTACT.rest) { const d = lowOf(ground, byBone[b] || [], _w); if (d < lo) { lo = d; piv.copy(_w); } if (d > hi) { hi = d; far.copy(_w); } }
      if (hi - lo < 0.01) break;
      const arm = far.clone().sub(piv); arm.y = 0; const L = arm.length(); if (L < 0.05) break;
      ax.crossVectors(arm, UP).normalize(); const ang = -Math.min(0.25, Math.atan2(hi - lo, L) * 0.9);
      q.setFromAxisAngle(ax, ang);
      // never tip him past lying flat on the slope
      const nq = q.clone().multiply(wrap.quaternion); if (UP.clone().applyQuaternion(nq.clone().multiply(_qy.clone().invert())).y < Math.cos(0.85)) break;
      wrap.position.sub(piv).applyQuaternion(q).add(piv); wrap.quaternion.premultiply(q); drop();
    }
    // the limbs onto the ground: a little at a time about the joint's own axes, whichever way brings the part to rest
    const DESC = { uArmR: ['uArmR', 'fArmR', 'handR'], uArmL: ['uArmL', 'fArmL', 'handL'], thighR: ['thighR', 'shinR', 'footR'], thighL: ['thighL', 'shinL', 'footL'], neck: ['neck', 'head'], head: ['head'] };
    const touch = new Set(CONTACT.limb), todo = [...CONTACT.limb, ...['handR', 'handL', 'footR', 'footL', 'head'].filter((b) => !touch.has(b))];
    for (const b of todo) {
      for (const jn of b === 'head' ? ['neck', 'head'] : [LIMB[b]]) {
      const j = J[jn], ids = byBone[b], must = touch.has(b); if (!ids) continue;
      const chain = DESC[jn].flatMap((n) => (byBone[n] || []).filter((_, k) => k % 3 === 0)), r0 = j.rotation.clone();
      // how far from resting: the part's own distance from the ground, and anything of the limb pushed into it
      const cost = () => { wrap.updateMatrixWorld(true); const d = lowOf(ground, ids), c = lowOf(ground, chain); return (must ? Math.max(0, d - 0.005) : 0) + Math.max(0, -0.02 - d) + Math.max(0, -0.025 - c) * 3; };
      for (let it = 0; it < 16; it++) {
        const c0 = cost(); if (c0 < 0.012) break;
        let best = null, bc = c0 - 0.002;
        for (const [axis, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
          if (Math.abs(j.rotation[axis] + sgn * 0.05 - r0[axis]) > 0.6) continue;
          j.rotation[axis] += sgn * 0.05; const c = cost(); j.rotation[axis] -= sgn * 0.05;
          if (c < bc) { bc = c; best = [axis, sgn]; }
        }
        if (!best) break; j.rotation[best[0]] += best[1] * 0.05;
      }
      }
    }
    drop(all);
    // what he dropped, each on the ground where it fell
    const cy = Math.cos(yaw), sy = Math.sin(yaw), inv = wrap.quaternion.clone().invert();
    for (const G of gear) {
      if (G.obj.parent !== wrap) wrap.add(G.obj);
      const wx = x + G.at[0] * cy + G.at[1] * sy, wz = z - G.at[0] * sy + G.at[1] * cy, wy = ground(wx, wz);
      const gx = (ground(wx + 0.3, wz) - ground(wx - 0.3, wz)) / 0.6, gz = (ground(wx, wz + 0.3) - ground(wx, wz - 0.3)) / 0.6;
      const qN = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(-gx, 1, -gz).normalize());
      const qw = qN.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...G.tilt)));
      G.obj.quaternion.copy(inv).multiply(qw);
      G.obj.position.copy(wrap.worldToLocal(new THREE.Vector3(wx, wy + G.lift, wz)));
      G.obj.castShadow = !G.flat; G.obj.receiveShadow = true;
    }
    wrap.updateMatrixWorld(true);
    return wrap;
  };
  // for a check: how far the lowest of him is above (+) or below (-) the ground, overall and at each part that should bear on it
  const gaps = (ground) => {
    wrap.updateMatrixWorld(true); const per = {}; for (const b of [...CONTACT.rest, ...CONTACT.limb]) per[b] = lowOf(ground, byBone[b] || []);
    return { low: lowOf(ground, all), per };
  };
  // he settles on flat ground until placed
  settle(() => 0, 0, 0, 0);
  return { root: wrap, rig, head: J.head, settle, gaps, pose };
}
