// The knight's body: MakeHuman's CC0 base mesh refitted to the rig (see
// tools/build_body.py). In game it is the arming layer, a quilted doublet with mail
// gussets and woollen hose, skinned to the rig so there is never a gap
// between plates. Its cross-sections also shape every armour plate.
import * as THREE from 'three';
import { JOINTS } from './rig.js';
import { clothTextures, mailTextures } from './textures.js';

let BODY = null;
const dec = (b64, Type) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Type(u.buffer); };

export async function loadBody(url = 'models/body.json') {
  if (BODY) return BODY;
  const j = await (await fetch(url)).json();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dec(j.position, Float32Array), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(dec(j.normal, Int8Array), 3, true));
  geo.setAttribute('uv', new THREE.BufferAttribute(dec(j.uv, Float32Array), 2));
  // the asset's joint order is the rig's order; remap defensively in case either changes
  const map = j.joints.map((n) => JOINTS.indexOf(n));
  const si = dec(j.skinIndex, Uint8Array).map((v) => Math.max(0, map[v]));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(dec(j.skinWeight, Uint8Array), 4, true));
  geo.setAttribute('region', new THREE.BufferAttribute(Float32Array.from(dec(j.region, Uint8Array)), 1));
  geo.setIndex(new THREE.BufferAttribute(j.count < 65536 ? dec(j.index, Uint16Array) : dec(j.index, Uint32Array), 1));
  geo.computeBoundingSphere();
  const fields = {};
  for (const k in j.fields) fields[k] = makeField(j.fields[k]);
  BODY = { geo, bind: j.bind, fields };
  return BODY;
}
export function bodyReady() { return !!BODY; }

// Cross-section sampler for one body segment, in that joint's local frame.
// at(th, y) -> [x, z]: the body's convex outline at angle th (0 = front, +x = left)
// and height y, pushed out by `off` metres. r(th, y) is the radius from the
// section's centre; centre(y) gives that centre.
function makeField(f) {
  const { y0, dy, ny, nth } = f; const R = f.r, C = f.c;
  const rAt = (th, y) => {
    let fy = (y - y0) / dy; fy = Math.max(0, Math.min(ny - 1.001, fy)); const iy = Math.floor(fy), ty = fy - iy;
    let ft = (th / (Math.PI * 2)) * nth; ft = ((ft % nth) + nth) % nth; const it = Math.floor(ft), tt = ft - it, it2 = (it + 1) % nth;
    const a = R[iy * nth + it] * (1 - tt) + R[iy * nth + it2] * tt;
    const b = R[(iy + 1) * nth + it] * (1 - tt) + R[(iy + 1) * nth + it2] * tt;
    return a * (1 - ty) + b * ty;
  };
  const cAt = (y) => {
    let fy = (y - y0) / dy; fy = Math.max(0, Math.min(ny - 1.001, fy)); const iy = Math.floor(fy), ty = fy - iy;
    return [C[iy * 2] * (1 - ty) + C[iy * 2 + 2] * ty, C[iy * 2 + 1] * (1 - ty) + C[iy * 2 + 3] * ty];
  };
  return {
    y0, y1: y0 + dy * (ny - 1),
    r: rAt, centre: cAt,
    at(th, y, off = 0) { const c = cAt(y); const r = rAt(th, y) + off; return [c[0] + Math.sin(th) * r, c[1] + Math.cos(th) * r]; },
  };
}
export function field(name) { return BODY?.fields[name] || null; }

