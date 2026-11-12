// The Black Hound's body: a wolf the size of a horse, starved. One skinned hide lofted ring by ring round the bones of a
// real dog's skeleton (the shoulder blades and the points of the hips standing up, the ribs showing through where the
// mange has taken the coat, the loin tucked up to nothing); a wolf's skull, broad behind and heavy in the muzzle, with a
// stop before the eyes; lips that draw back off the teeth (four snarl bones under the hide); compact paws with pads and
// blunt claws. Over the hide a coat of matted locks (alpha cards that lie with the grain of the fur, longest in the ruff
// and the hackles down his back, which rise when he means to kill); a short fur grain and a wrinkled skin in the maps.
// Every tooth, claw, eye and lock is rooted inside the hide and skinned to the same bones as the hide it grows from.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './util.js';

const V3 = THREE.Vector3;
const h3 = (x, y, z) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vn(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); let fx = x - i, fy = y - j, fz = z - k;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(h3(i, j, k), h3(i + 1, j, k), fx), lerp(h3(i, j + 1, k), h3(i + 1, j + 1, k), fx), fy);
  const b = lerp(lerp(h3(i, j, k + 1), h3(i + 1, j, k + 1), fx), lerp(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), fx), fy);
  return lerp(a, b, fz);
}
const fbm = (x, y, z) => vn(x, y, z) * 0.55 + vn(x * 2.13 + 5, y * 2.13, z * 2.13) * 0.3 + vn(x * 4.31, y * 4.31 + 9, z * 4.31) * 0.15;
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const ss = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const TILE = 0.3;   // metres of hide to one repeat of the fur and skin maps

// ---------------------------------------------------------------- the skeleton (rest pose, metres; +z forward, +x his left)
const HEAD = [0, 1.96, 1.74];
const Hf = (x, y, z) => [x, HEAD[1] + y, HEAD[2] + z];   // the head's own frame (the joint at the back of the skull) to the body's
export const HOUND_JOINTS = (() => {
  const J = [
    ['hips', null, 0, 1.62, -1.05], ['loin', 'hips', 0, 1.66, -0.55], ['ribs', 'loin', 0, 1.68, 0], ['chest', 'ribs', 0, 1.72, 0.55],
    ['neck1', 'chest', 0, 1.68, 0.95], ['neck2', 'neck1', 0, 1.83, 1.36], ['head', 'neck2', ...HEAD],
    ['jaw', 'head', ...Hf(0, -0.075, 0.05)], ['tongue', 'jaw', ...Hf(0, -0.128, 0.3)], ['lipLo', 'jaw', ...Hf(0, -0.13, 0.47)],
    ['lipL', 'head', ...Hf(0.075, -0.085, 0.4)], ['lipR', 'head', ...Hf(-0.075, -0.085, 0.4)],
    ['tail1', 'hips', 0, 1.62, -1.36], ['tail2', 'tail1', 0, 1.5, -1.7], ['tail3', 'tail2', 0, 1.25, -1.95], ['tail4', 'tail3', 0, 0.97, -2.08],
    ['ribL', 'ribs', 0.3, 1.36, 0.2], ['ribR', 'ribs', -0.3, 1.36, 0.2],
  ];
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    J.push(['ear' + k, 'head', ...Hf(s * 0.1, 0.135, 0.035)]);
    J.push(['fscap' + k, 'chest', s * 0.17, 1.74, 0.4], ['farm' + k, 'fscap' + k, s * 0.29, 1.24, 0.68], ['ffore' + k, 'farm' + k, s * 0.3, 0.93, 0.36], ['fpast' + k, 'ffore' + k, s * 0.3, 0.33, 0.415], ['fpaw' + k, 'fpast' + k, s * 0.3, 0.07, 0.5]);
    J.push(['bthigh' + k, 'hips', s * 0.22, 1.5, -1.1], ['bshin' + k, 'bthigh' + k, s * 0.3, 0.96, -0.8], ['bmeta' + k, 'bshin' + k, s * 0.3, 0.52, -1.36], ['bpaw' + k, 'bmeta' + k, s * 0.3, 0.07, -1.26]);
  }
  return J.map(([name, parent, x, y, z]) => ({ name, parent, abs: [x, y, z] }));
})();
export const HOUND_PAW_Y = 0.07;   // how high the paw joint rides over the ground when the pads are down

// ---------------------------------------------------------------- mesh building
// skin weights: [[bone, w], ...] of any length; the same bone summed, the four heaviest kept
function w4(w, idx) {
  const b = [], x = [];
  for (const e of w) { if (!(e[1] > 1e-5)) continue; const i = idx[e[0]], k = b.indexOf(i); if (k >= 0) x[k] += e[1]; else { b.push(i); x.push(e[1]); } }
  const o = b.map((_, k) => k).sort((p, q) => x[q] - x[p]).slice(0, 4); let t = 0; for (const k of o) t += x[k];
  const si = [0, 0, 0, 0], sw = [0, 0, 0, 0]; o.forEach((k, n) => { si[n] = b[k]; sw[n] = x[k] / t; }); return [si, sw];
}
class MB {
  constructor(idx) { this.idx = idx; this.pos = []; this.col = []; this.surf = []; this.uv = []; this.si = []; this.sw = []; this.ind = []; this.weld = []; this.n = 0; }
  // s: [wet, heat, wrinkle (where the snarl creases the hide), fur (1 a full coat, 0 bare skin)]
  v(p, uv, c, s, w) {
    this.pos.push(p[0], p[1], p[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); this.surf.push(s[0] || 0, s[1] || 0, s[2] || 0, s[3] ?? 1);
    const [si, sw] = Array.isArray(w[0]) ? w4(w, this.idx) : w; this.si.push(...si); this.sw.push(...sw);
    return this.n++;
  }
  wOf(i) { return [this.si.slice(i * 4, i * 4 + 4), this.sw.slice(i * 4, i * 4 + 4)]; }
  P(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  tri(a, b, c) { this.ind.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.ind); g.computeVertexNormals();
    const N = g.attributes.normal;   // the seam of each ring is two vertices in one place: give them one normal
    for (const [a, b] of this.weld) { const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1; N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l); }
    g.computeBoundingSphere(); g.boundingSphere.radius *= 1.6; return g;
  }
}
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
// rings of `seg` points (each from ring(i, j) -> { p, uv, c, s, w }) stitched into a tube; the seam welded
function rings(M, nR, seg, ring, flip = false) {
  const base = M.n;
  for (let i = 0; i < nR; i++) { for (let j = 0; j <= seg; j++) { const r = ring(i, j % seg, j); M.v(r.p, r.uv, r.c, r.s, r.w); } M.weld.push([base + i * (seg + 1), base + i * (seg + 1) + seg]); }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < seg; j++) { const a = base + i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1; if (flip) { M.tri(a, c, b); M.tri(b, c, d); } else { M.tri(a, b, c); M.tri(b, d, c); } }
  return base;
}
// an open sheet: rows i, columns j = 0..nC inclusive
function grid(M, nR, nC, fn, flip = false) {
  const base = M.n;
  for (let i = 0; i < nR; i++) for (let j = 0; j <= nC; j++) { const r = fn(i, j); M.v(r.p, r.uv, r.c, r.s, r.w); }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < nC; j++) { const a = base + i * (nC + 1) + j, b = a + 1, c = a + nC + 1, d = c + 1; if (flip) { M.tri(a, c, b); M.tri(b, c, d); } else { M.tri(a, b, c); M.tri(b, d, c); } }
  return base;
}

// ---------------------------------------------------------------- the hide
// mange: where the coat has gone (side, y, z, radius, strength; side 0 both)
const MANGE = [[1, 1.32, -0.02, 0.3, 0.42], [-1, 1.44, -0.98, 0.2, 0.32], [-1, 1.46, 0.5, 0.15, 0.26], [1, 1.78, 1.18, 0.12, 0.3], [0, 1.18, -1.92, 0.3, 0.45], [0, 1.0, 0.1, 0.38, 0.22], [1, 1.45, -0.62, 0.16, 0.22]];
// old cuts, opened again: they run black (side, y0, z0, y1, z1, r)
const WOUNDS = [[1, 1.55, 0.06, 1.2, -0.12, 0.022], [1, 1.5, 0.22, 1.26, 0.05, 0.016], [-1, 1.52, -1.02, 1.24, -0.9, 0.024], [-1, 1.86, 1.28, 1.66, 1.18, 0.016], [1, 1.62, -0.66, 1.42, -0.58, 0.014]];
function coat(p, o = {}) {
  const x = p[0], y = p[1], z = p[2], ax = Math.abs(x);
  let bare = fbm(x * 2.3 + 3, y * 2.3, z * 2.0 + 11) - 0.56 + (o.bare || 0);
  for (const [s, cy, cz, r, k] of MANGE) { if (s && s * x < 0.02) continue; const d = Math.hypot(s ? ax - 0.28 : 0, y - cy, z - cz) / r; bare += k * Math.exp(-d * d); }
  bare += 0.08 * (vn(x * 11, y * 11, z * 11) - 0.5);
  const fur = o.fur ?? (1 - ss(-0.03, 0.06, bare));
  const f = 0.017 + 0.02 * fbm(x * 6, y * 6, z * 6), fc = [f * 1.06, f, f * 0.96];
  const sk = 0.65 + 0.7 * fbm(x * 13, y * 13, z * 13), dead = ss(0.5, 0.72, fbm(x * 5 + 20, y * 5, z * 5));
  const skin = [lerp(0.078, 0.028, dead) * sk, lerp(0.066, 0.025, dead) * sk, lerp(0.064, 0.028, dead) * sk];
  let c = mix3(skin, fc, fur), wet = (1 - fur) * 0.12;
  if (!o.noWounds && ax > 0.08) for (const [s, y0, z0, y1, z1, r] of WOUNDS) {
    if (x * s < 0) continue;
    const dy = y1 - y0, dz = z1 - z0, t = clamp(((y - y0) * dy + (z - z0) * dz) / (dy * dy + dz * dz), 0, 1), d = Math.hypot(y - y0 - dy * t, z - z0 - dz * t);
    const rr = r * (0.35 + 0.65 * Math.sin(Math.PI * clamp(t, 0.02, 0.98)));
    if (d < rr * 2.8) {
      const core = 1 - ss(0, rr, d), edge = 1 - ss(rr, rr * 2.6, d);
      c = mix3(c, [0.1, 0.095, 0.092], edge * 0.6); c = mix3(c, [0.004, 0.004, 0.005], core); wet = Math.max(wet, edge * 0.45 + core * 0.55);
    }
    const zz = z0 + dz * clamp((y - y0) / dy, 0, 1), below = Math.min(y0, y1) - y;   // what has run out of it, black, down the flank
    if (below > -0.3 && below < 0.45 && Math.abs(z - zz) < 0.14) {
      const streak = ss(0.45, 0.65, vn(z * 55, s * 3, 1.5)) * (1 - ss(0, 0.18 + 0.27 * vn(z * 40, 2, s), below)) * ss(-0.3, 0, below) * ss(0, 0.05, 0.14 - Math.abs(z - zz));
      c = mix3(c, [0.004, 0.004, 0.005], streak * 0.9); wet = Math.max(wet, streak * 0.8);
    }
  }
  return { c, wet, fur };
}

