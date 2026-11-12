// The Emperor's army where it fell, years ago. The men themselves: whole skeletons lying as they dropped (flung on
// their backs, face down with an arm reaching, curled on their sides round a belly wound, dragged by the heels), in
// what is left of a Landsknecht's clothes: parti-coloured hose, slashed and puffed sleeves, a doublet rotted open
// over the ribs, broad-toed shoes; some in a rusted breastplate, a mail cape or a sallet, some stripped to the shirt
// by looters, some dried to leather. Every one is built bone by bone on a pose (bones.js), the cloth draped over the
// bones and lying on the ground, the earth risen round him where he has sunk into it. Round them, what they
// carried: katzbalgers, two-handed swords, halberds, pikes whole and broken, arquebuses, kettle hats, the company's
// flag with the ragged cross of Burgundy; and the loose bones the crows and foxes left.
//
// The men and their gear are a small library of models, each one mesh with one shared material, each in three
// weights: the full model to stand over, a lighter one from a few paces, and a coarse one that is merged with its
// neighbours into a single mesh for each square of the field; past the fog, nothing.
//
// They lie on the ground itself. Every model is built on a flat floor; the shader then sets each vertex as far
// above the real ground beneath it as it stood above that floor (the height field is given to it as a texture,
// read exactly as World.heightAt reads it). So a man lies along the slope and over every hump and hollow of it,
// with nothing of him in the air and nothing buried that was not.
import * as THREE from 'three';
import { TAU, rng, makeNoise, clamp, lerp } from './util.js';
import { boneLibrary, loft } from './bones.js';

const PI = Math.PI, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Y = V(0, 1, 0);
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const dirAz = (a) => V(Math.sin(a), 0, Math.cos(a));   // a direction on the ground: 0 = +z, a quarter turn = +x
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const NZ = makeNoise(4242);
const WHITE = [1, 1, 1], EARTH = lin(0x2b241c), ID = new THREE.Matrix4();
const _v = V(), _n = V(), _nm = new THREE.Matrix3();

// ---------------------------------------------------------------- one mesh in the making
// Positions, normals, colours, how much of it is bare metal, and (for cloth) a lining colour and the co-ordinates of
// its panes and slashes; indexed.
class Soup {
  constructor(cap = 2048) { this.n = 0; this.ni = 0; this.cap = cap; this.icap = cap * 4; for (const k of 'PNCLQ') this[k] = new Float32Array(cap * 3); this.A = new Float32Array(cap); this.I = new Uint32Array(this.icap); this.low = []; }
  get nv() { return this.n; }
  get tris() { return this.ni / 3; }
  need(v, i) {
    if (this.n + v > this.cap) { let c = this.cap; while (c < this.n + v) c *= 2; for (const k of 'PNCLQ') { const a = new Float32Array(c * 3); a.set(this[k].subarray(0, this.n * 3)); this[k] = a; } const a = new Float32Array(c); a.set(this.A.subarray(0, this.n)); this.A = a; this.cap = c; }
    if (this.ni + i > this.icap) { let c = this.icap; while (c < this.ni + i) c *= 2; const a = new Uint32Array(c); a.set(this.I.subarray(0, this.ni)); this.I = a; this.icap = c; }
  }
  // a ready geometry, placed by m. tint: a colour to multiply its own by (or to give it), or fn(x, y, z, o) setting o.r/g/b/m
  add(g, m = ID, tint = null, metal = 0, name = null) {
    const p = g.attributes.position.array, nr = g.attributes.normal.array, c = g.attributes.color?.array, cnt = g.attributes.position.count, base = this.n, flip = m.determinant() < 0, o = { r: 1, g: 1, b: 1, m: metal };
    const ix = g.index ? g.index.array : null, nt = ix ? ix.length : cnt; this.need(cnt, nt);
    const e = m.elements, ne = _nm.getNormalMatrix(m).elements, fn = typeof tint === 'function' ? tint : null, t = fn ? WHITE : tint || WHITE, P = this.P, N = this.N, C = this.C;
    let ly = 1e9, lx = 0, lz = 0;
    for (let i = 0, q = base * 3; i < cnt; i++, q += 3) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], nx = nr[i * 3], ny = nr[i * 3 + 1], nz = nr[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      P[q] = wx; P[q + 1] = wy; P[q + 2] = wz; if (wy < ly) { ly = wy; lx = wx; lz = wz; }
      const ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz, l = 1 / (Math.hypot(ax, ay, az) || 1);
      N[q] = ax * l; N[q + 1] = ay * l; N[q + 2] = az * l;
      if (fn) { o.m = metal; fn(x, y, z, o); C[q] = o.r; C[q + 1] = o.g; C[q + 2] = o.b; this.A[base + i] = o.m; }
      else { if (c) { C[q] = c[i * 3] * t[0]; C[q + 1] = c[i * 3 + 1] * t[1]; C[q + 2] = c[i * 3 + 2] * t[2]; } else { C[q] = t[0]; C[q + 1] = t[1]; C[q + 2] = t[2]; } this.A[base + i] = metal; }
    }
    const I = this.I; let k = this.ni;
    for (let j = 0; j < nt; j += 3) { const a = ix ? ix[j] : j, b = ix ? ix[j + 1] : j + 1, d = ix ? ix[j + 2] : j + 2; I[k++] = base + a; I[k++] = base + (flip ? d : b); I[k++] = base + (flip ? b : d); }
    this.n += cnt; this.ni = k;
    if (name) this.low.push({ name, x: lx, y: ly, z: lz });
    return this;
  }
  // another soup, placed by m
  join(S, m = ID, name = null) {
    const base = this.n, cnt = S.n, flip = m.determinant() < 0, e = m.elements, ne = _nm.getNormalMatrix(m).elements; this.need(cnt, S.ni);
    const P = this.P, N = this.N; let ly = 1e9, lx = 0, lz = 0;
    for (let i = 0, q = base * 3; i < cnt * 3; i += 3, q += 3) {
      const x = S.P[i], y = S.P[i + 1], z = S.P[i + 2], nx = S.N[i], ny = S.N[i + 1], nz = S.N[i + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      P[q] = wx; P[q + 1] = wy; P[q + 2] = wz; if (wy < ly) { ly = wy; lx = wx; lz = wz; }
      const ax = ne[0] * nx + ne[3] * ny + ne[6] * nz, ay = ne[1] * nx + ne[4] * ny + ne[7] * nz, az = ne[2] * nx + ne[5] * ny + ne[8] * nz, l = 1 / (Math.hypot(ax, ay, az) || 1);
      N[q] = ax * l; N[q + 1] = ay * l; N[q + 2] = az * l;
    }
    this.C.set(S.C.subarray(0, cnt * 3), base * 3); this.L.set(S.L.subarray(0, cnt * 3), base * 3); this.Q.set(S.Q.subarray(0, cnt * 3), base * 3); this.A.set(S.A.subarray(0, cnt), base);
    const I = this.I; let k = this.ni;
    for (let j = 0; j < S.ni; j += 3) { I[k++] = base + S.I[j]; I[k++] = base + S.I[flip ? j + 2 : j + 1]; I[k++] = base + S.I[flip ? j + 1 : j + 2]; }
    this.n += cnt; this.ni = k;
    if (name) this.low.push({ name, x: lx, y: ly, z: lz });
    else for (const l of S.low) { _v.set(l.x, l.y, l.z).applyMatrix4(m); this.low.push({ name: l.name, x: _v.x, y: _v.y, z: _v.z }); }
    return this;
  }
  lowest(m = ID) { let ly = 1e9; const e = m.elements, P = this.P; for (let i = 0; i < this.n * 3; i += 3) { const y = e[1] * P[i] + e[5] * P[i + 1] + e[9] * P[i + 2] + e[13]; if (y < ly) ly = y; } return ly; }
  // the lowest point of everything added since vertex i0, recorded as the place where that part bears on the ground
  // let everything added since vertex i0 down until it bears on the ground (when it is within `most` of it)
  settle(i0, sink = 0.006, most = 0.04) { let ly = 1e9; for (let i = i0; i < this.n; i++) ly = Math.min(ly, this.P[i * 3 + 1]); const d = ly + sink; if (d > 0 && d < most) for (let i = i0; i < this.n; i++) this.P[i * 3 + 1] -= d; }
  lowOf(name, i0) { let ly = 1e9, k = -1; for (let i = i0; i < this.n; i++) if (this.P[i * 3 + 1] < ly) { ly = this.P[i * 3 + 1]; k = i; } if (k >= 0) this.low.push({ name, x: this.P[k * 3], y: ly, z: this.P[k * 3 + 2] }); }
  // A sheet of nu x nv points. fn(u, v, o, i, j) sets o.x/y/z, o.r/g/b, and may set o.m (metal), o.skip (a hole: no
  // face touches it), o.down (lying on the ground: a face wholly on the ground is not made), o.lr/lg/lb + o.px/py
  // (lining and pane co-ordinates). wrap joins the last column to the first. Normals are made to face out of a
  // tube ('out') or upward ('up').
  sheet(nu, nv, fn, { wrap = false, face = 'out', M = null, name = null, seam = false } = {}) {
    const o = {}, base = this.n, cnt = nu * nv, st = new Uint8Array(cnt); this.need(cnt, cnt * 6);
    const P = this.P, N = this.N, C = this.C, L = this.L, Q = this.Q; let ly = 1e9, lx = 0, lz = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      o.skip = false; o.down = false; o.m = 0; o.lr = o.lg = o.lb = 0; o.px = o.py = 0; o.pane = 0;
      fn(wrap ? i / nu : i / (nu - 1), nv > 1 ? j / (nv - 1) : 0, o, i, j);
      if (M) { _v.set(o.x, o.y, o.z).applyMatrix4(M); o.x = _v.x; o.y = _v.y; o.z = _v.z; }
      const k = j * nu + i, q = (base + k) * 3; st[k] = (o.skip ? 1 : 0) | (o.down ? 2 : 0);
      if (!o.skip && o.y < ly) { ly = o.y; lx = o.x; lz = o.z; }
      P[q] = o.x; P[q + 1] = o.y; P[q + 2] = o.z; N[q] = N[q + 1] = N[q + 2] = 0; C[q] = o.r; C[q + 1] = o.g; C[q + 2] = o.b; this.A[base + k] = o.m; L[q] = o.lr; L[q + 1] = o.lg; L[q + 2] = o.lb; Q[q] = o.px; Q[q + 1] = o.py; Q[q + 2] = o.pane;
    }
    const I = this.I, I0 = this.ni, ni = wrap ? nu : nu - 1; let k = I0;
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < ni; i++) {
      const a = j * nu + i, b = j * nu + (i + 1) % nu, c = a + nu, d = b + nu;
      if ((st[a] | st[b] | st[c] | st[d]) & 1) continue; if (st[a] & st[b] & st[c] & st[d] & 2) continue;
      I[k++] = base + a; I[k++] = base + c; I[k++] = base + b; I[k++] = base + b; I[k++] = base + c; I[k++] = base + d;
    }
    this.n += cnt; this.ni = k;
    for (let t = I0; t < k; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      N[a] += fx; N[a + 1] += fy; N[a + 2] += fz; N[b] += fx; N[b + 1] += fy; N[b + 2] += fz; N[c] += fx; N[c + 1] += fy; N[c + 2] += fz;
    }
    if (seam && !wrap) for (let j = 0; j < nv; j++) { const a = (base + j * nu) * 3, b = (base + j * nu + nu - 1) * 3; for (let q = 0; q < 3; q++) { const s = N[a + q] + N[b + q]; N[a + q] = s; N[b + q] = s; } }
    let sign = 0;
    for (let j = 0; j < nv; j++) {
      let cx = 0, cy = 0, cz = 0; for (let i = 0; i < nu; i++) { const q = (base + j * nu + i) * 3; cx += P[q]; cy += P[q + 1]; cz += P[q + 2]; } cx /= nu; cy /= nu; cz /= nu;
      for (let i = 0; i < nu; i++) { const q = (base + j * nu + i) * 3; sign += face === 'up' ? N[q + 1] : N[q] * (P[q] - cx) + N[q + 1] * (P[q + 1] - cy) + N[q + 2] * (P[q + 2] - cz); }
    }
    if (sign < 0) for (let t = I0; t < k; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
    const sg = sign < 0 ? -1 : 1;
    for (let q = base * 3; q < this.n * 3; q += 3) { const l = Math.hypot(N[q], N[q + 1], N[q + 2]); if (l > 0) { N[q] *= sg / l; N[q + 1] *= sg / l; N[q + 2] *= sg / l; } else N[q + 1] = 1; }
    if (name && ly < 1e8) this.low.push({ name, x: lx, y: ly, z: lz });
    return this;
  }
  // the earth takes whatever lies on it: everything near the ground goes the colour of the ground
  stain(top = 0.07, k = 0.8) {
    const C = this.C, L = this.L, P = this.P;
    for (let i = 0; i < this.n * 3; i += 3) {
      if (P[i + 1] > top) continue;
      const f = k * (1 - sstep(-0.01, top, P[i + 1])) * (0.75 + 0.25 * NZ.n2(P[i] * 9, P[i + 2] * 9));
      for (let q = 0; q < 3; q++) { C[i + q] = lerp(C[i + q], EARTH[q] * 0.8, f); L[i + q] = lerp(L[i + q], EARTH[q] * 0.8, f); }
    }
    return this;
  }
  mirror() {   // the same thing, left for right
    for (let i = 0; i < this.n * 3; i += 3) { this.P[i] = -this.P[i]; this.N[i] = -this.N[i]; }
    for (let t = 0; t < this.ni; t += 3) { const x = this.I[t + 1]; this.I[t + 1] = this.I[t + 2]; this.I[t + 2] = x; }
    for (const l of this.low) l.x = -l.x;
    return this;
  }
  geometry(panes = true) {
    const g = new THREE.BufferGeometry(), n = this.n, att = (a, k) => new THREE.BufferAttribute(a.slice(0, n * k), k);
    g.setAttribute('position', att(this.P, 3)); g.setAttribute('normal', att(this.N, 3)); g.setAttribute('color', att(this.C, 3)); g.setAttribute('aMetal', att(this.A, 1));
    if (panes) { g.setAttribute('aLin', att(this.L, 3)); g.setAttribute('aPane', att(this.Q, 3)); }
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)), 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}
// One material for all of it: the colour is in the vertices; iron is marked as metal; slashed cloth shows its
// lining between the panes; a fine grain all over; the inside of a sleeve or a helmet is dark.
const GROUND = { value: null }, GRID = { value: new THREE.Vector3(150, 300 / 256, 257) };   // the height field; (half-width, cell, samples a side)
export const GROUND_GLSL = `uniform highp sampler2D uGround; uniform vec3 uGrid;
float groundAt(vec2 p, out vec2 slope) {   // World.heightAt: the same samples, the same two triangles to a cell
  vec2 f = clamp((p + uGrid.x) / uGrid.y, 0.0, uGrid.z - 1.001), i = floor(f), u = f - i; ivec2 c = ivec2(i);
  float a = texelFetch(uGround, c, 0).r, b = texelFetch(uGround, c + ivec2(1, 0), 0).r, cc = texelFetch(uGround, c + ivec2(0, 1), 0).r, d = texelFetch(uGround, c + ivec2(1, 1), 0).r;
  if (u.x + u.y <= 1.0) { slope = vec2(b - a, cc - a) / uGrid.y; return a + (b - a) * u.x + (cc - a) * u.y; }
  slope = vec2(d - cc, d - b) / uGrid.y; return d + (cc - d) * (1.0 - u.x) + (b - d) * (1.0 - u.y);
}`;
// every vertex as far above the ground under it as it was above its model's floor (and the normal leant with the slope)
function conform(sh, normals) {
  sh.uniforms.uGround = GROUND; sh.uniforms.uGrid = GRID;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GROUND_GLSL)
    .replace('#include <project_vertex>', `vec4 gwp = vec4(transformed, 1.0); vec4 gorg = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
gwp = instanceMatrix * gwp; gorg = instanceMatrix * gorg;
#endif
gwp = modelMatrix * gwp; gorg = modelMatrix * gorg;
vec2 gsl; gwp.y += groundAt(gwp.xz, gsl) - gorg.y;
${normals ? 'vNormal = normalize(vNormal + mat3(viewMatrix) * vec3(-gsl.x, 0.0, -gsl.y) * dot(viewMatrix[1].xyz, vNormal));' : ''}
vec4 mvPosition = viewMatrix * gwp; gl_Position = projectionMatrix * mvPosition;`)
    .replace('#include <worldpos_vertex>', 'vec4 worldPosition = gwp;');
}
// One material for all of it: the colour is in the vertices; iron is marked as metal; slashed cloth shows its
// lining between the panes; a fine grain all over; the inside of a sleeve or a helmet is dark.
let MAT = null, DEPTH = null;
export function fallenMaterial() {
  if (MAT) return MAT;
  const m = MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    conform(sh, true);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aMetal; attribute vec3 aLin; attribute vec3 aPane; varying float vMetal; varying vec3 vLin; varying vec3 vPane; varying vec3 vOP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMetal = aMetal; vLin = aLin; vPane = aPane; vOP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vMetal; varying vec3 vLin; varying vec3 vPane; varying vec3 vOP;
float fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float fvn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fh(i), fh(i + vec3(1,0,0)), f.x), mix(fh(i + vec3(0,1,0)), fh(i + vec3(1,1,0)), f.x), f.y), mix(mix(fh(i + vec3(0,0,1)), fh(i + vec3(1,0,1)), f.x), mix(fh(i + vec3(0,1,1)), fh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fg1 = fvn(vOP * 70.0), fg2 = fvn(vOP * 330.0);
if (vPane.z > 0.5) {   // slashed cloth: panes with the lining pulled through the cuts between them, tied at intervals
  float pf = fract(vPane.x), py = fract(vPane.y), open = smoothstep(0.0, 0.14, py) * (1.0 - smoothstep(0.66, 0.8, py));
  float slit = smoothstep(0.64, 0.7, pf) * (1.0 - smoothstep(0.9, 0.96, pf)) * open;
  float edge = (smoothstep(0.54, 0.66, pf) * (1.0 - smoothstep(0.66, 0.74, pf)) + smoothstep(0.86, 0.96, pf)) * open;
  diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - 0.45 * edge), vLin * (0.75 + 0.25 * sin(pf * 9.0)), slit);
}
diffuseColor.rgb *= (0.8 + 0.3 * fg1 + 0.16 * (fg2 - 0.5)) * (0.78 + 0.4 * fvn(vOP * 11.0));
if (!gl_FrontFacing) diffuseColor.rgb *= 0.3;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5 + 0.35 * fg1, smoothstep(0.02, 0.4, vMetal));')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMetal * (0.75 + 0.25 * fg1);');
  };
  m.customProgramCacheKey = () => 'fallen4';
  DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  DEPTH.onBeforeCompile = (sh) => conform(sh, false); DEPTH.customProgramCacheKey = () => 'fallenDepth1';
  return m;
}
// The height field for the shader, and the same reading of it here (for the checks). The world's own grid is used
// when it is the grid expected (257 samples a side over 300 m); it is read back against World.heightAt either way.
function groundFor(world) {
  const N = 257, HALF = 150, CELL = (2 * HALF) / (N - 1);
  let H = world.H && world.H.length === N * N ? world.H : null;
  const read = (x, z) => { const fx = clamp((x + HALF) / CELL, 0, N - 1.001), fz = clamp((z + HALF) / CELL, 0, N - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1]; return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v); };
  const off = () => { let m = 0; for (let k = 0; k < 97; k++) { const x = ((k * 37.7) % 280) - 140, z = ((k * 91.3) % 280) - 140; m = Math.max(m, Math.abs(read(x, z) - world.heightAt(x, z))); } return m; };
  if (!H || off() > 1e-3) { H = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = world.heightAt(-HALF + i * CELL, -HALF + j * CELL); }
  const tex = new THREE.DataTexture(H, N, N, THREE.RedFormat, THREE.FloatType); tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  GROUND.value?.dispose?.(); GROUND.value = tex; GRID.value.set(HALF, CELL, N);
  return { read, off: off() };
}