// ---------------------------------------------------------------- the skinned arming layer
const _cache = new Map();
function bodyMaterial(cloth, quality) {
  const key = cloth.join(',') + quality.tex;
  if (_cache.has(key)) return _cache.get(key);
  const ct = clothTextures([200, 190, 170], true, 512, 'doublet');
  const ht = clothTextures([200, 200, 200], false, 256, 'hose');
  const hoseMap = ht.map.clone(); hoseMap.wrapS = hoseMap.wrapT = THREE.RepeatWrapping; hoseMap.needsUpdate = true;
  const mt = mailTextures(512);
  const mat = new THREE.MeshStandardMaterial({ map: ct.map, normalMap: ct.normalMap, roughness: 0.9, metalness: 0 });
  mat.map = mat.map.clone(); mat.map.repeat.set(10, 10); mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; mat.map.needsUpdate = true;
  mat.normalMap = mat.normalMap.clone(); mat.normalMap.repeat.set(10, 10); mat.normalMap.wrapS = mat.normalMap.wrapT = THREE.RepeatWrapping; mat.normalMap.needsUpdate = true;
  const mailN = mt.normalMap.clone(); mailN.wrapS = mailN.wrapT = THREE.RepeatWrapping; mailN.needsUpdate = true;
  const doublet = new THREE.Color(0x3a3128);          // waxed fustian arming doublet
  const hose = new THREE.Color(cloth[0] / 255, cloth[1] / 255, cloth[2] / 255).multiplyScalar(0.42);
  const mail = new THREE.Color(0x8a8a88);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDoublet = { value: doublet }; sh.uniforms.uHose = { value: hose }; sh.uniforms.uMail = { value: mail };
    sh.uniforms.uMailN = { value: mailN }; sh.uniforms.uHoseMap = { value: hoseMap };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region;\nvarying float vRegion;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRegion = region;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRegion;\nuniform vec3 uDoublet, uHose, uMail;\nuniform sampler2D uMailN, uHoseMap;')
      .replace('#include <map_fragment>', `
        float isHose = step(0.5, vRegion) * (1.0 - step(1.5, vRegion));
        float isMail = step(1.5, vRegion);
        vec4 texel = isHose > 0.5 ? texture2D(uHoseMap, vMapUv * 2.5) : texture2D(map, vMapUv);
        vec3 base = mix(uDoublet, uHose, isHose);
        diffuseColor.rgb = mix(base * (0.55 + 0.9 * texel.rgb), uMail, isMail);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.92, 0.45, isMail);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(0.0, 1.0, isMail);')
      .replace('#include <normal_fragment_maps>', `
        vec3 mapN = isMail > 0.5 ? texture2D(uMailN, vNormalMapUv * 4.0).xyz * 2.0 - 1.0 : (isHose > 0.5 ? vec3(0.0, 0.0, 1.0) : texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0);
        mapN.xy *= normalScale * mix(1.0, 1.6, isMail);
        normal = normalize(tbn * mapN);`);
  };
  mat.customProgramCacheKey = () => 'knightBody';
  _cache.set(key, mat);
  return mat;
}

// Build the skinned layer on a rig. The rig is put in the bind pose (MakeHuman's
// A-pose, refitted), bound, then returned to whatever pose it had.
export function dressBody(rig, cloth, quality) {
  if (!BODY) return null;
  const saved = JOINTS.map((n) => rig.j[n].quaternion.clone());
  const savedHip = rig.j.hips.position.clone();
  for (const n of JOINTS) { const q = BODY.bind[n]; rig.j[n].quaternion.set(q[0], q[1], q[2], q[3]); }
  rig.j.hips.position.copy(rig.basePos);
  // bind in the rig's own space so the mesh follows the knight wherever he goes
  const root = rig.root;
  const savedM = root.matrix.clone(), savedP = root.position.clone(), savedQ = root.quaternion.clone(), savedS = root.scale.clone();
  root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.setScalar(1);
  root.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(BODY.geo, bodyMaterial(cloth, quality));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  root.add(mesh);
  mesh.updateMatrixWorld(true);
  const bones = JOINTS.map((n) => rig.j[n]);
  const skel = new THREE.Skeleton(bones);
  mesh.bind(skel, mesh.matrixWorld);
  root.position.copy(savedP); root.quaternion.copy(savedQ); root.scale.copy(savedS); root.matrix.copy(savedM);
  JOINTS.forEach((n, i) => rig.j[n].quaternion.copy(saved[i]));
  rig.j.hips.position.copy(savedHip);
  root.updateMatrixWorld(true);
  return mesh;
}
