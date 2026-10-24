// People who are not knights: the sutler on his wagon, the priest at the sanctuary. They wear the same
// MakeHuman body the knights do (under their clothes), a face (the knights' own head model), real hands, and
// robes of cloth; and a realistic hand for anyone who needs one, the Devil included.
import * as THREE from 'three';
import { Rig, JOINTS } from './rig.js';
import { dressBody } from './body.js';
import { clothTextures } from './textures.js';
import { lerp } from './util.js';

const D2R = Math.PI / 180;

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
  return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.95, side: THREE.DoubleSide });
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
      out[name] = { geo, bind: v.bind };
    }
    PEOPLE = out;
  } catch (e) { console.warn('people model', e); }
  return PEOPLE;
}
let EYE_TEX = null;
function personMat(look) {
  if (!EYE_TEX) { EYE_TEX = new THREE.TextureLoader().load('models/eye.png'); EYE_TEX.colorSpace = THREE.SRGBColorSpace; }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 });
  const U = { uSkin: { value: new THREE.Color(look.skin) }, uHair: { value: new THREE.Color(look.hair) }, uCloth: { value: new THREE.Color(look.cloth) }, uShoe: { value: new THREE.Color(0x2a1d14) }, uEye: { value: EYE_TEX } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nattribute float hairAmt;\nflat varying float vReg;\nvarying float vHair;\nvarying vec2 vUv0;\nvarying vec3 vObj;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvReg = region; vHair = hairAmt; vUv0 = uv; vObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vReg; varying float vHair; varying vec2 vUv0; varying vec3 vObj;
        uniform vec3 uSkin, uHair, uCloth, uShoe; uniform sampler2D uEye;
        float ph(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float pn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(ph(i), ph(i+vec3(1,0,0)), f.x), mix(ph(i+vec3(0,1,0)), ph(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(ph(i+vec3(0,0,1)), ph(i+vec3(1,0,1)), f.x), mix(ph(i+vec3(0,1,1)), ph(i+vec3(1,1,1)), f.x), f.y), f.z); }
        float isR(float k){ return step(abs(vReg - k), 0.4); }`)
      .replace('#include <map_fragment>', `
        float rS0 = isR(0.0), rShoe = isR(3.0), rE = isR(4.0), rC = isR(6.0);
        // skin: blotchy, ruddier on the cheeks, nose and knuckles, pores
        float blot = pn(vObj * 38.0) * 0.6 + pn(vObj * 110.0) * 0.4;
        vec3 skin = uSkin * (0.86 + 0.24 * blot);
        skin = mix(skin, skin * vec3(1.12, 0.86, 0.82), smoothstep(0.55, 0.85, pn(vObj * 14.0 + 3.0)) * 0.6);
        // hair: fine strands running down the head
        float strand = pn(vec3(vObj.x * 420.0, vObj.y * 30.0, vObj.z * 420.0));
        vec3 hair = uHair * (0.6 + 0.7 * strand);
        float rH = rS0 * smoothstep(0.15, 0.6, vHair * (0.75 + 0.5 * strand)); float rS = rS0 - rH;
        vec3 cloth = uCloth * (0.75 + 0.35 * pn(vObj * vec3(160.0, 40.0, 160.0)));
        vec3 shoe = uShoe * (0.8 + 0.4 * pn(vObj * 60.0));
        vec3 eye = texture2D(uEye, vUv0).rgb;
        diffuseColor.rgb = skin * rS + hair * rH + shoe * rShoe + eye * rE + cloth * rC;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.62 * rS + 0.75 * rH + 0.55 * rShoe + 0.08 * rE + 0.95 * rC - 0.08 * blot * rS;')
      // light through the skin: a warm wrap where it turns from the light
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += rS * uSkin * vec3(0.10, 0.03, 0.02);`);
  };
  mat.customProgramCacheKey = () => 'personSkin';
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

// kind: 'sutler' (sits on the box seat, felt hat and russet cloak) or 'priest' (stands, black cassock, tonsure)
export function makePerson(kind, quality) {
  const rig = new Rig(1);
  const sutler = kind === 'sutler';
  const P = PEOPLE?.[kind];
  if (P) personMesh(rig, P, sutler ? { skin: 0xb88a6c, hair: 0x3a2618, cloth: 0x6a5a44 } : { skin: 0xb8968a, hair: 0x8a8580, cloth: 0x1c1a18 });
  else dressBody(rig, sutler ? [84, 62, 40] : [30, 26, 26], quality);
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.9 });
  if (sutler) {   // a felt hat
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.108, 0.085, 18), dark); hat.position.set(0, 0.15, -0.04); rig.j.head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.165, 0.01, 22), dark); brim.position.set(0, 0.112, -0.035); brim.rotation.x = -0.12; rig.j.head.add(brim);
  }
  const mat = sutler ? clothMat([110, 70, 44], 'sutlercloak') : clothMat([20, 18, 18], 'cassock');
  robe(rig, mat, { length: sutler ? 0.95 : 1.42, flare: sutler ? 0.3 : 0.4, seated: sutler });
  for (const k of ['R', 'L']) {   // sleeves over the arms, open at the wrist
    const s1 = new THREE.Mesh(lathe([[0.07, 0.03], [0.075, -0.15], [0.072, -0.3]], 14, () => {}), mat); rig.j['uArm' + k].add(s1);
    const s2 = new THREE.Mesh(lathe([[0.07, 0.02], [0.08, -0.12], [0.092, -0.22]], 14, () => {}), mat); rig.j['fArm' + k].add(s2);
  }
  if (!sutler) {   // a wooden cross on a cord
    const cr = new THREE.Group(); const wd = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 });
    cr.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.01), wd)); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.01), wd); arm.position.y = 0.02; cr.add(arm);
    cr.position.set(0, 0.0, 0.17); rig.j.chest.add(cr);
  }
  const e = (j, x, y, z) => rig.j[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  if (sutler) {   // sitting on the box, forearms on his knees, head a little bowed
    e('spine', 12, 0, 0); e('chest', 8, 0, 0); e('neck', 6, 0, 0); e('head', 6, -15, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('thigh' + k, -88, 0, s * 6); e('shin' + k, 82, 0, 0); e('foot' + k, 6, 0, 0); e('uArm' + k, -38, 0, s * 8); e('fArm' + k, -62, 0, 0); e('hand' + k, 10, 0, 0); }
  } else {        // standing, hands folded before him
    e('head', 6, 0, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('uArm' + k, -14, 0, s * 4); e('fArm' + k, -85, -s * 32, 0); e('hand' + k, 0, -s * 15, 0); }
  }
  rig.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { rig, root: rig.root, hipsY: rig.j.hips.position.y, kind };
}