// ---------------------------------------------------------------- what things are made of
function rust(x, y, z, o, k = 1) {   // iron left out for years: brown and orange scale, a little grey steel left
  const n = NZ.n2(x * 13 + 5, y * 13 + z * 11), n2 = NZ.n2(x * 47 + 9, z * 47 + y * 31), ru = clamp(0.62 + n * 0.5 + n2 * 0.3, 0, 1);
  const sc = Math.max(0, n2 - 0.35) * 0.5;   // flakes of brighter scale
  o.r = (lerp(0.085, 0.092, ru) + sc * 0.16) * k; o.g = (lerp(0.082, 0.044, ru) + sc * 0.06) * k; o.b = (lerp(0.08, 0.024, ru) + sc * 0.02) * k; o.m = 0.8 - ru * 0.62;
}
function wood(x, y, z, o, k = 1) {   // an ash shaft gone grey
  const n = NZ.n2(x * 3 + z * 40, y * 40 + z * 3), g = 0.8 + 0.25 * n; o.r = 0.115 * g * k; o.g = 0.092 * g * k; o.b = 0.066 * g * k; o.m = 0;
}
const leatherC = lin(0x2c2016);
function leather(x, y, z, o) { const g = 0.8 + 0.3 * NZ.n2(x * 25, z * 25 + y * 20); o.r = leatherC[0] * g; o.g = leatherC[1] * g; o.b = leatherC[2] * g; o.m = 0; }
// faded dyes: madder reds, weld yellow, woad blue, undyed linen and wool, black gone brown
const fade = (hex, k = 0.3) => { const c = lin(hex), g = (c[0] + c[1] + c[2]) / 3; return c.map((v, i) => lerp(lerp(v, g, k), EARTH[i] * 2.2, 0.22)); };
const DYES = [0x7a2c22, 0x8a3828, 0x9c7c3a, 0xa8925c, 0x3a4a5a, 0x4c5846, 0x2a2622, 0xa69c86, 0x8a826c, 0x6c5a40, 0x70402c, 0x8a6a3a].map((h) => fade(h));
const PALE = [0xa69c86, 0xb0a288, 0xa8925c, 0x9a8e7a, 0x8f3a2a].map((h) => fade(h, 0.2));
const LINEN = fade(0xaaa08a, 0.1);

