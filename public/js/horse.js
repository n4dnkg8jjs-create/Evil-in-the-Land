// A draught horse in harness, modelled as anatomy rather than as shapes.
//
// The body is a signed distance field built from the animal's real landmarks: the skull with its flat forehead,
// bony orbits, nasal bone, round jowls and the two branches of the lower jaw; muzzle, flared nostrils and lips;
// ears; an arched, laterally flattened neck with its crest; withers, back, loins, croup and the round of the
// quarters; the deep chest and sprung barrel; the shoulder, point of shoulder and breast; forearm, chestnut,
// knee, cannon with its tendons, fetlock, pastern, coronet and hoof; hip, stifle, gaskin, the hock and its point.
// It is meshed once with surface nets, every vertex pulled onto the surface with the field's gradient for its
// normal, and skinned to a real skeleton (spine, neck chain, head, ears, tail, five bones in each leg) with
// weights that fall off smoothly with distance from each bone, so joints fold without gaps.
//
// Hair is many strands: a mane falling to the off side, a forelock, a full tail, feathering at the fetlocks; the
// coat is a short-haired, faintly dappled sheen with dark points, a white blaze on one horse. The tack is fitted
// to the body by projecting each strap onto the surface: collar and hames with brass, bridle (crown piece,
// browband, cheek pieces, noseband), blinkers, the bit and its rings, reins back to the driver, back pad, girth,
// breeching and hip strap, traces back to the swingletree.
//
// It stands, breathes, shifts its weight, rests a hind hoof, tosses its head, flicks its ears, blinks and swishes
// its tail; it walks (four-beat), trots (diagonal pairs) and gallops (transverse four-beat), the body pitching,
// the head and neck pumping, the mane and tail streaming.
import * as THREE from 'three';
import { rng, lerp, smooth } from './util.js';

