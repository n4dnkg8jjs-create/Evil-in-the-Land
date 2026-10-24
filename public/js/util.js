// Shared math, randomness and noise.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
export function dampAngle(a, b, lambda, dt) { return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt)); }
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// Deterministic PRNG (mulberry32) so every player generates the same world.
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (a, b) => a + (b - a) * f();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.sign = () => (f() < 0.5 ? -1 : 1);
  f.gauss = () => (f() + f() + f() - 1.5) / 1.5;
  return f;
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// 2D simplex noise (seedable)
export function makeNoise(seed = 1) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function n2(x, y) {
    const s = (x + y) * F2; const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2; const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = grad[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = grad[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = grad[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n; // ~[-1,1]
  }
  function fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) { s += a * n2(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return s / norm;
  }
  function ridge(x, y, oct = 5) {
    let a = 0.5, f = 1, s = 0, prev = 1;
    for (let o = 0; o < oct; o++) { let n = 1 - Math.abs(n2(x * f, y * f)); n *= n; s += n * a * prev; prev = n; a *= 0.5; f *= 2.03; }
    return s;
  }
  return { n2, fbm, ridge };
}

// Tileable value noise for textures (period in lattice cells).
export function makeTileNoise(seed = 7) {
  const r = rng(seed);
  const N = 256; const vals = new Float32Array(N * N);
  for (let i = 0; i < vals.length; i++) vals[i] = r();
  function v(ix, iy, period) {
    ix = ((ix % period) + period) % period; iy = ((iy % period) + period) % period;
    return vals[(iy & 255) * N + (ix & 255)];
  }
  function noise(x, y, period) {
    const ix = Math.floor(x), iy = Math.floor(y); const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = v(ix, iy, period), b = v(ix + 1, iy, period), c = v(ix, iy + 1, period), d = v(ix + 1, iy + 1, period);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }
  function fbm(u, v_, basePeriod, oct = 5, gain = 0.5) {
    let a = 1, s = 0, n = 0, p = basePeriod;
    for (let o = 0; o < oct; o++) { s += a * noise(u * p, v_ * p, p); n += a; a *= gain; p *= 2; }
    return s / n;
  }
  return { noise, fbm };
}

// Catmull-Rom on 2D points [{x,z}], returns sampler by t in [0,1]
export function pathSampler(points) {
  const pts = points;
  const seg = pts.length - 1;
  function at(t) {
    t = clamp(t, 0, 1) * seg; const i = Math.min(Math.floor(t), seg - 1); const f = t - i;
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, seg)];
    const f2 = f * f, f3 = f2 * f;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
    return { x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) };
  }
  // dense polyline for distance queries
  const poly = [];
  for (let i = 0; i <= seg * 24; i++) poly.push(at(i / (seg * 24)));
  function nearest(x, z) {
    let best = 1e9, bt = 0;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i], b = poly[i + 1];
      const abx = b.x - a.x, abz = b.z - a.z; const l2 = abx * abx + abz * abz || 1;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / l2; t = clamp(t, 0, 1);
      const px = a.x + abx * t, pz = a.z + abz * t; const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) { best = d; bt = (i + t) / (poly.length - 1); }
    }
    return { d: Math.sqrt(best), t: bt };
  }
  return { at, nearest, poly };
}

// Uniform spatial hash for XZ neighbour queries.
export class SpatialHash {
  constructor(cell = 4) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  clear() { this.map.clear(); }
  insert(obj, x, z) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); } b.push(obj);
  }
  query(x, z, r, out) {
    out.length = 0; const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.map.get(this.key(ix, iz)); if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
    }
    return out;
  }
}

export function fmtTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