// ---------------------------------------------------------------- cloth
// A garment lying over a limb or the trunk: rings round a path, each an ellipse (rw across; rf toward 'up', rb
// away from it), wrinkled, and pressed flat where it meets the ground. o.axes(t) gives the trunk's own left and
// front for a body that lies turned; otherwise 'up' is up. o.color(t, a, c) fills c with the cloth's colour and may
// set c.lin (a lining colour) and c.panes (how many slashed panes go round).
function drape(S, pts, o) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), ns = o.ns, ring = o.ring + 1, seed = o.seed || 0, wr = o.wr ?? 0.006, floor = o.floor ?? 0;
  const C = [], T = []; for (let j = 0; j < ns; j++) { const t = j / (ns - 1); C.push(curve.getPointAt(t)); T.push(curve.getTangentAt(t)); }
  const lat = V(), up = V(), col = [0, 0, 0];
  S.sheet(ring, ns, (u, t, q, i, j) => {
    const a = u * TAU, ca = Math.cos(a), sa = Math.sin(a), c = C[j], tg = T[j];
    if (o.axes) { const ax = o.axes(t); lat.copy(ax.l); up.copy(ax.f); } else { lat.set(tg.z, 0, -tg.x); if (lat.lengthSq() < 1e-6) lat.set(1, 0, 0); lat.normalize(); up.crossVectors(tg, lat); }
    const n1 = NZ.n2(seed + t * (o.fT || 6) + ca * 1.2, sa * 1.2 + t * 2.1), n2 = NZ.n2(seed * 1.7 + t * 21 + ca * 3.5, sa * 3.5 - t * 5);
    let w = n1 * 0.7 + (1 - 2.2 * Math.abs(n2)) * 0.75;   // soft swells, and sharp creases between them
    if (o.rings) w += 0.9 * Math.sin(t * o.rings * PI + n1 * 2.5);
    if (o.folds) w += 0.8 * Math.sin(a * o.folds + n1 * 3 + t * 3);
    const rw = o.rw(t, a), rv = sa > 0 ? o.rf(t, a) : (o.rb ? o.rb(t, a) : o.rf(t, a)), k = 1 + (w * wr) / Math.max(0.025, Math.min(rw, rv));
    q.x = c.x + (lat.x * ca * rw + up.x * sa * rv) * k; q.y = c.y + (lat.y * ca * rw + up.y * sa * rv) * k; q.z = c.z + (lat.z * ca * rw + up.z * sa * rv) * k;
    if (q.y < floor + 0.004) { q.y = floor - 0.008; q.down = true; }
    q.skip = o.hole ? o.hole(t, a, n1, n2) : false;
    col.lin = null; col.panes = 0; o.color(t, a, col, n1, n2);
    const big = NZ.n2(seed * 0.3 + q.x * 2.2, q.z * 2.2), d = (0.74 + 0.2 * n2 + 0.16 * big) * (1 + clamp(w * 0.55, -1, 1) * 0.3);
    q.r = col[0] * d; q.g = col[1] * d; q.b = col[2] * d; q.m = col.m || 0; col.m = 0;
    if (col.lin && col.panes) { q.lr = col.lin[0] * d * 0.8; q.lg = col.lin[1] * d * 0.8; q.lb = col.lin[2] * d * 0.8; q.px = u * col.panes; q.py = t * (col.ties || 3); q.pane = 1; }
  }, { wrap: false, seam: true, face: 'out', name: o.name });
}
// the earth risen round what lies on it, and dark under it. segs: [a, b, radius] of whatever lies there
function mound(S, segs, cell, grow = 1) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [a, b, r] of segs) for (const p of [a, b]) { x0 = Math.min(x0, p.x - r - 0.3); x1 = Math.max(x1, p.x + r + 0.3); z0 = Math.min(z0, p.z - r - 0.3); z1 = Math.max(z1, p.z + r + 0.3); }
  const nu = Math.max(3, Math.ceil((x1 - x0) / cell) + 1), nv = Math.max(3, Math.ceil((z1 - z0) / cell) + 1);
  const dist = (x, z) => { let m = 1e9; for (const [a, b, r] of segs) { const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9, h = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1), d = Math.hypot(x - a.x - dx * h, z - a.z - dz * h) - r; if (d < m) m = d; } return m; };
  S.sheet(nu, nv, (u, v, q) => {
    const x = lerp(x0, x1, u), z = lerp(z0, z1, v), n = NZ.n2(x * 3.1 + 7, z * 3.1), n2 = NZ.n2(x * 11, z * 11 + 3), d = dist(x, z) + n * 0.05;
    const k = 1 - sstep(-0.02, 0.2 * grow, d);
    q.x = x; q.z = z; q.y = -0.04 + (0.048 + 0.014 * n2) * k; q.skip = k < 0.2;   // it goes under the ground at its edge, and no further
    const g = (0.78 + 0.3 * n2) * (1 - 0.3 * sstep(0.12, -0.05, d));   // darker close under him, where it stays damp
    q.r = EARTH[0] * g; q.g = EARTH[1] * g; q.b = EARTH[2] * g;
  }, { face: 'up' });
}
// drop a thing placed by m until its lowest point is `sink` into the ground
function rest(thing, m, sink = 0.006) {
  let ly = 1e9;
  if (thing instanceof Soup) ly = thing.lowest(m);
  else { const p = thing.userData.pts || []; const e = m.elements; if (p.length) for (const q of p) ly = Math.min(ly, e[1] * q.x + e[5] * q.y + e[9] * q.z + e[13]); else { const P = thing.attributes.position; for (let i = 0; i < P.count; i++) ly = Math.min(ly, e[1] * P.getX(i) + e[5] * P.getY(i) + e[9] * P.getZ(i) + e[13]); } }
  m.elements[13] -= ly + sink; return m;
}
const basis = (x, y, z, o) => new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
// a bone whose own axis runs from (0, la, 0) to (0, lb, 0), laid from A to B with its front toward `hint`
function boneM(A, B, la, lb, hint, mirror = false) {
  const y = B.clone().sub(A).normalize(); if (lb < la) y.negate();
  const z = hint.clone().addScaledVector(y, -hint.dot(y)); if (z.lengthSq() < 1e-6) z.set(1, 0, 0).addScaledVector(y, -y.x); z.normalize();
  const x = V().crossVectors(y, z), m = new THREE.Matrix4().makeBasis(x, y, z); if (mirror) m.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
  return m.setPosition(A.clone().addScaledVector(y, -la));
}

// ---------------------------------------------------------------- harness and gear
// a sallet in the head's own frame (y through the crown, z the face): the skull of it low and round, cut off at the
// brow in front so the face is open, sweeping down into a tail behind
function sallet(S, M, lo) {
  S.sheet(lo ? 10 : 22, lo ? 5 : 9, (u, v, o) => {
    const az = u * TAU, sa = Math.sin(az), ca = Math.cos(az), back = Math.max(0, -ca);
    let x, y, z;
    if (v <= 0.6) { const e = (v / 0.6) * (PI / 2); x = 0.088 * Math.sin(e) * sa; z = (ca > 0 ? 0.108 : 0.118) * Math.sin(e) * ca; y = 0.092 * Math.cos(e) * (1 + 0.04 * Math.cos(e * 2)); }
    else { const w = (v - 0.6) / 0.4, fl = 1 + w * (0.05 + 0.1 * (1 - Math.abs(ca))) + w * w * 0.5 * back ** 3; x = 0.088 * sa * fl; z = (ca > 0 ? 0.108 : 0.118) * ca * (1 + w * (0.04 + 0.62 * back ** 4)); y = -w * (0.022 + 0.052 * back * back + 0.03 * (1 - Math.abs(ca))); }
    y += 0.007 * Math.exp(-((sa / 0.13) ** 2)) * (1 - v * 0.6); if (v > 0.93) { x *= 1.035; z *= 1.035; }   // a low comb over the crown, the rim turned out
    o.x = x; o.y = y + 0.036; o.z = z - 0.018; rust(x, y, z, o);
  }, { wrap: true, M });
}
// the Eisenhut, a kettle hat: a round skull and a broad brim sloping down all round. In the head's frame, or lying.
function kettle(S, M, lo) {
  const pr = [[0.001, 0.142], [0.05, 0.136], [0.092, 0.108], [0.112, 0.062], [0.117, 0.02], [0.125, 0.008], [0.185, -0.02], [0.214, -0.036], [0.21, -0.043]];
  S.sheet(lo ? 9 : 20, pr.length, (u, v, o, i, j) => { const a = u * TAU, [r, y] = pr[j], d = 1 + 0.03 * Math.sin(a * 3 + 1); o.x = Math.sin(a) * r * d; o.z = Math.cos(a) * r * 1.08 * d; o.y = y + 0.04 + (j > 5 ? 0.008 * Math.sin(a * 2 + 2) : 0); rust(o.x, y, o.z, o); }, { wrap: true, M });
}
// a munition breastplate, globose, with a low keel, rolled at the neck and flared at the waist (y up the body, z out
// of the chest; from the waist at 0 to the neck at 0.36)
function breast(S, M, lo, back = false) {
  S.sheet(lo ? 7 : 17, lo ? 5 : 11, (u, v, o) => {
    const a = (u - 0.5) * PI * (back ? 0.96 : 1.12), y = v * 0.36, sa = Math.sin(a), ca = Math.cos(a);
    const swell = Math.sin(clamp(v * 1.08, 0, 1) * PI) ** 0.75, arm = sstep(0.55, 1, v) * sstep(0.55, 1, Math.abs(u - 0.5) * 2);
    let rw = 0.156 + 0.028 * swell - 0.03 * v * v, rd = (back ? 0.085 : 0.105) + (back ? 0.02 : 0.062) * swell + (v < 0.08 ? (0.08 - v) * 0.35 : 0);
    rd += (back ? 0 : 0.012) * Math.exp(-((a / 0.16) ** 2)) * swell;
    o.x = sa * rw * (1 - arm * 0.3); o.z = ca * rd - 0.04; o.y = y - arm * 0.03 - (v > 0.9 ? (v - 0.9) * 0.25 * Math.max(0, ca) : 0);
    rust(o.x, o.y, o.z, o); o.skip = false;
  }, { M, face: 'out' });
}
// a blade lying along +z from the cross: flat diamond section. pts: [z, half-width]
function blade(S, pts, M, th = 0.16) {
  let g = loft(pts.map(([z]) => V(0, 0, z)), pts.map(([, w]) => w), 4, true); g.scale(1, th, 1); g = g.toNonIndexed(); g.computeVertexNormals();
  S.add(g, M, (x, y, z, o) => { rust(x, y * 6, z, o, 1.25); o.m = Math.min(0.85, o.m + 0.15); });
}
const rod = (S, a, b, ra, rb, M, col, n = 5, name = null) => S.add(loft([a, b], [ra, rb], n, true), M, col, 0, name);
// the katzbalger: a broad short blade, the guard an S bent round into a figure of eight, a grip flaring to its cap
function katzbalger(S, M, lo) {
  blade(S, [[0, 0.025], [0.5, 0.021], [0.6, 0.014], [0.64, 0.002]], M);
  if (!lo) { const pts = [], rr = []; for (let k = 0; k <= 16; k++) { const a = (k / 16) * TAU; pts.push(V(0.05 * Math.sin(a), 0.024 * Math.sin(2 * a), 0)); rr.push(0.0055); } S.add(loft(pts, rr, 4, false), M, rust); }
  else rod(S, V(-0.05, 0, 0), V(0.05, 0, 0), 0.008, 0.008, M, rust, 3);
  rod(S, V(0, 0, -0.008), V(0, 0, -0.1), 0.012, 0.014, M, leather, lo ? 3 : 6);
  const pm = loft([V(0, 0, -0.1), V(0, 0, -0.118), V(0, 0, -0.13)], [0.014, 0.027, 0.024], lo ? 4 : 7, true); pm.scale(1, 0.55, 1); pm.computeVertexNormals(); S.add(pm, M, rust);
}
// the two-hander of the double-pay men: long ricasso with its lugs, a wide cross, a long grip
function zweihander(S, M, lo) {
  blade(S, [[0, 0.021], [0.22, 0.02], [0.24, 0.03], [1.1, 0.022], [1.28, 0.002]], M, 0.14);
  for (const s of [-1, 1]) { rod(S, V(0, 0, 0.2), V(s * 0.07, 0, 0.17), 0.008, 0.003, M, rust, 3); rod(S, V(0, 0, 0), V(s * 0.2, 0, lo ? 0 : -0.012), 0.009, 0.006, M, rust, lo ? 3 : 5); }
  rod(S, V(0, 0, -0.005), V(0, 0, -0.38), 0.014, 0.012, M, leather, lo ? 3 : 6);
  if (!lo) S.add(loft([V(0, 0, -0.38), V(0, 0, -0.41), V(0, 0, -0.44)], [0.012, 0.026, 0.01], 6, true), M, rust);
}
// a halberd's head on the end of its shaft (shaft along +z, the head beyond z = L): a cleaver of an axe blade, a
// hook behind, a long four-sided spike
function halberd(S, M, lo, L = 2.0) {
  rod(S, V(0, 0, 0), V(0, 0, L + 0.1), 0.017, 0.015, M, wood, lo ? 3 : 6);
  const sh = new THREE.Shape(); sh.moveTo(0.012, 0); sh.lineTo(0.05, -0.03); sh.lineTo(0.2, -0.085); sh.quadraticCurveTo(0.165, 0.06, 0.2, 0.2); sh.lineTo(0.05, 0.13); sh.lineTo(0.012, 0.15); sh.lineTo(-0.012, 0.15); sh.lineTo(-0.05, 0.12); sh.lineTo(-0.15, 0.03); sh.lineTo(-0.135, 0.085); sh.lineTo(-0.05, 0.045); sh.lineTo(-0.012, 0.0);
  const eg = new THREE.ExtrudeGeometry(sh, { depth: 0.007, bevelEnabled: false, curveSegments: lo ? 2 : 5 }); eg.translate(0, 0, -0.0035); eg.rotateX(PI / 2); eg.translate(0, 0, L - 0.08);   // flat on the ground, the blade's edge toward +x
  S.add(eg, M, rust);
  const sp = loft([V(0, 0, L + 0.06), V(0, 0, L + 0.44)], [0.013, 0.001], 4, true); S.add(sp, M, rust);
  if (!lo) for (const s of [-1, 1]) S.add(new THREE.BoxGeometry(0.004, 0.02, 0.34).translate(s * 0.017, 0, L - 0.22), M, rust);   // the langets down the shaft
}
// a pike: a long ash shaft, a small leaf of a head. from, to: the stretch of it that is left (the whole is 4.7 m)
function pike(S, M, lo, from = 0, to = 4.7) {
  const r = (z) => 0.019 - 0.0014 * z;
  rod(S, V(0, 0, from), V(0, 0, Math.min(to, 4.45)), r(from), r(to), M, wood, lo ? 3 : 5);
  if (to > 4.45) { const g = loft([V(0, 0, 4.4), V(0, 0, 4.5), V(0, 0, 4.7)], [0.012, 0.024, 0.001], 4, true); g.scale(1, 0.4, 1); g.computeVertexNormals(); S.add(g, M, rust); }
  if (from > 0 && !lo) for (let k = 0; k < 3; k++) rod(S, V(0, 0, from + 0.01), V((k - 1) * 0.012, 0.004 * k, from - 0.05 - k * 0.03), 0.008, 0.001, M, wood, 3);   // the splintered break
}
// a matchlock arquebus on its side: the stock with its hooked butt, the barrel, the lock plate and the serpentine
function arquebus(S, M, lo) {
  const st = loft([V(0, 0, -0.32), V(0, 0.004, -0.22), V(0, 0.01, -0.02), V(0, 0.012, 0.25), V(0, 0.012, 0.62)], [0.03, 0.04, 0.03, 0.024, 0.018], lo ? 4 : 7, true); st.scale(0.62, 1, 1); st.computeVertexNormals();
  S.add(st, M, (x, y, z, o) => { wood(x, y, z, o, 0.8); });
  rod(S, V(0, 0.034, -0.03), V(0, 0.03, 0.82), 0.014, 0.011, M, rust, lo ? 4 : 7);
  if (!lo) { S.add(new THREE.BoxGeometry(0.006, 0.03, 0.14).translate(0.02, 0.012, 0.03), M, rust); rod(S, V(0.024, 0.02, 0.0), V(0.026, 0.07, 0.035), 0.004, 0.003, M, rust, 3); rod(S, V(0, -0.015, -0.02), V(0, -0.045, 0.02), 0.004, 0.004, M, rust, 3); }
}
// the Landsknecht's hat: a wide flat cap of felt, its brim slashed, rotted and trodden
function barett(S, M, lo, col, lining) {
  const pr = [[0.001, 0.05], [0.07, 0.058], [0.13, 0.05], [0.185, 0.03], [0.2, 0.014], [0.16, 0.004], [0.09, 0.002]];
  S.sheet(lo ? 8 : 18, pr.length, (u, v, o, i, j) => {
    const a = u * TAU, [r, y] = pr[j], n = NZ.n2(Math.cos(a) * 2 + 4, Math.sin(a) * 2 + j * 0.4), d = 1 + 0.14 * n;
    o.x = Math.sin(a) * r * d; o.z = Math.cos(a) * r * d * 0.92; o.y = y * (0.55 + 0.45 * NZ.n2(o.x * 6, o.z * 6 + 2)) + 0.004;
    const g = 0.75 + 0.25 * n; o.r = col[0] * g; o.g = col[1] * g; o.b = col[2] * g;
    if (j >= 2 && j <= 4) { o.lr = lining[0] * g; o.lg = lining[1] * g; o.lb = lining[2] * g; o.px = u * 9; o.py = 0.4; o.pane = 1; }
  }, { wrap: false, seam: true, M, face: 'up' });
}
// three crossbow bolts standing in the ground where they fell short
function bolts(S, M, lo, r) {
  for (let k = 0; k < 3; k++) {
    const a = k * 2.2 + r() * 0.8, d = 0.1 + r() * 0.3, p = V(Math.cos(a) * d, -0.06, Math.sin(a) * d), dir = V((r() - 0.5) * 0.9, 1, (r() - 0.5) * 0.9 - 0.4).normalize(), q = p.clone().addScaledVector(dir, 0.3 + r() * 0.1);
    rod(S, p, q, 0.006, 0.0055, M, wood, 3);
    if (!lo) for (const t of [0, 1]) { const side = V().crossVectors(dir, t ? Y : V(1, 0, 0)).normalize().multiplyScalar(0.014), g = new THREE.BufferGeometry(); const a0 = q.clone().addScaledVector(dir, -0.085), pts = [a0, q.clone().addScaledVector(dir, -0.01), q.clone().addScaledVector(dir, -0.02).add(side), a0.clone().addScaledVector(dir, 0.012).add(side)];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((v) => [v.x, v.y, v.z]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); S.add(g, M, [0.1, 0.08, 0.06]); }
  }
}
// a broad-toed shoe (the 'cow's mouth'), low cut, a strap over the instep: origin at the ankle, toe along +z, sole down
function shoe(S, M, lo, name) {
  const nu = lo ? 6 : 12;
  S.sheet(nu, 4, (u, v, o, i, j) => {
    const a = u * TAU, sa = Math.sin(a), ca = Math.cos(a), fw = Math.max(0, ca);   // ca = 1 at the toe
    const half = (ca > 0 ? 0.052 : 0.036) * (1 - 0.25 * Math.abs(ca) ** 6), len = ca > 0 ? 0.17 * (Math.abs(ca) ** 0.6) : -0.07 * Math.abs(ca) ** 0.8;
    const top = -0.068 + (ca > 0.3 ? 0.04 : ca < -0.5 ? 0.062 : 0.034);
    const k = j === 0 ? 0.25 : j === 3 ? (fw > 0.45 ? 0.05 : 0.72) : 1, y = j <= 1 ? -0.068 + (j ? 0.004 : 0) : j === 2 ? top : top + (fw > 0.45 ? 0.004 : -0.012);
    o.x = sa * half * k; o.z = len * (j === 3 && fw > 0.45 ? 0.6 : j === 0 ? 0.8 : 1); o.y = y; leather(o.x, o.y, o.z, o);
  }, { wrap: true, M, name });
}
// the company's flag where it went down: yellow, the ragged red cross of Burgundy across it, on its short staff
function flag(S, M, lo) {
  rod(S, V(-0.95, 0.02, -0.1), V(-0.8, 0.025, 2.2), 0.021, 0.017, M, wood, lo ? 3 : 6, 'staff');
  S.add(loft([V(-0.8, 0.025, 2.2), V(-0.79, 0.025, 2.28), V(-0.775, 0.025, 2.46)], [0.014, 0.026, 0.001], 4, true), M, rust);
  const red = lin(0x7a2a20), yel = lin(0xa98a3c);
  S.sheet(lo ? 9 : 30, lo ? 8 : 26, (u, v, o) => {
    const n = NZ.n2(u * 2.6 + 11, v * 2.6), n2 = NZ.n2(u * 8 + 3, v * 8 + 5), cr = NZ.n2(u * 4.5, v * 4.5 + 9);
    o.x = -0.86 + u * 1.55 * (0.86 + 0.1 * n) + 0.07 * v; o.z = 0.55 + v * 1.5 * (0.9 + 0.08 * n2) + 0.12 * Math.sin(u * 5);
    o.y = 0.001 + 0.085 * Math.max(0, cr + 0.25) * sstep(0, 0.2, u) + 0.024 * Math.abs(n2);
    const d1 = Math.abs(u - v), d2 = Math.abs(u + v - 1), knot = Math.max(0, Math.sin((u + v) * 26)) * 0.03 + Math.max(0, Math.sin((u - v) * 26)) * 0.03;
    const c = Math.min(d1, d2) < 0.07 + knot ? red : yel, g = (0.6 + 0.3 * n2) * (0.85 + 0.3 * cr);
    o.r = c[0] * g; o.g = c[1] * g; o.b = c[2] * g; o.skip = n + n2 * 0.5 > 0.95 || (u > 0.84 && n2 > 0.15 - (u - 0.84) * 2);
  }, { face: 'up', M, name: 'flag' });
}