// A tube of rings along stations S: { c: [x, y, z], w (half-width), f, b (half-depths to the front/top and the
// back/underside), e (squareness), n (rings to the next station), bi (place among `bones`, fractional) }.
// Every centreline lies in a fore-and-aft plane, so a ring is spanned by X (his left) and the normal of the line.
function loft(M, S, o) {
  const seg = o.seg, C = [];
  const at = (k, key, sub) => { const a = S[Math.max(0, k - 1)], b = S[k], c = S[Math.min(S.length - 1, k + 1)], d = S[Math.min(S.length - 1, k + 2)]; return (t) => (sub === undefined ? cr(a[key] ?? 0, b[key] ?? 0, c[key] ?? 0, d[key] ?? 0, t) : cr(a[key][sub], b[key][sub], c[key][sub], d[key][sub], t)); };
  for (let k = 0; k < S.length - 1; k++) {
    const n = S[k].n || 4, fx = at(k, 'c', 0), fy = at(k, 'c', 1), fz = at(k, 'c', 2), fw = at(k, 'w'), ff = at(k, 'f'), fb = at(k, 'b');
    for (let i = 0; i < n + (k === S.length - 2 ? 1 : 0); i++) {
      const t = i / n, lin = (key, def) => lerp(S[k][key] ?? def, S[k + 1][key] ?? def, smooth(t)), lo = (key) => Math.min(S[k][key], S[k + 1][key]) * 0.9;
      C.push({ c: [fx(t), fy(t), fz(t)], w: Math.max(lo('w'), fw(t)), f: Math.max(lo('f'), ff(t)), b: Math.max(lo('b'), fb(t)), e: lin('e', 0.92), bi: lerp(S[k].bi ?? 0, S[k + 1].bi ?? 0, t), u: k + t });
    }
  }
  const nR = C.length; let arc = 0;
  const fr = C.map((R0, i) => { const a = C[Math.max(0, i - 1)].c, b = C[Math.min(nR - 1, i + 1)].c; let ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(ty, tz) || 1; ty /= tl; tz /= tl; return { ty, tz }; });
  const base = rings(M, nR, seg, (i, j, jj) => {
    const R0 = C[i], { ty, tz } = fr[i], ny = tz, nz = -ty;
    if (jj === 0 && i) arc += Math.hypot(R0.c[0] - C[i - 1].c[0], R0.c[1] - C[i - 1].c[1], R0.c[2] - C[i - 1].c[2]);
    const th = -Math.PI / 2 + j / seg * TAU, cs = Math.cos(th), sn = Math.sin(th), e = R0.e;
    const sx = Math.sign(cs) * Math.pow(Math.abs(cs), e) * R0.w, sy = Math.sign(sn) * Math.pow(Math.abs(sn), e) * (sn >= 0 ? R0.f : R0.b);
    const P = [R0.c[0] + sx, R0.c[1] + ny * sy, R0.c[2] + nz * sy];
    const q = { i, j, u: R0.u, th, cs, sn, c: R0.c, P, R: R0, arc, t: [0, ty, tz] };
    if (o.disp) { const d = o.disp(q); if (d) { const l = Math.hypot(sx, ny * sy, nz * sy) || 1; P[0] += sx / l * d; P[1] += ny * sy / l * d; P[2] += nz * sy / l * d; } }
    const per = Math.max(1, Math.round(TAU * Math.sqrt((R0.w * R0.w + ((R0.f + R0.b) / 2) ** 2) / 2) / TILE));
    const pt = o.paint ? o.paint(q) : coat(P, o.hide);
    let w;
    if (o.weights) w = o.weights(q);
    else { const k0 = clamp(Math.floor(R0.bi), 0, o.bones.length - 1), k1 = Math.min(o.bones.length - 1, k0 + 1), f = smooth(clamp(R0.bi - k0, 0, 1)); w = [[o.bones[k0], 1 - f + 1e-4], [o.bones[k1], f + 1e-4]]; }
    if (o.card && jj < seg) { const cd = o.card(q, pt); if (cd) o.cards.push({ vi: M.n, ...cd, comb: cd.comb || [0, -ty, -tz] }); }
    return { p: P, uv: [j / seg * per, arc / TILE], c: pt.c, s: [pt.wet || 0, pt.heat || 0, pt.wr || 0, pt.fur ?? 1], w };
  });
  return base;
}
// A tube whose every ring is a closed outline (a half-profile of K points from the top of the midline down his left
// side to the bottom of it, mirrored for his right) given at stations along z of a frame `F`: rows
// [z, y0, x1, y1, ... x(K-2), y(K-2), y(K-1), n]. The loop starts at the bottom of the midline (the seam), goes up his
// left side and down his right. q.t is the place on the half-profile (0 the top point .. K-1 the bottom one).
function secLoft(M, ST, K, o) {
  const R = [];
  for (let k = 0; k < ST.length - 1; k++) {
    const n = ST[k][ST[k].length - 1];
    for (let i = 0; i < n + (k === ST.length - 2 ? 1 : 0); i++) { const t = i / n, a = ST[Math.max(0, k - 1)], b = ST[k], c = ST[k + 1], d = ST[Math.min(ST.length - 1, k + 2)]; R.push(b.map((_, x) => cr(a[x], b[x], c[x], d[x], t))); }
  }
  const m = o.m || 4, nL = 2 * (K - 1), seg = nL * m, out = [];
  for (const row of R) {   // the outline of each ring: half-profile points, then the loop resampled
    const H = [[0, row[1]]]; for (let p = 1; p < K - 1; p++) H.push([row[2 * p], row[2 * p + 1]]); H.push([0, row[2 * K - 2]]);
    const L = []; for (let p = K - 1; p >= 0; p--) L.push(H[p]); for (let p = 1; p < K - 1; p++) L.push([-H[p][0], H[p][1]]);
    const pts = [];
    for (let s = 0; s < nL; s++) for (let i = 0; i < m; i++) {
      const f = i / m, A = L[(s - 1 + nL) % nL], B = L[s], C = L[(s + 1) % nL], D = L[(s + 2) % nL];
      pts.push({ x: cr(A[0], B[0], C[0], D[0], f), y: cr(A[1], B[1], C[1], D[1], f), t: s < K - 1 ? K - 1 - (s + f) : s + f - (K - 1), side: s < K - 1 ? 1 : -1 });
    }
    let per = 0; for (let j = 0; j < seg; j++) { const a = pts[j], b = pts[(j + 1) % seg]; a.arc = per; per += Math.hypot(b.x - a.x, b.y - a.y); }
    for (let j = 0; j < seg; j++) { const a = pts[(j - 1 + seg) % seg], b = pts[(j + 1) % seg], tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1; pts[j].nx = ty / l; pts[j].ny = -tx / l; }
    out.push({ z: row[0], pts, per });
  }
  let arc = 0;
  return rings(M, out.length, seg, (i, j, jj) => {
    const r = out[i], p = r.pts[j]; if (jj === 0 && i) arc += Math.abs(r.z - out[i - 1].z);
    const q = { i, j, z: r.z, x: p.x, y: p.y, t: p.t, side: p.x > 1e-4 ? 1 : p.x < -1e-4 ? -1 : p.side, nx: p.nx, ny: p.ny, last: i === out.length - 1 };
    const d = o.disp ? o.disp(q) : 0, L = [p.x + p.nx * d, p.y + p.ny * d, r.z]; q.L = L; q.P = o.F(...L);
    const pt = o.paint(q), uv = [(jj === seg ? r.per : p.arc) / TILE, arc / TILE];
    if (o.card && jj < seg) { const cd = o.card(q, pt); if (cd) o.cards.push({ vi: M.n, ...cd }); }
    return { p: q.P, uv, c: pt.c, s: [pt.wet || 0, pt.heat || 0, pt.wr || 0, pt.fur ?? 1], w: o.weights(q) };
  }, o.flip);
}
// a tooth, a claw: from root (sunk in the gum or the toe) along d, its section rx by rz (rz along `along`), curving
// toward `bend`; `blade` makes it a flat triangle (a shearing tooth) instead of a cone
function spike(M, root, d, len, rx, rz, along, bend, col, tipCol, w, wet = 0.6, blade = 0) {
  const D = new V3(...d).normalize(), Z = new V3(...along); Z.addScaledVector(D, -Z.dot(D)); if (Z.lengthSq() < 1e-6) Z.set(1, 0, 0); Z.normalize();
  const X = new V3().crossVectors(D, Z).normalize(), Bn = new V3(...bend), sides = 6, NR = 4;
  rings(M, NR + 1, sides, (i, j) => {
    const t = i / NR, k = blade ? 1 - t : 1 - t * t * 0.96, c = new V3(...root).addScaledVector(D, len * t).addScaledVector(Bn, len * t * t), a = j / sides * TAU;
    const q = c.addScaledVector(X, Math.cos(a) * rx * (blade ? 1 - 0.5 * t : k)).addScaledVector(Z, Math.sin(a) * rz * k);
    return { p: [q.x, q.y, q.z], uv: [j / sides * 0.1, t * 0.1], c: mix3(col, tipCol, ss(0.1, 1, t)), s: [wet, 0, 0, 0], w };
  }, true);
}