const sq = Math.sqrt, mx = Math.max, mn = Math.min, ab = Math.abs;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- distance-field kit
function smin(a, b, k) { const h = mx(k - ab(a - b), 0) / k; return mn(a, b) - h * h * k * 0.25; }
const smax = (a, b, k) => -smin(-a, -b, k);
function ell(x, y, z, rx, ry, rz) { const k0 = sq((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2), k1 = sq((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2); return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -mn(rx, ry, rz); }
// a round cone between two points (after Inigo Quilez), its lateral axis squashed by sx (< 1: flatter side to side)
function rcone(x, y, z, a, b, r1, r2, sx = 1) {
  const pax = (x - a[0]) / sx, pay = y - a[1], paz = z - a[2];
  const bax = (b[0] - a[0]) / sx, bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const yv = pax * bax + pay * bay + paz * baz, zv = yv - l2;
  const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv; const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = yv * yv * l2, z2 = zv * zv * l2, k = Math.sign(rr) * rr * rr * x2;
  let d;
  if (Math.sign(zv) * a2 * z2 > k) d = sq(x2 + z2) * il2 - r2;
  else if (Math.sign(yv) * a2 * y2 < k) d = sq(x2 + y2) * il2 - r1;
  else d = (sq(x2 * a2 * il2) + yv * rr) * il2 - r1;
  return d * mn(1, sx);
}

// ---------------------------------------------------------------- the horse's landmarks (rest pose, metres)
// +z forward, +x the horse's left, ground at y = 0, about 1.66 m at the withers
const POLL = [0, 2.17, 1.27], MUZ = [0, 1.6, 1.7];
const HF = v3(0, MUZ[1] - POLL[1], MUZ[2] - POLL[2]).normalize();   // down the face
const HU = v3(0, HF.z, -HF.y);                                       // up out of the forehead
// a point in the head's frame: a along the face from the poll, b up out of it, c to the side
const H = (a, b, c = 0) => [c, POLL[1] + HF.y * a + HU.y * b, POLL[2] + HF.z * a + HU.z * b];
const LEG = {
  fore: { shoulder: [0.2, 1.24, 0.83], elbow: [0.19, 1.0, 0.63], knee: [0.17, 0.52, 0.67], fetlock: [0.165, 0.2, 0.68], coronet: [0.165, 0.085, 0.735] },
  hind: { hip: [0.2, 1.36, -0.62], stifle: [0.25, 1.06, -0.36], hock: [0.17, 0.61, -0.72], fetlock: [0.165, 0.2, -0.665], coronet: [0.165, 0.085, -0.63] },
};
const S = (p, s) => [p[0] * s, p[1], p[2]];

function buildPrims() {
  const P = [];
  const add = (c, R, f, k) => P.push({ c, R, f, k });
  const E = (c, r, k = 0.06) => add(c, mx(r[0], r[1], r[2]), (x, y, z) => ell(x - c[0], y - c[1], z - c[2], r[0], r[1], r[2]), k);
  const C = (a, b, r1, r2, k = 0.06, sx = 1) => add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], sq((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 2 + mx(r1, r2), (x, y, z) => rcone(x, y, z, a, b, r1, r2, sx), k);
  // ---- the trunk
  E([0, 1.22, 0.02], [0.37, 0.43, 0.72], 0.12);            // barrel, ribs well sprung
  E([0, 1.27, 0.52], [0.33, 0.44, 0.43], 0.12);            // chest and forehand
  E([0, 1.32, -0.5], [0.34, 0.39, 0.44], 0.1);            // hindquarters
  for (const s of [-1, 1]) E([s * 0.16, 1.42, -0.56], [0.21, 0.26, 0.33], 0.08);   // the two rounds of the quarters
  C([0, 1.52, -0.42], [0, 1.52, 0.22], 0.15, 0.15, 0.1);   // back and loins
  C([0, 1.53, 0.18], [0, 1.6, 0.52], 0.12, 0.13, 0.08);    // withers
  E([0, 1.04, -0.05], [0.29, 0.24, 0.5], 0.12);           // belly
  for (const s of [-1, 1]) {
    E([s * 0.13, 1.3, -0.83], [0.1, 0.15, 0.08], 0.06);   // points of the buttock
    E([s * 0.27, 1.49, -0.38], [0.07, 0.06, 0.07], 0.06); // points of the hip
    E([s * 0.27, 1.2, -0.12], [0.08, 0.22, 0.28], 0.1);   // the spring of the ribs
  }
  C([0, 1.52, -0.76], [0, 1.45, -0.88], 0.07, 0.055, 0.05);   // tail head
  // ---- forelegs
  for (const s of [-1, 1]) {
    const L = LEG.fore;
    C(S([0.18, 1.56, 0.42], s), S([0.23, 1.22, 0.8], s), 0.09, 0.12, 0.08, 0.7);    // shoulder blade and its muscle
    E(S(L.shoulder, s), [0.1, 0.12, 0.1]);                                           // point of shoulder
    E(S([0.11, 1.1, 0.84], s), [0.11, 0.15, 0.1], 0.07);                             // breast
    C(S(L.shoulder, s), S(L.elbow, s), 0.13, 0.1, 0.07);                             // upper arm
    C(S([0.19, 1.04, 0.6], s), S([0.17, 0.56, 0.66], s), 0.12, 0.07, 0.05, 0.85);  // forearm
    E(S([0.18, 0.86, 0.7], s), [0.075, 0.15, 0.065], 0.05);                          // the forearm's front muscle
    E(S([0.205, 1.08, 0.53], s), [0.1, 0.14, 0.12], 0.05);                           // triceps, behind the elbow
    E(S([0.25, 1.36, 0.66], s), [0.07, 0.2, 0.14], 0.05);                            // the shoulder's long muscle
    E(S([0.125, 0.73, 0.655], s), [0.016, 0.026, 0.013], 0.01);                      // chestnut
    E(S(L.knee, s), [0.063, 0.07, 0.058], 0.03);                                     // knee
    C(S([0.17, 0.5, 0.675], s), S([0.165, 0.21, 0.685], s), 0.05, 0.048, 0.02, 0.85);   // cannon
    C(S([0.17, 0.47, 0.632], s), S([0.165, 0.23, 0.642], s), 0.03, 0.028, 0.02);  // flexor tendons
    E(S(L.fetlock, s), [0.052, 0.055, 0.06], 0.025);                                 // fetlock
    C(S([0.165, 0.19, 0.69], s), S(L.coronet, s), 0.05, 0.055, 0.02);              // pastern
  }
  // ---- hind legs
  for (const s of [-1, 1]) {
    const L = LEG.hind;
    C(S(L.hip, s), S(L.stifle, s), 0.2, 0.13, 0.1, 0.8);                            // thigh to stifle
    C(S([0.15, 1.32, -0.8], s), S([0.18, 0.92, -0.62], s), 0.14, 0.09, 0.08, 0.8);  // hamstring
    C(S([0.21, 1.0, -0.44], s), S([0.17, 0.66, -0.7], s), 0.115, 0.072, 0.05, 0.8);   // gaskin
    E(S(L.stifle, s), [0.08, 0.1, 0.08], 0.05);
    E(S([0.27, 1.2, -0.62], s), [0.09, 0.22, 0.15], 0.05);                           // the big muscle down the back of the quarters
    E(S([0.24, 1.38, -0.3], s), [0.08, 0.12, 0.12], 0.05);                           // the stifle's fold into the flank
    E(S(L.hock, s), [0.058, 0.075, 0.072], 0.03);                                    // hock
    C(S(L.hock, s), S([0.17, 0.69, -0.8], s), 0.038, 0.03, 0.025);                  // point of hock
    C(S([0.17, 0.58, -0.71], s), S([0.165, 0.21, -0.665], s), 0.055, 0.05, 0.02, 0.85);   // hind cannon
    C(S([0.17, 0.54, -0.76], s), S([0.165, 0.23, -0.71], s), 0.03, 0.028, 0.02); // its tendons
    E(S(L.fetlock, s), [0.052, 0.055, 0.06], 0.025);
    C(S([0.165, 0.19, -0.66], s), S(L.coronet, s), 0.05, 0.055, 0.02);
  }
  // ---- the neck, flattened side to side and arched, its crest, the throat
  C([0, 1.33, 0.74], [0, 1.68, 0.98], 0.34, 0.26, 0.1, 0.66);
  C([0, 1.68, 0.98], [0, 1.96, 1.16], 0.26, 0.18, 0.08, 0.62);
  C([0, 1.96, 1.16], [0, 2.07, 1.25], 0.18, 0.14, 0.06, 0.64);
  C([0, 1.72, 0.64], [0, 2.12, 1.12], 0.12, 0.075, 0.08, 0.72);      // the crest
  C(H(0.06, -0.09), [0, 1.98, 1.16], 0.085, 0.1, 0.06, 0.8);       // throat latch
  // ---- the head
  E(H(0.08, 0.02), [0.115, 0.12, 0.13], 0.04);                      // cranium
  C(H(0.12, 0.05), H(0.5, 0.005), 0.09, 0.06, 0.04, 0.85);       // the long face over the nasal bone
  E(H(0.565, -0.03), [0.07, 0.085, 0.075], 0.04);                  // muzzle
  for (const s of [-1, 1]) {
    E(H(0.21, -0.075, s * 0.078), [0.058, 0.11, 0.11], 0.04);           // cheek and jowl
    C(H(0.22, -0.13, s * 0.045), H(0.55, -0.085, s * 0.025), 0.038, 0.026, 0.03);   // a branch of the lower jaw
    E(H(0.165, 0.065, s * 0.092), [0.03, 0.03, 0.034], 0.02);        // the bony rim of the orbit
    E(H(0.59, 0.005, s * 0.044), [0.024, 0.026, 0.025], 0.015);      // flared nostril
    C(H(-0.02, 0.1, s * 0.058), [s * 0.08, 2.35, 1.4], 0.032, 0.007, 0.02, 0.6);   // ear
  }
  E(H(0.54, -0.115), [0.04, 0.04, 0.035], 0.03);                   // chin
  // carvings: eye sockets, nostrils, the line of the lips, the hollow of each ear
  const carve = [];
  for (const s of [-1, 1]) {
    const e = H(0.17, 0.058, s * 0.108); carve.push((x, y, z) => ell(x - e[0], y - e[1], z - e[2], 0.026, 0.026, 0.03));
    const n = H(0.605, 0.002, s * 0.048); carve.push((x, y, z) => ell(x - n[0], y - n[1], z - n[2], 0.011, 0.018, 0.016));
    const e0 = H(-0.02, 0.13, s * 0.06), e1 = [s * 0.08, 2.33, 1.42]; carve.push((x, y, z) => rcone(x, y, z, [e0[0], e0[1], e0[2] + 0.018], [e1[0], e1[1], e1[2] + 0.012], 0.018, 0.003, 0.5));
  }
  const m0 = H(0.48, -0.066, 0.042), m1 = H(0.64, -0.07, 0), m2 = H(0.48, -0.066, -0.042);
  carve.push((x, y, z) => rcone(x, y, z, m0, m1, 0.009, 0.007)); carve.push((x, y, z) => rcone(x, y, z, m2, m1, 0.009, 0.007));
  return { P, carve };
}
let PRIMS = null;
function sdf(x, y, z) {
  const { P, carve } = PRIMS;
  let d = 1e9;
  for (let i = 0; i < P.length; i++) {
    const p = P[i]; const lb = sq((x - p.c[0]) ** 2 + (y - p.c[1]) ** 2 + (z - p.c[2]) ** 2) - p.R;
    if (lb > d + p.k) continue;
    d = smin(d, p.f(x, y, z), p.k);
  }
  if (d < 0.05) for (const f of carve) d = smax(d, -f(x, y, z), 0.008);
  // hooves: a horn wall flaring to the ground, flat beneath
  if (y < 0.14) for (const s of [-1, 1]) for (const zc of [0.745, -0.62]) {
    const hx = x - s * 0.165, hz = z - zc; const t = mn(1, mx(0, (0.095 - y) / 0.095));
    const r = 0.06 + 0.034 * t; const dh = mx(sq(hx * hx + hz * hz * 1.15) - r, mx(y - 0.095, -y));
    d = smin(d, dh, 0.012);
  }
  return mx(d, -y);
}
const grad = (x, y, z, e = 0.003) => { const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e); const l = sq(gx * gx + gy * gy + gz * gz) || 1; return [gx / l, gy / l, gz / l]; };
// a point moved out to `off` above the skin
function onSurface(p, off) { let x = p[0] ?? p.x, y = p[1] ?? p.y, z = p[2] ?? p.z; for (let i = 0; i < 6; i++) { const d = sdf(x, y, z) - off; const g = grad(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; } return v3(x, y, z); }

// ---------------------------------------------------------------- surface nets, culled by a coarse pass
function meshSDF(lo, hi, h) {
  const [x0, y0, z0] = lo; const nx = Math.ceil((hi[0] - x0) / h) + 1, ny = Math.ceil((hi[1] - y0) / h) + 1, nz = Math.ceil((hi[2] - z0) / h) + 1;
  const V = new Float32Array(nx * ny * nz);
  const C4 = 4, cx = Math.ceil(nx / C4) + 1, cy = Math.ceil(ny / C4) + 1, cz = Math.ceil(nz / C4) + 1; const Cv = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) Cv[i + cx * (j + cy * k)] = sdf(x0 + i * C4 * h, y0 + j * C4 * h, z0 + k * C4 * h);
  const band = C4 * h * 1.9;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = Cv[Math.round(i / C4) + cx * (Math.round(j / C4) + cy * Math.round(k / C4))];
    V[i + nx * (j + ny * k)] = ab(c) > band ? c : sdf(x0 + i * h, y0 + j * h, z0 + k * h);
  }
  const cid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1); const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]; const cc = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0; for (let q = 0; q < 8; q++) { cc[q] = V[(i + co[q][0]) + nx * ((j + co[q][1]) + ny * (k + co[q][2]))]; if (cc[q] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) { if ((cc[a] < 0) === (cc[b] < 0)) continue; const t = cc[a] / (cc[a] - cc[b]); sx += co[a][0] + (co[b][0] - co[a][0]) * t; sy += co[a][1] + (co[b][1] - co[a][1]) * t; sz += co[a][2] + (co[b][2] - co[a][2]) * t; n++; }
    cid[i + (nx - 1) * (j + (ny - 1) * k)] = pos.length / 3; pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  const Cid = (i, j, k) => cid[i + (nx - 1) * (j + (ny - 1) * k)]; const idx = [];
  const quad = (a, b, c2, d, flip) => { if (a < 0 || b < 0 || c2 < 0 || d < 0) return; if (flip) idx.push(a, c2, b, a, d, c2); else idx.push(a, b, c2, a, c2, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = V[i + nx * (j + ny * k)] < 0;
    if ((V[i + 1 + nx * (j + ny * k)] < 0) !== v0) quad(Cid(i, j - 1, k - 1), Cid(i, j, k - 1), Cid(i, j, k), Cid(i, j - 1, k), v0);
    if ((V[i + nx * (j + 1 + ny * k)] < 0) !== v0) quad(Cid(i - 1, j, k - 1), Cid(i - 1, j, k), Cid(i, j, k), Cid(i, j, k - 1), v0);
    if ((V[i + nx * (j + ny * (k + 1))] < 0) !== v0) quad(Cid(i - 1, j - 1, k), Cid(i, j - 1, k), Cid(i, j, k), Cid(i - 1, j, k), v0);
  }
  const nrm = new Float32Array(pos.length);
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    for (let it = 0; it < 2; it++) { const d = sdf(x, y, z); const g = grad(x, y, z, h * 0.5); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; if (it) { nrm[v] = g[0]; nrm[v + 1] = g[1]; nrm[v + 2] = g[2]; } }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]) < 0) { const tt = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tt; }
  }
  return { pos: new Float32Array(pos), nrm, idx };
}

