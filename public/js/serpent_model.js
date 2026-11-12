// The Old Serpent's head: a viper's. Broad and heavy over the venom glands behind the eyes, a flat-topped snout with a
// sharp edge from eye to nostril, horned shelves of brow that put the eyes in shadow. The jaws gape as a viper's do:
// the whole upper skull lifts as the lower jaw drops, the fangs swing forward out of their sheaths, and between the
// jaws the skin of the cheeks stretches thin. Inside it is pale and wet, going down into the dark; the lower jaw is a
// thick lip round a sunken floor with the windpipe standing in it, not a board.
// Frame: +z forward along the snout, y up, the origin where the neck meets the skull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, TAU } from './util.js';

const Z0 = -0.5, Z1 = 2.75, HINGE = [0, -0.16, -0.1];
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const curve = (pts) => (L) => {   // a smooth line through [L, value] points
  let k = 0; while (k < pts.length - 2 && L > pts[k + 1][0]) k++;
  const a = pts[Math.max(0, k - 1)], b = pts[k], c = pts[k + 1], d = pts[Math.min(pts.length - 1, k + 2)], t = clamp((L - b[0]) / (c[0] - b[0]), 0, 1);
  return 0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t * t + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t * t * t);
};
const W = curve([[0, 0.78], [0.1, 1.0], [0.22, 1.12], [0.36, 1.0], [0.52, 0.84], [0.7, 0.64], [0.86, 0.5], [0.96, 0.42], [1, 0.34]]);       // half-width
const HT = curve([[0, 0.62], [0.1, 0.74], [0.25, 0.76], [0.45, 0.66], [0.58, 0.56], [0.75, 0.46], [0.92, 0.4], [1, 0.3]]);                   // crown over the lip
export const serpentLip = (L) => -0.05 - 0.13 * gauss(L, 0.2, 0.2) + 0.05 * smooth(clamp((L - 0.86) / 0.14, 0, 1));                           // the line of the mouth: down at the corners
const END = (L) => (L < 0.07 ? Math.sqrt(Math.max(0, 1 - ((0.07 - L) / 0.07) ** 2)) : 1) * (L > 0.93 ? Math.sqrt(Math.max(0, 1 - ((L - 0.93) / 0.07) ** 2)) * 0.45 + 0.55 : 1);
const zOf = (L) => lerp(Z0, Z1, L);