// ---------------------------------------------------------------- the head: stations in the head's frame (metres)
// the skull: [z, top, upper side x y, widest x y, lower side x y, lip edge x y, gum x y, palate, rings to the next]
const HST = [
  [-0.1, 0.04, 0.04, 0.03, 0.06, -0.01, 0.055, -0.05, 0.04, -0.065, 0.025, -0.065, -0.065, 2],
  [-0.05, 0.12, 0.08, 0.1, 0.125, 0.02, 0.11, -0.065, 0.08, -0.098, 0.05, -0.095, -0.098, 3],
  [0.04, 0.163, 0.1, 0.14, 0.168, 0.025, 0.152, -0.07, 0.122, -0.112, 0.09, -0.106, -0.11, 3],
  [0.12, 0.172, 0.1, 0.15, 0.176, 0.035, 0.158, -0.062, 0.128, -0.112, 0.098, -0.105, -0.11, 3],
  [0.2, 0.148, 0.088, 0.13, 0.142, 0.05, 0.128, -0.05, 0.106, -0.115, 0.085, -0.104, -0.105, 2],
  [0.26, 0.103, 0.068, 0.094, 0.1, 0.032, 0.098, -0.058, 0.095, -0.115, 0.075, -0.1, -0.1, 2],
  [0.33, 0.077, 0.056, 0.07, 0.086, 0.02, 0.089, -0.06, 0.087, -0.112, 0.068, -0.097, -0.097, 3],
  [0.42, 0.066, 0.05, 0.06, 0.078, 0.01, 0.081, -0.06, 0.079, -0.108, 0.06, -0.094, -0.094, 3],
  [0.5, 0.058, 0.045, 0.052, 0.07, 0.0, 0.073, -0.058, 0.071, -0.104, 0.052, -0.09, -0.09, 2],
  [0.56, 0.05, 0.04, 0.045, 0.06, -0.005, 0.062, -0.055, 0.058, -0.095, 0.04, -0.085, -0.085, 2],
  [0.6, 0.044, 0.035, 0.038, 0.048, -0.006, 0.046, -0.05, 0.036, -0.077, 0.02, -0.07, -0.07, 1],
  [0.618, 0.02, 0.016, 0.017, 0.022, -0.01, 0.02, -0.03, 0.015, -0.05, 0.008, -0.05, -0.05, 1],
  [0.624, 0.0, 0.002, -0.004, 0.003, -0.012, 0.003, -0.02, 0.002, -0.03, 0.001, -0.03, -0.03, 1],
];
// the lower jaw: [z, floor of the mouth, gum inner x y, gum outer x y, lip edge x y, side x y, under x y, chin, n]
const JST = [
  [-0.06, -0.15, 0.01, -0.148, 0.02, -0.146, 0.03, -0.15, 0.03, -0.16, 0.02, -0.17, -0.17, 1],
  [-0.03, -0.128, 0.035, -0.122, 0.062, -0.12, 0.08, -0.126, 0.086, -0.165, 0.055, -0.196, -0.192, 2],
  [0.04, -0.13, 0.06, -0.12, 0.085, -0.115, 0.1, -0.122, 0.102, -0.165, 0.07, -0.2, -0.195, 3],
  [0.12, -0.135, 0.068, -0.12, 0.09, -0.113, 0.1, -0.12, 0.095, -0.16, 0.065, -0.192, -0.19, 3],
  [0.22, -0.135, 0.062, -0.118, 0.078, -0.112, 0.088, -0.12, 0.083, -0.155, 0.058, -0.18, -0.18, 3],
  [0.34, -0.13, 0.05, -0.115, 0.064, -0.11, 0.07, -0.12, 0.066, -0.15, 0.047, -0.168, -0.17, 3],
  [0.45, -0.125, 0.038, -0.112, 0.05, -0.108, 0.054, -0.118, 0.05, -0.145, 0.036, -0.16, -0.162, 2],
  [0.53, -0.12, 0.028, -0.11, 0.04, -0.105, 0.045, -0.115, 0.043, -0.14, 0.03, -0.155, -0.156, 2],
  [0.575, -0.116, 0.016, -0.11, 0.026, -0.104, 0.032, -0.11, 0.03, -0.13, 0.02, -0.142, -0.144, 1],
  [0.592, -0.112, 0.005, -0.108, 0.01, -0.106, 0.013, -0.11, 0.012, -0.12, 0.008, -0.128, -0.13, 1],
  [0.597, -0.115, 0.001, -0.115, 0.002, -0.115, 0.002, -0.116, 0.002, -0.118, 0.001, -0.12, -0.12, 1],
];
// a value of a station table at z (linear between rows): column c
const stAt = (ST, z, c) => { if (z <= ST[0][0]) return ST[0][c]; for (let k = 0; k < ST.length - 1; k++) if (z <= ST[k + 1][0]) return lerp(ST[k][c], ST[k + 1][c], (z - ST[k][0]) / (ST[k + 1][0] - ST[k][0])); return ST[ST.length - 1][c]; };
const EYE = [0.088, 0.064, 0.222], EYE_R = 0.023;   // where the eye sits (his left; head frame) and its size