// ---------------------------------------------------------------- the skeleton
// [name, parent, head (world rest)]; a bone's segment runs from its head to its first child's head
const BONES = (() => {
  const B = [['root', null, [0, 0, 0]], ['body', 'root', [0, 1.3, 0]], ['pelvis', 'body', [0, 1.4, -0.48]], ['spine', 'pelvis', [0, 1.38, 0]], ['chest', 'spine', [0, 1.4, 0.42]],
    ['neck1', 'chest', [0, 1.45, 0.76]], ['neck2', 'neck1', [0, 1.72, 0.99]], ['neck3', 'neck2', [0, 1.97, 1.17]], ['head', 'neck3', POLL], ['muzzle', 'head', MUZ],
    ['tail1', 'pelvis', [0, 1.5, -0.84]], ['tail2', 'tail1', [0, 1.39, -0.92]], ['tail3', 'tail2', [0, 1.23, -0.95]], ['tail4', 'tail3', [0, 1.05, -0.96]], ['tailEnd', 'tail4', [0, 0.85, -0.96]]];
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const F = LEG.fore, Hd = LEG.hind;
    B.push(['scap' + k, 'chest', S([0.18, 1.52, 0.48], s)], ['humerus' + k, 'scap' + k, S(F.shoulder, s)], ['radius' + k, 'humerus' + k, S(F.elbow, s)], ['cannonF' + k, 'radius' + k, S(F.knee, s)],
      ['pasternF' + k, 'cannonF' + k, S(F.fetlock, s)], ['hoofF' + k, 'pasternF' + k, S([0.165, 0.06, 0.74], s)]);
    B.push(['femur' + k, 'pelvis', S(Hd.hip, s)], ['tibia' + k, 'femur' + k, S(Hd.stifle, s)], ['cannonH' + k, 'tibia' + k, S(Hd.hock, s)], ['pasternH' + k, 'cannonH' + k, S(Hd.fetlock, s)], ['hoofH' + k, 'pasternH' + k, S([0.165, 0.06, -0.625], s)]);
    B.push(['ear' + k, 'head', H(-0.02, 0.1, s * 0.058)]);
  }
  return B;
})();
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const HEAD_OF = Object.fromEntries(BONES.map((b) => [b[0], b[2]]));
function boneReach(name) {
  if (/pelvis|spine|chest/.test(name)) return 0.32;
  if (/neck/.test(name)) return 0.13;
  if (name === 'head') return 0.16; if (name === 'muzzle') return 0.1;
  if (/scap/.test(name)) return 0.14; if (/humerus|femur/.test(name)) return 0.13;
  if (/radius|tibia/.test(name)) return 0.085; if (/cannon/.test(name)) return 0.06; if (/pastern|hoof/.test(name)) return 0.05;
  if (/ear/.test(name)) return 0.03; if (/tail/.test(name)) return 0.06;
  return 0;
}

// ---------------------------------------------------------------- build once
// Quadric edge-collapse decimation (Garland & Heckbert): flat stretches of hide lose triangles, the face, joints
// and tendons keep theirs; every surviving vertex is snapped back onto the true surface afterwards.
function decimate(pos, idx, target) {
  const nV = pos.length / 3; let nF = idx.length / 3;
  const Q = new Float64Array(nV * 10), F = Int32Array.from(idx), alive = new Uint8Array(nF).fill(1), vf = Array.from({ length: nV }, () => []);
  const plane = (f) => { const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3; const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2]; let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const l = sq(nx * nx + ny * ny + nz * nz) || 1e-12; nx /= l; ny /= l; nz /= l; return [nx, ny, nz, -(nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2]), l]; };
  for (let f = 0; f < nF; f++) { const [a, b, c, d, area] = plane(f); const q = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d]; for (let k = 0; k < 3; k++) { const v = F[f * 3 + k]; vf[v].push(f); for (let i = 0; i < 10; i++) Q[v * 10 + i] += q[i] * area; } }
  const cost = (u, v, out) => {
    const x = (pos[u * 3] + pos[v * 3]) / 2, y = (pos[u * 3 + 1] + pos[v * 3 + 1]) / 2, z = (pos[u * 3 + 2] + pos[v * 3 + 2]) / 2; out[0] = x; out[1] = y; out[2] = z;
    const q = (i) => Q[u * 10 + i] + Q[v * 10 + i];
    return q(0) * x * x + 2 * q(1) * x * y + 2 * q(2) * x * z + 2 * q(3) * x + q(4) * y * y + 2 * q(5) * y * z + 2 * q(6) * y + q(7) * z * z + 2 * q(8) * z + q(9);
  };
  // a binary heap of candidate edges, invalidated lazily by vertex version stamps
  const ver = new Uint32Array(nV), heap = []; const tmp = [0, 0, 0];
  const push = (e) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].c <= e.c) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; const n = heap.length; for (;;) { let l = i * 2 + 1, r = l + 1, m = i; if (l < n && heap[l].c < (m === i ? last.c : heap[m].c)) m = l; if (r < n && heap[r].c < (m === i ? last.c : heap[m].c)) m = r; if (m === i) break; heap[i] = heap[m]; i = m; } heap[i] = last; } return top; };
  const addEdges = (v) => { const seen = new Set(); for (const f of vf[v]) if (alive[f]) for (let k = 0; k < 3; k++) { const w = F[f * 3 + k]; if (w !== v && !seen.has(w)) { seen.add(w); push({ u: v, v: w, a: ver[v], b: ver[w], c: cost(v, w, tmp) }); } } };
  for (let v = 0; v < nV; v++) addEdges(v);
  const dead = new Uint8Array(nV);
  while (nF > target && heap.length) {
    const e = pop(); const { u, v } = e;
    if (dead[u] || dead[v] || e.a !== ver[u] || e.b !== ver[v]) continue;
    const c = cost(u, v, tmp); const nx = tmp[0], ny = tmp[1], nz = tmp[2];
    // refuse collapses that would fold a triangle over
    let ok = true;
    for (const w of [u, v]) for (const f of vf[w]) {
      if (!alive[f]) continue; const i0 = F[f * 3], i1 = F[f * 3 + 1], i2 = F[f * 3 + 2]; if ((i0 === u || i1 === u || i2 === u) && (i0 === v || i1 === v || i2 === v)) continue;
      const P = [i0, i1, i2].map((i) => (i === u || i === v) ? [nx, ny, nz] : [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
      const o = plane(f); const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], wx = P[2][0] - P[0][0], wy = P[2][1] - P[0][1], wz = P[2][2] - P[0][2];
      const mx2 = uy * wz - uz * wy, my2 = uz * wx - ux * wz, mz2 = ux * wy - uy * wx; const l = sq(mx2 * mx2 + my2 * my2 + mz2 * mz2);
      if (l < 1e-14 || (mx2 * o[0] + my2 * o[1] + mz2 * o[2]) / l < 0.3) { ok = false; break; }
    }
    if (!ok) { ver[u]++; continue; }
    pos[u * 3] = nx; pos[u * 3 + 1] = ny; pos[u * 3 + 2] = nz; for (let i = 0; i < 10; i++) Q[u * 10 + i] += Q[v * 10 + i];
    dead[v] = 1;
    for (const f of vf[v]) { if (!alive[f]) continue; let hasU = false; for (let k = 0; k < 3; k++) { if (F[f * 3 + k] === u) hasU = true; } if (hasU) { alive[f] = 0; nF--; } else { for (let k = 0; k < 3; k++) if (F[f * 3 + k] === v) F[f * 3 + k] = u; vf[u].push(f); } }
    ver[u]++; addEdges(u);
  }
  // compact
  const remap = new Int32Array(nV).fill(-1); const P2 = [], I2 = [];
  for (let f = 0; f < F.length / 3; f++) { if (!alive[f]) continue; for (let k = 0; k < 3; k++) { const v = F[f * 3 + k]; if (remap[v] < 0) { remap[v] = P2.length / 3; P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } I2.push(remap[v]); } }
  return { pos: new Float32Array(P2), idx: I2 };
}

