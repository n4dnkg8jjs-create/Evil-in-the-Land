// The Black Hound's body. One skinned mesh, lofted ring by ring round the bones of a real dog's skeleton made huge and
// starved: the shoulder blades standing above the spine, every rib and vertebra showing through the hide, the loin
// tucked up to nothing, long hocks, splayed clawed feet; a long skull with the lips shrunk back off the teeth. The hide
// is black and mangy (bare grey skin where the coat has gone), opened by old cuts that run black. No fire on him: only,
// when he is maddened, a dull heat far down his throat and in the wounds. Colour, wetness and heat are painted per
// vertex; a small tiling texture gives the coat its grain.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU } from './util.js';

const V3 = THREE.Vector3;
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vn(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z); let fx = x - i, fy = y - j, fz = z - k;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = lerp(lerp(h3(i, j, k), h3(i + 1, j, k), fx), lerp(h3(i, j + 1, k), h3(i + 1, j + 1, k), fx), fy);
  const b = lerp(lerp(h3(i, j, k + 1), h3(i + 1, j, k + 1), fx), lerp(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), fx), fy);
  return lerp(a, b, fz);
}
const fbm = (x, y, z) => vn(x, y, z) * 0.55 + vn(x * 2.13 + 5, y * 2.13, z * 2.13) * 0.3 + vn(x * 4.31, y * 4.31 + 9, z * 4.31) * 0.15;
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));

// ---------------------------------------------------------------- the skeleton (rest pose, metres; +z forward, +x his left)
const HEAD = [0, 1.96, 1.74], HS = 1.28;   // where the skull joins the neck; the head is built to a small pattern and scaled up
export const HOUND_JOINTS = (() => {
  const J = [
    ['hips', null, 0, 1.62, -1.05], ['loin', 'hips', 0, 1.66, -0.55], ['ribs', 'loin', 0, 1.68, 0], ['chest', 'ribs', 0, 1.72, 0.55],
    ['neck1', 'chest', 0, 1.68, 0.95], ['neck2', 'neck1', 0, 1.83, 1.36], ['head', 'neck2', ...HEAD], ['jaw', 'head', 0, HEAD[1] - 0.07 * HS, HEAD[2] + 0.03 * HS], ['tongue', 'jaw', 0, HEAD[1] - 0.14 * HS, HEAD[2] + 0.34 * HS],
    ['tail1', 'hips', 0, 1.62, -1.36], ['tail2', 'tail1', 0, 1.5, -1.7], ['tail3', 'tail2', 0, 1.25, -1.95], ['tail4', 'tail3', 0, 0.97, -2.08],
    ['ribL', 'ribs', 0.3, 1.36, 0.2], ['ribR', 'ribs', -0.3, 1.36, 0.2],
  ];
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    J.push(['ear' + k, 'head', s * 0.125 * HS, HEAD[1] + 0.13 * HS, HEAD[2] - 0.03 * HS]);
    J.push(['fscap' + k, 'chest', s * 0.17, 1.74, 0.4], ['farm' + k, 'fscap' + k, s * 0.29, 1.24, 0.68], ['ffore' + k, 'farm' + k, s * 0.3, 0.93, 0.36], ['fpast' + k, 'ffore' + k, s * 0.3, 0.33, 0.415], ['fpaw' + k, 'fpast' + k, s * 0.3, 0.07, 0.5]);
    J.push(['bthigh' + k, 'hips', s * 0.22, 1.5, -1.1], ['bshin' + k, 'bthigh' + k, s * 0.3, 0.96, -0.8], ['bmeta' + k, 'bshin' + k, s * 0.3, 0.52, -1.36], ['bpaw' + k, 'bmeta' + k, s * 0.3, 0.07, -1.26]);
  }
  return J.map(([name, parent, x, y, z]) => ({ name, parent, abs: [x, y, z] }));
})();
export const HOUND_PAW_Y = 0.07;   // how high the paw joint rides over the ground when the pads are down

// ---------------------------------------------------------------- mesh building
class MB {
  constructor(idx) { this.idx = idx; this.pos = []; this.col = []; this.surf = []; this.uv = []; this.si = []; this.sw = []; this.ind = []; this.weld = []; this.n = 0; }
  // w: [[bone, weight], ...] (up to four)
  v(p, uv, c, wet, heat, w) {
    this.pos.push(p[0], p[1], p[2]); this.uv.push(uv[0], uv[1]); this.col.push(c[0], c[1], c[2]); this.surf.push(wet, heat);
    let tot = 0; for (const e of w) tot += e[1];
    for (let k = 0; k < 4; k++) { const e = w[k]; this.si.push(e ? this.idx[e[0]] : 0); this.sw.push(e ? e[1] / tot : 0); }
    return this.n++;
  }
  tri(a, b, c) { this.ind.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.ind); g.computeVertexNormals();
    const N = g.attributes.normal;   // the seam of each ring is two vertices in one place: give them one normal
    for (const [a, b] of this.weld) { const x = N.getX(a) + N.getX(b), y = N.getY(a) + N.getY(b), z = N.getZ(a) + N.getZ(b), l = Math.hypot(x, y, z) || 1; N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l); }
    g.computeBoundingSphere(); g.boundingSphere.radius *= 1.6; return g;
  }
}
const cr = (a, b, c, d, t) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

