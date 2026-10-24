// The Emperor's army where it fell: helms, breastplates, kettle hats, shields
// with their paint flaking, swords and halberds dropped or driven into the
// turf, arrows standing in the ground, and rags of tabard; and the men themselves, as bones (see bones.js):
// whole skeletons lying where they fell, coming apart, and skulls, jaws and long bones scattered by scavengers.
// All instanced, laid on the slope of the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU } from './util.js';
import { boneLibrary, restDepth, boneMaterial } from './bones.js';

const PI = Math.PI;
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  return g;
}
const clean = (g) => { g = g.index ? g.toNonIndexed() : g; for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); return g; };
const merge = (list) => mergeGeometries(list.map(clean));

// ---------------------------------------------------------------- the gear
function helmGeo() {   // a sallet lying on its side: rounded skull, a tail flaring behind, the visor slot
  const shell = new THREE.SphereGeometry(0.13, 16, 10, 0, TAU, 0, PI * 0.58); xf(shell, [0, 0, 0], [0, 0, 0], [1, 1.05, 1.25]);
  const tail = new THREE.CylinderGeometry(0.15, 0.2, 0.08, 16, 1, true, PI * 0.6, PI * 0.8); xf(tail, [0, 0.0, -0.03], [0.35, 0, 0]);
  return xf(merge([shell, tail]), [0, 0.1, 0], [PI / 2 - 0.3, 0, 0.2]);
}
function kettleGeo() { // a kettle hat upturned: a bowl with a broad brim
  const pts = [[0.0, 0.15], [0.08, 0.145], [0.13, 0.1], [0.14, 0.03], [0.15, 0.0], [0.24, -0.02], [0.25, -0.03]].map(([x, y]) => new THREE.Vector2(x, y));
  return xf(new THREE.LatheGeometry(pts, 18), [0, 0.05, 0], [2.6, 0, 0.2]);
}
function breastGeo() { // a breastplate on its back: a curved shell with the waist flare
  const g = new THREE.CylinderGeometry(0.2, 0.17, 0.42, 16, 4, true, -PI * 0.55, PI * 1.1);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, p.getZ(i) * (1 + 0.25 * Math.max(0, y) * 4)); }
  g.computeVertexNormals();
  return xf(g, [0, 0.12, 0], [-PI / 2, 0, 0]);
}
function shieldGeo() { // a heater shield, slightly curved, lying flat
  const s = new THREE.Shape(); s.moveTo(-0.28, 0.32); s.lineTo(0.28, 0.32); s.quadraticCurveTo(0.28, -0.1, 0, -0.38); s.quadraticCurveTo(-0.28, -0.1, -0.28, 0.32);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false, curveSegments: 8 });
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) - x * x * 0.5); }
  g.computeVertexNormals();
  return xf(g, [0, 0.04, 0], [-PI / 2, 0, 0]);
}
function swordGeo() { // a dropped arming sword
  return merge([xf(new THREE.BoxGeometry(0.045, 0.012, 0.85), [0, 0.02, 0.42]), xf(new THREE.BoxGeometry(0.24, 0.025, 0.03), [0, 0.02, 0]),
    xf(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 6), [0, 0.02, -0.09], [PI / 2, 0, 0]), xf(new THREE.SphereGeometry(0.03, 8, 6), [0, 0.02, -0.18])]);
}
function stuckSwordGeo() { // a sword driven into the turf to the hilt's weight, leaning
  return xf(merge([xf(new THREE.BoxGeometry(0.045, 0.85, 0.012), [0, 0.1, 0]), xf(new THREE.BoxGeometry(0.24, 0.03, 0.025), [0, 0.52, 0]),
    xf(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 6), [0, 0.62, 0]), xf(new THREE.SphereGeometry(0.03, 8, 6), [0, 0.71, 0])]), [0, -0.12, 0]);
}
function polearmGeo() { // a halberd lying in the grass
  const head = new THREE.Shape(); head.moveTo(0, 0); head.lineTo(0.2, 0.06); head.lineTo(0.2, 0.2); head.lineTo(0, 0.16); head.lineTo(-0.06, 0.34); head.lineTo(-0.04, 0.12); head.lineTo(-0.12, 0.08);
  const hg = xf(new THREE.ExtrudeGeometry(head, { depth: 0.01, bevelEnabled: false }), [0, 0.03, 1.7], [-PI / 2, 0, 0]);
  return { haft: xf(new THREE.CylinderGeometry(0.018, 0.02, 2.1, 6), [0, 0.03, 0.75], [PI / 2, 0, 0]), head: hg };
}
function arrowGeo() { // three arrows standing in the ground
  const list = [];
  for (let i = 0; i < 3; i++) { const a = i * 2.1; list.push(xf(new THREE.CylinderGeometry(0.005, 0.005, 0.62, 4), [Math.cos(a) * 0.12, 0.22, Math.sin(a) * 0.12], [0.3 * Math.cos(a + 1), 0, 0.3 * Math.sin(a + 1)])); }
  return merge(list);
}
function ragGeo() { // a torn tabard on the ground, rucked
  const g = new THREE.PlaneGeometry(0.7, 0.9, 6, 7); g.rotateX(-PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, 0.02 + Math.abs(Math.sin(x * 9 + z * 4)) * 0.05); if (z > 0.38) p.setY(i, p.getY(i) - 0.02); }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- the field