// Everything about the horse that does not change from one horse to the next, as plain arrays: the hide
// (positions, normals, skin weights, markings), the hair and the tack. Built offline at a fine resolution and
// decimated (tools/build_horse.mjs -> public/models/horse.json); built at a coarser one in the browser if that
// file is missing.
export function buildHorseData(h = 0.022, target = 0) {
  PRIMS = buildPrims();
  let { pos, idx } = meshSDF([-0.46, -0.01, -1.02], [0.46, 2.42, 1.84], h);
  if (target && idx.length / 3 > target) ({ pos, idx } = decimate(pos, idx, target));
  const nV = pos.length / 3, nrm = new Float32Array(pos.length);
  for (let v = 0; v < nV; v++) {   // back onto the surface, with the field's own normal
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let it = 0; it < 3; it++) { const d = sdf(x, y, z); const g = grad(x, y, z, 0.004); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; if (it === 2) { nrm[v * 3] = g[0]; nrm[v * 3 + 1] = g[1]; nrm[v * 3 + 2] = g[2]; } }
    pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
  }
  const child = {}; for (const [n, p] of BONES) if (p && !child[p]) child[p] = n;
  const segs = BONES.map(([n], i) => { const a = HEAD_OF[n], c = child[n] ? HEAD_OF[child[n]] : null; return { i, n, a, b: c || [a[0], a[1] - 0.05, a[2]], r: boneReach(n), side: /L$/.test(n) ? 1 : /R$/.test(n) ? -1 : 0, ear: /ear/.test(n), tail: /tail/.test(n) }; }).filter((s) => s.r > 0);
  const si = new Uint16Array(nV * 4), sw = new Float32Array(nV * 4), mk = new Float32Array(nV * 4);   // markings: points, hoof, blaze, muzzle
  const w = [];
  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    w.length = 0;
    for (const s of segs) {
      if (s.side && x * s.side < -0.03) continue;
      if (s.ear && y < 2.22) continue;
      if (s.tail && z > -0.72) continue;
      const ax = s.a[0], ay = s.a[1], az = s.a[2], dx = s.b[0] - ax, dy = s.b[1] - ay, dz = s.b[2] - az;
      const t = mx(0, mn(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
      const d = sq((x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2 + (z - az - dz * t) ** 2);
      w.push([s.i, Math.exp(-((d / s.r) ** 2) * 1.6)]);
    }
    w.sort((A, B) => B[1] - A[1]); let tot = 0; for (let k = 0; k < 4 && k < w.length; k++) tot += w[k][1];
    if (tot > 1e-12) for (let k = 0; k < 4 && k < w.length; k++) { si[v * 4 + k] = w[k][0]; sw[v * 4 + k] = w[k][1] / tot; }
    else { si[v * 4] = BI.spine; sw[v * 4] = 1; }
    const legLow = smooth(mn(1, mx(0, (0.56 - y) / 0.14))) * (ab(z) > 0.45 ? 1 : 0);
    mk[v * 4] = mx(legLow, y > 2.2 && z > 1.3 && z < 1.5 ? smooth(mn(1, mx(0, (y - 2.24) / 0.08))) : 0);
    mk[v * 4 + 1] = y < 0.092 ? 1 : 0;
    const ha = (y - POLL[1]) * HF.y + (z - POLL[2]) * HF.z, hb = (y - POLL[1]) * HU.y + (z - POLL[2]) * HU.z;
    mk[v * 4 + 2] = (ha > 0.1 && ha < 0.6 && hb > -0.02 && ab(x) < 0.028 + 0.025 * smooth(mn(1, mx(0, (0.3 - ha) / 0.2)))) ? 1 : 0;
    mk[v * 4 + 3] = ha > 0.5 && hb < 0.08 ? smooth(mn(1, (ha - 0.5) / 0.08)) : 0;
  }
  const geoData = (g) => { const o = { index: Array.from(g.index.array) }; for (const k in g.attributes) o[k] = { a: Array.from(g.attributes[k].array), n: g.attributes[k].itemSize }; return o; };
  // tack merged per material and bone
  const groups = {}; for (const [g, m, bn] of buildTack()) { const k = m + '|' + bn; (groups[k] = groups[k] || []).push(g.index ? g.toNonIndexed() : g); }
  const tack = Object.entries(groups).map(([k, gs]) => { const [m, bone] = k.split('|'); const P = [], N = []; for (const g of gs) { if (!g.attributes.normal) g.computeVertexNormals(); P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); } return { m, bone, pos: P, nrm: N }; });
  return { pos: Array.from(pos), nrm: Array.from(nrm), si: Array.from(si), sw: Array.from(sw), mk: Array.from(mk), idx, hair: geoData(buildHair()), tack };
}

// ---------------------------------------------------------------- the data, built offline or here
const b64 = { enc: (TA) => { const u = new Uint8Array(TA.buffer, TA.byteOffset, TA.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return (typeof btoa === 'function' ? btoa : (x) => Buffer.from(x, 'binary').toString('base64'))(s); },
  dec: (str, T) => { const s = atob(str); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); } };
