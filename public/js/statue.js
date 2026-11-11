// Our Lady of the Fen: a late-Gothic stone Madonna in a drowned wayside shrine.
//
// The figure is cut like the "Schöne Madonnen" of c. 1400-1500: weight on one leg, the hip swung out, the head
// inclined. Her head and praying hands are MakeHuman's young woman (CC0, models/lady.json), worn a little by the
// rain; the eyes are carved (lids, an incised iris, a drilled pupil) and something dark has run from them. The body
// is one carved mass: big forms from a smooth union of round cones, read along rays from the figure's axis, and the
// drapery cut into it as a relief painted in (angle, height): the mantle drawn across her front in bowl folds and
// tucked under her left arm, cascades of pipe folds hanging from both arms, the gown's long folds breaking on the
// base. A veil with real thickness hangs clear of the head and rests on the shoulders, under a low crown of lilies.
//
// The shrine is a small aedicule: two cracked steps, a moulded pedestal cut AVE MARIA (and scratched by Raoul), a
// back wall with a pointed niche, two slender piers carrying a cusped arch in a steep crocketed gable, a stone
// roof, pinnacles (one fallen) and a finial. Candles, a rosary, coins and dead flowers have been left for her.
//
// Everything of stone is one mesh and one material (five draw calls in all).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { humanBody } from './people.js';
import { JOINTS } from './rig.js';
import { rng } from './util.js';