// The hide at a point of the resting body: black coat, bare mangy skin, the cuts and what runs from them.
const WOUNDS = [   // [side, y0, z0, y1, z1, r]: gashes on the flank of that side, in the rest pose
  [1, 1.56, 0.06, 1.2, -0.13, 0.03], [1, 1.58, 0.22, 1.22, 0.03, 0.026], [1, 1.52, 0.36, 1.26, 0.2, 0.022],
  [-1, 1.52, -1.02, 1.22, -0.9, 0.034], [-1, 1.5, 0.3, 1.38, -0.1, 0.022], [1, 1.95, 1.33, 1.74, 1.22, 0.024],
];
function hide(p, o = {}) {
  const x = p[0], y = p[1], z = p[2];
  const f = 0.022 + 0.03 * fbm(x * 7, y * 7, z * 7);
  let c = [f * 1.02, f * 0.96, f];
  const bare = o.bare ?? 0;
  let m = smooth(clamp((fbm(x * 2.6 + 3, y * 2.6, z * 2.2 + 11) - 0.5 + bare * 0.3) / 0.09, 0, 1));
  if (o.fur !== undefined) m *= 1 - o.fur;
  const sk = 0.6 + 0.7 * fbm(x * 15, y * 15, z * 15), dead = smooth(clamp((fbm(x * 5 + 20, y * 5, z * 5) - 0.55) / 0.12, 0, 1));
  const skin = [lerp(0.15, 0.04, dead) * sk, lerp(0.118, 0.036, dead) * sk, lerp(0.11, 0.04, dead) * sk];
  c = [lerp(c[0], skin[0], m), lerp(c[1], skin[1], m), lerp(c[2], skin[2], m)];
  let wet = m * 0.12, heat = 0;
  if (!o.noWounds && Math.abs(x) > 0.08) for (const [s, y0, z0, y1, z1, r] of WOUNDS) {
    if (x * s < 0) continue;
    const dy = y1 - y0, dz = z1 - z0, t = clamp(((y - y0) * dy + (z - z0) * dz) / (dy * dy + dz * dz), 0, 1), d = Math.hypot(y - y0 - dy * t, z - z0 - dz * t);
    const ends = Math.sin(Math.PI * clamp(t, 0.02, 0.98)), rr = r * (0.35 + 0.65 * ends);
    if (d < rr * 2.6) {
      const core = 1 - smooth(clamp(d / rr, 0, 1)), halo = 1 - smooth(clamp((d - rr) / (rr * 1.6), 0, 1));
      c = [lerp(c[0], 0.15, halo * 0.7), lerp(c[1], 0.05, halo * 0.7), lerp(c[2], 0.05, halo * 0.7)];
      c = [lerp(c[0], 0.035, core), lerp(c[1], 0.004, core), lerp(c[2], 0.006, core)];
      wet = Math.max(wet, halo * 0.5 + core * 0.5); heat = Math.max(heat, core * 0.8);
    }
    // what has run out of it, black, down the flank
    const zz = z0 + dz * clamp((y - y0) / dy, 0, 1), below = Math.min(y0, y1) - y;
    if (below > -0.3 && below < 0.5 && Math.abs(z - zz) < 0.14) {
      const streak = smooth(clamp((vn(z * 55, s * 3, 1.5) - 0.45) / 0.2, 0, 1)) * (1 - smooth(clamp(below / (0.2 + 0.3 * vn(z * 40, 2, s)), 0, 1))) * smooth(clamp((below + 0.3) / 0.3, 0, 1)) * smooth(clamp((0.14 - Math.abs(z - zz)) / 0.05, 0, 1));
      c = [lerp(c[0], 0.006, streak), lerp(c[1], 0.005, streak), lerp(c[2], 0.006, streak)]; wet = Math.max(wet, streak * 0.85);
    }
  }
  if (o.shade) c = c.map((v) => v * o.shade);
  return { c, wet, heat };
}

// A tube of rings along stations S: { c: [x, y, z], w (half-width), f, b (half-depths to the front/top and the
// back/underside), e (squareness), n (rings to the next station), bi (place among `bones`, fractional) }.
// Every centreline lies fore-and-aft, so a ring is spanned by X (his left) and the normal of the line in that plane.
function loft(M, S, o) {
  const seg = o.seg, C = [], uvr = o.uv || [1, 1.2];
  const at = (k, key, sub) => { const a = S[Math.max(0, k - 1)], b = S[k], c = S[Math.min(S.length - 1, k + 1)], d = S[Math.min(S.length - 1, k + 2)]; return (t) => (sub === undefined ? cr(a[key] ?? 0, b[key] ?? 0, c[key] ?? 0, d[key] ?? 0, t) : cr(a[key][sub], b[key][sub], c[key][sub], d[key][sub], t)); };
  for (let k = 0; k < S.length - 1; k++) {
    const n = S[k].n || 4, fx = at(k, 'c', 0), fy = at(k, 'c', 1), fz = at(k, 'c', 2), fw = at(k, 'w'), ff = at(k, 'f'), fb = at(k, 'b');
    for (let i = 0; i < n + (k === S.length - 2 ? 1 : 0); i++) {
      const t = i / n, lin = (key, def) => lerp(S[k][key] ?? def, S[k + 1][key] ?? def, smooth(t));
      const lo = (key) => Math.min(S[k][key], S[k + 1][key]) * 0.9;
      C.push({ c: [fx(t), fy(t), fz(t)], w: Math.max(lo('w'), fw(t)), f: S[k].f < 0 || S[k + 1].f < 0 ? lerp(S[k].f, S[k + 1].f, smooth(t)) : Math.max(lo('f'), ff(t)), b: Math.max(lo('b'), fb(t)), e: lin('e', 1), bi: lerp(S[k].bi ?? 0, S[k + 1].bi ?? 0, t), u: k + t });
    }
  }
  const nR = C.length, base = M.n; let arc = 0;
  for (let i = 0; i < nR; i++) {
    const R0 = C[i], a = C[Math.max(0, i - 1)].c, b = C[Math.min(nR - 1, i + 1)].c;
    let ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(ty, tz) || 1; ty /= tl; tz /= tl;
    const ny = tz, nz = -ty;   // cross(t, X)
    if (i) arc += Math.hypot(R0.c[0] - C[i - 1].c[0], R0.c[1] - C[i - 1].c[1], R0.c[2] - C[i - 1].c[2]);
    let w;
    if (o.weights) w = null; else { const k0 = clamp(Math.floor(R0.bi), 0, o.bones.length - 1), k1 = Math.min(o.bones.length - 1, k0 + 1), fr = smooth(clamp(R0.bi - k0, 0, 1)); w = k0 === k1 || fr < 0.001 ? [[o.bones[k0], 1]] : [[o.bones[k0], 1 - fr], [o.bones[k1], fr]]; }
    for (let j = 0; j <= seg; j++) {
      const th = -Math.PI / 2 + (j % seg) / seg * TAU, cs = Math.cos(th), sn = Math.sin(th), e = R0.e;
      const sx = Math.sign(cs) * Math.pow(Math.abs(cs), e) * R0.w, sy = Math.sign(sn) * Math.pow(Math.abs(sn), e) * (sn >= 0 ? R0.f : R0.b);
      const P = [R0.c[0] + sx, R0.c[1] + ny * sy, R0.c[2] + nz * sy];
      const ctx = { i, j, u: R0.u, v: i / (nR - 1), th, cs, sn, c: R0.c, P, R: R0, arc, n: [0, ny, nz] };
      if (o.disp) { const d = o.disp(ctx); if (d) { let ox = sx, oy = ny * sy, oz = nz * sy; const l = Math.hypot(ox, oy, oz) || 1; P[0] += ox / l * d; P[1] += oy / l * d; P[2] += oz / l * d; } }
      const pt = o.paint ? o.paint(ctx) : hide(P, o.hide);
      const ww = o.weights ? o.weights(ctx) : o.extra ? [...w, ...(o.extra(ctx) || [])] : w;
      M.v(P, [j / seg * uvr[0], arc * uvr[1]], pt.c, pt.wet || 0, pt.heat || 0, ww);
      if (o.tuft && j < seg) { const d = o.tuft(ctx); if (d) o.tufts.push({ p: P.slice(), n: [sx, ny * sy, nz * sy], t: [0, ty, tz], w: ww, len: d }); }
    }
    M.weld.push([base + i * (seg + 1), base + i * (seg + 1) + seg]);
  }
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < seg; j++) { const a = base + i * (seg + 1) + j, b = a + 1, c = a + seg + 1, d = c + 1; M.tri(a, b, c); M.tri(b, d, c); }
}
// a tooth or a claw: a curved spike from p along d, bending toward `bend`
function spike(M, p, d, len, r, bend, col, tipCol, w, wet = 0.7, sides = 5, k = 1) {
  len *= k; r *= k;
  const D = new V3(...d).normalize(), Bn = new V3(...bend), A = Math.abs(D.y) > 0.9 ? new V3(1, 0, 0) : new V3(0, 1, 0), X = new V3().crossVectors(D, A).normalize(), Y = new V3().crossVectors(D, X);
  const base = M.n, NR = 4;
  for (let i = 0; i <= NR; i++) {
    const t = i / NR, rr = r * (1 - t * t * 0.97), c = new V3(...p).addScaledVector(D, len * t).addScaledVector(Bn, len * t * t);
    const cc = [lerp(col[0], tipCol[0], t), lerp(col[1], tipCol[1], t), lerp(col[2], tipCol[2], t)];
    for (let j = 0; j <= sides; j++) { const a = j / sides * TAU, q = c.clone().addScaledVector(X, Math.cos(a) * rr).addScaledVector(Y, Math.sin(a) * rr * 0.8); M.v([q.x, q.y, q.z], [j / sides * 0.2, t * 0.2], cc, wet, 0, w); }
    M.weld.push([base + i * (sides + 1), base + i * (sides + 1) + sides]);
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < sides; j++) { const a = base + i * (sides + 1) + j, b = a + 1, c = a + sides + 1, dd = c + 1; M.tri(a, c, b); M.tri(b, c, dd); }
}

