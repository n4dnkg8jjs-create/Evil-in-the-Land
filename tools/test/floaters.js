g.loadChapter(1, { skipIntro: true }); __sim(1); return 'ok';
----
// Floating / buried check over everything placed in Saint Aldric's.
const w = g.world, THREE = await import('three');
w.group.updateMatrixWorld(true);
const vl = w.lots.filter((l) => l.village); let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
for (const l of vl) { const r = Math.hypot(l.w || 8, l.d || 8) / 2 + 18; x0 = Math.min(x0, l.x - r); x1 = Math.max(x1, l.x + r); z0 = Math.min(z0, l.z - r); z1 = Math.max(z1, l.z + r); }
const inR = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
const skipMesh = (m) => !m.visible || m === w.terrain || m === w.water || m.isPoints || m.isLine || m.isSprite || !m.geometry?.attributes?.position
  || (m.material && (m.material.blending === THREE.AdditiveBlending || m.material.depthWrite === false || m.material.isShaderMaterial || m.material.transparent && m.material.opacity < 0.9));
const tris = []; const piecesOf = []; const P = new THREE.Vector3(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
let pid = 0; const pieces = [];
const visVis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const meshes = []; w.group.traverse((m) => { if ((m.isMesh || m.isInstancedMesh) && !skipMesh(m) && visVis(m)) meshes.push(m); });
const grassMeshes = new Set([w.aliveMesh].filter(Boolean)); for (const m of meshes) if (m.material?.alphaTest > 0 && m.isInstancedMesh && m.geometry.attributes.position.count <= 8) grassMeshes.add(m);
function addPiece(m, label, vertsW, idx, triIdxLocal) {
  const id = pid++; const p = { id, m, label, v: vertsW, n: 0 }; pieces.push(p);
  p.t0 = tris.length; for (let t = 0; t < triIdxLocal.length; t += 3) tris.push([vertsW[triIdxLocal[t]], vertsW[triIdxLocal[t + 1]], vertsW[triIdxLocal[t + 2]], id]); p.t1 = tris.length;
  return p;
}
const matNames = new Map(); for (const bag of [w.mats, w._bm, w.burnMats, w.yardMats]) if (bag) for (const k in bag) if (bag[k]?.isMaterial) matNames.set(bag[k], k);
for (const k in w) { const v = w[k]; if (v?.isMaterial && !matNames.has(v)) matNames.set(v, k); }
const label = (m) => (m.name || '') + '|' + (matNames.get(m.material) || (m.material?.map ? 'tex' : '') + (m.material?.color?.getHexString?.() || '')) + '|' + (m.parent && m.parent !== w.group ? 'grp' : 'top') + (m.isInstancedMesh ? 'I' : '') + '|' + m.geometry.attributes.position.count;
for (const m of meshes) {
  const pos = m.geometry.attributes.position, ix = m.geometry.index ? m.geometry.index.array : [...Array(pos.count).keys()];
  const n = m.isInstancedMesh ? m.count : 1;
  if (grassMeshes.has(m)) continue;
  // components of the geometry (welded by position)
  if (!m._comp) {
    const key = new Map(), par = new Int32Array(pos.count).map((_, i) => i); const f = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < pos.count; i++) { const k = Math.round(pos.getX(i) * 500) + ',' + Math.round(pos.getY(i) * 500) + ',' + Math.round(pos.getZ(i) * 500); const j = key.get(k); if (j !== undefined) par[f(i)] = f(j); else key.set(k, i); }
    for (let t = 0; t < ix.length; t += 3) { const a = f(ix[t]); par[f(ix[t + 1])] = a; par[f(ix[t + 2])] = a; }
    const comps = new Map(); for (let t = 0; t < ix.length; t += 3) { const r = f(ix[t]); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(t); }
    m._comp = [...comps.values()];
  }
  for (let k = 0; k < n; k++) {
    if (m.isInstancedMesh) { m.getMatrixAt(k, IM); M.multiplyMatrices(m.matrixWorld, IM); if (Math.abs(IM.determinant()) < 1e-9) continue; } else M.copy(m.matrixWorld);
    const e = M.elements; const cx = e[12], cz = e[14];
    if (m.isInstancedMesh && !inR(cx, cz)) continue;
    for (const comp of (m.isInstancedMesh ? [m._comp.flat()] : m._comp)) {
      const local = new Map(), verts = [], tl = [];
      for (const t of comp) for (let q = 0; q < 3; q++) { const vi = ix[t + q]; let li = local.get(vi); if (li === undefined) { P.fromBufferAttribute(pos, vi).applyMatrix4(M); li = verts.length; verts.push(P.clone()); local.set(vi, li); } tl.push(li); }
      let mx = 0, mz = 0; for (const v of verts) { mx += v.x; mz += v.z; } mx /= verts.length; mz /= verts.length;
      if (!inR(mx, mz)) continue;
      addPiece(m, label(m) + (m.isInstancedMesh ? '#' + k : ''), verts, null, tl);
    }
  }
}
// hash triangles by 1 m XZ cells
const H = new Map(), C = 1.0; const ck = (i, j) => i * 100003 + j;
tris.forEach((T, ti) => { const ax = Math.min(T[0].x, T[1].x, T[2].x), bx = Math.max(T[0].x, T[1].x, T[2].x), az = Math.min(T[0].z, T[1].z, T[2].z), bz = Math.max(T[0].z, T[1].z, T[2].z);
  if ((bx - ax) * (bz - az) > 400) return; for (let i = Math.floor(ax / C); i <= Math.floor(bx / C); i++) for (let j = Math.floor(az / C); j <= Math.floor(bz / C); j++) { const k = ck(i, j); let L = H.get(k); if (!L) H.set(k, L = []); L.push(ti); } });
