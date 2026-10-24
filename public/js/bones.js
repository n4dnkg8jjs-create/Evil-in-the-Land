// Human bones for the Emperor's field. The skull, jaw, pelvis, vertebrae and long bones are modelled as signed
// distance fields (cranium, brow ridge, deep orbits, the nasal opening, cheekbones and their arches, the upper jaw
// and its teeth; the jaw as its own bone; the hip bones with their sockets; femur, humerus and tibia with their
// heads, condyles and shafts) and turned into meshes once with surface nets. Ribs are curved tubes hung off a
// column of vertebrae. Every vertex carries a weathered-bone colour: dirty ivory, darkened in the hollows
// (sampled from the field itself) and stained by the earth.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, makeNoise } from './util.js';

// ---------------------------------------------------------------- distance-field kit
const sq = Math.sqrt, mx = Math.max, mn = Math.min, ab = Math.abs;
function ell(x, y, z, rx, ry, rz) { const k0 = sq((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2), k1 = sq((x / (rx * rx)) ** 2 + (y / (ry * ry)) ** 2 + (z / (rz * rz)) ** 2); return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -mn(rx, ry, rz); }
function cap(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const h = mx(0, mn(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  const qx = px - dx * h, qy = py - dy * h, qz = pz - dz * h; return sq(qx * qx + qy * qy + qz * qz) - r;
}
function rbox(x, y, z, bx, by, bz, r) { const qx = ab(x) - bx + r, qy = ab(y) - by + r, qz = ab(z) - bz + r; return sq(mx(qx, 0) ** 2 + mx(qy, 0) ** 2 + mx(qz, 0) ** 2) + mn(mx(qx, mx(qy, qz)), 0) - r; }
function smin(a, b, k) { const h = mx(k - ab(a - b), 0) / k; return mn(a, b) - h * h * k * 0.25; }
const smax = (a, b, k) => -smin(-a, -b, k);

// Surface nets over a box: one vertex per cell the surface passes through, a quad per crossing edge.
// Returns an indexed geometry with gradient normals and a bone colour with cavities darkened.
function mesh(sdf, [x0, y0, z0], [x1, y1, z1], h, seed = 1, stain = 1) {
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const V = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[i + nx * (j + ny * k)] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);
  const cid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const co = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const c = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let q = 0; q < 8; q++) { c[q] = V[(i + co[q][0]) + nx * ((j + co[q][1]) + ny * (k + co[q][2]))]; if (c[q] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((c[a] < 0) === (c[b] < 0)) continue;
      const t = c[a] / (c[a] - c[b]);
      sx += co[a][0] + (co[b][0] - co[a][0]) * t; sy += co[a][1] + (co[b][1] - co[a][1]) * t; sz += co[a][2] + (co[b][2] - co[a][2]) * t; n++;
    }
    cid[i + (nx - 1) * (j + (ny - 1) * k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  const C = (i, j, k) => cid[i + (nx - 1) * (j + (ny - 1) * k)];
  const idx = [];
  const quad = (a, b, c2, d, flip) => { if (a < 0 || b < 0 || c2 < 0 || d < 0) return; if (flip) idx.push(a, c2, b, a, d, c2); else idx.push(a, b, c2, a, c2, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = V[i + nx * (j + ny * k)] < 0;
    if (i < nx - 1 && (V[i + 1 + nx * (j + ny * k)] < 0) !== v0) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), v0);
    if (j < ny - 1 && (V[i + nx * (j + 1 + ny * k)] < 0) !== v0) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), v0);
    if (k < nz - 1 && (V[i + nx * (j + ny * (k + 1))] < 0) !== v0) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), v0);
  }
  // pull every vertex onto the surface, take normals from the field's gradient, and colour it
  const nrm = new Float32Array(pos.length), col = new Float32Array(pos.length), e = h * 0.5;
  const noise = makeNoise(seed);
  for (let v = 0; v < pos.length; v += 3) {
    let x = pos[v], y = pos[v + 1], z = pos[v + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z); let gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = sq(gx * gx + gy * gy + gz * gz) || 1; gx /= gl; gy /= gl; gz /= gl;
      x -= gx * d; y -= gy * d; z -= gz * d;
      if (it === 1) { nrm[v] = gx; nrm[v + 1] = gy; nrm[v + 2] = gz; }
    }
    pos[v] = x; pos[v + 1] = y; pos[v + 2] = z;
    // cavities: how hemmed in the point is, looking out along its normal
    let ao = 1; for (const s of [0.004, 0.009, 0.016]) ao *= Math.min(1, Math.max(0, sdf(x + nrm[v] * s, y + nrm[v + 1] * s, z + nrm[v + 2] * s) / s) * 0.55 + 0.45);
    paint(col, v, x, y, z, ao, noise, stain);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  // make the winding agree with the normals
  const P = g.attributes.position, I = g.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], cc = I[t + 2];
    const ux = P.getX(b) - P.getX(a), uy = P.getY(b) - P.getY(a), uz = P.getZ(b) - P.getZ(a), wx = P.getX(cc) - P.getX(a), wy = P.getY(cc) - P.getY(a), wz = P.getZ(cc) - P.getZ(a);
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * (nrm[a * 3] + nrm[b * 3] + nrm[cc * 3]) + fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[cc * 3 + 1]) + fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[cc * 3 + 2]) < 0) { I[t + 1] = cc; I[t + 2] = b; }
  }
  g.computeBoundingSphere();
  return g;
}
// weathered bone: ivory going grey-brown, blotched with lichen and earth, dark in every hollow
function paint(col, v, x, y, z, ao, noise, stain) {
  const n1 = noise.fbm(x * 38 + 3, y * 38 + z * 31, 3), n2 = noise.fbm(x * 140, y * 140 + z * 120, 2);
  let r = 0.6, g = 0.53, b = 0.4;                                   // linear: dirty ivory
  const grey = Math.max(0, n1) * 0.5; r -= grey * 0.18; g -= grey * 0.15; b -= grey * 0.1;
  const dirt = Math.max(0, n2 - 0.15) * 1.2 * stain; r *= 1 - dirt * 0.35; g *= 1 - dirt * 0.42; b *= 1 - dirt * 0.55;
  const k = 0.18 + 0.82 * ao * ao; col[v] = r * k; col[v + 1] = g * k * 0.97; col[v + 2] = b * k * 0.92;
}
function solid(g, seed = 1) {   // a plain geometry (tube, box) in bone colour
  g = g.index ? g : g; const P = g.attributes.position; const col = new Float32Array(P.count * 3); const noise = makeNoise(seed);
  for (let i = 0; i < P.count; i++) paint(col, i * 3, P.getX(i), P.getY(i), P.getZ(i), 0.92, noise, 1);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const keep = (g) => { for (const n in g.attributes) if (!['position', 'normal', 'color'].includes(n)) g.deleteAttribute(n); return g.index ? g.toNonIndexed() : g; };
const mergeAll = (list) => mergeGeometries(list.map(keep));

// ---------------------------------------------------------------- the skull (origin at the cranial base, +z = face)
function skullSDF(v) {
  const missing = v ? [2, 9, 13] : [5, 11];
  const teeth = [];
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
    if (missing.includes(i + (s > 0 ? 8 : 0))) continue;
    const t = i / 7, x = s * (0.005 + 0.025 * t ** 0.75), z = 0.077 - 0.05 * t ** 1.5, r = 0.0042 + t * 0.0016;
    teeth.push([x, z, r, -0.052 + t * 0.002]);
  }
  return (x, y, z) => {
    const X = ab(x);
    let d = ell(x, y - 0.045, z + 0.015, 0.071, 0.074, 0.095);                           // the vault of the skull
    d = smax(d, -(y + 0.016), 0.012);                                                  // its base
    d = smin(d, ell(x, y - 0.018, z + 0.094, 0.044, 0.03, 0.018), 0.02);               // the occipital bulge
    d = smin(d, ell(X - 0.047, y + 0.02, z + 0.012, 0.007, 0.012, 0.008), 0.01);        // mastoids
    d = smin(d, rbox(x, y + 0.012, z - 0.058, 0.031, 0.026, 0.024, 0.012), 0.02);      // the upper jaw
    d = smin(d, ell(X - 0.043, y - 0.002, z - 0.052, 0.013, 0.013, 0.015), 0.02);       // cheekbones
    d = smin(d, cap(X, y, z, 0.05, 0.001, 0.04, 0.062, 0.003, -0.012, 0.0055), 0.008); // and their arches
    d = smin(d, cap(x, y, z, -0.04, 0.034, 0.068, 0.04, 0.034, 0.068, 0.0075), 0.022);  // the brow ridge
    d = smin(d, ell(x, y + 0.036, z - 0.054, 0.028, 0.011, 0.028), 0.01);              // the ridge of the teeth
    d = smax(d, -ell(X - 0.069, y - 0.004, z - 0.012, 0.011, 0.024, 0.03), 0.006);     // the temple hollows behind the arches
    d = smax(d, -ell(X - 0.021, y - 0.012, z - 0.072, 0.0165, 0.015, 0.031), 0.004);  // the eye sockets, deep
    d = smax(d, -smin(ell(x, y + 0.012, z - 0.088, 0.0105, 0.016, 0.03), ell(x, y - 0.004, z - 0.085, 0.004, 0.008, 0.02), 0.006), 0.003);   // the nasal opening
    d = smax(d, -ell(x, y + 0.03, z - 0.035, 0.018, 0.01, 0.03), 0.004);               // the palate, from below
    if (ab(y + 0.047) > 0.016 || z < 0.0 || X > 0.04) return d;   // the teeth are only near the mouth
    let t = 1e9; for (const [tx, tz, r, ty] of teeth) t = mn(t, cap(x, y, z, tx, -0.04, tz, tx, ty, tz, r));
    return smin(d, t, 0.0018);
  };
}
function mandibleSDF() {
  const pts = (s) => [[0, -0.064, 0.073], [s * 0.022, -0.065, 0.064], [s * 0.037, -0.064, 0.043], [s * 0.045, -0.063, 0.014], [s * 0.048, -0.062, -0.006]];
  const teeth = []; for (const s of [-1, 1]) for (let i = 0; i < 8; i++) { const t = i / 7; teeth.push([s * (0.004 + 0.022 * t ** 0.75), 0.073 - 0.05 * t ** 1.5, 0.0038 + t * 0.0014]); }
  return (x, y, z) => {
    let d = 1e9;
    for (const s of [-1, 1]) {
      const P = pts(s);
      for (let i = 0; i < P.length - 1; i++) { const [a, b] = [P[i], P[i + 1]]; d = smin(d, smin(cap(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], 0.0062), cap(x, y, z, a[0], a[1] + 0.009, a[2] - 0.002, b[0], b[1] + 0.009, b[2] - 0.002, 0.0055), 0.008), 0.004); }
      d = smin(d, cap(x, y, z, s * 0.048, -0.06, -0.008, s * 0.052, -0.022, -0.006, 0.0062), 0.006);   // the ramus
      d = smin(d, cap(x, y, z, s * 0.047, -0.05, 0.0, s * 0.045, -0.026, 0.014, 0.004), 0.005);          // coronoid
      d = smin(d, ell(x - s * 0.053, y + 0.02, z + 0.006, 0.009, 0.005, 0.006), 0.004);                 // condyle
    }
    d = smin(d, ell(x, y + 0.071, z - 0.075, 0.012, 0.009, 0.006), 0.006);   // chin
    if (ab(y + 0.049) > 0.014 || z < 0.0) return d;
    let t = 1e9; for (const [tx, tz, r] of teeth) t = mn(t, cap(x, y, z, tx, -0.054, tz, tx, -0.044, tz, r));
    return smin(d, t, 0.0015);
  };
}
// the pelvis: origin between the hip sockets, +y up, +z forward
function pelvisSDF() {
  const rotY = (x, z, a) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
  return (x, y, z) => {
    const taper = 0.55 + 0.45 * Math.min(1, Math.max(0, (y + 0.03) / 0.12));
    let d = ell(x / taper, y - 0.035, z + 0.05 - (y - 0.035) * 0.25, 0.046, 0.065, 0.017) * Math.min(1, taper + 0.2);   // sacrum, tapering down to the tail
    for (const s of [-1, 1]) {
      const [bx, bz] = rotY(x - s * 0.088, z + 0.004, s * 0.38);
      let blade = ell(bx, y - 0.066, bz, 0.07, 0.056, 0.0095);                            // the iliac blade
      blade = smin(blade, ell(bx, y - 0.118, bz, 0.066, 0.009, 0.013), 0.012);             // its thickened crest
      blade = smax(blade, -ell(bx, y - 0.075, bz - 0.03, 0.05, 0.05, 0.025), 0.004);      // dished on its inner face
      d = smin(d, blade, 0.02);
      d = smin(d, cap(x, y, z, s * 0.035, 0.06, -0.048, s * 0.058, 0.07, -0.03, 0.014), 0.015);   // the joint with the sacrum
      d = smin(d, cap(x, y, z, s * 0.075, 0.03, 0.0, s * 0.09, -0.015, 0.015, 0.016), 0.015);    // down to the socket
      d = smin(d, ell(x - s * 0.09, y + 0.02, z - 0.015, 0.03, 0.032, 0.03), 0.015);     // the socket's mass
      d = smin(d, cap(x, y, z, s * 0.075, -0.035, 0.03, s * 0.012, -0.06, 0.07, 0.01), 0.008);    // pubis
      d = smin(d, cap(x, y, z, s * 0.08, -0.045, 0.0, s * 0.058, -0.1, -0.012, 0.012), 0.01);     // ischium
      d = smin(d, cap(x, y, z, s * 0.058, -0.1, -0.012, s * 0.016, -0.075, 0.06, 0.0065), 0.006); // its ramus, leaving the foramen open
      d = smax(d, -ell(x - s * 0.108, y + 0.022, z - 0.022, 0.022, 0.024, 0.022), 0.003); // the hip socket
    }
    return d;
  };
}
function femurSDF() {   // along +y, knee at 0, hip at 0.45; head to -x (medial)
  return (x, y, z) => {
    let d = cap(x, y, z, 0, 0.05, 0, 0.002, 0.25, 0.006, 0.0125); d = smin(d, cap(x, y, z, 0.002, 0.25, 0.006, 0, 0.405, 0, 0.0135), 0.004);
    d = smin(d, ell(x, y - 0.035, z, 0.034, 0.03, 0.022), 0.02);                          // flaring to the knee
    for (const s of [-1, 1]) d = smin(d, ell(x - s * 0.019, y - 0.018, z + 0.006, 0.015, 0.02, 0.024), 0.006);   // condyles
    d = smax(d, -ell(x, y - 0.008, z + 0.012, 0.007, 0.02, 0.016), 0.003);                // the notch between them
    d = smin(d, cap(x, y, z, 0, 0.405, 0, -0.038, 0.432, 0, 0.012), 0.008);               // neck
    d = smin(d, ell(x + 0.045, y - 0.437, z, 0.023, 0.023, 0.023), 0.006);                // head
    d = smin(d, ell(x - 0.012, y - 0.418, z + 0.004, 0.016, 0.024, 0.017), 0.008);         // greater trochanter
    return d;
  };
}
function humerusSDF() {
  return (x, y, z) => {
    let d = cap(x, y, z, 0, 0.035, 0.002, 0, 0.28, 0, 0.0105);
    d = smin(d, ell(x + 0.008, y - 0.3, z + 0.008, 0.022, 0.022, 0.022), 0.012);          // head
    d = smin(d, ell(x - 0.012, y - 0.29, z - 0.01, 0.01, 0.014, 0.01), 0.008);             // tubercle
    d = smin(d, cap(x, y, z, -0.021, 0.014, 0.004, 0.021, 0.014, 0.004, 0.011), 0.01);     // trochlea
    for (const s of [-1, 1]) d = smin(d, ell(x - s * 0.031, y - 0.022, z, 0.008, 0.01, 0.008), 0.006);
    return d;
  };
}
function tibiaSDF() {
  return (x, y, z) => {
    let d = cap(x, y, z, 0, 0.03, 0, 0, 0.335, 0.002, 0.012);
    d = smin(d, ell(x, y - 0.352, z, 0.037, 0.014, 0.03), 0.018);                          // plateau
    d = smin(d, ell(x, y - 0.32, z - 0.022, 0.01, 0.018, 0.008), 0.008);                   // tuberosity
    d = smin(d, cap(x, y, z, 0, 0.3, 0.014, 0, 0.12, 0.012, 0.005), 0.006);                // the shin's crest
    d = smin(d, ell(x, y - 0.022, z, 0.022, 0.02, 0.02), 0.012);
    d = smin(d, cap(x, y, z, -0.02, 0.024, 0, -0.022, -0.004, 0.002, 0.0065), 0.006);      // malleolus
    return d;
  };
}
function vertebraSDF() {   // +y up the spine, +z forward (the body), the spine of it pointing back and down
  return (x, y, z) => {
    let d = ell(x, y, z - 0.004, 0.016, 0.0105, 0.014);
    for (const s of [-1, 1]) d = smin(d, cap(x, y, z, s * 0.008, 0.002, -0.008, s * 0.009, 0.002, -0.026, 0.0038), 0.004);
    d = smin(d, cap(x, y, z, -0.009, 0.002, -0.026, 0.009, 0.002, -0.026, 0.0038), 0.004);
    d = smin(d, cap(x, y, z, 0, 0.002, -0.027, 0, -0.012, -0.053, 0.0042), 0.004);
    d = smin(d, cap(x, y, z, -0.03, 0.006, -0.03, 0.03, 0.006, -0.03, 0.004), 0.005);
    d = smax(d, -ell(x, y, z + 0.016, 0.008, 0.02, 0.007), 0.002);                         // the canal
    return d;
  };
}

