// Our Lady of the Fen: a weathered limestone Madonna in a drowned wayside shrine.
// She is carved from MakeHuman's young woman (CC0, models/lady.json): head and face with every feature kept,
// only softened by the rain, and real hands joined palm to palm in prayer before her breast. Over the body: a
// high-girdled gown with a narrow waist and long folds pooling on the plinth, a wide bell sleeve to each arm, a
// mantle hanging from the shoulders, a veil framing her face. She stands on a moulded plinth carved AVE MARIA
// (and scratched by Raoul) under a gabled canopy, on two cracked steps with votive candles, dead flowers, a
// rosary and coins left for her.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { humanBody, headBox } from './people.js';
import { JOINTS } from './rig.js';
import { normalFromHeight } from './textures.js';
import { rng } from './util.js';

const PI = Math.PI, D2R = PI / 180, V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- materials
const NOISE = `
float sh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh(i), sh(i + vec3(1,0,0)), f.x), mix(sh(i + vec3(0,1,0)), sh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh(i + vec3(0,0,1)), sh(i + vec3(1,0,1)), f.x), mix(sh(i + vec3(0,1,1)), sh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float sfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * sn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
`;
// weathered limestone: banded pale stone, grime in the folds, black rain streaks down the vertical faces, moss in
// the crevices and on the tops, crusts of yellow and grey lichen, a fine pitted surface; tears from her eyes
function stoneMaterial(tint = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float cavity;\nattribute float stain;\nattribute float polish;\nvarying float vCav;\nvarying float vStain;\nvarying float vPol;\nvarying vec3 vSP;\nvarying vec3 vSN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCav = cavity; vStain = stain; vPol = polish; vSP = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvSN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCav;\nvarying float vStain;\nvarying float vPol;\nvarying vec3 vSP;\nvarying vec3 vSN;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vSP;
        float n1 = sfbm(p * vec3(1.6, 5.0, 1.6)), n2 = sfbm(p * 11.0);
        float wx = 1.0 - clamp(vPol, 0.0, 1.0);
        vec3 c = mix(vec3(0.60, 0.58, 0.53), vec3(0.74, 0.72, 0.66), n1) * (0.86 + 0.28 * n2);
        c = mix(c, vec3(0.80, 0.78, 0.73) * (0.97 + 0.04 * n1), 1.0 - wx);
        float up = clamp(vSN.y, -1.0, 1.0);
        // rain: dark streaks running down from every ledge
        float st = sfbm(vec3(p.x * 19.0, p.y * 0.9, p.z * 19.0));
        c *= 1.0 - 0.5 * wx * smoothstep(0.5, 0.78, st) * (1.0 - max(up, 0.0));
        // grime in the hollows of the folds
        c *= mix(1.0, mix(0.72, 0.34, wx), clamp(vCav, 0.0, 1.0));
        // moss: in the crevices and on what faces the sky
        float ms = sfbm(p * 6.0 + 3.0) + vCav * 0.28 + max(up, 0.0) * 0.45 - 0.86;
        c = mix(c, mix(vec3(0.13, 0.19, 0.06), vec3(0.24, 0.29, 0.09), n2), smoothstep(0.0, 0.14, ms) * 0.85 * wx);
        // lichen: crusts of mustard yellow and grey-green
        float lc = sfbm(p * 8.0 + 11.0);
        c = mix(c, vec3(0.70, 0.58, 0.26), smoothstep(0.66, 0.7, lc) * 0.75 * step(-0.4, up) * wx);
        c = mix(c, vec3(0.56, 0.60, 0.50), smoothstep(0.68, 0.71, sfbm(p * 13.0 - 5.0)) * 0.6 * wx);
        // what runs from her eyes
        c = mix(c, vec3(0.09, 0.08, 0.07), clamp(vStain, 0.0, 1.0) * 0.85);
        diffuseColor.rgb *= c;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float h = sfbm(vSP * 34.0) * 0.6 + sfbm(vSP * 9.0) * 0.4;
          vec3 dX = dFdx(-vViewPosition), dY = dFdy(-vViewPosition); float hx = dFdx(h), hy = dFdy(h);
          vec3 r1 = cross(dY, normal), r2 = cross(normal, dX); float det = dot(dX, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2); normal = normalize(abs(det) * normal - grad * 0.012 * (1.0 - 0.94 * clamp(vPol, 0.0, 1.0))); }`);
  };
  m.customProgramCacheKey = () => 'ladyStone';
  return m;
}

// carved letters: a height field drawn on a canvas, turned into colour and normal maps
function carvedText(lines, w, h, { font = 'bold 54px serif', scratch = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#000'; x.strokeStyle = '#000'; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (scratch) {   // Raoul's knife: thin, uneven, shaky strokes
    x.font = font; x.lineWidth = 2.2;
    lines.forEach((t, i) => { x.save(); x.translate(w / 2, h * (i + 0.5) / lines.length); x.rotate((i % 2 ? 1 : -1) * 0.03); x.strokeText(t, 0, 0); x.restore(); });
  } else {
    x.font = font; lines.forEach((t, i) => x.fillText(t, w / 2, h * (i + 0.5) / lines.length));
    x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
  }
  const d = x.getImageData(0, 0, w, h).data, H = new Float32Array(w * h); for (let i = 0; i < H.length; i++) H[i] = d[i * 4] / 255;
  const nm = new THREE.CanvasTexture(normalFromHeight(H, w, h, scratch ? 3 : 5)); nm.colorSpace = THREE.NoColorSpace;
  // colour: the cuts hold dark grime
  const cc = document.createElement('canvas'); cc.width = w; cc.height = h; const y = cc.getContext('2d');
  y.fillStyle = '#9a958b'; y.fillRect(0, 0, w, h); y.globalAlpha = 0.85; y.drawImage(c, 0, 0); y.globalCompositeOperation = 'multiply'; y.fillStyle = '#7d786e'; y.fillRect(0, 0, w, h);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ color: 0x8e897f, map, normalMap: nm, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.95, transparent: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

// ---------------------------------------------------------------- geometry helpers
// strip to position/normal/uv, add cavity and stain, make indexed, so everything can be merged into one mesh
function prep(g, cav = 0.15, stain = null) {
  if (!g.index) { const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'cavity', 'stain', 'polish'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.cavity) g.setAttribute('cavity', new THREE.BufferAttribute(new Float32Array(n).fill(cav), 1));
  if (!g.attributes.stain) g.setAttribute('stain', new THREE.BufferAttribute(stain || new Float32Array(n), 1));
  if (!g.attributes.polish) g.setAttribute('polish', new THREE.BufferAttribute(new Float32Array(n), 1));
  return g;
}
const at = (g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => { g.applyMatrix4(new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), V3(...s))); return g; };
// a grid surface: f(u, v) -> [Vector3, cavity]; rows along v, columns along u; skip(i, j) drops a quad
function grid(nu, nv, f, { closeU = false, skip = null } = {}) {
  const cols = closeU ? nu : nu + 1, pos = [], cav = [], uv = [], ind = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) { const [p, c] = f(i / nu, j / nv); pos.push(p.x, p.y, p.z); cav.push(c || 0); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    if (skip && skip(i, j)) continue;
    const i1 = closeU ? (i + 1) % nu : i + 1, a = j * cols + i, b = j * cols + i1, c = (j + 1) * cols + i, d = (j + 1) * cols + i1;
    ind.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('cavity', new THREE.Float32BufferAttribute(cav, 1)); g.setIndex(ind); g.computeVertexNormals();
  return g;
}
// a tube along points with radius r(t)
function tube(pts, r, seg = 8, cav = 0.3) {
  const curve = new THREE.CatmullRomCurve3(pts), steps = Math.max(6, pts.length * 6), fr = curve.computeFrenetFrames(steps, false);
  return grid(seg, steps, (u, v) => { const i = Math.round(v * steps), P = curve.getPointAt(v), a = u * PI * 2, rr = r(v); const N = fr.normals[i], B = fr.binormals[i];
    return [V3(P.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr, P.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr, P.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr), cav]; }, { closeU: true });
}
// a square-section moulded block from a [halfWidth, y] profile (lathe with four sides, turned to face the axes)
function moulding(prof, sx = 1, sz = 1, cav = 0.2) {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * Math.SQRT2, y)), 4); g.rotateY(PI / 4); g.scale(sx, 1, sz);
  return prep(g.toNonIndexed(), cav);
}
// lerp a profile table [[y, a, b, ...]] at y
function prof(tab, y) { if (y <= tab[0][0]) return tab[0].slice(1); for (let i = 1; i < tab.length; i++) if (y <= tab[i][0]) { const a = tab[i - 1], b = tab[i], t = (y - a[0]) / (b[0] - a[0]), s = t * t * (3 - 2 * t); return a.slice(1).map((v, k) => v + (b[k + 1] - v) * s); } return tab[tab.length - 1].slice(1); }

// ---------------------------------------------------------------- the figure
function buildFigure(seed) {
  const r = rng(seed);
  const hb = humanBody({}, 'lady') || humanBody({}, 'priest'); if (!hb) return null;
  const { rig, mesh, P } = hb, J = rig.j, root = rig.root;
  // pose: at prayer, palms together before her breast, fingers straight up; her head bowed, eyes cast down
  const set = (j, x, y = 0, z = 0) => J[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  set('spine', 1); set('chest', 3); set('neck', 8, 0, -3); set('head', 14, 4, -6);
  root.updateMatrixWorld(true);
  { const up = V3(0, 1, 0.22).normalize(), X = V3(1, 0, 0), Y = up.clone().negate(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const hq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const ch = J.chest.getWorldPosition(new THREE.Vector3());
    for (const [k, s] of [['R', -1], ['L', 1]]) { rig.solveArm(k, V3(s * 0.016, ch.y - 0.06, ch.z + 0.2), V3(s * 0.7, -1, -0.25), hq); root.updateMatrixWorld(true); } }
  const g = P.geo, PA = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, RG = g.attributes.region, idx = g.index.array;
  const ji = (n) => JOINTS.indexOf(n), HEAD = ji('head'), NECK = ji('neck'), HR = ji('handR'), HL = ji('handL'), FR = ji('fArmR'), FL = ji('fArmL');
  // bind-pose joint positions
  const bindPos = mesh.skeleton.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const dom = (v) => { let b = -1, w = -1; for (let c = 0; c < 4; c++) { const ww = SW.array[v * 4 + c]; if (ww > w) { w = ww; b = SI.array[v * 4 + c]; } } return b; };
  const tmp = new THREE.Vector3();
  const keepV = (v) => {
    if (RG.getX(v) === 1) return false;                                           // hair: under the veil
    const d = dom(v);
    if (d === HEAD || d === NECK) return true;
    if (d === HR || d === HL) {
      return true;
    }
    if (d === FR || d === FL) { tmp.fromBufferAttribute(PA, v); return tmp.distanceTo(bindPos[d === FR ? HR : HL]) < 0.07; }
    return false;
  };
  const keep = new Uint8Array(PA.count); for (let v = 0; v < PA.count; v++) keep[v] = keepV(v) ? 1 : 0;
  // weld by position, so the rain can wear the face smooth across the seams
  const key = new Map(), wid = new Int32Array(PA.count); let nW = 0; const wp = [];
  for (let v = 0; v < PA.count; v++) { tmp.fromBufferAttribute(PA, v); const k = `${Math.round(tmp.x * 2e4)},${Math.round(tmp.y * 2e4)},${Math.round(tmp.z * 2e4)}`; let id = key.get(k); if (id === undefined) { id = nW++; key.set(k, id); wp.push(tmp.clone()); } wid[v] = id; }
  const nb = Array.from({ length: nW }, () => new Set());
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; if (!keep[a] || !keep[b] || !keep[c]) continue; tris.push(a, b, c);
    const A = wid[a], B = wid[b], C = wid[c]; nb[A].add(B).add(C); nb[B].add(A).add(C); nb[C].add(A).add(B); }
  // the rain has only softened her: a light, even wear over face and hands, every feature kept
  const eyes = (P.eyes || []).map((e) => V3(...e)), fc = eyes.length ? eyes[0].clone().add(eyes[1]).multiplyScalar(0.5) : V3(0, 1.65, 0.12);
  // soften toward a young woman's face: a smaller, finer nose; fuller lips; smooth cheeks; a narrower jaw and a
  // rounder chin (all in the bind pose, about the eyes' midpoint)
  { const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < nW; i++) {
      const p = wp[i], dx = p.x - fc.x, dy = p.y - fc.y, dz = p.z - fc.z; if (p.y < fc.y - 0.2 || dz < -0.09) continue;
      const front = sm(-0.05, -0.01, dz);
      // nose: from between the eyes to its tip, drawn back and narrowed
      const nose = (1 - sm(0.016, 0.03, Math.abs(dx))) * sm(-0.07, -0.05, dy) * (1 - sm(0.0, 0.012, dy)) * sm(-0.005, 0.02, dz);
      p.z -= nose * Math.max(0, dz + 0.005) * 0.32; p.x = fc.x + dx * (1 - 0.14 * nose);
      // lips: a little fuller and forward, the mouth a touch wider
      const lip = (1 - sm(0.022, 0.034, Math.abs(dx))) * Math.exp(-(((dy + 0.072) / 0.014) ** 2)) * front;
      p.z += lip * 0.0035; p.y = p.y + (dy + 0.072) * 0.18 * lip; p.x = fc.x + (p.x - fc.x) * (1 + 0.06 * lip);
      // jaw and chin: narrower jaw, a softer, rounder chin
      const jaw = sm(-0.06, -0.11, dy) * sm(0.03, 0.06, Math.abs(dx));
      p.x = fc.x + (p.x - fc.x) * (1 - 0.07 * jaw);
      const chin = sm(-0.09, -0.12, dy) * (1 - sm(0.02, 0.04, Math.abs(dx))) * front;
      p.z -= chin * 0.004; p.y += chin * 0.004;
      // cheeks a little fuller under the cheekbones (not gaunt)
      const cheek = Math.exp(-(((Math.abs(dx) - 0.042) / 0.016) ** 2) - ((dy + 0.045) / 0.022) ** 2) * front;
      p.x = fc.x + (p.x - fc.x) * (1 + 0.035 * cheek); p.z += cheek * 0.004;
    } }
  const lam = new Float32Array(nW);
  for (let i = 0; i < nW; i++) { const p = wp[i]; const face = p.z > fc.z - 0.07 && p.y > fc.y - 0.13 && p.y < fc.y + 0.05 && Math.abs(p.x) < 0.07 && p.y > 1.3; lam[i] = face ? 0.22 : 0.2; }
  const cur = wp.map((p) => p.clone()), nxt = wp.map((p) => p.clone());
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < nW; i++) { if (!nb[i].size) continue;
      tmp.set(0, 0, 0); for (const j of nb[i]) tmp.add(cur[j]); tmp.multiplyScalar(1 / nb[i].size); nxt[i].copy(cur[i]).lerp(tmp, lam[i]); }
    for (let i = 0; i < nW; i++) cur[i].copy(nxt[i]);
  }
  // bake the pose into the stone
  const used = [...new Set(tris)], remap = new Map(); used.forEach((v, i) => remap.set(v, i));
  const pos = new Float32Array(used.length * 3), uvs = new Float32Array(used.length * 2), cav = new Float32Array(used.length), stain = new Float32Array(used.length);
  const UV = g.attributes.uv;
  used.forEach((v, i) => {
    const b = cur[wid[v]];
    tmp.copy(b); mesh.applyBoneTransform(v, tmp); pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    uvs.set([UV.getX(v), UV.getY(v)], i * 2);
    // grime gathers round the eyes and under the chin
    const d = Math.min(...eyes.map((e) => e.distanceTo(b)));
    cav[i] = 0.12 + (d < 0.025 ? 0.3 * (1 - d / 0.025) : 0) + (b.z > fc.z - 0.02 && b.y < fc.y - 0.1 && b.y > fc.y - 0.16 ? 0.25 : 0);
    // the tears: two dark runs from the inner corners of the eyes down the cheeks
    for (const e of eyes) { const dx = Math.abs(b.x - e.x * 0.75), dy = e.y - b.y; if (dy > -0.008 && dy < 0.13 && dx < 0.007 + dy * 0.03 && b.z > e.z - 0.04) stain[i] = Math.max(stain[i], 0.55 * (1 - dx / (0.007 + dy * 0.03)) * (1 - dy / 0.13)); }
  });
  const pol = new Float32Array(used.length).fill(1);
  const fig = new THREE.BufferGeometry(); fig.setAttribute('polish', new THREE.BufferAttribute(pol, 1));
  fig.setAttribute('position', new THREE.BufferAttribute(pos, 3)); fig.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  fig.setAttribute('cavity', new THREE.BufferAttribute(cav, 1)); fig.setAttribute('stain', new THREE.BufferAttribute(stain, 1));
  fig.setIndex(tris.map((v) => remap.get(v))); fig.computeVertexNormals();
  const parts = [prep(fig)];

  // where the bones are now
  const wpos = (n) => J[n].getWorldPosition(new THREE.Vector3());
  const head = J.head, hm = head.matrixWorld;
  // ---- the gown: high-girdled under the bust, a narrow waist, sloping shoulders; the skirt falls from the girdle
  // in long folds that deepen toward the hem and pool on the plinth
  const GY = 1.19;   // the girdle
  const GOWN = [[0.0, 0.3, 0.27], [0.035, 0.27, 0.245], [0.1, 0.235, 0.205], [0.5, 0.205, 0.165], [0.85, 0.175, 0.14], [1.02, 0.15, 0.12], [GY - 0.03, 0.128, 0.105], [GY, 0.124, 0.102], [GY + 0.03, 0.13, 0.108], [1.27, 0.145, 0.12], [1.35, 0.148, 0.112], [1.42, 0.138, 0.098], [1.48, 0.095, 0.072], [1.53, 0.06, 0.058]];
  const fph = Array.from({ length: 5 }, () => r() * PI * 2), ffr = [5, 7, 9, 12, 17];
  const fold = (a, y, depth) => { let f = 0; for (let k = 0; k < 5; k++) f += Math.pow(Math.abs(Math.sin(a * ffr[k] * 0.5 + fph[k] + y * 0.12 * k)), 0.6) / (k + 1.2); return -f * depth; };
  parts.push(grid(64, 46, (u, v) => {
    const y = v * 1.53, a = u * PI * 2; let [rx, rz] = prof(GOWN, y);
    const depth = y < GY ? 0.05 * Math.pow(Math.max(0, 1 - y / GY), 0.7) + 0.005 : 0.006 * Math.exp(-((y - GY - 0.05) ** 2) / 0.003);   // folds from the girdle; a few soft gathers above it
    const f = fold(a, y, depth); rx += f; rz += f;
    rz += 0.03 * Math.exp(-((y - 1.285) ** 2) / 0.0028) * Math.pow(Math.max(0, Math.cos(a)), 2.5) * (0.6 + 0.4 * Math.pow(Math.abs(Math.sin(a * 1.0)) + 0.0, 0.5));   // the bust, gently
    rz += 0.012 * Math.exp(-((y - 0.95) ** 2) / 0.02) * Math.max(0, Math.cos(a));   // the cloth falling forward over her belly
    // contrapposto: her weight on the right leg, the left knee forward pressing the cloth, a fold falling from it
    const kn = Math.exp(-((y - 0.52) ** 2) / 0.03) * Math.pow(Math.max(0, Math.cos(a - 0.38)), 5);
    rz += 0.045 * kn; rx += 0.02 * kn * Math.sin(a);
    const fall = Math.pow(Math.max(0, Math.cos(a - 0.38)), 30) * Math.max(0, 1 - y / 0.5) * 0.03; rz += fall;
    let yy = y; if (y < 0.06) { yy = y + Math.sin(a * 9 + fph[0]) * 0.012 * (1 - y / 0.06); const pool = 1 + 0.12 * (1 - y / 0.06) * (0.5 + 0.5 * Math.sin(a * 5 + fph[1])); rx *= pool; rz *= pool; }
    return [V3(Math.sin(a) * rx, Math.max(0, yy), Math.cos(a) * rz), Math.min(1, Math.pow(-f / depth, 1.6) * 1.1)];
  }, { closeU: true }));
  // the hem's underside, so it sits down onto the plinth
  parts.push(prep(at(new THREE.CircleGeometry(1, 40), [0, 0.004, 0], [PI / 2, 0, 0], [0.33, 0.29, 1]), 0.6));
  // ---- the sleeves: one to each arm, close on the upper arm, opening from the elbow into a wide bell whose
  // lower side hangs heavy below the forearm; the wrist and hand come out of its mouth
  for (const k of ['R', 'L']) {
    const s0 = wpos('uArm' + k), e = wpos('fArm' + k), w = wpos('hand' + k);
    const curve = new THREE.CatmullRomCurve3([s0.clone().lerp(e, 0.03), s0.clone().lerp(e, 0.55), e, e.clone().lerp(w, 0.45), w.clone().lerp(e, 0.3)]);
    const steps = 40, fr = curve.computeFrenetFrames(steps, false), dn = V3(0, -1, 0), o = new THREE.Vector3();
    parts.push(grid(28, steps, (u, v) => {
      const i = Math.round(v * steps), P = curve.getPointAt(v), a = u * PI * 2, N = fr.normals[i], B = fr.binormals[i];
      o.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      const bell = Math.max(0, (v - 0.45) / 0.55), down = Math.max(0, o.dot(dn));
      const rr = 0.054 + 0.008 * v + bell * bell * 0.016 + down * bell * 0.07 + Math.sin(a * 6 + v * 3) * 0.004 * bell;
      return [P.clone().addScaledVector(o, rr), 0.25 + 0.4 * Math.max(0, Math.sin(a * 6 + v * 3)) * bell];
    }, { closeU: true }));
    // a hemmed edge round the sleeve's mouth
    const rim = []; for (let q = 0; q <= 28; q++) { const a = (q / 28) * PI * 2, N = fr.normals[steps], B = fr.binormals[steps], P = curve.getPointAt(1); o.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)); const down = Math.max(0, o.dot(dn)); rim.push(P.clone().addScaledVector(o, 0.054 + 0.008 + 0.016 + down * 0.07 + Math.sin(a * 6 + 3) * 0.004)); }
    parts.push(tube(rim, () => 0.006, 5, 0.3));
  }
  // the girdle: a cord tied under the bust, its ends hanging down the front of the skirt
  { const ring = []; for (let q = 0; q <= 40; q++) { const a = (q / 40) * PI * 2, [rx, rz] = prof(GOWN, GY); ring.push(V3(Math.sin(a) * (rx + 0.006), GY, Math.cos(a) * (rz + 0.006))); }
    // a flat band, not a cord: a short strip of cloth all round, its edges standing proud
    parts.push(grid(64, 3, (u, v) => { const a = u * PI * 2, [rx, rz] = prof(GOWN, GY), y = GY - 0.018 + v * 0.036, out = 0.008 + (v === 0 || v === 1 ? 0.0 : 0.004); return [V3(Math.sin(a) * (rx + out), y, Math.cos(a) * (rz + out)), 0.25]; }, { closeU: true }));
    for (const yy of [GY - 0.018, GY + 0.018]) { const rr = []; for (let q = 0; q <= 64; q++) { const a = (q / 64) * PI * 2, [rx, rz] = prof(GOWN, GY); rr.push(V3(Math.sin(a) * (rx + 0.01), yy, Math.cos(a) * (rz + 0.01))); } parts.push(tube(rr, () => 0.003, 4, 0.5)); }
    const kn = V3(0.03, GY - 0.005, prof(GOWN, GY)[1] + 0.012);
    parts.push(prep(at(new THREE.SphereGeometry(0.016, 10, 8), [kn.x, kn.y, kn.z], [0, 0, 0], [1, 0.8, 0.7]), 0.3));
    for (const [dx, L] of [[-0.01, 0.42], [0.02, 0.5]]) { const pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8, y = kn.y - t * L; pts.push(V3(kn.x + dx * t + Math.sin(t * 5 + dx * 40) * 0.008, y, prof(GOWN, y)[1] + 0.012 + 0.01 * t)); } parts.push(tube(pts, (t) => 0.0055 + (t > 0.92 ? 0.004 : 0), 5, 0.35)); } }
  // ---- the mantle: from the shoulders round the back and sides, open in front, heavy folds, a rolled hem
  const MANT = [[0.12, 0.28, 0.21], [0.5, 0.245, 0.2], [0.9, 0.235, 0.185], [1.1, 0.24, 0.17], [1.3, 0.235, 0.165], [1.4, 0.2, 0.145], [1.46, 0.14, 0.115]];
  const A0 = 0.44 * PI, A1 = 1.56 * PI;   // round the back, from her left front to her right front
  const mph = Array.from({ length: 4 }, () => r() * PI * 2);
  const mfold = (a, y) => { let f = 0; for (let k = 0; k < 4; k++) f += Math.pow(Math.abs(Math.sin(a * (4 + k * 2.7) * 0.5 + mph[k])), 0.55) / (k + 1); return -f * (0.04 * Math.max(0.15, 1 - y / 1.3)); };
  const mantlePt = (u, v) => { const y = 0.12 + (1 - v) * (1.46 - 0.12), a = A0 + u * (A1 - A0); let [rx, rz] = prof(MANT, y); const f = mfold(a, y); rx += f; rz += f;
    const edge = Math.min(u, 1 - u); const fall = edge < 0.06 ? (1 - edge / 0.06) * 0.03 : 0;   // the front edges turn in a little
    return [V3(Math.sin(a) * (rx - fall), y + (v > 0.98 ? Math.sin(a * 7) * 0.012 : 0), Math.cos(a) * (rz - fall)), Math.min(1, -f / 0.04)]; };
  parts.push(grid(54, 34, mantlePt));
  // the mantle's thick hem: down both front edges and along the bottom
  const hemPts = []; for (let i = 0; i <= 12; i++) hemPts.push(mantlePt(0, i / 12)[0]);
  for (let i = 1; i <= 24; i++) hemPts.push(mantlePt(i / 24, 1)[0]);
  for (let i = 11; i >= 0; i--) hemPts.push(mantlePt(1, i / 12)[0]);
  parts.push(tube(hemPts, () => 0.011, 6, 0.35));
  // ---- the veil: a cap over the crown, framing the face, falling to the shoulders where it meets the mantle
  const hbx = headBox(mesh), hc = hbx.getCenter(new THREE.Vector3()), hs = hbx.getSize(new THREE.Vector3());
  const RX = hs.x / 2 + 0.034, RY = hs.y / 2 + 0.04, RZ = hs.z / 2 + 0.032, brow = hc.y + 0.01;
  const inv = new THREE.Matrix4().copy(hm).invert(), shoulderL = V3(0, 1.43, -0.01).applyMatrix4(inv);   // the shoulders, in the head's frame
  const NU = 48, NV = 30, gapA = 52 * D2R;
  const veilPt = (u, v) => {
    const a = u * PI * 2;   // 0 = straight in front of her face
    let p;
    if (v < 0.55) {   // the cap, over the head to just past its widest
      const ph = (v / 0.55) * (PI / 2 + 0.5); p = V3(Math.sin(a) * Math.sin(ph) * RX, hc.y + Math.cos(ph) * RY + 0.006, hc.z + Math.cos(a) * Math.sin(ph) * RZ - 0.008);
    } else {          // the drape, widening and falling to the shoulders, a few soft folds
      const t = (v - 0.55) / 0.45, s = t * t * (3 - 2 * t); const ph = PI / 2 + 0.5;
      const top = V3(Math.sin(a) * Math.sin(ph) * RX, hc.y + Math.cos(ph) * RY + 0.006, hc.z + Math.cos(a) * Math.sin(ph) * RZ - 0.008);
      const back = Math.max(0, -Math.cos(a)), side = Math.abs(Math.sin(a));
      const rx = RX * Math.sin(ph) + s * 0.11 + 0.015 * t, rz = RZ * Math.sin(ph) + s * 0.05, fl = 1 + (Math.pow(Math.abs(Math.sin(a * 5 + 1.3)), 0.6) - 0.5) * 0.16 * t;
      const drop = (shoulderL.y - top.y) * s - back * 0.3 * t * t - side * 0.06 * t * t;   // past the shoulders, longest down her back
      p = V3(Math.sin(a) * rx * fl, top.y + drop, hc.z - 0.01 * s - back * 0.04 * t + Math.cos(a) * rz * fl);
    }
    return [p.applyMatrix4(hm), v > 0.55 ? 0.15 + 0.5 * Math.pow(Math.abs(Math.sin(a * 5 + 1.3)), 6) : 0.1];
  };
  const inGap = (a) => { const d = Math.atan2(Math.sin(a), Math.cos(a)); return Math.abs(d) < gapA; };
  const browV = 0.3;   // the face opening starts at the forehead
  parts.push(grid(NU, NV, veilPt, { closeU: true, skip: (i, j) => j / NV >= browV && inGap(((i + 0.5) / NU) * PI * 2) }));
  // a rolled edge round the face and down the front of the veil
  const edge = []; const iL = Math.round((gapA / (PI * 2)) * NU), iR = NU - iL, j0 = Math.round(browV * NV);
  for (let j = NV; j >= j0; j--) edge.push(veilPt(iL / NU, j / NV)[0]);
  for (let i = iL - 1; i >= -iL + 1; i--) edge.push(veilPt(((i + NU) % NU) / NU, j0 / NV)[0]);
  for (let j = j0; j <= NV; j++) edge.push(veilPt(iR / NU, j / NV)[0]);
  // hair beneath the veil's edge: parted at the brow, two soft waves swept to the sides
  { const hp = (x, y, z) => V3(x, y, z).applyMatrix4(hm), hy = veilPt(0, browV)[0].clone().applyMatrix4(new THREE.Matrix4().copy(hm).invert()).y - 0.006;
    for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) {
      // from the parting, down over the temple and under the veil: a soft lock, the second tucked a little behind
      const pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8, ang = sd * (0.04 + k * 0.05 + t * 0.85), y = hy + 0.004 - t * t * 0.075 - k * 0.004;
        pts.push(hp(Math.sin(ang) * (RX - 0.026 - k * 0.003 + t * 0.004), y, hc.z - 0.008 + Math.cos(ang) * (RZ - 0.026 - k * 0.003))); }
      parts.push(tube(pts, (t) => (0.0085 - k * 0.002) * (1 - t * 0.35), 7, 0.4)); } }
  // her feet are hidden; the toes of one shoe peep from under the hem
  parts.push(prep(at(new THREE.SphereGeometry(0.045, 12, 8), [0.06, 0.02, 0.24], [0, 0.15, 0], [0.8, 0.45, 1.3]), 0.3));
  for (const p of parts) prep(p);
  const merged = mergeGeometries(parts.map((p) => prep(p)));
  return merged;
}

// ---------------------------------------------------------------- the shrine
export function buildLadyShrine(seed = 7) {
  const r = rng(seed);
  const fig = buildFigure(seed); if (!fig) return null;
  const g = new THREE.Group();
  const stone = stoneMaterial(), darkStone = stoneMaterial(0xc8c2b6);
  const S = [], D = [];
  const add = (geo, list = S) => { list.push(prep(geo, geo.attributes.cavity ? undefined : 0.2)); return geo; };
  // two cracked, sunken steps
  const step = (w, h, d, y, z, rx, rz, crackX) => {
    for (const side of [-1, 1]) {
      const pw = side < 0 ? w / 2 + crackX : w / 2 - crackX, cx = side < 0 ? -w / 2 + pw / 2 : w / 2 - pw / 2;
      const b = new THREE.BoxGeometry(pw - 0.012, h, d, 3, 1, 3); const bp = b.attributes.position;
      for (let i = 0; i < bp.count; i++) { const yy = bp.getY(i); if (yy > 0) { bp.setX(i, bp.getX(i) * (1 - 0.015 * r())); bp.setZ(i, bp.getZ(i) * (1 - 0.02 * r())); } }   // worn edges
      add(at(b, [cx, y, z], [rx * side, 0, rz * side]));
    }
  };
  step(1.75, 0.2, 1.55, 0.06, 0.18, 0.012, 0.02, 0.18);
  step(1.32, 0.18, 1.12, 0.25, 0.08, -0.01, 0.015, -0.12);
  const top = 0.34;
  // the plinth: moulded foot and cap, the panel between carved AVE MARIA, Raoul's scratching on its side
  add(moulding([[0.36, 0], [0.36, 0.06], [0.33, 0.09], [0.31, 0.12], [0.3, 0.12]], 1, 0.85)).translate(0, top, 0);
  add(at(new THREE.BoxGeometry(0.56, 0.46, 0.48, 2, 4, 2), [0, top + 0.35, 0]));
  add(moulding([[0.3, 0], [0.31, 0.03], [0.34, 0.07], [0.36, 0.09], [0.36, 0.13], [0.0, 0.13]], 1, 0.85)).translate(0, top + 0.58, 0);
  const pTop = top + 0.71;
  const ave = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), carvedText(['AVE MARIA', 'GRATIA PLENA'], 512, 210, { font: 'bold 70px serif' }));
  ave.position.set(0, top + 0.4, 0.2405); g.add(ave);
  const raoul = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), carvedText(['SHE WEEPS AT NIGHT', 'I HAVE HEARD HER', 'SHE IS NOT WEEPING', 'FOR US'], 512, 360, { font: '44px serif', scratch: true }));
  raoul.position.set(0.2805, top + 0.34, 0); raoul.rotation.y = PI / 2; g.add(raoul);
  // the niche wall behind her: a pointed arch with a moulded frame
  const wall = new THREE.Shape(); const W = 0.62, H0 = 1.06, H1 = 1.42;
  wall.moveTo(-W, 0); wall.lineTo(W, 0); wall.lineTo(W, H0); wall.quadraticCurveTo(W * 0.95, H1 * 0.95, 0, H1 + 0.12); wall.quadraticCurveTo(-W * 0.95, H1 * 0.95, -W, H0); wall.lineTo(-W, 0);
  add(at(new THREE.ExtrudeGeometry(wall, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 }), [0, pTop - 0.02, -0.5]));
  const arch = []; const aw = 0.46, ah0 = 0.98, ah1 = 1.36;
  for (let i = 0; i <= 10; i++) arch.push(V3(-aw, pTop + (i / 10) * ah0, -0.32));
  for (let i = 1; i <= 16; i++) { const t = i / 16, a = PI - t * PI; arch.push(V3(Math.cos(a) * aw * (1 - 0.15 * Math.sin(t * PI)), pTop + ah0 + Math.sin(a) * (ah1 - ah0) * (t < 0.5 ? t * 2 : (1 - t) * 2) ** 0.6 * 1.0, -0.32)); }
  for (let i = 9; i >= 0; i--) arch.push(V3(aw, pTop + (i / 10) * ah0, -0.32));
  add(tube(arch, () => 0.035, 8, 0.3));
  // two little columns at the front corners, with bases and capitals
  for (const s of [-1, 1]) {
    const x = s * 0.6, z = 0.32;
    add(moulding([[0.12, 0], [0.12, 0.05], [0.095, 0.09], [0.0, 0.09]]).translate(x, top, z));
    add(prep(at(new THREE.CylinderGeometry(0.08, 0.088, 1.95, 16, 8), [x, top + 0.09 + 0.975, z]), 0.15));
    add(moulding([[0.08, 0], [0.105, 0.06], [0.125, 0.1], [0.125, 0.14], [0, 0.14]]).translate(x, top + 2.04, z));
  }
  // the canopy roof: its left slab still up, the right one fallen and lying against the steps, the ridge broken
  const roofY = top + 2.2;
  add(at(new THREE.BoxGeometry(1.42, 0.08, 1.08), [0, roofY + 0.02, -0.1]));   // the lintel slab
  // a level gabled roof of two stone slabs meeting at a ridge, a little cross on the gable
  { const L = 0.8, th = 0.5, len = L / Math.cos(th), cy = roofY + 0.06 + (L / 2) * Math.tan(th);
    for (const sd of [-1, 1]) add(at(new THREE.BoxGeometry(len, 0.07, 1.22, 4, 1, 4), [sd * L / 2, cy, -0.1], [0, 0, -sd * th]));
    add(prep(at(new THREE.CylinderGeometry(0.045, 0.045, 1.26, 10), [0, roofY + 0.06 + L * Math.tan(th) + 0.02, -0.1], [PI / 2, 0, 0]), 0.2));
    const gy = roofY + 0.06 + L * Math.tan(th) + 0.05;
    add(at(new THREE.BoxGeometry(0.05, 0.3, 0.05), [0, gy + 0.15, 0.48])); add(at(new THREE.BoxGeometry(0.2, 0.05, 0.05), [0, gy + 0.2, 0.48])); }
  add(at(new THREE.DodecahedronGeometry(0.1, 0), [1.15, 0.06, 0.62], [0.4, 0.2, 0.1], [1, 0.6, 1.2]));   // fallen stones, lying in the grass
  add(at(new THREE.DodecahedronGeometry(0.07, 0), [-0.82, 0.18, 0.75], [0.2, 0.9, 0.4]));
  add(at(new THREE.DodecahedronGeometry(0.05, 0), [0.55, top + 0.03, 0.5], [0.7, 0.1, 0.3], [1, 0.6, 1]));
  // her figure on the plinth, turned away from the road toward the mountain, as Raoul found her
  fig.applyMatrix4(new THREE.Matrix4().compose(V3(0, pTop, -0.04), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.45, 0)), V3(0.74, 0.74, 0.74)));
  S.push(fig);
  const stoneMesh = new THREE.Mesh(mergeGeometries(S), stone); stoneMesh.castShadow = true; stoneMesh.receiveShadow = true; g.add(stoneMesh);
  // ---- what was left for her: candles, dead flowers, a rosary, coins, a little wooden cross
  const wax = new THREE.MeshStandardMaterial({ color: 0xe6dcc0, roughness: 0.55, emissive: 0x2a1e08, emissiveIntensity: 0.25 });
  const wick = new THREE.MeshStandardMaterial({ color: 0x111010, roughness: 1 });
  const flame = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const C = [], Wk = [], F = [];
  const candles = [[-0.42, top, 0.42, 0.13, true], [-0.33, top, 0.5, 0.07, false], [-0.5, top, 0.55, 0.05, false], [0.35, top, 0.46, 0.1, true], [0.43, top, 0.38, 0.04, false], [0.16, pTop, 0.18, 0.06, false], [-0.18, pTop, 0.2, 0.09, true]];
  for (const [x, y, z, h, lit] of candles) {
    const rr = 0.018 + r() * 0.012;
    // a stub with wax run down its sides and pooled at its foot
    const pr = [[0, 0], [rr * 1.9, 0], [rr * 1.5, 0.006], [rr * 1.1, 0.012], [rr, 0.02], [rr * 1.02, h * 0.6], [rr * 0.98, h], [rr * 0.6, h + 0.004], [0.002, h + 0.002]];
    const lg = new THREE.LatheGeometry(pr.map(([a, b]) => new THREE.Vector2(a, b)), 14); const lp = lg.attributes.position;
    for (let i = 0; i < lp.count; i++) { const yy = lp.getY(i); const ang = Math.atan2(lp.getZ(i), lp.getX(i)); const drip = Math.max(0, Math.sin(ang * 3 + x * 9)) * 0.004 * (yy / h); lp.setX(i, lp.getX(i) * (1 + drip / rr)); lp.setZ(i, lp.getZ(i) * (1 + drip / rr)); }
    lg.computeVertexNormals(); C.push(at(lg, [x, y, z]));
    Wk.push(at(new THREE.CylinderGeometry(0.0015, 0.0015, 0.012, 4), [x, y + h + 0.006, z]));
    if (lit) F.push(at(new THREE.SphereGeometry(0.008, 8, 6), [x, y + h + 0.022, z], [0, 0, 0], [0.75, 2.3, 0.75]));
  }
  const cm = new THREE.Mesh(mergeGeometries(C.map((x) => prep(x))), wax); cm.castShadow = true; g.add(cm);
  g.add(new THREE.Mesh(mergeGeometries(Wk.map((x) => prep(x))), wick));
  const flames = new THREE.Mesh(mergeGeometries(F.map((x) => prep(x))), flame); g.add(flames);
  // dead flowers: a bunch tied with a rotted ribbon, lying on the upper step, and a few loose
  const stemM = new THREE.MeshStandardMaterial({ color: 0x3c3a22, roughness: 0.9 }), petM = new THREE.MeshStandardMaterial({ color: 0x5a3a2c, roughness: 0.95, side: THREE.DoubleSide }), ribM = new THREE.MeshStandardMaterial({ color: 0x4a1a1e, roughness: 0.9, side: THREE.DoubleSide });
  const St = [], Pe = [];
  const bunch = (bx, by, bz, yaw, n) => { for (let i = 0; i < n; i++) { const a = yaw + (r() - 0.5) * 0.35, L = 0.24 + r() * 0.12, droop = 0.03 + r() * 0.05;
      const p0 = V3(bx, by + 0.006, bz), p2 = V3(bx + Math.sin(a) * L, by + 0.01, bz + Math.cos(a) * L), p1 = p0.clone().lerp(p2, 0.6).add(V3(0, droop, 0));
      St.push(tube([p0, p1, p2], () => 0.0022, 4, 0));
      for (let k = 0; k < 6; k++) Pe.push(at(new THREE.SphereGeometry(0.014, 6, 4), [p2.x + (r() - 0.5) * 0.03, p2.y + 0.006 + r() * 0.01, p2.z + (r() - 0.5) * 0.03], [r() * 3, r() * 3, 0], [1, 0.25, 0.7])); } };
  bunch(0.08, top, 0.42, -0.6, 7); bunch(-0.2, 0.16, 0.85, 0.9, 3); bunch(0.0, pTop, 0.16, 2.6, 4);
  g.add(new THREE.Mesh(mergeGeometries(St.map((x) => prep(x))), stemM));
  const pe = new THREE.Mesh(mergeGeometries(Pe.map((x) => prep(x))), petM); pe.castShadow = true; g.add(pe);
  const rib = new THREE.Mesh(prep(tube([V3(0.08, top + 0.015, 0.42), V3(0.1, top + 0.03, 0.46), V3(0.14, top + 0.006, 0.5), V3(0.18, top + 0.004, 0.6)], () => 0.006, 5, 0)), ribM); rib.scale.set(1, 1, 1); g.add(rib);
  // a rosary hung over the plinth's cap, beads on a cord, a little cross at the end
  const beadM = new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.5 }), B = [];
  const rosary = []; for (let i = 0; i <= 30; i++) { const t = i / 30, a = -0.9 + t * 1.8; rosary.push(V3(Math.sin(a) * 0.3, pTop - 0.06 - Math.cos(a * 1.7) * 0.07 + 0.07, 0.315 + Math.cos(a) * 0.012)); }
  const rc = new THREE.CatmullRomCurve3(rosary); for (let i = 0; i <= 40; i++) { const p = rc.getPointAt(i / 40); B.push(at(new THREE.SphereGeometry(i % 10 === 0 ? 0.008 : 0.0055, 6, 5), [p.x, p.y, p.z])); }
  const tail = rc.getPointAt(0.5); for (let i = 1; i <= 5; i++) B.push(at(new THREE.SphereGeometry(0.0055, 6, 5), [tail.x, tail.y - i * 0.014, tail.z + 0.002]));
  B.push(at(new THREE.BoxGeometry(0.006, 0.034, 0.004), [tail.x, tail.y - 0.098, tail.z + 0.003])); B.push(at(new THREE.BoxGeometry(0.022, 0.006, 0.004), [tail.x, tail.y - 0.09, tail.z + 0.003]));
  g.add(new THREE.Mesh(mergeGeometries(B.map((x) => prep(x))), beadM));
  // coins, green with age
  const coinM = new THREE.MeshStandardMaterial({ color: 0x6b6a4a, metalness: 0.8, roughness: 0.55 }), Co = [];
  for (let i = 0; i < 7; i++) Co.push(at(new THREE.CylinderGeometry(0.012, 0.012, 0.002, 12), [(r() - 0.5) * 0.3, pTop + 0.002, 0.08 + r() * 0.12], [r() * 0.1, 0, r() * 0.1]));
  for (let i = 0; i < 4; i++) Co.push(at(new THREE.CylinderGeometry(0.012, 0.012, 0.002, 12), [0.15 + r() * 0.2, top + 0.002, 0.3 + r() * 0.2], [r() * 0.1, 0, r() * 0.1]));
  g.add(new THREE.Mesh(mergeGeometries(Co.map((x) => prep(x))), coinM));
  // a small wooden cross, roughly made, leaning against the plinth
  const woodM = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.95 });
  const wc = new THREE.Group(); wc.add(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.36, 0.02), woodM)); const cb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.022, 0.02), woodM); cb.position.y = 0.08; wc.add(cb);
  wc.position.set(-0.3, top + 0.17, 0.3); wc.rotation.set(-0.3, 0.3, 0.06); for (const m of wc.children) m.castShadow = true; g.add(wc);
  // the flames flicker
  g.userData.update = (time) => { flame.opacity = 0.7 + Math.sin(time * 17) * 0.12 + Math.sin(time * 29.3) * 0.1; };
  g.userData.pageAt = [0.42, top + 0.004, 0.6];
  return g;
}