window.__fl = { pieces, tris, H, C, ck, grassMeshes: [...grassMeshes], inR };
return { meshes: meshes.length, pieces: pieces.length, tris: tris.length, region: [x0, x1, z0, z1].map(Math.round) };
----
const { pieces, tris, H, C, ck, grassMeshes, inR } = window.__fl, w = g.world, THREE = await import('three');
const tri = new THREE.Triangle(), q = new THREE.Vector3();
const touches = (p, v, eps = 0.035) => { const L = H.get(ck(Math.floor(v.x / C), Math.floor(v.z / C))); if (!L) return false;
  for (const ti of L) { const T = tris[ti]; if (T[3] === p.id) continue; tri.set(T[0], T[1], T[2]); tri.closestPointToPoint(v, q); if (q.distanceToSquared(v) < eps * eps) return true; } return false; };
const ray = new THREE.Ray(), hitP = new THREE.Vector3(), dir = new THREE.Vector3();
const pierces = (p) => { const n = p.t1 - p.t0, step = Math.max(1, Math.floor(n / 300));
  for (let t = p.t0; t < p.t1; t += step) { const T = tris[t]; for (let e = 0; e < 3; e++) { const a = T[e], b = T[(e + 1) % 3]; const len = a.distanceTo(b); if (len < 1e-4) continue;
    dir.subVectors(b, a).divideScalar(len); ray.set(a, dir); const seen = new Set();
    const nS = Math.max(1, Math.ceil(len / 0.5)); for (let si = 0; si <= nS; si++) { const vx = a.x + (b.x - a.x) * si / nS, vz = a.z + (b.z - a.z) * si / nS; const L = H.get(ck(Math.floor(vx / C), Math.floor(vz / C))); if (!L) continue;
      for (const ti of L) { if (seen.has(ti)) continue; seen.add(ti); const U = tris[ti]; if (U[3] === p.id) continue; if (ray.intersectTriangle(U[0], U[1], U[2], false, hitP) && hitP.distanceTo(a) <= len) return true; } } } }
  return false; };
const float = [], buried = [];
// neighbours of a piece: pieces it touches or passes through
const nbrs = (p) => { const out = new Set();
  const sorted = [...p.v].sort((a, b) => a.y - b.y); const test = sorted.slice(0, 24).concat(sorted.filter((_, i) => i % Math.max(1, Math.floor(sorted.length / 40)) === 0));
  { const n = p.t1 - p.t0, st = Math.max(1, Math.floor(n / 200)); for (let t = p.t0; t < p.t1; t += st) { const T = tris[t]; test.push(new THREE.Vector3().add(T[0]).add(T[1]).add(T[2]).divideScalar(3)); } }   // face centres too
  for (const v of test) { const L = H.get(ck(Math.floor(v.x / C), Math.floor(v.z / C))); if (!L) continue; for (const ti of L) { const T = tris[ti]; if (T[3] === p.id || out.has(T[3])) continue; tri.set(T[0], T[1], T[2]); tri.closestPointToPoint(v, q); if (q.distanceToSquared(v) < 0.035 * 0.035) out.add(T[3]); } }
  const n = p.t1 - p.t0, step = Math.max(1, Math.floor(n / 300));
  for (let t = p.t0; t < p.t1; t += step) { const T = tris[t]; for (let e = 0; e < 3; e++) { const a = T[e], b = T[(e + 1) % 3]; const len = a.distanceTo(b); if (len < 1e-4) continue;
    dir.subVectors(b, a).divideScalar(len); ray.set(a, dir);
    const nS = Math.max(1, Math.ceil(len / 0.5)); for (let si = 0; si <= nS; si++) { const vx = a.x + (b.x - a.x) * si / nS, vz = a.z + (b.z - a.z) * si / nS; const L = H.get(ck(Math.floor(vx / C), Math.floor(vz / C))); if (!L) continue;
      for (const ti of L) { const U = tris[ti]; if (U[3] === p.id || out.has(U[3])) continue; if (ray.intersectTriangle(U[0], U[1], U[2], false, hitP) && hitP.distanceTo(a) <= len) out.add(U[3]); } } } }
  return out; };