// ---------------------------------------------------------------- the men
// How each lies. roll: 0 on his back, PI on his face, +-PI/2 on his side (pelvis and chest each their own, so a man
// can lie twisted). Limbs are given as directions on the ground for each bone (0 = toward his head, PI = toward his
// feet, + toward +x), and every joint comes to rest on the ground unless a height is given for it.
const POSES = [
  { n: 'sprawl', rollP: 0, rollC: 0.22, yawC: 0.12, head: [0.3, 1.2, 0.55], armL: [-1.9, -0.45], armR: [2.3, 2.85], legL: [PI + 0.34, PI + 0.2], legR: [PI - 1.0, PI + 0.85], hands: ['up', 'side'], feet: ['out', 'out'] },
  { n: 'twisted', rollP: 1.25, rollC: 0.3, yawC: -0.2, head: [-0.3, -0.5, 0.75], armL: [-1.35, -0.9], armR: [1.9, 1.15], legL: [PI - 1.3, PI + 0.3], legR: [PI - 0.9, PI + 0.6], hands: ['up', 'up'], feet: ['out', 'out'] },
  { n: 'reaching', rollP: PI, rollC: PI - 0.12, yawC: -0.14, head: [-0.2, PI - 0.85, 0.08], armL: [2.35, 0.95], armR: [-0.38, 0.12], legL: [PI - 0.16, PI - 0.1], legR: [PI + 0.75, PI - 0.5], hands: ['down', 'down'], feet: ['prone', 'out'] },
  { n: 'crawled', rollP: PI, rollC: PI + 0.25, yawC: 0.1, head: [0.28, PI + 0.75, 0.1], armL: [0.55, 0.5], armR: [-0.75, -0.1], legL: [PI - 1.3, PI + 0.45], legR: [PI + 0.2, PI + 0.14], hands: ['down', 'side'], feet: ['out', 'prone'] },
  { n: 'curled', rollP: PI / 2, rollC: 1.42, yawC: 0.5, head: [0.55, PI / 2 + 0.2, 0.3], armL: [2.25, 1.2], armR: [2.0, 0.55], legL: [PI - 1.0, PI + 0.75], legR: [PI - 1.25, PI + 0.9], hands: ['side', 'up'], feet: ['out', 'out'] },
  { n: 'fallen', rollP: -PI / 2, rollC: -1.2, yawC: -0.1, head: [-0.15, -PI / 2 - 0.2, 0.4], armL: [-0.3, 0.2], armR: [2.4, 2.9], legL: [PI + 0.1, PI - 0.2], legR: [PI + 0.8, PI - 0.3], hands: ['up', 'side'], feet: ['out', 'out'] },
  { n: 'dragged', rollP: 0.1, rollC: -0.08, yawC: 0.06, head: [0.1, 0.2, 0.8], armL: [-0.5, -0.15], armR: [0.36, 0.3], legL: [PI + 0.1, PI + 0.05], legR: [PI - 0.12, PI - 0.3], hands: ['up', 'up'], feet: ['up', 'out'] },
  { n: 'laid out', rollP: 0, rollC: 0, yawC: 0, head: [0.05, -0.2, 0.45], armL: [PI + 0.3, PI / 2 + 0.25], armR: [PI - 0.3, -PI / 2 + 0.3], legL: [PI + 0.12, PI + 0.1], legR: [PI - 0.1, PI - 0.12], hands: ['down', 'down'], feet: ['up', 'out'], hW: [0.125, 0.14] },
  { n: 'face down', rollP: PI, rollC: PI + 0.2, yawC: 0.2, head: [0.1, PI + 0.1, 0.05], armL: [2.6, 2.8], armR: [-1.7, -2.6], legL: [PI - 0.5, PI - 0.35], legR: [PI + 0.4, PI + 0.7], hands: ['up', 'down'], feet: ['prone', 'prone'] },
  { n: 'on his side', rollP: PI / 2, rollC: 1.85, yawC: 0.1, head: [0.2, 2.0, 0.2], armL: [1.3, 1.0], armR: [0.2, 0.0], legL: [PI - 0.6, PI + 0.3], legR: [PI - 0.05, PI], hands: ['down', 'up'], feet: ['out', 'out'] },
];
// what he has on, and how much of it is left. All from the seed.
function outfitFor(seed, pose, kind) {
  const r = rng(seed), pick = (a) => a[Math.floor(r() * a.length)];
  const cA = pick(DYES), cB = pick(DYES), cC = pick(DYES), cD = pick(DYES);
  const prone = Math.abs(pose.rollC) > 2.2;
  const O = { kind, body: [cA, r() < 0.45 ? cB : cA], lining: pick(PALE), rot: 0.25 + r() * 0.6,
    hose: [{ c: cC, lin: pick(PALE), panes: r() < 0.7 ? 9 : 0 }, { c: r() < 0.6 ? cB : cD, lin: pick(PALE), panes: r() < 0.6 ? 10 : 0 }],
    sleeve: [r() < 0.7 ? 'full' : r() < 0.6 ? 'half' : 'none', r() < 0.7 ? 'full' : r() < 0.6 ? 'half' : 'none'], leg: [r() < 0.6 ? 'full' : r() < 0.7 ? 'knee' : 'none', r() < 0.6 ? 'full' : r() < 0.7 ? 'knee' : 'none'],
    shoes: [r() < 0.75, r() < 0.75], plate: kind === 'doublet' && r() < 0.34, mail: kind === 'doublet' && r() < 0.22, hat: r() < 0.22 ? 'sallet' : null, skull: r() < 0.5 ? 0 : 1,
    jawOff: r() < 0.18, bone: ((u, v) => [lerp(0.5, 0.88, u), lerp(0.44, 0.82, u) * (0.96 + 0.08 * v), lerp(0.36, 0.72, u)])(r(), r()), open: !prone && r() < 0.55, sword: r() < 0.3, bolt: r() < 0.22, prone };
  if (kind === 'shirt') { O.body = [LINEN, LINEN]; O.leg = ['none', r() < 0.4 ? 'knee' : 'none']; O.sleeve = ['full', r() < 0.6 ? 'full' : 'half']; O.shoes = [false, r() < 0.3]; O.hat = null; }
  if (kind === 'bare' || kind === 'mummy') { O.sleeve = ['none', 'none']; O.leg = [r() < 0.4 ? 'knee' : 'none', r() < 0.5 ? 'full' : 'none']; O.hat = r() < 0.2 ? O.hat : null; O.shoes = [r() < 0.4, r() < 0.4]; }
  if (kind === 'mummy') { O.leg = ['none', 'none']; O.shoes = [false, false]; O.bone = [0.5, 0.4, 0.32]; }
  if (pose.n === 'dragged') O.hat = null;
  return O;
}
// lod: 0 to stand over, 1 from a few paces, 2 from across the field
function buildMan(spec, lod) {
  const lo = lod === 2, mid = lod === 1, N = (a, b) => (lo ? b : mid ? Math.max(b, Math.round(a * 0.62)) : a);
  const P = spec.pose, O = spec.outfit, S = new Soup(), B = boneLibrary(lo ? 'far' : mid ? 'lo' : 'mid'), BL = boneLibrary(lod ? 'far' : 'lo'), r = rng(spec.seed * 31 + 7), sd = spec.seed * 3.7, segs = [];
  const frame = (yaw, roll) => { const s = dirAz(yaw), side = V(Math.cos(yaw), 0, -Math.sin(yaw)), f = Y.clone().multiplyScalar(Math.cos(roll)).addScaledVector(side, Math.sin(roll)); return { s, f, l: V().crossVectors(s, f) }; };
  const sup = (a, b, roll) => Math.hypot(b * Math.cos(roll), a * Math.sin(roll));
  const FP = frame(0, P.rollP), FC = frame(P.yawC || 0, P.rollC), mummy = O.kind === 'mummy', bt = O.bone;
  const pc = V(0, sup(0.15, 0.078, P.rollP) - 0.012, 0);
  const cc = pc.clone().addScaledVector(FP.s, 0.16).addScaledVector(FC.s, 0.2); cc.y = sup(0.14, 0.094, P.rollC) - 0.012;
  const t1 = cc.clone().addScaledVector(FC.s, 0.135).addScaledVector(FC.f, -0.05);
  const blend = (t) => { const f = FP.f.clone().lerp(FC.f, t).normalize(), s = FP.s.clone().lerp(FC.s, t).normalize(); const l = V().crossVectors(s, f).normalize(); return { s, f: V().crossVectors(l, s).normalize(), l }; };
  const clothed = O.kind === 'doublet' || O.kind === 'shirt';
  const showRibs = !clothed || (O.open && !O.plate);

  // ---- the trunk's bones, where they show
  const iTrunk = S.n;
  if (showRibs && !(lod && clothed && !O.open)) S.add(B['cage' + O.skull], basis(FC.l, FC.s, FC.f, t1), bt);
  const hoseGone = O.leg[0] === 'none' && O.leg[1] === 'none';
  if (((hoseGone && O.kind !== 'shirt') || showRibs || !clothed) && !lod) S.add(B.pelvis, basis(FP.l, FP.s, FP.f, pc), bt);
  const sac = pc.clone().addScaledVector(FP.s, 0.085).addScaledVector(FP.f, -0.05), t12 = t1.clone().addScaledVector(FC.s, -0.262);
  if ((showRibs || !clothed) && !lo) for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5, F = blend(t), p = sac.clone().lerp(t12, t); p.y = Math.max(p.y - 0.01 * Math.sin(t * PI), 0.02); S.add(BL.vertebra, basis(F.l, F.s, F.f, p).scale(V(1.2, 1.25, 1.2)), bt); }
  if (!clothed && !lod) for (const k of [1, -1]) {
    const sh = t1.clone().addScaledVector(FC.s, -0.04).addScaledVector(FC.l, k * 0.17); sh.y = Math.max(sh.y, 0.05);
    S.add(B.clavicle, basis(FC.l.clone().multiplyScalar(k), FC.s, FC.f.clone().multiplyScalar(k), t1.clone().addScaledVector(FC.s, -0.025).addScaledVector(FC.f, 0.1).addScaledVector(FC.l, k * 0.012)), bt);
    S.add(B.scapula, basis(FC.l.clone().multiplyScalar(k), FC.s, FC.f.clone().multiplyScalar(k), sh.clone().addScaledVector(FC.f, -0.02)), bt);
  }

  S.lowOf('trunk bones', iTrunk);
  // ---- the head: skull, jaw hanging open or fallen away, a helmet still on some
  const [hAz, hRoll, jawA] = P.head, nb = t1.clone().addScaledVector(FC.s, 0.02), hd = dirAz((P.yawC || 0) + hAz), hside = V(hd.z, 0, -hd.x);
  const face = Y.clone().multiplyScalar(Math.cos(hRoll)).addScaledVector(hside, Math.sin(hRoll)), H = new Soup();
  const skinT = mummy ? [0.42, 0.33, 0.26] : bt;
  H.add(B['skull' + O.skull], ID, skinT);
  if (!O.jawOff) { const pv = V(0, -0.02, -0.006), jm = new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z).multiply(new THREE.Matrix4().makeRotationX(jawA)).multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z)); H.add(B['jaw' + O.skull], jm, skinT); }
  if (O.hat === 'sallet') sallet(H, ID, lo); else if (O.hat === 'kettle') kettle(H, new THREE.Matrix4().makeRotationX(-0.25).setPosition(0, -0.03, -0.02), lo);
  const hm = basis(V().crossVectors(hd, face), hd, face, V(nb.x + hd.x * 0.115, 0, nb.z + hd.z * 0.115)); rest(H, hm, 0.012);
  S.join(H, hm, 'head');
  const hp = V().setFromMatrixPosition(hm); segs.push([hp.clone().addScaledVector(hd, 0.04), hp.clone().addScaledVector(hd, 0.05), 0.09]);
  if (!lo) for (let i = 0; i < 6; i++) { const t = (i + 0.6) / 6.4, p = nb.clone().lerp(hp, t), up = FC.f.clone().lerp(face, t).normalize(), ax = hp.clone().sub(nb).normalize(); p.y = Math.max(p.y, 0.014); S.add(BL.vertebra, boneM(p, p.clone().add(ax), 0, 1, up).scale(V(0.82, 0.9, 0.82)), bt); }
  if (O.jawOff) { const a = r() * TAU, m = new THREE.Matrix4().makeRotationY(r() * TAU).setPosition(hp.x + Math.cos(a) * 0.22, 0, hp.z + Math.sin(a) * 0.22); S.add(B.jaw0, rest(B.jaw0, m, 0.008), bt); }

  // ---- limbs: where the joints come to rest
  const reach = (from, az, L, h) => { const dy = h - from.y, hz = Math.sqrt(Math.max(L * L - dy * dy, L * L * 0.16)); return V(from.x + Math.sin(az) * hz, h, from.z + Math.cos(az) * hz); };
  const limbs = [];
  [['L', 1, 0], ['R', -1, 1]].forEach(([nm, k, i]) => {
    const sh = t1.clone().addScaledVector(FC.s, -0.04).addScaledVector(FC.l, k * 0.175); sh.y = Math.max(sh.y, 0.055);
    const [a1, a2] = P['arm' + nm], E = reach(sh, a1, 0.29, P.hE?.[i] ?? 0.04), W = reach(E, a2, 0.25, P.hW?.[i] ?? 0.03);
    const hip = pc.clone().addScaledVector(FP.l, k * 0.09); hip.y = Math.max(hip.y, 0.06);
    const [b1, b2] = P['leg' + nm], K = reach(hip, b1, 0.44, P.hK?.[i] ?? 0.05), A = reach(K, b2, 0.37, P.hA?.[i] ?? 0.04);
    limbs.push({ k, i, sh, E, W, a2, hip, K, A, b2 });
  });
  const dry = lin(0x54402e);
  for (const L of limbs) {
    const { k, i, sh, E, W, hip, K, A } = L, mir = k < 0, iArm = S.n;
    // the arm
    const sl = clothed ? O.sleeve[i] : 'none', bareF = sl !== 'full', bareU = sl === 'none';
    if (bareU || (!lod && O.rot > 0.5)) S.add(BL.humerus, boneM(E, sh, 0.014, 0.3, FC.f, mir), bt);
    if (bareF) S.add(BL.forearm, boneM(W, E, 0, 0.25, Y, mir), bt);
    const hand = P.hands[i], hy = dirAz(L.a2 + (r() - 0.5) * 0.7), hz = hand === 'up' ? Y.clone() : hand === 'down' ? Y.clone().negate() : V(hy.z, 0, -hy.x).multiplyScalar(k);
    const hgeo = r() < 0.5 ? B.hand : B.hand1, hm = basis(V().crossVectors(hy, hz), hy, hz, V(W.x + hy.x * 0.02, W.y, W.z + hy.z * 0.02)); if (mir) hm.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
    if ((P.hW?.[i] ?? 0) < 0.06) rest(hgeo, hm, 0.005); else hm.elements[13] += 0.012;
    S.add(hgeo, hm, mummy ? [0.45, 0.36, 0.28] : bt);
    if (sl !== 'none') {
      const full = sl === 'full', c = O.body[i], pts = full ? [sh.clone().lerp(cc, 0.25), sh, E, W.clone().lerp(E, 0.08)] : [sh.clone().lerp(cc, 0.25), sh, E.clone().lerp(sh, 0.1)], tE = full ? 0.6 : 2;
      drape(S, pts, { ns: N(full ? 17 : 10, 5), ring: N(12, 6), seed: sd + i * 9, wr: 0.011, rings: full ? 7 : 4,
        rw: (t) => (t < tE ? 0.07 - 0.012 * t : 0.048 - 0.012 * (t - tE)) * (1 + 0.14 * Math.sin(t * 9 + sd)), rf: (t) => (t < tE ? 0.036 : 0.027) * (1 + 0.2 * Math.sin(t * 11 + sd)),
        hole: (t, a, n1, n2) => t > 0.93 + n2 * 0.1 || n1 + n2 * 0.25 > 1.1 - O.rot * 0.6,
        color: (t, a, col) => { col[0] = c[0]; col[1] = c[1]; col[2] = c[2]; if (O.kind === 'doublet' && t > 0.22 && t < tE) { col.lin = O.lining; col.panes = 9; col.ties = full ? 5 : 2.5; } } });
      segs.push([sh, E, 0.06]); if (full) segs.push([E, W, 0.04]);
    } else if (mummy) {
      drape(S, [sh, E, W], { ns: N(9, 4), ring: N(8, 5), seed: sd + i, wr: 0.003, rw: () => 0.026, rf: () => 0.024, hole: (t, a, n1, n2) => n1 + n2 > 0.9, color: (t, a, col) => { col[0] = dry[0]; col[1] = dry[1]; col[2] = dry[2]; } });
      segs.push([sh, E, 0.03], [E, W, 0.03]);
    } else segs.push([sh, E, 0.03], [E, W, 0.03]);
    S.settle(iArm); S.lowOf(k > 0 ? 'left arm' : 'right arm', iArm); const iLeg = S.n;
    // the leg
    const lg = O.leg[i], bareS = lg !== 'full', bareT = lg === 'none';
    if (bareT || (!lod && O.rot > 0.6)) S.add(BL.femur, boneM(K, hip, 0, 0.45, FP.f.clone().lerp(Y, 0.5), mir), bt);
    if (bareS) S.add(BL.shin, boneM(A, K, 0, 0.352, Y, mir), bt);
    if (lg !== 'none') {
      const full = lg === 'full', h = O.hose[i], pts = full ? [hip.clone().lerp(pc, 0.3), hip, K, A.clone().lerp(K, 0.06)] : [hip.clone().lerp(pc, 0.3), hip, K.clone().lerp(hip, 0.04)], tK = full ? 0.58 : 2;
      drape(S, pts, { ns: N(full ? 18 : 10, 5), ring: N(12, 6), seed: sd + 40 + i * 9, wr: 0.01, folds: 5,
        rw: (t) => (t < tK ? 0.098 - 0.03 * t / Math.min(tK, 1) : 0.056 - 0.03 * (t - tK)) * (1 + 0.1 * Math.sin(t * 8 + sd)), rf: (t) => (t < tK ? 0.05 - 0.016 * t : 0.034),
        hole: (t, a, n1, n2) => t > 0.94 + n2 * 0.08 || n1 + n2 * 0.25 > 1.12 - O.rot * 0.55,
        color: (t, a, col) => { col[0] = h.c[0]; col[1] = h.c[1]; col[2] = h.c[2]; if (h.panes && t > 0.2 && t < Math.min(tK, 0.9)) { col.lin = h.lin; col.panes = h.panes; col.ties = full ? 4 : 2; } } });
      segs.push([hip, K, 0.085]); if (full) segs.push([K, A, 0.05]);
    } else segs.push([hip, K, 0.035], [K, A, 0.03]);
    // the foot
    if (O.shoes[i]) {
      const mode = P.feet[i], o = k * (Math.abs(P.rollP) > 2 ? 1 : -1), az = L.b2;
      let z, y;
      if (mode === 'prone') { z = dirAz(az); y = Y.clone().negate(); }
      else if (mode === 'up') { z = dirAz(az + o * 0.5).multiplyScalar(0.5).addScaledVector(Y, 0.86).normalize(); y = dirAz(az + o * 0.5 + PI).multiplyScalar(0.86).addScaledVector(Y, 0.5).normalize(); }
      else { z = dirAz(az + o * 1.15); y = dirAz(az + o * 1.15 - o * PI / 2).multiplyScalar(0.94).addScaledVector(Y, 0.34).normalize(); z.addScaledVector(y, -z.dot(y)).normalize(); }
      const sm = basis(V().crossVectors(y, z), y, z, A.clone()); shoe(S, rest(shoeProbe(lo), sm, 0.012), lo);
      segs.push([A, A.clone().addScaledVector(z.clone().setY(0), 0.12), 0.05]);
    }
    S.settle(iLeg); S.lowOf(k > 0 ? 'left leg' : 'right leg', iLeg);
  }

  // ---- what is left of his clothes on the trunk
  if (clothed || mummy) {
    const shirt = O.kind === 'shirt', crotch = pc.clone().addScaledVector(FP.s, shirt ? -0.3 : -0.1); crotch.y = Math.max(0.04, crotch.y - 0.03);
    const waist = pc.clone().lerp(cc, 0.42).addScaledVector(blend(0.5).f, -0.03), neck = t1.clone().addScaledVector(FC.s, 0.03).addScaledVector(FC.f, 0.04);
    const pts = [crotch, pc, waist, cc.clone().addScaledVector(FC.s, -0.1), cc.clone().addScaledVector(FC.s, 0.03), cc.clone().addScaledVector(FC.s, 0.13), neck];
    // across, to the front, to the back, at stations up the trunk
    const prof = [[0, shirt ? 0.17 : 0.1, 0.04, 0.06], [0.16, 0.165, 0.076, 0.085], [0.36, 0.13, 0.012, 0.07], [0.52, 0.155, 0.08, 0.078], [0.7, 0.16, 0.1, 0.085], [0.88, 0.185, 0.06, 0.075], [1, 0.07, 0.045, 0.05]];
    const tab = (t, q) => { for (let i = 1; i < prof.length; i++) if (t <= prof[i][0]) { const a = prof[i - 1], b = prof[i], u = sstep(a[0], b[0], t); return lerp(a[q], b[q], u); } return prof[prof.length - 1][q]; };
    const shrink = mummy ? 0.86 : 1, tW = 0.34;
    drape(S, pts, { ns: N(24, 8), ring: N(22, 8), seed: sd + 77, wr: mummy ? 0.003 : 0.012, fT: 5, folds: mummy ? 0 : 3, name: 'trunk', axes: (t) => blend(sstep(0.2, 0.62, t)),
      rw: (t) => tab(t, 1) * shrink, rf: (t, a) => tab(t, 2) * shrink * (mummy ? 1 + 0.05 * Math.sin(t * 62) * sstep(0.45, 0.55, t) * (1 - sstep(0.85, 0.9, t)) : 1) + (t > 0.08 && t < 0.26 ? 0.022 * Math.exp(-(((Math.abs(Math.cos(a)) - 0.72) / 0.16) ** 2)) : 0), rb: (t) => tab(t, 3) * shrink,
      hole: (t, a, n1, n2) => {
        if (t > 0.985 || (shirt ? false : t < 0.02)) return false;
        if (mummy) return n1 * 0.8 + n2 * 0.6 > 0.62 || (t > 0.3 && t < 0.46 && Math.sin(a) > 0.2 && n1 > -0.3);
        if (O.plate && t > 0.4) return n1 + n2 * 0.6 > 1.3;
        const front = Math.sin(a) > 0.25 ? 1 : 0;
        if (O.open && front && t > 0.3 && t < 0.86 && Math.abs(Math.cos(a)) < 0.62 + n1 * 0.25) return true;   // rotted open down the front
        return n1 + n2 * 0.25 > 1.1 - O.rot * 0.6;
      },
      color: (t, a, col, n1) => {
        if (mummy) { col[0] = dry[0] * (0.8 + 0.3 * n1); col[1] = dry[1] * (0.8 + 0.25 * n1); col[2] = dry[2] * (0.8 + 0.2 * n1); return; }
        if (O.mail && t > 0.72) { const g = 0.75 + 0.5 * (((Math.floor(t * 90) + Math.floor(a * 14)) % 2)); col[0] = 0.075 * g; col[1] = 0.062 * g; col[2] = 0.05 * g; col.m = 0.55; return; }   // the bishop's mantle
        if (!shirt && Math.abs(t - tW) < 0.016) { col[0] = leatherC[0] * 0.8; col[1] = leatherC[1] * 0.8; col[2] = leatherC[2] * 0.8; return; }   // his belt
        if (!shirt && t < tW) { const h = O.hose[Math.cos(a) > 0 ? 0 : 1]; col[0] = h.c[0]; col[1] = h.c[1]; col[2] = h.c[2]; return; }
        const c = O.body[Math.cos(a) > 0 ? 0 : 1]; col[0] = c[0]; col[1] = c[1]; col[2] = c[2];
        if (!shirt && t > 0.42 && t < 0.84 && Math.sin(a) > 0.1) { col.lin = O.lining; col.panes = 22; col.ties = 9; }   // the breast slashed in rows
      } });
    if (O.plate) { const F = FC, org = cc.clone().addScaledVector(F.s, -0.2).addScaledVector(F.f, O.prone ? -0.012 : 0.012); breast(S, O.prone ? basis(F.l.clone().negate(), F.s, F.f.clone().negate(), org) : basis(F.l, F.s, F.f, org), lo, O.prone); }
  }
  segs.push([pc.clone().addScaledVector(FP.s, -0.06), cc.clone().addScaledVector(FC.s, 0.12), 0.15]);

  // ---- what killed him, and what he held
  if (O.bolt && !lo) { const p = cc.clone().addScaledVector(FC.l, (r() - 0.5) * 0.14).addScaledVector(FC.s, (r() - 0.5) * 0.16), d = V((r() - 0.5) * 0.8, 1, (r() - 0.5) * 0.8).normalize(); rod(S, p.clone().addScaledVector(d, -0.03), p.clone().addScaledVector(d, 0.3), 0.006, 0.0055, ID, wood, 4); }
  if (O.sword) { const L = limbs[1], az = L.a2 + 0.5 + r() * 0.8, m = new THREE.Matrix4().makeRotationY(az).multiply(new THREE.Matrix4().makeRotationX(0.035)).setPosition(L.W.x + Math.sin(az) * 0.12, 0, L.W.z + Math.cos(az) * 0.12); const K = new Soup(); katzbalger(K, ID, lo); S.join(K, rest(K, m, 0.006), 'sword'); segs.push([L.W, L.W.clone().add(dirAz(az).multiplyScalar(0.7)), 0.03]); }
  mound(S, segs, lo ? 0.2 : mid ? 0.13 : 0.075);
  S.stain(0.075, 0.8);
  return S;
}
let SHOE = null;
function shoeProbe(lo) { if (!SHOE) { SHOE = new Soup(); shoe(SHOE, ID, false); } return SHOE; }

