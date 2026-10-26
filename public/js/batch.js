// Fewer draw calls, the same picture: plain meshes that hang side by side under one parent and share a material
// (and shadow flags) are baked into a single mesh in that parent's frame. Only leaf meshes with nothing hanging
// from them are touched, and only where nothing else keeps hold of the separate pieces.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];

// merge the direct mesh children of `parent`; skip(o) -> true leaves a child alone. Returns how many meshes went.
export function mergeChildren(parent, skip = null) {
  const groups = new Map();
  for (const o of parent.children) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length || !o.visible || o.customDepthMaterial || o.morphTargetInfluences) continue;
    if (Array.isArray(o.material) || (skip && skip(o))) continue;
    const g = o.geometry; if (!g.index && !g.attributes.position) continue;
    const k = o.material.uuid + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder + '|' + o.frustumCulled + '|' + o.layers.mask;
    (groups.get(k) || groups.set(k, []).get(k)).push(o);
  }
  let gone = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // every part must carry the same attributes for the bake (position, normal and uv where all of them have it)
    const attrs = KEEP.filter((n) => list.every((o) => o.geometry.attributes[n]));
    if (!attrs.includes('position') || !attrs.includes('normal')) continue;
    const indexed = list.every((o) => o.geometry.index) || list.every((o) => !o.geometry.index);
    if (!indexed) continue;
    const geos = list.map((o) => {
      o.updateMatrix();
      const g = o.geometry.clone();
      for (const n in g.attributes) if (!attrs.includes(n)) g.deleteAttribute(n);
      for (const n in g.morphAttributes) delete g.morphAttributes[n];
      g.applyMatrix4(o.matrix);
      // a mirrored part (negative scale) would come out inside-out once baked: flip its winding back
      if (o.matrix.determinant() < 0 && g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
      g.clearGroups();
      return g;
    });
    let merged = null; try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const first = list[0], m = new THREE.Mesh(merged, first.material);
    m.castShadow = first.castShadow; m.receiveShadow = first.receiveShadow; m.renderOrder = first.renderOrder; m.frustumCulled = first.frustumCulled; m.layers.mask = first.layers.mask;
    m.userData.merged = true;
    parent.add(m);
    for (const o of list) { o.removeFromParent(); gone++; }
  }
  return gone;
}

// mergeChildren on `root` and every group beneath it (not into skinned rigs or anything skip() rules out)
export function mergeTree(root, skip = null) {
  let gone = 0;
  const visit = (o) => {
    if (skip && skip(o)) return;
    for (const c of [...o.children]) if (c.children.length && !c.isMesh) visit(c);
    gone += mergeChildren(o, skip);
  };
  visit(root);
  return gone;
}

// Bake the meshes of root's children marked userData.bake (whole houses, the church) together by material, in
// square cells of `cell` metres so what is off screen can still be left undrawn. Lights and anything that is not a
// plain mesh stay where they are.
export function bakeClusters(root, cell = 40) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), _m = new THREE.Matrix4(), _c = new THREE.Vector3();
  const buckets = new Map(), donors = [];
  for (const grp of root.children) {
    if (!grp.userData.bake) continue; donors.push(grp);
    grp.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length || !o.visible || o.customDepthMaterial || Array.isArray(o.material)) return;
      if (!o.geometry.attributes.normal) return;
      o.geometry.computeBoundingSphere(); _c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const k = o.material.uuid + '|' + o.castShadow + '|' + o.receiveShadow + '|' + o.renderOrder + '|' + Math.floor(_c.x / cell) + ',' + Math.floor(_c.z / cell) + '|' + !!o.geometry.index;
      (buckets.get(k) || buckets.set(k, []).get(k)).push(o);
    });
  }
  let made = 0, gone = 0;
  for (const list of buckets.values()) {
    const attrs = KEEP.filter((n) => list.every((o) => o.geometry.attributes[n]));
    const geos = list.map((o) => {
      const g = o.geometry.clone(); for (const n in g.attributes) if (!attrs.includes(n)) g.deleteAttribute(n);
      _m.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(_m);
      if (_m.determinant() < 0 && g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
      g.clearGroups(); return g;
    });
    let merged = null; try { merged = mergeGeometries(geos, false); } catch { merged = null; }
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const f = list[0], m = new THREE.Mesh(merged, f.material);
    m.castShadow = f.castShadow; m.receiveShadow = f.receiveShadow; m.renderOrder = f.renderOrder; m.userData.merged = true;
    root.add(m); made++;
    for (const o of list) { o.removeFromParent(); o.geometry.dispose(); gone++; }
  }
  // groups left empty go; any with lights or other things left in them stay
  for (const grp of donors) { let left = 0; grp.traverse((o) => { if (o !== grp && !o.isGroup) left++; }); if (!left) grp.removeFromParent(); }
  return { made, gone };
}
