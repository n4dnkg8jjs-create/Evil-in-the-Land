// The Old Serpent: his hide and his head.
//
// The hide is drawn in the shader, not painted into a texture: overlapping keeled scales laid in rows round the body,
// each one's free edge lying over the base of the ones behind it like slates on a roof; broad smooth plates (the
// ventral scutes) wrapping the flat of the belly; a chain of black, ash-edged diamonds down the spine and dark blotches
// low on the flanks; old pale scars. It follows the body's own UVs (u round it in scales, v along it in rows), so there
// is no tiling, no stretching and no seam, and it melts into its colours with distance instead of shimmering.
//
// The head is a viper's: broad and heavy over the venom glands, a flat crown with a sharp edge from brow to nostril,
// the eyes in shadow under the supraocular shelves, a heat pit between eye and nostril. The jaws gape as a viper's do:
// the skull lifts as the lower jaw drops, the two great fangs swing forward out of their sheaths, the skin of the
// cheeks stretches between the lips. Inside: a pale, wet palate with its two rows of small hooked teeth, a mouth floor
// with the tongue's sheath and the glottis standing on it, and at the back the throat, going down into the dark of
// the neck. The forked tongue slides out of its sheath and through the notch in the lips.
// Frame: +z forward along the snout, y up, the origin where the neck meets the skull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, TAU } from './util.js';

export const SCALE_COLS = 36;     // dorsal + ventral scales round the body (u runs 0..SCALE_COLS)
export const SCALE_ROWS_M = 4.6;  // rows of scales to a metre where the body is thickest
const HS = 0.085;                 // the small scales of the crown, metres
// where the neck goes into the head (the body's first rings are laid along this, in the head's frame)
export const NECK = { y: -0.17, z: -0.42, r: 0.52 };