let _tpl = null;
export function buildHoundModel() {
  if (_tpl) return _tpl;
  const joints = HOUND_JOINTS, idx = {}; joints.forEach((j, i) => (idx[j.name] = i));
  const M = new MB(idx), tufts = [];
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // ---- trunk and neck: croup, tucked loin, the deep keel of the ribs, withers, neck
  const spine = ['hips', 'loin', 'ribs', 'chest', 'neck1', 'neck2', 'head'].map((n) => joints[idx[n]].abs);
  const spineBi = (c) => {   // where along the spine a ring lies: k - 0.5 at joint k
    let best = 0, bd = 1e9, acc = 0;
    for (let k = 0; k < spine.length - 1; k++) { const a = spine[k], b = spine[k + 1], dy = b[1] - a[1], dz = b[2] - a[2], t = ((c[1] - a[1]) * dy + (c[2] - a[2]) * dz) / (dy * dy + dz * dz), tc = clamp(t, 0, 1), d = Math.hypot(c[1] - a[1] - dy * tc, c[2] - a[2] - dz * tc); if (d < bd) { bd = d; best = k + (k === 0 ? Math.min(t, 1) : k === spine.length - 2 ? Math.max(t, 0) : tc); } acc++; }
    return best - 0.5;
  };
  const T = [
    [1.5, -1.47, 0.008, 0.008, 0.008, 2], [1.5, -1.41, 0.14, 0.14, 0.16, 3], [1.49, -1.22, 0.245, 0.2, 0.28, 6], [1.5, -0.95, 0.24, 0.19, 0.25, 8],
    [1.52, -0.62, 0.17, 0.16, 0.17, 9], [1.44, -0.32, 0.245, 0.26, 0.3, 16], [1.34, 0.08, 0.315, 0.38, 0.45, 16], [1.3, 0.45, 0.325, 0.45, 0.5, 11],
    [1.36, 0.75, 0.285, 0.38, 0.45, 7], [1.5, 0.98, 0.225, 0.28, 0.38, 6], [1.66, 1.22, 0.18, 0.21, 0.26, 6], [1.8, 1.46, 0.16, 0.18, 0.21, 5],
    [1.9, 1.68, 0.16, 0.16, 0.17, 3], [1.95, 1.8, 0.1, 0.1, 0.1, 2], [1.97, 1.87, 0.008, 0.008, 0.008, 1],
  ].map(([y, z, w, f, b, n]) => ({ c: [0, y, z], w, f, b, n, e: 0.92 }));
  const ribZone = (z) => smooth(clamp((z + 0.5) / 0.16, 0, 1)) * (1 - smooth(clamp((z - 0.42) / 0.3, 0, 1)));
  const trunkGroove = (q) => {   // 0..1: how deep between two ribs this point lies
    const z = q.c[2], y = q.P[1], fl = Math.pow(Math.abs(q.cs), 0.7) * smooth(clamp((q.sn + 0.92) / 0.5, 0, 1)) * smooth(clamp((0.8 - q.sn) / 0.35, 0, 1));
    return ribZone(z) * fl * (0.5 - 0.5 * Math.cos(TAU * (z + 0.32 * (y - 1.3)) / 0.098));
  };
  loft(M, T, {
    seg: 40, uv: [5, 2.2], tufts,
    weights: (q) => {
      const bi = spineBi(q.c), names = ['hips', 'loin', 'ribs', 'chest', 'neck1', 'neck2', 'head'], k0 = clamp(Math.floor(bi), 0, 6), k1 = Math.min(6, k0 + 1), fr = bi < 0 ? 0 : smooth(clamp(bi - k0, 0, 1));
      const w = [[names[k0], 1 - fr + 1e-4], [names[k1], fr + 1e-4]];
      const br = ribZone(q.c[2]) * Math.pow(Math.abs(q.cs), 1.5) * 0.45; if (br > 0.02) w.push([q.cs > 0 ? 'ribL' : 'ribR', br]);   // the flanks breathe
      return w;
    },
    disp: (q) => {
      const z = q.c[2]; let d = -0.02 * trunkGroove(q);
      const body = smooth(clamp((z + 1.3) / 0.2, 0, 1)) * (1 - smooth(clamp((z - 0.7) / 0.3, 0, 1)));
      if (q.sn > 0.7) {   // the spine: a ridge, and each vertebra a knob on it; tall at the withers
        const sp = gauss(q.th, Math.PI / 2, 0.15);
        d += sp * body * (0.014 + 0.024 * (0.5 + 0.5 * Math.cos(TAU * z / 0.085)) + 0.03 * gauss(z, 0.42, 0.22));
        d -= 0.03 * body * gauss(Math.abs(q.th - Math.PI / 2), 0.36, 0.13) * (1 - 0.6 * gauss(z, -1.05, 0.25));   // the hollows either side of it
      }
      d += 0.045 * gauss(z, -0.98, 0.1) * gauss(Math.abs(q.th - Math.PI / 2), 0.78, 0.2);   // the points of the hips
      d += 0.03 * gauss(z, -1.3, 0.08) * gauss(Math.abs(q.th - Math.PI / 2), 0.5, 0.2);     // the pin bones
      d -= 0.035 * gauss(z, -0.62, 0.22) * Math.abs(q.cs) * (q.sn > -0.6 ? 1 : 0.4);        // the flank fallen in behind the ribs
      if (q.sn < -0.8) d += 0.02 * gauss(q.th, -Math.PI / 2, 0.2) * gauss(z, 0.4, 0.4);      // the keel of the breastbone
      if (z > 1.0) { d += 0.012 * gauss(q.th, -Math.PI / 2, 0.22); d -= 0.014 * gauss(Math.abs(q.cs), 0.75, 0.2) * (q.sn < 0 ? 1 : 0.3); }   // windpipe, the sinews of the neck
      return d;
    },
    paint: (q) => {
      const z = q.c[2], g = trunkGroove(q), under = smooth(clamp((-q.sn - 0.55) / 0.35, 0, 1));
      const r = hide(q.P, { bare: 0.25 * ribZone(z) * Math.abs(q.cs) + 0.5 * under + 0.2 * gauss(z, -0.62, 0.3) - 0.5 * smooth(clamp((q.sn - 0.75) / 0.2, 0, 1)) });
      const k = (1 - 0.55 * g) * (1 - 0.35 * under);
      return { c: r.c.map((v) => v * k), wet: r.wet, heat: r.heat };
    },
    tuft: (q) => {   // hackles down the neck and back, ragged; a few on the flanks and the breast
      const z = q.c[2], top = gauss(q.th, Math.PI / 2, 0.3);
      if (top > 0.25 && z > -1.35 && z < 1.7) return rnd() < 0.5 * top ? (0.1 + 0.16 * rnd()) * (1 + 0.9 * gauss(z, 0.7, 0.5)) : 0;
      if (q.sn < -0.7 && z > 0.55 && z < 1.3) return rnd() < 0.1 ? 0.08 + 0.1 * rnd() : 0;
      return z > -1.3 && z < 1.6 && rnd() < 0.012 ? 0.05 + 0.07 * rnd() : 0;
    },
  });

  // ---- the tail: a bony whip, held low
  loft(M, [[1.6, -1.34, 0.075, 0], [1.56, -1.52, 0.062, 0.6], [1.46, -1.74, 0.048, 1.5], [1.26, -1.94, 0.036, 2.5], [1.0, -2.07, 0.026, 3.5], [0.8, -2.11, 0.017, 4], [0.68, -2.12, 0.004, 4]].map(([y, z, r, bi]) => ({ c: [0, y, z], w: r, f: r, b: r, n: 5, bi })), {
    seg: 10, uv: [1, 2.2], bones: ['hips', 'tail1', 'tail2', 'tail3', 'tail4'], tufts, hide: { bare: 0.15, noWounds: true },
    disp: (q) => 0.006 * Math.cos(TAU * q.arc / 0.07) * (q.sn > 0 ? 1 : 0.3),
    tuft: (q) => (q.sn < -0.3 && rnd() < 0.2 ? 0.07 + 0.1 * rnd() : 0),
  });

  // ---- legs
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const mk = (rows) => rows.map(([x, y, z, w, f, b, bi, n]) => ({ c: [s * x, y, z], w, f, b, bi, n: n || 4, e: 0.9 }));
    // fore: the shoulder blade lying on the ribs, the point of the shoulder, elbow, the long forearm, pastern
    loft(M, mk([[0.16, 1.77, 0.39, 0.02, 0.03, 0.03, 1, 3], [0.2, 1.63, 0.45, 0.055, 0.13, 0.13, 1, 4], [0.255, 1.43, 0.51, 0.08, 0.185, 0.165, 1.2, 4], [0.29, 1.24, 0.535, 0.095, 0.21, 0.165, 1.6, 4],
      [0.3, 1.08, 0.46, 0.09, 0.145, 0.155, 2, 4], [0.3, 0.93, 0.385, 0.066, 0.09, 0.125, 2.45, 4], [0.3, 0.78, 0.385, 0.068, 0.085, 0.085, 3, 5], [0.3, 0.52, 0.4, 0.052, 0.056, 0.058, 3, 4],
      [0.3, 0.33, 0.415, 0.058, 0.058, 0.068, 3.45, 3], [0.3, 0.2, 0.455, 0.05, 0.048, 0.05, 4, 3], [0.3, 0.095, 0.49, 0.062, 0.055, 0.06, 4.4, 2], [0.3, 0.055, 0.5, 0.02, 0.02, 0.02, 5, 1]]), {
      seg: 14, uv: [2, 2.2], bones: ['chest', 'fscap' + k, 'farm' + k, 'ffore' + k, 'fpast' + k, 'fpaw' + k], tufts, hide: { bare: 0.1 },
      disp: (q) => {
        const y = q.c[1]; let d = 0;
        if (y > 1.25) d += 0.02 * gauss(q.th, 0, 0.5) * (q.cs * s > 0 ? 1 : 0) * gauss(y, 1.52, 0.2) - 0.012 * (q.cs * s > 0 ? 1 : 0) * gauss(Math.abs(q.sn), 0.55, 0.2) * gauss(y, 1.5, 0.2);   // the spine of the blade, a hollow each side
        d += 0.02 * gauss(y, 0.93, 0.05) * (q.sn < -0.5 ? 1 : 0);   // the elbow
        if (y < 0.85 && y > 0.35) d += 0.006 * Math.cos(q.th * 3) * (q.sn > 0 ? 1 : 0.4);   // tendons down the forearm
        return d;
      },
      tuft: (q) => (q.sn < -0.75 && q.c[1] < 0.95 && q.c[1] > 0.4 && rnd() < 0.16 ? 0.05 + 0.08 * rnd() : 0),
    });
    // hind: the flat thigh, stifle, the lean gaskin, the point of the hock, the long cannon
    loft(M, mk([[0.19, 1.64, -1.13, 0.04, 0.12, 0.1, 0.3, 3], [0.245, 1.46, -1.06, 0.1, 0.21, 0.18, 0.8, 4], [0.28, 1.26, -0.96, 0.108, 0.19, 0.19, 1, 4], [0.3, 1.08, -0.87, 0.085, 0.125, 0.16, 1.25, 4],
      [0.3, 0.96, -0.81, 0.066, 0.095, 0.115, 1.5, 4], [0.3, 0.84, -0.94, 0.06, 0.068, 0.1, 2, 4], [0.3, 0.68, -1.15, 0.042, 0.042, 0.062, 2, 4], [0.3, 0.52, -1.355, 0.042, 0.048, 0.075, 2.5, 3],
      [0.3, 0.4, -1.345, 0.042, 0.043, 0.048, 3, 3], [0.3, 0.2, -1.31, 0.042, 0.042, 0.046, 3, 3], [0.3, 0.095, -1.28, 0.06, 0.052, 0.056, 3.4, 2], [0.3, 0.055, -1.27, 0.02, 0.02, 0.02, 4, 1]]), {
      seg: 14, uv: [2, 2.2], bones: ['hips', 'bthigh' + k, 'bshin' + k, 'bmeta' + k, 'bpaw' + k], tufts, hide: { bare: 0.12 },
      disp: (q) => {
        const y = q.c[1]; let d = 0;
        if (y > 1.0) d -= 0.014 * (q.cs * s > 0 ? 1 : 0) * gauss(q.sn, -0.1, 0.25) * gauss(y, 1.28, 0.16);   // the groove between the thigh muscles
        if (y < 0.9 && y > 0.5) d += 0.012 * gauss(q.th, -Math.PI / 2, 0.3);   // the hamstring cord
        return d;
      },
      tuft: (q) => (q.sn < -0.7 && q.c[1] > 0.9 && q.c[1] < 1.4 && rnd() < 0.12 ? 0.06 + 0.1 * rnd() : 0),
    });
    // feet: four long splayed toes and their claws; a dew claw on the fore
    for (const [bone, pz, front] of [['fpaw' + k, 0.5, 1], ['bpaw' + k, -1.26, 0]]) {
      const w = [[bone, 1]];
      [-0.078, -0.027, 0.027, 0.078].forEach((dx, ti) => {
        const outer = ti === 0 || ti === 3, L = outer ? 0.125 : 0.15, x0 = s * 0.3 + dx * 0.55, x1 = s * 0.3 + dx * 1.25, z0 = pz - 0.015 - (outer ? 0.01 : 0);
        loft(M, [[x0, 0.075, z0, 0.04], [lerp(x0, x1, 0.45), 0.075, z0 + L * 0.42, 0.047], [lerp(x0, x1, 0.85), 0.047, z0 + L * 0.85, 0.045], [x1, 0.036, z0 + L, 0.03], [x1, 0.034, z0 + L + 0.014, 0.004]].map(([x, y, z, r]) => ({ c: [x, y, z], w: r * 0.92, f: r, b: r * 0.95, n: 2 })), {
          seg: 8, uv: [0.5, 1], weights: () => w, paint: (q) => { const r = hide(q.P, { noWounds: true, bare: 0.6 }); const pad = q.sn < -0.6 ? 0.45 : 1; return { c: r.c.map((v) => v * 0.75 * pad), wet: 0.1 }; },
        });
        spike(M, [x1, 0.045, z0 + L - 0.006], [dx * 1.5, -0.2, 1], 0.09, 0.019, [0, -0.04, 0], [0.05, 0.045, 0.04], [0.2, 0.18, 0.14], w, 0.55);
      });
      if (front) spike(M, [s * 0.3 - s * 0.045, 0.3, pz - 0.07], [-s * 0.5, -0.6, 0.4], 0.06, 0.012, [0, -0.02, 0.01], [0.05, 0.045, 0.04], [0.18, 0.16, 0.12], [['fpast' + k, 1]], 0.5);
    }
  }

  // ---- the head (in its own frame: the joint at the back of the skull, the muzzle along +z)
  const H = (x, y, z) => [x * HS, HEAD[1] + y * HS, HEAD[2] + z * HS], hz = (q) => (q.c[2] - HEAD[2]) / HS;
  const lipY = (z) => lerp(-0.1, -0.095, clamp(z / 0.7, 0, 1)) - 0.018 * gauss(z, 0.12, 0.12);
  const SK = [[-0.17, 0.012, -0.04, 1, 2], [-0.12, 0.11, 0.085, 1, 3], [-0.04, 0.178, 0.142, 1, 4], [0.07, 0.212, 0.168, 1, 5], [0.17, 0.2, 0.15, 0.95, 5], [0.26, 0.155, 0.112, 0.86, 5], [0.34, 0.118, 0.074, 0.78, 7],
    [0.5, 0.102, 0.052, 0.74, 6], [0.62, 0.09, 0.038, 0.76, 4], [0.69, 0.074, 0.022, 0.82, 3], [0.735, 0.042, -0.012, 1, 2], [0.75, 0.006, -0.045, 1, 1]];
  const snarl = (q) => (hz(q) > 0.3 && hz(q) < 0.6 && q.sn > 0.75 ? 0.5 - 0.5 * Math.cos(TAU * hz(q) / 0.048) : 0);
  loft(M, SK.map(([z, w, top, e, n]) => ({ c: H(0, lipY(z), z), w: w * HS, f: (top - lipY(z)) * HS, b: 0.014 * HS, e, n })), {
    seg: 32, uv: [3, 2.2], tufts, weights: () => [['head', 1]],
    disp: (q) => {
      const z = hz(q), a = Math.abs(q.th - Math.PI / 2); let d = 0;
      if (q.sn > 0) {
        d -= 0.038 * gauss(z, 0.215, 0.05) * gauss(a, 0.98, 0.2);                 // the orbits
        d += 0.024 * gauss(z, 0.2, 0.06) * gauss(a, 0.66, 0.16);                  // brow
        d += 0.02 * gauss(z, 0.09, 0.09) * gauss(a, 1.3, 0.16);                   // the cheekbone
        d -= 0.022 * gauss(z, 0.06, 0.09) * gauss(a, 0.75, 0.2);                  // the temple fallen in
        d += 0.016 * gauss(a, 0, 0.14) * (1 - smooth(clamp((z - 0.02) / 0.2, 0, 1)));   // the crest of the skull
        d -= 0.012 * gauss(a, 0, 0.1) * gauss(z, 0.27, 0.06);                     // the stop
        d -= 0.006 * snarl(q);                                                    // the nose wrinkled back in a snarl
        d -= 0.012 * gauss(z, 0.725, 0.02) * gauss(a, 0.85, 0.25);                // nostrils
        d -= 0.01 * gauss(z, 0.42, 0.14) * gauss(a, 1.0, 0.16);                   // the hollow under the eye, along the muzzle
      } else d -= 0.02 * Math.sin(Math.PI * clamp(z / 0.7, 0, 1)) * gauss(q.th, -Math.PI / 2, 0.7);   // the vault of the palate
      return d * HS;
    },
    paint: (q) => {
      const z = hz(q), a = Math.abs(q.th - Math.PI / 2), left = q.cs > 0;
      if (q.sn <= 0.02) { const rid = 0.75 + 0.25 * Math.cos(TAU * z / 0.05), back = 1 - smooth(clamp(z / 0.35, 0, 1)); return { c: [0.075 * rid * (1 - 0.7 * back), 0.02 * rid * (1 - 0.75 * back), 0.026 * rid * (1 - 0.75 * back)], wet: 0.9, heat: back * 0.9 }; }
      const r = hide(q.P, { noWounds: true, bare: smooth(clamp((z - 0.22) / 0.12, 0, 1)) * 0.75 - (z < 0.2 ? 0.25 : 0) });
      let c = r.c, wet = r.wet;
      c = c.map((v) => v * (1 - 0.35 * snarl(q)));
      const eye = gauss(z, 0.215, 0.045) * gauss(a, 0.98, 0.17); c = c.map((v) => v * (1 - 0.9 * eye));
      const scar = smooth(clamp((0.012 - Math.abs((z - 0.3) * 0.5 + q.cs * 0.09 - 0.07)) / 0.006, 0, 1)) * (z > 0.3 && z < 0.62 && q.sn > 0.3 ? 1 : 0);
      c = [lerp(c[0], 0.3, scar), lerp(c[1], 0.2, scar), lerp(c[2], 0.19, scar)];
      // the lips: gone from his left side (the gum and the roots of the teeth bare), black and drawn on the right
      const lipH = left ? 0.26 * (1 - smooth(clamp((z - 0.6) / 0.1, 0, 1))) + 0.1 : 0.14, lip = (1 - smooth(clamp((q.sn - lipH * 0.5) / (lipH * 0.5), 0, 1))) * smooth(clamp((z - 0.1) / 0.1, 0, 1));
      if (lip > 0) { const g = left && z < 0.68 ? [0.09 + 0.06 * vn(z * 40, 1, 2), 0.024, 0.028] : [0.014, 0.013, 0.014]; const sp = left && vn(z * 60, q.sn * 30, 4) > 0.55 ? 0.2 : 1; c = [lerp(c[0], g[0] * sp, lip), lerp(c[1], g[1] * sp, lip), lerp(c[2], g[2] * sp, lip)]; wet = Math.max(wet, lip * 0.75); }
      const nose = smooth(clamp((z - 0.695) / 0.02, 0, 1)); c = c.map((v) => lerp(v, 0.012, nose)); wet = Math.max(wet, nose * 0.9);
      return { c, wet, heat: 0 };
    },
    tuft: (q) => { const z = hz(q); return z < 0.16 && q.sn > 0.1 && rnd() < 0.1 ? 0.05 + 0.09 * rnd() : 0; },
  });
  // the lower jaw: a trough, the floor of the mouth inside it
  const jawTop = (z) => lerp(-0.128, -0.11, clamp(z / 0.7, 0, 1)) - 0.012 * gauss(z, 0.12, 0.12);
  const JW = [[0.0, 0.01, 0.01, 0, 2], [0.04, 0.16, 0.06, -0.012, 3], [0.15, 0.168, 0.09, -0.036, 4], [0.3, 0.11, 0.074, -0.036, 5], [0.46, 0.09, 0.062, -0.03, 4], [0.59, 0.076, 0.056, -0.024, 3], [0.665, 0.054, 0.044, -0.012, 2], [0.695, 0.008, 0.008, -0.002, 1]];
  loft(M, JW.map(([z, w, b, f, n]) => ({ c: H(0, jawTop(z), z), w: w * HS, f: f * HS, b: b * HS, n, e: 0.85 })), {
    seg: 24, uv: [2, 2.2], tufts, weights: () => [['jaw', 1]],
    paint: (q) => {
      const z = hz(q);
      if (q.sn > 0.05) { const back = 1 - smooth(clamp(z / 0.35, 0, 1)); return { c: [0.06 * (1 - 0.7 * back), 0.016 * (1 - 0.75 * back), 0.02 * (1 - 0.75 * back)], wet: 0.9, heat: back * 0.9 }; }
      const r = hide(q.P, { noWounds: true, bare: 0.3 }), rim = 1 - smooth(clamp(-q.sn / 0.3, 0, 1));
      return { c: r.c.map((v) => lerp(v, 0.014, rim)), wet: Math.max(r.wet, rim * 0.7) };
    },
    tuft: (q) => { const z = hz(q); return q.sn < -0.6 && z < 0.4 && rnd() < 0.12 ? 0.05 + 0.08 * rnd() : 0; },
  });
  // the tongue
  loft(M, [[0.05, 0.05, 0], [0.2, 0.056, 0.1], [0.4, 0.05, 0.7], [0.56, 0.04, 1], [0.64, 0.026, 1], [0.66, 0.004, 1]].map(([z, w, bi]) => ({ c: H(0, jawTop(z) - 0.012 - 0.01 * gauss(z, 0.2, 0.15), z), w: w * HS, f: 0.014 * HS, b: 0.008 * HS, n: 3, bi })), {
    seg: 10, uv: [1, 1], bones: ['jaw', 'tongue'],
    paint: (q) => { const sp = vn(q.P[0] * 70, q.P[2] * 70, 3) > 0.6 ? 0.45 : 1, fur = 1 - 0.3 * gauss(q.th, Math.PI / 2, 0.12); return { c: [0.12 * sp * fur, 0.035 * sp * fur, 0.05 * sp * fur], wet: 0.95, heat: 0.15 }; },
  });
  // the skin of the cheek, stretched between the jaws when they open
  for (const s of [1, -1]) {
    const NZ = 7, NC = 4, base = M.n;
    for (let i = 0; i <= NZ; i++) for (let j = 0; j <= NC; j++) {
      const z = lerp(0.0, 0.33, i / NZ), t = j / NC, wu = cr(0.162, 0.198, 0.188, 0.148, clamp((z - 0.07) / 0.1, 0, 1)) * (z < 0.07 ? 0.9 : 1), x = s * (lerp(Math.min(0.19, wu) - 0.012, 0.145, t) - 0.012 * Math.sin(Math.PI * t));
      M.v(H(x, lerp(lipY(z) + 0.004, jawTop(z) - 0.004, t), z), [t * 0.3, z], [0.035, 0.011, 0.014].map((v) => v * (0.6 + 0.8 * Math.sin(Math.PI * t))), 0.8, 0.25, [['head', 1 - t + 1e-3], ['jaw', t + 1e-3]]);
    }
    for (let i = 0; i < NZ; i++) for (let j = 0; j < NC; j++) { const a = base + i * (NC + 1) + j, b = a + 1, c = a + NC + 1, d = c + 1; if (s > 0) { M.tri(a, c, b); M.tri(b, c, d); } else { M.tri(a, b, c); M.tri(b, d, c); } }
  }
  // teeth: yellow, long, the roots dark. Upper: fangs, incisors, the shearing teeth behind. Lower the same, set inside them.
  const TC = [0.2, 0.14, 0.08], TT = [0.62, 0.55, 0.38];
  const upW = (z) => { for (let k = 0; k < SK.length - 1; k++) if (z <= SK[k + 1][0]) return lerp(SK[k][1], SK[k + 1][1], (z - SK[k][0]) / (SK[k + 1][0] - SK[k][0])); return 0.04; };
  const loW = (z) => { for (let k = 0; k < JW.length - 1; k++) if (z <= JW[k + 1][0]) return lerp(JW[k][1], JW[k + 1][1], (z - JW[k][0]) / (JW[k + 1][0] - JW[k][0])); return 0.04; };
  for (const s of [1, -1]) {
    spike(M, H(s * 0.066, lipY(0.61) + 0.012, 0.612), [s * 0.08, -1, 0.12], 0.125, 0.021, [0, 0, -0.03], TC, TT, [['head', 1]], 0.75, 6, HS);          // upper fang
    spike(M, H(s * 0.052, jawTop(0.565) - 0.012, 0.566), [s * 0.14, 1, 0.16], 0.1, 0.018, [0, 0, -0.025], TC, TT, [['jaw', 1]], 0.75, 6, HS);        // lower fang
    for (let i = 0; i < 3; i++) { spike(M, H(s * (0.012 + i * 0.019), lipY(0.71) + 0.006, 0.712 - i * 0.012), [0, -1, 0.15], 0.034 + i * 0.006, 0.0085, [0, 0, -0.004], TC, TT, [['head', 1]], 0.75, 4, HS); spike(M, H(s * (0.01 + i * 0.016), jawTop(0.675) - 0.006, 0.676 - i * 0.012), [0, 1, 0.2], 0.03, 0.0075, [0, 0, -0.004], TC, TT, [['jaw', 1]], 0.75, 4, HS); }
    for (let i = 0; i < 6; i++) {   // premolars and the carnassials: jagged, bigger toward the back
      const z = 0.52 - i * 0.06, big = i >= 3 ? 1.5 : 1;
      spike(M, H(s * (upW(z) - 0.014), lipY(z) + 0.012, z), [s * 0.1, -1, -0.05], (0.034 + 0.004 * i) * big, 0.012 * big, [0, 0, -0.004], TC, TT, [['head', 1]], 0.75, 4, HS);
      const zl = z - 0.03; spike(M, H(s * (loW(zl) - 0.016), jawTop(zl) - 0.01, zl), [s * 0.05, 1, -0.05], (0.03 + 0.003 * i) * big, 0.011 * big, [0, 0, -0.003], TC, TT, [['jaw', 1]], 0.75, 4, HS);
    }
  }
  // ears: long, ragged, laid half back; his right one torn short
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const NU = 4, NV = 6, base = M.n, hgt = s > 0 ? 0.24 : 0.15, w = [['ear' + k, 1]];
    for (let i = 0; i <= NV; i++) for (let j = 0; j <= NU; j++) {
      const t = i / NV, a = (j / NU - 0.5), wd = 0.075 * Math.pow(1 - t, 0.75) * (s < 0 && t > 0.7 ? 0.5 + 0.9 * Math.abs(a) : 1) + 0.004, notch = s > 0 && j === 0 && i === 3 ? 0.4 : 1;
      const x = s * (0.125 + 0.02 * t) + a * wd * 2 * notch * 0.9, y = 0.11 + t * hgt * (1 - 0.5 * a * a), z = -0.05 - t * hgt * 0.42 - 0.035 * (1 - 4 * a * a) * (1 - t);
      const r = hide(H(x, y, z), { noWounds: true, bare: 0.2 });
      M.v(H(x, y, z), [j / NU * 0.3, t * 0.4], r.c.map((v) => v * (0.7 + 0.3 * t)), 0, 0, i === 0 ? [['head', 1]] : w);
    }
    for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) { const a = base + i * (NU + 1) + j, b = a + 1, c = a + NU + 1, d = c + 1; M.tri(a, b, c); M.tri(b, d, c); }
  }

  // ---- the coat where it is left: ragged locks, lying back
  for (const t of tufts) {
    const n = new V3(...t.n).normalize(), back = new V3(-t.t[0], -t.t[1], -t.t[2]), side = new V3().crossVectors(n, back).normalize();
    const lean = 0.55 + 0.6 * rnd(), dir = n.clone().multiplyScalar(1 - lean * 0.6).addScaledVector(back, lean).addScaledVector(side, (rnd() - 0.5) * 0.7).normalize();
    const wdt = 0.018 + 0.022 * rnd(), base = M.n, p = new V3(...t.p).addScaledVector(n, -0.012), shade = 0.5 + 0.7 * rnd();
    for (let i = 0; i <= 3; i++) {
      const u = i / 3, c = p.clone().addScaledVector(dir, t.len * u).addScaledVector(back, t.len * u * u * 0.35).addScaledVector(n, -t.len * u * u * 0.2), hw = wdt * (1 - u * 0.95);
      const col = [0.02 * shade + 0.03 * u, 0.019 * shade + 0.028 * u, 0.02 * shade + 0.027 * u];
      for (const e of [-1, 1]) { const q = c.clone().addScaledVector(side, e * hw); M.v([q.x, q.y, q.z], [0.5 + e * 0.1, u * 0.5], col, 0, 0, t.w); }
    }
    for (let i = 0; i < 3; i++) { const a = base + i * 2; M.tri(a, a + 1, a + 2); M.tri(a + 1, a + 3, a + 2); }
  }
  return (_tpl = { joints, idx, geo: M.geometry(), eyes: [H(0.108, 0.062, 0.215), H(-0.108, 0.062, 0.215)] });
}