// a closed surface over L (0 back .. 1 front) and th (0..2PI); fn -> [x, y, z, u, v, r, g, b]. Faces with th < PI go in group 0, the rest in group 1.
function surf(NL, NT, fn) {
  const pos = [], uv = [], col = [], i0 = [], i1 = [];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NT; j++) { const r = fn(i / NL, j / NT * TAU); pos.push(r[0], r[1], r[2]); uv.push(r[3], r[4]); col.push(r[5] ?? 1, r[6] ?? 1, r[7] ?? 1); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NT; j++) { const a = i * (NT + 1) + j, b = a + 1, c = a + NT + 1, d = c + 1; ((j + 0.5) / NT < 0.5 ? i0 : i1).push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex([...i0, ...i1]); g.addGroup(0, i0.length, 0); g.addGroup(i0.length, i1.length, 1); g.computeVertexNormals(); return g;
}
function taper(pts, r0, r1, radial = 8, pw = 0.8) {
  const c3 = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n = pts.length * 3;
  const g = new THREE.TubeGeometry(c3, n, 1, radial, false), P = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { const t = Math.floor(i / (radial + 1)) / n; c3.getPointAt(t, c); v.fromBufferAttribute(P, i).sub(c).multiplyScalar(lerp(r0, r1, Math.pow(t, pw))).add(c); P.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}
const place = (g, p, r = [0, 0, 0], s = [1, 1, 1]) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s))); return g; };
const white = (g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
// the flesh of the mouth: pale at the lips, darker and redder inward, black down the throat
const flesh = (L, deep = 0) => { const back = 1 - smooth(clamp((L - 0.08) / 0.5, 0, 1)), k = (1 - 0.93 * back) * (1 - 0.5 * deep); return [0.56 * k + 0.02, 0.36 * k * (1 - 0.35 * back) + 0.006, 0.34 * k * (1 - 0.3 * back) + 0.008]; };

function eyeTex() {   // amber, slit-pupilled (the pupil on the +x pole of a sphere)
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#1c0d03'; g.fillRect(0, 0, 256, 128);
  const gr = g.createRadialGradient(128, 64, 3, 128, 64, 62);
  gr.addColorStop(0, '#f2d060'); gr.addColorStop(0.3, '#d8901c'); gr.addColorStop(0.72, '#8a4708'); gr.addColorStop(1, '#2a1003');
  g.fillStyle = gr; g.beginPath(); g.ellipse(128, 64, 62, 60, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(50,16,0,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 80; i++) { const a = i / 80 * TAU + Math.sin(i * 7.3) * 0.05, r0 = 9 + (i % 3) * 3, r1 = 38 + (i * 13 % 20); g.beginPath(); g.moveTo(128 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(128 + Math.cos(a + 0.05) * r1, 64 + Math.sin(a + 0.05) * r1); g.stroke(); }
  g.fillStyle = '#040202'; g.beginPath(); g.ellipse(128, 64, 4.5, 48, 0, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// hide: the body's scaled material (shared, so the head darkens and burns with the rest of him)
export function buildSerpentHead(hide) {
  const head = new THREE.Group(), upper = new THREE.Group(), parts = { upper };
  upper.position.set(...HINGE); head.add(upper);
  const U = (g) => { g.translate(-HINGE[0], -HINGE[1], -HINGE[2]); return g; };   // into the upper skull's frame (it turns about the hinge)
  const mouth = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.2, metalness: 0, side: THREE.DoubleSide });
  const bone = new THREE.MeshStandardMaterial({ color: 0xd8cfae, roughness: 0.22, metalness: 0 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 0.6 });
  const horn = new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.42 });
  // ---- the skull
  const skull = surf(56, 64, (L, th) => {
    const e = END(L), w = W(L) * e, z = zOf(L), lip = serpentLip(L), snout = smooth(clamp((L - 0.5) / 0.2, 0, 1));
    if (th <= Math.PI + 1e-6) {
      const c = Math.cos(th), s = Math.max(0, Math.sin(th)), ac = Math.abs(c);
      let y = lip + HT(L) * e * Math.pow(s, lerp(0.62, 0.42, snout));
      let x = w * Math.sign(c) * Math.pow(ac, lerp(0.74, 0.5, snout));
      y += 0.17 * e * gauss(L, 0.555, 0.085) * gauss(ac, 0.6, 0.2);                        // the brow: a shelf out over the eye
      const orbit = gauss(L, 0.56, 0.06) * gauss(s, 0.5, 0.2) * (ac > 0.5 ? 1 : 0); x *= 1 - 0.12 * orbit;   // the socket under it
      y -= 0.05 * e * gauss(c, 0, 0.2) * smooth(clamp((L - 0.25) / 0.3, 0, 1));            // a furrow down the crown
      y += 0.07 * e * gauss(L, 0.2, 0.13) * gauss(ac, 0.6, 0.3); x *= 1 + 0.05 * gauss(L, 0.22, 0.12) * s;   // the glands, swollen behind the eyes
      x *= 1 - 0.09 * gauss(L, 0.76, 0.06) * gauss(s, 0.45, 0.25);                         // pinched at the heat pits
      y += 0.07 * smooth(clamp((L - 0.9) / 0.1, 0, 1)) * s;                                // the snout a little upturned
      const k = 0.9 + 0.2 * s;   // scales pale along the lip, the labials
      return [x, y, z, th / TAU, L * 2.6, k, k, k];
    }
    const c = Math.cos(th), s = -Math.sin(th), f = flesh(L, s * 0.5), ridge = 0.9 + 0.1 * Math.cos(L * 60);
    return [w * 0.96 * c, lip + (0.2 * e * s * Math.sin(Math.PI * clamp(L * 1.1, 0, 1)) - 0.02), z, th / TAU, L * 2.4, f[0] * ridge, f[1] * ridge, f[2] * ridge];   // the palate, vaulted up into the head
  });
  upper.add(new THREE.Mesh(U(skull), [hide, mouth]));
  // teeth along the palate, raked back
  const tg = []; for (const sx of [-1, 1]) for (let i = 0; i < 10; i++) { const L = 0.3 + i * 0.06, w = W(L); tg.push(place(new THREE.ConeGeometry(0.03, 0.17, 5), [sx * (w * 0.84 - 0.05), serpentLip(L) - 0.07, zOf(L)], [Math.PI - 0.5, 0, 0])); tg.push(place(new THREE.ConeGeometry(0.022, 0.12, 5), [sx * w * 0.36, serpentLip(L) + 0.1, zOf(L)], [Math.PI - 0.5, 0, 0])); }
  upper.add(new THREE.Mesh(U(mergeGeometries(tg)), bone));
  // the fangs: long, curved and hollow, folded back along the palate until the mouth gapes; each in a sheath of flesh
  parts.fangs = [];
  for (const sx of [-1, 1]) {
    const L = 0.85, f = new THREE.Group(); f.position.set(sx * (W(L) * 0.6) - HINGE[0], serpentLip(L) - 0.02 - HINGE[1], zOf(L) - HINGE[2]);
    f.add(new THREE.Mesh(taper([[0, 0, 0], [0, -0.26, -0.02], [0, -0.5, -0.11], [0, -0.68, -0.28]], 0.07, 0.004, 8, 1.2), bone));
    const sh = taper([[0, 0.04, 0.02], [0, -0.14, 0.0], [0, -0.3, -0.04]], 0.12, 0.074, 10, 1), sc = []; for (let i = 0; i < sh.attributes.position.count; i++) { const t = clamp(-sh.attributes.position.getY(i) / 0.3, 0, 1); sc.push(0.5 - 0.15 * t, 0.26 - 0.1 * t, 0.26 - 0.1 * t); }
    sh.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3)); f.add(new THREE.Mesh(sh, mouth));
    upper.add(f); parts.fangs.push(f);
  }
  // eyes: amber, slit-pupilled, wet, far in under the brow
  const et = eyeTex(), em = new THREE.MeshPhysicalMaterial({ map: et, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });
  parts.eyes = [];
  for (const sx of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), em); m.position.set(sx * 0.6 - HINGE[0], serpentLip(0.56) + 0.36 - HINGE[1], zOf(0.56) - HINGE[2]); m.rotation.y = sx > 0 ? -0.45 : Math.PI + 0.45; upper.add(m); parts.eyes.push(m); }
  // horns over the eyes (a horned viper's), and a ragged crown of lesser spines behind them
  const hg = [];
  for (const sx of [-1, 1]) {
    for (const [dz, len, lean] of [[0.02, 0.62, 0.05], [-0.2, 0.42, 0.09], [-0.42, 0.26, 0.14]]) hg.push(place(taper([[0, 0, 0], [sx * lean * 0.5, len * 0.55, -len * 0.2], [sx * lean, len * 0.96, -len * 0.55]], 0.085, 0.006, 8, 0.9), [sx * 0.52, serpentLip(0.555) + 0.6, zOf(0.555) + dz]));
    for (let i = 0; i < 5; i++) { const L = 0.36 - i * 0.06, len = 0.2 - i * 0.02; hg.push(place(taper([[0, 0, 0], [sx * 0.03, len * 0.6, -len * 0.3], [sx * 0.06, len, -len * 0.75]], 0.05, 0.005, 6, 0.9), [sx * W(L) * 0.74, serpentLip(L) + HT(L) * 0.86, zOf(L)])); }
  }
  upper.add(new THREE.Mesh(U(mergeGeometries(hg)), horn));
  // nostrils, and the heat pits between eye and nostril
  const dg = []; for (const sx of [-1, 1]) { dg.push(place(new THREE.SphereGeometry(0.055, 10, 8), [sx * 0.2, serpentLip(0.975) + 0.2, zOf(0.975)], [0, 0, 0], [1, 0.7, 1])); dg.push(place(new THREE.SphereGeometry(0.07, 10, 8), [sx * (W(0.77) * 0.9), serpentLip(0.77) + 0.16, zOf(0.77)], [0, 0, 0], [0.5, 1, 1])); }
  upper.add(new THREE.Mesh(U(mergeGeometries(dg)), dark));
  // ---- the lower jaw, hinged far back: a scaled hull, a thick lip, and inside it the sunken floor of the mouth
  const jaw = new THREE.Group(); jaw.position.set(...HINGE); head.add(jaw); parts.jaw = jaw;
  const JZ0 = -0.45, JZ1 = 2.55, jz = (L) => lerp(JZ0, JZ1, L), jw = (L) => W(L * 0.96) * 0.93, jlip = (L) => serpentLip(L * 0.96) - 0.035;
  const jg = surf(44, 56, (L, th) => {
    const e = END(L * 0.96) * (L > 0.94 ? 1 - smooth((L - 0.94) / 0.06) * 0.5 : 1), w = jw(L) * e, z = jz(L), top = jlip(L), c = Math.cos(th);
    if (th <= Math.PI + 1e-6) {   // inside: the lip, then down into the trough; the windpipe standing in it, the sheath of the tongue ahead
      const s = Math.max(0, Math.sin(th)), ac = Math.abs(c), inn = smooth(clamp((1 - ac) / 0.22, 0, 1));
      let y = top - 0.2 * e * inn * (0.55 + 0.45 * Math.sin(Math.PI * clamp(L * 1.05, 0, 1)));
      const gl = gauss(c, 0, 0.16) * (smooth(clamp((L - 0.3) / 0.08, 0, 1)) * (1 - smooth(clamp((L - 0.5) / 0.05, 0, 1)))); y += 0.11 * gl;
      y += 0.05 * gauss(c, 0, 0.2) * gauss(L, 0.74, 0.1);
      const f = flesh(L, inn * 0.6), hole = gauss(c, 0, 0.08) * gauss(L, 0.5, 0.025), fold = 0.92 + 0.08 * Math.cos(c * 26);
      const k = (1 - 0.92 * hole) * fold * lerp(0.35, 1, smooth(clamp(inn * 2.5, 0, 1)));   // the lip itself dark
      return [w * c, y, z, th / TAU, L * 2.2, f[0] * k, f[1] * k, f[2] * k, s];
    }
    const s = -Math.sin(th), dep = lerp(0.56, 0.15, Math.pow(L, 0.8)) * e;
    const k = 0.9 + 0.2 * (1 - s);
    return [w * Math.sign(c) * Math.pow(Math.abs(c), 0.78), top - dep * Math.pow(s, 0.72), z, th / TAU, L * 2.2, k, k, k];
  });
  jg.translate(-HINGE[0], -HINGE[1], -HINGE[2]); jaw.add(new THREE.Mesh(jg, [mouth, hide]));
  const lt = []; for (const sx of [-1, 1]) for (let i = 0; i < 10; i++) { const L = 0.3 + i * 0.062, w = jw(L); lt.push(place(new THREE.ConeGeometry(0.026, 0.14, 5), [sx * (w * 0.8) - HINGE[0], jlip(L) + 0.0 - HINGE[1], jz(L) - HINGE[2]], [0.4, 0, sx * 0.25])); }
  jaw.add(new THREE.Mesh(mergeGeometries(lt), bone));
  // the forked tongue, slid out through the notch in the lips to taste the air
  const tongue = new THREE.Group(), tm = new THREE.MeshStandardMaterial({ color: 0x1a0507, roughness: 0.25 });
  tongue.add(new THREE.Mesh(taper([[0, 0, 0], [0, 0.01, 0.5], [0, 0, 1.0]], 0.055, 0.032, 7, 1), tm));
  for (const sx of [-1, 1]) tongue.add(new THREE.Mesh(taper([[0, 0, 0.98], [sx * 0.05, 0.01, 1.2], [sx * 0.14, -0.01, 1.5]], 0.03, 0.004, 6, 1), tm));
  tongue.position.set(0, serpentLip(0.5) - 0.06, 1.15); tongue.scale.setScalar(0.001); head.add(tongue); parts.tongue = tongue;
  // ---- the cheeks: skin stretched between the jaws, rebuilt as they open; and ropes of spittle
  const CN = 9, CM = 5, cpos = new Float32Array(2 * (CN + 1) * (CM + 1) * 3), ccol = [], cidx = [];
  for (let sd = 0; sd < 2; sd++) for (let i = 0; i <= CN; i++) for (let j = 0; j <= CM; j++) { const t = j / CM, f = flesh(0.12 + 0.3 * i / CN, 0.3), k = 0.55 + 0.45 * Math.sin(Math.PI * t); ccol.push(f[0] * k, f[1] * k, f[2] * k); }
  for (let sd = 0; sd < 2; sd++) for (let i = 0; i < CN; i++) for (let j = 0; j < CM; j++) { const a = sd * (CN + 1) * (CM + 1) + i * (CM + 1) + j, b = a + 1, c = a + CM + 1, d = c + 1; cidx.push(a, b, c, b, d, c); }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cpos, 3).setUsage(THREE.DynamicDrawUsage)); cg.setAttribute('color', new THREE.Float32BufferAttribute(ccol, 3)); cg.setIndex(cidx);
  const cheeks = new THREE.Mesh(cg, mouth); cheeks.frustumCulled = false; head.add(cheeks);
  const SP = [[0.5, 0.42], [-0.44, 0.5], [0.3, 0.62], [-0.62, 0.36]], strands = [], sm = new THREE.MeshStandardMaterial({ color: 0xc8c4b0, roughness: 0.08, transparent: true, opacity: 0.5, depthWrite: false });
  for (const [fx, L] of SP) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1, 5, 1, true), sm); m.scale.setScalar(0.001); head.add(m); strands.push({ m, fx, L }); }
  head.traverse((o) => { if (o.isMesh) { o.castShadow = o.material !== sm; o.receiveShadow = true; } });
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  // open the mouth: g 0 shut .. 1 the full gape of a strike
  parts.gape = (g, time = 0) => {
    const au = -0.34 * g, aj = 0.86 * g; upper.rotation.x = au; jaw.rotation.x = aj;
    const fang = lerp(1.32, -0.12, smooth(clamp(g * 1.7, 0, 1))); for (const f of parts.fangs) f.rotation.x = fang;
    const rot = (v, a) => { const y = v.y - HINGE[1], z = v.z - HINGE[2], c = Math.cos(a), s = Math.sin(a); v.y = HINGE[1] + y * c - z * s; v.z = HINGE[2] + y * s + z * c; return v; };
    let o = 0;
    for (const sx of [1, -1]) for (let i = 0; i <= CN; i++) {
      const L = 0.03 + 0.4 * i / CN;
      rot(_a.set(sx * W(L) * END(L) * 0.93, serpentLip(L) + 0.02, zOf(L)), au); rot(_b.set(sx * jw(L) * END(L * 0.96) * 0.9, jlip(L) - 0.03, jz(L)), aj);
      for (let j = 0; j <= CM; j++) { const t = j / CM, bow = Math.sin(Math.PI * t) * (0.1 + 0.1 * g) * (0.4 + 0.6 * i / CN); cpos[o++] = lerp(_a.x, _b.x, t) * (1 - bow); cpos[o++] = lerp(_a.y, _b.y, t); cpos[o++] = lerp(_a.z, _b.z, t) - bow * 0.5; }
    }
    cg.attributes.position.needsUpdate = true; cg.computeVertexNormals();
    for (const S of strands) {
      rot(_a.set(S.fx * W(S.L), serpentLip(S.L) - 0.02, zOf(S.L)), au); rot(_b.set(S.fx * jw(S.L) * 0.9, jlip(S.L) - 0.12, jz(S.L)), aj);
      const len = _a.distanceTo(_b), show = g > 0.12 && len < 2.3 ? clamp((g - 0.12) * 6, 0, 1) * clamp((2.3 - len) * 2, 0, 1) : 0;
      S.m.position.copy(_a).add(_b).multiplyScalar(0.5); S.m.quaternion.setFromUnitVectors(up, _b.sub(_a).normalize()); S.m.scale.set(show * (1.2 - 0.35 * len) + 0.001, Math.max(0.001, len), show * (1.2 - 0.35 * len) + 0.001);
    }
  };
  parts.gape(0);
  return { head, parts };
}