// ---------------------------------------------------------------- the skin shader
const GLSL_COMMON = /* glsl */`
#define COLS ${SCALE_COLS.toFixed(1)}
#define VBW 0.13
#define HSZ ${HS}
uniform vec4 uEye;
float sm(float a, float b, float x) { float t = clamp((x - a) / (abs(b - a) < 1e-5 ? 1e-5 : b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float sh1(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sn2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sh1(i), sh1(i + vec2(1.0, 0.0)), f.x), mix(sh1(i + vec2(0.0, 1.0)), sh1(i + vec2(1.0, 1.0)), f.x), f.y); }
// One layer of overlapping keeled scales. p.x across (one scale to a unit), p.y along toward the tail (one row to a
// unit); rows offset by half a scale. A scale's free edge lies over the base of the row behind, so where two cover a
// point the one from the row ahead is on top. Returns the height; cid is the scale's centre, rim 0 at its edge.
float scl(vec2 p, float keel, out vec2 cid, out float rim) {
  float r0 = floor(p.y); cid = vec2(p.x, r0 + 0.5); rim = 0.0;
  float best = 0.0, qx = 0.0, qt = 0.0;
  for (int k = 0; k < 2; k++) {
    float r = r0 - 1.0 + float(k), off = mod(r, 2.0) * 0.5, s = p.y - r;
    if (s < 0.0 || s > 1.42) continue;
    float cc = floor(p.x - off + 0.5);
    for (int c = -1; c <= 1; c++) {
      float ci = cc + float(c), w = p.x - (ci + off);
      float hw = 0.6 * sqrt(max(0.0, 1.0 - pow((s - 0.5) / 0.94, 2.0)));
      float m = hw - abs(w);
      if (m > 0.0 && m / hw > best) { best = m / hw; cid = vec2(ci + off, r + 0.5); qx = w / max(hw, 1e-3); qt = s / 1.42; rim = sm(0.0, 0.13, m) * sm(0.0, 0.12, 1.42 - s); }
    }
    if (best > 0.0) break;
  }
  float kl = keel * pow(max(0.0, 1.0 - abs(qx) * 2.2), 2.0) * sm(0.12, 0.55, qt);
  return (0.16 + 0.8 * pow(qt, 0.75) + kl + 0.12 * (1.0 - qx * qx)) * (0.28 + 0.72 * rim);
}
#ifndef SERP_HEAD
// the body: the belly band in broad plates, the rest in keeled scales
float bodyH(vec2 p, out vec2 cid, out float rim, out float vent) {
  float b = (fract(p.x / COLS - 0.25) - 0.5) / VBW;
  if (abs(b) < 1.0) {
    vent = 1.0;
    float len = 1.06 + 0.12 * b * b, r = floor(p.y) - 1.0, s = p.y - r;
    if (s > len) { r += 1.0; s -= 1.0; }
    cid = vec2(0.75 * COLS + floor(b * 2.0), r + 0.5);
    rim = sm(0.0, 0.045, len - s) * sm(0.0, 0.06, 1.0 - abs(b));
    return (0.3 + 0.62 * pow(s / len, 0.55)) * (0.4 + 0.6 * rim) + 0.12 * (1.0 - b * b);
  }
  vent = 0.0;
  return scl(p, 0.2, cid, rim);
}
// the pattern, read at a scale's centre (u round the body 0..1 with the spine at 0.25, v in rows)
vec3 bodyPat(float u, float v) {
  float du = abs(fract(u - 0.25 + 0.5) - 0.5);              // 0 on the spine .. 0.5 on the belly
  float PD = 10.0, di = floor(v / PD + 0.5), jt = sh1(vec2(di, 3.7)), q = abs(v / PD - di) * 2.0;
  float dm = du / (0.085 + 0.02 * jt) + q * (0.95 + 0.1 * jt);  // < 1 inside the diamond on the spine
  vec3 c = mix(vec3(0.062, 0.055, 0.043), vec3(0.12, 0.112, 0.09), sm(0.1, 0.33, du));   // umber above, ash-olive low on the flanks
  c *= 0.8 + 0.4 * sn2(vec2(u * 11.0, v * 0.21));
  c = mix(c, vec3(0.25, 0.235, 0.195), sm(1.16, 1.04, dm) * sm(0.8, 0.92, dm));   // the ash edge of each diamond
  c = mix(c, vec3(0.016, 0.014, 0.012), sm(0.88, 0.78, dm));                            // the diamond, near black
  c = mix(c, vec3(0.04, 0.035, 0.028), sm(0.42, 0.12, dm) * 0.7);                       // its duller heart
  float lq = abs(fract(v / PD) - 0.5) * 2.0, bm = abs(du - 0.215) / 0.05 + (1.0 - lq) / 0.42;    // blotches on the flanks, between the diamonds
  c = mix(c, vec3(0.022, 0.02, 0.017), sm(1.0, 0.8, bm));
  float bel = sm(0.34, 0.4, du);                                                          // the belly: dirty bone, flecked dark at the ends of the plates
  vec3 bc = vec3(0.2, 0.19, 0.165) * (0.85 + 0.3 * sn2(vec2(u * 30.0, v * 0.9)));
  bc = mix(bc, vec3(0.05, 0.045, 0.04), sm(0.43, 0.39, du) * sm(0.45, 0.7, sn2(vec2(u * 40.0, v * 1.3))));
  c = mix(c, bc, bel);
  return c;
}
// old wounds: ragged pale weals across the scales, a few to every forty rows
float bodyScar(vec2 p) {
  float m = 0.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = 0; j < 2; j++) {
      float b = floor(p.y / 40.0) + float(k), sd = float(j) * 17.3;
      if (sh1(vec2(b, 9.1 + sd)) < 0.4) continue;
      vec2 c0 = vec2(COLS * (0.02 + 0.46 * sh1(vec2(b, 1.3 + sd))), (b + 0.15 + 0.7 * sh1(vec2(b, 2.9 + sd))) * 40.0);
      float a = (sh1(vec2(b, 4.4 + sd)) - 0.5) * 2.2, len = 3.0 + 7.0 * sh1(vec2(b, 5.5 + sd));
      vec2 dir = vec2(cos(a), sin(a)), d = p - c0; d.x -= COLS * floor(d.x / COLS + 0.5);
      float t = clamp(dot(d, dir), -len, len), dist = length(d - dir * t);
      float wid = max(0.01, (0.2 + 0.3 * sh1(vec2(b, 6.6 + sd))) * (1.0 - pow(abs(t) / len, 2.0)) * (0.65 + 0.7 * sn2(p * 2.3)));
      m = max(m, sm(wid, wid * 0.35, dist));
    }
  }
  return m;
}
#else
// the head. p: x the distance from the lip round the head (scales), negative on the lower jaw; y forward (scales)
float headH(vec2 p, out vec2 cid, out float rim, out float kind) {
  bool jaw = p.x < 0.0; float a = abs(p.x) * HSZ, z = p.y * HSZ; kind = 0.0;
  float lab = jaw ? 0.15 : 0.2;
  if (a < lab && z > -0.3) {   // the labials: a row of tall plates along each lip
    float pw = jaw ? 0.17 : 0.205, f = z / pw, i = floor(f), fx = f - i, fy = a / lab;
    cid = vec2(i, jaw ? -50.0 : 50.0); kind = 1.0;
    rim = sm(0.0, 0.08, fx) * sm(0.0, 0.08, 1.0 - fx) * sm(0.0, 0.12, 1.0 - fy) * sm(0.0, 0.05, fy);
    return (0.5 + 0.3 * sin(3.14159 * fx) + 0.15 * fy) * (0.35 + 0.65 * rim);
  }
  if (!jaw) {
    vec2 so = vec2((a - uEye.z) / 0.19, (z - uEye.w) / 0.34);
    float sd = dot(so, so);
    if (sd < 1.0) {   // the supraocular: one great plate over each eye, its edge ragged
      kind = 2.0; cid = vec2(0.0, 80.0); rim = sm(0.0, 0.25, 1.0 - sd);
      return (0.75 + 0.25 * (1.0 - sd) + 0.05 * sn2(vec2(a, z) * 30.0)) * (0.35 + 0.65 * rim);
    }
    if (z > 2.12) {   // the snout: larger plates, the internasals and the rostral
      kind = 3.0; return scl(vec2(a / 0.15, -z / 0.15), 0.0, cid, rim);
    }
    return scl(vec2(a / HSZ, -z / HSZ), 0.22, cid, rim);
  }
  if (z > 1.0 && a < 0.62) {   // the chin shields, long either side of the groove
    kind = 4.0; return scl(vec2(a / 0.2, -z / 0.32), 0.0, cid, rim);
  }
  return scl(vec2(a / 0.1, -z / 0.1), 0.0, cid, rim);   // small smooth scales under the throat
}
vec3 headPat(float a, float z, bool jaw) {
  if (jaw) {
    vec3 c = mix(vec3(0.06, 0.054, 0.044), vec3(0.2, 0.188, 0.162), sm(0.12, 0.4, a));
    return c * (0.78 + 0.44 * sn2(vec2(a, z) * 7.0));
  }
  vec3 c = vec3(0.062, 0.055, 0.043) * (0.8 + 0.4 * sn2(vec2(a, z) * 3.0));
  // a dark stripe from the eye back to the angle of the jaw, edged pale above
  vec2 e0 = vec2(uEye.x, uEye.y), e1 = vec2(0.1, -0.42), d = vec2(a, z) - e0, ab = e1 - e0;
  float t = clamp(dot(d, ab) / dot(ab, ab), 0.0, 1.0), dl = length(d - ab * t), side = d.x * ab.y - d.y * ab.x;
  c = mix(c, vec3(0.22, 0.205, 0.17), sm(0.2, 0.15, dl) * sm(0.09, 0.13, dl) * step(side, 0.0));
  c = mix(c, vec3(0.015, 0.013, 0.011), sm(0.12, 0.08, dl));
  // the crown: a dark arrowhead pointing forward between the eyes
  float cr = sm(0.62, 0.9, a), ar = abs(z - 0.55 - (a - 1.25) * 1.3);
  c = mix(c, vec3(0.02, 0.018, 0.015), cr * sm(0.32, 0.22, ar) * step(z, 1.5));
  // the lips paler, barred at the sutures
  c = mix(c, vec3(0.17, 0.158, 0.132) * (0.8 + 0.4 * sn2(vec2(z * 4.0, 1.0))), sm(0.24, 0.14, a));
  return c;
}
#endif
`;