// pack for the json file: positions as float32, normals int8, weights uint8, markings uint8
export function packHorseData(D) {
  const q8 = (a, s) => Int8Array.from(a, (v) => Math.round(Math.max(-1, Math.min(1, v)) * 127));
  const u8 = (a) => Uint8Array.from(a, (v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  const hair = {}; for (const k in D.hair) hair[k] = k === 'index' ? b64.enc(Uint32Array.from(D.hair.index)) : { n: D.hair[k].n, t: k === 'skinIndex' ? 'u16' : 'f32', a: b64.enc(k === 'skinIndex' ? Uint16Array.from(D.hair[k].a) : Float32Array.from(D.hair[k].a)) };
  return { about: 'A draught horse, modelled as a signed distance field and decimated. Built by tools/build_horse.mjs from public/js/horse.js.',
    pos: b64.enc(Float32Array.from(D.pos)), nrm: b64.enc(q8(D.nrm)), si: b64.enc(Uint16Array.from(D.si)), sw: b64.enc(u8(D.sw)), mk: b64.enc(u8(D.mk)), idx: b64.enc(Uint32Array.from(D.idx)),
    hair, tack: D.tack.map((t) => ({ m: t.m, bone: t.bone, pos: b64.enc(Float32Array.from(t.pos)), nrm: b64.enc(q8(t.nrm)) })) };
}
let PACKED = null;
export const horseReady = (typeof window !== 'undefined' && typeof fetch === 'function') ? fetch('models/horse.json').then((r) => (r.ok ? r.json() : null)).then((j) => { PACKED = j; }).catch(() => {}) : Promise.resolve();

let BUILT = null;
function build() {
  if (BUILT) return BUILT;
  const t0 = performance.now(); const geo = new THREE.BufferGeometry(); let hair, tack;
  if (PACKED) {
    const J = PACKED;
    geo.setAttribute('position', new THREE.BufferAttribute(b64.dec(J.pos, Float32Array), 3)); geo.setAttribute('normal', new THREE.BufferAttribute(b64.dec(J.nrm, Int8Array), 3, true));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(b64.dec(J.si, Uint16Array), 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(b64.dec(J.sw, Uint8Array), 4, true));
    geo.setAttribute('aMarks', new THREE.BufferAttribute(b64.dec(J.mk, Uint8Array), 4, true)); geo.setIndex(new THREE.BufferAttribute(b64.dec(J.idx, Uint32Array), 1));
    hair = new THREE.BufferGeometry(); for (const k in J.hair) { if (k === 'index') hair.setIndex(new THREE.BufferAttribute(b64.dec(J.hair.index, Uint32Array), 1)); else { const A = J.hair[k]; hair.setAttribute(k, new THREE.BufferAttribute(b64.dec(A.a, A.t === 'u16' ? Uint16Array : Float32Array), A.n)); } }
    tack = J.tack.map((t) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(b64.dec(t.pos, Float32Array), 3)); g.setAttribute('normal', new THREE.BufferAttribute(b64.dec(t.nrm, Int8Array), 3, true)); return [g, t.m, t.bone]; });
  } else {
    const D = buildHorseData(0.022, 0);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(D.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(D.nrm, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(D.si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(D.sw, 4));
    geo.setAttribute('aMarks', new THREE.Float32BufferAttribute(D.mk, 4)); geo.setIndex(D.idx);
    hair = new THREE.BufferGeometry(); for (const k in D.hair) { if (k === 'index') hair.setIndex(D.hair.index); else hair.setAttribute(k, k === 'skinIndex' ? new THREE.Uint16BufferAttribute(D.hair[k].a, D.hair[k].n) : new THREE.Float32BufferAttribute(D.hair[k].a, D.hair[k].n)); }
    tack = D.tack.map((t) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nrm, 3)); return [g, t.m, t.bone]; });
  }
  geo.computeBoundingSphere(); hair.computeBoundingSphere();
  BUILT = { geo, hair, tack, ms: performance.now() - t0, tris: geo.index.count / 3, packed: !!PACKED };
  return BUILT;
}