const grounded = new Uint8Array(pieces.length), info = [];
for (const p of pieces) {
  let lo = p.v[0], hi = -1e9, gap = 1e9; for (const v of p.v) { if (v.y > hi) hi = v.y; const c = v.y - w.heightAt(v.x, v.z); if (c < gap) { gap = c; lo = v; } }
  let ly = 1e9; for (const v of p.v) ly = Math.min(ly, v.y); const ht = hi - ly; info[p.id] = { lo, gap, ht };
  if (gap <= 0.05) grounded[p.id] = 1;
  if (-gap > 0.3 && ht < 1.5 && -gap > ht * 0.5) {
    let cx = 0, cz = 0; for (const v of p.v) { cx += v.x; cz += v.z; } cx /= p.v.length; cz /= p.v.length;
    if (hi < w.heightAt(cx, cz) + 0.02 || -gap > ht * 0.8) buried.push([+(-gap).toFixed(2), +ht.toFixed(2), p.label, +lo.x.toFixed(1), +lo.z.toFixed(1)]);
  }
}
// spread support outward from the grounded pieces through everything that touches
const adj = new Map(); for (const p of pieces) if (!grounded[p.id]) adj.set(p.id, nbrs(p));
// make it two-way: a grounded piece that passes into a floating one (an axle in a hub) supports it too
const bbs = new Map(); for (const p of pieces) { const b = new THREE.Box3().setFromPoints(p.v); b.expandByScalar(0.05); bbs.set(p.id, b); }
const ung = pieces.filter((p) => !grounded[p.id]);
for (const p of pieces) { if (!grounded[p.id]) continue; const b = bbs.get(p.id); const near = ung.filter((u) => bbs.get(u.id).intersectsBox(b)); if (!near.length) continue;
  const ns = nbrs(p); for (const u of near) if (ns.has(u.id)) adj.get(u.id).add(p.id); }
let changed = true; while (changed) { changed = false; for (const [id, ns] of adj) { if (grounded[id]) continue; for (const n of ns) if (grounded[n]) { grounded[id] = 1; changed = true; break; } } }
for (const p of pieces) if (!grounded[p.id]) { const { lo, gap, ht } = info[p.id]; const bb = new THREE.Box3().setFromPoints(p.v); const sz = bb.getSize(new THREE.Vector3()); const L = w.lots.find((l) => Math.hypot(l.x - lo.x, l.z - lo.z) < 12);
  float.push([+gap.toFixed(2), +ht.toFixed(2), p.label, +lo.x.toFixed(1), +lo.z.toFixed(1), sz.toArray().map((v) => +v.toFixed(2)), p.v.length, L ? L.kind + (L.village ? 'V' : '') : (Math.hypot(w.churchLot.x - lo.x, w.churchLot.z - lo.z) < 20 ? 'church' : '-')]); }
// grass: base vs ground
let gf = 0, gb = 0; const M = new THREE.Matrix4(), V = new THREE.Vector3();
for (const m of grassMeshes) for (let k = 0; k < m.count; k++) { m.getMatrixAt(k, M); const e = M.elements; const sy = Math.hypot(e[4], e[5], e[6]); if (sy < 0.01) continue; V.set(e[12], e[13], e[14]); if (!inR(V.x, V.z)) continue; const d = V.y - w.heightAt(V.x, V.z); if (d > 0.05) gf++; if (d < -0.3) gb++; }
window.__float = float; window.__dbg = { grounded, info, adj, nbrs };
const byLabel = {}; for (const f of float) { const k = f[2].replace(/#\d+$/, ''); byLabel[k] = (byLabel[k] || 0) + 1; }
const bl = {}; for (const f of buried) { const k = f[2].replace(/#\d+$/, ''); bl[k] = (bl[k] || 0) + 1; }
const byMat = {}; for (const f of float) { const k = f[2].split('|').slice(1, 3).join('|'); const B = byMat[k] || (byMat[k] = { n: 0, gaps: [] }); B.n++; if (B.gaps.length < 8) B.gaps.push([f[0], f[3], f[4], f[5], f[6], f[7]]); }
return { byMat, floating: float.length, buried: buried.length, grassFloat: gf, grassBuried: gb, buriedBy: bl, bsample: buried.slice(0, 10) };