// ---------------------------------------------------------------- the library: men, gear, loose bones
// Each model: hi (close by, instanced), lo (merged into its square of the field), pts (where it bears on the ground).
const KINDS = ['doublet', 'shirt', 'doublet', 'bare', 'doublet', 'doublet', 'shirt', 'doublet', 'mummy', 'doublet', 'doublet', 'bare', 'shirt', 'doublet', 'doublet', 'shirt', 'bare', 'doublet', 'doublet', 'mummy'];
let LIB = null;
function library() {
  if (LIB) return LIB;
  const L = { men: [], kit: {}, bones: {} }, t0 = performance.now();
  // (bounds are widened by what the ground may rise or fall across the model)
  const geo = (S, panes) => { const g = S.geometry(panes), b = g.boundingSphere; b.radius = b.radius * 1.5 + 0.1; return g; };
  const entry = (hi, lo, mid) => ({ hi: geo(hi, true), mid: mid ? geo(mid, true) : null, lo: lo ? lo.geometry(false) : null, pts: hi.low.map((p) => Object.assign(V(p.x, p.y, p.z), { name: p.name })), tris: [hi.tris, mid ? mid.tris : 0, lo ? lo.tris : 0] });
  // the men: each pose, and its mirror image, each in different clothes
  POSES.forEach((pose, i) => { for (const mir of [0, 1]) {
    const seed = 101 + i * 13 + mir * 57, spec = { pose, seed, outfit: outfitFor(seed, pose, KINDS[i * 2 + mir]) };
    const [hi, mid, lo] = [0, 1, 2].map((d) => buildMan(spec, d)); if (mir) { hi.mirror(); mid.mirror(); lo.mirror(); }
    const e = entry(hi, lo, mid); e.name = pose.n + (mir ? ' (mirrored)' : ''); e.man = true; e.outfit = spec.outfit.kind; L.men.push(e);
  } });
  const kit = (name, fn, sink = 0.008, tilt = null) => {
    const mk = (lo) => { const K = new Soup(); fn(K, lo); const m = tilt ? tilt.clone() : new THREE.Matrix4(); const S = new Soup(); S.join(K, rest(K, m, sink), K.low.length ? null : name); return S.stain(0.05, 0.7); };
    const hi = mk(false), e = entry(hi, mk(true));
    // long things bear on the ground along their length
    const bb = e.hi.boundingBox; if (bb.max.z - bb.min.z > 0.7 && bb.max.y < 0.2) { e.pts.push(V(0, 0, bb.min.z + 0.03), V(0, 0, bb.max.z - 0.03)); } if (bb.max.x - bb.min.x > 0.7 && bb.max.y < 0.2) e.pts.push(V(bb.min.x + 0.05, 0, (bb.min.z + bb.max.z) / 2), V(bb.max.x - 0.05, 0, (bb.min.z + bb.max.z) / 2));
    L.kit[name] = e; e.name = name;
  };
  const RX = (a) => new THREE.Matrix4().makeRotationX(a), RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
  kit('sallet', (S, lo) => sallet(S, ID, lo), 0.02, RZ(1.35).multiply(RX(0.3)));
  kit('sallet2', (S, lo) => sallet(S, ID, lo), 0.03, RX(2.7));
  kit('kettle', (S, lo) => kettle(S, ID, lo), 0.012, RX(0.12));
  kit('kettle2', (S, lo) => kettle(S, ID, lo), 0.03, RX(2.75).multiply(RZ(0.2)));
  kit('breast', (S, lo) => breast(S, ID, lo), 0.025, RX(-PI / 2 + 0.12));
  kit('breast2', (S, lo) => breast(S, ID, lo), 0.012, RX(PI / 2 - 0.1).multiply(RZ(0.3)));
  kit('katzbalger', (S, lo) => katzbalger(S, ID, lo), 0.006, RX(0.035));
  kit('zweihander', (S, lo) => zweihander(S, ID, lo), 0.004);
  kit('halberd', (S, lo) => halberd(S, ID, lo), 0.006);
  kit('pike', (S, lo) => pike(S, ID, lo), 0.008);
  kit('pikeHead', (S, lo) => pike(S, new THREE.Matrix4().makeTranslation(0, 0, -3.4), lo, 2.3, 4.7), 0.008);
  kit('pikeButt', (S, lo) => pike(S, new THREE.Matrix4().makeTranslation(0, 0, -0.9), lo, 0, 1.9), 0.008);
  kit('arquebus', (S, lo) => arquebus(S, ID, lo), 0.008, RZ(PI / 2));
  kit('barett', (S, lo) => barett(S, ID, lo, lin(0x3a2a22), lin(0x8a3a2a)), 0.004);
  kit('flag', (S, lo) => flag(S, ID, lo), 0);
  kit('bolts', (S, lo) => bolts(S, ID, lo, rng(77)), 0.06);
  kit('swordStuck', (S, lo) => zweihander(S, RX(-PI / 2 + 0.22).multiply(RZ(0.4)), lo), 0.36);
  kit('halberdStuck', (S, lo) => halberd(S, RX(PI / 2 + 0.2).multiply(RZ(0.5)), lo, 2.0), 0.3);
  kit('pikeStuck', (S, lo) => pike(S, RX(-PI / 2 + 0.45).multiply(RZ(1.0)), lo, 0, 2.6), 0.4);
  // loose bones, as the foxes left them
  const BM = boneLibrary('mid'), BLo = boneLibrary('lo'), BF = boneLibrary('far'), big = (key) => key.startsWith('skull') || key === 'pelvis' || key.startsWith('cage') || key.startsWith('jaw') || key.startsWith('hand');
  const bone = (name, key, m, sink = 0.012) => { const mk = (B) => new Soup().add(B[key], rest(B[key], m.clone(), sink), null, 0, name).stain(0.04, 0.75); L.bones[name] = entry(mk(big(key) ? BM : BLo), key.startsWith('skull') || key.startsWith('cage') ? mk(BF) : null); L.bones[name].name = name; };
  const E = (x, y, z) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
  bone('skullA', 'skull0', E(-0.3, 0, 0.15), 0.014); bone('skullB', 'skull1', E(0.1, 0, 1.45), 0.02); bone('skullC', 'skull0', E(PI - 0.4, 0, 0.3), 0.016); bone('skullD', 'skull1', E(-0.9, 0, -0.5), 0.03);
  bone('jaw', 'jaw1', E(0, 0, 0), 0.008); bone('femur', 'femur', E(PI / 2, 0, 0.1)); bone('shin', 'shin', E(PI / 2, 0, -0.2)); bone('humerus', 'humerus', E(PI / 2, 0, 0)); bone('forearm', 'forearm', E(PI / 2, 0, 0.4), 0.008);
  bone('pelvis', 'pelvis', E(-PI / 2 + 0.2, 0, 0.1), 0.02); bone('cage', 'cage0', E(-PI / 2, 0, 0.5), 0.03); bone('cage2', 'cage1', E(PI / 2 - 0.2, 0, 0), 0.02); bone('hand', 'hand1', E(-PI / 2, 0, 0), 0.004); bone('spine', 'vertebra', E(0.4, 0, 1.2), 0.006); bone('small', 'small', E(0, 0, 0), 0.004);
  L.ms = Math.round(performance.now() - t0);
  return (LIB = L);
}
export function fallenLibrary() { return library(); }   // for the dev scenes and checks