const PI = Math.PI, TAU = PI * 2, D2R = PI / 180;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// a table [[x, v], ...] read at x, eased between its rows
function tab(T, x) {
  if (x <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const a = T[i - 1], b = T[i], t = (x - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * t * t * (3 - 2 * t); }
  return T[T.length - 1][1];
}

// ---------------------------------------------------------------- materials
const NOISE = `
float sh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sh(i), sh(i + vec3(1,0,0)), f.x), mix(sh(i + vec3(0,1,0)), sh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(sh(i + vec3(0,0,1)), sh(i + vec3(1,0,1)), f.x), mix(sh(i + vec3(0,1,1)), sh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float sfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * sn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
// what has run from her eyes: three rivulets from each lower lid, down the cheeks to the jaw (f: metres from the
// point between the eyes, in the face's own frame)
float ladyTears(vec2 f, float m){
  if (m < 0.01) return 0.0;
  float t = 0.0;
  for (int s = 0; s < 2; s++) { float sg = s == 0 ? 1.0 : -1.0;
    for (int k = 0; k < 3; k++) { float fk = float(k);
      float x0 = sg * (0.0306 - 0.0085 + fk * 0.0075), dy = -0.0035 - f.y, len = 0.105 - fk * 0.026 + sg * (fk - 1.0) * 0.016;
      float wob = (sn(vec3(f.y * 38.0, fk * 7.0 + sg * 3.0, 1.7)) - 0.5) * 0.0045 + sg * (fk - 1.2) * dy * 0.08;
      float w = 0.0012 + 0.0012 * sn(vec3(f.y * 90.0, fk, sg)), d = abs(f.x - x0 - wob);
      float on = smoothstep(-0.001, 0.003, dy) * (1.0 - smoothstep(len * 0.35, len, dy)) * (0.55 + 0.45 * sn(vec3(f.y * 70.0, fk * 3.0, sg * 5.0)));
      t = max(t, on * (smoothstep(w, w * 0.3, d) * 0.5 + smoothstep(w * 4.5, w, d) * 0.2)); } }
  return t * m;
}`;
// weathered sandstone, all in the mesh's own space so every player sees the same stone: bedded grey-buff, a black
// crust where the rain does not wash, rain streaks, grime in the hollows, green damp creeping up from the water,
// moss on what faces the sky, crusts of lichen, mortar joints in the ashlar, her tears, and the candles' light.
// sdat = [cavity, tear mask, figure (finer stone), ashlar joints]; uv = the face's own coordinates (tears)
let STONE = null;
function stoneMaterial() {
  if (STONE) return STONE;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
  const U = m.userData.U = { uGlow: { value: 1 }, uCandle: { value: [V3(0, -9, 0), V3(0, -9, 0)] } };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 sdat;\nvarying vec4 vDat;\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec2 vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDat = sdat; vLP = position; vLN = normal; vFace = uv;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vDat;\nvarying vec3 vLP;\nvarying vec3 vLN;\nvarying vec2 vFace;\nuniform float uGlow;\nuniform vec3 uCandle[2];\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 ldP = vLP, ldN = normalize(vLN) * (gl_FrontFacing ? 1.0 : -1.0);
        float ldCav = clamp(vDat.x, 0.0, 1.0), ldFig = vDat.z, ldUp = ldN.y;
        float n1 = sfbm(ldP * vec3(2.1, 6.0, 2.1) + 3.0), n2 = sfbm(ldP * 12.0), n3 = sn(ldP * 55.0);
        vec3 c = mix(vec3(0.30, 0.285, 0.25), vec3(0.50, 0.47, 0.40), n1) * (0.8 + 0.34 * n2) * (0.92 + 0.16 * n3) * (0.78 + 0.44 * sfbm(ldP * 1.7 + 40.0));
        c = mix(c, c * vec3(1.1, 1.08, 1.04), ldFig);
        if (vDat.w > 0.5) {   // ashlar: courses and staggered joints
          float cy = ldP.y / 0.29, row = floor(cy), fy = fract(cy), fs = fract((ldP.x + ldP.z) / 0.56 + row * 0.5 + sh(vec3(row, 3.0, 1.0)) * 0.3);
          float jt = max(1.0 - smoothstep(0.0, 0.035, min(fy, 1.0 - fy)), 1.0 - smoothstep(0.0, 0.018, min(fs, 1.0 - fs)));
          c *= 1.0 - 0.6 * jt; ldCav = max(ldCav, jt * 0.5); }
        float ldShel = clamp(0.3 - ldUp * 0.6 + ldCav * 0.9, 0.0, 1.0);
        c = mix(c, c * vec3(0.30, 0.29, 0.28), smoothstep(0.42, 0.7, sfbm(ldP * 3.3 + 5.0) * 0.7 + ldShel * 0.5) * mix(0.8, 0.62, ldFig));
        c *= 1.0 - 0.45 * smoothstep(0.46, 0.76, sfbm(vec3(ldP.x * 21.0, ldP.y * 1.1, ldP.z * 21.0))) * (1.0 - abs(ldUp));
        c *= mix(1.0, 0.3, ldCav);
        float ldDamp = smoothstep(1.2, 0.0, ldP.y);
        float al = sfbm(ldP * 4.6 + 9.0) * 0.75 + ldDamp * 0.5 + ldCav * 0.16 + max(ldUp, 0.0) * 0.12;
        c = mix(c, vec3(0.06, 0.075, 0.04) * (0.7 + 0.6 * n2), smoothstep(0.62, 0.86, al) * 0.85);
        float ms = sfbm(ldP * 7.0 + 21.0) + max(ldUp, 0.0) * 0.5 + ldCav * 0.12 - ldFig * 0.06;
        c = mix(c, mix(vec3(0.06, 0.085, 0.03), vec3(0.12, 0.15, 0.055), n3), smoothstep(1.0, 1.12, ms) * 0.9);
        c = mix(c, vec3(0.46, 0.47, 0.41), smoothstep(0.69, 0.72, sfbm(ldP * 9.0 + 31.0)) * 0.5 * (1.0 - ldCav));
        c = mix(c, vec3(0.42, 0.33, 0.12), smoothstep(0.72, 0.745, sfbm(ldP * 12.0 - 17.0)) * 0.45 * (1.0 - ldCav) * step(-0.2, ldUp));
        c *= mix(0.45, 1.0, smoothstep(0.08, 0.5, ldP.y + 0.14 * n1));
        if (ldFig > 0.5) {   // the carved figure: pitted by the rain, fine runs down it, crusts of lichen on her face too
          c *= 1.0 - 0.22 * smoothstep(0.6, 0.84, sn(ldP * 240.0)) * smoothstep(0.36, 0.58, n2);
          c *= 1.0 - 0.22 * smoothstep(0.5, 0.72, sfbm(vec3(ldP.x * 70.0, ldP.y * 3.0, ldP.z * 70.0))) * (1.0 - abs(ldUp));
          float fl = sfbm(vec3(vFace * 34.0, 4.0) + 2.0);
          c = mix(c, vec3(0.43, 0.44, 0.37) * (0.8 + 0.4 * n3), smoothstep(0.57, 0.62, fl) * 0.5 * vDat.y * smoothstep(0.022, 0.045, abs(vFace.x) + max(0.0, -vFace.y - 0.07) * 0.5));
          c = mix(c, c * vec3(0.5, 0.49, 0.46), smoothstep(0.3, 0.6, sfbm(vec3(vFace * 16.0, 9.0))) * 0.45 * vDat.y * smoothstep(0.02, -0.06, vFace.y)); }
        float ldTear = ladyTears(vFace, vDat.y);
        c = mix(c, vec3(0.035, 0.032, 0.028), ldTear);
        diffuseColor.rgb *= c;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.38, ldTear);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float h = sfbm(vLP * 38.0) * 0.6 + sfbm(vLP * 9.0) * 0.4 + 0.18 * vDat.z * sn(vLP * 120.0);
          vec3 dX = dFdx(-vViewPosition), dY = dFdy(-vViewPosition); float hx = dFdx(h), hy = dFdy(h);
          vec3 r1 = cross(dY, normal), r2 = cross(normal, dX); float det = dot(dX, r1);
          vec3 grad = sign(det) * (hx * r1 + hy * r2); normal = normalize(abs(det) * normal - grad * 0.009 * (1.0 - 0.3 * vDat.z)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float cg = 0.0;
          for (int i = 0; i < 2; i++) { vec3 d = uCandle[i] - vLP; float r2 = dot(d, d); cg += max(dot(ldN, d * inversesqrt(r2)) * 0.8 + 0.2, 0.0) / (1.0 + r2 * 14.0); }
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.5, 0.17) * cg * uGlow * 0.4 * (1.0 - 0.6 * ldCav); }`);
  };
  m.customProgramCacheKey = () => 'ladyStone7';
  return (STONE = m);
}

// the letters: AVE MARIA cut by a mason, and what Raoul scratched under it with a knife point. One transparent
// decal over the pedestal's face (dark in the cuts, a pale lower edge; Raoul's scratches fresh and pale).
const SCRATCH = {
  A: [[[0, 6], [2, 0], [4, 6]], [[1, 3.7], [3, 3.7]]], D: [[[0, 0], [0, 6], [2.6, 6], [4, 4.2], [4, 1.8], [2.6, 0], [0, 0]]], E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]], G: [[[4, 1], [3, 0], [1, 0], [0, 1.5], [0, 4.5], [1, 6], [4, 6], [4, 3.4], [2.2, 3.4]]], H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
  I: [[[2, 0], [2, 6]]], N: [[[0, 6], [0, 0], [4, 6], [4, 0]]], O: [[[1, 0], [3, 0], [4, 1.5], [4, 4.5], [3, 6], [1, 6], [0, 4.5], [0, 1.5], [1, 0]]],
  P: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.4], [3, 3.3], [0, 3.3]]], R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.4], [3, 3.3], [0, 3.3]], [[2, 3.3], [4, 6]]],
  S: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 2.2], [4, 3.8], [4, 5], [3, 6], [1, 6], [0, 5]]], T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]], U: [[[0, 0], [0, 5], [1, 6], [3, 6], [4, 5], [4, 0]]],
  V: [[[0, 0], [2, 6], [4, 0]]], W: [[[0, 0], [1, 6], [2, 2.5], [3, 6], [4, 0]]],
};
let DECAL = null;
function inscriptionMaterial() {
  if (DECAL) return DECAL;
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d'), r = rng(1487);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.lineCap = 'round';
  const cut = (draw) => { x.save(); x.translate(1.5, 2.5); x.fillStyle = x.strokeStyle = 'rgba(205,197,178,0.42)'; draw(); x.restore(); x.fillStyle = x.strokeStyle = 'rgba(14,12,10,0.9)'; draw(); };
  cut(() => {
    try { x.letterSpacing = '10px'; } catch (e) { /* older browsers: no spacing */ }
    x.font = '600 96px Georgia, "Times New Roman", serif'; x.fillText('AVE · MARIA', 512, 96);
    try { x.letterSpacing = '5px'; } catch (e) { /* */ }
    x.font = '600 44px Georgia, "Times New Roman", serif'; x.fillText('GRATIA · PLENA · ORA · PRO · NOBIS', 512, 196);
    x.lineWidth = 4; x.strokeRect(14, 14, 996, 228);
  });
  // Raoul's hand: single knife strokes, each letter a little off, the lines wandering
  const lines = ['SHE WEEPS AT NIGHT', 'I HAVE HEARD HER', 'SHE IS NOT WEEPING', 'FOR US'], u = 8.2;
  lines.forEach((t, li) => {
    const w = t.length * 5.6 * u; let px = 512 - w / 2 + (r() - 0.5) * 60, py = 274 + li * 60 + (r() - 0.5) * 6; const slope = (r() - 0.5) * 0.05;
    for (const ch of t) {
      const L = SCRATCH[ch]; if (L) { const ox = px, oy = py + (r() - 0.5) * 5, sc = u * (0.92 + r() * 0.16), sk = (r() - 0.5) * 0.16;
        for (let pass = 0; pass < 2; pass++) { x.strokeStyle = pass ? 'rgba(22,19,16,0.85)' : 'rgba(222,214,196,0.55)'; x.lineWidth = pass ? 2.3 : 2.6;
          for (const st of L) { x.beginPath(); st.forEach(([a, b], i) => { const X = ox + (a + (6 - b) * sk) * sc + (pass ? 0 : 1.2), Y = oy + b * sc + (pass ? 0 : 1.8); i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.stroke(); } } }
      px += 5.6 * u; py += slope * 5.6 * u;
    }
  });
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return (DECAL = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}

// ---------------------------------------------------------------- geometry helpers
// every stone part ends indexed, with position / normal / uv / sdat = [cavity, tear mask, figure, ashlar]
function fin(g, cav = 0.15, fig = 0, joint = 0) {
  if (!g.index) { const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); }
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.sdat) {
    const a = new Float32Array(n * 4), cv = g.attributes.cavity;
    for (let i = 0; i < n; i++) { a[i * 4] = cv ? cv.getX(i) : cav; a[i * 4 + 2] = fig; a[i * 4 + 3] = joint; }
    g.setAttribute('sdat', new THREE.BufferAttribute(a, 4));
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'sdat') g.deleteAttribute(k);
  g.morphAttributes = {}; g.clearGroups();
  return g;
}
const xf = (p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) => new THREE.Matrix4().compose(V3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), typeof s === 'number' ? V3(s, s, s) : V3(...s));
const at = (g, p, r, s) => g.applyMatrix4(xf(p, r, s));
// a grid surface: f(u, v) -> [x, y, z, cavity]; rows along v, columns along u
function grid(nu, nv, f, closeU = false) {
  const cols = closeU ? nu : nu + 1, n = cols * (nv + 1), pos = new Float32Array(n * 3), cav = new Float32Array(n), ind = [];
  for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i < cols; i++, k++) { const p = f(i / nu, j / nv, i, j); pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2]; cav[k] = p[3] || 0; }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const i1 = closeU ? (i + 1) % nu : i + 1, a = j * cols + i, b = j * cols + i1, c = (j + 1) * cols + i, d = (j + 1) * cols + i1; ind.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cavity', new THREE.BufferAttribute(cav, 1)); g.setIndex(ind); g.computeVertexNormals();
  return g;
}
// a tube along points, radius r(t), its section flattened by `flat` across the curve's binormal
function tube(pts, r, seg = 6, cav = 0.3, steps = 0, flat = 1) {
  const curve = new THREE.CatmullRomCurve3(pts); steps = steps || Math.max(5, pts.length * 3); const fr = curve.computeFrenetFrames(steps, false), P = new THREE.Vector3();
  return grid(seg, steps, (u, v, i, j) => { curve.getPointAt(v, P); const a = u * TAU, rr = r(v), N = fr.normals[j], B = fr.binormals[j], ca = Math.cos(a) * rr, sa = Math.sin(a) * rr * flat;
    return [P.x + N.x * ca + B.x * sa, P.y + N.y * ca + B.y * sa, P.z + N.z * ca + B.z * sa, typeof cav === 'function' ? cav(u, v) : cav]; }, true);
}
// a box with every edge chamfered (dressed stone): crisp flat faces
function cbox(w, h, d, c = 0.012) {
  const X = w / 2, Y = h / 2, Z = d / 2, P = [], t = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (a, b, q) => { e1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); e2.set(q[0] - a[0], q[1] - a[1], q[2] - a[2]); t.crossVectors(e1, e2);
    if (t.x * (a[0] + b[0] + q[0]) + t.y * (a[1] + b[1] + q[1]) + t.z * (a[2] + b[2] + q[2]) < 0) P.push(...a, ...q, ...b); else P.push(...a, ...b, ...q); };
  const quad = (a, b, q, d2) => { tri(a, b, q); tri(a, q, d2); };
  for (const s of [-1, 1]) {
    quad([s * X, -Y + c, -Z + c], [s * X, Y - c, -Z + c], [s * X, Y - c, Z - c], [s * X, -Y + c, Z - c]);
    quad([-X + c, s * Y, -Z + c], [X - c, s * Y, -Z + c], [X - c, s * Y, Z - c], [-X + c, s * Y, Z - c]);
    quad([-X + c, -Y + c, s * Z], [X - c, -Y + c, s * Z], [X - c, Y - c, s * Z], [-X + c, Y - c, s * Z]);
    for (const q of [-1, 1]) {
      quad([s * X, q * (Y - c), -Z + c], [s * (X - c), q * Y, -Z + c], [s * (X - c), q * Y, Z - c], [s * X, q * (Y - c), Z - c]);
      quad([s * X, -Y + c, q * (Z - c)], [s * (X - c), -Y + c, q * Z], [s * (X - c), Y - c, q * Z], [s * X, Y - c, q * (Z - c)]);
      quad([-X + c, s * Y, q * (Z - c)], [-X + c, s * (Y - c), q * Z], [X - c, s * (Y - c), q * Z], [X - c, s * Y, q * (Z - c)]);
      for (const k of [-1, 1]) tri([s * X, q * (Y - c), k * (Z - c)], [s * (X - c), q * Y, k * (Z - c)], [s * (X - c), q * (Y - c), k * Z]);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}
// a moulded course on a rectangular plan: prof = [[offset beyond the half-sizes, y], ...] bottom to top; smooth up
// the profile, mitred crisp at the corners; capped on top
function mould(prof, hw, hd, cap = true) {
  const P = [], I = [], n = prof.length, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let s = 0; s < 4; s++) { const a = C[s], b = C[(s + 1) % 4], base = P.length / 3;
    for (const [o, y] of prof) { P.push(a[0] * (hw + o), y, a[1] * (hd + o), b[0] * (hw + o), y, b[1] * (hd + o)); }
    for (let i = 0; i < n - 1; i++) { const k = base + i * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
  if (cap) { const [o, y] = prof[n - 1], k = P.length / 3; for (const q of C) P.push(q[0] * (hw + o), y, q[1] * (hd + o)); I.push(k, k + 1, k + 2, k, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}
// a turned or many-sided piece from a [radius, y] profile, flat-faced (n sides)
function prism(prof, n, rot = 0) { const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), n).toNonIndexed(); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g.rotateY(rot); g.computeVertexNormals(); return g; }
// a slab cut to an outline (and holes), chamfered on both faces: gables, arches, the niche
function plate(outline, depth, holes = [], c = 0.012) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * c, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelOffset: -c, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, c); g.deleteAttribute('uv'); return g;
}

// ---------------------------------------------------------------- the head and hands, cut from the model
function carve(hb) {
  const { rig, mesh, P } = hb, J = rig.j, root = rig.root;
  // at prayer: palms together before her breast; the head bowed, inclined to her right, the eyes cast down
  const set = (j, x, y = 0, z = 0) => J[j].rotation.set(x * D2R, y * D2R, z * D2R, 'YXZ');
  set('spine', 1); set('chest', 2); set('neck', 8, 3, 4); set('head', 12, 4, 7);
  root.updateMatrixWorld(true);
  const handUp = V3(0, 1, 0.42).normalize();
  { const up = handUp, X = V3(1, 0, 0), Y = up.clone().negate(), Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const hq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)), ch = J.chest.getWorldPosition(new THREE.Vector3());
    for (const [k, s] of [['R', -1], ['L', 1]]) { rig.solveArm(k, V3(s * 0.016, ch.y - 0.075, ch.z + 0.175), V3(s * 0.7, -1, -0.25), hq); root.updateMatrixWorld(true); } }
  const g = P.geo, PA = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, RG = g.attributes.region, idx = g.index.array;
  const ji = (n) => JOINTS.indexOf(n), HEAD = ji('head'), NECK = ji('neck'), HR = ji('handR'), HL = ji('handL'), FR = ji('fArmR'), FL = ji('fArmL');
  const inv = mesh.skeleton.boneInverses, handBind = [HR, HL].map((b) => new THREE.Vector3().setFromMatrixPosition(inv[b].clone().invert()));
  const eyes = (P.eyes || [[0.0306, 1.6512, 0.123], [-0.0306, 1.6512, 0.123]]).map((e) => V3(...e)), fc = eyes[0].clone().add(eyes[1]).multiplyScalar(0.5);
  const tmp = new THREE.Vector3(), N = PA.count, keep = new Uint8Array(N), domB = new Uint8Array(N);
  for (let v = 0; v < N; v++) {
    let d = 0, w = -1; for (let c = 0; c < 4; c++) { const ww = SW.array[v * 4 + c]; if (ww > w) { w = ww; d = SI.array[v * 4 + c]; } }
    const x = PA.getX(v), y = PA.getY(v), z = PA.getZ(v);
    if (d === HEAD || d === NECK) {
      if (RG.getX(v) === 4) continue;                                             // the model's eyeballs: she gets carved ones
      if (y > 1.757 || (y > 1.575 && z < 0.0) || z < -0.012) continue;          // under the veil
      if (Math.abs(x) < 0.034 && y > 1.552 && y < 1.628 && z > 0 && z < 0.122) continue;   // inside the mouth
      if (y < 1.525 && Math.abs(x) > 0.056) continue;                             // the slope to the shoulders: under the gown's collar
      keep[v] = 1;
    } else if (d === HR || d === HL) keep[v] = 2;
    else if (d === FR || d === FL) { tmp.set(x, y, z); if (tmp.distanceTo(handBind[d === FR ? 0 : 1]) < 0.022) keep[v] = 2; }
    if (keep[v] === 2) domB[v] = d;
  }
  // weld by position, so wear and morphs run across the model's seams
  const key = new Map(), wid = new Int32Array(N).fill(-1), wp = [], wk = [], wbone = [];
  for (let v = 0; v < N; v++) { if (!keep[v]) continue; const x = PA.getX(v), y = PA.getY(v), z = PA.getZ(v), k = (Math.round(x * 2e4) + 16000) * 1.6e9 + Math.round(y * 2e4) * 40000 + Math.round(z * 2e4) + 16000;
    let id = key.get(k); if (id === undefined) { id = wp.length; key.set(k, id); wp.push(V3(x, y, z)); wk.push(keep[v]); wbone.push(domB[v]); } wid[v] = id; }
  const nW = wp.length, nb = Array.from({ length: nW }, () => []), tris = [];
  for (let i = 0; i < idx.length; i += 3) { const a = idx[i], b = idx[i + 1], c = idx[i + 2]; if (!keep[a] || !keep[b] || !keep[c]) continue; tris.push(a, b, c);
    const A = wid[a], B = wid[b], C = wid[c]; nb[A].push(B, C); nb[B].push(A, C); nb[C].push(A, B); }
  for (const hbone of [HR, HL]) closeHand(wp, wbone, nb, hbone, inv[hbone]);
  // toward the sweet round face of a Gothic Madonna: a finer nose, fuller lips, a narrow jaw and small round chin,
  // soft cheeks; and heavy upper lids, half lowered
  const EC = eyes.map((e) => V3(e.x, e.y, e.z - 0.0065)), ER = 0.0149;
  for (let i = 0; i < nW; i++) {
    if (wk[i] !== 1) continue;
    const p = wp[i], dx = p.x - fc.x, dy = p.y - fc.y, dz = p.z - fc.z; if (dy < -0.2 || dz < -0.09) continue;
    const front = sstep(-0.05, -0.01, dz), ax = Math.abs(dx);
    const nose = (1 - sstep(0.016, 0.03, ax)) * sstep(-0.07, -0.05, dy) * (1 - sstep(0.0, 0.012, dy)) * sstep(-0.005, 0.02, dz);
    p.z -= nose * Math.max(0, dz + 0.005) * 0.3; p.x = fc.x + dx * (1 - 0.16 * nose);
    const ala = (1 - sstep(0.02, 0.032, ax)) * Math.exp(-(((dy + 0.05) / 0.013) ** 2)) * front; p.x = fc.x + (p.x - fc.x) * (1 - 0.2 * ala);
    const lip = (1 - sstep(0.02, 0.032, ax)) * Math.exp(-(((dy + 0.072) / 0.014) ** 2)) * front;
    p.z += lip * 0.003; p.y += (dy + 0.072) * 0.16 * lip; p.x = fc.x + (p.x - fc.x) * (1 - 0.1 * lip);
    const jaw = sstep(-0.05, -0.105, dy) * sstep(0.025, 0.06, ax); p.x = fc.x + (p.x - fc.x) * (1 - 0.09 * jaw);
    const chin = sstep(-0.09, -0.12, dy) * (1 - sstep(0.02, 0.04, ax)) * front; p.z -= chin * 0.004; p.y += chin * 0.005;
    const cheek = Math.exp(-(((ax - 0.042) / 0.016) ** 2) - ((dy + 0.045) / 0.022) ** 2) * front; p.x = fc.x + (p.x - fc.x) * (1 + 0.04 * cheek); p.z += cheek * 0.004;
    for (let k = 0; k < 2; k++) { const e = eyes[k], ex = p.x - e.x, ey = p.y - e.y, ez = p.z - e.z; if (Math.abs(ex) > 0.017 || ey < 0.0004 || ey > 0.012 || ez < -0.006) continue;
      p.y -= 0.0013 * sstep(0.0004, 0.004, ey) * (1 - sstep(0.006, 0.012, ey)) * (1 - (ex / 0.017) ** 2);
      const q = tmp.copy(p).sub(EC[k]), l = q.length(); if (l < ER + 0.0011) p.copy(EC[k]).addScaledVector(q, (ER + 0.0011) / l); }
  }
  // the rain has only softened her: a light wear over face and hands (least about the eyes, so the lids stay cut)
  const cur = wp.map((p) => p.clone()), nxt = wp.map((p) => p.clone());
  for (let it = 0; it < 2; it++) {
    for (let i = 0; i < nW; i++) { const q = nb[i]; if (!q.length) continue; tmp.set(0, 0, 0); for (const j of q) tmp.add(cur[j]); tmp.multiplyScalar(1 / q.length);
      const de = Math.min(wp[i].distanceTo(eyes[0]), wp[i].distanceTo(eyes[1])); nxt[i].copy(cur[i]).lerp(tmp, wk[i] === 1 ? lerp(0.05, 0.24, sstep(0.012, 0.03, de)) : 0.24); }
    for (let i = 0; i < nW; i++) cur[i].copy(nxt[i]);
  }
  // what stands proud has taken the weather: the brow ridge and the bridge of the nose are rubbed down a little more
  for (let i = 0; i < nW; i++) { const q = nb[i]; nxt[i].copy(cur[i]); if (wk[i] !== 1 || !q.length) continue; const o = wp[i], dx = Math.abs(o.x - fc.x), dy = o.y - fc.y, dz = o.z - fc.z;
    const w = Math.max(sstep(0.006, 0.016, dy) * (1 - sstep(0.03, 0.05, dy)), (1 - sstep(0.008, 0.016, dx)) * sstep(-0.05, -0.03, dy) * (1 - sstep(0.0, 0.012, dy))) * sstep(-0.03, -0.005, dz); if (w <= 0) continue;
    tmp.set(0, 0, 0); for (const j of q) tmp.add(cur[j]); nxt[i].lerp(tmp.multiplyScalar(1 / q.length), 0.45 * w); }
  for (let i = 0; i < nW; i++) cur[i].copy(nxt[i]);
  // and the tip of her nose is chipped: a small flat break, a little to one side
  const chipN = V3(0.42, -0.3, 1).normalize(), chipD = chipN.dot(V3(fc.x + 0.002, fc.y - 0.034, fc.z + 0.0335)), chipped = new Uint8Array(nW);
  for (let i = 0; i < nW; i++) { if (wk[i] !== 1) continue; const d = cur[i].dot(chipN) - chipD; if (d > 0 && Math.abs(cur[i].x - fc.x) < 0.02 && Math.abs(cur[i].y - fc.y + 0.034) < 0.02) { cur[i].addScaledVector(chipN, -d); chipped[i] = 1; } }
  // bake the pose into the stone
  const used = [...new Set(tris)], remap = new Map(); used.forEach((v, i) => remap.set(v, i));
  const BM = mesh.skeleton.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]).elements), SIa = SI.array, SWa = SW.array;
  const n = used.length, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), sd = new Float32Array(n * 4);
  used.forEach((v, i) => {
    const b = cur[wid[v]], o = wp[wid[v]], ws = (SWa[v * 4] + SWa[v * 4 + 1] + SWa[v * 4 + 2] + SWa[v * 4 + 3]) || 1; let sx = 0, sy = 0, sz = 0;
    for (let c = 0; c < 4; c++) { const w = SWa[v * 4 + c] / ws; if (!w) continue; const e = BM[SIa[v * 4 + c]]; sx += w * (e[0] * b.x + e[4] * b.y + e[8] * b.z + e[12]); sy += w * (e[1] * b.x + e[5] * b.y + e[9] * b.z + e[13]); sz += w * (e[2] * b.x + e[6] * b.y + e[10] * b.z + e[14]); }
    tmp.set(sx, sy, sz); pos[i * 3] = sx; pos[i * 3 + 1] = sy; pos[i * 3 + 2] = sz;
    let cav = 0.1;
    if (keep[v] === 1) {
      uv[i * 2] = o.x - fc.x; uv[i * 2 + 1] = o.y - fc.y; sd[i * 4 + 1] = sstep(0.06, 0.095, o.z) * sstep(1.5, 1.53, o.y);
      const de = Math.min(o.distanceTo(eyes[0]), o.distanceTo(eyes[1])), dx = Math.abs(o.x - fc.x), dy = o.y - fc.y;
      cav += 0.42 * (1 - sstep(0.004, 0.022, de));                                                            // the sockets
      cav += 0.35 * Math.exp(-((dx / 0.02) ** 2) - (((dy + 0.0745) / 0.0035) ** 2));                              // between the lips
      cav += 0.4 * Math.exp(-(((dx - 0.009) / 0.006) ** 2) - (((dy + 0.047) / 0.005) ** 2)) * sstep(0.02, 0.03, o.z - fc.z + 0.01);   // the nostrils
      cav += 0.3 * sstep(-0.115, -0.15, dy) * sstep(0.0, 0.05, o.z);                                           // under the chin, the throat
      if (chipped[wid[v]]) cav += 0.22;
    } else cav += 0.4 * (1 - sstep(0.004, 0.016, Math.abs(tmp.x)));                                            // between the palms
    sd[i * 4] = Math.min(1, cav); sd[i * 4 + 2] = 1;
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('sdat', new THREE.BufferAttribute(sd, 4)); geo.setIndex(tris.map((v) => remap.get(v))); geo.computeVertexNormals();
  const headM = new THREE.Matrix4().multiplyMatrices(J.head.matrixWorld, inv[HEAD]), wp2 = (nm) => J[nm].getWorldPosition(new THREE.Vector3());
  return { geo, headM, eyes, EC, ER, wr: { R: wp2('handR'), L: wp2('handL') }, handUp, handAcross: V3(1, 0, 0).cross(handUp.clone().negate()).normalize() };
}
// The model's hand is at rest: fingers spread and a little curled, the thumb standing out before the palm. For
// prayer (and for stone) it is closed: each finger is found as its own island beyond the webs, turned at its root
// to lie straight against its neighbour, made a little fuller and shorter; the thumb is laid alongside the
// forefinger. All in the hand bone's own frame: [along the hand, across it, through it].
function closeHand(wp, wbone, nb, HB, M) {
  const n = wp.length, L = new Float32Array(n * 3), inH = new Uint8Array(n), v = new THREE.Vector3(), Mi = M.clone().invert();
  for (let i = 0; i < n; i++) if (wbone[i] === HB) { v.copy(wp[i]).applyMatrix4(M); L[i * 3] = -v.y; L[i * 3 + 1] = v.z; L[i * 3 + 2] = v.x; inH[i] = 1; }
  const islands = (pred, min = 20) => { const seen = new Uint8Array(n), out = [];
    for (let i = 0; i < n; i++) { if (!inH[i] || seen[i] || !pred(i)) continue; const st = [i], m = []; seen[i] = 1; while (st.length) { const a = st.pop(); m.push(a); for (const b of nb[a]) if (inH[b] && !seen[b] && pred(b)) { seen[b] = 1; st.push(b); } } if (m.length >= min) out.push(m); }
    return out; };
  const mean = (m, k) => { let s = 0; for (const a of m) s += L[a * 3 + k]; return s / m.length; }, P3 = (a) => V3(L[a * 3], L[a * 3 + 1], L[a * 3 + 2]);
  const fs = islands((i) => L[i * 3] > 0.105); if (fs.length !== 4) return;   // not the hand we know: leave it be
  fs.sort((a, b) => mean(a, 1) - mean(b, 1));
  const reach = (m) => { let x = 0; for (const a of m) x = Math.max(x, L[a * 3]); return x; };
  if (reach(fs[0]) > reach(fs[3])) fs.reverse();                              // now: little finger, ring, middle, fore
  const st = Math.sign(mean(fs[3], 1) - mean(fs[0], 1)), cuts = [0.09, 0.105, 0.105, 0.105];
  { const lf = islands((i) => L[i * 3] > 0.09).find((m) => m.length < 400 && m.includes(fs[0][0])); if (lf) fs[0] = lf; else cuts[0] = 0.105; }
  const th = islands((i) => Math.abs(L[i * 3 + 2]) > 0.022 && L[i * 3] < 0.1).filter((m) => mean(m, 1) * st > 0).sort((a, b) => b.length - a.length)[0];
  const pm = th ? Math.sign(mean(th, 2)) : -1;                                // which way the palm faces
  const F = fs.map((m, k) => { const base = m.filter((a) => L[a * 3] < cuts[k] + 0.008), B = V3(mean(base, 0), mean(base, 1), mean(base, 2)); let tip = B, td = 0; for (const a of m) { const d = P3(a).distanceTo(B); if (d > td) { td = d; tip = P3(a); } }
    return { m, B, d: tip.clone().sub(B).normalize(), len: td, cut: cuts[k] }; });
  // where each should lie: the middle finger straight up the hand, the others closed against it, all bent a touch toward the palm
  // (their roots are drawn together a little as well, or wide slots are left between the knuckles)
  const lean = 0.1 * pm, tgt = (f, across) => V3(f.len, across - f.B.y - f.sh, lean * f.len).normalize(); [0.0075, 0.005, 0, -0.0055].forEach((d, k) => { F[k].sh = st * d; });
  F[2].T = tgt(F[2], F[2].B.y);
  F[3].T = tgt(F[3], F[2].B.y + st * 0.0135); F[1].T = tgt(F[1], F[2].B.y - st * 0.0135);
  F[0].T = tgt(F[0], F[1].B.y + F[1].sh + (F[1].T.y / F[1].T.x) * (F[0].B.x + F[0].len - F[1].B.x) - st * 0.013);
  const q = new THREE.Quaternion(), qi = new THREE.Quaternion(), ec = new THREE.Vector3(), et = new THREE.Vector3(), o = new THREE.Vector3();
  const put = (a) => { v.set(o.z, -o.x, o.y).applyMatrix4(Mi); wp[a].copy(v); };   // back from the hand's frame
  for (const f of F) {
    q.setFromUnitVectors(f.d, f.T); ec.set(0, 1, 0).addScaledVector(f.T, -f.T.y).normalize(); et.crossVectors(f.T, ec);
    for (const a of f.m) { const w = sstep(f.cut, f.cut + 0.009, L[a * 3]); if (w <= 0) continue;
      o.set(L[a * 3], L[a * 3 + 1], L[a * 3 + 2]).sub(f.B).applyQuaternion(qi.identity().slerp(q, w));
      const s = o.dot(f.T), t = clamp(s / f.len, 0, 1), c = (o.dot(ec)) * (1 + Math.sqrt(w) * lerp(0.42, 0.58, t)), h = (o.dot(et)) * (1 + w * lerp(0.12, 0.3, t));
      o.copy(f.B).addScaledVector(f.T, s * (1 - 0.06 * w)).addScaledVector(ec, c).addScaledVector(et, h); o.y += f.sh * w; put(a); }
  }
  if (th) {   // the thumb: swung back from before the palm to lie along the forefinger's side
    const root = th.filter((a) => Math.abs(L[a * 3 + 2]) < 0.03), Pv = V3(mean(root, 0), mean(root, 1), mean(root, 2)); let tip = Pv, td = 0; for (const a of th) { const d = P3(a).distanceTo(Pv); if (d > td) { td = d; tip = P3(a); } }
    const d = tip.clone().sub(Pv).normalize(), S = V3(Pv.x + 0.004, F[3].B.y + st * 0.012, pm * 0.007), T = V3(0.96, st * 0.2, -pm * 0.03).normalize(); q.setFromUnitVectors(d, T);
    for (const a of th) { o.set(L[a * 3], L[a * 3 + 1], L[a * 3 + 2]).sub(Pv); const w = sstep(-0.002, 0.022, o.dot(d)); if (w <= 0) continue;
      o.applyQuaternion(qi.identity().slerp(q, w)); o.add(Pv).addScaledVector(v.copy(S).sub(Pv), w); put(a); }
  }
}
// the eyes: carved balls behind the lids, an incised ring for the iris and a drilled pupil, looking down
function carvedEyes(cv) {
  const TH = [0, 3.5, 7, 8.6, 11, 15.5, 19, 20.6, 22.2, 27, 36, 48, 62], DP = [-0.0019, -0.0019, -0.0018, 0, 0, 0, 0, -0.0006, 0, 0, 0, 0, 0], CV = [1, 1, 1, 0.55, 0.2, 0.15, 0.3, 0.9, 0.3, 0.15, 0.15, 0.2, 0.3];
  return cv.EC.map((c, k) => {
    const s = k ? -1 : 1, gz = V3(-s * 0.05, -0.2, 1).normalize(), gx = V3(1, 0, 0).cross(gz).normalize().negate(), gy = new THREE.Vector3().crossVectors(gz, gx), gx2 = new THREE.Vector3().crossVectors(gy, gz);
    const g = grid(16, TH.length - 1, (u, v, i, j) => { const th = TH[j] * D2R, a = u * TAU, R = cv.ER + DP[j], st = Math.sin(th) * R, ct = Math.cos(th) * R, ca = Math.cos(a) * st, sa = Math.sin(a) * st;
      return [c.x + gx2.x * ca + gy.x * sa + gz.x * ct, c.y + gx2.y * ca + gy.y * sa + gz.y * ct, c.z + gx2.z * ca + gy.z * sa + gz.z * ct, CV[j]]; }, true);
    return g.applyMatrix4(cv.headM);
  });
}

// ---------------------------------------------------------------- the carved body
const YTOP = 1.56, RREF = 0.2, FW = 256, FH = 320, SX = TAU * RREF / FW, SY = YTOP / FH;
// paint a fold into a relief field: a polyline in (angle, height), raised h with half-width w (numbers or functions
// of the distance along it); pointed crest (pow) or a round pipe; kL / kR widen one flank (left / right of travel)
function stroke(F, pts, o) {
  const hf = typeof o.h === 'function' ? o.h : () => o.h, wf = typeof o.w === 'function' ? o.w : () => o.w, kL = o.kL ?? 1, kR = o.kR ?? 1, pw = o.pow ?? 1.4, km = Math.max(kL, kR), fade = o.fade, round = o.round;
  const M = pts.map(([a, y]) => [a * RREF, y]), cum = [0]; let L = 0;
  for (let i = 1; i < M.length; i++) { L += Math.hypot(M[i][0] - M[i - 1][0], M[i][1] - M[i - 1][1]); cum.push(L); }
  for (let i = 0; i < M.length - 1; i++) {
    const [x0, y0] = M[i], [x1, y1] = M[i + 1], dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1e-9, t0 = cum[i] / L, t1 = cum[i + 1] / L;
    const h0 = hf(t0), h1 = hf(t1), w0 = wf(t0), w1 = wf(t1), wmax = Math.max(w0, w1) * km; if (h0 <= 0 && h1 <= 0) continue;
    const px0 = Math.floor((Math.min(x0, x1) - wmax + PI * RREF) / SX), px1 = Math.ceil((Math.max(x0, x1) + wmax + PI * RREF) / SX);
    const py0 = Math.max(0, Math.floor((Math.min(y0, y1) - wmax) / SY)), py1 = Math.min(FH - 1, Math.ceil((Math.max(y0, y1) + wmax) / SY));
    for (let py = py0; py <= py1; py++) { const y = py * SY;
      for (let px = px0; px <= px1; px++) { const x = px * SX - PI * RREF; let u = ((x - x0) * dx + (y - y0) * dy) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u;
        const ex = x - x0 - dx * u, ey = y - y0 - dy * u, d2 = ex * ex + ey * ey, w = (w0 + (w1 - w0) * u) * (dx * ey - dy * ex > 0 ? kL : kR); if (d2 >= w * w) continue;
        const q = Math.sqrt(d2) / w; let v = (h0 + (h1 - h0) * u) * (round ? Math.pow(1 - q * q, 0.75) : Math.pow(1 - q, pw)); if (fade) v *= fade(x / RREF, y);
        const k = py * FW + (((px % FW) + FW) % FW); if (v > F[k]) F[k] = v; } }
  }
}
function blur(F, rad) {   // a box blur (wrapping round the figure), in place
  const T = new Float32Array(FW * FH), n = 2 * rad + 1;
  for (let y = 0; y < FH; y++) { const o = y * FW; let s = 0; for (let x = -rad; x <= rad; x++) s += F[o + ((x + FW) % FW)]; for (let x = 0; x < FW; x++) { T[o + x] = s / n; s += F[o + ((x + rad + 1) % FW)] - F[o + ((x - rad + FW) % FW)]; } }
  for (let x = 0; x < FW; x++) { let s = 0; for (let y = -rad; y <= rad; y++) s += T[clamp(y, 0, FH - 1) * FW + x]; for (let y = 0; y < FH; y++) { F[y * FW + x] = s / n; s += T[Math.min(FH - 1, y + rad + 1) * FW + x] - T[Math.max(0, y - rad) * FW + x]; } }
  return F;
}
function sample(F, a, y) {
  const fx = ((a + PI) / TAU) * FW, fy = clamp(y / SY, 0, FH - 1.001), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, xa = ((x0 % FW) + FW) % FW, xb = (xa + 1) % FW;
  return (F[y0 * FW + xa] * (1 - tx) + F[y0 * FW + xb] * tx) * (1 - ty) + (F[(y0 + 1) * FW + xa] * (1 - tx) + F[(y0 + 1) * FW + xb] * tx) * ty;
}
// The mantle's edges. Its lower hem falls from her left arm down across the shins to her right; under each arm the
// gathered cloth hangs in pipes, each ending at its own height (the zigzag of the cascade).
const HEM = [[-PI, 0.15], [-2.3, 0.16], [-1.8, 0.24], [-1.0, 0.31], [-0.45, 0.31], [0.15, 0.4], [0.6, 0.53], [0.86, 0.64], [1.6, 0.6], [1.95, 0.3], [2.4, 0.18], [PI, 0.15]];
const PIPES = [[-1.63, 0.13, -1.3, 0.34], [-1.38, 0.13, -1.3, 0.2], [-1.13, 0.13, -1.3, 0.37], [0.98, 0.12, 1.12, 0.7], [1.22, 0.12, 1.12, 0.55], [1.46, 0.12, 1.12, 0.68], [1.7, 0.12, 1.12, 0.5]];   // [angle at the foot, half-width, angle where it is gathered, foot]
const hemY = (a) => { for (const [pa, pw, , pb] of PIPES) { const q = (a - pa) / pw; if (q > -1 && q <= 1) return pb + 0.035 * q * q; } return tab(HEM, a); };
const yokeY = (a) => 1.02 + 0.035 * (a / 1.1) ** 2;            // its upper edge, turned over, where it is drawn across under her hands
const OPEN = [[1.0, 1.22], [1.1, 1.12], [1.2, 0.9], [1.3, 0.64], [1.4, 0.46], [1.5, 0.36], [1.56, 0.33]];   // where it parts over the breast
const ELBOW = { R: [-0.165, 1.06, 0.03], L: [0.165, 1.06, 0.03] };
const AXIS = [[0, -0.01], [0.5, -0.03], [0.93, -0.05], [1.3, 0.012], [1.56, 0]], AZ = -0.01;                  // the S of the figure

function carveBody(r) {
  // ---- the big forms: round cones in a smooth union
  const prims = [];
  const cone = (a, b, ra, rb, k = 0.055, sz = 1) => { const dx = b[0] - a[0], dy = b[1] - a[1], dz = (b[2] - a[2]) / sz, m = Math.max(ra, rb) + k + 0.02;
    prims.push({ ax: a[0], ay: a[1], az: a[2], dx, dy, dz, il: 1 / (dx * dx + dy * dy + dz * dz || 1e-9), ra, dr: rb - ra, k, sz, y0: Math.min(a[1], b[1]) - m, y1: Math.max(a[1], b[1]) + m }); };
  cone([-0.01, 0.02, -0.005], [-0.05, 0.93, -0.01], 0.18, 0.155, 0.05, 0.88);         // the skirt
  cone([-0.1, 0.9, 0], [0.01, 0.9, 0], 0.135, 0.13, 0.06, 0.9);                        // hips, swung to her right
  cone([-0.045, 0.93, -0.01], [0.012, 1.3, -0.012], 0.145, 0.128, 0.06, 0.8);            // waist and back
  cone([0.008, 1.3, 0.02], [0.008, 1.31, 0.02], 0.125, 0.125, 0.05, 0.85);               // the breast
  cone([-0.115, 1.405, -0.02], [0.125, 1.41, -0.02], 0.06, 0.06, 0.05);                  // narrow, sloping shoulders
  cone([0.003, 1.38, 0], [0, 1.462, 0.014], 0.115, 0.072, 0.04);                            // up to the neckline
  cone([0, 1.46, 0.01], [0, 1.62, 0.02], 0.035, 0.035, 0.01);
  for (const s of [-1, 1]) cone([s * 0.14, 1.39, -0.02], ELBOW[s < 0 ? 'R' : 'L'], 0.058, 0.055, 0.045);   // upper arms, under the mantle (the forearms are cut free: carveSleeves)
  cone([-0.205, 1.0, 0.03], [-0.24, 0.34, 0.01], 0.05, 0.045, 0.04);                       // the mantle hanging from her right arm
  cone([0.19, 1.0, 0.04], [0.2, 0.68, 0.04], 0.045, 0.04, 0.04);                         // and gathered under her left
  cone([0.06, 0.93, 0.02], [0.095, 0.52, 0.15], 0.09, 0.072, 0.05);                     // the free leg: thigh,
  cone([0.095, 0.52, 0.15], [0.1, 0.07, 0.05], 0.07, 0.05, 0.05);                       // shin,
  cone([0.1, 0.035, 0.13], [0.112, 0.03, 0.215], 0.036, 0.03, 0.02);                     // and the toe of her shoe
  const dist = (x, y, z, act) => { let d = 1e9;
    for (let i = 0; i < act.length; i++) { const p = act[i], qx = x - p.ax, qy = y - p.ay, qz = (z - p.az) / p.sz, t = clamp((qx * p.dx + qy * p.dy + qz * p.dz) * p.il, 0, 1), ex = qx - p.dx * t, ey = qy - p.dy * t, ez = qz - p.dz * t;
      const d2 = (Math.sqrt(ex * ex + ey * ey + ez * ez) - p.ra - p.dr * t) * Math.min(1, p.sz), h = Math.max(p.k - Math.abs(d - d2), 0) / p.k; d = Math.min(d, d2) - h * h * p.k * 0.25; }
    return d; };

  // ---- the drapery, as relief: M on the mantle, D on the gown
  const M = new Float32Array(FW * FH), D = new Float32Array(FW * FH), ph = () => r() * TAU;
  const knee = (a, y) => 1 - 0.85 * Math.exp(-(((a - 0.42) / 0.3) ** 2) - ((y - 0.56) / 0.17) ** 2);   // the knee presses the cloth smooth
  // bowl folds, slung from the tuck under her left elbow to her right hip, each hanging lower than the last
  for (let k = 0; k < 5; k++) {
    const aL = 1.0 - 0.035 * k, yL = 1.0 - 0.035 * k, aR = -1.0 - 0.02 * k, yR = 0.975 - 0.07 * k, a0 = -0.1 - 0.075 * k + (r() - 0.5) * 0.06, y0 = 0.905 - 0.125 * k, pts = [];
    for (let i = 0; i <= 16; i++) { const a = lerp(aR, aL, i / 16), s = a < a0 ? (a0 - a) / (a0 - aR) : (a - a0) / (aL - a0); pts.push([a, y0 + ((a < a0 ? yR : yL) - y0) * Math.pow(s, 1.85)]); }
    stroke(M, pts, { h: (t) => 0.036 * sstep(0, 0.1, t) * sstep(1, 0.93, t) * (1 - 0.1 * k), w: 0.03, kL: 2.4, pow: 1.35, fade: knee });
  }
  // short creases pulling out of the tuck
  for (let k = 0; k < 4; k++) { const a1 = 0.55 - k * 0.1 + r() * 0.05, y1 = 0.99 - k * 0.07; stroke(M, [[0.98, 0.995 - k * 0.025], [lerp(0.98, a1, 0.5), lerp(0.995, y1, 0.5) - 0.012], [a1, y1]], { h: (t) => 0.016 * (1 - t), w: 0.016, pow: 1.2 }); }
  // its upper edge, rolled over
  { const pts = []; for (let i = 0; i <= 12; i++) { const a = lerp(-1.12, 1.0, i / 12); pts.push([a, yokeY(a) - 0.016]); } stroke(M, pts, { h: 0.024, w: 0.02, kR: 2.2, pow: 1.1 }); }
  // the cascades: pipes hanging from each arm
  for (const [pa, pw, ga, bot] of PIPES) { const sway = (r() - 0.5) * 0.04; stroke(M, [[ga, 1.06], [lerp(ga, pa, 0.6) + sway, lerp(1.06, bot, 0.45)], [pa, bot + 0.035]], { h: (t) => 0.044 * sstep(0, 0.3, t), w: (t) => RREF * pw * lerp(0.3, 0.86, sstep(0, 0.7, t)), round: true }); }
  // long folds down her back
  for (let i = 0, a = 1.98; a < TAU - 1.9; i++, a += 0.33 + r() * 0.12) { const p1 = ph(); const pts = []; for (let q = 0; q <= 6; q++) { const y = lerp(1.36, 0.14, q / 6); pts.push([a + 0.05 * Math.sin(y * 4 + p1), y]); }
    stroke(M, pts, { h: (t) => 0.024 * sstep(0, 0.3, t), w: (t) => lerp(0.028, 0.05, t), round: true }); }
  // over the upper arms: folds fanning up from the crook of each elbow to the shoulder
  for (const s of [-1, 1]) {
    for (const [a1, y1, h] of [[0.72, 1.4, 0.016], [1.02, 1.44, 0.02], [1.38, 1.43, 0.02], [1.75, 1.38, 0.016]]) stroke(M, [[s * 1.14, 1.15], [s * lerp(1.14, a1, 0.5) + s * 0.04, lerp(1.15, y1, 0.5)], [s * a1, y1]], { h: (t) => h * Math.sin(Math.min(1, t * 1.25) * PI), w: (t) => lerp(0.016, 0.03, t), pow: 1.25 });
  }
  // the gown: long tubular folds to the ground, breaking sideways on the base
  for (const a0 of [-2.95, -2.5, -2.08, -1.66, -1.27, -0.9, -0.54, -0.18, 0.74, 1.1, 1.5, 1.92, 2.38, 2.82]) {
    const p1 = ph(), kick = (r() < 0.5 ? -1 : 1) * (0.1 + r() * 0.08), top = 0.82, pts = [];
    for (let q = 0; q <= 9; q++) { const y = q < 7 ? lerp(top, 0.12, q / 7) : lerp(0.12, 0, (q - 7) / 2); pts.push([a0 + 0.045 * Math.sin(y * 6 + p1) + (y < 0.12 ? kick * (1 - y / 0.12) ** 1.5 : 0), y]); }
    stroke(D, pts, { h: (t) => lerp(0.024, 0.04, t), w: (t) => lerp(0.028, 0.05, t), round: true });
  }
  // the shin of the free leg stretches the gown: two folds run from the knee down to the base
  stroke(D, [[0.2, 0.5], [0.1, 0.25], [0.02, 0.0]], { h: 0.022, w: 0.03, pow: 1.3 }); stroke(D, [[0.6, 0.5], [0.66, 0.25], [0.74, 0.0]], { h: 0.02, w: 0.03, pow: 1.3 });
  // the bodice: fine pleats from the neckline, a band at the neck
  for (let k = -3; k <= 3; k++) stroke(D, [[k * 0.11, 1.47], [k * 0.085, 1.3], [k * 0.07, 1.1]], { h: 0.007, w: 0.012, pow: 1.1 });
  { const pts = [[-PI, 1.49], [PI, 1.49]]; stroke(D, pts, { h: 0.008, w: 0.013, round: true }); }
  // the sleeves, wrinkled along the forearms
  // compose: gown, the mantle lying on it (its own thickness, a rolled hem, a shadowed undercut beneath its edge)
  const H = new Float32Array(FW * FH), hemA = new Float32Array(FW), yokeA = new Float32Array(FW);
  for (let px = 0; px < FW; px++) { const a = (px / FW) * TAU - PI; hemA[px] = hemY(a); yokeA[px] = yokeY(a); }
  for (let py = 0; py < FH; py++) { const y = py * SY, ao = tab(OPEN, y);
    for (let px = 0; px < FW; px++) { const k = py * FW + px, aa = Math.abs((px / FW) * TAU - PI);
      const s = Math.min(y - hemA[px], Math.max(yokeA[px] - y, (aa - ao) * RREF)), K = s <= -0.004 ? 0 : s >= 0.004 ? 1 : sstep(-0.004, 0.004, s);
      let h = K * (0.017 + M[k]); if (K < 1) h += (1 - K) * (D[k] - (s > -0.14 ? 0.013 * Math.exp(Math.min(0, s) / 0.03) : 0));
      if (s > -0.02 && s < 0.04) h += 0.007 * Math.exp(-(((s - 0.009) / 0.008) ** 2));
      H[k] = h; } }
  blur(H, 1);
  const C = blur(H.slice(), 5); for (let i = 0; i < C.length; i++) C[i] = clamp((C[i] - H[i]) / 0.015, 0, 1);

  // ---- read the surface: a ray from the axis outward at every angle and height
  const NA = 110, NY = 120, pos = new Float32Array(NA * (NY + 1) * 3), cav = new Float32Array(NA * (NY + 1)), ind = [];
  for (let j = 0, v = 0; j <= NY; j++) {
    const y = (j / NY) * YTOP, ax = tab(AXIS, y), act = prims.filter((p) => y >= p.y0 && y <= p.y1); let tp = -1;
    for (let i = 0; i < NA; i++, v++) {
      const th = PI * ((2 * i) / NA - 1), a = th - 0.45 * Math.sin(th), s = Math.sin(a), c = Math.cos(a);
      let t = tp > 0 ? tp + 0.07 : 0.5; if (tp > 0 && dist(ax + s * t, y, AZ + c * t, act) < 0.012) t = 0.5;
      for (let it = 0; it < 48; it++) { const d = dist(ax + s * t, y, AZ + c * t, act); if (d < 0.0006) break; t -= d * 0.92; if (t < 0.02) { t = 0.02; break; } }
      tp = t;
      let R = t + sample(H, a, y);
      if (y < 0.11) R += (0.03 + 0.9 * sample(H, a, 0.13)) * (1 - y / 0.11) ** 2;   // the folds break and spread on the base
      if (j === NY) R = 0.02;                                                         // closed inside the neck
      pos[v * 3] = ax + s * R; pos[v * 3 + 1] = y; pos[v * 3 + 2] = AZ + c * R; cav[v] = Math.min(1, sample(C, a, y) + (y < 0.05 ? 0.3 : 0));
    }
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const i1 = (i + 1) % NA, a = j * NA + i, b = j * NA + i1, c = (j + 1) * NA + i, d = (j + 1) * NA + i1; ind.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('cavity', new THREE.BufferAttribute(cav, 1)); g.setIndex(ind); g.computeVertexNormals();
  const parts = [g];
  // the figure's own base: an eight-sided slab she was cut with
  parts.push(fin(prism([[0, -0.07], [0.335, -0.07], [0.335, -0.022], [0.318, -0.004], [0, -0.004]], 8, PI / 8), 0.3, 1));
  return { parts, sdf: (x, y, z) => dist(x, y, z, prims) };
}

// ---------------------------------------------------------------- the forearms
// Each forearm rises from the elbow (under the mantle) to the joined hands, cut free of the body. It wears the
// kirtle's close sleeve, ending at the wrist in a plain narrow cuff; over that the gown's wide sleeve, open below
// the forearm: it hangs from the arm with its own thickness, a dark inside, and a heavy turned edge.
function carveSleeves(r, cv) {
  const parts = [], dn = V3(0, -1, 0), P = new THREE.Vector3();
  for (const [k, s] of [['R', -1], ['L', 1]]) {
    const E = V3(...ELBOW[k]), W = cv.wr[k].clone().add(V3(-s * 0.0045, 0, 0)).addScaledVector(cv.handAcross, -0.002), u = W.clone().sub(E), Lf = u.length(); u.normalize();   // to the middle of the wrist
    // the close sleeve: oval like the wrist it covers (wide the way the hand is wide)
    const b1 = cv.handAcross.clone().addScaledVector(u, -cv.handAcross.dot(u)).normalize(), b2 = new THREE.Vector3().crossVectors(u, b1);
    const TS = [0.36, 0.5, 0.64, 0.78, 0.9, 0.94, 0.945, 1.0, 1.006, 1.016], RS = [1.36, 1.27, 1.17, 1.08, 1.0, 0.99, 1.07, 1.07, 0.99, 0.72];   // the last rings: the cuff band, standing a thread proud, then turned in to the wrist
    parts.push(fin(grid(12, TS.length - 1, (uu, v, i, j) => { const a = uu * TAU, t = TS[j], wr = 1 + 0.03 * Math.sin(t * 60 + s) * (j < 5 ? 1 : 0), c = Math.cos(a) * 0.0295 * RS[j] * wr, d = Math.sin(a) * 0.0195 * lerp(RS[j], 1.9, sstep(0.9, 0.36, t)) * wr;
      return [E.x + u.x * t * Lf + b1.x * c + b2.x * d, E.y + u.y * t * Lf + b1.y * c + b2.y * d, E.z + u.z * t * Lf + b1.z * c + b2.z * d, j === 9 ? 0.7 : j === 5 || j === 6 ? 0.4 : 0.16 + 0.2 * Math.max(0, -Math.sin(t * 60 + s))]; }, true), 0.2, 1));
    // the wide sleeve: round at the elbow, then its underside hangs away from the arm; the mouth is cut slanting, the lower lip trailing back
    const n1 = dn.clone().addScaledVector(u, -dn.dot(u)).normalize(), n2 = new THREE.Vector3().crossVectors(u, n1), NU = 16, NV = 11, TM = 0.6, p1 = r() * TAU;
    const outer = grid(NU, NV, (uu, v, i, j) => { const a = uu * TAU, ca = Math.cos(a), low = Math.pow((1 + ca) / 2, 1.5), tq = j / NV, t = lerp(0.0, TM, tq) - 0.1 * sstep(0.3, 1, tq) * low;
      const fold = 1 + 0.07 * sstep(0.2, 1, tq) * Math.cos(a * 3 + p1), r0 = lerp(0.043, 0.057, sstep(0, 0.45, tq)) * fold + (j === NV ? 0.004 : 0), droop = 0.05 * Math.pow(sstep(0.1, 1, tq), 1.3) * low;
      P.copy(E).addScaledVector(u, t * Lf).addScaledVector(n1, ca * r0).addScaledVector(n2, Math.sin(a) * r0).addScaledVector(dn, droop);
      return [P.x, P.y, P.z, 0.14 + 0.35 * sstep(0.2, 1, tq) * Math.max(0, -Math.cos(a * 3 + p1)) + 0.25 * low * sstep(0.5, 1, tq)]; }, true);
    const OP = outer.attributes.position, ON = outer.attributes.normal; let flip = 1;
    { const kk = 3 * NU; if ((OP.getX(kk) - (E.x + u.x * 0.1)) * ON.getX(kk) + (OP.getY(kk) - (E.y + u.y * 0.1)) * ON.getY(kk) + (OP.getZ(kk) - (E.z + u.z * 0.1)) * ON.getZ(kk) < 0) flip = -1; }
    const J0 = NV - 5, TH = 0.011, ip = [], ii = [], bp = [], bi = [];
    for (let j = J0; j <= NV; j++) for (let i = 0; i < NU; i++) { const kk = j * NU + i; ip.push(OP.getX(kk) - ON.getX(kk) * TH * flip, OP.getY(kk) - ON.getY(kk) * TH * flip, OP.getZ(kk) - ON.getZ(kk) * TH * flip); }
    for (let j = 0; j < NV - J0; j++) for (let i = 0; i < NU; i++) { const a = j * NU + i, b = j * NU + (i + 1) % NU, c = a + NU, d = b + NU; ii.push(a, c, b, b, c, d); }
    for (let i = 0; i <= NU; i++) { const kk = NV * NU + (i % NU), m = ((NV - J0) * NU + (i % NU)) * 3; bp.push(OP.getX(kk), OP.getY(kk), OP.getZ(kk), ip[m], ip[m + 1], ip[m + 2]); if (i) { const a = (i - 1) * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const inner = new THREE.BufferGeometry(); inner.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3)); inner.setIndex(ii); inner.computeVertexNormals();
    const lip = new THREE.BufferGeometry(); lip.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); lip.setIndex(bi); lip.computeVertexNormals();
    parts.push(fin(outer, 0.15, 1), fin(inner, 0.72, 1), fin(lip, 0.25, 1));
  }
  return parts;
}

// ---------------------------------------------------------------- veil and crown
// The veil: a cloth laid over the head. Over the crown it lies on a cushion of hair; from the temples it hangs
// free, slanting out to rest on the shoulders, fluted with folds, its front edges standing off the cheeks. It has
// thickness: an inner face, and a band round the whole edge.
function carveVeil(r, cv, sdf) {
  const Cb = V3(0, 1.662, 0.05), RX = 0.1, RY = 0.128, RM = 0.115, D0 = 1.45 * RM, HREF = 0.3, NU = 44, TH = 0.0095;
  const DOME = [0, 0.13, 0.26, 0.39, 0.52, 0.65, 0.74, 0.8, 0.806, 0.822, 0.85, 0.89, 0.94, 1], JZ = 7, JD = DOME.length - 1, NV = JD + 18, ZC = D0 * DOME[JZ];   // rings over the skull; the selvedge crosses the brow at ring JZ
  const ringD = (j) => (j <= JD ? DOME[j] * D0 : D0 + ((j - JD) / (NV - JD)) * HREF), edgeAz = (j) => { const dr = ringD(j); return j > JZ ? Math.min(Math.acos(ZC / dr), 0.9 + 0.12 * sstep(D0, D0 + HREF, dr)) : 0; };
  const C = Cb.clone().applyMatrix4(cv.headM), p1 = r() * TAU, p2 = r() * TAU, q = new THREE.Vector3(), o = new THREE.Vector3();
  const f = (u, v, i, j) => {
    const dr = ringD(j), azE = edgeAz(j), az = azE + u * (TAU - 2 * azE), sa = Math.sin(az), ca = Math.cos(az);   // the ring's distance over the cloth from the crown; the front edge is a straight selvedge across the brow
    const phi = Math.min(dr, D0) / RM, rz = lerp(0.116, 0.107, (ca + 1) / 2);
    q.set(sa * Math.sin(phi) * RX, Math.cos(phi) * RY, ca * Math.sin(phi) * rz).add(Cb).applyMatrix4(cv.headM);
    let cav = 0.1;
    if (j > JD) {
      const t = (j - JD) / (NV - JD), hang = 0.3 + 0.14 * sstep(-0.2, -1, ca), len = t * hang;
      o.set(q.x - C.x, 0, q.z - C.z).normalize();
      const F = Math.cos(az * 6 + p1) * 0.65 + Math.cos(az * 11 + p2) * 0.35, fl = Math.sign(F) * Math.pow(Math.abs(F), 0.6), e = Math.min(i, NU - i);
      // it falls straight past the temples, then swells out to the shoulders; the folds deepen toward the hem; the front edges curl out
      const off = (0.012 + 0.075 * sa * sa + 0.05 * sstep(-0.3, -1, ca)) * Math.pow(t, 2.1) + (0.005 + 0.024 * sstep(0, 0.8, t)) * fl * sstep(0, 0.07, len) + (0.02 + 0.008 * Math.sin(len * 52 + p1)) * Math.exp(-(e * e) / 6) * sstep(0, 0.1, len) * (1 - 0.6 * sstep(0.7, 1, t));
      q.addScaledVector(o, off); q.y -= len * (1 - 0.1 * sa * sa * t);
      for (let it = 0; it < 8; it++) { const d = sdf(q.x, q.y, q.z); if (d > 0.032) break; q.addScaledVector(o, (0.033 - d) * 1.15 + 0.001); }   // it rests on the shoulders, spreading over the mantle
      cav = 0.12 + 0.5 * Math.max(0, -fl) * sstep(0.02, 0.12, len);
    }
    return [q.x, q.y, q.z, cav];
  };
  const outer = grid(NU, NV, f), OP = outer.attributes.position, ON = outer.attributes.normal, cols = NU + 1;
  // which way is out: away from the head's centre
  let flip = 1; { const k = (NV - 2) * cols + (NU >> 1); if ((OP.getX(k) - C.x) * ON.getX(k) + (OP.getZ(k) - C.z) * ON.getZ(k) < 0) flip = -1; }
  // the inner face (only where it hangs free) and the band round the edge
  const J0 = JZ, rows = NV - J0 + 1, ip = new Float32Array(rows * cols * 3), ic = new Float32Array(rows * cols).fill(0.6), ii = [];
  for (let j = J0; j <= NV; j++) for (let i = 0; i < cols; i++) { const k = j * cols + i, m = ((j - J0) * cols + i) * 3; ip[m] = OP.getX(k) - ON.getX(k) * TH * flip; ip[m + 1] = OP.getY(k) - ON.getY(k) * TH * flip; ip[m + 2] = OP.getZ(k) - ON.getZ(k) * TH * flip; }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < NU; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; ii.push(a, c, b, b, c, d); }
  const inner = new THREE.BufferGeometry(); inner.setAttribute('position', new THREE.BufferAttribute(ip, 3)); inner.setAttribute('cavity', new THREE.BufferAttribute(ic, 1)); inner.setIndex(ii); inner.computeVertexNormals();
  const edge = []; for (let j = J0; j <= NV; j++) edge.push([0, j]); for (let i = 1; i <= NU; i++) edge.push([i, NV]); for (let j = NV - 1; j >= J0; j--) edge.push([NU, j]);
  const bp = [], bi = [];
  edge.forEach(([i, j], n) => { const k = j * cols + i, m = ((j - J0) * cols + i) * 3; bp.push(OP.getX(k), OP.getY(k), OP.getZ(k), ip[m], ip[m + 1], ip[m + 2]); if (n) { const a = (n - 1) * 2; bi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
  const band = new THREE.BufferGeometry(); band.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); band.setIndex(bi); band.computeVertexNormals();
  // under its edge, the linen band that frames her face: from the veil's inner edge in to the brow, temples and
  // cheeks (it runs on into the head, so no gap shows and the ears are covered), ending at the jaw
  const iv = new THREE.Matrix4().copy(cv.headM).invert(), fp = [], fc = [], fi = [], A = new THREE.Vector3(), B = new THREE.Vector3(), Ab = new THREE.Vector3(); let nrow = 0;
  const row = (i, j) => { const m = ((j - J0) * cols + i) * 3, sg = i ? -1 : 1; A.set(ip[m], ip[m + 1], ip[m + 2]); Ab.copy(A).applyMatrix4(iv);
    if (j <= JD) { const az = sg * edgeAz(j), ph = ringD(j) / RM + 0.2 * Math.cos(az) ** 2; B.set(Math.sin(az) * Math.sin(ph) * 0.092, Math.cos(ph) * 0.105, Math.cos(az) * Math.sin(ph) * 0.068).add(Cb); }
    else { const t = sstep(1.675, 1.6, Ab.y); B.set(sg * lerp(0.055, 0.046, t), Ab.y - 0.004, lerp(0.104, 0.09, t)); B.lerp(Ab, sstep(1.615, 1.585, Ab.y)); }
    B.applyMatrix4(cv.headM);
    for (let k = 0; k <= 2; k++) { fp.push(lerp(A.x, B.x, k / 2), lerp(A.y, B.y, k / 2), lerp(A.z, B.z, k / 2)); fc.push(0.22 + 0.2 * k + 0.5 * sstep(1.64, 1.59, Ab.y)); }
    if (nrow++) { const a = (nrow - 2) * 3; for (let k = 0; k < 2; k++) fi.push(a + k, a + k + 3, a + k + 1, a + k + 1, a + k + 3, a + k + 4); }
    return Ab.y; };
  let JE = JD + 1; while (JE < NV - 1) { const m = ((JE - J0) * cols) * 3; if (Ab.set(ip[m], ip[m + 1], ip[m + 2]).applyMatrix4(iv).y < 1.585) break; JE++; }
  for (let j = JE; j >= JZ; j--) row(0, j); for (let j = JZ + 1; j <= JE; j++) row(NU, j);
  const fillet = new THREE.BufferGeometry(); fillet.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fillet.setAttribute('cavity', new THREE.Float32BufferAttribute(fc, 1)); fillet.setIndex(fi); fillet.computeVertexNormals();
  return [fin(outer, 0.1, 1), fin(inner, 0.6, 1), fin(band, 0.3, 1), fin(fillet, 0.3, 1)];
}
// a low crown, worn: a turned band with a roll at each rim, and fleurons standing from it (tall lilies between small
// trefoils), thinning to their tips; some snapped off at the stalk long ago
function carveCrown(r, cv) {
  const parts = [], R = 0.083, y0 = 1.738;
  parts.push(fin(new THREE.LatheGeometry([[R - 0.005, 0.001], [R + 0.002, -0.001], [R + 0.006, 0.003], [R + 0.006, 0.007], [R + 0.002, 0.01], [R + 0.0015, 0.02], [R + 0.006, 0.023], [R + 0.006, 0.028], [R + 0.002, 0.032], [R - 0.005, 0.031]].map(([a, b]) => new THREE.Vector2(a, b)), 32), 0.25, 1));
  const fleuron = (half, H) => { const pts = half.concat(half.slice(0, -1).reverse().map(([x, y]) => [-x, y])), g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.009, bevelEnabled: false });
    g.translate(0, 0, -0.0045); g.deleteAttribute('uv'); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * (1 - 0.55 * p.getY(i) / H)); return g; };
  const LILY = fleuron([[0.0075, 0], [0.0065, 0.01], [0.0105, 0.0125], [0.0105, 0.0165], [0.0065, 0.019], [0.014, 0.019], [0.021, 0.0215], [0.0255, 0.027], [0.0265, 0.0325], [0.0235, 0.0365], [0.0185, 0.0355], [0.013, 0.0325], [0.009, 0.032], [0.0105, 0.039], [0.0115, 0.046], [0.0085, 0.053], [0.004, 0.0585], [0, 0.0615]], 0.0615);
  const TREF = fleuron([[0.0045, 0], [0.004, 0.007], [0.009, 0.008], [0.012, 0.013], [0.0105, 0.018], [0.006, 0.019], [0.0045, 0.017], [0.006, 0.023], [0.0035, 0.029], [0, 0.032]], 0.032);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU, big = i % 2 === 0, gone = i !== 0 && r() < (big ? 0.25 : 0.3); if (gone && !big) continue;
    const g = (big ? LILY : TREF).clone(), p = g.attributes.position;
    if (gone) { const c0 = 0.014 + r() * 0.008, sl = (r() - 0.5) * 0.9; for (let k = 0; k < p.count; k++) { const x = clamp(p.getX(k), -0.0078, 0.0078), c = c0 + sl * x + 0.25 * p.getZ(k); p.setX(k, x); if (p.getY(k) > c) p.setY(k, c); } }   // snapped: only the stalk stands
    g.computeVertexNormals(); parts.push(fin(at(g, [Math.sin(a) * R, 0.029, Math.cos(a) * R], [-0.14, a, (r() - 0.5) * 0.06], 0.94 + r() * 0.1), 0.22, 1));
  }
  const m = new THREE.Matrix4().multiplyMatrices(cv.headM, xf([0, y0, 0.052], [-0.06, 0, 0]));
  for (const p of parts) p.applyMatrix4(m);
  return parts;
}

// the whole figure, in her own frame (feet at y = 0, facing +z, about 1.8 m; scaled when she is set on the pedestal)
function buildFigure(seed) {
  const hb = humanBody({}, 'lady'); if (!hb) return null;
  const r = rng(seed), cv = carve(hb); hb.mesh.material?.dispose?.();
  const body = carveBody(r);
  const parts = [fin(cv.geo, 0.1, 1), ...carvedEyes(cv).map((g) => fin(g, 0.2, 1)), ...body.parts.map((g) => fin(g, 0.15, 1)), ...carveSleeves(r, cv), ...carveVeil(r, cv, body.sdf), ...carveCrown(r, cv)];
  const out = { geo: mergeGeometries(parts), head: V3(0, 1.66, 0.09).applyMatrix4(cv.headM) };
  for (const p of parts) p.dispose();
  return out;
}

// ---------------------------------------------------------------- the shrine
const ST1 = 0.14, ST2 = 0.28, PT = 0.8, CAP = 2.1, EAVE = 2.32, HW = 0.72, RISE = 1.03, PZ = 0.5, FIG_S = 0.8, FIG_YAW = 0.42, FIG_Z = 0.02;
const STONES = new Map(), VOTIVES = new Map();
function buildStone(seed) {
  if (STONES.has(seed)) return STONES.get(seed);
  const r = rng(seed ^ 0x5eed), S = [], fig = buildFigure(seed); if (!fig) return null;
  const add = (g, cav = 0.18, joint = 0) => { S.push(fin(g, cav, 0, joint)); return g; };
  // two steps of big slabs, cracked across and sunk at one end
  add(at(cbox(0.86, 0.56, 1.8, 0.02), [-0.67, ST1 - 0.28, 0.14], [0.006, 0, 0.012]));
  add(at(cbox(0.7, 0.56, 1.8, 0.02), [0.115, ST1 - 0.285, 0.14], [-0.008, 0.004, -0.006]));
  add(at(cbox(0.62, 0.56, 1.78, 0.02), [0.785, ST1 - 0.33, 0.15], [0.02, -0.012, -0.055]));
  add(at(cbox(1.0, 0.2, 1.36, 0.018), [-0.36, ST2 - 0.1, 0], [0, 0, 0.004]));
  add(at(cbox(0.71, 0.2, 1.36, 0.018), [0.505, ST2 - 0.104, 0.004], [0.004, -0.006, -0.012]));
  // the pedestal: base course, die, cornice
  add(at(mould([[0.075, ST2 - 0.02], [0.075, 0.345], [0.062, 0.36], [0.05, 0.375], [0.022, 0.398], [0.004, 0.41], [0, 0.413], [0, 0.66], [0.01, 0.664], [0.016, 0.685], [0.04, 0.715], [0.07, 0.73], [0.078, 0.735], [0.08, 0.782], [0.068, PT]], 0.3, 0.26), [0, 0, FIG_Z]), 0.16);
  // the back wall, and the pointed niche cut in its face
  const gable = (hw, y0, ye, rise) => [[-hw, y0], [hw, y0], [hw, ye], [0, ye + rise], [-hw, ye]];
  add(at(plate(gable(HW, ST2 - 0.02, EAVE, RISE), 0.1), [0, 0, -0.58]), 0.3, 1);
  { const o = [[-HW, ST2 - 0.02], [-0.5, ST2 - 0.02]], aw = 0.5, sp = CAP - 0.35, top = CAP + 0.42;
    for (let i = 0; i <= 12; i++) { const t = i / 12; o.push([-aw * Math.cos(t * PI / 2) ** 0.8, sp + (top - sp) * Math.sin(t * PI / 2)]); }
    for (let i = 11; i >= 0; i--) { const t = i / 12; o.push([aw * Math.cos(t * PI / 2) ** 0.8, sp + (top - sp) * Math.sin(t * PI / 2)]); }
    o.push([0.5, ST2 - 0.02], [HW, ST2 - 0.02], [HW, EAVE], [0, EAVE + RISE], [-HW, EAVE]);
    add(at(plate(o, 0.09, [], 0.014), [0, 0, -0.485]), 0.2, 1); }
  // two slender piers: moulded foot, chamfered shaft, capital
  for (const s of [-1, 1]) {
    add(at(mould([[0.04, ST2 - 0.02], [0.04, 0.36], [0.022, 0.385], [0.012, 0.4], [0, 0.415]], 0.075, 0.075, false), [s * 0.6, 0, PZ]));
    add(at(cbox(0.15, CAP - 0.5, 0.15, 0.04), [s * 0.6, (CAP + 0.25) / 2, PZ]));
    add(at(mould([[-0.012, -0.13], [0.006, -0.12], [0.008, -0.104], [-0.004, -0.1], [0.012, -0.065], [0.04, -0.038], [0.048, -0.032], [0.048, 0]].map(([o, y]) => [o, CAP + y]), 0.075, 0.075), [s * 0.6, 0, PZ]));
  }
  // the front gable: a cusped ogee arch cut through it, a quatrefoil above
  { const o = [], jx = 0.525, sy = CAP + 0.05, half = [[jx, CAP]];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * 118 * D2R; half.push([jx - 0.17 + 0.17 * Math.cos(a), sy + 0.17 * Math.sin(a)]); }
    { const p0 = half[half.length - 1], c1 = [0.47, sy + 0.25], c2 = [0.1, sy + 0.44], p3 = [0, sy + 0.66];
      for (let i = 1; i <= 12; i++) { const t = i / 12, m = 1 - t; half.push([m * m * m * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p3[1]]); } }
    o.push([-HW, CAP], [-HW, EAVE + 0.03], [0, EAVE + RISE + 0.09], [HW, EAVE + 0.03], [HW, CAP]);
    for (const p of half) o.push(p); for (let i = half.length - 2; i >= 0; i--) o.push([-half[i][0], half[i][1]]);
    const q = []; for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU; const rr = 0.045 + 0.05 * Math.pow(Math.abs(Math.cos(a * 2)), 0.7); q.push([Math.sin(a) * rr, EAVE + RISE - 0.36 + Math.cos(a) * rr]); }
    add(at(plate(o.reverse(), 0.15, [q], 0.016), [0, 0, PZ - 0.075]), 0.22);
    // a roll moulding round the arch
    const roll = half.slice(1).map(([x, y]) => V3(x + 0.012, y + 0.008, PZ + 0.07)); for (let i = half.length - 2; i >= 1; i--) roll.push(V3(-half[i][0] - 0.012, half[i][1] + 0.008, PZ + 0.07));
    add(tube(roll, () => 0.02, 6, 0.3, 44), 0.3); }
  // side beams from pier to wall, each cut to a low arch
  for (const s of [-1, 1]) { const o = [[-0.4, CAP], [-0.4, EAVE], [0.425, EAVE], [0.425, CAP], [0.36, CAP]]; for (let i = 1; i < 10; i++) { const t = i / 10; o.push([lerp(0.36, -0.33, t), CAP + 0.15 * Math.pow(Math.sin(t * PI), 0.6)]); } o.push([-0.33, CAP]);
    const g = plate(o.map(([z, y]) => [-z, y]), 0.14, [], 0.012); g.rotateY(PI / 2); add(at(g, [s * 0.6 - 0.07, 0, 0]), 0.3); }
  // the roof: stone slabs in lapped courses, a roll along the ridge
  { const ang = Math.atan2(RISE, HW + 0.04), L = Math.hypot(RISE, HW + 0.04);
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) { const t = (k + 0.5) / 5, x = s * (HW + 0.04) * (1 - t), y = EAVE - 0.02 + RISE * t;
      add(at(cbox(L / 5 + 0.05, 0.05, 1.05, 0.008), [x + s * Math.sin(ang) * 0.03, y + Math.cos(ang) * 0.03, -0.085], [0, 0, -s * (ang - 0.07)]), 0.2); }
    const rd = new THREE.CylinderGeometry(0.045, 0.045, 1.08, 8, 1); rd.rotateX(PI / 2); rd.deleteAttribute('uv'); add(at(rd, [0, EAVE + RISE + 0.03, -0.085]), 0.2); }
  // crockets up the gable, a finial on its point
  const hook = (p, n, d, sc = 1) => tube([[-0.02, -0.035], [0.025, -0.02], [0.066, 0.008], [0.088, 0.052], [0.072, 0.092], [0.04, 0.094], [0.03, 0.07]].map(([a, b]) => V3(p.x + (n.x * a + d.x * b) * sc, p.y + (n.y * a + d.y * b) * sc, p.z + (n.z * a + d.z * b) * sc)), (t) => sc * (0.026 + 0.01 * sstep(0.2, 0.6, t) - 0.02 * sstep(0.7, 1, t)), 6, (u, v) => 0.2 + 0.5 * sstep(0.75, 1, v), 12, 1.25);
  { const d = V3(-HW, RISE + 0.06, 0).normalize(), n = V3(RISE + 0.06, HW, 0).normalize();
    for (const s of [-1, 1]) for (const t of [0.17, 0.38, 0.59, 0.8]) add(hook(V3(s * HW * (1 - t), EAVE + 0.03 + (RISE + 0.06) * t, PZ), V3(s * n.x, n.y, 0), V3(s * d.x, d.y, 0)), 0.3);
    const fy = EAVE + RISE + 0.07;
    add(at(prism([[0.034, 0], [0.03, 0.1], [0.045, 0.11], [0.045, 0.125], [0.028, 0.135], [0.026, 0.25], [0.04, 0.262], [0.04, 0.275], [0.02, 0.285], [0.03, 0.32], [0.036, 0.35], [0.026, 0.385], [0, 0.4]], 8), [0, fy, PZ]), 0.25);
    for (let k = 0; k < 4; k++) { const a = k * PI / 2 + PI / 4; add(hook(V3(Math.sin(a) * 0.02, fy + 0.15, PZ + Math.cos(a) * 0.02), V3(Math.sin(a), 0, Math.cos(a)), V3(0, 1, 0), 0.9), 0.3); } }
  // pinnacles on the piers; her right-hand one has fallen and lies broken below
  const spire = () => { const g = new THREE.ConeGeometry(0.1, 0.44, 4, 1).toNonIndexed(); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.rotateY(PI / 4); g.translate(0, 0.22, 0); g.computeVertexNormals(); return g; };
  add(at(cbox(0.14, 0.26, 0.14, 0.014), [-0.655, EAVE + 0.1, PZ]), 0.2); add(at(mould([[0, 0], [0.018, 0.012], [0.018, 0.03], [0, 0.04]], 0.07, 0.07), [-0.655, EAVE + 0.22, PZ]), 0.2);
  add(at(spire(), [-0.655, EAVE + 0.26, PZ]), 0.2); add(at(prism([[0, 0], [0.028, 0.012], [0.03, 0.03], [0.018, 0.05], [0, 0.056]], 6), [-0.655, EAVE + 0.67, PZ]), 0.2);
  add(at(cbox(0.14, 0.15, 0.14, 0.014), [0.655, EAVE + 0.045, PZ], [0.03, 0.1, -0.04]), 0.2); add(at(new THREE.DodecahedronGeometry(0.075, 0), [0.66, EAVE + 0.12, PZ], [0.5, 0.3, 0.2], [1, 0.5, 1]), 0.3);
  add(at(spire(), [1.02, 0.07, 0.86], [1.42, 0.7, 0.2]), 0.25); add(at(cbox(0.14, 0.12, 0.14, 0.014), [1.2, 0.03, 0.52], [0.3, 0.5, 0.9]), 0.25);
  for (const [x, y, z, s, sy] of [[-1.0, 0.03, 0.95, 0.1, 0.6], [-0.78, ST1 + 0.03, 0.82, 0.06, 0.7], [0.42, ST2 + 0.025, 0.56, 0.045, 0.6], [0.95, 0.02, 1.02, 0.07, 0.6], [-1.22, 0.02, 0.3, 0.12, 0.5]]) { const g = new THREE.DodecahedronGeometry(s, 0); g.deleteAttribute('uv'); add(at(g, [x, y, z], [r() * 3, r() * 3, r() * 3], [1, sy, 1.2]), 0.25); }
  // her figure on the pedestal, turned on it to face the mountain, as Raoul found her
  const fg = fig.geo.clone().applyMatrix4(xf([0, PT + 0.07 * FIG_S, FIG_Z], [0, FIG_YAW, 0], FIG_S)); S.push(fg);
  const geo = mergeGeometries(S); for (const p of S) p.dispose();
  const out = { geo, head: fig.head.clone().applyMatrix4(xf([0, PT + 0.07 * FIG_S, FIG_Z], [0, FIG_YAW, 0], FIG_S)) };
  STONES.set(seed, out); return out;
}
// what was left for her: candles, a rosary, coins, dead flowers, a little wooden cross
function buildVotives(seed) {
  if (VOTIVES.has(seed)) return VOTIVES.get(seed);
  const r = rng(seed ^ 0xa11ce), C = [], K = [], F = [], lit = [];
  const tint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const plain = (g) => { if (!g.index) { const n = g.attributes.position.count, a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new THREE.BufferAttribute(a, 1)); }
    if (!g.attributes.normal) g.computeVertexNormals(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k); return g; };
  for (const [x, y, z, h, on] of [[-0.3, PT, 0.29, 0.11, 1], [0.31, PT, 0.28, 0.06, 1], [0.24, PT, 0.31, 0.03, 0], [-0.44, ST2, 0.5, 0.13, 0], [-0.35, ST2, 0.58, 0.07, 0], [-0.5, ST2, 0.6, 0.045, 0], [0.3, ST2, 0.57, 0.09, 0], [0.2, ST2, 0.62, 0.04, 0]]) {
    const rr = 0.017 + r() * 0.011, pr = [[0, 0], [rr * 2.1, 0], [rr * 1.6, 0.005], [rr * 1.15, 0.012], [rr, 0.02], [rr * 1.02, h * 0.6], [rr * 0.98, h], [rr * 0.6, h + 0.004], [0.002, h + 0.001]];
    const lg = new THREE.LatheGeometry(pr.map(([a, b]) => new THREE.Vector2(a, b)), 12), lp = lg.attributes.position, lean = (r() - 0.5) * 0.1;
    for (let i = 0; i < lp.count; i++) { const yy = lp.getY(i), ang = Math.atan2(lp.getZ(i), lp.getX(i)), drip = Math.max(0, Math.sin(ang * 3 + x * 9)) * 0.005 * (1 - yy / h) * (yy > 0.012 ? 1 : 0); lp.setX(i, lp.getX(i) * (1 + drip / rr) + yy * lean); lp.setZ(i, lp.getZ(i) * (1 + drip / rr)); }
    lg.computeVertexNormals(); C.push(plain(at(lg, [x, y, z])));
    K.push(tint(plain(at(new THREE.CylinderGeometry(0.0016, 0.0016, 0.014, 4), [x + h * lean, y + h + 0.006, z])), 0x0c0b0a));
    if (on) { F.push(plain(at(new THREE.SphereGeometry(0.008, 8, 6), [x + h * lean, y + h + 0.024, z], [0, 0, 0], [0.75, 2.4, 0.75]))); lit.push(V3(x + h * lean, y + h + 0.03, z)); }
  }
  // a rosary hung over the pedestal's cornice: beads on a cord, a little cross at the end
  { const pts = []; for (let i = 0; i <= 30; i++) { const a = -0.9 + (i / 30) * 1.8; pts.push(V3(Math.sin(a) * 0.33, PT - 0.03 - Math.pow(Math.cos(a * 1.7), 2) * 0.05, FIG_Z + 0.345 + Math.cos(a) * 0.006)); }
    const rc = new THREE.CatmullRomCurve3(pts), p = new THREE.Vector3(), tl = rc.getPointAt(0.5);
    for (let i = 0; i <= 40; i++) { rc.getPointAt(i / 40, p); K.push(tint(plain(at(new THREE.SphereGeometry(i % 10 === 0 ? 0.0085 : 0.0058, 6, 4), [p.x, p.y, p.z])), 0x23160f)); }
    for (let i = 1; i <= 3; i++) K.push(tint(plain(at(new THREE.SphereGeometry(0.0058, 6, 4), [tl.x, tl.y - i * 0.014, tl.z + 0.002])), 0x23160f));
    K.push(tint(plain(at(new THREE.BoxGeometry(0.007, 0.04, 0.004), [tl.x, tl.y - 0.072, tl.z + 0.003])), 0x1c120c), tint(plain(at(new THREE.BoxGeometry(0.024, 0.007, 0.004), [tl.x, tl.y - 0.063, tl.z + 0.003])), 0x1c120c)); }
  // coins, green with age
  for (let i = 0; i < 11; i++) { const hi = i < 5; K.push(tint(plain(at(new THREE.CylinderGeometry(0.012, 0.012, 0.0022, 10), hi ? [(r() - 0.5) * 0.5, PT + 0.002, FIG_Z + 0.26 + r() * 0.06] : [(r() - 0.5) * 0.5, ST2 + 0.002, 0.42 + r() * 0.22], [r() * 0.12, 0, r() * 0.12])), i % 3 ? 0x4c5038 : 0x5a5446)); }
  // dead flowers, tied in bunches; a rotted ribbon
  const bunch = (bx, by, bz, yaw, n) => { for (let i = 0; i < n; i++) { const a = yaw + (r() - 0.5) * 0.4, L = 0.22 + r() * 0.12, p0 = V3(bx, by + 0.006, bz), p2 = V3(bx + Math.sin(a) * L, by + 0.012, bz + Math.cos(a) * L), p1 = p0.clone().lerp(p2, 0.6).add(V3(0, 0.02 + r() * 0.04, 0));
    K.push(tint(plain(tube([p0, p1, p2], () => 0.0022, 4, 0, 4)), 0x2c2a18));
    for (let k = 0; k < 5; k++) K.push(tint(plain(at(new THREE.SphereGeometry(0.014, 5, 3), [p2.x + (r() - 0.5) * 0.03, p2.y + 0.004 + r() * 0.01, p2.z + (r() - 0.5) * 0.03], [r() * 3, r() * 3, 0], [1, 0.25, 0.7])), r() < 0.5 ? 0x3a261c : 0x2e2018)); } };
  bunch(-0.02, ST2, 0.5, -0.5, 7); bunch(-0.6, ST1, 0.82, 1.0, 4);
  K.push(tint(plain(tube([V3(-0.02, ST2 + 0.014, 0.5), V3(0, ST2 + 0.03, 0.54), V3(0.04, ST2 + 0.006, 0.58), V3(0.1, ST2 + 0.004, 0.64)], () => 0.006, 5, 0, 8, 0.25)), 0x2a1012));
  // a small cross of two sticks, leaning on the pedestal
  K.push(tint(plain(at(new THREE.BoxGeometry(0.024, 0.36, 0.02), [0.4, ST2 + 0.17, FIG_Z + 0.37], [-0.28, 0.25, 0.07])), 0x2a1e14), tint(plain(at(new THREE.BoxGeometry(0.16, 0.022, 0.02), [0.4 + 0.006, ST2 + 0.25, FIG_Z + 0.345], [-0.28, 0.25, 0.07])), 0x2a1e14));
  const out = { wax: mergeGeometries(C), dark: mergeGeometries(K), flames: mergeGeometries(F), lit };
  VOTIVES.set(seed, out); return out;
}

let WAX = null, DARK = null, FLAME = null;
export function buildLadyShrine(seed = 7) {
  const st = buildStone(seed); if (!st) return null;
  const g = new THREE.Group(), sh = new THREE.Group(); g.add(sh); sh.rotation.set(-0.012, 0, 0.016);   // the whole shrine has settled, leaning
  const stone = stoneMaterial(), mesh = new THREE.Mesh(st.geo, stone); mesh.castShadow = true; mesh.receiveShadow = true; sh.add(mesh);
  // the inscription on the pedestal's face
  { const z = FIG_Z + 0.2615, q = new THREE.BufferGeometry();
    q.setAttribute('position', new THREE.Float32BufferAttribute([-0.25, 0.538, z, 0.25, 0.538, z, 0.25, 0.648, z, -0.25, 0.648, z, -0.24, 0.42, z, 0.24, 0.42, z, 0.24, 0.534, z, -0.24, 0.534, z], 3));
    q.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0.5, 1, 0.5, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0.5, 0, 0.5], 2)); q.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    q.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); const d = new THREE.Mesh(q, inscriptionMaterial()); d.renderOrder = 1; sh.add(d); }
  const v = buildVotives(seed);
  WAX = WAX || new THREE.MeshStandardMaterial({ color: 0xb9ad8c, roughness: 0.6, emissive: 0x2a1c08, emissiveIntensity: 0.16 });
  DARK = DARK || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const flame = FLAME = FLAME || new THREE.MeshBasicMaterial({ color: 0xffb860, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const wax = new THREE.Mesh(v.wax, WAX); wax.castShadow = true; sh.add(wax); sh.add(new THREE.Mesh(v.dark, DARK)); sh.add(new THREE.Mesh(v.flames, flame));
  stone.userData.U.uCandle.value = v.lit.slice(0, 2);
  // the flames flicker, and their light on the stone with them
  g.userData.update = (time) => { const f = 0.78 + Math.sin(time * 17) * 0.1 + Math.sin(time * 29.3) * 0.08 + Math.sin(time * 7.1) * 0.04; flame.opacity = f; stone.userData.U.uGlow.value = f * 1.15; };
  g.userData.pageAt = [0.3, ST1 + 0.02, 0.86];
  g.userData.info = { head: st.head.toArray(), yaw: FIG_YAW };   // where her face is (for a camera that wants to look at it)
  return g;
}