// ---------------------------------------------------------------- hair
// strands as thin ribbons, each skinned to its bones (the mane to the neck, the tail along its dock)
function buildHair() {
  const r = rng(424); const P = [], U = [], I = [], SI = [], SW = [];
  const strand = (pts, width, bones) => {
    const base = P.length / 3, n = pts.length;
    for (let k = 0; k < n; k++) {
      const q = pts[mn(n - 1, k + 1)], o = pts[mx(0, k - 1)]; const t = v3(q.x - o.x, q.y - o.y, q.z - o.z).normalize();
      let side = v3(t.z, 0, -t.x); if (side.lengthSq() < 0.05) side = v3(1, 0, 0); side.normalize();
      const p = pts[k], wv = width * (1 - (k / (n - 1)) * 0.7); const bw = bones(k / (n - 1));
      for (const sg of [-1, 1]) { P.push(p.x + side.x * wv * sg, p.y + side.y * wv * sg, p.z + side.z * wv * sg); U.push(sg * 0.5 + 0.5, k / (n - 1)); SI.push(bw[0][0], bw[1][0], 0, 0); SW.push(bw[0][1], bw[1][1], 0, 0); }
      if (k < n - 1) { const a = base + k * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  };
  // the mane: from the crest, falling to the off (right, -x) side over the neck
  const neckBones = ['neck1', 'neck2', 'neck3', 'head'].map((n) => BI[n]);
  for (let i = 0; i < 240; i++) {
    const t = i / 239; const cy = lerp(1.76, 2.2, t) + Math.sin(t * Math.PI) * 0.05, cz = lerp(0.64, 1.22, t);
    const root = onSurface([0, cy + 0.1, cz], 0.003); const len = 0.2 + r() * 0.12 - t * 0.07; const pts = [root];
    let p = root.clone(); const dir = v3(-0.5 - r() * 0.35, -0.75, (r() - 0.6) * 0.25).normalize();
    for (let k = 1; k <= 4; k++) { p = p.clone().addScaledVector(dir, len / 4); p = onSurface(p, 0.006 + k * 0.0025); pts.push(p); dir.y -= 0.12; dir.normalize(); }
    const bi = neckBones[mn(3, Math.floor(t * 3.3))]; strand(pts, 0.0065 + r() * 0.003, () => [[bi, 1], [bi, 0]]);
  }
  // forelock: from the poll forward over the forehead, between the ears
  for (let i = 0; i < 45; i++) {
    const root = onSurface(H(-0.01 + r() * 0.04, 0.13, (r() - 0.5) * 0.05), 0.003); const pts = [root]; let p = root.clone();
    for (let k = 1; k <= 4; k++) { p = p.clone().add(v3((r() - 0.5) * 0.01, HF.y * 0.045, HF.z * 0.045)); p = onSurface(p, 0.005 + k * 0.002); pts.push(p); }
    strand(pts, 0.0065, () => [[BI.head, 1], [BI.head, 0]]);
  }
  // the tail: a full fall of hair from the dock to below the hocks
  const tb = ['tail1', 'tail2', 'tail3', 'tail4', 'tailEnd'].map((n) => BI[n]);
  for (let i = 0; i < 280; i++) {
    const t0 = r() * 0.85; const a = r() * Math.PI * 2, rad = 0.03 + r() * 0.03; const len = 0.5 + r() * 0.25;
    const y0 = lerp(1.5, 1.08, t0), z0 = lerp(-0.86, -0.97, Math.sqrt(t0));
    const start = v3(Math.cos(a) * rad, y0, z0 + Math.sin(a) * rad * 0.8 - 0.02);
    const pts = [start]; for (let k = 1; k <= 6; k++) { const s = k / 6; pts.push(v3(start.x * (1 + s * 0.9), start.y - len * s * (1 - t0 * 0.3), start.z - 0.05 * s - 0.02 * Math.sin(s * 3))); }
    strand(pts, 0.0075 + r() * 0.003, (s) => { const f = mn(3.999, (t0 + s * (1 - t0)) * 4); const k = Math.floor(f), u = f - k; return [[tb[k], 1 - u], [tb[k + 1], u]]; });
  }
  // feathering at the fetlocks, falling over the hooves
  for (const [k, s] of [['L', 1], ['R', -1]]) for (const [leg, zc] of [['F', 0.68], ['H', -0.665]]) {
    const bi = BI['pastern' + leg + k];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2; const root = onSurface([s * 0.165 + Math.cos(a) * 0.05, 0.19 + (r() - 0.5) * 0.04, zc + Math.sin(a) * 0.055], 0.003);
      const out = v3(Math.cos(a), 0, Math.sin(a) - 0.6).normalize(); const pts = [root];
      for (let j = 1; j <= 3; j++) pts.push(root.clone().addScaledVector(out, 0.012 * j).add(v3(0, -0.035 * j, 0)));
      strand(pts, 0.007, () => [[bi, 1], [bi, 0]]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- tack, fitted to the body
// a flat leather strap laid along guide points projected onto the skin
function strapGeo(guide, width, off = 0.008, thick = 0.006, closed = false) {
  const pts = guide.map((p) => onSurface(p, off)); const n = pts.length; const P = [], I = [];
  for (let k = 0; k < n; k++) {
    const p = pts[k]; const nr = v3(...grad(p.x, p.y, p.z)); const q = pts[closed ? (k + 1) % n : mn(n - 1, k + 1)], o = pts[closed ? (k - 1 + n) % n : mx(0, k - 1)];
    const t = q.clone().sub(o).normalize(); const sd = new THREE.Vector3().crossVectors(nr, t).normalize().multiplyScalar(width / 2);
    for (const [a, b] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) P.push(p.x + sd.x * a + nr.x * thick * b, p.y + sd.y * a + nr.y * thick * b, p.z + sd.z * a + nr.z * thick * b);
  }
  const segN = closed ? n : n - 1;
  for (let k = 0; k < segN; k++) { const a = k * 4, b = ((k + 1) % n) * 4; for (let f = 0; f < 4; f++) { const f2 = (f + 1) % 4; I.push(a + f, b + f, b + f2, a + f, b + f2, a + f2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
const ring = (fn, n = 28) => { const out = []; for (let i = 0; i < n; i++) out.push(fn((i / n) * Math.PI * 2)); return out; };
function buildTack() {
  const T = [];   // [geometry, material, bone]
  const add = (g, m, b) => T.push([g, m, b]);
  // the collar: a thick padded ring round the base of the neck, leaning back with it; hames along its front, brass knobs and terrets
  {
    const c = v3(0, 1.5, 0.93); const ax = v3(0, Math.sin(0.38), Math.cos(0.38));   // the collar's axis, along the neck
    const up = v3(0, ax.z, -ax.y);   // perpendicular, in the median plane
    const cp = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; const rx = 0.26, ry = 0.33 + 0.06 * mx(0, -Math.cos(a)); cp.push(c.clone().add(v3(Math.sin(a) * rx, 0, 0)).addScaledVector(up, Math.cos(a) * ry)); }
    const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp, true), 72, 0.055, 12, true); const pp = tg.attributes.position;
    for (let i = 0; i < pp.count; i++) { const p = v3(pp.getX(i), pp.getY(i), pp.getZ(i)); const d = sdf(p.x, p.y, p.z); if (d < 0.015) { const g = grad(p.x, p.y, p.z); p.addScaledVector(v3(...g), 0.015 - d); pp.setXYZ(i, p.x, p.y, p.z); } }
    tg.computeVertexNormals(); add(tg, 'collar', 'neck1');
    for (const s of [-1, 1]) {
      const hp = []; for (let i = 0; i <= 14; i++) { const a = lerp(0.25, 2.75, i / 14); hp.push(c.clone().add(v3(s * Math.sin(a) * 0.33, 0, 0)).addScaledVector(up, Math.cos(a) * 0.46).addScaledVector(ax, 0.06)); }
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp), 28, 0.017, 7), 'brass', 'neck1');
      const top = hp[0]; add(new THREE.SphereGeometry(0.032, 12, 8).translate(top.x, top.y + 0.03, top.z), 'brass', 'neck1');
      const ter = c.clone().add(v3(s * 0.25, 0, 0)).addScaledVector(up, 0.27).addScaledVector(ax, 0.07);
      add(new THREE.TorusGeometry(0.028, 0.007, 6, 14).rotateY(Math.PI / 2).translate(ter.x, ter.y, ter.z), 'brass', 'neck1');
    }
  }
  // the bridle: crown piece and throatlatch, browband, cheek pieces, noseband, bit and rings, blinkers
  {
    const cr = []; for (let i = 0; i <= 20; i++) { const a = lerp(-1.9, 1.9, i / 20); cr.push(H(0.02 + 0.0 * a, 0.0 + Math.cos(a) * 0.14 - 0.02, Math.sin(a) * 0.1)); }
    add(strapGeo(cr, 0.022, 0.004, 0.005), 'leather', 'head');
    const tl = []; for (let i = 0; i <= 16; i++) { const a = lerp(-1.5, 1.5, i / 16); tl.push(H(0.1, -0.06 - Math.cos(a) * 0.08, Math.sin(a) * 0.1)); }
    add(strapGeo(tl, 0.016, 0.004, 0.005), 'leather', 'head');
    const bb = []; for (let i = 0; i <= 12; i++) bb.push(H(0.07, 0.1, lerp(-0.08, 0.08, i / 12))); add(strapGeo(bb, 0.02, 0.004), 'leather', 'head');
    add(strapGeo(ring((a) => H(0.42, -0.03 + Math.cos(a) * 0.08, Math.sin(a) * 0.09), 28), 0.024, 0.004, 0.005, true), 'leather', 'head');
    for (const s of [-1, 1]) {
      const ch = []; for (let i = 0; i <= 12; i++) { const t = i / 12; ch.push(H(lerp(0.02, 0.53, t), lerp(0.04, -0.07, t), s * lerp(0.1, 0.07, t))); } add(strapGeo(ch, 0.02, 0.005), 'leather', 'head');
      const bit = H(0.55, -0.075, s * 0.074); add(new THREE.TorusGeometry(0.032, 0.006, 8, 20).rotateY(Math.PI / 2).translate(bit[0] + s * 0.004, bit[1], bit[2]), 'steel', 'head');
      const bl = H(0.15, 0.06, s * 0.14); const bg = new THREE.SphereGeometry(0.075, 14, 8, -Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.32, Math.PI * 0.36); bg.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2); bg.translate(bl[0] - s * 0.06, bl[1], bl[2]); add(bg, 'leather', 'head');
      add(new THREE.SphereGeometry(0.012, 8, 6).translate(...H(0.07, 0.1, s * 0.085)), 'brass', 'head');   // rosettes on the browband
    }
    const mo = H(0.55, -0.075, 0); add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.15, 8).rotateZ(Math.PI / 2).translate(mo[0], mo[1], mo[2]), 'steel', 'head');
  }
  // the girth and back pad, the hip strap and breeching
  add(strapGeo(ring((a) => [Math.sin(a) * 0.5, 1.22 + Math.cos(a) * 0.55, 0.3], 40), 0.075, 0.006, 0.008, true), 'leather', 'spine');
  { const pad = new THREE.SphereGeometry(0.24, 18, 8, 0, Math.PI * 2, 0, 0.75).scale(0.9, 0.5, 0.85); pad.translate(0, 1.5, 0.3); const pp = pad.attributes.position; for (let i = 0; i < pp.count; i++) { const p = onSurface([pp.getX(i), pp.getY(i), pp.getZ(i)], 0.02); pp.setXYZ(i, p.x, p.y, p.z); } pad.computeVertexNormals(); add(pad, 'leather', 'spine'); }
  const br = []; for (let i = 0; i <= 26; i++) { const a = lerp(-1.75, 1.75, i / 26); br.push([Math.sin(a) * 0.5, 1.22, -0.5 - Math.cos(a) * 0.5]); } add(strapGeo(br, 0.055, 0.006), 'leather', 'pelvis');   // breeching round the quarters
  add(strapGeo([[-0.45, 1.25, -0.42], [-0.3, 1.5, -0.41], [0, 1.68, -0.4], [0.3, 1.5, -0.41], [0.45, 1.25, -0.42]], 0.04, 0.006), 'leather', 'pelvis');   // hip strap over the loins
  for (const s of [-1, 1]) add(strapGeo([[s * 0.44, 1.32, -0.41], [s * 0.45, 1.24, -0.45], [s * 0.42, 1.2, -0.5]], 0.035, 0.006), 'leather', 'pelvis');
  // traces: from the hames back along each side to the swingletree
  for (const s of [-1, 1]) {
    const tp = [v3(s * 0.34, 1.27, 0.86), onSurface([s * 0.45, 1.17, 0.25], 0.03), onSurface([s * 0.46, 1.08, -0.35], 0.05), v3(s * 0.45, 0.96, -0.8), v3(s * 0.42, 0.88, -1.05)];
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tp), 32, 0.015, 6), 'leather', 'spine');
  }
  return T;
}