let _tpl = null;
export function buildHoundModel() {
  if (_tpl) return _tpl;
  const joints = HOUND_JOINTS, idx = {}; joints.forEach((j, i) => (idx[j.name] = i));
  const M = new MB(idx), cards = [], parts = [];
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // ---- trunk and neck: the croup, the tucked loin, the deep narrow keel of the ribs, the withers, a thick neck
  const spine = ['hips', 'loin', 'ribs', 'chest', 'neck1', 'neck2', 'head'], sp = spine.map((n) => joints[idx[n]].abs);
  const spineBi = (c) => {   // where along the spine a ring lies: k - 0.5 at joint k
    let best = 0, bd = 1e9;
    for (let k = 0; k < sp.length - 1; k++) { const a = sp[k], b = sp[k + 1], dy = b[1] - a[1], dz = b[2] - a[2], t = ((c[1] - a[1]) * dy + (c[2] - a[2]) * dz) / (dy * dy + dz * dz), tc = clamp(t, 0, 1), d = Math.hypot(c[1] - a[1] - dy * tc, c[2] - a[2] - dz * tc); if (d < bd) { bd = d; best = k + (k === 0 ? Math.min(t, 1) : k === sp.length - 2 ? Math.max(t, 0) : tc); } }
    return best - 0.5;
  };
  const T = [
    [1.5, -1.5, 0.01, 0.01, 0.01, 2], [1.5, -1.45, 0.15, 0.14, 0.17, 3], [1.49, -1.29, 0.232, 0.2, 0.27, 5], [1.5, -1.03, 0.24, 0.18, 0.25, 6],
    [1.53, -0.73, 0.185, 0.15, 0.19, 6], [1.52, -0.48, 0.17, 0.15, 0.22, 7], [1.45, -0.2, 0.235, 0.25, 0.33, 8], [1.38, 0.1, 0.28, 0.33, 0.43, 8],
    [1.36, 0.4, 0.29, 0.41, 0.44, 7], [1.4, 0.66, 0.275, 0.39, 0.4, 6], [1.52, 0.88, 0.25, 0.3, 0.36, 6], [1.66, 1.1, 0.215, 0.25, 0.27, 6],
    [1.79, 1.36, 0.19, 0.21, 0.22, 5], [1.88, 1.58, 0.165, 0.18, 0.18, 4], [1.94, 1.76, 0.12, 0.13, 0.13, 2], [1.96, 1.84, 0.01, 0.01, 0.01, 1],
  ].map(([y, z, w, f, b, n]) => ({ c: [0, y, z], w, f, b, n, e: 0.9 }));
  const ribZone = (z) => ss(-0.48, -0.32, z) * (1 - ss(0.42, 0.72, z));
  const groove = (q) => { const z = q.c[2], y = q.P[1], fl = Math.pow(Math.abs(q.cs), 0.7) * ss(-0.92, -0.42, q.sn) * (1 - ss(0.45, 0.8, q.sn)); return ribZone(z) * fl * (0.5 - 0.5 * Math.cos(TAU * (z + 0.32 * (y - 1.3)) / 0.1)); };
  const trunkPaint = (q) => {
    const z = q.c[2], under = ss(0.55, 0.9, -q.sn), r = coat(q.P, { bare: 0.22 * ribZone(z) * Math.abs(q.cs) + 0.28 * under + 0.12 * gauss(z, -0.6, 0.3) - 0.4 * ss(0.7, 0.9, q.sn) });
    const g = groove(q) * (1 - 0.6 * r.fur), k = (1 - 0.6 * g) * (1 - 0.3 * under);
    return { c: r.c.map((v) => v * k), wet: r.wet, fur: r.fur };
  };
  loft(M, T, {
    seg: 36, cards,
    weights: (q) => {
      const bi = spineBi(q.c), k0 = clamp(Math.floor(bi), 0, 6), k1 = Math.min(6, k0 + 1), fr = bi < 0 ? 0 : smooth(clamp(bi - k0, 0, 1));
      const w = [[spine[k0], 1 - fr + 1e-4], [spine[k1], fr + 1e-4]], z = q.c[2], s = q.cs > 0 ? 'L' : 'R', y = q.P[1];
      const br = ribZone(z) * Math.pow(Math.abs(q.cs), 1.5) * 0.45 * (1 - ss(0.4, 0.8, q.sn)); if (br > 0.02) w.push([q.cs > 0 ? 'ribL' : 'ribR', br]);   // the flanks breathe
      const sc = gauss(z, 0.5, 0.2) * ss(0.25, 0.8, Math.abs(q.cs)) * ss(1.15, 1.45, y) * (1 - ss(0.7, 0.95, q.sn)) * 0.55; if (sc > 0.02) w.push(['fscap' + s, sc]);   // the shoulder blade moves under the hide
      const ar = gauss(z, 0.6, 0.16) * ss(0.5, 0.9, Math.abs(q.cs)) * gauss(y, 1.12, 0.18) * 0.4; if (ar > 0.02) w.push(['farm' + s, ar]);
      const th = gauss(z, -1.12, 0.2) * ss(0.4, 0.9, Math.abs(q.cs)) * ss(1.15, 1.45, 3 - y) * gauss(y, 1.35, 0.18) * 0.5; if (th > 0.02) w.push(['bthigh' + s, th]);
      return w;
    },
    disp: (q) => {
      const z = q.c[2], a = Math.abs(q.th - Math.PI / 2); let d = -0.016 * groove(q);
      const body = ss(-1.3, -1.1, z) * (1 - ss(0.7, 1.0, z));
      if (q.sn > 0.6) {   // the spine: a ridge, each vertebra a knob on it, tall at the withers; hollows either side
        d += gauss(q.th, Math.PI / 2, 0.14) * body * (0.012 + 0.018 * (0.5 + 0.5 * Math.cos(TAU * z / 0.085)) + 0.03 * gauss(z, 0.42, 0.22));
        d -= 0.026 * body * gauss(a, 0.36, 0.13) * (1 - 0.6 * gauss(z, -1.05, 0.25));
      }
      d += 0.05 * gauss(z, -0.98, 0.1) * gauss(a, 0.78, 0.2) + 0.03 * gauss(z, -1.3, 0.08) * gauss(a, 0.5, 0.2);   // the points of the hips, the pin bones
      d -= 0.035 * gauss(z, -0.62, 0.22) * Math.abs(q.cs) * (q.sn > -0.6 ? 1 : 0.4);    // the flank fallen in behind the ribs
      d -= 0.022 * gauss(z, 0.28, 0.18) * gauss(q.th, 0, 0.45) * ss(0.2, 0.7, q.cs) + 0.022 * gauss(z, 0.28, 0.18) * gauss(q.th, Math.PI, 0.45) * ss(0.2, 0.7, -q.cs);   // behind the shoulder
      d += 0.025 * gauss(z, 0.5, 0.12) * gauss(a, 0.9, 0.25) * (q.sn > 0 ? 1 : 0);    // the top of the shoulder blade
      if (q.sn < -0.75) d += 0.02 * gauss(q.th, -Math.PI / 2, 0.2) * gauss(z, 0.45, 0.35);   // the keel of the breastbone
      if (z > 0.95) { d += 0.012 * gauss(q.th, -Math.PI / 2, 0.22); d -= 0.014 * gauss(Math.abs(q.cs), 0.75, 0.2) * (q.sn < 0 ? 1 : 0.3); }   // windpipe, the sinews of the neck
      return d;
    },
    paint: trunkPaint,
    card: (q, pt) => {   // the coat: hackles down the neck and back, a ruff round the neck, thin over the ribs, ragged under the belly
      if (pt.fur < 0.4) return null;
      const z = q.c[2], top = gauss(q.th, Math.PI / 2, 0.36), under = ss(0.45, 0.85, -q.sn), side = Math.abs(q.cs);
      let p, len, stand = 0.32, droop = 0.25, hack = 0, wd = 0.055;
      if (top > 0.35 && z > -0.7 && z < 1.72) { p = 1.2 * top; len = 0.12 + 0.12 * gauss(z, 1.05, 0.5) + 0.06 * gauss(z, 0.45, 0.25); stand = 0.5; droop = 0.12; hack = top * ss(-0.7, -0.3, z); wd = 0.07; }
      else if (z > 0.72) { p = 0.95; len = 0.13 + 0.12 * under + 0.05 * side; stand = 0.36; droop = 0.25 + 0.5 * under; hack = 0.45 * (1 - under) * ss(0.85, 1.2, z); wd = 0.075; }
      else if (under > 0.3) { p = 0.32; len = 0.07 + 0.07 * under; droop = 0.9; stand = 0.2; }
      else { p = 0.5 - 0.25 * ribZone(z) * side; len = 0.07 + 0.04 * gauss(z, -1.1, 0.3) + 0.03 * gauss(z, 0.55, 0.25); stand = 0.25; }
      if (rnd() > p * ss(0.4, 0.8, pt.fur)) return null;
      const comb = [0, -q.t[1] - 0.55 * side * (1 - top), -q.t[2]];   // back along him, and down his sides
      return { len: len * (0.7 + 0.6 * rnd()), stand: stand * (0.7 + 0.6 * rnd()), droop, hack, wd: wd * (0.75 + 0.5 * rnd()), comb };
    },
  });

  // ---- the tail: a bony whip, held low, half bare
  loft(M, [[1.6, -1.34, 0.08, 0], [1.56, -1.52, 0.065, 0.6], [1.46, -1.74, 0.05, 1.5], [1.26, -1.94, 0.037, 2.5], [1.0, -2.07, 0.027, 3.5], [0.8, -2.11, 0.018, 4], [0.68, -2.12, 0.004, 4]].map(([y, z, r, bi]) => ({ c: [0, y, z], w: r, f: r, b: r, n: 5, bi })), {
    seg: 10, bones: ['hips', 'tail1', 'tail2', 'tail3', 'tail4'], cards, hide: { noWounds: true },
    disp: (q) => 0.005 * Math.cos(TAU * q.arc / 0.07) * (q.sn > 0 ? 1 : 0.3),
    card: (q, pt) => (pt.fur > 0.5 && rnd() < 0.55 ? { len: 0.08 + 0.1 * rnd() * (1 - q.u / 7), stand: 0.4, droop: 0.4, hack: 0, wd: 0.05, comb: [0, -q.t[1], -q.t[2]] } : null),
  });

  // ---- legs: the shoulder blade lying on the ribs, the upper arm, the point of the elbow, the long lean forearm, the
  // wrist, the pastern; the broad flat thigh, the stifle, the gaskin, the Achilles cord to the point of the hock
  const legCard = (top) => (q, pt) => {
    const y = q.c[1]; if (pt.fur < 0.45 || y < 0.5) return null;
    const back = ss(0.2, 0.8, -q.sn), p = (y > top ? 0.55 : 0.18 + 0.3 * back) * ss(0.45, 0.8, pt.fur);
    if (rnd() > p) return null;
    return { len: (y > top ? 0.07 + 0.05 * rnd() : 0.04 + 0.05 * back * rnd()) * (1 + 0.6 * back), stand: 0.25, droop: 0.3, hack: 0, wd: 0.05, comb: [0, -1, -0.15] };
  };
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const mk = (rows) => rows.map(([x, y, z, w, f, b, bi, n]) => ({ c: [s * x, y, z], w, f, b, bi, n: n || 4, e: 0.9 }));
    loft(M, mk([[0.14, 1.8, 0.36, 0.02, 0.04, 0.04, 1, 2], [0.19, 1.66, 0.44, 0.05, 0.14, 0.12, 1, 4], [0.24, 1.46, 0.55, 0.075, 0.17, 0.15, 1.3, 4], [0.28, 1.27, 0.64, 0.095, 0.16, 0.19, 1.8, 4],
      [0.3, 1.1, 0.55, 0.09, 0.12, 0.2, 2.2, 4], [0.3, 0.96, 0.41, 0.072, 0.1, 0.12, 2.6, 3], [0.3, 0.84, 0.38, 0.07, 0.085, 0.1, 3, 4], [0.3, 0.62, 0.39, 0.055, 0.058, 0.064, 3, 4],
      [0.3, 0.45, 0.4, 0.044, 0.044, 0.047, 3, 3], [0.3, 0.36, 0.41, 0.052, 0.05, 0.056, 3.5, 3], [0.3, 0.24, 0.44, 0.044, 0.042, 0.045, 4, 3], [0.3, 0.14, 0.47, 0.05, 0.048, 0.05, 4.5, 2], [0.3, 0.1, 0.49, 0.025, 0.025, 0.025, 5, 1]]), {
      seg: 16, bones: ['chest', 'fscap' + k, 'farm' + k, 'ffore' + k, 'fpast' + k, 'fpaw' + k], cards, hide: { bare: 0.05 },
      disp: (q) => {
        const y = q.c[1], out = q.cs * s > 0 ? 1 : 0; let d = 0;
        if (y > 1.25) d += 0.02 * gauss(q.th, 0, 0.5) * out * gauss(y, 1.52, 0.2) - 0.012 * out * gauss(Math.abs(q.sn), 0.55, 0.2) * gauss(y, 1.5, 0.2);   // the spine of the blade, a hollow each side
        d += 0.025 * gauss(y, 0.98, 0.06) * ss(0.4, 0.9, -q.sn);   // the point of the elbow
        d += 0.022 * gauss(y, 1.12, 0.12) * ss(0.2, 0.8, -q.sn) * (0.6 + 0.4 * out);   // the triceps
        if (y < 0.88 && y > 0.4) d += 0.008 * gauss(y, 0.72, 0.14) * ss(0, 0.6, q.sn) + 0.004 * Math.cos(q.th * 4) * ss(0.42, 0.6, y);   // the forearm's muscles, the tendons below
        d += 0.01 * gauss(y, 0.36, 0.03) * (q.sn > 0 ? 1 : 0.5);   // the knob of the wrist
        return d;
      },
      card: legCard(1.0),
    });
    loft(M, mk([[0.17, 1.68, -1.12, 0.03, 0.1, 0.1, 0.5, 2], [0.22, 1.52, -1.1, 0.11, 0.2, 0.22, 1, 4], [0.26, 1.3, -1.02, 0.12, 0.21, 0.24, 1, 4], [0.29, 1.1, -0.93, 0.1, 0.15, 0.21, 1.3, 4],
      [0.3, 0.97, -0.84, 0.075, 0.1, 0.13, 1.7, 3], [0.3, 0.86, -0.94, 0.068, 0.08, 0.13, 2, 4], [0.3, 0.7, -1.12, 0.05, 0.052, 0.082, 2, 4], [0.3, 0.58, -1.3, 0.043, 0.043, 0.05, 2.3, 3],
      [0.3, 0.5, -1.37, 0.044, 0.05, 0.062, 2.7, 3], [0.3, 0.36, -1.33, 0.04, 0.04, 0.045, 3, 3], [0.3, 0.18, -1.29, 0.04, 0.04, 0.042, 3, 3], [0.3, 0.12, -1.27, 0.048, 0.046, 0.048, 3.5, 2], [0.3, 0.1, -1.26, 0.025, 0.025, 0.025, 4, 1]]), {
      seg: 16, bones: ['hips', 'bthigh' + k, 'bshin' + k, 'bmeta' + k, 'bpaw' + k], cards, hide: { bare: 0.05 },
      disp: (q) => {
        const y = q.c[1], out = q.cs * s > 0 ? 1 : 0; let d = 0;
        if (y > 1.0) d -= 0.016 * out * gauss(q.sn, -0.15, 0.25) * gauss(y, 1.25, 0.18);   // the groove between the thigh muscles
        if (y > 1.05) d += 0.014 * out * gauss(q.sn, 0.4, 0.3) * gauss(y, 1.32, 0.12);
        d += 0.016 * gauss(y, 0.82, 0.08) * ss(0.3, 0.9, -q.sn);   // the gastrocnemius
        if (y < 0.75 && y > 0.5) d -= 0.008 * gauss(Math.abs(q.cs), 0.85, 0.25) * ss(-0.6, 0, -q.sn);   // the Achilles cord stands off the bone
        d += 0.014 * gauss(y, 0.51, 0.04) * ss(0.4, 0.9, -q.sn);   // the point of the hock
        return d;
      },
      card: legCard(0.92),
    });
    // feet: a compact pad of a foot, four knuckled toes, short blunt claws; a dew claw high on the inside of the fore
    for (const [bone, pz, front] of [['fpaw' + k, 0.5, 1], ['bpaw' + k, -1.26, 0]]) {
      const sc = front ? 1 : 0.92, X = s * 0.3, w = [[bone, 1]];
      const padPaint = (q) => { const r = coat(q.P, { noWounds: true, fur: 0.85 }), pad = ss(0.35, 0.75, -q.sn); return { c: mix3(r.c.map((v) => v * 0.8), [0.012, 0.011, 0.011], pad), wet: 0.08, fur: 1 - pad }; };
      loft(M, [[0.075, -0.09, 0.01, 0.01, 0.01, 1], [0.075, -0.075, 0.045, 0.045, 0.06, 2], [0.07, -0.035, 0.074, 0.06, 0.065, 2], [0.065, 0.01, 0.086, 0.055, 0.062, 2], [0.058, 0.05, 0.082, 0.045, 0.054, 2], [0.05, 0.08, 0.066, 0.035, 0.045, 1], [0.045, 0.095, 0.02, 0.02, 0.02, 1]]
        .map(([y, z, ww, f, b, n]) => ({ c: [X, y, pz + z * sc], w: ww * sc, f, b, n, e: 0.85 })), { seg: 14, weights: () => w, paint: padPaint });
      [-0.064, -0.023, 0.023, 0.064].forEach((dx, ti) => {
        const outer = ti === 0 || ti === 3, L = (outer ? 0.07 : 0.085) * sc, x0 = X + dx * 0.85 * sc, x1 = X + dx * 1.08 * sc, z0 = pz + (outer ? 0.02 : 0.035) * sc, r = 0.03 * sc;
        loft(M, [[x0, 0.045, z0, 0.8], [lerp(x0, x1, 0.5), 0.038, z0 + L * 0.5, 1.05], [x1, 0.032, z0 + L * 0.88, 0.85], [x1, 0.03, z0 + L + 0.012, 0.15]].map(([x, y, z, rr]) => ({ c: [x, y, z], w: r * rr * 0.95, f: r * rr, b: r * rr, n: 2, e: 0.9 })), { seg: 8, weights: () => w, paint: padPaint });
        parts.push({ kind: 'claw', root: [x1, 0.03, z0 + L - 0.006] }); spike(M, [x1, 0.03, z0 + L - 0.006], [dx * 0.6, -0.45, 1], 0.05 * sc, 0.011, 0.013, [0, 1, 0], [0, -0.02, 0], [0.025, 0.023, 0.021], [0.09, 0.085, 0.078], w, 0.35);
      });
      if (front) {
        const xi = X - s * 0.026, wD = [[bone === 'fpaw' + k ? 'fpast' + k : bone, 1]];
        loft(M, [[xi, 0.235, 0.455, 0.6], [xi - s * 0.02, 0.2, 0.47, 1], [xi - s * 0.03, 0.17, 0.48, 0.6], [xi - s * 0.033, 0.16, 0.482, 0.1]].map(([x, y, z, rr]) => ({ c: [x, y, z], w: 0.016 * rr, f: 0.016 * rr, b: 0.016 * rr, n: 2 })), { seg: 6, weights: () => wD, paint: padPaint });
        parts.push({ kind: 'dewclaw', root: [xi, 0.235, 0.455] }); spike(M, [xi - s * 0.03, 0.172, 0.481], [-s * 0.3, -1, 0.5], 0.035, 0.007, 0.009, [0, 0, 1], [0, 0, -0.01], [0.025, 0.023, 0.021], [0.09, 0.085, 0.078], wD, 0.35);
      }
    }
  }

  // ---- the head
  const F = Hf, hBase = M.n;
  const lipW = (t, z) => ss(2.2, 3.8, t) * (1 - ss(4.4, 5.0, t)) * ss(0.17, 0.3, z) * (1 - 0.25 * ss(0.52, 0.6, z));
  const bridgeW = (t, z) => (1 - ss(0.8, 1.8, t)) * gauss(z, 0.4, 0.09) * 0.3;
  const torn = (q) => (q.side > 0 ? gauss(q.z, 0.43, 0.045) : 0);   // his left upper lip rotted away over the teeth
  secLoft(M, HST, 7, {
    m: 4, F, cards,
    disp: (q) => {
      const z = q.z, t = q.t, x = Math.abs(q.L ? q.L[0] : q.x); let d = 0;
      const eD = Math.hypot(Math.abs(q.x) - EYE[0], q.y - EYE[1], (z - EYE[2]) * 0.8);
      d -= 0.016 * Math.exp(-((eD / 0.032) ** 2));                                  // the orbit, deep
      d += 0.012 * Math.exp(-(((Math.abs(q.x) - EYE[0] + 0.01) / 0.03) ** 2) - (((q.y - EYE[1] - 0.035) / 0.016) ** 2) - (((z - EYE[2] + 0.01) / 0.04) ** 2));   // the brow over it
      d += 0.014 * gauss(z, 0.14, 0.05) * gauss(q.y, 0.0, 0.035) * ss(1.5, 2.2, t) * (1 - ss(2.6, 3.2, t));   // the cheekbone
      d -= 0.018 * gauss(z, 0.06, 0.07) * gauss(t, 1.2, 0.5);                       // the temple fallen in (he is starving)
      d += 0.012 * gauss(t, 0, 0.3) * (1 - ss(0.0, 0.18, z));                       // the crest of the skull
      d -= 0.008 * gauss(t, 0, 0.35) * gauss(z, 0.265, 0.04);                       // the stop
      d += 0.012 * gauss(z, 0.08, 0.06) * gauss(t, 3.0, 0.5);                       // the jaw muscle
      d -= 0.008 * gauss(z, 0.38, 0.1) * gauss(t, 2.0, 0.45);                       // the hollow along the muzzle under the eye
      d += 0.008 * gauss(z, 0.5, 0.035) * gauss(t, 3.2, 0.5);                       // the root of the fang under the lip
      d -= 0.01 * Math.exp(-(((x - 0.022) / 0.009) ** 2) - (((q.y - 0.005) / 0.012) ** 2)) * ss(0.59, 0.615, z);   // the nostrils
      d -= 0.004 * gauss(x, 0, 0.006) * ss(0.58, 0.61, z) * (q.y < 0 ? 1 : 0.3);   // the cleft of the nose
      d -= 0.022 * torn(q) * gauss(t, 3.9, 0.45);                                   // the lip eaten away
      return d;
    },
    weights: (q) => { const l = lipW(q.t, q.z) * (1 - 0.6 * torn(q)), b = bridgeW(q.t, q.z), sL = q.side > 0 ? 1 : q.side < 0 ? 0 : 0.5; return [['head', Math.max(1e-3, 1 - l - b)], ['lipL', (l + b) * sL], ['lipR', (l + b) * (1 - sL)]]; },
    paint: (q) => {
      const z = q.z, t = q.t, P = q.P;
      if (t > 4.6) {   // the palate: ridged, black and slate, wet; a dull heat far back in the throat
        const rid = 0.75 + 0.25 * Math.cos(TAU * z / 0.045), back = 1 - ss(0, 0.3, z), m = vn(z * 40, q.x * 40, 1) > 0.55 ? 0.4 : 1;
        return { c: [0.045 * rid * m * (1 - 0.6 * back), 0.032 * rid * m * (1 - 0.65 * back), 0.036 * rid * m * (1 - 0.65 * back)], wet: 0.95, heat: back, fur: 0 };
      }
      const r = coat(P, { noWounds: true, fur: 1 - 0.4 * ss(0.35, 0.55, z) * ss(1.5, 3, t) });
      let c = r.c, wet = r.wet, fur = r.fur;
      const eD = Math.hypot(Math.abs(q.x) - EYE[0], q.y - EYE[1], z - EYE[2]); c = c.map((v) => v * (0.25 + 0.75 * ss(EYE_R * 0.9, EYE_R * 1.9, eD)));   // the black rims of the lids
      const scar = ss(0.006, 0, Math.abs((z - 0.3) * 0.45 + Math.abs(q.x) * 0.9 - 0.12)) * (z > 0.27 && z < 0.5 && t < 2.6 && q.side < 0 ? 1 : 0);   // an old pale cut across the muzzle
      c = mix3(c, [0.11, 0.105, 0.1], scar); fur *= 1 - scar;
      const lip = ss(3.3, 4.0, t), gum = ss(4.0, 4.4, t), tr = torn(q) * ss(2.8, 3.8, t);
      if (lip > 0) { c = mix3(c, [0.01, 0.009, 0.009], lip); wet = Math.max(wet, lip * 0.55); fur *= 1 - lip; }   // the black lips
      if (gum > 0 || tr > 0) {   // the gums: black, mottled slate where the pigment has gone
        const g = Math.max(gum, tr), mot = vn(z * 70, t * 9, q.side * 3) > 0.58 ? [0.075, 0.05, 0.055] : [0.018, 0.015, 0.017];
        c = mix3(c, mot, g); wet = Math.max(wet, g * 0.85); fur *= 1 - g;
      }
      const nose = ss(0.575, 0.6, z) * ss(-0.06, -0.03, q.y); c = mix3(c, [0.008, 0.008, 0.009], nose); wet = Math.max(wet, nose * 0.8); fur *= 1 - nose;
      const wr = (1 - ss(1.0, 2.6, t)) * gauss(z, 0.39, 0.08) + 0.6 * gauss(t, 3.1, 0.5) * gauss(z, 0.3, 0.07);
      return { c, wet, heat: 0, wr, fur };
    },
    card: (q, pt) => {   // short fur on the skull, a ruff along the cheeks and the back of the jaw
      if (pt.fur < 0.6 || q.z > 0.3 || q.t > 3.6) return null;
      const cheek = gauss(q.t, 2.6, 0.7) * (1 - ss(0.14, 0.26, q.z)), p = 0.12 + 0.75 * cheek;
      if (rnd() > p) return null;
      return { len: 0.035 + 0.07 * cheek * (0.6 + 0.8 * rnd()), stand: 0.3, droop: 0.2, hack: 0, wd: 0.04, comb: [q.side * 0.4 * cheek, -0.2 - 0.3 * cheek, -1] };
    },
  });
  const hEnd = M.n;
  // the lower jaw
  const jBase = M.n;
  secLoft(M, JST, 7, {
    m: 4, F, cards,
    weights: (q) => { const lw = ss(2.3, 3.0, q.t) * (1 - ss(3.2, 4.0, q.t)) * ss(0.3, 0.45, q.z); return [['jaw', Math.max(1e-3, 1 - lw)], ['lipLo', lw]]; },
    paint: (q) => {
      const z = q.z, t = q.t;
      if (t < 2.2) { const back = 1 - ss(0, 0.3, z), g = ss(0.9, 1.6, t); return { c: mix3([0.04 * (1 - 0.6 * back), 0.03 * (1 - 0.65 * back), 0.034 * (1 - 0.65 * back)], [0.02, 0.016, 0.018], g), wet: 0.95, heat: back * (1 - g), fur: 0 }; }
      const r = coat(q.P, { noWounds: true, fur: 0.9 }), lip = 1 - ss(3.0, 3.8, t);
      return { c: mix3(r.c, [0.01, 0.009, 0.009], lip), wet: Math.max(r.wet, lip * 0.6), fur: r.fur * (1 - lip) };
    },
    card: (q, pt) => { if (q.t < 4.2 || pt.fur < 0.6 || q.z > 0.42 || rnd() > 0.4) return null; return { len: 0.04 + 0.06 * rnd() * (1 - q.z), stand: 0.25, droop: 0.7, hack: 0, wd: 0.04, comb: [0, -0.5, -1] }; },
  });
  // the tongue, lying in the trough of the jaw
  loft(M, [[0.06, 0.04, 0], [0.18, 0.05, 0.1], [0.36, 0.045, 0.7], [0.5, 0.034, 1], [0.56, 0.022, 1], [0.575, 0.004, 1]].map(([z, w, bi]) => ({ c: Hf(0, stAt(JST, z, 1) + 0.004 - 0.012 * gauss(z, 0.2, 0.15), z), w, f: 0.012, b: 0.012, n: 3, bi, e: 0.8 })), {
    seg: 10, bones: ['jaw', 'tongue'],
    paint: (q) => { const sp = vn(q.P[0] * 70, q.P[2] * 70, 3) > 0.6 ? 0.5 : 1, mid = 1 - 0.35 * gauss(q.th, Math.PI / 2, 0.12); return { c: [0.06 * sp * mid, 0.04 * sp * mid, 0.05 * sp * mid], wet: 0.95, heat: 0.1, fur: 0 }; },
  });
  // the cheek between the jaws, stretched when they open
  for (const s of [1, -1]) {
    const NZ = 7, NC = 4;
    grid(M, NZ + 1, NC, (i, j) => {
      const z = lerp(-0.01, 0.215, i / NZ), t = j / NC, xu = stAt(HST, z, 8) - 0.006, yu = stAt(HST, z, 9) + 0.004, xl = stAt(JST, z, 6) - 0.006, yl = stAt(JST, z, 7) - 0.004;
      const x = s * (lerp(xu, xl, t) - 0.008 * Math.sin(Math.PI * t)), y = lerp(yu, yl, t), edge = Math.sin(Math.PI * t);
      return { p: F(x, y, z), uv: [t * 0.3, z], c: [0.012 + 0.02 * edge, 0.01 + 0.014 * edge, 0.011 + 0.016 * edge], s: [0.7, 0.2 * edge, 0, 0], w: [['head', 1 - t + 1e-3], ['jaw', t + 1e-3]] };
    }, s < 0);
  }
  // ---- teeth: yellowed and stained brown at the gum; every root sunk in the gum of its jaw
  const TC = [0.16, 0.11, 0.055], TT = [0.5, 0.44, 0.32];
  const upG = (z) => [stAt(HST, z, 10), stAt(HST, z, 11)], loG = (z) => [(stAt(JST, z, 2) + stAt(JST, z, 4)) / 2, Math.max(stAt(JST, z, 3), stAt(JST, z, 5))];
  const tooth = (up, s, z, xa, crown, rx, rz, blade, tilt = 0, fwd = 0, curve = 0) => {
    const [gx, gy] = up ? upG(z) : loG(z), X = s * (xa ?? gx), sg = up ? -1 : 1, sink = 0.014, d = [s * tilt, sg, fwd];
    const root = F(X - s * tilt * sink, gy - sg * sink, z - fwd * sink);
    parts.push({ kind: 'tooth', root: root.slice(), up });
    spike(M, root, d, crown + sink, rx, rz, [0, 0, 1], [0, 0, -curve], TC, TT, [[up ? 'head' : 'jaw', 1]], 0.65, blade);
  };
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) { const z = 0.596 - i * 0.011 - i * i * 0.002; tooth(true, s, z, 0.008 + i * 0.013, 0.017 + i * 0.003, 0.006, 0.0045, 0, 0, 0.12); tooth(false, s, z - 0.012, 0.007 + i * 0.011, 0.014 + i * 0.002, 0.0055, 0.004, 0, 0, 0.18); }
    tooth(true, s, 0.52, null, 0.068, 0.015, 0.017, 0, 0.24, 0.05, 0.022);       // the fangs
    tooth(false, s, 0.545, null, 0.052, 0.012, 0.014, 0, 0.08, 0.18, 0.018);
    [[0.472, 0.012, 0.006], [0.432, 0.018, 0.009], [0.375, 0.023, 0.012], [0.29, 0.032, 0.02], [0.225, 0.016, 0.012], [0.185, 0.011, 0.01]].forEach(([z, c, r]) => tooth(true, s, z, null, c, r * 0.42, r, 1, 0.06));   // premolars, the shearing tooth, molars
    [[0.49, 0.012, 0.006], [0.435, 0.017, 0.009], [0.375, 0.021, 0.011], [0.315, 0.024, 0.012], [0.245, 0.028, 0.019], [0.19, 0.012, 0.009]].forEach(([z, c, r]) => tooth(false, s, z, null, c, r * 0.42, r, 1, -0.04));
    // spittle: strings from the upper gums to the lower, which stretch as he opens his mouth; one hangs from the lip
    for (const [z, rr] of [[0.31, 0.0026], [0.39, 0.0022], [0.455, 0.0018]]) {
      const [ux, uy] = upG(z), [lx, ly] = loG(z + 0.01), a = F(s * (ux + 0.004), uy - 0.004, z), b = F(s * (lx + 0.006), ly + 0.003, z + 0.01);
      parts.push({ kind: 'spit', root: a, end: b });
      rings(M, 7, 4, (i, j) => { const t = i / 6, ang = j / 4 * TAU, r = rr * (1 - 0.55 * Math.sin(Math.PI * t)); return { p: [lerp(a[0], b[0], t) + Math.cos(ang) * r, lerp(a[1], b[1], t), lerp(a[2], b[2], t) + Math.sin(ang) * r], uv: [0, 0], c: [0.16, 0.16, 0.15], s: [1, 0, 0, 0], w: [['head', 1 - t + 1e-3], ['jaw', t + 1e-3]] }; });
    }
    const dz = s > 0 ? 0.47 : 0.36, [dlx, dly] = [stAt(JST, dz, 6), stAt(JST, dz, 7)], top = F(s * (dlx - 0.004), dly + 0.004, dz);
    parts.push({ kind: 'drool', root: top });
    rings(M, 7, 4, (i, j) => { const t = i / 6, ang = j / 4 * TAU, r = (s > 0 ? 0.003 : 0.0024) * (1 - 0.6 * t) + 0.0008 * gauss(t, 0.95, 0.08) * 4; return { p: [top[0] + s * 0.004 * t + Math.cos(ang) * r, top[1] - (s > 0 ? 0.11 : 0.07) * t, top[2] - 0.01 * t + Math.sin(ang) * r], uv: [0, 0], c: [0.16, 0.16, 0.15], s: [1, 0, 0, 0], w: [['jaw', 1]] }; });
  }
  // ---- ears: cupped, thick at the root, ragged; his right one torn short and notched
  const headN = (L) => { const yc = (stAt(HST, L[2], 1) + stAt(HST, L[2], 12)) / 2; const l = Math.hypot(L[0], L[1] - yc) || 1; return [L[0] / l, (L[1] - yc) / l, 0]; };
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const hgt = s > 0 ? 0.175 : 0.13, base = [s * 0.098, 0.13, 0.035], n0 = headN(base), U = new V3(s * 0.32, 1, -0.22).normalize(), F0 = new V3(s * 0.62, 0, 0.78);
    F0.addScaledVector(U, -F0.dot(U)).normalize(); const A = new V3().crossVectors(U, F0).normalize(), C0 = new V3(base[0] - n0[0] * 0.018, base[1] - n0[1] * 0.018, base[2]);
    parts.push({ kind: 'ear', root: F(C0.x, C0.y, C0.z) });
    const NR = 7, NS = 12;
    rings(M, NR, NS, (i, j) => {
      const t = i / (NR - 1), ph = j / NS * TAU, a = Math.cos(ph), b = Math.sin(ph);
      let wd = 0.056 * Math.pow(1 - t, 0.8) + 0.003; if (s > 0 && a > 0) wd *= 1 - 0.45 * gauss(t, 0.5, 0.07); if (s < 0) wd *= 1 - 0.3 * gauss(t, 0.85, 0.12) * (a < 0 ? 1 : 0.2);
      const th = 0.011 * (1 - t) + 0.0025, cup = 0.026 * Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.1));
      const c = C0.clone().addScaledVector(U, hgt * t * (1 + 0.15 * t * t * a * (s > 0 ? 1 : -1) * 0)).addScaledVector(F0, -0.015 * t);
      const p = c.addScaledVector(A, a * wd).addScaledVector(F0, b * th - cup * (1 - a * a) * (b > 0 ? 1 : 0.85));
      const inside = ss(0.1, 0.6, b) * ss(0.15, 0.4, 1 - a * a), r = coat([p.x, p.y + HEAD[1], p.z + HEAD[2]], { noWounds: true, fur: 1 - 0.5 * inside });
      const cc = mix3(r.c, [0.05, 0.042, 0.042], inside * (1 - 0.6 * t));
      return { p: F(p.x, p.y, p.z), uv: [j / NS * 0.4, t * 0.6], c: cc, s: [0, 0, 0, 1 - inside], w: t < 0.08 ? [['head', 1]] : t < 0.2 ? [['head', 0.4], ['ear' + k, 0.6]] : [['ear' + k, 1]] };
    }, s < 0);
  }

  // ---- where the eyes go: sunk in their orbits, a little under the surface of the lids
  const eyes = [];
  for (const s of [1, -1]) {
    let bi = -1, bd = 1e9; const tgt = [s * EYE[0], EYE[1], EYE[2]];
    for (let i = hBase; i < hEnd; i++) { const p = M.P(i), d = Math.hypot(p[0] - tgt[0], p[1] - HEAD[1] - tgt[1], p[2] - HEAD[2] - tgt[2]); if (d < bd) { bd = d; bi = i; } }
    const p = M.P(bi), n = new V3(s * 0.55, 0.12, 0.82).normalize();
    eyes.push({ c: [p[0] - n.x * EYE_R * 0.42, p[1] - n.y * EYE_R * 0.42, p[2] - n.z * EYE_R * 0.42], dir: [n.x, n.y, n.z], r: EYE_R, surf: p });
  }

  const geo = M.geometry();
  // ---- the coat: locks of matted hair grown from the hide, lying with the grain
  const cgeo = buildCards(geo, cards, rnd);
  return (_tpl = { joints, idx, geo, cgeo, eyes, parts, ranges: { head: [hBase, hEnd], jaw: [jBase, M.n] }, M });
}