// ---------------------------------------------------------------- ribs, the cage, small bones
function ribGeo(i, s, cut = 1, lo = false) {   // the i-th rib (0 = top) on side s, in torso coords (+y up, +z forward); spine at origin
  const y = -i * 0.023, w = i < 7 ? 0.065 + i * 0.011 : 0.142 - (i - 7) * 0.012, reach = i < 7 ? 1 : i < 10 ? 0.75 : 0.45;
  const P = [[s * 0.012, y, -0.012], [s * 0.05, y - 0.004, -0.04], [s * w * 0.95, y - 0.02, -0.012], [s * w, y - 0.045, 0.04], [s * w * 0.72, y - 0.075, 0.095], [s * 0.035, y - 0.092, 0.118]]
    .slice(0, Math.max(3, Math.round(6 * reach * cut))).map((p) => new THREE.Vector3(...p));
  const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P), lo ? 6 : 12, 0.0045, lo ? 3 : 4, false);
  tg.scale(1, 1.25, 1); return solid(tg, 50 + i);
}
// Two levels of detail: 'hi' for bones close by, 'lo' (the same fields, meshed far coarser) for the rest of the field.
// Keys: skull0 skull1 mandible pelvis femur humerus tibia vertebra rib cage0 cage1 small.
const CACHE = {};
export function boneLibrary(level = 'hi') {
  if (CACHE[level]) return CACHE[level];
  const lo = level === 'lo', k = lo ? 2.1 : 1, L = {};
  for (const v of [0, 1]) L['skull' + v] = mesh(skullSDF(v), [-0.084, -0.068, -0.122], [0.084, 0.125, 0.112], 0.0068 * k, 11 + v);
  L.mandible = mesh(mandibleSDF(), [-0.066, -0.084, -0.022], [0.066, -0.012, 0.09], 0.005 * k, 13);
  L.pelvis = mesh(pelvisSDF(), [-0.175, -0.125, -0.085], [0.175, 0.14, 0.11], 0.009 * k, 17, 1.3);
  L.femur = mesh(femurSDF(), [-0.075, -0.008, -0.035], [0.04, 0.468, 0.035], 0.007 * k, 19);
  L.humerus = mesh(humerusSDF(), [-0.045, -0.006, -0.035], [0.045, 0.33, 0.035], 0.0068 * k, 23);
  L.tibia = mesh(tibiaSDF(), [-0.045, -0.014, -0.036], [0.045, 0.372, 0.036], 0.007 * k, 29);
  L.vertebra = mesh(vertebraSDF(), [-0.038, -0.022, -0.064], [0.038, 0.02, 0.022], 0.0045 * k, 31);
  const vCage = lo ? null : mesh(vertebraSDF(), [-0.038, -0.022, -0.064], [0.038, 0.02, 0.022], 0.0072, 32);
  L.rib = ribGeo(5, 1, 1, lo);
  // a ribcage: the thoracic column with its twelve pairs, some broken short, a few gone, the sternum fallen in
  for (const v of [0, 1]) {
    const r = rng(90 + v), parts = [];
    for (let i = 0; i < 12; i++) {
      if (vCage) { const vg = vCage.clone(); vg.translate(0, -i * 0.023, 0); parts.push(vg); }
      else { const vg = solid(new THREE.BoxGeometry(0.03, 0.018, 0.05), 32); vg.translate(0, -i * 0.023, -0.015); parts.push(vg); }
      for (const s of [-1, 1]) { const q = r(); if (q < 0.12) continue; parts.push(ribGeo(i, s, q < 0.35 ? 0.55 + r() * 0.3 : 1, lo)); }
    }
    const st = solid(new THREE.BoxGeometry(0.03, 0.14, 0.008, 2, lo ? 1 : 6, 1), 77); st.rotateX(0.25); st.translate(0.01, -0.11, 0.1); parts.push(st);
    L['cage' + v] = mergeAll(parts);
  }
  // a hand or foot's worth of small bones, scattered flat
  { const r = rng(5), parts = []; for (let i = 0; i < 12; i++) { const len = 0.018 + r() * 0.035; const g = solid(new THREE.CapsuleGeometry(0.0045 + r() * 0.002, len, lo ? 1 : 3, lo ? 4 : 6), 60 + i); g.rotateZ(Math.PI / 2); g.rotateY(r() * Math.PI); g.translate((r() - 0.5) * 0.14, 0.005, (r() - 0.5) * 0.14); parts.push(g); } L.small = mergeAll(parts); }
  // vertex samples for resting each bone on the ground
  for (const key in L) { const g = L[key]; const P = g.attributes.position; const step = Math.max(1, Math.floor(P.count / 500)); const pts = []; for (let i = 0; i < P.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(P, i)); g.userData.pts = pts; }
  CACHE[level] = L; return L;
}
// how far below a bone's origin its lowest point lies, once turned by q
export function restDepth(g, q) { let m = 1e9; const v = new THREE.Vector3(); for (const p of g.userData.pts) { v.copy(p).applyQuaternion(q); if (v.y < m) m = v.y; } return -m; }
let MAT = null;
export function boneMaterial() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  return MAT;
}