const GLSL_MAIN = /* glsl */`
vec2 sp = vNormalMapUv;
vec2 fwv = fwidth(sp); float fpx = max(fwv.x, fwv.y);
float lod = sm(0.25, 0.8, fpx);
float ee = 0.03 + fpx * 0.3;
vec2 cid, cd2; float rim, r2, kind, k2;
#ifndef SERP_HEAD
float h0 = bodyH(sp, cid, rim, kind), hx = bodyH(sp + vec2(ee, 0.0), cd2, r2, k2), hy = bodyH(sp + vec2(0.0, ee), cd2, r2, k2);
float uu = sp.x / COLS;
vec3 pc = bodyPat(cid.x / COLS, cid.y), pf = bodyPat(uu, sp.y);
float scar = bodyScar(sp) * (1.0 - kind);
float amp = mix(0.17, 0.08, kind);
#else
float h0 = headH(sp, cid, rim, kind), hx = headH(sp + vec2(ee, 0.0), cd2, r2, k2), hy = headH(sp + vec2(0.0, ee), cd2, r2, k2);
bool jaw = sp.x < 0.0;
float ha = abs(sp.x) * HSZ, hz = sp.y * HSZ;
vec3 pc = headPat(ha, hz, jaw), pf = pc;
if (kind == 0.0) pc = headPat(abs(cid.x) * HSZ, -cid.y * HSZ, jaw);
float scar = 0.0, amp = 0.15;
#endif
vec2 grad = clamp(vec2(hx - h0, hy - h0) / ee, -7.0, 7.0);
float flt = scar * 0.85 + lod;
vec3 sN = normalize(vec3(-grad * amp * (1.0 - clamp(flt, 0.0, 1.0)) + vec2(sn2(sp * 3.1) - 0.5, sn2(sp * 3.1 + 7.0) - 0.5) * 0.12 * scar, 1.0));
vec3 scol = mix(pc, pf, 0.2 + 0.8 * lod);
scol *= mix((0.42 + 0.58 * rim) * (0.88 + 0.24 * sh1(cid * 1.37)) * (0.86 + 0.22 * h0), 1.0, lod);
scol = mix(scol, vec3(0.2, 0.19, 0.175) * (0.7 + 0.5 * sn2(sp * 1.9)), scar);
diffuseColor.rgb *= scol;
float sRough = mix(mix(0.82, 0.36, rim), 0.55, lod);
sRough = mix(sRough, 0.3, kind > 0.5 ? 0.6 : 0.0);
sRough = mix(sRough, 0.8, scar);
float sGlow = mix(pow(1.0 - rim, 2.0), 0.12, lod) * (1.0 - scar);
#ifdef DBG
#if DBG == 1
diffuseColor.rgb = pc * 3.0;
#elif DBG == 2
diffuseColor.rgb = vec3(scar);
#elif DBG == 4
diffuseColor.rgb = vec3(rim);
#elif DBG == 5
diffuseColor.rgb = vec3(fract(sp * 0.1), 0.0);
#endif
#endif
`;

const _dummyN = (() => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); t.needsUpdate = true; return t; })();
// head: the head's own variant (its UVs are a chart of the head, not of the body). eye: [a, z, a, z] of the eye and of its brow plate
export function serpentSkin(head = false, eye = [0.4, 1.4, 0.7, 1.4]) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0, normalMap: _dummyN, normalScale: new THREE.Vector2(1, 1), clearcoat: 0.22, clearcoatRoughness: 0.38, emissive: 0xff3a10, emissiveIntensity: 0, side: head ? THREE.DoubleSide : THREE.FrontSide });
  m.defines = head ? { SERP_HEAD: '' } : {}; if (globalThis.__serpDbg) m.defines.DBG = globalThis.__serpDbg;
  const uEye = { value: new THREE.Vector4(...eye) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEye = uEye;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <map_fragment>', GLSL_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * sRough;')
      .replace('#include <normal_fragment_maps>', '{ vec3 mapN = sN; mapN.xy *= normalScale; normal = normalize( tbn * mapN ); }')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= sGlow;');
  };
  m.customProgramCacheKey = () => (head ? 'serpent-skin-head' : 'serpent-skin-body');
  m.userData.uEye = uEye;
  return m;
}

// ---------------------------------------------------------------- the shape of the head
const Z0 = -0.55, Z1 = 2.55, JZ0 = -0.5, JZ1 = 2.42, LE = 0.6;   // skull and jaw from..to; LE: the eye
const HINGE = [0, -0.2, -0.36];   // the jaws open about this
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const curve = (pts) => (L) => {   // a smooth line through [L, value] points
  let k = 0; while (k < pts.length - 2 && L > pts[k + 1][0]) k++;
  const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1], d = pts[Math.min(pts.length - 1, k + 2)], t = clamp((L - b[0]) / (c[0] - b[0]), 0, 1);
  return 0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t * t + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t * t * t);
};
const W = curve([[0, 0.7], [0.08, 0.96], [0.18, 1.06], [0.3, 1.03], [0.45, 0.92], [0.6, 0.78], [0.75, 0.62], [0.88, 0.49], [0.96, 0.4], [1, 0.34]]);   // half-width
const HT = curve([[0, 0.6], [0.12, 0.66], [0.3, 0.64], [0.5, 0.57], [0.65, 0.5], [0.8, 0.42], [0.92, 0.35], [1, 0.3]]);                                   // crown over the lip
const DEP = curve([[0, 0.5], [0.2, 0.5], [0.45, 0.4], [0.7, 0.3], [0.9, 0.2], [1, 0.15]]);                                                              // the jaw under its lip
export const serpentLip = (L) => -0.11 - 0.06 * gauss(L, 0.12, 0.14) + 0.06 * smooth(clamp((L - 0.86) / 0.14, 0, 1));                            // the line of the mouth
const END = (L) => (L < 0.08 ? Math.sqrt(Math.max(0, 1 - ((0.08 - L) / 0.08) ** 2)) : 1) * (L > 0.9 ? Math.sqrt(Math.max(0, 1 - ((L - 0.9) / 0.1) ** 2)) * 0.55 + 0.45 : 1);
const zOf = (L) => lerp(Z0, Z1, L), jzOf = (Lj) => lerp(JZ0, JZ1, Lj), LuOf = (z) => (z - Z0) / (Z1 - Z0);
const jEnd = (Lj) => (Lj < 0.07 ? Math.sqrt(Math.max(0, 1 - ((0.07 - Lj) / 0.07) ** 2)) : 1) * (Lj > 0.9 ? Math.sqrt(Math.max(0, 1 - ((Lj - 0.9) / 0.1) ** 2)) * 0.6 + 0.4 : 1);
const jw = (Lj) => W(LuOf(jzOf(Lj))) * 0.9 * jEnd(Lj);   // inside the upper lip, which overlaps it
const jlip = (Lj) => serpentLip(LuOf(jzOf(Lj))) + 0.012 - 0.07 * smooth(clamp((Lj - 0.86) / 0.14, 0, 1));
// the skull's outside: th 0 (the lip, +x) .. PI/2 (the crown) .. PI (the lip, -x)
function skullPt(L, th) {
  const e = END(L), w = W(L) * e, h = HT(L) * e, lip = serpentLip(L), z = zOf(L);
  const c = Math.cos(th), s = Math.max(0, Math.sin(th)), ac = Math.abs(c), sn = smooth(clamp((L - 0.55) / 0.3, 0, 1));
  let x = w * Math.sign(c) * Math.pow(ac, lerp(0.66, 0.54, sn)), y = lip + h * Math.pow(s, lerp(0.58, 0.46, sn));
  x *= 1 + 0.06 * gauss(L, 0.26, 0.13) * gauss(s, 0.35, 0.3);                                       // the venom glands swollen behind the eyes
  y += 0.035 * e * gauss(ac, 0.6, 0.12) * smooth(clamp((L - 0.5) / 0.2, 0, 1));                       // the canthus, a sharp edge from brow to nostril
  y -= 0.03 * e * gauss(c, 0, 0.3) * smooth(clamp((L - 0.3) / 0.3, 0, 1));                            // the crown a little hollow between
  const br = gauss(L, LE, 0.075);
  y += 0.075 * br * gauss(ac, 0.62, 0.16); x *= 1 + 0.08 * br * gauss(s, 0.8, 0.16);                // the brow: a shelf out over the eye
  x *= 1 - 0.08 * gauss(L, LE, 0.05) * gauss(s, 0.47, 0.14);                                         // the socket under it
  x *= 1 - 0.07 * gauss(L, 0.8, 0.045) * gauss(s, 0.28, 0.12);                                       // pinched at the heat pit
  return [x, y, z];
}
// the palate: f 0 (the +x lip) .. 1 (the -x lip), the lip edge exactly the skull's
function palatePt(L, f) {
  const e = END(L), w = W(L) * e, lip = serpentLip(L), z = zOf(L), c = Math.cos(f * Math.PI), s = Math.sin(f * Math.PI);
  const edge = skullPt(L, f < 0.5 ? 0 : Math.PI), band = smooth(clamp(s / 0.2, 0, 1)), ac = Math.abs(c);
  const vault = 0.2 * e * Math.sin(Math.PI * clamp(L * 1.05, 0, 1)) * Math.pow(s, 0.8) - 0.045 * e * gauss(ac, 0.45, 0.08) * clamp((L - 0.2) / 0.15, 0, 1);   // vaulted, the two tooth ridges hanging from it
  return [lerp(edge[0], w * 0.9 * c, band), lerp(edge[1], lip + 0.012 + vault, band), z];
}
// the jaw's outside: th PI (the -x lip) .. 3PI/2 (the chin) .. 2PI (the +x lip)
function hullPt(Lj, th) {
  const e = jEnd(Lj), w = jw(Lj), top = jlip(Lj), c = Math.cos(th), s = Math.max(0, -Math.sin(th));
  return [w * Math.sign(c) * Math.pow(Math.abs(c), 0.72), top - DEP(Lj) * e * Math.pow(s, 0.68), jzOf(Lj)];
}
// the mouth floor: f 0 (the +x lip) .. 1 (the -x lip). The gum, then down into the floor; the tongue's sheath along the middle
function floorPt(Lj, f) {
  const e = jEnd(Lj), w = jw(Lj), top = jlip(Lj), c = Math.cos(f * Math.PI), ac = Math.abs(c);
  const inn = smooth(clamp((0.97 - ac) / 0.22, 0, 1));
  let y = top - 0.03 * smooth(clamp((1 - ac) / 0.03, 0, 1)) - 0.25 * e * inn * (0.6 + 0.4 * Math.sin(Math.PI * clamp(Lj * 1.05, 0, 1)));
  y += 0.075 * e * gauss(c, 0, 0.13) * smooth(clamp((Lj - 0.35) / 0.15, 0, 1)) * (1 - smooth(clamp((Lj - 0.88) / 0.05, 0, 1)));   // the sheath
  return [w * c * (1 - 0.06 * inn), y, jzOf(Lj)];
}
export const floorY = (Lj) => floorPt(Lj, 0.5)[1];
// the flesh of the mouth: pale and greyish at the lips, bruised violet inward, black down the throat
const flesh = (k, deep = 0) => { k = clamp(k, 0, 1); const d = 1 - 0.55 * deep; return [(0.02 + 0.37 * k) * d, (0.012 + 0.27 * k) * d, (0.016 + 0.28 * k) * d]; };