// ---------------------------------------------------------------- materials
function coatMaterial(coat, blaze) {
  const m = new THREE.MeshPhysicalMaterial({ color: coat, roughness: 0.5, metalness: 0, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(coat).lerp(new THREE.Color(0xffffff), 0.35) });
  const U = { uBlaze: { value: blaze ? 1 : 0 }, uPointsC: { value: new THREE.Color(0x14100e) }, uHoofC: { value: new THREE.Color(0x2c2722) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aMarks;\nvarying float vPts, vHoof, vBlz, vMuz;\nvarying vec3 vHP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPts = aMarks.x; vHoof = aMarks.y; vBlz = aMarks.z; vMuz = aMarks.w; vHP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vPts, vHoof, vBlz, vMuz; varying vec3 vHP; uniform float uBlaze; uniform vec3 uPointsC, uHoofC;
      float hh(vec3 p){ return fract(sin(dot(p, vec3(12.99, 78.23, 45.16))) * 43758.55); }
      float hn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hh(i), hh(i+vec3(1,0,0)), f.x), mix(hh(i+vec3(0,1,0)), hh(i+vec3(1,1,0)), f.x), f.y), mix(mix(hh(i+vec3(0,0,1)), hh(i+vec3(1,0,1)), f.x), mix(hh(i+vec3(0,1,1)), hh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // short hair lying back along the body: fine streaks; faint dapples over the quarters and barrel
        float streak = hn(vec3(vHP.x * 260.0, vHP.y * 260.0, vHP.z * 35.0)) * 0.6 + hn(vHP * 110.0) * 0.4;
        float dap = smoothstep(0.55, 0.78, hn(vHP * 9.0)) * smoothstep(0.95, 1.3, vHP.y) * 0.12;
        vec3 coat = diffuseColor.rgb * (0.86 + 0.2 * streak + dap);
        coat = mix(coat, coat * 0.45, vMuz);
        coat = mix(coat, uPointsC * (0.85 + 0.25 * streak), vPts);
        coat = mix(coat, vec3(0.86, 0.83, 0.78) * (0.9 + 0.1 * streak), vBlz * uBlaze);
        float horn = hn(vec3(vHP.x * 90.0, vHP.y * 5.0, vHP.z * 90.0));
        coat = mix(coat, uHoofC * (0.75 + 0.45 * horn), vHoof);
        diffuseColor.rgb = coat;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, vHoof) + vMuz * 0.12;');
  };
  m.customProgramCacheKey = () => 'horseCoat-v2';
  return m;
}
function hairMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x100c0a, roughness: 0.5, side: THREE.DoubleSide });
  const U = { uTime: { value: 0 }, uFlow: { value: 0 } }; m.userData.u = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uFlow;\nvarying float vStr;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float tt = uv.y * uv.y; float ph = position.x * 31.0 + position.z * 17.0 + position.y * 11.0; vStr = fract(ph * 0.37);
        transformed.x += sin(uTime * 2.3 + ph) * 0.012 * tt + sin(uTime * 7.0 + ph * 1.7) * 0.012 * tt * uFlow;
        transformed.z -= tt * 0.12 * uFlow; transformed.y += tt * 0.05 * uFlow;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vStr;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.65 + 0.7 * vStr;');
  };
  m.customProgramCacheKey = () => 'horseHair';
  return m;
}
const TACK = {};
function tackMat(k) {
  if (!TACK[k]) TACK[k] = k === 'brass' ? new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 0.85, roughness: 0.35 })
    : k === 'steel' ? new THREE.MeshStandardMaterial({ color: 0xa8a8a8, metalness: 0.9, roughness: 0.3 })
    : k === 'collar' ? new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.55 })
    : new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.6 });
  return TACK[k];
}

