// People who are not knights: the sutler on his wagon, the priest at the sanctuary. They wear the same
// MakeHuman body the knights do (under their clothes), a face (the knights' own head model), real hands, and
// robes of cloth; and a realistic hand for anyone who needs one, the Devil included.
import * as THREE from 'three';
import { Rig } from './rig.js';
import { dressBody } from './body.js';
import { knightHead } from './knight.js';
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
// kind: 'sutler' (sits, reins in hand, felt hat and russet cloak) or 'priest' (stands, black cassock, tonsure)
export function makePerson(kind, quality) {
  const rig = new Rig(1);
  const sutler = kind === 'sutler';
  dressBody(rig, sutler ? [84, 62, 40] : [30, 26, 26], quality);
  rig.j.head.add(knightHead({ cap: false, skin: sutler ? 0xb48a70 : 0xc49a82 }));
  const skin = new THREE.MeshStandardMaterial({ color: sutler ? 0xb48a70 : 0xc49a82, roughness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.9 });
  // hair, hat
  if (sutler) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.105, 0.09, 16), dark); hat.position.set(0, 0.2, 0.0); rig.j.head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20), dark); brim.position.set(0, 0.16, 0.01); brim.rotation.x = -0.12; rig.j.head.add(brim);
  } else {
    // the tonsure: a fringe of grey hair round a bare crown
    const hair = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 20), new THREE.MeshStandardMaterial({ color: 0x6a6460, roughness: 0.95 }));
    hair.rotation.x = Math.PI / 2; hair.position.set(0, 0.15, 0.0); rig.j.head.add(hair);
  }
  const mat = sutler ? clothMat([110, 70, 44], 'sutlercloak') : clothMat([20, 18, 18], 'cassock');
  robe(rig, mat, { length: sutler ? 0.95 : 1.42, flare: sutler ? 0.3 : 0.4, seated: sutler });
  // sleeves over the arms
  for (const k of ['R', 'L']) {
    const s1 = new THREE.Mesh(lathe([[0.065, 0.02], [0.07, -0.15], [0.068, -0.3]], 14, () => {}), mat); rig.j['uArm' + k].add(s1);
    const s2 = new THREE.Mesh(lathe([[0.066, 0.02], [0.08, -0.15], [0.095, -0.26]], 14, () => {}), mat); rig.j['fArm' + k].add(s2);
    rig.j['hand' + k].add(realHand(k === 'L' ? 1 : -1, { skin, curl: sutler ? 0.9 : 0.3 }));
  }
  if (!sutler) {   // a wooden cross on a cord
    const cr = new THREE.Group(); const wd = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.8 });
    cr.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.01), wd)); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.01), wd); arm.position.y = 0.02; cr.add(arm);
    cr.position.set(0, 0.0, 0.17); rig.j.chest.add(cr);
  }
  // the pose
  const e = (j, x, y, z) => rig.j[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  if (sutler) {   // sitting on the box, elbows on knees, reins in his hands, head a little bowed
    e('spine', 12, 0, 0); e('chest', 10, 0, 0); e('neck', 6, 0, 0); e('head', 8, -15, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('thigh' + k, -88, 0, s * 6); e('shin' + k, 82, 0, 0); e('foot' + k, 6, 0, 0); e('uArm' + k, -38, 0, s * 8); e('fArm' + k, -62, 0, 0); e('hand' + k, 10, 0, 0); }
  } else {        // standing at prayer, hands together before him
    e('head', 6, 0, 0);
    for (const [k, s] of [['R', -1], ['L', 1]]) { e('uArm' + k, -18, 0, s * 4); e('fArm' + k, -95, s * 30, 0); e('hand' + k, -10, -s * 20, s * 70); }
  }
  rig.root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return { rig, root: rig.root, hipsY: rig.j.hips.position.y, kind };
}