// a grid surface: fn(i, j) -> [x, y, z, r, g, b]
function grid(NI, NJ, fn, flip = false) {
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= NI; i++) for (let j = 0; j <= NJ; j++) { const r = fn(i, j); pos.push(r[0], r[1], r[2]); col.push(r[3] ?? 1, r[4] ?? 1, r[5] ?? 1); }
  for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) { const a = i * (NJ + 1) + j, b = a + 1, c = a + NJ + 1, d = c + 1; if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// the head's chart for the skin shader: u the distance round from the nearest lip (negative on the jaw), v forward; in scales
function chartUV(g, NI, NJ, sign) {
  const P = g.attributes.position, uv = new Float32Array(P.count * 2);
  for (let i = 0; i <= NI; i++) {
    const cum = [0]; for (let j = 1; j <= NJ; j++) { const a = i * (NJ + 1) + j; cum.push(cum[j - 1] + Math.hypot(P.getX(a) - P.getX(a - 1), P.getY(a) - P.getY(a - 1), P.getZ(a) - P.getZ(a - 1))); }
    const tot = cum[NJ];
    for (let j = 0; j <= NJ; j++) { const a = i * (NJ + 1) + j; uv[a * 2] = sign * Math.min(cum[j], tot - cum[j]) / HS; uv[a * 2 + 1] = P.getZ(a) / HS; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
function taper(pts, r0, r1, radial = 8, pw = 0.8, flat = 1) {
  const c3 = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n = pts.length * 3;
  const g = new THREE.TubeGeometry(c3, n, 1, radial, false), P = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { const t = Math.floor(i / (radial + 1)) / n; c3.getPointAt(t, c); v.fromBufferAttribute(P, i).sub(c); v.x *= flat; v.multiplyScalar(lerp(r0, r1, Math.pow(t, pw))).add(c); P.setXYZ(i, v.x, v.y, v.z); }
  // close the root
  g.computeVertexNormals(); return g;
}
const place = (g, p, r = [0, 0, 0], s = [1, 1, 1]) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s))); return g; };
const paint = (g, fn) => { const P = g.attributes.position, c = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { const r = fn(P.getX(i), P.getY(i), P.getZ(i)); c[i * 3] = r[0]; c[i * 3 + 1] = r[1]; c[i * 3 + 2] = r[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };
const strip = (g) => { g.deleteAttribute('uv'); return g; };
// a point on a surface, and its outward normal (by small steps of its parameters)
function surfFrame(fn, a, b, out = 1) {
  const p = fn(a, b), pa = fn(a + 1e-3, b), pb = fn(a, b + 1e-3);
  const n = new THREE.Vector3().crossVectors(new THREE.Vector3(pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]), new THREE.Vector3(pb[0] - p[0], pb[1] - p[1], pb[2] - p[2])).normalize().multiplyScalar(out);
  return { p: new THREE.Vector3(...p), n };
}

// the eye: a dull brass iris finely veined, darker at its rim, the pupil a black vertical slit (on the +x pole)
function eyeTex() {
  const Wt = 256, Ht = 128, d = new Uint8Array(Wt * Ht * 4);
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0; y < Ht; y++) for (let x = 0; x < Wt; x++) {
    const ax = (x + 0.5 - Wt / 2) / Wt * TAU, ay = (y + 0.5 - Ht / 2) / Ht * Math.PI, r = Math.hypot(ax, ay), an = Math.atan2(ay, ax);
    let c;
    if (r > 1.45) c = [0.03, 0.028, 0.024];
    else {
      const k = r / 1.45, fib = 0.75 + 0.25 * Math.sin(an * 61 + Math.sin(an * 7) * 3) * Math.sin(an * 23 + r * 9), spot = h(Math.round(an * 40), Math.round(r * 12)) > 0.86 ? 0.45 : 1;
      c = [lerp(0.6, 0.22, k ** 1.3), lerp(0.52, 0.19, k ** 1.3), lerp(0.3, 0.1, k ** 1.1)].map((v) => v * fib * spot);
      const rimD = smooth(clamp((k - 0.82) / 0.18, 0, 1)); c = c.map((v) => v * (1 - 0.75 * rimD));
      const pw = 0.11 * Math.sqrt(Math.max(0, 1 - (ay / 1.1) ** 2)), pd = Math.abs(ax) - pw;   // the slit
      if (pd < 0.035) { const t = smooth(clamp(pd / 0.035, 0, 1)); c = c.map((v) => v * t * (pd > 0 ? 1 : 0) + 0.004); }
      else if (pd < 0.08) c = c.map((v) => v * (0.7 + 0.3 * (pd - 0.035) / 0.045));   // a dark ring round it
    }
    const o = (y * Wt + x) * 4; for (let i = 0; i < 3; i++) d[o + i] = Math.round(255 * Math.pow(clamp(c[i], 0, 1), 1 / 2.2)); d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, Wt, Ht); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

export function buildSerpentHead() {
  const head = new THREE.Group(), upper = new THREE.Group(), jaw = new THREE.Group(), parts = { upper, jaw };
  upper.position.set(...HINGE); jaw.position.set(...HINGE); head.add(upper, jaw);
  const H = (g) => { g.translate(-HINGE[0], -HINGE[1], -HINGE[2]); return g; };   // into a jaw's frame (each turns about the hinge)
  // the eye and its brow, in the skin shader's chart
  const NL = 60, NT = 36, NJ = 30;
  const eyeF = surfFrame((L, th) => skullPt(L, th), LE, 0.5);
  const skull = chartUV(grid(NL, NT, (i, j) => skullPt(i / NL, j / NT * Math.PI)), NL, NT, 1);
  const aAt = (i, j) => Math.abs(skull.attributes.uv.getX(i * (NT + 1) + j)) * HS;
  const eyeA = aAt(Math.round(LE * NL), Math.round(0.5 / Math.PI * NT)), browA = aAt(Math.round(LE * NL), Math.round(0.92 / Math.PI * NT));
  const skin = serpentSkin(true, [eyeA, zOf(LE), browA, zOf(LE) - 0.03]);
  const mouth = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
  const bone = new THREE.MeshPhysicalMaterial({ color: 0xd9d0b4, roughness: 0.3, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x040303, roughness: 0.7 });
  const horn = new THREE.MeshPhysicalMaterial({ color: 0x18140f, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  parts.skin = skin;
  // ---- the skull and the palate (the palate begins where the throat does)
  const LT = 0.08, iT = Math.round(LT * NL);
  upper.add(new THREE.Mesh(H(skull), skin));
  const NP = 24;
  const palate = grid(NL - iT, NP, (i, j) => { const L = (i + iT) / NL, f = j / NP, p = palatePt(L, f), k = (0.35 + 0.65 * smooth(clamp((L - LT) / 0.4, 0, 1))) * (0.85 + 0.15 * Math.cos(f * 40)); return [...p, ...flesh(k * (1 - 0.35 * Math.sin(Math.PI * f)))]; }, true);
  upper.add(new THREE.Mesh(H(palate), mouth));
  // ---- the lower jaw: its scaled hull, and inside the floor of the mouth
  const NLJ = 52, LjT = (zOf(LT) - JZ0) / (JZ1 - JZ0), ijT = Math.floor(LjT * NLJ);
  const hull = chartUV(grid(NLJ, NJ, (i, j) => hullPt(i / NLJ, Math.PI + j / NJ * Math.PI), true), NLJ, NJ, -1);
  jaw.add(new THREE.Mesh(H(hull), skin));
  const NF = 24;
  const floor = grid(NLJ - ijT, NF, (i, j) => {
    const Lj = (i + ijT) / NLJ, f = j / NF, p = floorPt(Lj, f), c = Math.cos(f * Math.PI), ac = Math.abs(c);
    const k = (0.3 + 0.7 * smooth(clamp((Lj - LjT) / 0.4, 0, 1))) * (ac > 0.9 ? 0.75 : 1) * (0.9 + 0.1 * Math.cos(c * 30));
    return [...p, ...flesh(k, 0.25 * smooth(clamp((0.9 - ac) / 0.3, 0, 1)))];
  }, true);
  jaw.add(new THREE.Mesh(H(floor), mouth));
  // the glottis: a short tube standing on the sheath, open at its front in a dark slit
  {
    const L0 = 0.62, L1 = 0.84, y0 = floorY(L0), y1 = floorY(L1);
    const g = new THREE.LatheGeometry(Array.from({ length: 9 }, (_, i) => { const t = i / 8; return new THREE.Vector2(0.001 + 0.065 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.6, t); }), 12);
    g.rotateX(Math.PI / 2); g.scale(1, 0.7, jzOf(L1) - jzOf(L0)); g.translate(0, 0, jzOf(L0));
    const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const z = P.getZ(i), Lj = (z - JZ0) / (JZ1 - JZ0); P.setY(i, P.getY(i) * (P.getY(i) > 0 ? 1 : 0.2) + lerp(y0, y1, clamp((Lj - L0) / (L1 - L0), 0, 1)) + 0.012); }
    g.computeVertexNormals(); paint(g, (x, y, z) => { const slit = Math.abs(x) < 0.02 && z > jzOf(L1) - 0.2 && y > lerp(y0, y1, 1) + 0.03; return slit ? [0.01, 0.005, 0.006] : flesh(0.8); });
    jaw.add(new THREE.Mesh(H(strip(g)), mouth));
  }
  // ---- teeth. A viper's maxilla carries only the fang; the small hooked teeth are on the palatine and pterygoid bones
  // (two rows along the palate) and on the lower jaw
  const tooth = (len, r) => taper([[0, 0, 0], [0, -len * 0.55, 0.02 * len], [0, -len * 0.9, -0.22 * len], [0, -len, -0.38 * len]], r, r * 0.06, 6, 1.1);
  const tg = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 9; i++) {
    const L = 0.3 + i * 0.05, f = sx > 0 ? 0.5 - 0.5 * Math.acos(0.45) / Math.PI * 0 - 0.36 : 0.86, p = palatePt(L, sx > 0 ? 0.142 : 0.858);
    tg.push(place(tooth(0.1 + 0.03 * Math.sin(i), 0.022), [p[0], p[1] + 0.012, p[2]], [0.15, 0, 0]));
  }
  upper.add(new THREE.Mesh(H(mergeGeometries(tg)), bone));
  const lt = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 10; i++) {
    const Lj = 0.3 + i * 0.058, p = floorPt(Lj, sx > 0 ? 0.06 : 0.94);
    lt.push(place(tooth(0.1 + 0.02 * Math.cos(i * 1.7), 0.02), [p[0], p[1] - 0.012, p[2]], [Math.PI - 0.2, 0, sx * 0.1]));
  }
  jaw.add(new THREE.Mesh(H(mergeGeometries(lt)), bone));
  // the fangs: long, curved and hollow, folded back along the palate in their sheaths until the mouth gapes
  parts.fangs = [];
  const fangL = 0.86;
  for (const sx of [-1, 1]) {
    const L = 0.84, p = palatePt(L, sx > 0 ? 0.14 : 0.86), f = new THREE.Group();
    f.position.set(p[0] - HINGE[0], p[1] + 0.03 - HINGE[1], p[2] - HINGE[2]);
    const fg = taper([[0, 0.06, 0], [0, -fangL * 0.3, 0.04], [0, -fangL * 0.65, -0.03], [0, -fangL * 0.9, -0.16], [0, -fangL, -0.24]], 0.07, 0.006, 9, 1.0);
    f.add(new THREE.Mesh(fg, bone));
    // the venom: a bead of black at the point
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshPhysicalMaterial({ color: 0x020202, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 })); bead.position.set(0, -fangL + 0.02, -0.235); bead.scale.set(1, 1.5, 1); f.add(bead);
    upper.add(f); parts.fangs.push(f);
    // the sheath: a fold of the flesh of the palate over the fang's root
    const sg = new THREE.SphereGeometry(1, 14, 10); paint(sg, (x, y, z) => flesh(0.55 + 0.3 * y, 0.3));
    const sh = new THREE.Mesh(strip(sg), mouth); sh.position.set(p[0] - HINGE[0], p[1] - 0.03 - HINGE[1], p[2] - 0.2 - HINGE[2]); sh.scale.set(0.1, 0.08, 0.34); upper.add(sh); parts[sx > 0 ? 'sheathL' : 'sheathR'] = sh;
  }
  // ---- eyes, deep under the brow
  const et = eyeTex(), em = new THREE.MeshPhysicalMaterial({ map: et, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.05 });
  parts.eyes = [];
  const ER = 0.16;
  for (const sx of [-1, 1]) {
    const fr = surfFrame((L, th) => skullPt(L, th), LE, sx > 0 ? 0.48 : Math.PI - 0.48, -1);
    const n = fr.n.clone(); n.x = Math.abs(n.x) * sx;
    const m = new THREE.Mesh(new THREE.SphereGeometry(ER, 28, 18), em);
    m.position.set(fr.p.x - n.x * ER * 0.45 - HINGE[0], fr.p.y - n.y * ER * 0.45 - HINGE[1], fr.p.z - n.z * ER * 0.45 - HINGE[2]);
    const X = n.clone(), Y = new THREE.Vector3(0, 1, 0).addScaledVector(X, -X.y).normalize(), Z = new THREE.Vector3().crossVectors(X, Y);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    upper.add(m); parts.eyes.push(m);
  }
  // ---- the horns: one long pointed scale standing over each eye, as on the horned vipers of the desert
  const hg = [];
  for (const sx of [-1, 1]) {
    const fr = surfFrame((L, th) => skullPt(L, th), LE - 0.015, sx > 0 ? 0.95 : Math.PI - 0.95, -1); const n = fr.n.clone(); n.x = Math.abs(n.x) * sx;
    const up = new THREE.Vector3(sx * 0.25, 1, -0.55).normalize(), b = fr.p.clone().addScaledVector(n, -0.06);
    const pts = [0, 0.3, 0.62, 1].map((t) => b.clone().addScaledVector(up, t * 0.5).addScaledVector(new THREE.Vector3(sx, 0, -0.4), 0.06 * t * t).toArray());
    hg.push(taper(pts, 0.085, 0.006, 8, 0.85, 0.6));
  }
  upper.add(new THREE.Mesh(H(mergeGeometries(hg)), horn));
  // ---- the nostrils near the tip of the snout, and the heat pits between eye and nostril: dark hollows in the scales
  const dg = [];
  for (const sx of [-1, 1]) {
    for (const [L, th, r, sc] of [[0.95, 0.42, 0.05, [0.7, 1, 1]], [0.79, 0.22, 0.055, [0.55, 0.8, 1.1]]]) {
      const fr = surfFrame((a, b) => skullPt(a, b), L, sx > 0 ? th : Math.PI - th, -1), n = fr.n.clone(); n.x = Math.abs(n.x) * sx;
      const g = new THREE.SphereGeometry(r, 10, 8); g.scale(...sc); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), n); g.applyQuaternion(q);
      g.translate(fr.p.x - n.x * r * 0.35, fr.p.y - n.y * r * 0.35, fr.p.z - n.z * r * 0.35); dg.push(strip(g));
    }
  }
  upper.add(new THREE.Mesh(H(mergeGeometries(dg)), dark));
  // ---- the cheeks and the throat: skin stretched between the lips, rebuilt as the jaws open; and behind them the
  // throat going back and down into the neck, its walls folded and going black
  const CN = 12, CM = 6, NK = 9;
  const ringTop = NP + 1, ringBot = NF + 1, RING = ringTop + (CM - 1) + ringBot + (CM - 1);   // one turn round the back of the mouth
  const nCheek = 2 * (CN + 1) * (CM + 1), nThroat = (NK + 1) * RING + 1;
  const lpos = new Float32Array((nCheek + nThroat) * 3), lcol = new Float32Array((nCheek + nThroat) * 3), lidx = [];
  const cheekL = (c) => lerp(LT, 0.42, c / CN);   // the cheeks run forward from where the throat begins
  const ljOf = (L) => clamp((zOf(L) - JZ0) / (JZ1 - JZ0), 0, 1);
  for (let sd = 0; sd < 2; sd++) for (let c = 0; c <= CN; c++) for (let j = 0; j <= CM; j++) { const o = (sd * (CN + 1) * (CM + 1) + c * (CM + 1) + j) * 3, f = flesh(0.3 + 0.35 * c / CN, 0.25 + 0.3 * Math.sin(Math.PI * j / CM)); lcol[o] = f[0]; lcol[o + 1] = f[1]; lcol[o + 2] = f[2]; }
  for (let sd = 0; sd < 2; sd++) for (let c = 0; c < CN; c++) for (let j = 0; j < CM; j++) { const a = sd * (CN + 1) * (CM + 1) + c * (CM + 1) + j, b = a + 1, cc = a + CM + 1, d = cc + 1; lidx.push(a, b, cc, b, d, cc); }
  const T0 = nCheek;
  for (let k = 0; k <= NK; k++) for (let i = 0; i < RING; i++) {
    const o = (T0 + k * RING + i) * 3, t = k / NK, f = flesh(0.32 * (1 - smooth(clamp(t / 0.55, 0, 1))) * (0.8 + 0.2 * Math.cos(i * 1.7)), 0.4);
    lcol[o] = f[0]; lcol[o + 1] = f[1]; lcol[o + 2] = f[2];
  }
  for (let k = 0; k < NK; k++) for (let i = 0; i < RING; i++) { const a = T0 + k * RING + i, b = T0 + k * RING + (i + 1) % RING, c = a + RING, d = b + RING; lidx.push(a, b, c, b, d, c); }
  const TE = T0 + (NK + 1) * RING; for (let i = 0; i < RING; i++) lidx.push(T0 + NK * RING + i, T0 + NK * RING + (i + 1) % RING, TE);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3).setUsage(THREE.DynamicDrawUsage)); lg.setAttribute('color', new THREE.BufferAttribute(lcol, 3)); lg.setIndex(lidx);
  const lining = new THREE.Mesh(lg, mouth); lining.frustumCulled = false; head.add(lining);
  const THROAT_END = new THREE.Vector3(0, NECK.y + 0.02, NECK.z - 0.75);
  // ---- the forked tongue: rebuilt each frame along its path, out of the sheath, along the floor and through the notch
  // in the lips (in the jaw's frame, so it goes where the jaw goes)
  const TL = 2.7, TF = 0.85, TN = 22, TFN = 9, TR = 6, TFR = 5;   // length, the fork, segments, radial
  const tpath = (() => {
    const pts = [];
    for (let Lj = 0.08; Lj < 0.86; Lj += 0.04) pts.push(new THREE.Vector3(0, floorY(Lj) - (Lj < 0.84 ? 0.06 : 0), jzOf(Lj)));   // under the floor, in the sheath
    const open = pts.length; pts.push(new THREE.Vector3(0, floorY(0.9) + 0.01, jzOf(0.9)));
    const zl = jzOf(0.995), yl = (jlip(0.995) + serpentLip(LuOf(zl))) / 2 + 0.01;
    pts.push(new THREE.Vector3(0, yl - 0.01, zl - 0.12), new THREE.Vector3(0, yl, zl + 0.1));
    for (let k = 1; k <= 6; k++) pts.push(new THREE.Vector3(0, yl - 0.035 * k * k * 0.3, zl + 0.1 + k * 0.45));
    const cv = new THREE.CatmullRomCurve3(pts), len = cv.getLength(), sOpen = cv.getLengths(200)[0];
    // the arc length at the sheath's mouth and at the lips
    const ls = cv.getLengths(pts.length * 8), u = (i) => i / (pts.length - 1), at = (i) => ls[Math.round(u(i) * pts.length * 8)];
    return { cv, len, sOpen: at(open), sLip: at(open + 2) };
  })();
  const tCount = (TN + 1) * (TR + 1) + 2 * (TFN + 1) * (TFR + 1), tpos = new Float32Array(tCount * 3), tidx = [];
  const tube = (base, N, R) => { for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) { const a = base + i * (R + 1) + j, b = a + 1, c = a + R + 1, d = c + 1; tidx.push(a, c, b, b, c, d); } };
  tube(0, TN, TR); tube((TN + 1) * (TR + 1), TFN, TFR); tube((TN + 1) * (TR + 1) + (TFN + 1) * (TFR + 1), TFN, TFR);
  const tgeo = new THREE.BufferGeometry(); tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3).setUsage(THREE.DynamicDrawUsage)); tgeo.setIndex(tidx);
  const tmat = new THREE.MeshPhysicalMaterial({ color: 0x0a090c, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const tongue = new THREE.Mesh(tgeo, tmat); tongue.frustumCulled = false; jaw.add(tongue); parts.tongue = tongue;
  const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _t = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
  // ext 0 (lying in its sheath, the tips just out of it) .. 1 (all the way out); flick: how hard the tips whip up and down
  parts.setTongue = (ext, flick, time) => {
    const tip = lerp(tpath.sOpen + 0.14, tpath.sLip + 2.05, ext), base = tip - TL, out = tpath.sLip;
    const at = (s, o) => {   // the point at arc length s, and the whip of the free part
      const len = tpath.len, u = clamp(s / len, 0, 1); tpath.cv.getPointAt(u, o);
      if (s > len) o.z += s - len;
      const free = Math.max(0, s - out); o.y += flick * Math.min(1, free * 0.5) * Math.sin(time * 44 - free * 3.2) * 0.22 * Math.min(1, free) * (0.4 + 0.6 * clamp((s - (tip - TF)) / TF + 0.6, 0, 1));
      o.y += -0.04 * free * free * (1 - flick * 0.5); return o;
    };
    const ring = (o, c, r, R, sideOff, sx) => { // a ring of R+1 at c, round the path's direction
      _n.set(0, 1, 0); _s.crossVectors(_t, _n).normalize(); _n.crossVectors(_s, _t).normalize();
      for (let j = 0; j <= R; j++) { const a = j / R * TAU, k = o + j; tpos[k * 3] = c.x + (_s.x * Math.cos(a) * 1.25 + _n.x * Math.sin(a) * 0.8) * r + sideOff * sx; tpos[k * 3 + 1] = c.y + (_s.y * Math.cos(a) * 1.25 + _n.y * Math.sin(a) * 0.8) * r; tpos[k * 3 + 2] = c.z + (_s.z * Math.cos(a) * 1.25 + _n.z * Math.sin(a) * 0.8) * r; }
    };
    const sF = tip - TF;
    for (let i = 0; i <= TN; i++) {
      const s = lerp(base, sF, i / TN); at(s, _p); at(s + 0.02, _q); _t.subVectors(_q, _p).normalize();
      ring(i * (TR + 1), _p, lerp(0.07, 0.045, i / TN) * (i === 0 ? 0.3 : 1), TR, 0, 0);
    }
    for (let sd = 0; sd < 2; sd++) {
      const sx = sd ? 1 : -1, o0 = (TN + 1) * (TR + 1) + sd * (TFN + 1) * (TFR + 1);
      for (let i = 0; i <= TFN; i++) {
        const t = i / TFN, s = sF + t * TF; at(s, _p); at(s + 0.02, _q); _t.subVectors(_q, _p).normalize();
        const spread = (0.035 + 0.22 * t * t) * (0.6 + 0.4 * ext), px = _p.x;
        ring(o0 + i * (TFR + 1), _p, lerp(0.034, 0.005, t ** 1.1), TFR, spread, sx); void px;
      }
    }
    // in the jaw's frame
    for (let i = 0; i < tCount; i++) { tpos[i * 3] -= HINGE[0]; tpos[i * 3 + 1] -= HINGE[1]; tpos[i * 3 + 2] -= HINGE[2]; }
    tgeo.attributes.position.needsUpdate = true; tgeo.computeVertexNormals();
  };
  parts.setTongue(0, 0, 0);
  // ---- ropes of black venom between the jaws as they part
  const SP = [[1, 0.46], [-1, 0.5], [1, 0.66], [-1, 0.34], [1, 0.8]], strands = [], sm = new THREE.MeshPhysicalMaterial({ color: 0x060606, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.88 });
  for (const [sx, L] of SP) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 6, true), sm); m.scale.setScalar(0.001); head.add(m); strands.push({ m, sx, L, f: sx > 0 ? 0.1 : 0.9 }); }
  head.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== sm && o !== lining && o !== tongue; o.receiveShadow = true; } });
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const rot = (v, a) => { const y = v.y - HINGE[1], z = v.z - HINGE[2], c = Math.cos(a), s = Math.sin(a); v.y = HINGE[1] + y * c - z * s; v.z = HINGE[2] + y * s + z * c; return v; };
  const ringPts = new Float32Array(RING * 3);
  let lastG = -1;
  // open the mouth: g 0 shut .. 1 the full gape of a strike
  parts.gape = (g) => {
    if (Math.abs(g - lastG) < 1e-4) return; lastG = g;
    const au = -0.4 * g, aj = 0.92 * g; upper.rotation.x = au; jaw.rotation.x = aj; parts.au = au; parts.aj = aj;
    const fang = lerp(1.38, -0.1, smooth(clamp(g * 1.6, 0, 1))); for (const f of parts.fangs) f.rotation.x = fang;
    // the cheeks
    let o = 0;
    const pU = (L, sx, v) => { const p = skullPt(L, sx > 0 ? 0 : Math.PI); return rot(v.set(p[0], p[1], p[2]), au); };
    const pJ = (Lj, sx, v) => { const p = floorPt(Lj, sx > 0 ? 0 : 1); return rot(v.set(p[0], p[1], p[2]), aj); };
    for (const sx of [1, -1]) for (let c = 0; c <= CN; c++) {
      const L = cheekL(c); pU(L, sx, _a); pJ(c === 0 ? (ijT / NLJ) : ljOf(L), sx, _b);
      const fwd = c / CN;
      for (let j = 0; j <= CM; j++) { const t = j / CM, bow = Math.sin(Math.PI * t) * (0.06 + 0.16 * g) * (1 - 0.6 * fwd); lpos[o++] = lerp(_a.x, _b.x, t) - sx * bow; lpos[o++] = lerp(_a.y, _b.y, t); lpos[o++] = lerp(_a.z, _b.z, t) - bow * 0.4 * g; }
    }
    // the mouth of the throat: the back edge of the palate, down the cheek, the back edge of the floor, up the other cheek
    let r = 0;
    const put = (v) => { ringPts[r * 3] = v.x; ringPts[r * 3 + 1] = v.y; ringPts[r * 3 + 2] = v.z; r++; };
    for (let j = 0; j <= NP; j++) { const p = palatePt(LT, j / NP); put(rot(_a.set(p[0], p[1], p[2]), au)); }
    for (let j = 1; j < CM; j++) { const q = ((CN + 1) * (CM + 1) + j) * 3; put(_a.set(lpos[q], lpos[q + 1], lpos[q + 2])); }   // the -x cheek, top to bottom
    for (let j = NF; j >= 0; j--) { const p = floorPt(ijT / NLJ, j / NF); put(rot(_a.set(p[0], p[1], p[2]), aj)); }
    for (let j = CM - 1; j >= 1; j--) { const q = j * 3; put(_a.set(lpos[q], lpos[q + 1], lpos[q + 2])); }                       // the +x cheek, bottom to top
    let cx = 0, cy = 0, cz = 0; for (let i = 0; i < RING; i++) { cx += ringPts[i * 3]; cy += ringPts[i * 3 + 1]; cz += ringPts[i * 3 + 2]; } cx /= RING; cy /= RING; cz /= RING;
    for (let k = 0; k <= NK; k++) {
      const t = k / NK, sc = lerp(1, 0.06, smooth(Math.pow(t, 0.7))), ccx = lerp(cx, THROAT_END.x, t), ccy = lerp(cy, THROAT_END.y, smooth(t)), ccz = lerp(cz, THROAT_END.z, t);
      for (let i = 0; i < RING; i++) {
        const fold = 1 + (k ? 0.07 * Math.sin(i / RING * TAU * 9) * Math.sin(Math.PI * t) : 0), q = (T0 + k * RING + i) * 3;
        lpos[q] = ccx + (ringPts[i * 3] - cx) * sc * fold; lpos[q + 1] = ccy + (ringPts[i * 3 + 1] - cy) * sc * fold * lerp(1, 0.8, t); lpos[q + 2] = ccz + (ringPts[i * 3 + 2] - cz) * sc;
      }
    }
    lpos[TE * 3] = THROAT_END.x; lpos[TE * 3 + 1] = THROAT_END.y; lpos[TE * 3 + 2] = THROAT_END.z - 0.05;
    lg.attributes.position.needsUpdate = true; lg.computeVertexNormals();
    // the venom ropes, from the edge of the palate to the gum below
    for (const S of strands) {
      const p = palatePt(S.L, S.f), q = floorPt(ljOf(S.L), S.sx > 0 ? 0.05 : 0.95);
      rot(_a.set(p[0], p[1], p[2]), au); rot(_b.set(q[0], q[1], q[2]), aj);
      const len = _a.distanceTo(_b), show = g > 0.12 && len < 2.4 ? clamp((g - 0.12) * 5, 0, 1) * clamp((2.4 - len) * 1.5, 0, 1) : 0, th = show * (1.25 - 0.4 * len);
      S.m.position.copy(_a).add(_b).multiplyScalar(0.5); S.m.quaternion.setFromUnitVectors(up, _b.sub(_a).normalize()); S.m.scale.set(Math.max(0.001, th), Math.max(0.001, len), Math.max(0.001, th)); S.m.visible = show > 0.01;
    }
  };
  parts.gape(0);
  parts.mouth = mouth;
  return { head, parts };
}