// ---------------------------------------------------------------- one horse
export function makeHorse(seed = 1, coat = 0x4a2a18) {
  const B = build(); const r = rng(seed);
  const root = new THREE.Group();
  const bones = {}, list = [];
  for (const [n, p, h] of BONES) { const b = new THREE.Bone(); b.name = n; const ph = p ? HEAD_OF[p] : [0, 0, 0]; b.position.set(h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]); b.rotation.order = 'YXZ'; bones[n] = b; list.push(b); if (p) bones[p].add(b); }
  const rest = {}; for (const n in bones) rest[n] = bones[n].position.clone();
  const body = new THREE.SkinnedMesh(B.geo, coatMaterial(coat, seed % 2 === 1)); body.add(bones.root); body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;
  root.add(body); body.updateMatrixWorld(true);
  const skel = new THREE.Skeleton(list); body.bind(skel);
  const hairM = hairMaterial(); const hair = new THREE.SkinnedMesh(B.hair, hairM); hair.castShadow = true; hair.frustumCulled = false; body.add(hair); hair.updateMatrixWorld(true); hair.bind(skel, body.matrixWorld);
  for (const [g, mk, bn] of B.tack) { const m = new THREE.Mesh(g, tackMat(mk)); m.castShadow = true; const h = HEAD_OF[bn]; m.position.set(-h[0], -h[1], -h[2]); bones[bn].add(m); }
  // eyes, with lids that blink
  const eyeM = new THREE.MeshPhysicalMaterial({ color: 0x140b06, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  const lidM = coatMaterial(coat, false); const lids = [];
  for (const s of [-1, 1]) {
    const e = H(0.17, 0.058, s * 0.1);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 18, 12).scale(1, 0.85, 1.1), eyeM); eye.position.set(e[0] - POLL[0], e[1] - POLL[1], e[2] - POLL[2]); bones.head.add(eye);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0268, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.85, 1.12), lidM); lid.position.copy(eye.position); lid.rotation.order = 'YXZ'; bones.head.add(lid); lids.push(lid);
  }
  // reins: from the bit rings through the terrets back to the driver's hands, recomputed every frame
  const reinGeo = new THREE.BufferGeometry(); const reinPos = new Float32Array(2 * 14 * 4 * 3); reinGeo.setAttribute('position', new THREE.BufferAttribute(reinPos, 3));
  const ri = []; for (let s = 0; s < 2; s++) for (let k = 0; k < 13; k++) for (let c = 0; c < 2; c++) { const a = (s * 14 + k) * 4 + c * 2, b = a + 4; ri.push(a, b, a + 1, a + 1, b, b + 1); } reinGeo.setIndex(ri);
  const reins = new THREE.Mesh(reinGeo, new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.6, side: THREE.DoubleSide })); reins.frustumCulled = false; root.add(reins);
  const bits = [v3(...H(0.55, -0.075, 0.075)), v3(...H(0.55, -0.075, -0.075))], ters = [v3(0.25, 1.78, 0.9), v3(-0.25, 1.78, 0.9)];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();

  const st = { t: r() * 10, ph: r(), toss: 0, earT: 0, ears: [0, 0], blink: 2 + r() * 3, rest: r() < 0.5 ? 'L' : 'R', restT: 3 + r() * 5, gait: 0 };
  const R = (n, x, y = 0, z = 0) => bones[n].rotation.set(x, y, z);
  const ease = (n, x, k) => { bones[n].rotation.x += (x - bones[n].rotation.x) * k; };
  const update = (dt, speed = 0) => {
    st.t += dt; const t = st.t;
    // gait: 0 stand, 1 walk, 2 trot, 3 gallop
    const want = speed < 0.25 ? 0 : speed < 2.2 ? 1 : speed < 4.6 ? 2 : 3; st.gait += (want - st.gait) * Math.min(1, dt * 3);
    const g = st.gait, walk = mx(0, 1 - ab(g - 1)), trot = mx(0, 1 - ab(g - 2)), gal = mx(0, mn(1, g - 2)), stand = mx(0, 1 - g);
    st.ph = (st.ph + dt * (walk * 0.95 + trot * 1.45 + gal * 2.05)) % 1; const ph = st.ph;
    // the moment each hoof leaves the ground: walk LH LF RH RF; trot in diagonal pairs; gallop LH RH LF RF (right lead)
    const lift = { HL: 0, FL: walk * 0.25 + trot * 0.5 + gal * 0.32, HR: walk * 0.5 + trot * 0.5 + gal * 0.12, FR: walk * 0.75 + gal * 0.42 };
    const stance = walk * 0.62 + trot * 0.46 + gal * 0.38;
    const amp = walk * 0.38 + trot * 0.5 + gal * 0.72;
    const bob = Math.sin(ph * Math.PI * 4) * 0.025 * walk + ab(Math.sin(ph * Math.PI * 2)) * 0.06 * trot + Math.sin(ph * Math.PI * 2 + 1) * 0.09 * gal;
    bones.body.position.set(rest.body.x, rest.body.y + bob - 0.02 * gal, rest.body.z);
    bones.body.rotation.set(Math.sin(ph * Math.PI * 2 + 0.6) * 0.075 * gal + Math.sin(ph * Math.PI * 4) * 0.012 * walk, 0, Math.sin(ph * Math.PI * 2) * 0.02 * walk);
    const br = Math.sin(t * (1.15 + gal * 2.5)); bones.spine.scale.set(1 + br * 0.012, 1 + br * 0.008, 1);   // breathing
    if (amp > 0.01) for (const [leg, side] of [['FL', 'L'], ['FR', 'R'], ['HL', 'L'], ['HR', 'R']]) {
      const u = ((ph - lift[leg]) % 1 + 1) % 1, swingF = 1 - stance; let sw, up;
      if (u < swingF) { const v = u / swingF; sw = -Math.cos(v * Math.PI); up = Math.sin(v * Math.PI); }   // forward through the air, folded
      else { const v = (u - swingF) / (1 - swingF); sw = Math.cos(v * Math.PI); up = 0; }               // planted while the body passes over
      const A = amp;
      if (leg[0] === 'F') {
        R('scap' + side, sw * 0.12 * A); R('humerus' + side, -sw * 0.3 * A - up * 0.25 * A);
        R('radius' + side, -sw * 0.25 * A + up * 0.2 * A); R('cannonF' + side, up * 1.7 * A); R('pasternF' + side, up * 0.7 * A - (up ? 0 : sw * 0.15 * A));
      } else {
        R('femur' + side, -sw * 0.32 * A - up * 0.2 * A); R('tibia' + side, sw * 0.05 * A + up * 0.55 * A);
        R('cannonH' + side, -up * 0.9 * A + sw * 0.08 * A); R('pasternH' + side, up * 0.8 * A);
      }
    }
    // standing: shifts its weight and rests a hind hoof on its toe
    if (stand > 0.5) {
      st.restT -= dt; if (st.restT < 0) { st.restT = 6 + r() * 10; st.rest = st.rest === 'L' ? (r() < 0.4 ? '' : 'R') : 'L'; }
      const k = Math.min(1, dt * 2);
      for (const s of ['L', 'R']) { const on = st.rest === s ? 1 : 0; ease('femur' + s, on * 0.05, k); ease('tibia' + s, on * 0.24, k); ease('cannonH' + s, -on * 0.36, k); ease('pasternH' + s, on * 0.55, k); }
      for (const s of ['L', 'R']) for (const n of ['scap', 'humerus', 'radius', 'cannonF', 'pasternF']) ease(n + s, 0, k);
      bones.pelvis.rotation.z += ((st.rest === 'L' ? 1 : st.rest === 'R' ? -1 : 0) * 0.035 - bones.pelvis.rotation.z) * k;
    } else bones.pelvis.rotation.z *= 0.9;
    // neck and head: pump with the stride; standing, a toss of the head now and then, a slow look round
    st.toss = mx(0, st.toss - dt); if (stand > 0.5 && r() < dt * 0.06) st.toss = 1.4;
    const toss = st.toss > 0 ? Math.sin((1 - st.toss / 1.4) * Math.PI) : 0;
    const pump = Math.sin(ph * Math.PI * 4 + 0.8) * 0.06 * walk + Math.sin(ph * Math.PI * 2 + 1.4) * 0.12 * gal;
    const look = Math.sin(t * 0.21 + seed) * 0.25 * stand;
    R('neck1', 0.05 + pump * 0.6 - toss * 0.2 + gal * 0.18, look * 0.4); R('neck2', pump * 0.4 - toss * 0.25 - trot * 0.08, look * 0.3, Math.sin(t * 0.5) * 0.02 * stand);
    R('neck3', pump * 0.3 + toss * 0.15, look * 0.3); R('head', 0.05 + pump * 0.5 + toss * 0.45 - trot * 0.1 + gal * 0.1, 0, Math.sin(t * 0.7) * 0.03 * stand + toss * 0.12);
    // ears flick round at sounds, and lie back at the gallop
    st.earT -= dt; if (st.earT < 0) { st.earT = 0.8 + r() * 3.5; st.ears = [(r() - 0.5) * 1.2, (r() - 0.5) * 1.2]; }
    R('earL', 0.35 * gal, -st.ears[0] * (1 - gal) - 0.6 * gal); R('earR', 0.35 * gal, st.ears[1] * (1 - gal) + 0.6 * gal);
    // the tail swishes at flies; at speed it is carried and streams
    const sw2 = Math.sin(t * 1.7) * 0.25 * stand + Math.sin(t * 9) * 0.04 * gal;
    R('tail1', -0.1 - gal * 0.5 - trot * 0.2, sw2 * 0.5); R('tail2', -0.05 - gal * 0.35, sw2); R('tail3', -gal * 0.2, sw2 * 1.2); R('tail4', 0, sw2 * 1.3);
    hairM.userData.u.uTime.value = t; hairM.userData.u.uFlow.value = gal + trot * 0.4;
    // blinking
    st.blink -= dt; if (st.blink < -0.14) st.blink = 2 + r() * 5;
    const shut = st.blink < 0 ? Math.sin((-st.blink / 0.14) * Math.PI) : 0;
    for (const l of lids) l.rotation.x = lerp(-1.8, 0.1, shut);
    // reins
    root.updateMatrixWorld(true); _m.copy(root.matrixWorld).invert();
    const drv = v3(-root.position.x * 0.85, 1.66, -2.05);
    bones.head.updateWorldMatrix(true, false); bones.neck1.updateWorldMatrix(true, false);
    for (let s = 0; s < 2; s++) {
      _a.copy(bits[s]).sub(_p.set(...POLL)).applyMatrix4(bones.head.matrixWorld).applyMatrix4(_m);
      _b.copy(ters[s]).sub(_p.set(...HEAD_OF.neck1)).applyMatrix4(bones.neck1.matrixWorld).applyMatrix4(_m);
      const c = new THREE.CatmullRomCurve3([_a.clone(), _a.clone().lerp(_b, 0.5).add(v3(0, -0.05, 0)), _b.clone(), _b.clone().lerp(drv, 0.5).add(v3(0, -0.2 + gal * 0.14, 0)), drv.clone().add(v3(s ? -0.06 : 0.06, 0, 0))]);
      for (let k = 0; k < 14; k++) { const p = c.getPoint(k / 13); const o = (s * 14 + k) * 12; reinPos.set([p.x - 0.01, p.y, p.z, p.x + 0.01, p.y, p.z, p.x, p.y - 0.006, p.z, p.x, p.y + 0.006, p.z], o); }
    }
    reinGeo.attributes.position.needsUpdate = true; reinGeo.computeVertexNormals();
  };
  update(0.016, 0);
  return { root, update, bones, stats: { buildMs: B.ms, tris: B.tris, packed: B.packed } };
}