// the grain of the coat: fine streaks along the body, as an albedo multiplier and a normal map
let _grain = null;
function houndGrain() {
  if (_grain) return _grain;
  const W = 256, H = 256, hgt = new Float32Array(W * H), map = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4);
  const tn = (x, y, px, py) => {   // tiling value noise
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), hh = (a, b) => h3(((a % px) + px) % px, ((b % py) + py) % py, 3.3);
    return lerp(lerp(hh(i, j), hh(i + 1, j), u), lerp(hh(i, j + 1), hh(i + 1, j + 1), u), v);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const u = x / W, v = y / H; hgt[y * W + x] = tn(u * 64 + tn(v * 6, u * 6, 6, 6) * 2, v * 7, 64, 7) * 0.6 + tn(u * 128, v * 16, 128, 16) * 0.25 + tn(u * 16, v * 16, 16, 16) * 0.15; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4, at = (xx, yy) => hgt[((yy + H) % H) * W + ((xx + W) % W)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * 2.6, dy = (at(x, y + 1) - at(x, y - 1)) * 2.6, l = Math.hypot(dx, dy, 1), g = Math.round(255 * Math.pow(0.72 + 0.28 * hgt[i], 1 / 2.2));
    map[o] = map[o + 1] = map[o + 2] = g; map[o + 3] = 255;
    nrm[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); nrm[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); nrm[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nrm[o + 3] = 255;
  }
  const tex = (d, srgb) => { const t = new THREE.DataTexture(d, W, H, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };
  return (_grain = { map: tex(map, true), normal: tex(nrm, false) });
}
// The hide: vertex colour times the grain; aSurf.x makes it wet (mouth, wounds), aSurf.y is where the heat shows when
// uHeat is raised. It burns away in the same embers as every other demon when he dies.
export function houndMaterial() {
  const g = houndGrain();
  const u = { uDissolve: { value: 0 }, uHit: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ map: g.map, normalMap: g.normal, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aSurf; varying vec2 vSurf; varying vec3 vDPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDPos = position; vSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vSurf; varying vec3 vDPos; uniform float uDissolve, uHit, uHeat, uTime;
      float dh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float dn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(dh(i), dh(i+vec3(1,0,0)), f.x), mix(dh(i+vec3(0,1,0)), dh(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(dh(i+vec3(0,0,1)), dh(i+vec3(1,0,1)), f.x), mix(dh(i+vec3(0,1,1)), dh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dnz = dn(vDPos * 6.0) * 0.65 + dn(vDPos * 17.0) * 0.35;
      if (uDissolve > 0.0 && dnz < uDissolve) discard;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, vSurf.x);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.9, 0.16, 0.02) * vSurf.y * vSurf.y * uHeat * (0.7 + 0.3 * sin(uTime * 6.0 + vDPos.z * 11.0 + vDPos.y * 7.0));
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.8) * uHit;
      if (uDissolve > 0.0) totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * 6.0 * (1.0 - smoothstep(uDissolve, uDissolve + 0.07, dnz));`);
  };
  mat.customProgramCacheKey = () => 'hound-v2';
  return mat;
}
// build the skinned mesh and its bones; B[name] are the bones, each with userData.rest (its resting place in its parent)
export function instantiateHound(mat) {
  const tpl = buildHoundModel(), abs = (n) => tpl.joints[tpl.idx[n]].abs;
  const bones = tpl.joints.map((j) => { const b = new THREE.Bone(); b.name = j.name; const p = j.parent ? abs(j.parent) : [0, 0, 0]; b.position.set(j.abs[0] - p[0], j.abs[1] - p[1], j.abs[2] - p[2]); b.rotation.order = 'YXZ'; b.userData.rest = b.position.clone(); return b; });
  tpl.joints.forEach((j, i) => { if (j.parent) bones[tpl.idx[j.parent]].add(bones[i]); });
  const mesh = new THREE.SkinnedMesh(tpl.geo, mat); mesh.add(bones[0]); mesh.updateMatrixWorld(true); mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const B = {}; tpl.joints.forEach((j, i) => (B[j.name] = bones[i]));
  // the eyes: small, pale and dead, far back in their sockets; they catch the light and no more
  const eg = new THREE.SphereGeometry(0.024, 12, 8), ec = new Float32Array(eg.attributes.position.count * 3);
  for (let i = 0; i < eg.attributes.position.count; i++) { const z = eg.attributes.position.getZ(i) / 0.024, pupil = z > 0.72 ? 0.02 : 1; ec[i * 3] = 0.3 * pupil; ec[i * 3 + 1] = 0.26 * pupil; ec[i * 3 + 2] = 0.15 * pupil; }
  eg.setAttribute('color', new THREE.BufferAttribute(ec, 3));
  const em = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, emissive: 0x8f8a62, emissiveIntensity: 0.1 });
  const h = abs('head'), eyes = [];
  tpl.eyes.forEach((p, i) => { const m = new THREE.Mesh(eg, em); m.position.set(p[0] - h[0], p[1] - h[1], p[2] - h[2]); m.rotation.y = (i ? -1 : 1) * 0.62; B.head.add(m); eyes.push(m); });
  return { mesh, B, eyes, eyeMat: em };
}
