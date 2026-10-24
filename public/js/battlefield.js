// The Emperor's army where it fell: helms, breastplates, kettle hats, shields
// with their paint flaking, swords and halberds dropped or driven into the
// turf, arrows standing in the ground, skulls and long bones, and rags of
// tabard. All instanced, laid on the slope of the ground.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU } from './util.js';

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
function skullGeo() {
  const cran = new THREE.SphereGeometry(0.085, 12, 9); xf(cran, [0, 0.07, 0], [0, 0, 0], [0.9, 1, 1.15]);
  const face = new THREE.BoxGeometry(0.1, 0.07, 0.06); xf(face, [0, 0.03, 0.08]);
  const jaw = new THREE.BoxGeometry(0.08, 0.025, 0.07); xf(jaw, [0, 0.0, 0.07], [0.3, 0, 0]);
  return xf(merge([cran, face, jaw]), [0, 0, 0], [0.4, 0, 1.2]);
}
function boneGeo() { // a long bone with knobbed ends
  return merge([xf(new THREE.CylinderGeometry(0.018, 0.016, 0.42, 6), [0, 0.03, 0], [0, 0, PI / 2]),
    xf(new THREE.SphereGeometry(0.032, 6, 5), [0.21, 0.03, 0]), xf(new THREE.SphereGeometry(0.03, 6, 5), [-0.21, 0.03, 0])]);
}
function ribsGeo() { // the cage of a man's ribs, half sunk
  const list = [xf(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 5), [0, 0.04, 0], [PI / 2, 0, 0])];
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) list.push(xf(new THREE.TorusGeometry(0.11 - i * 0.006, 0.009, 4, 10, PI * 0.8), [0, 0.04, -0.15 + i * 0.06], [0, s > 0 ? 0 : PI, 0.2 * s]));
  return xf(merge(list), [0, 0, 0], [-0.2, 0, 0]);
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
  const bone = new THREE.MeshStandardMaterial({ color: 0xd2c6a6, roughness: 0.7 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
  // the Emperor's colours, faded: yellow and black, with the red and white of the free companies
  const heraldry = [0x8a6a1a, 0x1a1816, 0x6a1a14, 0xa8a090, 0x2a3a5a].map((c) => new THREE.Color(c));
  const lists = { helm: [], kettle: [], breast: [], shield: [], sword: [], stuck: [], haft: [], arrows: [], skull: [], bone: [], ribs: [], rag: [] };
  const place = (x, z, lift = 0) => {
    const y = world.heightAt(x, z); const nrm = world.normalAt(x, z);
    return { x, y: y + lift, z, rx: Math.atan2(nrm.z, nrm.y), rz: -Math.atan2(nrm.x, nrm.y), ry: r() * TAU };
  };
  // the dead lie where they fell, in clusters: a man, his kit, the men beside him
  world.fallenSpots = [];
  world.scatter(n, (x, z) => world.okSpot(x, z, 2.5, 9), (x, z) => {
    world.fallenSpots.push({ x, z });
    const k = 1 + Math.floor(r() * 3);
    for (let m = 0; m < k; m++) {
      const cx = x + (r() - 0.5) * 3, cz = z + (r() - 0.5) * 3;
      const at = (dx, dz, lift) => place(cx + dx, cz + dz, lift);
      if (r() < 0.75) lists.skull.push(at(r() - 0.5, r() - 0.5, -0.01));
      for (let b = 0; b < 1 + Math.floor(r() * 3); b++) lists.bone.push(at((r() - 0.5) * 1.2, (r() - 0.5) * 1.2, -0.01));
      if (r() < 0.35) lists.ribs.push(at((r() - 0.5) * 0.6, (r() - 0.5) * 0.6, -0.03));
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
  inst(skullGeo(), bone, lists.skull); inst(boneGeo(), bone, lists.bone); inst(ribsGeo(), bone, lists.ribs); inst(ragGeo(), cloth, lists.rag, true);
  return out;
}

// where the fallen knights of the Emperor's household lie, in full harness
export function fallenKnightSpots(world, n, r) {
  const spots = [];
  world.scatter(n, (x, z) => world.okSpot(x, z, 4, 12) && world.normalAt(x, z).y > 0.93 && spots.every((s) => Math.hypot(s.x - x, s.z - z) > 18), (x, z) => spots.push({ x, z, yaw: r() * TAU }), 20);
  return spots;
}