// each lock: a strip of three rows from a root a little under the hide, out along the grain, bowed by its weight;
// lit with the normal of the hide it grows from (so the coat shades as one)
function buildCards(geo, cards, rnd) {
  const P = geo.attributes.position, N = geo.attributes.normal, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const n = cards.length, NV = n * 6, pos = new Float32Array(NV * 3), nrm = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), col = new Float32Array(NV * 3), root = new Float32Array(NV * 3), hk = new Float32Array(NV);
  const si = new Uint16Array(NV * 4), sw = new Float32Array(NV * 4), ind = new Uint32Array(n * 12);
  const nv = new V3(), cb = new V3(), sd = new V3(), d0 = new V3(), r0 = new V3(), c = new V3(), t1 = new V3(), down = new V3(0, -1, 0);
  let v = 0;
  cards.forEach((C, ci) => {
    nv.fromBufferAttribute(N, C.vi).normalize(); r0.fromBufferAttribute(P, C.vi);
    cb.set(...C.comb); cb.addScaledVector(nv, -cb.dot(nv)); if (cb.lengthSq() < 1e-6) cb.set(0, -1, 0).addScaledVector(nv, -nv.y); cb.normalize();
    sd.crossVectors(nv, cb).normalize();
    r0.addScaledVector(sd, (rnd() - 0.5) * 0.04).addScaledVector(cb, (rnd() - 0.5) * 0.03).addScaledVector(nv, -0.007);   // scattered off the ring, rooted under the hide
    const tw = (rnd() - 0.5) * 0.7; cb.applyAxisAngle(nv, tw); sd.crossVectors(nv, cb).normalize();
    d0.copy(cb).multiplyScalar(Math.cos(C.stand)).addScaledVector(nv, Math.sin(C.stand)).normalize();
    const L = C.len, wd = C.wd, col0 = (rnd() * 4) | 0, tint = 0.7 + 0.6 * rnd(), base = v;
    for (let r = 0; r < 3; r++) {
      const u = r / 2; c.copy(r0).addScaledVector(d0, L * u).addScaledVector(down, L * u * u * C.droop * 0.45).addScaledVector(nv, -L * u * u * 0.12);
      const hw = wd * (0.5 - 0.15 * u);
      for (const e of [-1, 1]) {
        t1.copy(c).addScaledVector(sd, e * hw);
        pos.set([t1.x, t1.y, t1.z], v * 3); nrm.set([nv.x, nv.y, nv.z], v * 3); root.set([r0.x, r0.y, r0.z], v * 3); hk[v] = C.hack || 0;
        uv.set([(col0 + (e > 0 ? 1 : 0)) / 4, u], v * 2); col.set([tint, tint, tint], v * 3);
        for (let k = 0; k < 4; k++) { si[v * 4 + k] = SI.getComponent(C.vi, k); sw[v * 4 + k] = SW.getComponent(C.vi, k); }
        v++;
      }
    }
    const o = ci * 12; for (let r = 0; r < 2; r++) { const a = base + r * 2; ind.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o + r * 6); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aRoot', new THREE.BufferAttribute(root, 3)); g.setAttribute('aHack', new THREE.BufferAttribute(hk, 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(ind, 1)); g.computeBoundingSphere(); g.boundingSphere.radius *= 1.6;
  return g;
}

// ---------------------------------------------------------------- textures (typed arrays: no canvas, so they build anywhere)
const _lat = new Map();
const tn = (x, y, px, py, s = 3) => {   // tiling value noise (its lattice cached per period and seed)
  const key = px * 1e6 + py * 1e3 + s; let T = _lat.get(key);
  if (!T) { T = new Float32Array(px * py); for (let b = 0; b < py; b++) for (let a = 0; a < px; a++) T[b * px + a] = h3(a, b, s); _lat.set(key, T); }
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const i0 = ((i % px) + px) % px, j0 = ((j % py) + py) % py, i1 = (i0 + 1) % px, j1 = (j0 + 1) % py;
  return lerp(lerp(T[j0 * px + i0], T[j0 * px + i1], u), lerp(T[j1 * px + i0], T[j1 * px + i1], u), v);
};
function dataTex(d, W, H, srgb) { const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }
// a height field to a normal map, with an albedo factor in the alpha
function bake(W, H, hgt, alb, k) {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, at = (xx, yy) => hgt[((yy + H) % H) * W + ((xx + W) % W)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k, l = Math.hypot(dx, dy, 1);
    out[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); out[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); out[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); out[o + 3] = Math.round(255 * clamp(alb[i], 0, 1));
  }
  return out;
}
let _tex = null;
function houndTextures() {
  if (_tex) return _tex;
  const W = 256, H = 256, fh = new Float32Array(W * H), fa = new Float32Array(W * H), sh = new Float32Array(W * H), sa = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H, i = y * W + x;
    // fur: strands along v, gathered into wet clumps, broken off at random lengths
    const warp = tn(u * 6, v * 3, 6, 3) * 1.4 + tn(u * 24, v * 6, 24, 6) * 0.3, s = u * 56 + warp * 2.2, k = Math.floor(s), f = s - k;
    const brk = tn(k, v * 9, 56, 9, 7), clump = tn(u * 10 + warp, v * 4, 10, 4, 5);
    const ridge = Math.pow(Math.sin(Math.PI * f), 1.4) * (0.45 + 0.55 * ss(0.25, 0.6, brk));
    fh[i] = ridge * 0.7 + clump * 0.5; fa[i] = 0.35 + 0.55 * ridge * (0.6 + 0.4 * clump) + 0.1 * clump;
    // skin: folds across the grain, pores, scabs
    const fold = tn(u * 5 + tn(u * 3, v * 3, 3, 3) * 0.8, v * 22, 5, 22, 2), pore = tn(u * 90, v * 90, 90, 90, 9), scab = tn(u * 14, v * 14, 14, 14, 4);
    sh[i] = Math.pow(fold, 2) * 0.8 + pore * 0.18 + ss(0.62, 0.8, scab) * 0.5; sa[i] = 0.65 + 0.35 * fold - 0.25 * ss(0.62, 0.8, scab) + 0.15 * pore;
  }
  return (_tex = { fur: dataTex(bake(W, H, fh, fa, 3.2), W, H, false), skin: dataTex(bake(W, H, sh, sa, 2.4), W, H, false), card: cardTexture() });
}
// four locks side by side (64 x 256 each): tapered hairs from the root (v = 0) gathering into wet points at the tips
function cardTexture() {
  const W = 256, H = 256, A = new Float32Array(W * H), L = new Float32Array(W * H);
  let seed = 101; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let col = 0; col < 4; col++) {
    const x0 = col * 64, cl = [12 + rnd() * 10, 30 + rnd() * 6, 46 + rnd() * 8];
    for (let s = 0; s < 40; s++) {
      const rx = 4 + rnd() * 56, tgt = cl.reduce((a, b) => (Math.abs(b - rx) < Math.abs(a - rx) ? b : a)), conv = 0.55 + 0.4 * rnd(), len = H * (0.45 + 0.55 * rnd()), w0 = 1.3 + 1.5 * rnd(), cur = (rnd() - 0.5) * 7, shade = 0.55 + 0.7 * rnd();
      const steps = Math.ceil(len * 0.8);
      for (let q = 0; q <= steps; q++) {
        const t = q / steps, y = t * len, x = lerp(rx, tgt, conv * Math.pow(t, 1.2)) + cur * t * t, r = w0 * (1 - 0.82 * t);
        const rr = Math.ceil(r + 0.5), cx = Math.round(x), cy = Math.round(y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -rr; dx <= rr; dx++) {
          const px = cx + dx, py = cy + dy; if (px < 1 || px > 62 || py < 0 || py >= H) continue;
          const cov = clamp(r + 0.5 - Math.hypot(px - x, py - y), 0, 1) * (1 - 0.25 * t); if (cov <= 0) continue;
          const i = py * W + x0 + px; if (cov > A[i]) { A[i] = cov; L[i] = shade * (0.55 + 0.9 * t); }
        }
      }
    }
  }
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const l = L[i] || 0.7, c = 0.03 * l, e = (v) => Math.round(255 * Math.pow(clamp(v, 0, 1), 1 / 2.2)); out[i * 4] = e(c * 1.05); out[i * 4 + 1] = e(c); out[i * 4 + 2] = e(c * 0.95); out[i * 4 + 3] = Math.round(255 * clamp(A[i] * 1.15, 0, 1)); }
  const t = dataTex(out, W, H, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// ---------------------------------------------------------------- materials
// The hide: vertex colour; the fur grain or the bare skin (aSurf.w) in the albedo and the normals; wet (aSurf.x) at the
// mouth, the nose, the wounds; aSurf.y the throat, where a dull heat shows when uHeat is raised; aSurf.z where the
// snarl creases the muzzle (uSnarl). A soft sheen for the coat, a cold edge of moonlight so he reads in the dark. He
// burns away in the same embers as every other demon when he dies.
const DISSOLVE = `
      float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }`;
export function houndMaterial() {
  const T = houndTextures();
  const u = { uDissolve: { value: 0 }, uHit: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 }, uRim: { value: 0.22 }, uHackle: { value: 0 }, uSnarl: { value: 0 }, uShine: { value: 1 }, uSkin: { value: T.skin } };
  const mat = new THREE.MeshPhysicalMaterial({ normalMap: T.fur, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 0.6, metalness: 0, sheen: 1, sheenColor: new THREE.Color(0.2, 0.21, 0.23), sheenRoughness: 0.5, side: THREE.DoubleSide });
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aSurf; varying vec4 vSurf; varying vec3 vDPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position; vSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vSurf; varying vec3 vDPos; uniform float uDissolve, uHit, uHeat, uTime, uRim, uSnarl; uniform sampler2D uSkin;` + DISSOLVE)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dnz = dn(vDPos * 6.0) * 0.65 + dn(vDPos * 17.0) * 0.35;
      if (uDissolve > 0.0 && dnz < uDissolve) discard;
      float wrk = uSnarl * vSurf.z * (0.5 + 0.5 * cos(vDPos.z * 150.0 + sin(vDPos.x * 60.0) * 1.5));`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= mix(texture2D(uSkin, vNormalMapUv * 1.4).a, texture2D(normalMap, vNormalMapUv).a, vSurf.w) * 1.45 * (1.0 - 0.55 * wrk);`)
      .replace('mapN.xy *= normalScale;', `{ vec3 sN = texture2D(uSkin, vNormalMapUv * 1.4).xyz * 2.0 - 1.0; mapN = mix(sN, mapN, vSurf.w); }
      mapN.xy *= normalScale; mapN.y += 1.4 * uSnarl * vSurf.z * sin(vDPos.z * 150.0 + sin(vDPos.x * 60.0) * 1.5);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.13, vSurf.x);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.85, 0.2, 0.03) * vSurf.y * vSurf.y * uHeat * (0.7 + 0.3 * sin(uTime * 6.0 + vDPos.z * 11.0 + vDPos.y * 7.0));
      totalEmissiveRadiance += vec3(0.55, 0.62, 0.75) * uRim * (0.35 + 0.65 * vSurf.w) * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.5);
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit;
      if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 6.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dnz));`);
  };
  mat.customProgramCacheKey = () => 'hound-v4';
  return mat;
}
// the coat's locks: alpha-cut, lit as the hide they grow from; the hackles stand up off the back when uHackle rises
function coatMaterial(u) {
  const T = houndTextures();
  const mat = new THREE.MeshStandardMaterial({ map: T.card, alphaTest: 0.36, alphaToCoverage: true, vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoot; attribute float aHack; uniform float uHackle; varying vec3 vDPos; varying float vTip;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 off = transformed - aRoot; float L = length(off); if (aHack > 0.0 && L > 1e-4) transformed = aRoot + normalize(mix(off / L, normal, clamp(uHackle * aHack, 0.0, 1.0) * 0.8)) * L; }
      vDPos = transformed; vTip = uv.y;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDPos; varying float vTip; uniform float uDissolve, uHit, uRim;' + DISSOLVE)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dnz = dn(vDPos * 6.0) * 0.65 + dn(vDPos * 17.0) * 0.35;
      if (uDissolve > 0.0 && dnz < uDissolve + 0.05) discard;`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal); nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.55, 0.62, 0.75) * uRim * (0.5 + 0.8 * vTip) * pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit;`);
  };
  mat.customProgramCacheKey = () => 'hound-coat-v1';
  return mat;
}
// the eyes: a wolf's, pale amber round a great black pupil, wet; the pupil throws back a cold green-white shine when he
// looks straight at you (the tapetum, as any dog's eyes do in a lantern's light)
function eyeMaterial(u) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uShine = u.uShine; sh.uniforms.uDissolve = u.uDissolve;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vEL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEL = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vEL; uniform float uShine, uDissolve;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uDissolve > 0.45) discard;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      vec3 e = normalize(vEL); float r = acos(clamp(e.z, -1.0, 1.0)), an = atan(e.y, e.x);
      float pupil = 1.0 - smoothstep(0.36, 0.39, r), iris = 1.0 - smoothstep(0.7, 0.76, r);
      float stri = 0.72 + 0.28 * sin(an * 41.0 + sin(an * 13.0) * 2.0) * sin(an * 7.0 + r * 9.0);
      vec3 ic = mix(vec3(0.16, 0.1, 0.025), vec3(0.5, 0.38, 0.12), smoothstep(0.38, 0.62, r)) * stri * (1.0 - 0.75 * smoothstep(0.6, 0.74, r));
      diffuseColor.rgb = mix(mix(vec3(0.012, 0.01, 0.009), ic, iris), vec3(0.002), pupil);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.5, 0.78, 0.6) * uShine * pupil * pow(max(dot(normal, normalize(vViewPosition)), 0.0), 6.0) * 0.7;`);
  };
  mat.customProgramCacheKey = () => 'hound-eye-v1';
  return mat;
}
// build the skinned hide, its coat and its eyes on one skeleton; B[name] are the bones, each with userData.rest (its
// resting place in its parent)
export function instantiateHound(mat) {
  const tpl = buildHoundModel(), abs = (n) => tpl.joints[tpl.idx[n]].abs, u = mat.userData.u;
  const bones = tpl.joints.map((j) => { const b = new THREE.Bone(); b.name = j.name; const p = j.parent ? abs(j.parent) : [0, 0, 0]; b.position.set(j.abs[0] - p[0], j.abs[1] - p[1], j.abs[2] - p[2]); b.rotation.order = 'YXZ'; b.userData.rest = b.position.clone(); return b; });
  tpl.joints.forEach((j, i) => { if (j.parent) bones[tpl.idx[j.parent]].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(tpl.geo, mat); mesh.add(bones[0]); mesh.updateMatrixWorld(true); const skel = new THREE.Skeleton(bones); mesh.bind(skel);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const coatMat = coatMaterial(u), coat = new THREE.SkinnedMesh(tpl.cgeo, coatMat); mesh.add(coat); coat.updateMatrixWorld(true); coat.bind(skel, mesh.matrixWorld);
  coat.frustumCulled = false; coat.receiveShadow = true;
  const B = {}; tpl.joints.forEach((j, i) => (B[j.name] = bones[i]));
  const eg = new THREE.SphereGeometry(1, 20, 14), em = eyeMaterial(u), h = abs('head'), eyes = [], zA = new V3(0, 0, 1);
  for (const E of tpl.eyes) { const m = new THREE.Mesh(eg, em); m.scale.set(E.r, E.r * 0.86, E.r); m.position.set(E.c[0] - h[0], E.c[1] - h[1], E.c[2] - h[2]); m.quaternion.setFromUnitVectors(zA, new V3(...E.dir)); B.head.add(m); eyes.push(m); }
  return { mesh, B, eyes, eyeMat: em, coat, coatMat, mats: [mat, coatMat, em] };
}
