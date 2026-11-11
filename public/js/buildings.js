// The buildings of the land in 1523: Franconian Fachwerk houses and barns, what the fire left of them, and the
// late-Gothic church of Saint Aldric. Everything here is plain geometry written straight into a few growing
// buffers, one per material (world.js gives them their materials and bakes them by quarter), so a house costs a
// handful of draw calls however many timbers it has. Nothing here draws from the world's shared random stream:
// each building has its own generator seeded from its lot, so the rest of the world never shifts.
import * as THREE from 'three';
import { rng, clamp, lerp, smooth } from './util.js';

const PI = Math.PI, TAU = PI * 2;
export const COURSE = 0.32;          // one course of the masonry texture (5 to its 1.6 m tile): walls break on these
const TT = 1.1;                      // timber texture tile, metres
const snapC = (y) => Math.max(COURSE, Math.round(y / COURSE) * COURSE);
export function lotSeed(lot, salt = 0) { return (Math.imul(Math.round(lot.x * 97) | 0, 73856093) ^ Math.imul(Math.round(lot.z * 89) | 0, 19349663) ^ Math.imul(salt + 11, 83492791)) >>> 0; }

// ---------------------------------------------------------------------------------------------- the kit
// Buffers by name; a matrix stack so a wall can be built in its own frame (u along it, y up, z out of its face).
// A vertex pushed without texture coordinates gets them at the end by box projection in metres (masonry, plaster);
// timbers and roofs carry their own so the grain runs along the beam and the courses along the eaves.
export class Kit {
  constructor() { this.b = Object.create(null); this.M = new THREE.Matrix4(); this._st = []; this._n = 0; }
  buf(k) { return this.b[k] || (this.b[k] = { p: [], n: [], u: [], i: [] }); }
  push(m) { this._st.push(this.M.clone()); this.M.multiply(m); return this; }
  pop() { this.M.copy(this._st.pop()); return this; }
  at(x, y, z, ry = 0) { const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(x, y, z); return this.push(m); }
  rot(x, y, z, rx, ry, rz) { const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)); m.setPosition(x, y, z); return this.push(m); }
  tris(k) { const B = this.b[k]; return B ? B.i.length / 3 : 0; }
  _v(B, P, nx, ny, nz, u, v) {
    const e = this.M.elements, x = P[0], y = P[1], z = P[2];
    B.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    B.n.push(e[0] * nx + e[4] * ny + e[8] * nz, e[1] * nx + e[5] * ny + e[9] * nz, e[2] * nx + e[6] * ny + e[10] * nz);
    B.u.push(u, v);
  }
  // a, b, c, d anticlockwise seen from outside; uv = [ua, va, ub, vb, uc, vc, ud, vd] or nothing (box projection later)
  quad(k, a, b, c, d, uv) {
    const B = this.buf(k), i0 = B.p.length / 3;
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2], fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (uv) { this._v(B, a, nx, ny, nz, uv[0], uv[1]); this._v(B, b, nx, ny, nz, uv[2], uv[3]); this._v(B, c, nx, ny, nz, uv[4], uv[5]); this._v(B, d, nx, ny, nz, uv[6], uv[7]); }
    else { this._v(B, a, nx, ny, nz, NaN, 0); this._v(B, b, nx, ny, nz, NaN, 0); this._v(B, c, nx, ny, nz, NaN, 0); this._v(B, d, nx, ny, nz, NaN, 0); }
    B.i.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  tri(k, a, b, c, uv) {
    const B = this.buf(k), i0 = B.p.length / 3;
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (uv) { this._v(B, a, nx, ny, nz, uv[0], uv[1]); this._v(B, b, nx, ny, nz, uv[2], uv[3]); this._v(B, c, nx, ny, nz, uv[4], uv[5]); }
    else { this._v(B, a, nx, ny, nz, NaN, 0); this._v(B, b, nx, ny, nz, NaN, 0); this._v(B, c, nx, ny, nz, NaN, 0); }
    B.i.push(i0, i0 + 1, i0 + 2);
  }
  triTo(k, a, b, c, hx, hy, hz) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    if ((ey * fz - ez * fy) * hx + (ez * fx - ex * fz) * hy + (ex * fy - ey * fx) * hz >= 0) this.tri(k, a, b, c); else this.tri(k, a, c, b);
  }
  // a quad either way up: turned so its face looks toward (hx, hy, hz)
  quadTo(k, a, b, c, d, hx, hy, hz, uv) {
    const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2], fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
    const s = (ey * fz - ez * fy) * hx + (ez * fx - ex * fz) * hy + (ex * fy - ey * fx) * hz;
    if (s >= 0) this.quad(k, a, b, c, d, uv); else this.quad(k, a, d, c, b, uv && [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]]);
  }
  // an axis-aligned box in the current frame. g = 'x' | 'y' | 'z': a timber, its grain along that axis.
  box(k, x0, y0, z0, x1, y1, z1, g) {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; } if (y1 < y0) { const t = y0; y0 = y1; y1 = t; } if (z1 < z0) { const t = z0; z0 = z1; z1 = t; }
    const F = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], 0],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 1], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 1],
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 2], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 2]];
    if (!g) { for (const f of F) this.quad(k, f[0], f[1], f[2], f[3]); return; }
    const ga = g === 'x' ? 0 : g === 'y' ? 1 : 2, uo = (this._n++ * 0.6180339) % 1;
    for (const f of F) {
      const fa = f[4], uv = [];
      for (let q = 0; q < 4; q++) { const P = f[q];
        if (fa === ga) { const a1 = (fa + 1) % 3, a2 = (fa + 2) % 3; uv.push(P[a1] / TT + uo, P[a2] / TT); }
        else { const o = 3 - fa - ga; uv.push(P[o] / TT + uo, P[ga] / TT); } }
      this.quad(k, f[0], f[1], f[2], f[3], uv);
    }
  }
  // a box of size (sx, sy, sz) about a point, turned (Euler) — loose things, hinges, fallen timbers
  obox(k, cx, cy, cz, sx, sy, sz, rx = 0, ry = 0, rz = 0, g) { this.rot(cx, cy, cz, rx, ry, rz); this.box(k, -sx / 2, -sy / 2, -sz / 2, sx / 2, sy / 2, sz / 2, g); this.pop(); }
  // a beam between two points, w wide (sideways) and t deep (the other way), its grain along it
  beam(k, a, b, w, t, roll = 0) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length(); if (L < 1e-4) return; d.multiplyScalar(1 / L);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
    this.push(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
    this.box(k, -w / 2, -L / 2, -t / 2, w / 2, L / 2, t / 2, 'y'); this.pop();
  }
  // a convex outline [[u, y]...] (anticlockwise seen from +z) pulled from z0 back... to z1 in front. grain = [gx, gy]
  // makes it a timber cut along that line. caps: 1 front, 2 back, 3 both.
  prism(k, poly, z0, z1, grain, caps = 3) {
    const n = poly.length; if (n < 3) return;
    let uvF = null, uo = 0, gx = 0, gy = 1;
    if (grain) { gx = grain[0]; gy = grain[1]; uo = (this._n++ * 0.6180339) % 1; uvF = (P) => [(-P[0] * gy + P[1] * gx) / TT + uo, (P[0] * gx + P[1] * gy) / TT]; }
    for (let i = 1; i < n - 1; i++) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      if (caps & 1) this.tri(k, [a[0], a[1], z1], [b[0], b[1], z1], [c[0], c[1], z1], uvF && [...uvF(a), ...uvF(b), ...uvF(c)]);
      if (caps & 2) this.tri(k, [a[0], a[1], z0], [c[0], c[1], z0], [b[0], b[1], z0], uvF && [...uvF(a), ...uvF(c), ...uvF(b)]);
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n]; if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-5) continue;
      let uv = null; if (grain) { const va = (a[0] * gx + a[1] * gy) / TT, vb = (b[0] * gx + b[1] * gy) / TT, al = Math.abs((b[0] - a[0]) * gx + (b[1] - a[1]) * gy), cr = Math.hypot(b[0] - a[0], b[1] - a[1]);
        uv = al > cr * 0.5 ? [z1 / TT + uo, va, z0 / TT + uo, va, z0 / TT + uo, vb, z1 / TT + uo, vb] : [(-a[0] * gy + a[1] * gx) / TT, z1 / TT, (-a[0] * gy + a[1] * gx) / TT, z0 / TT, (-b[0] * gy + b[1] * gx) / TT, z0 / TT, (-b[0] * gy + b[1] * gx) / TT, z1 / TT]; }
      this.quad(k, [a[0], a[1], z1], [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], uv);
    }
  }
  // a timber lying in the wall's plane from (u0, y0) to (u1, y1), wd wide, between depths z0 and z1; cut to `clip`
  // (a list of half-planes [a, b, c]: a u + b y <= c) so a brace meets its post and rail cleanly
  tim(k, u0, y0, u1, y1, wd, z0, z1, clip) {
    const dx = u1 - u0, dy = y1 - y0, L = Math.hypot(dx, dy); if (L < 1e-4) return;
    const gx = dx / L, gy = dy / L, px = -gy * wd / 2, py = gx * wd / 2, e = clip ? wd * 1.5 : 0;
    let poly = [[u0 - gx * e + px, y0 - gy * e + py], [u0 - gx * e - px, y0 - gy * e - py], [u1 + gx * e - px, y1 + gy * e - py], [u1 + gx * e + px, y1 + gy * e + py]];
    if (clip) for (const h of clip) { poly = clipHP(poly, h[0], h[1], h[2]); if (poly.length < 3) return; }
    this.prism(k, poly, z0, z1, [gx, gy]);
  }
  // a flat outline [[u, y]...] at depth z, facing +z (plaster is two-sided)
  face(k, poly, z, uvFn) { for (let i = 1; i < poly.length - 1; i++) { const a = poly[0], b = poly[i], c = poly[i + 1]; this.tri(k, [a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], uvFn && [...uvFn(a), ...uvFn(b), ...uvFn(c)]); } }
  // a moulding: the profile [[out, y]...] (bottom to top) carried along the path [[x, z]...] (anticlockwise seen
  // from above for an outside corner run), mitred at each corner
  mould(k, prof, path, closed = true, grain = false) {
    const n = path.length, ring = [];
    for (let i = 0; i < n; i++) {
      const a = path[(i - 1 + n) % n], b = path[i], c = path[(i + 1) % n];
      let n1 = norm2(b[1] - a[1], -(b[0] - a[0])), n2 = norm2(c[1] - b[1], -(c[0] - b[0]));
      if (!closed && i === 0) n1 = n2; if (!closed && i === n - 1) n2 = n1;
      const k2 = 1 + n1[0] * n2[0] + n1[1] * n2[1]; ring.push([(n1[0] + n2[0]) / Math.max(0.3, k2), (n1[1] + n2[1]) / Math.max(0.3, k2)]);
    }
    const uo = grain ? (this._n++ * 0.6180339) % 1 : 0;
    let run = 0;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n, A = path[i], Bp = path[j], ma = ring[i], mb = ring[j], len = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
      for (let q = 0; q < prof.length - 1; q++) {
        const p = prof[q], p2 = prof[q + 1];
        const a = [A[0] + ma[0] * p[0], p[1], A[1] + ma[1] * p[0]], b = [Bp[0] + mb[0] * p[0], p[1], Bp[1] + mb[1] * p[0]], c = [Bp[0] + mb[0] * p2[0], p2[1], Bp[1] + mb[1] * p2[0]], d = [A[0] + ma[0] * p2[0], p2[1], A[1] + ma[1] * p2[0]];
        const v0 = q * 0.13 + uo, v1 = v0 + Math.hypot(p2[0] - p[0], p2[1] - p[1]) / TT;
        this.quad(k, a, d, c, b, grain ? [v0, run / TT, v1, run / TT, v1, (run + len) / TT, v0, (run + len) / TT] : null);
      }
      if (!closed && (i === 0 || i === n - 2)) {   // close the cut ends
        const tx = (Bp[0] - A[0]) / (len || 1), tz = (Bp[1] - A[1]) / (len || 1);
        for (const [P, m, sg] of [[A, ma, -1], [Bp, mb, 1]]) { if ((P === A && i !== 0) || (P === Bp && i !== n - 2)) continue;
          const pts = prof.map((p) => [P[0] + m[0] * p[0], p[1], P[1] + m[1] * p[0]]); for (let q = 1; q < pts.length - 1; q++) this.triTo(k, pts[0], pts[q], pts[q + 1], tx * sg, 0, tz * sg); }
      }
      run += len;
    }
  }
  // a turned shape about the y axis through (cx, cz): profile [[r, y]...] bottom to top, smooth round
  lathe(k, prof, segs, cx, cy, cz) {
    const B = this.buf(k), i0 = B.p.length / 3, m = prof.length;
    for (let s = 0; s <= segs; s++) { const a = s / segs * TAU, c = Math.cos(a), sn = Math.sin(a);
      for (let j = 0; j < m; j++) { const p = prof[j], pa = prof[Math.max(0, j - 1)], pb = prof[Math.min(m - 1, j + 1)]; let tx = pb[0] - pa[0], ty = pb[1] - pa[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
        this._v(B, [cx + p[0] * c, cy + p[1], cz + p[0] * sn], ty * c, -tx, ty * sn, s / segs * 3, p[1]); } }
    for (let s = 0; s < segs; s++) for (let j = 0; j < m - 1; j++) { const a = i0 + s * m + j, b = a + m; B.i.push(a, a + 1, b + 1, a, b + 1, b); }
  }
  // the buffer as geometry; vertices without texture coordinates are box-projected at `tile` metres
  geometry(k, tile = 1) {
    const B = this.b[k]; if (!B || !B.i.length) return null;
    const P = B.p, N = B.n, U = B.u;
    for (let i = 0, n = P.length / 3; i < n; i++) if (U[i * 2] !== U[i * 2]) {
      const nx = Math.abs(N[i * 3]), ny = Math.abs(N[i * 3 + 1]), nz = Math.abs(N[i * 3 + 2]), x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (ny >= nx && ny >= nz) { U[i * 2] = x / tile; U[i * 2 + 1] = z / tile; } else if (nx >= nz) { U[i * 2] = z / tile; U[i * 2 + 1] = y / tile; } else { U[i * 2] = x / tile; U[i * 2 + 1] = y / tile; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(B.i); return g;
  }
}
function norm2(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
// keep the part of a convex outline where a x + b y <= c
export function clipHP(poly, a, b, c) {
  const out = [], n = poly.length;
  for (let i = 0; i < n; i++) {
    const P = poly[i], Q = poly[(i + 1) % n], dp = a * P[0] + b * P[1] - c, dq = a * Q[0] + b * Q[1] - c;
    if (dp <= 0) out.push(P);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
  }
  return out;
}
const rectClip = (u0, y0, u1, y1) => [[-1, 0, -u0], [1, 0, u1], [0, -1, -y0], [0, 1, y1]];

// ---------------------------------------------------------------------------------------------- masonry
// A run of wall in the wall's frame: from u0 to u1, standing on yb, T thick behind its face (z = 0). `top` is a
// height or a function of u; a function makes a broken wall, its top stepping down course by course. holes are
// [u0, u1, y0, y1] (y1 = Infinity: open to the sky).
export function wallRun(K, k, u0, u1, yb, top, T, holes = [], step = 0.4, zf = 0) {
  const cuts = new Set([u0, u1]);
  for (const h of holes) { if (h[0] > u0 && h[0] < u1) cuts.add(h[0]); if (h[1] > u0 && h[1] < u1) cuts.add(h[1]); }
  if (Array.isArray(step)) { for (const c of step) if (c > u0 + 1e-4 && c < u1 - 1e-4) cuts.add(c); }
  else if (typeof top === 'function') { const n = Math.max(1, Math.round((u1 - u0) / step)); for (let i = 1; i < n; i++) cuts.add(u0 + (u1 - u0) * i / n); }
  const us = [...cuts].sort((a, b) => a - b), cols = [];
  for (let i = 0; i < us.length - 1; i++) {
    const ua = us[i], ub = us[i + 1]; if (ub - ua < 0.02 && typeof top === 'function') { if (cols.length) cols[cols.length - 1].ub = ub; continue; }
    const um = (ua + ub) / 2, t = typeof top === 'function' ? top(um) : top;
    let iv = t > yb + 1e-3 ? [[yb, t]] : [];
    for (const h of holes) if (h[0] < um && h[1] > um) { const nx = []; for (const [a, b] of iv) { if (h[3] <= a || h[2] >= b) { nx.push([a, b]); continue; } if (h[2] > a + 1e-3) nx.push([a, h[2]]); if (h[3] < b - 1e-3) nx.push([h[3], b]); } iv = nx; }
    const sig = iv.map((q) => q[0].toFixed(3) + ':' + q[1].toFixed(3)).join('|'), last = cols[cols.length - 1];
    if (last && last.sig === sig && Math.abs(last.ub - ua) < 1e-6) last.ub = ub; else cols.push({ ua, ub, iv, sig });
  }
  for (const c of cols) for (const [a, b] of c.iv) K.box(k, c.ua, a, zf - T, c.ub, b, zf);
  return cols;
}

// The outline of a pointed opening, from its foot on the left, up the jamb, over the two-centred arch and down:
// hw half its width, yb its foot, ys the springing; k = radius / width (0.5 round, 1 equilateral)
export function archLoop(hw, yb, ys, k = 1, segs = 6, uc = 0) {
  const R = 2 * hw * k, cx = -hw + R, f0 = Math.acos(clamp((0 - cx) / R, -1, 1)), pts = [[uc - hw, yb]];
  const half = []; for (let i = 0; i <= segs; i++) { const f = PI + (f0 - PI) * (i / segs); half.push([cx + R * Math.cos(f), ys + R * Math.sin(f)]); }
  for (const p of half) pts.push([uc + p[0], p[1]]);
  for (let i = segs - 1; i >= 0; i--) pts.push([uc - half[i][0], half[i][1]]);
  pts.push([uc + hw, yb]); return pts;
}
export const archApex = (hw, ys, k = 1) => { const R = 2 * hw * k, cx = -hw + R; return ys + Math.sqrt(Math.max(0, R * R - cx * cx)); };

// A pointed opening through a wall T thick, cut out of the block [uc - bw, uc + bw] x [y0, y1] of its face.
// `loops` are its outline at successive depths, outside to inside: { z, hw, yb, ys } — a splayed window is three of
// them, a portal's orders are steps of them. Draws the wall's two faces round the opening and the reveals between
// the outlines. Returns the outlines.
export function archOpening(K, k, o) {
  const { uc = 0, bw, y0, y1, T, loops, kk = 1, segs = 6, back = true } = o;
  const L = loops.map((l) => archLoop(l.hw, l.yb, l.ys, l.k ?? kk, segs, uc)), n = L[0].length, mid = (n - 1) / 2;
  const faceOf = (lp, z, front) => {
    // left half then right half: each outline point is joined level to the block's edge; above the apex and below the sill plain stone
    const apex = lp[Math.floor(mid)][1] > lp[Math.ceil(mid)][1] ? lp[Math.floor(mid)] : lp[Math.ceil(mid)];
    const q = (a, b, c, d) => front ? K.quad(k, [a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [d[0], d[1], z]) : K.quad(k, [a[0], a[1], z], [d[0], d[1], z], [c[0], c[1], z], [b[0], b[1], z]);
    for (let i = 0; i < n - 1; i++) {
      const a = lp[i], b = lp[i + 1], left = (i + 0.5) < mid, e = left ? uc - bw : uc + bw;
      if (Math.abs(a[1] - b[1]) < 1e-5) continue;
      if (left) q([e, a[1]], a, b, [e, b[1]]); else q(b, [e, b[1]], [e, a[1]], a);
    }
    if (y1 > apex[1] + 1e-3) q([uc - bw, apex[1]], [uc + bw, apex[1]], [uc + bw, y1], [uc - bw, y1]);
    const yl = lp[0][1]; if (yl > y0 + 1e-3) q([uc - bw, y0], [uc + bw, y0], [uc + bw, yl], [uc - bw, yl]);
  };
  faceOf(L[0], loops[0].z, true);
  if (back) faceOf(L[L.length - 1], -T, false);
  const all = L.map((lp, i) => ({ lp, z: loops[i].z })); if (back && loops[loops.length - 1].z > -T + 1e-3) all.push({ lp: L[L.length - 1], z: -T });
  for (let j = 0; j < all.length - 1; j++) {
    const A = all[j], B = all[j + 1];
    for (let i = 0; i < n - 1; i++) K.quad(k, [A.lp[i][0], A.lp[i][1], A.z], [B.lp[i][0], B.lp[i][1], B.z], [B.lp[i + 1][0], B.lp[i + 1][1], B.z], [A.lp[i + 1][0], A.lp[i + 1][1], A.z]);
    // the sill (or the threshold): between the two feet
    const a = A.lp[0], b = A.lp[n - 1], c = B.lp[n - 1], d = B.lp[0];
    if (!o.open) K.quad(k, [a[0], a[1], A.z], [b[0], b[1], A.z], [c[0], c[1], B.z], [d[0], d[1], B.z]);
  }
  return L;
}

// ---------------------------------------------------------------------------------------------- houses
// One house, barn or burnt wreck in its own frame: x along the street front, +z toward the road, y = 0 its floor.
// `plan` is what the world's own random stream decided for it (standing or burnt, the roofing, where each wall
// broke, the debris): the same decisions the village has always been made from. Everything new — the frame, the
// windows, which way the ridge runs — comes from q, the lot's own generator.
export function buildHouse(K, o) {
  const { w, d, big, plan, q, gH, village, footing } = o, intact = plan.intact, kind = plan.roofKind;
  const GF = 2.56, WT = 0.5, OF = 0.26, SILL = 0.2, PLATE = 0.18, PW = 0.17, FD = 0.2, PL = 0.64, RW = 0.16;
  const TIM = 'timber', BRD = intact ? 'board' : 'timber', ROOF = kind === 'thatch' ? 'thatch' : 'roof';
  const sr = q(), style = big ? 'barn' : !intact ? 'wreck' : sr < 0.42 ? 'stock' : sr < 0.8 ? 'fach' : 'kate';
  const gableFront = !big && q() < (village ? 0.55 : 0.3);
  const pitch = (big ? q.range(47, 50) : style === 'kate' ? q.range(53, 57) : q.range(50, 55)) * PI / 180, tanP = Math.tan(pitch), cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const jf = (style === 'stock' || style === 'fach') ? q.range(0.3, 0.4) : 0;
  const f0 = style === 'stock' || style === 'wreck' ? 0 : -0.04;      // the frame's face, in from the plinth's
  const info = { style, gableFront, colliders: [], tops: null };
  const pick = (arr) => arr[Math.floor(q() * arr.length) % arr.length];

  // ---- the four walls, in order round the house (front, right, back, left): each wall's right end meets the next
  const mk = (L, flip, len, rot, cx, cz) => {
    const segs = L.segs.map((s) => ({ ...s, u: flip ? -s.lx : s.lx })); if (flip) segs.reverse();
    const W = { L, flip, len, rot, cx, cz, sw: L.sw, n: segs.length, segs, half: len / 2 + OF, posts: [] };
    for (let k = 1; k < W.n; k++) W.posts.push(-len / 2 + k * L.sw);
    W.door = segs.find((s) => s.isDoor) || null;
    const nc = Math.max(2, Math.round(2 * W.half / 0.4)); W.cs = 2 * W.half / nc; W.cuts = []; for (let i = 1; i < nc; i++) W.cuts.push(-W.half + i * W.cs);
    return W;
  };
  const LW = plan.walls;
  const Ws = [mk(LW[0], false, w, 0, 0, d / 2 + OF), mk(LW[2], false, d, PI / 2, w / 2 + OF, 0), mk(LW[1], true, w, PI, 0, -(d / 2 + OF)), mk(LW[3], true, d, -PI / 2, -(w / 2 + OF), 0)];
  const inW = (i, fn) => { const W = Ws[i]; K.at(W.cx, 0, W.cz, W.rot); fn(W, i); K.pop(); };
  const toH = (i, u, z) => { const W = Ws[i], c = Math.cos(W.rot), s = Math.sin(W.rot); return [W.cx + u * c + z * s, W.cz - u * s + z * c]; };   // wall frame -> house frame
  { const cT = plan.corners.map(snapC), [bl, br, fl, fr] = cT; Ws[0].cL = fl; Ws[0].cR = fr; Ws[1].cL = fr; Ws[1].cR = br; Ws[2].cL = br; Ws[2].cR = bl; Ws[3].cL = bl; Ws[3].cR = fl; }
  for (const W of Ws) {
    const S = W.segs, n = W.n;
    W.raw = (u) => {
      const f = (u + W.len / 2) / W.sw - 0.5, i = clamp(Math.floor(f), 0, n - 1), j = Math.min(n - 1, i + 1);
      const h = lerp(S[i].top, S[j].top, clamp(f - i, 0, 1)), dl = u + W.half, dr = W.half - u;
      return Math.max(h, W.cL - Math.max(0, dl - 0.45) * 1.5, W.cR - Math.max(0, dr - 0.45) * 1.5);
    };
    W.top = intact ? () => GF : (u) => { const c = clamp(Math.floor((u + W.half) / W.cs), 0, Math.round(2 * W.half / W.cs) - 1); return snapC(W.raw(-W.half + (c + 0.5) * W.cs)); };
  }
  info.tops = Ws.map((W) => W.top); info.walls = Ws;

  // a loose thing set down where it lies: turned, then lowered until its lowest corner is `sink` into what is under it
  const rest = (k, x, z, sx, sy, sz, rx, ry, rz, base, sink = 0.02, g) => {
    const e = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).elements;
    K.obox(k, x, base + (Math.abs(e[1]) * sx + Math.abs(e[5]) * sy + Math.abs(e[9]) * sz) / 2 - sink, z, sx, sy, sz, rx, ry, rz, g);
  };
  const ring = (cx, cy, cz, R, r2) => { K.rot(cx, cy, cz, PI / 2, 0, 0); const pr = []; for (let i = 0; i <= 5; i++) { const a = i / 5 * TAU; pr.push([R + Math.cos(a) * r2, Math.sin(a) * r2]); } K.lathe('iron', pr, 8, 0, 0, 0); K.pop(); };

  // the footing: takes up the slope under the house, its top the floor
  K.box('stone', -(w / 2 + 0.35), -footing, -(d / 2 + 0.35), w / 2 + 0.35, 0, d / 2 + 0.35);

  // ---- a door leaf of oak boards on strap hinges, hung at (hx, y0, zf) in the wall's frame; ang > 0 swings it in
  const doorLeaf = (hx, y0, zf, wd, ht, ang, left = true, tilt = 0, o2 = {}) => {
    K.rot(hx, y0, zf, 0, left ? ang : PI - ang, tilt);
    const nb = Math.max(2, Math.round(wd / 0.21)), bw = wd / nb, zs = left ? -1 : 1;
    for (let i = 0; i < nb; i++) { const v = (i % 2) * 0.007; K.box(BRD, i * bw, 0, zs * (0.045 + v), (i + 1) * bw, ht, zs * v, 'y'); }
    const hy = ht > 2.4 ? [0.14, 0.5, 0.86] : [0.2, 0.8];
    const so = o2.brace ? 0.03 : 0;
    for (const f of hy) { K.box('iron', 0, ht * f - 0.024, left ? so : -0.014 - so, wd * 0.62, ht * f + 0.024, left ? 0.014 + so : -so); K.box('iron', -0.03, ht * f - 0.05, left ? -0.03 : -0.02 - so, 0.03, ht * f + 0.05, left ? 0.02 + so : 0.03); }
    if (o2.brace) {   // a barn door: ledges and braces on its face
      const zz = left ? [0, 0.03] : [-0.03, 0];
      for (const f of [0.14, 0.5, 0.86]) K.box(BRD, 0.02, ht * f - 0.07, zz[0], wd - 0.02, ht * f + 0.07, zz[1], 'x');
      for (const [fa, fb] of [[0.14, 0.5], [0.5, 0.86]]) K.tim(BRD, 0.06, ht * fa + 0.07, wd - 0.06, ht * fb - 0.07, 0.12, zz[0], zz[1] - 0.002, rectClip(0.02, ht * fa + 0.07, wd - 0.02, ht * fb - 0.07));
    } else if (intact) { const rx2 = wd - 0.13, ry2 = ht * 0.5; K.box('iron', rx2 - 0.035, ry2 - 0.06, left ? 0 : -0.012, rx2 + 0.035, ry2 + 0.08, left ? 0.012 : 0); ring(rx2, ry2 - 0.03, left ? 0.03 : -0.03, 0.05, 0.009); }
    K.pop();
  };
  // ---- a window between a0 and a1, c0 to c1, its glass at depth zg behind the wall's face (z = 0 here)
  const shutState = () => { const f = q(); return f < 0.3 ? 'closed' : f < 0.68 ? 'open' : f < 0.78 ? 'ajar' : f < 0.88 ? 'hang' : 'none'; };
  const winUnit = (a0, a1, c0, c1, zg, o2 = {}) => {
    const um = (a0 + a1) / 2, hw = (a1 - a0) / 2, hh = c1 - c0, sh = o2.noShut ? ['none', 'none'] : [shutState(), shutState()];
    const shut = sh[0] === 'closed' && sh[1] === 'closed';
    if (intact && !shut) {
      K.quad('glass', [a0, c0, zg], [a1, c0, zg], [a1, c1, zg], [a0, c1, zg]);
      K.box(TIM, um - 0.028, c0, zg - 0.02, um + 0.028, c1, zg + 0.05, 'y');
      const yt = c0 + hh * 0.64; K.box(TIM, a0, yt - 0.024, zg - 0.02, a1, yt + 0.024, zg + 0.045, 'x');
      if (o2.bars) for (const f of [0.25, 0.75]) K.box('iron', a0 + 2 * hw * f - 0.012, c0, zg + 0.07, a0 + 2 * hw * f + 0.012, c1, zg + 0.094);
    } else if (!intact) {   // burnt: what is left of the frame
      if (q() < 0.5) K.obox(TIM, um + q.range(-0.1, 0.1), c0 + hh * 0.4, zg, 0.06, hh * 0.8, 0.07, 0, 0, q.range(-0.3, 0.3), 'y');
    }
    if (o2.sill !== false) K.box(BRD, a0 - 0.05, c0 - 0.03, zg, a1 + 0.05, c0 + 0.012, 0.065, 'x');
    for (const sd of [-1, 1]) {
      const st = sh[sd < 0 ? 0 : 1]; if (st === 'none') continue;
      const ph = st === 'closed' ? 0 : st === 'ajar' ? q.range(0.5, 1.4) : PI - (st === 'hang' ? q.range(0.05, 0.4) : q.range(0, 0.06)), sw2 = hw - 0.012;
      const tilt = st === 'hang' ? q.range(0.12, 0.38) * sd : 0;
      K.rot(sd < 0 ? a0 : a1, c1 - (st === 'hang' ? 0.05 : 0), 0.014, 0, sd < 0 ? -ph : PI + ph, tilt);
      const z0 = sd < 0 ? -0.03 : 0, z1 = sd < 0 ? 0 : 0.03, zb0 = sd < 0 ? -0.048 : 0.03, zb1 = sd < 0 ? -0.03 : 0.048, nb = 2;
      for (let i = 0; i < nb; i++) K.box(BRD, i * sw2 / nb, -hh, z0 + (i % 2) * 0.004 * (sd < 0 ? -1 : 1), (i + 1) * sw2 / nb, 0, z1 + (i % 2) * 0.004 * (sd < 0 ? -1 : 1), 'y');
      for (const f of [0.2, 0.8]) { K.box(BRD, 0.02, -hh * f - 0.035, zb0, sw2 - 0.02, -hh * f + 0.035, zb1, 'x'); K.box('iron', -0.02, -hh * f - 0.02, sd < 0 ? 0 : -0.012, sw2 * 0.5, -hh * f + 0.02, sd < 0 ? 0.012 : 0); }
      K.pop();
    }
  };

  // ---- a storey of timber frame on wall i, from y0 (under its sill beam) to y1 (the top of its plate), its face
  // fz out from the wall's; fl / fr are the faces of the walls it meets at its left and right ends
  const frame = (i, y0, y1, fz, bays, o2 = {}) => {
    const W = Ws[i], uL = -(W.half + (o2.fl ?? fz)), uR = W.half + (o2.fr ?? fz), posts = o2.posts || W.posts.map((u) => ({ u, w: PW }));
    const E = [uL + FD, ...posts.map((p) => p.u), uR - FD], n = E.length - 1, ya = y0 + SILL, yb = y1 - PLATE, H = yb - ya, zb = -FD, pz = -0.05;
    const e0f = (b) => b === 0 ? E[0] : E[b] + posts[b - 1].w / 2, e1f = (b) => b === n - 1 ? E[n] : E[b + 1] - posts[b].w / 2;
    K.at(0, 0, fz);
    const dB = bays.findIndex((b) => b && b.cut);
    if (dB >= 0) { if (e0f(dB) - (uL + FD) > 0.02) K.box(TIM, uL + FD, y0, zb, e0f(dB), ya, 0, 'x'); if (uR - e1f(dB) > 0.02) K.box(TIM, e1f(dB), y0, zb, uR, ya, 0, 'x'); }
    else K.box(TIM, uL + FD, y0, zb, uR, ya, 0, 'x');
    K.box(TIM, uL + FD, yb, zb, uR, y1, 0, 'x');
    K.box(TIM, uR - FD, dB === n - 1 && bays[dB].cut ? y0 : ya, zb, uR, yb, 0, 'y');
    posts.forEach((p, j) => { const lo = (dB === j || dB === j + 1) ? y0 : ya; K.box(TIM, p.u - p.w / 2, lo, zb + 0.008, p.u + p.w / 2, yb, p.w > 0.2 ? 0.012 : -0.002, 'y'); });
    for (let b = 0; b < n; b++) {
      const B = bays[b] || { t: 'p' }, e0 = e0f(b), e1 = e1f(b), clip = rectClip(e0, ya, e1, yb);
      const plaster = (a0, c0, a1, c1) => { if (c1 - c0 < 0.03 || a1 - a0 < 0.03) return; if (B.clad) K.box(BRD, a0, c0, pz - 0.02, a1, c1, pz + 0.012, 'y'); else K.quad('plaster', [a0, c0, pz], [a1, c0, pz], [a1, c1, pz], [a0, c1, pz]); };
      const rail = (yr, a0 = e0, a1 = e1, h = 0.13) => K.box(TIM, a0, yr - h / 2, zb + 0.03, a1, yr + h / 2, -0.02, 'x');
      if (B.t === 'w') {
        const c0 = ya + (B.sillH ?? 0.72), c1 = Math.min(yb - 0.14, c0 + (B.h ?? 0.95));
        let a0 = e0, a1 = e1; if (e1 - e0 > 1.12) { const um = (e0 + e1) / 2; a0 = um - 0.48; a1 = um + 0.48; K.box(TIM, a0 - 0.11, ya, zb + 0.03, a0, yb, -0.012, 'y'); K.box(TIM, a1, ya, zb + 0.03, a1 + 0.11, yb, -0.012, 'y'); }
        rail(c0 - 0.065); rail(c1 + 0.065); plaster(e0, ya, e1, c0 - 0.13); plaster(e0, c1 + 0.13, e1, yb);
        if (a0 > e0 + 0.02) { plaster(e0, c0 - 0.13, a0 - 0.11, c1 + 0.13); plaster(a1 + 0.11, c0 - 0.13, e1, c1 + 0.13); }
        if (B.cross) { const cp = rectClip(e0, ya, e1, c0 - 0.13); K.tim(TIM, e0, ya, e1, c0 - 0.13, 0.11, zb + 0.03, -0.004, cp); K.tim(TIM, e1, ya, e0, c0 - 0.13, 0.11, zb + 0.03, -0.012, cp); }
        else if (B.stud) K.box(TIM, (e0 + e1) / 2 - 0.06, ya, zb + 0.03, (e0 + e1) / 2 + 0.06, c0 - 0.13, -0.012, 'y');
        winUnit(a0, a1, c0, c1, -0.11, B);
      } else if (B.t === 'd') {
        // the house door: its posts run down to the floor, a lintel over it, the leaf set a little back
        const yt = B.y0 + 2.0; rail(yt + 0.07, e0, e1, 0.14); plaster(e0, yt + 0.14, e1, yb);
        const um = (e0 + e1) / 2, a0 = Math.max(e0, um - 0.5), a1 = Math.min(e1, um + 0.5);
        if (a0 > e0 + 0.02) { K.box(TIM, a0 - 0.1, B.y0, zb + 0.03, a0, yt, -0.008, 'y'); K.box(TIM, a1, B.y0, zb + 0.03, a1 + 0.1, yt, -0.008, 'y'); plaster(e0, ya, a0 - 0.1, yt); plaster(a1 + 0.1, ya, e1, yt); }
        const ang = B.ang || 0; doorLeaf(a0 + 0.005, B.y0 + 0.03, -0.075, a1 - a0 - 0.01, yt - B.y0 - 0.04, ang);
        if (ang > 0.02) K.quad('dark', [a0, B.y0, -0.17], [a1, B.y0, -0.17], [a1, yt, -0.17], [a0, yt, -0.17]);
        K.box('stone', a0 - 0.08, B.y0 - 0.4, -0.5, a1 + 0.08, B.y0 + 0.03, 0.14);
      } else if (B.t === 'g') {
        // a barn's great door: two leaves to the lintel, knee braces in the corners over it
        const yt = B.yt; K.box(TIM, e0, yt, zb, e1, yt + 0.2, 0.012, 'x');
        for (const [ua, ub] of [[e0, e0 + 0.55], [e1, e1 - 0.55]]) K.tim(TIM, ua, yt - 0.55, ub, yt, 0.13, zb + 0.03, -0.004, rectClip(e0, B.y0, e1, yt));
        const ns = Math.max(1, Math.round((e1 - e0) / 0.9)); for (let s2 = 1; s2 < ns; s2++) { const us = e0 + (e1 - e0) * s2 / ns; K.box(TIM, us - 0.065, yt + 0.2, zb + 0.03, us + 0.065, yb, -0.012, 'y'); }
        plaster(e0, yt + 0.2, e1, yb);
        const lw = (e1 - e0) / 2 - 0.01, lh = yt - B.y0 - 0.07;
        doorLeaf(e0 + 0.005, B.y0 + 0.05, 0.0, lw, lh, -(B.angL || 0), true, 0, { brace: true }); doorLeaf(e1 - 0.005, B.y0 + 0.05, 0.0, lw, lh, -(B.angR || 0), false, 0, { brace: true });
        K.quad('dark', [e0, B.y0, -0.3], [e1, B.y0, -0.3], [e1, yt, -0.3], [e0, yt, -0.3]);
        K.box('stone', e0 - 0.1, B.y0 - 0.5, -0.5, e1 + 0.1, B.y0 + 0.04, 0.3);
      } else if (B.t === 'v') {
        // a slit of a vent high in a barn wall, a bar across it
        const um = (e0 + e1) / 2, c0 = ya + H * 0.62, c1 = c0 + 0.5; rail(c0 - 0.065); rail(c1 + 0.065); rail(ya + H * 0.33);
        K.box(TIM, um - 0.26, c0, zb + 0.03, um - 0.16, c1, -0.012, 'y'); K.box(TIM, um + 0.16, c0, zb + 0.03, um + 0.26, c1, -0.012, 'y');
        plaster(e0, ya, e1, c0 - 0.13); plaster(e0, c1 + 0.13, e1, yb); plaster(e0, c0 - 0.13, um - 0.26, c1 + 0.13); plaster(um + 0.26, c0 - 0.13, e1, c1 + 0.13);
        K.quad('dark', [um - 0.16, c0, -0.12], [um + 0.16, c0, -0.12], [um + 0.16, c1, -0.12], [um - 0.16, c1, -0.12]); K.box('iron', um - 0.16, (c0 + c1) / 2 - 0.012, -0.08, um + 0.16, (c0 + c1) / 2 + 0.012, -0.056);
      } else {
        plaster(e0, ya, e1, yb);
        for (const f of (B.rails || [0.5])) rail(ya + H * f);
        if (B.t === 'a' || B.t === 'x') K.tim(TIM, e1, ya, e0, ya + H * (B.rise ?? 0.9), 0.14, zb + 0.03, -0.004, clip);
        if (B.t === 'b' || B.t === 'x') K.tim(TIM, e0, ya, e1, ya + H * (B.rise ?? 0.9), 0.14, zb + 0.03, B.t === 'x' ? -0.012 : -0.004, clip);
        if (B.kL) K.tim(TIM, e0, yb - 0.5, e0 + 0.5, yb, 0.12, zb + 0.03, -0.01, clip);
        if (B.kR) K.tim(TIM, e1, yb - 0.5, e1 - 0.5, yb, 0.12, zb + 0.03, -0.01, clip);
      }
    }
    K.pop();
    return { uL, uR };
  };

  // which bays of a framed wall are braced, which have windows
  const layout = (W, o2 = {}) => {
    const n = o2.n ?? W.n, B = []; for (let b = 0; b < n; b++) B.push({ t: 'p' });
    if (n >= 3 || o2.brace) { B[0].t = 'a'; B[n - 1].t = 'b'; } else if (n === 2) { B[0].t = 'a'; B[1].t = 'b'; }
    if (n >= 6 && q() < 0.6) { const m = n >> 1; B[m - 1].t = 'b'; B[m].t = 'a'; B[m - 1].mann = B[m].mann = true; }
    return B;
  };
  const addWindows = (B, want, o2 = {}) => {   // on unbraced bays, grouped the way these houses have them
    const free = []; B.forEach((b, i) => { if (b.t === 'p') free.push(i); });
    if (!free.length) return;
    let chosen;
    if (want >= free.length) chosen = free;
    else if (q() < 0.5) { const s0 = Math.floor((free.length - want) / 2); chosen = free.slice(s0, s0 + want); }   // a band of them together
    else { chosen = []; for (let k = 0; k < want; k++) chosen.push(free[Math.round((k + 0.5) * free.length / want - 0.5)]); }
    const cross = q() < 0.4;
    for (const i of new Set(chosen)) { B[i].t = 'w'; B[i].cross = cross; B[i].stud = !cross && q() < 0.5; Object.assign(B[i], o2); }
  };

  // ---- the gable over wall i: rafters, collar, posts and struts, the daub between; a loft door and its hoist on some
  const gableEnd = (i, yE, fz, ext, o2 = {}) => {
    const W = Ws[i], uL = ext.uL, uR = ext.uR, uc = (uL + uR) / 2, half = (uR - uL) / 2, rise = half * tanP, yA = yE + rise, gj = o2.jetty || 0, zb = -FD, pz = -0.05;
    K.at(0, 0, fz + gj);
    const outR = [sinP, cosP, sinP * uc + cosP * yA], outL = [-sinP, cosP, -sinP * uc + cosP * yA], inR = [sinP, cosP, outR[2] - RW], inL = [-sinP, cosP, outL[2] - RW];
    const yb0 = yE + (gj ? 0.18 : 0), tri = [inR, inL, [0, -1, -yb0]];
    if (gj) K.tim(TIM, uL, yE + 0.09, uR, yE + 0.09, 0.18, zb, 0, [outR, outL]);
    K.tim(TIM, uc + half - sinP * RW / 2, yE - cosP * RW / 2, uc - sinP * RW / 2, yA - cosP * RW / 2, RW, zb, 0, [[-1, 0, -uc], [0, -1, -yb0 + 0.0]]);
    K.tim(TIM, uc - half + sinP * RW / 2, yE - cosP * RW / 2, uc + sinP * RW / 2, yA - cosP * RW / 2, RW, zb, 0, [[1, 0, uc], [0, -1, -yb0 + 0.0]]);
    if (o2.clad) {
      // boarded: upright boards with a batten over each joint
      K.prism(BRD, [[uL, yE], [uR, yE], [uc, yA]], pz - 0.02, pz + 0.012, [0, 1]);
      for (let u = uc - half + 0.3; u < uc + half - 0.1; u += 0.3) K.tim(BRD, u, yb0, u, yA, 0.05, pz, pz + 0.035, tri);
    } else K.face('plaster', [[uL, yE], [uR, yE], [uc, yA]], pz);
    const collars = rise > 4.3 ? [0.42, 0.74] : rise > 2.2 ? [0.52] : [];
    const yC = collars.map((f) => yE + rise * f);
    for (const y of yC) K.tim(TIM, uL, y, uR, y, 0.15, zb + 0.03, -0.014, [inR, inL]);
    const yc0 = yC.length ? yC[0] - 0.075 : yA;
    const loft = o2.loft && yc0 - yb0 > 1.5;
    if (!o2.clad) {
      // posts under the first collar, a king post over it
      const nsp = Math.max(1, Math.round(half / 1.15)), sp = half / (nsp + 0.35);
      for (let k2 = 1; k2 <= nsp; k2++) for (const sd of [-1, 1]) { const u = uc + sd * k2 * sp; K.tim(TIM, u, yb0, u, yc0, 0.15, zb + 0.03, -0.006, tri.concat([[0, 1, yc0]])); }
      if (!loft) K.tim(TIM, uc, yb0, uc, yc0, 0.16, zb + 0.03, -0.006, tri.concat([[0, 1, yc0]]));
      if (yC.length) K.tim(TIM, uc, yC[yC.length - 1] + 0.075, uc, yA, 0.15, zb + 0.03, -0.006, tri);
      if (yC.length === 2) { for (const sd of [-1, 1]) K.tim(TIM, uc + sd * sp, yC[0] + 0.075, uc + sd * sp, yC[1] - 0.075, 0.14, zb + 0.03, -0.006, tri); K.tim(TIM, uc, yC[0] + 0.075, uc, yC[1] - 0.075, 0.15, zb + 0.03, -0.006, tri); }
      // struts: from the foot of the middle rising out to the rafters, or St Andrew's crosses beside the middle
      const st = o2.strut ?? 0, clipLow = tri.concat([[0, 1, yc0]]);
      if (st === 0) for (const sd of [-1, 1]) K.tim(TIM, uc + sd * (loft ? 0.62 : 0.12), yb0, uc + sd * (half * 0.78), yb0 + (half * 0.78 - 0.12) * 1.25, 0.13, zb + 0.03, -0.018, clipLow);
      else if (st === 1 && nsp >= 1) for (const sd of [-1, 1]) { const ua = uc + sd * (loft ? 0.6 : 0.09), ub = uc + sd * (sp - 0.08), cp = clipLow.concat(sd > 0 ? [[-1, 0, -ua], [1, 0, ub]] : [[1, 0, ua], [-1, 0, -ub]]); const yt = Math.min(yc0, yb0 + 1.5); K.tim(TIM, ua, yb0, ub, yt, 0.11, zb + 0.03, -0.018, cp.concat([[0, 1, yt]])); K.tim(TIM, ub, yb0, ua, yt, 0.11, zb + 0.03, -0.026, cp.concat([[0, 1, yt]])); }
      if (yC.length && st !== 2) for (const sd of [-1, 1]) K.tim(TIM, uc + sd * 0.09, yC[yC.length - 1] + 0.075, uc + sd * 1.2, yC[yC.length - 1] + 0.075 + 1.1 * 1.2, 0.1, zb + 0.03, -0.018, tri.concat(sd > 0 ? [[-1, 0, -(uc + 0.075)]] : [[1, 0, uc - 0.075]]));
    }
    if (loft) {
      // the loft door, and over it the hoist beam run out through the gable with its hook
      const a0 = uc - 0.46, a1 = uc + 0.46, c0 = yb0 + 0.02, c1 = Math.min(yc0, c0 + 1.55);
      K.box(TIM, a0 - 0.12, yb0, zb + 0.03, a0, c1 + 0.12, -0.004, 'y'); K.box(TIM, a1, yb0, zb + 0.03, a1 + 0.12, c1 + 0.12, -0.004, 'y'); K.box(TIM, a0, c1, zb + 0.03, a1, c1 + 0.12, -0.004, 'x');
      doorLeaf(a0 + 0.005, c0, -0.03, a1 - a0 - 0.01, c1 - c0 - 0.01, 0);
      const hy = (yC.length ? yC[yC.length - 1] : yb0 + rise * 0.6) + 0.22;
      K.box(TIM, uc - 0.08, hy - 0.09, -0.6, uc + 0.08, hy + 0.09, 0.95, 'z');
      K.box('iron', uc - 0.012, hy - 0.4, 0.8, uc + 0.012, hy - 0.09, 0.824); ring(uc, hy - 0.45, 0.812, 0.05, 0.01);
    } else if (!o2.clad && yc0 - yb0 > 1.3 && o2.win !== false) {
      // two small loft windows beside the middle post, shuttered
      for (const sd of [-1, 1]) { const um = uc + sd * 0.52, c0 = yb0 + 0.5, c1 = c0 + 0.55; K.box(TIM, um - 0.3, c0 - 0.1, zb + 0.03, um + 0.3, c0, -0.012, 'x'); K.box(TIM, um - 0.3, c1, zb + 0.03, um + 0.3, c1 + 0.1, -0.012, 'x'); K.box(TIM, um + sd * 0.24, c0, zb + 0.03, um + sd * 0.3, c1, -0.012, 'y');
        if (q() < 0.5) K.box(BRD, um - 0.24, c0, -0.04, um + 0.24, c1, -0.012, 'y'); else K.quad('dark', [um - 0.24, c0, -0.04], [um + 0.24, c0, -0.04], [um + 0.24, c1, -0.04], [um - 0.24, c1, -0.04]); }
    }
    if (o2.owl) { const y = yA - 1.0; K.quad('dark', [uc, y - 0.16, pz + 0.02], [uc + 0.13, y, pz + 0.02], [uc, y + 0.16, pz + 0.02], [uc - 0.13, y, pz + 0.02]); }
    K.pop();
    return { z: fz + gj, yA };
  };

  // ---- the roof, in its own frame: the ridge along z from z0 to z1 (the gables' faces), x across, eaves at ±hs
  const roof = (R) => {
    const { hs, yE, z0, z1 } = R, thatch = kind === 'thatch', th = thatch ? 0.34 : kind === 'slate' ? 0.07 : 0.06, eo = thatch ? 0.5 : 0.42, vo = thatch ? 0.34 : 0.26, tile = thatch ? 2.4 : 2.0;
    const yR = yE + hs * tanP, pk = pitch - 0.24, holes = R.holes || [], dmg = holes.length > 0;
    const bot = [];   // the underside, eave to ridge, on the +x side
    let xk = hs, yk = yE;
    if (!thatch) { xk = hs - 0.3; yk = yE + 0.3 * tanP; bot.push([hs + eo, yk - (0.3 + eo) * Math.tan(pk)]); } else bot.push([hs + eo, yE - eo * tanP]);
    const nm = dmg ? Math.max(2, Math.round(Math.hypot(xk, yR - yk) / 0.6)) : 1;
    if (!thatch) bot.push([xk, yk]);
    const i0 = bot.length - 1; for (let k2 = 1; k2 <= nm; k2++) bot.push([bot[i0][0] * (1 - k2 / nm), bot[i0][1] + (yR - bot[i0][1]) * k2 / nm]);
    const np = bot.length, nrm = [], top = [], dist = [0];
    for (let k2 = 0; k2 < np - 1; k2++) { const dx = bot[k2 + 1][0] - bot[k2][0], dy = bot[k2 + 1][1] - bot[k2][1], l = Math.hypot(dx, dy); nrm.push([dy / l, -dx / l]); dist.push(dist[k2] + l); }
    for (let k2 = 0; k2 < np; k2++) {
      if (k2 === np - 1) { top.push([0, bot[k2][1] + th / cosP]); continue; }
      const a = nrm[Math.max(0, k2 - 1)], b = nrm[k2]; let mx = a[0] + b[0], my = a[1] + b[1]; const l = Math.hypot(mx, my); mx /= l; my /= l; const kq = th / (mx * b[0] + my * b[1]);
      top.push([bot[k2][0] + mx * kq, bot[k2][1] + my * kq]);
    }
    const zA = z0 - vo, zB = z1 + vo, nz = dmg ? Math.max(2, Math.round((zB - zA) / 0.6)) : 1, zs = []; for (let j = 0; j <= nz; j++) zs.push(zA + (zB - zA) * j / nz);
    const total = dist[np - 1];
    for (const s of [-1, 1]) {
      const keep = (k2, j) => { if (k2 < 0 || j < 0 || k2 >= np - 1 || j >= nz) return false; if (!dmg) return true; const zc = (zs[j] + zs[j + 1]) / 2, tc = (dist[k2] + dist[k2 + 1]) / 2 / total;
        for (const h of holes) if (h.s === s && ((zc - h.z) / h.rz) ** 2 + ((tc - h.t) / h.rt) ** 2 < 1) return false; return true; };
      const T = (k2, j) => [s * top[k2][0], top[k2][1], zs[j]], Bq = (k2, j) => [s * bot[k2][0], bot[k2][1], zs[j]];
      for (let k2 = 0; k2 < np - 1; k2++) for (let j = 0; j < nz; j++) {
        if (!keep(k2, j)) continue;
        const n = nrm[k2], u0 = zs[j] / tile, u1 = zs[j + 1] / tile, v0 = dist[k2] / tile, v1 = dist[k2 + 1] / tile;
        K.quadTo(ROOF, T(k2, j), T(k2, j + 1), T(k2 + 1, j + 1), T(k2 + 1, j), s * n[0], n[1], 0, [u0, v0, u1, v0, u1, v1, u0, v1]);
        K.quadTo(TIM, Bq(k2, j), Bq(k2, j + 1), Bq(k2 + 1, j + 1), Bq(k2 + 1, j), -s * n[0], -n[1], 0);
        const ev = th / tile;
        if (k2 === 0) K.quadTo(ROOF, Bq(0, j), Bq(0, j + 1), T(0, j + 1), T(0, j), s * 0.8, -0.6, 0, [u0, 0, u1, 0, u1, ev, u0, ev]);
        else if (!keep(k2 - 1, j)) K.quadTo(ROOF, Bq(k2, j), Bq(k2, j + 1), T(k2, j + 1), T(k2, j), s * n[1], -n[0], 0, [u0, 0, u1, 0, u1, ev, u0, ev]);
        if (k2 < np - 2 && !keep(k2 + 1, j)) K.quadTo(ROOF, Bq(k2 + 1, j), Bq(k2 + 1, j + 1), T(k2 + 1, j + 1), T(k2 + 1, j), -s * n[1], n[0], 0, [u0, 0, u1, 0, u1, ev, u0, ev]);
        if (!keep(k2, j - 1)) K.quadTo(ROOF, Bq(k2, j), Bq(k2 + 1, j), T(k2 + 1, j), T(k2, j), 0, 0, -1, [0, v0, 0, v1, ev, v1, ev, v0]);
        if (!keep(k2, j + 1)) K.quadTo(ROOF, Bq(k2, j + 1), Bq(k2 + 1, j + 1), T(k2 + 1, j + 1), T(k2, j + 1), 0, 0, 1, [0, v0, 0, v1, ev, v1, ev, v0]);
      }
      // rafter feet under the eaves; whole rafters where the roof is holed
      const nr = Math.max(2, Math.round((z1 - z0) / 0.95)), e = bot[0], kq = bot[1];
      const dx = kq[0] - e[0], dy = kq[1] - e[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
      for (let j = 0; j <= nr; j++) {
        const zc = z0 + 0.12 + (z1 - z0 - 0.24) * j / nr;
        const Lr = thatch ? Math.min(l, 1.0) : l + 0.3, A = [e[0] + ux * 0.06, e[1] + uy * 0.06], Bp = [e[0] + ux * Lr, e[1] + uy * Lr], nx = uy, ny = -ux;
        const poly = [A, Bp, [Bp[0] - nx * 0.13, Bp[1] - ny * 0.13], [A[0] - nx * 0.13, A[1] - ny * 0.13]].map((p) => [s * p[0], p[1]]);
        K.prism(TIM, s > 0 ? poly : poly.reverse(), zc - 0.05, zc + 0.05, [s * ux, uy]);
        if (dmg) { const a = bot[i0], P2 = [[a[0], a[1]], [0.05, yR - 0.05 * tanP], [0.05 - sinP * 0.14, yR - 0.05 * tanP - cosP * 0.14], [a[0] - sinP * 0.14, a[1] - cosP * 0.14]].map((p) => [s * p[0], p[1]]); K.prism(TIM, s > 0 ? P2 : P2.reverse(), zc - 0.05, zc + 0.05, [-s * cosP, sinP]); }
      }
      if (dmg) for (const h of holes) if (h.s === s) for (let b2 = -1; b2 <= 1; b2++) { const t = clamp(h.t + b2 * h.rt * 0.6, 0.08, 0.95), a = bot[i0], px = a[0] * (1 - t), py = a[1] + (yR - a[1]) * t; K.box(TIM, s * px - 0.03, py - 0.045, h.z - h.rz - 0.4, s * px + 0.03, py - 0.005, h.z + h.rz + 0.4, 'z'); }
      // bargeboards on a tiled or shingled verge
      if (!thatch) for (const zq of [zA - 0.03, zB]) for (let k2 = 0; k2 < np - 1; k2++) {
        const a = top[k2], b = top[k2 + 1], n = nrm[k2], dd = 0.24, poly = [[a[0] + n[0] * 0.02, a[1] + n[1] * 0.02], [a[0] - n[0] * dd, a[1] - n[1] * dd], [b[0] - n[0] * dd, b[1] - n[1] * dd], [b[0] + n[0] * 0.02, b[1] + n[1] * 0.02]].map((p) => [s * p[0], p[1]]);
        if (k2 === np - 2) { poly[2] = [0, b[1] - dd / cosP]; poly[3] = [0, b[1] + 0.02 / cosP]; }
        K.prism(BRD, s > 0 ? poly.reverse() : poly, zq, zq + 0.03, [-s * cosP, sinP]);
      }
      // the wall plate's end carried out under the verge
      for (const [za, zb2] of [[zA + 0.04, z0], [z1, zB - 0.04]]) K.box(TIM, s * (hs - 0.2), yE - 0.19, za, s * (hs - 0.02), yE - 0.01, zb2, 'z');
    }
    // the ridge: a roll of straw, or ridge tiles / boards
    const ry = top[np - 1][1];
    const sec = thatch ? [[-0.42, ry - 0.3], [-0.3, ry + 0.02], [-0.13, ry + 0.2], [0.13, ry + 0.2], [0.3, ry + 0.02], [0.42, ry - 0.3]] : [[-0.2, ry - 0.2 * tanP + 0.035], [-0.05, ry + 0.07], [0.05, ry + 0.07], [0.2, ry - 0.2 * tanP + 0.035]];
    for (let k2 = 0; k2 < sec.length - 1; k2++) { const a = sec[k2], b = sec[k2 + 1]; K.quadTo(ROOF, [a[0], a[1], zA - 0.02], [a[0], a[1], zB + 0.02], [b[0], b[1], zB + 0.02], [b[0], b[1], zA - 0.02], 0, 1, 0, thatch ? [k2 * 0.12, zA / tile, k2 * 0.12, zB / tile, k2 * 0.12 + 0.12, zB / tile, k2 * 0.12 + 0.12, zA / tile] : [zA / tile, 0, zB / tile, 0, zB / tile, 0.12, zA / tile, 0.12]); }
    for (const [zq, sg] of [[zA - 0.02, -1], [zB + 0.02, 1]]) for (let k2 = 1; k2 < sec.length - 1; k2++) K.triTo(ROOF, [sec[0][0], sec[0][1], zq], [sec[k2][0], sec[k2][1], zq], [sec[k2 + 1][0], sec[k2 + 1][1], zq], 0, 0, sg);
    K.box(TIM, -0.08, yR - 0.3, zA + 0.04, 0.08, yR - 0.12, zB - 0.04, 'z');   // the ridge piece, its ends showing under the verge
    return { yR, th, topAt: (x) => ry - Math.abs(x) * tanP, zA, zB, eo };
  };
  // a chimney through the roof at (x, z) of the roof's frame
  const chimney = (Rf, x, z) => {
    const hw = 0.37, yt = Math.max(Rf.topAt(Math.abs(x) - hw) + 0.7, Rf.yR + 0.25), ylo = Rf.topAt(Math.abs(x) + hw) - 0.35;
    K.box('stone', x - hw, ylo, z - hw, x + hw, yt, z + hw);
    K.box('stone', x - hw - 0.06, yt - 0.02, z - hw - 0.06, x + hw + 0.06, yt + 0.14, z + hw + 0.06);
    if (q() < 0.55) { for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box('stone', x + sx * (hw - 0.02) - 0.08, yt + 0.14, z + sz * (hw - 0.02) - 0.08, x + sx * (hw - 0.02) + 0.08, yt + 0.36, z + sz * (hw - 0.02) + 0.08); K.box('stone', x - hw - 0.1, yt + 0.36, z - hw - 0.1, x + hw + 0.1, yt + 0.44, z + hw + 0.1); }
    K.quad('dark', [x - hw + 0.12, yt + 0.142, z + hw - 0.12], [x + hw - 0.12, yt + 0.142, z + hw - 0.12], [x + hw - 0.12, yt + 0.142, z - hw + 0.12], [x - hw + 0.12, yt + 0.142, z - hw + 0.12]);
  };

  // ---- things that go with a stone ground storey: its door, its small windows, the dressed stones of its corners
  const stoneDoor = (u, ang) => {
    K.box(TIM, u - 0.66, 2.08, -WT + 0.03, u + 0.66, 2.24, 0.02, 'x');
    if (intact) { K.box(TIM, u - 0.5, 0, -0.36, u - 0.41, 2.08, -0.22, 'y'); K.box(TIM, u + 0.41, 0, -0.36, u + 0.5, 2.08, -0.22, 'y'); K.box(TIM, u - 0.41, 1.99, -0.36, u + 0.41, 2.08, -0.22, 'x');
      doorLeaf(u - 0.405, 0.035, -0.24, 0.81, 1.95, ang);
      if (ang > 0.02) K.quad('dark', [u - 0.41, 0, -0.4], [u + 0.41, 0, -0.4], [u + 0.41, 1.99, -0.4], [u - 0.41, 1.99, -0.4]); }
    K.box('stone', u - 0.6, -0.4, -WT, u + 0.6, 0.035, 0.16);
  };
  const stoneWin = (u, lintel) => {
    K.box('stone', u - 0.46, 0.87, -0.3, u + 0.46, 0.975, 0.05);
    if (lintel) K.box(TIM, u - 0.5, 1.92, -WT + 0.03, u + 0.5, 2.08, 0.015, 'x');
    if (intact) { K.box(TIM, u - 0.36, 0.975, -0.26, u - 0.31, 1.92, -0.16, 'y'); K.box(TIM, u + 0.31, 0.975, -0.26, u + 0.36, 1.92, -0.16, 'y'); }
    if (intact || lintel) winUnit(u - 0.36, u + 0.36, 0.975, 1.92, -0.2, { sill: false, bars: q() < 0.3, noShut: !intact && q() < 0.6 });
  };
  const quoins = (topOf) => {
    for (const [sx, sz, t] of [[-1, -1, topOf(2, Ws[2].half - 0.1)], [1, -1, topOf(2, -Ws[2].half + 0.1)], [-1, 1, topOf(0, -Ws[0].half + 0.1)], [1, 1, topOf(0, Ws[0].half - 0.1)]]) {
      const cx = sx * (w / 2 + OF), cz = sz * (d / 2 + OF);
      for (let k2 = 0; (k2 + 1) * 2 * COURSE <= t + 0.01; k2++) { const lx = k2 % 2 ? 0.64 : 0.4, lz = k2 % 2 ? 0.4 : 0.64, y0 = k2 * 2 * COURSE;
        K.box('stone', Math.min(cx + sx * 0.022, cx - sx * lx), y0 + 0.012, Math.min(cz + sz * 0.022, cz - sz * lz), Math.max(cx + sx * 0.022, cx - sx * lx), y0 + 2 * COURSE - 0.012, Math.max(cz + sz * 0.022, cz - sz * lz)); }
    }
  };
  const soot = (u0, u1, y0, y1, z, front = true) => { if (y1 - y0 < 0.25) return; const a = [u0, y0, z], b = [u1, y0, z], c = [u1, y1, z], e = [u0, y1, z];
    if (front) K.quad('soot', a, b, c, e, [0, 0, 1, 0, 1, 1, 0, 1]); else K.quad('soot', b, a, e, c, [1, 0, 0, 0, 0, 1, 1, 1]); };
  const bracket = (u, yTop, out) => { K.push(new THREE.Matrix4().makeRotationY(-PI / 2)); K.prism(TIM, [[0, yTop - 0.52], [0.07, yTop - 0.5], [out - 0.03, yTop - 0.07], [out - 0.03, yTop], [0, yTop]], -(u + 0.065), -(u - 0.065), [0.64, 0.77]); K.pop(); };

  let yE = 0, Rf = null;
  if (style !== 'wreck') {
    const jet = [jf, 0, 0, 0], fz = (i) => f0 + jet[i], dAng = q() < 0.3 ? q.range(0.25, 1.0) : 0;
    const dW = Ws[0], dIdx = dW.segs.findIndex((s) => s.isDoor);
    let yU0 = 0;       // where the upper storey's frame starts (0: there is none)
    const band = (y, both = true) => Ws.forEach((W, i) => inW(i, () => {   // the floor between the storeys: joist ends over the street, a beam on the other walls
      const fl = f0 + 0, uL = -(W.half + f0), uR = W.half + f0;
      if (jet[i] > 0) {
        K.box(TIM, uL + FD, y, f0 - FD, uR, y + 0.2, f0 - 0.06, 'x'); K.box(BRD, uL, y + 0.16, f0 - 0.06, uR, y + 0.2, f0 + jet[i] - FD + 0.01, 'x');
        const nj = Math.max(3, Math.round((uR - uL - 0.3) / 0.62)); for (let j = 0; j <= nj; j++) { const u = uL + 0.11 + (uR - uL - 0.22) * j / nj; K.box(TIM, u - 0.07, y + 0.012, f0 - 0.3, u + 0.07, y + 0.2, f0 + jet[i] - 0.02, 'z'); }
        const bp = [uL + 0.1, uR - 0.1, ...W.posts.filter((_, j) => j % 2 === (W.posts.length % 2 ? 0 : 1))];
        for (const u of bp) bracket(u, y + 0.012, jet[i] + (f0 < 0 ? 0 : 0));
      } else K.box(TIM, uL + FD, y, f0 - FD, uR, y + 0.2, f0 + (style === 'stock' ? 0.015 : 0), 'x');
    }));
    if (style === 'stock') {
      Ws.forEach((W, i) => inW(i, () => {
        const e = i % 2 ? WT : 0, holes = [];
        for (const s of W.segs) { if (s.isDoor) holes.push([s.u - 0.5, s.u + 0.5, 0, 2.08], [s.u - 0.66, s.u + 0.66, 2.08, 2.24]); else if (s.win) holes.push([s.u - 0.36, s.u + 0.36, 0.975, 1.92], [s.u - 0.5, s.u + 0.5, 1.92, 2.08]); }
        wallRun(K, 'stone', -W.half + e, W.half - e, 0, GF, WT, holes);
        for (const s of W.segs) { if (s.isDoor) stoneDoor(s.u, dAng); else if (s.win) stoneWin(s.u, true); }
      }));
      quoins(() => GF); band(GF); yU0 = GF + 0.2;
    } else {
      // a low stone plinth and a framed ground storey on it
      const y1 = PL + (style === 'barn' ? 3.3 : 2.26);
      Ws.forEach((W, i) => {
        const B = style === 'barn' ? null : layout(W);
        let posts = null, bays = B;
        if (style === 'barn') {
          // wide bays between heavy posts; the great door in the middle of the front, a vent slit here and there
          posts = []; bays = [];
          const uL = -(W.half + f0) + FD, uR = W.half + f0 - FD, du = W.door ? W.door.u : null;
          const span = (a, b, first, last) => { const n = Math.max(1, Math.round((b - a) / 2.3)); for (let k2 = 0; k2 < n; k2++) { if (k2 > 0) posts.push({ u: a + (b - a) * k2 / n, w: 0.2 }); bays.push({ t: (first && k2 === 0) ? 'a' : (last && k2 === n - 1) ? 'b' : q() < 0.3 ? 'v' : 'p', rails: [0.33, 0.66], rise: 0.66 }); } };
          if (du !== null) { span(uL, du - 1.5, true, false); posts.push({ u: du - 1.5, w: 0.26 }); bays.push({ t: 'g', cut: true, y0: 0, yt: PL + 2.75, angL: q() < 0.5 ? q.range(0.3, 1.1) : 0, angR: q() < 0.35 ? q.range(0.2, 0.9) : 0.04 }); posts.push({ u: du + 1.5, w: 0.26 }); span(du + 1.5, uR, false, true); }
          else span(uL, uR, true, true);
        } else {
          if (i === 0 && dIdx >= 0) B[dIdx] = { t: 'd', cut: true, y0: 0, ang: dAng };
          W.segs.forEach((s, b) => { if (s.win && B[b].t === 'p') Object.assign(B[b], { t: 'w', sillH: 0.62, h: 0.9, stud: q() < 0.5, cross: false }); });
          if (i === 0 && !B.some((b) => b.t === 'w')) addWindows(B, 1, { sillH: 0.62, h: 0.9 });
        }
        inW(i, () => {
          const e = i % 2 ? WT : 0, holes = []; const db = bays.findIndex((b) => b.cut);
          if (db >= 0) { const E = [-(W.half + f0) + FD, ...(posts || W.posts.map((u) => ({ u, w: PW }))).map((p) => p.u), W.half + f0 - FD], pw = (posts ? 0.13 : PW / 2); holes.push([E[db] + pw - 0.08, E[db + 1] - pw + 0.08, 0, PL + 0.01]); }
          wallRun(K, 'stone', -W.half + e, W.half - e, 0, PL, WT, holes);
          frame(i, PL, y1, f0, bays, posts ? { posts } : {});
        });
      });
      if (style === 'fach') { band(y1); yU0 = y1 + 0.2; } else yE = y1;
    }
    let ext = Ws.map((W) => ({ uL: -(W.half + f0), uR: W.half + f0 }));
    if (yU0) {
      yE = yU0 + (style === 'stock' ? 2.3 : 2.2);
      Ws.forEach((W, i) => {
        const B = layout(W), side = i % 2 === 1;
        addWindows(B, i === 0 ? (W.n >= 6 ? pick([2, 3, 4]) : pick([2, 3])) : side ? (village ? pick([0, 1, 1]) : 2) : pick([1, 2]), {});
        inW(i, () => { ext[i] = frame(i, yU0, yE, fz(i), B, { fl: fz((i + 3) % 4), fr: fz((i + 1) % 4) }); });
      });
    }
    // gables and the roof
    const strut = Math.floor(q() * 3), loftI = q() < (big ? 0.9 : 0.4) ? (gableFront ? 0 : pick([1, 3])) : -1, clad = big ? q() < 0.75 : q() < 0.12;
    const gi = gableFront ? [0, 2] : [1, 3], gz = {};
    for (const i of gi) inW(i, () => { gz[i] = gableEnd(i, yE, fz(i), ext[i], { jetty: (i === 0 && yU0) ? 0.1 : 0, loft: i === loftI, strut, clad, owl: big || q() < 0.3 }); });
    const holes = [];
    if (q() < 0.3) for (let h = 0, nh = 1 + (q() < 0.4 ? 1 : 0); h < nh; h++) holes.push({ s: q() < 0.5 ? -1 : 1, z: 0, f: q.range(0.2, 0.8), t: q.range(0.3, 0.72), rz: q.range(0.6, 1.3), rt: q.range(0.12, 0.24) });
    const ch = plan.chimney && !big ? plan.chimney : null;
    if (gableFront) {
      const hs = w / 2 + OF + f0, z0 = -(d / 2 + OF + gz[2].z), z1 = d / 2 + OF + gz[0].z;
      for (const h of holes) h.z = lerp(z0 + 0.8, z1 - 0.8, h.f);
      Rf = roof({ hs, yE, z0, z1, holes });
      if (ch) chimney(Rf, ch.sx * hs * q.range(0.2, 0.42), q.range(-d / 4, d / 4));
    } else {
      const zf = d / 2 + OF + fz(0), zb = -(d / 2 + OF + fz(2)), hs = (zf - zb) / 2, zc = (zf + zb) / 2, z1 = w / 2 + OF + gz[1].z, z0 = -(w / 2 + OF + gz[3].z);
      for (const h of holes) h.z = lerp(z0 + 0.8, z1 - 0.8, h.f);
      K.push(new THREE.Matrix4().makeRotationY(PI / 2).setPosition(0, 0, zc));
      Rf = roof({ hs, yE, z0, z1, holes });
      if (ch) chimney(Rf, pick([-1, 1]) * hs * q.range(0.15, 0.3), ch.sx * (w / 2 - q.range(1.0, 1.9)));
      K.pop();
    }
    info.height = Rf.yR;
    // ---- about the door: a lantern on its bracket, a bench, a little roof over a cottage's door
    if (!big && dIdx >= 0) inW(0, () => {
      const u = dW.door.u, zf = style === 'stock' ? 0 : f0;
      if (q() < 0.55) { const lu = u + (q() < 0.5 ? -1 : 1) * 0.78; K.box('iron', lu - 0.015, 2.02, zf, lu + 0.015, 2.05, zf + 0.3); K.box('iron', lu - 0.012, 1.82, zf, lu + 0.012, 2.03, zf + 0.024);
        K.box('lamp', lu - 0.06, 1.74, zf + 0.2, lu + 0.06, 1.92, zf + 0.32); K.box('iron', lu - 0.075, 1.92, zf + 0.185, lu + 0.075, 1.95, zf + 0.335); K.box('iron', lu - 0.07, 1.72, zf + 0.19, lu + 0.07, 1.74, zf + 0.33); K.box('iron', lu - 0.008, 1.95, zf + 0.252, lu + 0.008, 2.02, zf + 0.268); }
      if (style === 'kate' && plan.porch) {   // a pent roof over the door on two braced brackets
        for (const sd of [-1, 1]) { const bu = u + sd * 0.62; K.box(TIM, bu - 0.05, 2.2, zf, bu + 0.05, 2.3, zf + 0.8, 'z'); K.push(new THREE.Matrix4().makeRotationY(-PI / 2)); K.tim(TIM, zf + 0.02, 1.7, zf + 0.7, 2.2, 0.08, -(bu + 0.04), -(bu - 0.04), [[-1, 0, -zf], [0, 1, 2.2]]); K.pop(); }
        const a = [u - 0.85, 2.52, zf], b = [u + 0.85, 2.52, zf], c = [u + 0.85, 2.22, zf + 0.95], e = [u - 0.85, 2.22, zf + 0.95];
        K.quad(BRD, e, c, b, a); K.quad(BRD, a, b, c, e); K.box(BRD, u - 0.85, 2.19, zf + 0.9, u + 0.85, 2.25, zf + 0.96, 'x');
      }
      const side = q() < 0.5 ? -1 : 1, bu = u + side * q.range(1.5, 1.9);
      if (q() < 0.6 && Math.abs(bu) < dW.len / 2 - 0.8) {   // a bench against the wall: a plank on two blocks
        const [hx, hz] = toH(0, bu, 0.3), gy = gH(hx, hz);
        K.box(BRD, bu - 0.72, gy + 0.4, 0.06, bu + 0.72, gy + 0.45, 0.4, 'x'); for (const sd of [-1, 1]) K.box('stone', bu + sd * 0.52 - 0.12, gy - 0.15, 0.08, bu + sd * 0.52 + 0.12, gy + 0.4, 0.38);
      }
    });
    // ---- an open lean-to against the back wall, for the wood and the cart
    if (q() < (big ? 0.3 : 0.45)) inW(2, (W) => {
      const len = Math.min(W.len - 1.2, q.range(2.6, 4.2)), u0 = q() < 0.5 ? -W.len / 2 + 0.4 : W.len / 2 - 0.4 - len, u1 = u0 + len, dep = 1.35, yw = 2.38, yo = 1.9, zf = style === 'stock' ? 0 : f0;
      for (const u of [u0 + 0.1, u1 - 0.1]) { const [hx, hz] = toH(2, u, dep), gy = gH(hx, hz); K.box(TIM, u - 0.07, gy - 0.3, dep - 0.07, u + 0.07, yo, dep + 0.07, 'y'); info.colliders.push([hx, hz, 0.22]); K.box(TIM, u - 0.05, yo - 0.02, zf, u + 0.05, yo + 0.08, dep + 0.07, 'z'); K.box(TIM, u - 0.05, yw - 0.1, zf, u + 0.05, yw, zf + 0.1, 'z'); }
      K.box(TIM, u0, yo - 0.02, dep - 0.06, u1, yo + 0.1, dep + 0.06, 'x'); K.box(TIM, u0, yw - 0.02, zf, u1, yw + 0.1, zf + 0.1, 'x');
      const a = [u0 - 0.15, yw + 0.16, zf], b = [u1 + 0.15, yw + 0.16, zf], c = [u1 + 0.15, yo - 0.02, dep + 0.32], e = [u0 - 0.15, yo - 0.02, dep + 0.32], sl = Math.hypot(yw + 0.18 - yo, dep + 0.32 - zf), tl = 2.0;
      K.quad(ROOF, e, c, b, a, [e[0] / tl, 0, c[0] / tl, 0, b[0] / tl, sl / tl, a[0] / tl, sl / tl]); K.quad(TIM, [a[0], a[1] - 0.05, a[2]], [b[0], b[1] - 0.05, b[2]], [c[0], c[1] - 0.05, c[2]], [e[0], e[1] - 0.05, e[2]]);
      K.quadTo(ROOF, [e[0], e[1] - 0.05, e[2]], [c[0], c[1] - 0.05, c[2]], c, e, 0, 0, 1, [e[0] / tl, 0, c[0] / tl, 0, c[0] / tl, 0.03, e[0] / tl, 0.03]);
      for (const [p, p2, sg] of [[a, e, -1], [b, c, 1]]) K.quadTo(ROOF, [p[0], p[1] - 0.05, p[2]], [p2[0], p2[1] - 0.05, p2[2]], p2, p, sg, 0, 0, [0, 0, sl / tl, 0, sl / tl, 0.03, 0, 0.03]);
    });
  }

  // ---- what the fire left: the stone ground storey broken down, charred timbers standing on it and fallen in it
  if (style === 'wreck') {
    const jo = [];
    Ws.forEach((W, i) => inW(i, () => {
      const e = i % 2 ? WT : 0, holes = [];
      for (const s of W.segs) {
        if (s.isDoor) { if (W.top(s.u) < 2.2) holes.push([s.u - 0.5, s.u + 0.5, 0, Infinity]); else { holes.push([s.u - 0.5, s.u + 0.5, 0, 2.08], [s.u - 0.66, s.u + 0.66, 2.08, 2.24]); s.lintel = true; } }
        else if (s.win) { if (Math.min(W.top(s.u - 0.3), W.top(s.u + 0.3)) < 2.2) holes.push([s.u - 0.36, s.u + 0.36, 0.975, Infinity]); else { holes.push([s.u - 0.36, s.u + 0.36, 0.975, 1.92], [s.u - 0.5, s.u + 0.5, 1.92, 2.08]); s.lintel = true; } }
      }
      wallRun(K, 'stone', -W.half + e, W.half - e, 0, W.top, WT, holes, W.cuts);
      const minTop = (a, b) => Math.min(W.top(a), W.top((a + b) / 2), W.top(b));
      for (const s of W.segs) {
        const sgn = W.flip ? -1 : 1;
        if (s.isDoor) {
          if (s.lintel) { stoneDoor(s.u, 0); soot(s.u - 0.75, s.u + 0.75, 2.2, Math.min(3.4, minTop(s.u - 0.7, s.u + 0.7)), 0.012); soot(s.u - 0.75, s.u + 0.75, 2.2, Math.min(3.4, minTop(s.u - 0.7, s.u + 0.7)), -WT - 0.012, false); }
          else K.box('stone', s.u - 0.6, -0.4, -WT, s.u + 0.6, 0.035, 0.16);
          if (s.leaf) doorLeaf(s.u - 0.4, 0.03, -0.1, 0.8, 1.95, -s.leaf.open, true, s.leaf.tilt);
        } else if (s.win) {
          stoneWin(s.u, s.lintel);
          if (s.lintel) { const t = minTop(s.u - 0.5, s.u + 0.5); soot(s.u - 0.6, s.u + 0.6, 1.98, Math.min(3.3, t), 0.012); soot(s.u - 0.6, s.u + 0.6, 1.98, Math.min(3.3, t), -WT - 0.012, false); }
        }
        // loose stones left on the broken top, the charred stumps of studs, a joist end still in its pocket
        for (const st of s.stones || []) { const u = s.u + sgn * st.qx, sz = st.sz * 1.35; K.rot(0, 0, 0, 0, 0, 0); rest('stone', u, -0.25 + st.pz, sz, sz * 0.55, sz * 0.75, st.rx * 0.12, st.rz, st.rz * 0.1, W.top(u), 0.015); K.pop(); }
        if (s.stud) { const u = s.u + sgn * s.stud.px, t = W.top(u); K.obox(TIM, u, t + s.stud.ht / 2 - 0.04, -0.25, 0.16, s.stud.ht, 0.17, s.stud.rx, 0, s.stud.rz, 'y'); }
        if (s.joist) { const t = W.top(s.u); if (t > 1.2) K.obox(TIM, s.u, t - 0.13, -0.25, 0.16, 0.17, s.joist.len + 0.5, s.joist.rx * 0.5, 0, 0, 'z'); }
      }
      // the frame that stood on the wall: where a stretch still stands to its full height, the sill beam lies on it
      // yet and a few posts stand charred, the tallest still tied by a rail
      let run = [];
      const flush = () => {
        if (run.length >= 2 && q() < 0.75) {
          const a = run[0].u - W.sw / 2 + 0.02, b = run[run.length - 1].u + W.sw / 2 - 0.02, t = GF, fromL = q() < 0.5;
          K.box(TIM, a, t, -0.36, b, t + 0.17, -0.16, 'x');
          const ps = []; for (let k2 = 0; k2 <= run.length; k2++) { const kk = fromL ? k2 : run.length - k2, h = 2.25 - kk * q.range(0.25, 0.8) - (q() < 0.25 ? 1 : 0); if (h > 0.4) ps.push({ u: a + (b - a) * k2 / run.length, h }); else ps.push(null); }
          ps.forEach((p, k2) => { if (!p) return; K.obox(TIM, p.u, t + 0.17 + p.h / 2, -0.26, 0.17, p.h, 0.18, q.range(-0.03, 0.03), 0, q.range(-0.04, 0.04), 'y');
            const p2 = ps[k2 + 1]; if (p2) { const hr = Math.min(p.h, p2.h); if (hr > 1.1) K.box(TIM, p.u + 0.085, t + 0.17 + 0.95, -0.34, p2.u - 0.085, t + 0.17 + 1.08, -0.2, 'x');
              if (hr > 2.0) { K.box(TIM, p.u - 0.085, t + 0.17 + hr - 0.02, -0.36, p2.u + 0.085, t + 0.17 + hr + 0.15, -0.16, 'x'); if (q() < 0.6) K.tim(TIM, p.u + 0.085, t + 0.17, p2.u - 0.085, t + 0.17 + hr * 0.85, 0.13, -0.33, -0.21, rectClip(p.u + 0.085, t + 0.17, p2.u - 0.085, t + 0.17 + hr)); if (q() < 0.45) K.quad('plaster', [p.u + 0.085, t + 0.17 + 1.08, -0.27], [p2.u - 0.085, t + 0.17 + 1.08, -0.27], [p2.u - 0.085, t + 0.15 + hr, -0.27], [p.u + 0.085, t + 0.15 + hr, -0.27]); } } });
        }
        run = [];
      };
      for (const s of W.segs) { if (minTop(s.u - W.sw / 2 + 0.05, s.u + W.sw / 2 - 0.05) >= GF - 0.01) run.push(s); else flush(); }
      flush();
    }));
    quoins((i, u) => Ws[i].top(u));
    // floor joists: still spanning where both side walls stand, or one end down on the floor
    for (let k2 = 1; k2 < Ws[1].n; k2++) {
      const z = -d / 2 + k2 * Ws[1].sw, tR = Ws[1].top(-z), tL = Ws[3].top(z), f = q();
      if (tR >= GF - 0.01 && tL >= GF - 0.01) { if (f < 0.5) K.box(TIM, -(w / 2 + 0.2), GF + 0.005, z - 0.09, w / 2 + 0.2, GF + 0.2, z + 0.09, 'x'); }
      else if (f < 0.55 && Math.max(tR, tL) > 1.2) { const sx = tR > tL ? 1 : -1, t = Math.max(tR, tL), L = Math.min(w - 1, q.range(3, 4.6)), run2 = Math.sqrt(Math.max(0.1, L * L - (t - 0.1) * (t - 0.1))); K.beam(TIM, [sx * (w / 2 - 0.05), t + 0.06, z], [sx * (w / 2 - 0.05 - run2), 0.1, z + q.range(-0.5, 0.5)], 0.17, 0.19, q.range(0, 0.5)); }
    }
    // rafters fallen in off the walls, panels of the roof slid down against them, shingles strewn about
    const sideTop = (sx, z) => sx > 0 ? Ws[1].top(-z) : Ws[3].top(z);
    for (const rf of plan.rafters) { if (!rf.lean) continue; const z = clamp(rf.lz + rf.dz, -d / 2 + 0.4, d / 2 - 0.4), t = Math.min(2.3, sideTop(rf.sx, z)), L = 2.2 / Math.sin(rf.lean), run2 = Math.sqrt(Math.max(0.2, L * L - t * t));
      K.beam(TIM, [rf.sx * (w / 2 - 0.22), t + 0.07, z], [rf.sx * (w / 2 - 0.22 - run2), 0.09, z + rf.ry * 1.5], 0.16, 0.16, rf.rx * 3); }
    for (const p of plan.panels) { const z = clamp(p.lz, -d / 2 + 0.6, d / 2 - 0.6), t = Math.min(p.top, sideTop(p.sx, z) + 0.04), len = p.len, lean = Math.asin(clamp((t - 0.08) / len, 0.05, 0.95));
      K.obox('roofBurnt', p.sx * (w / 2 - 0.3 - Math.cos(lean) * len / 2), t / 2 + 0.07, z, len, 0.07, p.wd, p.rx * 0.5, p.ry, p.sx * lean); }
    for (const sh of plan.shingles) rest('roofBurnt', sh.lx, sh.lz, sh.a, 0.025, sh.b, sh.rx, sh.ry, sh.rz, gH(sh.lx, sh.lz), 0.012);
    // stone fallen from each breach, heaped at the wall's foot inside and out
    for (const rb of plan.rubble) { const s1 = rb.sz * 1.5; rest('stone', rb.lx, rb.lz, s1, s1 * rb.sy * 0.9, s1 * rb.sz2 * 0.8, rb.rx * 0.15, rb.ry, rb.rz * 0.15, gH(rb.lx, rb.lz), s1 * 0.1); }
    for (const b of plan.broken) for (let k2 = 0; k2 < 7; k2++) { const c = Math.cos(b.rot), s2 = Math.sin(b.rot), al = q.range(-b.sw * 0.8, b.sw * 0.8), off = (q() < 0.5 ? -1 : 1) * q.range(0.3, 0.95), lx = b.x + al * c + off * s2, lz = b.z - al * s2 + off * c, sz = q.range(0.14, 0.3);
      rest('stone', lx, lz, sz * 1.5, sz * q.range(0.5, 0.9), sz, q.range(-0.3, 0.3), q() * TAU, q.range(-0.3, 0.3), gH(lx, lz), sz * 0.08); }
    for (const jb of plan.beams) { const L = jb.len; rest(TIM, jb.lx, jb.lz, 0.17, 0.17, L, jb.rx, jb.ry, jb.rz, 0, 0.01, 'z'); }
    // the chimney: its hearth and the stack over it stand when all else is down
    if (plan.chimney) {
      const sx = plan.chimney.sx, hx = sx * (w / 2 - 0.24), top = snapC(plan.chimney.h), X = (a) => hx - sx * a, bx = (a, y0, c, y1, z0, z1) => K.box('stone', Math.min(X(a), X(c)), y0, z0, Math.max(X(a), X(c)), y1, z1);
      bx(0, 0, 0.2, 1.6, -0.62, 0.62); bx(0.2, 0, 0.85, 1.28, -0.62, -0.38); bx(0.2, 0, 0.85, 1.28, 0.38, 0.62); bx(0.2, 1.28, 0.85, 1.6, -0.62, 0.62);
      bx(0, 1.6, 0.72, 2.24, -0.52, 0.52); bx(0, 2.24, 0.62, top, -0.42, 0.42); bx(0, top, 0.62, top + COURSE, -0.42, 0.05 + q.range(-0.2, 0.2));
      K.quadTo('dark', [X(0.21), 0, -0.38], [X(0.21), 0, 0.38], [X(0.21), 1.28, 0.38], [X(0.21), 1.28, -0.38], -sx, 0, 0);
      K.push(new THREE.Matrix4().makeRotationY(-sx * PI / 2).setPosition(X(0.862), 0, 0)); soot(-0.6, 0.6, 1.3, 3.2, 0); K.pop();
    }
    for (const sb of plan.stones14) rest('stone', sb.lx, sb.lz, sb.sz, sb.sz * 0.6, sb.sz * 0.8, sb.rx, sb.ry, sb.rz, gH(sb.lx, sb.lz), sb.sz * 0.12);
  } else {
    // a standing house has a little of the same about its walls, outside
    for (const sb of plan.stones14) if (Math.abs(sb.lx) > w / 2 + 0.7 || Math.abs(sb.lz) > d / 2 + 0.7) rest('stone', sb.lx, sb.lz, sb.sz, sb.sz * 0.6, sb.sz * 0.8, sb.rx, sb.ry, sb.rz, gH(sb.lx, sb.lz), sb.sz * 0.12);
  }
  return info;
}

// the smoke-stain over a burnt opening: black, strongest at the lintel, thinning upward and to the sides
let _sootTex = null;
export function sootMaterial() {
  if (!_sootTex) {
    const s = 64, c = document.createElement('canvas'); c.width = s; c.height = s * 2; const x = c.getContext('2d'), im = x.createImageData(s, s * 2), r = rng(4711);
    const col = []; for (let i = 0; i < s; i++) col.push(0.55 + r() * 0.45);
    for (let j = 0; j < s * 2; j++) for (let i = 0; i < s; i++) {
      const u = i / (s - 1), v = 1 - j / (s * 2 - 1), side = Math.pow(Math.sin(u * PI), 0.8), up = Math.pow(1 - v, 1.6) * smooth(clamp(v / 0.06, 0, 1));
      const a = clamp(side * up * (0.75 + 0.5 * col[i] * (1 - v * 0.3)) * 1.05, 0, 1) * 255, p = (j * s + i) * 4;
      im.data[p] = im.data[p + 1] = im.data[p + 2] = a; im.data[p + 3] = 255;
    }
    x.putImageData(im, 0, 0); _sootTex = new THREE.CanvasTexture(c); _sootTex.colorSpace = THREE.NoColorSpace;
  }
  return new THREE.MeshStandardMaterial({ color: 0x060504, roughness: 1, metalness: 0, transparent: true, alphaMap: _sootTex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}