const _p = V();

// The random numbers the first version of this field drew from the world's own generator, drawn again in the same
// order and number, so that everything the world builds after the field (pikes, cannon, wagons, the churchyard)
// stands where it always stood. Returns the places where men fell.
function legacyStream(world, n, r) {
  const put = () => true, Q = () => 0, place = () => { r(); return {}; }, count = { shield: 0, rag: 0 }, spots = [];
  const skullGeo = () => (r() < 0.5 ? 'skull0' : 'skull1');
  const skull = (x, z, withJaw = r() < 0.75) => {
    const k = r(), yaw = r() * TAU;
    const q = k < 0.45 ? Q(-0.15 - r() * 0.3, yaw, (r() - 0.5) * 0.4) : k < 0.85 ? Q((r() - 0.5) * 0.4, yaw, (r() < 0.5 ? 1 : -1) * (1.3 + r() * 0.3)) : Q(Math.PI - 0.35, yaw, (r() - 0.5) * 0.5);
    put(skullGeo(), x, z, q, 0.01 + r() * 0.02);
    if (withJaw) { const a = r() * TAU, d = 0.15 + r() * 0.35; put('mandible', x + Math.cos(a) * d, z + Math.sin(a) * d, r() < 0.7 ? Q(0, r() * TAU, 0) : Q(Math.PI, r() * TAU, 0), 0.008); }
  };
  const longBone = (x, z) => { const g = ['femur', 'humerus', 'tibia'][Math.floor(r() * 3)]; put(g, x, z, Q(Math.PI / 2, r() * TAU, (r() - 0.5) * 0.3, 'YZX'), 0.012); };
  const skeleton = (x, z) => {
    const yaw = r() * TAU, roll = [0, 0, 1.25, -1.25, Math.PI][Math.floor(r() * 5)];
    const part = (geo, off, local, keep = 0.88, jit = 0.05) => { if (r() > keep) return; Q((r() - 0.5) * 0.25, (r() - 0.5) * 0.25, (r() - 0.5) * 0.25); return put(geo, x + (r() - 0.5) * jit, z + (r() - 0.5) * jit, 0, 0.015 + r() * 0.02); };
    Q((r() - 0.5) * 0.6, (r() - 0.5) * 1.2, (r() - 0.5) * 0.8);
    const sk = part(skullGeo(), 0, 0, 1, 0.08);
    if (sk && r() < 0.5) r(); else part('mandible', [(r() - 0.5) * 0.3, 0.6 + r() * 0.15, 0], Q(0, r() * TAU, 0), 0.8, 0.2);
    part(r() < 0.5 ? 'cage0' : 'cage1', 0, 0, 0.9, 0.04);
    for (let i = 0; i < 4; i++) part('vertebra', 0, 0, 0.8, 0.03);
    part('pelvis', 0, 0, 0.9, 0.04);
    for (let s = 0; s < 2; s++) { part('femur', 0, 0, 0.85); part('tibia', 0, 0, 0.8, 0.08); part('humerus', 0, 0, 0.8, 0.08); part('small', 0, 0, 0.6, 0.15); }
    void yaw; void roll;
  };
  const scattered = (x, z) => {
    skull(x + (r() - 0.5) * 0.6, z + (r() - 0.5) * 0.6);
    for (let b = 0; b < 1 + Math.floor(r() * 3); b++) longBone(x + (r() - 0.5) * 1.4, z + (r() - 0.5) * 1.4);
    if (r() < 0.25) put('pelvis', x + (r() - 0.5), z + (r() - 0.5), Q(r() < 0.5 ? -Math.PI / 2 : -0.3, r() * TAU, (r() - 0.5) * 0.5), 0.02);
    if (r() < 0.3) put(r() < 0.5 ? 'cage0' : 'cage1', x + (r() - 0.5), z + (r() - 0.5), Q(-Math.PI / 2, r() * TAU, (r() - 0.5) * 2.5), 0.03);
    else for (let i = 0; i < Math.floor(r() * 4); i++) put('rib', x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, Q((r() - 0.5) * 0.3, r() * TAU, r() < 0.5 ? 0 : Math.PI), 0.004);
    for (let i = 0; i < Math.floor(r() * 4); i++) put('vertebra', x + (r() - 0.5) * 1.2, z + (r() - 0.5) * 1.2, Q((r() - 0.5) * 3, r() * TAU, (r() - 0.5) * 3), 0.006);
    if (r() < 0.3) put('small', x + (r() - 0.5), z + (r() - 0.5), Q(0, r() * TAU, 0), 0.004);
  };
  world.scatter(n, (x, z) => world.okSpot(x, z, 2.5, 9), (x, z) => {
    spots.push({ x, z });
    const k = 1 + Math.floor(r() * 3);
    for (let m = 0; m < k; m++) {
      const cx = x + (r() - 0.5) * 3, cz = z + (r() - 0.5) * 3, at = (dx, dz) => place(cx + dx, cz + dz);
      const fate = r();
      if (fate < 0.17) skeleton(cx, cz); else if (fate < 0.58) scattered(cx, cz); else if (fate < 0.83) { skull(cx, cz); if (r() < 0.5) longBone(cx + (r() - 0.5), cz + (r() - 0.5)); }
      if (r() < 0.45) { at((r() - 0.5) * 0.8, (r() - 0.5) * 0.8); r(); count.rag++; }
      const kit = r();
      if (kit < 0.35) at((r() - 0.5) * 1.4, (r() - 0.5) * 1.4); else if (kit < 0.6) at((r() - 0.5) * 1.4, (r() - 0.5) * 1.4);
      if (r() < 0.3) at((r() - 0.5) * 1.2, (r() - 0.5) * 1.2);
      if (r() < 0.4) { at((r() - 0.5) * 1.6, (r() - 0.5) * 1.6); r(); count.shield++; }
      const w = r();
      if (w < 0.3) at((r() - 0.5) * 2, (r() - 0.5) * 2);
      else if (w < 0.45) { at((r() - 0.5) * 2, (r() - 0.5) * 2); r(); r(); }
      else if (w < 0.65) at((r() - 0.5) * 2, (r() - 0.5) * 2);
      if (r() < 0.3) at((r() - 0.5) * 2.5, (r() - 0.5) * 2.5);
    }
  }, 8);
  for (let i = 0; i < count.shield + count.rag; i++) r();   // each painted shield and tabard drew its shade
  return spots;
}