export function buildFallen(world, n, r) {
  const rust = new THREE.MeshStandardMaterial({ color: 0x9a6c4c, metalness: 0.45, roughness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x8a847c, metalness: 0.75, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.9 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
  // the Emperor's colours, faded: yellow and black, with the red and white of the free companies
  const heraldry = [0x8a6a1a, 0x1a1816, 0x6a1a14, 0xa8a090, 0x2a3a5a].map((c) => new THREE.Color(c));
  const lists = { helm: [], kettle: [], breast: [], shield: [], sword: [], stuck: [], haft: [], arrows: [], rag: [] };
  const place = (x, z, lift = 0) => {
    const y = world.heightAt(x, z); const nrm = world.normalAt(x, z);
    return { x, y: y + lift, z, rx: Math.atan2(nrm.z, nrm.y), rz: -Math.atan2(nrm.x, nrm.y), ry: r() * TAU };
  };
  // ---- the bones
  const BL = boneLibrary('hi'); const boneLists = new Map();   // key -> [world matrices]
  const UP = new THREE.Vector3(0, 1, 0), M = new THREE.Matrix4(), S1 = new THREE.Vector3(1, 1, 1);
  const Q = (x, y, z, order = 'YXZ') => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, order));
  // lay a bone on the ground at (x, z), turned by q, resting on its lowest point (sunk a little into the turf),
  // tilted with the slope; or, given an explicit matrix, as it is
  const put = (key, x, z, q, sink = 0.012, extra = null) => {
    const geo = BL[key]; if (!boneLists.has(key)) boneLists.set(key, []);
    const tilt = new THREE.Quaternion().setFromUnitVectors(UP, world.normalAt(x, z));
    const y = world.heightAt(x, z) + restDepth(geo, q) - sink;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tilt.multiply(q), S1);
    if (extra) m.multiply(extra);
    boneLists.get(key).push(m); return m;
  };
  const jawOpen = (a) => { const pv = new THREE.Vector3(0, -0.02, -0.006); return new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z)); };
  const skullGeo = () => (r() < 0.5 ? 'skull0' : 'skull1');
  // a skull alone: on its base, on its side, or face down in the mud; its jaw usually somewhere else
  const skull = (x, z, withJaw = r() < 0.75) => {
    const k = r(), yaw = r() * TAU;
    const q = k < 0.45 ? Q(-0.15 - r() * 0.3, yaw, (r() - 0.5) * 0.4) : k < 0.85 ? Q((r() - 0.5) * 0.4, yaw, (r() < 0.5 ? 1 : -1) * (1.3 + r() * 0.3)) : Q(Math.PI - 0.35, yaw, (r() - 0.5) * 0.5);
    put(skullGeo(), x, z, q, 0.01 + r() * 0.02);
    if (withJaw) { const a = r() * TAU, d = 0.15 + r() * 0.35; put('mandible', x + Math.cos(a) * d, z + Math.sin(a) * d, r() < 0.7 ? Q(0, r() * TAU, 0) : Q(Math.PI, r() * TAU, 0), 0.008); }
  };
  const longBone = (x, z) => { const g = ['femur', 'humerus', 'tibia'][Math.floor(r() * 3)]; put(g, x, z, Q(Math.PI / 2, r() * TAU, (r() - 0.5) * 0.3, 'YZX'), 0.012); };
  // a whole man, lying where he fell (on his back, his side or his face), coming apart where the crows have been
  const skeleton = (x, z) => {
    const yaw = r() * TAU, roll = [0, 0, 1.25, -1.25, Math.PI][Math.floor(r() * 5)];
    const body = new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    const part = (geo, off, local = new THREE.Quaternion(), keep = 0.88, jit = 0.05) => {
      if (r() > keep) return;
      const o = new THREE.Vector3(...off).applyQuaternion(body);
      const q = body.clone().multiply(local).multiply(Q((r() - 0.5) * 0.25, (r() - 0.5) * 0.25, (r() - 0.5) * 0.25));
      return put(geo, x + o.x + (r() - 0.5) * jit, z + o.z + (r() - 0.5) * jit, q, 0.015 + r() * 0.02);
    };
    const sq = Q((r() - 0.5) * 0.6, (r() - 0.5) * 1.2, (r() - 0.5) * 0.8);
    const sk = part(skullGeo(), [0, 0.66, 0], sq, 1, 0.08);
    if (sk && r() < 0.5) { if (!boneLists.has('mandible')) boneLists.set('mandible', []); boneLists.get('mandible').push(sk.clone().multiply(jawOpen(0.15 + r() * 0.45))); }   // still hinged, gaping
    else part('mandible', [(r() - 0.5) * 0.3, 0.6 + r() * 0.15, 0], Q(0, r() * TAU, 0), 0.8, 0.2);
    part(r() < 0.5 ? 'cage0' : 'cage1', [0, 0.5, 0], new THREE.Quaternion(), 0.9, 0.04);
    for (let i = 0; i < 4; i++) part('vertebra', [0, 0.13 - i * 0.025, 0], new THREE.Quaternion(), 0.8, 0.03);
    part('pelvis', [0, 0.0, 0], new THREE.Quaternion(), 0.9, 0.04);
    for (const s of [-1, 1]) {
      const mirror = s < 0 ? Q(0, Math.PI, 0) : new THREE.Quaternion();
      part('femur', [s * 0.1, -0.45, 0.01], mirror.clone().multiply(Q(0, 0, s * 0.06)), 0.85);
      part('tibia', [s * 0.11, -0.86, 0], mirror, 0.8, 0.08);
      part('humerus', [s * 0.19, 0.16, 0], mirror.clone().multiply(Q(0, 0, -s * 0.08)), 0.8, 0.08);
      part('small', [s * 0.24, -0.02, 0.03], new THREE.Quaternion(), 0.6, 0.15);
    }
  };
  // what is left when the scavengers are done: skull, jaw, a few long bones, some ribs, a scatter of vertebrae
  const scattered = (x, z) => {
    skull(x + (r() - 0.5) * 0.6, z + (r() - 0.5) * 0.6);
    for (let b = 0; b < 1 + Math.floor(r() * 3); b++) longBone(x + (r() - 0.5) * 1.4, z + (r() - 0.5) * 1.4);
    if (r() < 0.25) put('pelvis', x + (r() - 0.5), z + (r() - 0.5), Q(r() < 0.5 ? -Math.PI / 2 : -0.3, r() * TAU, (r() - 0.5) * 0.5), 0.02);
    if (r() < 0.3) put(r() < 0.5 ? 'cage0' : 'cage1', x + (r() - 0.5), z + (r() - 0.5), Q(-Math.PI / 2, r() * TAU, (r() - 0.5) * 2.5), 0.03);
    else for (let i = 0; i < Math.floor(r() * 4); i++) put('rib', x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, Q((r() - 0.5) * 0.3, r() * TAU, r() < 0.5 ? 0 : Math.PI), 0.004);
    for (let i = 0; i < Math.floor(r() * 4); i++) put('vertebra', x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, Q((r() - 0.5) * 3, r() * TAU, (r() - 0.5) * 3), 0.006);
    if (r() < 0.3) put('small', x + (r() - 0.5), z + (r() - 0.5), Q(0, r() * TAU, 0), 0.004);
  };

  // the dead lie where they fell, in clusters: a man, his kit, the men beside him
  world.fallenSpots = [];
  world.scatter(n, (x, z) => world.okSpot(x, z, 2.5, 9), (x, z) => {
    world.fallenSpots.push({ x, z });
    const k = 1 + Math.floor(r() * 3);
    for (let m = 0; m < k; m++) {
      const cx = x + (r() - 0.5) * 3, cz = z + (r() - 0.5) * 3;
      const at = (dx, dz, lift) => place(cx + dx, cz + dz, lift);
      const fate = r();
      if (fate < 0.17) skeleton(cx, cz); else if (fate < 0.58) scattered(cx, cz); else if (fate < 0.83) { skull(cx, cz); if (r() < 0.5) longBone(cx + (r() - 0.5), cz + (r() - 0.5)); }
      if (r() < 0.45) lists.rag.push({ ...at((r() - 0.5) * 0.8, (r() - 0.5) * 0.8, 0), c: heraldry[Math.floor(r() * heraldry.length)] });
      const kit = r();
      if (kit < 0.35) lists.helm.push(at((r() - 0.5) * 1.4, (r() - 0.5) * 1.4, 0));
      else if (kit < 0.6) lists.kettle.push(at((r() - 0.5) * 1.4, (r() - 0.5) * 1.4, 0));
      if (r() < 0.3) lists.breast.push(at((r() - 0.5) * 1.2, (r() - 0.5) * 1.2, 0));
      if (r() < 0.4) lists.shield.push({ ...at((r() - 0.5) * 1.6, (r() - 0.5) * 1.6, 0), c: heraldry[Math.floor(r() * heraldry.length)] });
      const w = r();
      if (w < 0.3) lists.sword.push(at((r() - 0.5) * 2, (r() - 0.5) * 2, 0));
      else if (w < 0.45) { const p = at((r() - 0.5) * 2, (r() - 0.5) * 2, 0); p.rx = (r() - 0.5) * 0.5; p.rz = (r() - 0.5) * 0.5; lists.stuck.push(p); }
      else if (w < 0.65) lists.haft.push(at((r() - 0.5) * 2, (r() - 0.5) * 2, 0));
      if (r() < 0.3) { const p = at((r() - 0.5) * 2.5, (r() - 0.5) * 2.5, -0.05); p.rx = p.rz = 0; lists.arrows.push(p); }
    }
  }, 8);
  const pa = polearmGeo();
  const out = [];
  const inst = (geo, mat, list, colored) => {
    const m = world.instanced(geo, mat, list, { shadow: true }); if (!m) return;
    if (colored) list.forEach((it, i) => m.setColorAt(i, it.c.clone().multiplyScalar(0.55 + r() * 0.35)));
    if (colored && m.instanceColor) m.instanceColor.needsUpdate = true;
    out.push(m);
  };
  inst(helmGeo(), rust, lists.helm); inst(kettleGeo(), iron, lists.kettle); inst(breastGeo(), rust, lists.breast);
  inst(shieldGeo(), paint, lists.shield, true); inst(swordGeo(), iron, lists.sword); inst(stuckSwordGeo(), iron, lists.stuck);
  inst(pa.haft, wood, lists.haft); inst(pa.head, iron, lists.haft); inst(arrowGeo(), wood, lists.arrows);
  inst(ragGeo(), cloth, lists.rag, true);
  // the bones go into tiles of the field, each a level-of-detail switch: full detail close by, coarse further out,
  // nothing past where the fog has them anyway
  const bm = boneMaterial(), LO = boneLibrary('lo'), T = 36, tiles = new Map();
  const v = new THREE.Vector3();
  for (const [key, mats] of boneLists) for (const mm of mats) {
    v.setFromMatrixPosition(mm); const tk = Math.floor(v.x / T) + ',' + Math.floor(v.z / T);
    if (!tiles.has(tk)) tiles.set(tk, { cx: (Math.floor(v.x / T) + 0.5) * T, cz: (Math.floor(v.z / T) + 0.5) * T, items: new Map() });
    const t = tiles.get(tk); if (!t.items.has(key)) t.items.set(key, []); t.items.get(key).push(mm);
  }
  for (const t of tiles.values()) {
    const lod = new THREE.LOD(); lod.position.set(t.cx, world.heightAt(t.cx, t.cz), t.cz);
    const hi = new THREE.Group(), lo = new THREE.Group(), off = new THREE.Matrix4().makeTranslation(-t.cx, -lod.position.y, -t.cz);
    for (const [key, mats] of t.items) for (const [grp, lib, shadow] of [[hi, BL, true], [lo, LO, false]]) {
      const m = new THREE.InstancedMesh(lib[key], bm, mats.length); mats.forEach((mm, i) => m.setMatrixAt(i, off.clone().multiply(mm)));
      m.castShadow = shadow; m.receiveShadow = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere?.(); grp.add(m); out.push(m);
    }
    lod.addLevel(hi, 0); lod.addLevel(lo, 22); lod.addLevel(new THREE.Group(), 70);
    world.group.add(lod);
  }
  return out;
}

// where the fallen knights of the Emperor's household lie, in full harness
export function fallenKnightSpots(world, n, r) {
  const spots = [];
  world.scatter(n, (x, z) => world.okSpot(x, z, 4, 12) && world.normalAt(x, z).y > 0.93 && spots.every((s) => Math.hypot(s.x - x, s.z - z) > 18), (x, z) => spots.push({ x, z, yaw: r() * TAU }), 20);
  return spots;
}