// ---------------------------------------------------------------- the field
export function buildFallen(world, n, r) {
  const spots = world.fallenSpots = legacyStream(world, n, r);
  const L = library(), mat = fallenMaterial(), q = rng(((world.ch?.seed || 1) * 7 + 911) >>> 0);
  const ground = groundFor(world), laid = [], stats = { men: 0, kit: 0, bones: 0, offGround: 0, steep: 0, blocked: 0, groups: {}, gridError: ground.off };
  const cols = world.colliders || [];
  // put one model down at (x, z), turned by yaw: not on the road or an altar, not on a steep bank, not inside a rock or a tree
  const put = (e, x, z, yaw, { clear = 1.2, steep = 0.8, room = 0.5 } = {}) => {
    if (!world.okSpot(x, z, clear, 5)) { stats.offGround++; return null; }
    const nr = world.normalAt(x, z), sl = Math.hypot(nr.x, nr.z); if (sl > steep * nr.y) { stats.steep++; return null; }
    for (const c of cols) if (Math.hypot(c.x - x, c.z - z) < c.r + room) { stats.blocked++; return null; }
    // on a slope its plan is drawn in along the fall of the ground, so that laid up the bank it is still its own length
    const m = new THREE.Matrix4().makeRotationY(yaw);
    if (sl > 0.02) { const gx = nr.x / sl, gz = nr.z / sl, k = 1 - nr.y, e2 = m.elements; for (const c of [0, 4, 8]) { const d = (e2[c] * gx + e2[c + 2] * gz) * k; e2[c] -= d * gx; e2[c + 2] -= d * gz; } }
    m.setPosition(x, world.heightAt(x, z), z); laid.push({ e, m });
    if (e.man) stats.men++; else if (L.bones[e.name] === e) stats.bones++; else stats.kit++;
    return m;
  };
  const recent = [];
  const man = (x, z, yaw, want = null) => {   // a man no neighbour of his looks like
    let e = null; for (let t = 0; t < 12; t++) { e = L.men[Math.floor(q() * L.men.length)]; if (want && !want(e)) continue; if (!recent.includes(e)) break; }
    recent.push(e); if (recent.length > 8) recent.shift();
    for (let t = 0; t < 4; t++) if (put(e, x + (t ? (q() - 0.5) * 1.2 : 0), z + (t ? (q() - 0.5) * 1.2 : 0), yaw + (t ? (q() - 0.5) : 0), { room: 0.8 })) return e;
    return null;
  };
  const kit = (name, x, z, yaw = q() * TAU, o) => put(L.kit[name], x, z, yaw, { clear: 0.8, room: 0.3, ...o });
  const bone = (name, x, z) => put(L.bones[name], x, z, q() * TAU, { clear: 0.5, room: 0.2 });
  const near = (x, z, d0, d1) => { const a = q() * TAU, d = d0 + q() * (d1 - d0); return [x + Math.cos(a) * d, z + Math.sin(a) * d]; };
  const pickK = (list) => list[Math.floor(q() * list.length)];
  const hisKit = (x, z) => {   // what a man dropped as he went down
    const k = q(); if (k < 0.24) kit(pickK(['katzbalger', 'katzbalger', 'zweihander']), ...near(x, z, 0.7, 1.3)); else if (k < 0.42) kit('halberd', ...near(x, z, 0.8, 1.4)); else if (k < 0.6) kit(pickK(['pikeHead', 'pikeButt']), ...near(x, z, 0.8, 1.6)); else if (k < 0.68) kit('arquebus', ...near(x, z, 0.7, 1.2));
    const h = q(); if (h < 0.16) kit(pickK(['sallet', 'sallet2']), ...near(x, z, 0.8, 1.4)); else if (h < 0.3) kit(pickK(['kettle', 'kettle2']), ...near(x, z, 0.8, 1.4)); else if (h < 0.42) kit('barett', ...near(x, z, 0.7, 1.3));
    if (q() < 0.1) kit(pickK(['breast', 'breast2']), ...near(x, z, 0.9, 1.5));
  };
  const scraps = (x, z, k = 1) => {   // what the foxes and crows carried off a little way
    const names = ['skullA', 'skullB', 'skullC', 'skullD', 'jaw', 'femur', 'shin', 'humerus', 'forearm', 'pelvis', 'cage', 'cage2', 'hand', 'spine', 'spine', 'small', 'femur', 'shin'];
    for (let i = 0; i < k; i++) bone(pickK(names), ...near(x, z, 0.3, 1.6));
  };
  const count = (g) => { stats.groups[g] = (stats.groups[g] || 0) + 1; };
  for (const sp of spots) {
    const { x, z } = sp, g = q(), yaw = q() * TAU;
    if (g < 0.4) {            // a man alone, his gear by him
      count('alone'); man(x, z, yaw); hisKit(x, z); if (q() < 0.3) scraps(x, z, 1 + Math.floor(q() * 2)); if (q() < 0.2) kit('bolts', ...near(x, z, 0.5, 2));
    } else if (g < 0.58) {    // two who went down together, head to foot
      count('pair'); const d = 0.85 + q() * 0.3, ox = Math.cos(yaw) * d, oz = -Math.sin(yaw) * d;
      man(x - ox, z - oz, yaw + (q() - 0.5) * 0.5); man(x + ox, z + oz, yaw + PI + (q() - 0.5) * 0.7); hisKit(x, z); if (q() < 0.5) hisKit(x, z);
    } else if (g < 0.7) {     // a rank of pikemen cut down where it stood, their pikes fallen forward
      count('rank'); const k = 4 + Math.floor(q() * 4), ax = Math.cos(yaw), az = -Math.sin(yaw);
      for (let i = 0; i < k; i++) {
        const t = (i - (k - 1) / 2) * (0.95 + q() * 0.15), px = x + ax * t + Math.sin(yaw) * (q() - 0.5) * 0.9, pz = z + az * t + Math.cos(yaw) * (q() - 0.5) * 0.9;
        if (!man(px, pz, yaw + (q() - 0.5) * 0.7 + (q() < 0.2 ? PI : 0))) continue;
        if (q() < 0.75) { const d = 2.4 + q() * 1.2, pa = yaw + PI + (q() - 0.5) * 0.5; kit(q() < 0.6 ? 'pike' : 'pikeHead', px + Math.sin(pa) * d + ax * 0.45, pz + Math.cos(pa) * d + az * 0.45, pa + PI + (q() - 0.5) * 0.12); }
      }
      if (q() < 0.5) kit('pikeStuck', ...near(x, z, 1, 2.5)); hisKit(x, z);
    } else if (g < 0.8) {     // the men who died round the flag
      count('flag'); kit('flag', x, z, yaw); const k = 3 + Math.floor(q() * 3), a0 = q() * TAU;
      for (let i = 0; i < k; i++) { const a = a0 + (i / k) * TAU + (q() - 0.5) * 0.5, d = 1.5 + q() * 0.7; man(x + Math.cos(a) * d, z + Math.sin(a) * d, q() < 0.5 ? Math.atan2(-Math.cos(a), -Math.sin(a)) + (q() - 0.5) * 0.8 : q() * TAU); }
      kit(pickK(['swordStuck', 'halberdStuck']), ...near(x, z, 0.8, 1.6)); hisKit(x, z); hisKit(x, z);
    } else if (g < 0.88) {    // one dragged out from among the others, by the heels
      count('dragged'); const e = man(x, z, yaw, (m) => m.name.startsWith('dragged')); const bx = x + Math.sin(yaw) * 3.4, bz = z + Math.cos(yaw) * 3.4;
      if (e) { man(bx + (q() - 0.5), bz + (q() - 0.5), q() * TAU); man(bx + (q() - 0.5) * 2.4, bz + (q() - 0.5) * 2.4, q() * TAU); scraps((x + bx) / 2, (z + bz) / 2, 2); }
    } else {                  // only what the scavengers left
      count('bones'); scraps(x, z, 3 + Math.floor(q() * 4)); hisKit(x, z); if (q() < 0.4) kit(pickK(['swordStuck', 'halberdStuck', 'pikeStuck']), ...near(x, z, 0.3, 1.2));
    }
  }
  // Squares of the field, each a level-of-detail switch: close by, the models themselves, instanced; further off one
  // merged mesh of their coarse copies; past the fog, nothing.
  const T = 28, tiles = new Map(), out = [];
  for (const it of laid) { _p.setFromMatrixPosition(it.m); const ix = Math.floor(_p.x / T), iz = Math.floor(_p.z / T), k = ix + ',' + iz; let t = tiles.get(k); if (!t) tiles.set(k, t = { cx: (ix + 0.5) * T, cz: (iz + 0.5) * T, by: new Map() }); let l = t.by.get(it.e); if (!l) t.by.set(it.e, l = []); l.push(it.m); }
  let trisHi = 0, trisMid = 0, trisLo = 0, calls = 0;
  for (const t of tiles.values()) {
    const lod = new THREE.LOD(), cy = world.heightAt(t.cx, t.cz); lod.position.set(t.cx, cy, t.cz); lod.userData.fallen = true;
    const off = new THREE.Matrix4().makeTranslation(-t.cx, -cy, -t.cz), near = new THREE.Group(), far = new Soup(), mm = new THREE.Matrix4();
    for (const [e, ms] of t.by) {
      if (e.man) for (const m of ms) {   // a man: the full model to stand over, a lighter one from a few paces
        const one = new THREE.LOD(); mm.multiplyMatrices(off, m); one.position.setFromMatrixPosition(mm); mm.premultiply(new THREE.Matrix4().makeTranslation(-one.position.x, -one.position.y, -one.position.z));
        [e.hi, e.mid].forEach((g, i) => { const me = new THREE.Mesh(g, mat); me.matrixAutoUpdate = false; me.matrix.copy(mm); me.castShadow = i === 0; me.receiveShadow = true; me.customDepthMaterial = DEPTH; one.addLevel(me, i ? 9 : 0, i ? 0.1 : 0); out.push(me); });
        near.add(one); trisHi += e.tris[0]; trisMid += e.tris[1]; calls++;
      } else {
        const im = new THREE.InstancedMesh(e.hi, mat, ms.length); ms.forEach((m, i) => im.setMatrixAt(i, mm.multiplyMatrices(off, m)));
        im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = DEPTH; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); near.add(im); out.push(im); trisHi += e.tris[0] * ms.length; trisMid += e.tris[0] * ms.length; calls++;
      }
      if (e.lo) for (const m of ms) { mm.multiplyMatrices(off, m); mm.elements[13] = 0; joinGeo(far, e.lo, mm); }   // heights above the ground stay heights above the ground
    }
    const lo = new THREE.Mesh(far.geometry(false), mat); lo.geometry.boundingSphere.radius += 9; lo.receiveShadow = true; lo.castShadow = false; out.push(lo); trisLo += far.tris;
    lod.addLevel(near, 0); lod.addLevel(lo, 32, 0.08); lod.addLevel(new THREE.Group(), 105, 0.05);
    world.group.add(lod);
  }
  stats.tiles = tiles.size; stats.trisHi = trisHi; stats.trisMid = trisMid; stats.trisLo = trisLo; stats.models = calls; stats.libraryMs = L.ms;
  world.fallenStats = stats; world.fallenLaid = laid; world.fallenGround = ground;
  return out;
}
// a geometry made by Soup.geometry(false), joined into a soup by m
function joinGeo(S, g, m) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, c = g.attributes.color.array, a = g.attributes.aMetal.array, ix = g.index.array, cnt = a.length, base = S.n; S.need(cnt, ix.length);
  const e = m.elements, ne = _nm.getNormalMatrix(m).elements, P = S.P, N = S.N;
  for (let i = 0, q = base * 3; i < cnt * 3; i += 3, q += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2], nx = n[i], ny = n[i + 1], nz = n[i + 2];
    P[q] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[q + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[q + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    N[q] = ne[0] * nx + ne[3] * ny + ne[6] * nz; N[q + 1] = ne[1] * nx + ne[4] * ny + ne[7] * nz; N[q + 2] = ne[2] * nx + ne[5] * ny + ne[8] * nz;
  }
  S.C.set(c, base * 3); S.A.set(a, base);
  for (let k = 0; k < ix.length; k++) S.I[S.ni + k] = base + ix[k];
  S.n += cnt; S.ni += ix.length;
}
// For a check (not used by the game). The shader stands every vertex on the ground under it, so two things are left
// to go wrong, and both are measured here: the height the shader reads against World.heightAt (gridError, over every
// vertex of every model laid), and the models themselves: how far the lowest point of each part of each (head,
// hands, feet, elbows, knees, trunk) stands above its floor (partFloat: none should), and how deep any goes.
export function checkFallen(world) {
  const G = world.fallenGround, res = { n: 0, men: 0, verts: 0, gridError: 0, partFloat: -1e9, partFloatAt: '', deepest: 0 };
  for (const { e, m } of world.fallenLaid || []) {
    const P = e.hi.attributes.position; res.n++; if (e.man) res.men++;
    for (let i = 0; i < P.count; i += 5) { _v.fromBufferAttribute(P, i); const ly = _v.y; _v.applyMatrix4(m); const d = Math.abs(G.read(_v.x, _v.z) - world.heightAt(_v.x, _v.z)); if (d > res.gridError) res.gridError = d; if (-ly > res.deepest) res.deepest = -ly; res.verts++; }
    for (const p of e.pts) if (p.y > res.partFloat) { res.partFloat = p.y; res.partFloatAt = e.name + ':' + p.name; }
  }
  return res;
}

// where the fallen knights of the Emperor's household lie, in full harness
export function fallenKnightSpots(world, n, r) {
  const spots = [];
  world.scatter(n, (x, z) => world.okSpot(x, z, 4, 12) && world.normalAt(x, z).y > 0.93 && spots.every((s) => Math.hypot(s.x - x, s.z - z) > 18), (x, z) => spots.push({ x, z, yaw: r() * TAU }), 20);
  return spots;
}
