// Articulated plate harness, built piece by piece around the rig.
// Three period styles (c. 1480–1530):
//   gothic     — German Gothic: rippled flutes, sallet & bevor, pointed sabatons
//   maximilian — fluted "Maximilian": bellows-visor armet, haute-pieces, bear-paw toes
//   milanese   — smooth Italian: armet with rondel, large asymmetric pauldrons
// Lames that cross a joint are mounted on "followers" which take a fraction
// of the next joint's rotation, so they fan and slide like real articulations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { armorTextures, mailTextures, clothTextures, leatherTextures, FINISHES } from './textures.js';
import { clamp, lerp, smooth } from './util.js';

const PI = Math.PI;

export const STYLES = {
  gothic:     { name: 'Gothic',     desc: 'Light, rippled steel. Fast footwork, quick recovery.', speed: 1.08, armor: 0.85, stamina: 1.18, flutes: 22, fluteDepth: 0.0045, pointedToe: true, helm: 'sallet', pauldron: 0.95, haute: false },
  maximilian: { name: 'Maximilian', desc: 'Fluted plate, balanced protection and pace.', speed: 1.0, armor: 1.0, stamina: 1.0, flutes: 30, fluteDepth: 0.003, bearPaw: true, helm: 'bellows', pauldron: 1.05, haute: true },
  milanese:   { name: 'Milanese',   desc: 'Smooth, heavy Italian plate. Slow, nearly unbreakable.', speed: 0.92, armor: 1.22, stamina: 0.9, flutes: 0, fluteDepth: 0, roundToe: true, helm: 'armet', pauldron: 1.2, haute: true, grandGuard: true },
};

// ---------------------------------------------------------------- geometry helpers
function surf(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv; const p = fn(u, v);
    pos.push(p[0], p[1], p[2]); uv.push(u, v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Rolled edge along one boundary of a surface
function edge(fn, which, r = 0.0055, n = 32) {
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n; const p = which === 'v0' ? fn(t, 0) : which === 'v1' ? fn(t, 1) : which === 'u0' ? fn(0, t) : fn(1, t);
    pts.push(new THREE.Vector3(p[0], p[1], p[2]));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, r, 5, false);
}
function tubeAlong(points, r, seg = 24, radial = 6) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), seg, r, radial, false);
}
function xf(g, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'YXZ')), new THREE.Vector3(...s));
  g.applyMatrix4(m); return g;
}
function rivet(p, r = 0.0055) { return xf(new THREE.SphereGeometry(r, 6, 4, 0, PI * 2, 0, PI / 2), { p, r: [0, 0, 0] }); }
// rivet placed on a surface point, oriented along local normal (approx using provided outward dir)
function rivetOut(p, dir, r = 0.0055) {
  const g = new THREE.SphereGeometry(r, 6, 4, 0, PI * 2, 0, PI / 2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// Generic elliptical shell around a vertical axis (local y), front at +Z.
//  a0..a1: angle range (radians, 0 = front), y0..y1: height range,
//  rx(v), rz(v): radii, extra(theta, v): radial offset (ridges, flutes)
function shell({ a0, a1, y0, y1, rx, rz, extra, nu = 40, nv = 16, cx = 0, cz = 0, aOfV, yOfU }) {
  const fn = (u, v) => {
    let A0 = a0, A1 = a1;
    if (aOfV) [A0, A1] = aOfV(v);
    const th = lerp(A0, A1, u);
    let y = lerp(y0, y1, v); if (yOfU) y += yOfU(th, v);
    const ex = extra ? extra(th, v) : 0;
    const X = (rx(v) + ex) * Math.sin(th), Z = (rz(v) + ex) * Math.cos(th);
    return [cx + X, y, cz + Z];
  };
  return { fn, geo: surf(fn, nu, nv) };
}
function flute(style, scale = 1) {
  if (!style.flutes) return null;
  return (th, v) => {
    const f = Math.sin(th * style.flutes * scale) * style.fluteDepth;
    const fade = smooth(clamp(v * 3, 0, 1)) * smooth(clamp((1 - v) * 3, 0, 1));
    return f * fade;
  };
}

// ---------------------------------------------------------------- the harness
// Each part: { joint, follow?: {joint, k, pivot}, mat, geo }
export function buildHarness(style, opts = {}) {
  const S = STYLES[style];
  const parts = [];
  const add = (joint, mat, geo, follow) => parts.push({ joint, mat, geo, follow });
  const fl = flute(S);

  // ---------------- under-layer: arming doublet, mail skirt, voiders
  add('chest', 'cloth', xf(new THREE.CylinderGeometry(0.155, 0.135, 0.42, 16, 1, true), { p: [0, -0.02, -0.005], s: [1, 1, 0.82] }));
  add('spine', 'cloth', xf(new THREE.CylinderGeometry(0.14, 0.15, 0.2, 16, 1, true), { p: [0, 0.03, 0], s: [1, 1, 0.8] }));
  add('hips', 'mail', xf(new THREE.CylinderGeometry(0.165, 0.215, 0.26, 20, 1, true), { p: [0, -0.10, 0], s: [1, 1, 0.82] }));
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    add('uArm' + s, 'mail', xf(new THREE.SphereGeometry(0.06, 10, 8), { p: [0, -0.03, 0], s: [1, 1.1, 1] })); // armpit voider
    add('uArm' + s, 'cloth', xf(new THREE.CylinderGeometry(0.048, 0.045, 0.30, 10, 1, true), { p: [0, -0.15, 0] }));
    add('fArm' + s, 'mail', xf(new THREE.SphereGeometry(0.046, 10, 8), { p: [0, 0.0, 0] })); // inner elbow mail
    add('fArm' + s, 'cloth', xf(new THREE.CylinderGeometry(0.042, 0.034, 0.26, 10, 1, true), { p: [0, -0.13, 0] }));
    add('thigh' + s, 'cloth', xf(new THREE.CylinderGeometry(0.078, 0.058, 0.45, 12, 1, true), { p: [0, -0.22, 0] }));
    add('shin' + s, 'mail', xf(new THREE.SphereGeometry(0.055, 10, 8), { p: [0, 0.0, -0.01] })); // back of knee
    add('shin' + s, 'cloth', xf(new THREE.CylinderGeometry(0.05, 0.036, 0.42, 10, 1, true), { p: [0, -0.21, 0] }));
    // leather straps securing the cuisses
    add('thigh' + s, 'leather', xf(new THREE.TorusGeometry(0.074, 0.006, 4, 16, PI * 0.9), { p: [0, -0.12, 0], r: [PI / 2, 0, PI * 0.55] }));
    add('thigh' + s, 'leather', xf(new THREE.TorusGeometry(0.066, 0.006, 4, 16, PI * 0.9), { p: [0, -0.30, 0], r: [PI / 2, 0, PI * 0.55] }));
  }
  // sword belt + rondel dagger on the right hip
  add('hips', 'leather', xf(new THREE.TorusGeometry(0.2, 0.012, 4, 24), { p: [0, -0.05, 0], r: [PI / 2, 0, 0], s: [1, 0.82, 1] }));
  const dag = [];
  dag.push(xf(new THREE.CylinderGeometry(0.012, 0.01, 0.22, 6), { p: [0, -0.11, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 12), { p: [0, 0.0, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.009, 0.009, 0.09, 6), { p: [0, 0.05, 0] }));
  dag.push(xf(new THREE.CylinderGeometry(0.026, 0.026, 0.008, 12), { p: [0, 0.10, 0] }));
  add('hips', 'leather', xf(mergeGeometries(dag), { p: [-0.2, -0.12, -0.04], r: [0.25, 0, 0.15] }));

  // ---------------- cuirass: breastplate (chest joint)
  const bp = shell({
    a0: -1.85, a1: 1.85, y0: -0.235, y1: 0.185,
    aOfV: (v) => { const m = lerp(1.85, 1.25, smooth(clamp((v - 0.55) / 0.45, 0, 1))); return [-m, m]; },
    rx: (v) => lerp(0.158, 0.192, smooth(clamp(v * 1.6, 0, 1))) - Math.max(0, v - 0.85) * 0.2,
    rz: (v) => lerp(0.128, 0.162, smooth(clamp(v * 1.4, 0, 1))) - Math.max(0, v - 0.8) * 0.18,
    extra: (th, v) => {
      const keel = 0.022 * Math.exp(-((th / 0.38) ** 2)) * smooth(clamp(v * 2, 0, 1)) * (1 - smooth(clamp((v - 0.8) * 5, 0, 1)));
      return keel + (fl ? fl(th, v) : 0) + (style === 'maximilian' ? 0.012 * Math.sin(v * PI) : 0);
    },
    yOfU: (th, v) => v > 0.85 ? -0.055 * Math.pow(Math.cos(th * 0.95), 6) * (v - 0.85) / 0.15 : 0, // neck scoop
    cz: 0.005, nu: 48, nv: 18,
  });
  add('chest', 'plate', bp.geo);
  add('chest', 'trim', edge(bp.fn, 'v1', 0.0075, 40));
  add('chest', 'trim', edge(bp.fn, 'u0', 0.006, 24)); add('chest', 'trim', edge(bp.fn, 'u1', 0.006, 24));
  // gussets (articulated armpit lames) on breastplate
  for (const s of [-1, 1]) {
    const gs = shell({ a0: s > 0 ? 0.9 : -1.4, a1: s > 0 ? 1.4 : -0.9, y0: 0.06, y1: 0.12, rx: () => 0.2, rz: () => 0.17, nu: 10, nv: 3 });
    add('chest', 'plate', gs.geo); add('chest', 'trim', edge(gs.fn, 'v1', 0.004, 12));
  }
  // backplate
  const bk = shell({
    a0: 1.75, a1: PI * 2 - 1.75, y0: -0.235, y1: 0.165,
    rx: (v) => lerp(0.152, 0.186, smooth(clamp(v * 1.6, 0, 1))),
    rz: (v) => lerp(0.118, 0.13, smooth(v)),
    extra: (th, v) => (fl ? fl(th, v) * 0.7 : 0),
    cz: -0.005, nu: 36, nv: 14,
  });
  add('chest', 'plate', bk.geo); add('chest', 'trim', edge(bk.fn, 'v1', 0.0065, 30));
  // shoulder straps & buckles
  for (const s of [-1, 1]) {
    add('chest', 'leather', tubeAlong([[s * 0.1, 0.16, 0.13], [s * 0.12, 0.21, 0.02], [s * 0.1, 0.17, -0.12]], 0.006, 12, 4));
    add('chest', 'brass', rivetOut([s * 0.1, 0.155, 0.14], [0, 0.3, 1], 0.009));
  }
  // rivets along the breastplate's waist
  for (let i = -5; i <= 5; i++) { const th = i * 0.3; add('chest', 'brass', rivetOut([0.162 * Math.sin(th), -0.21, 0.135 * Math.cos(th) + 0.005], [Math.sin(th), 0, Math.cos(th)], 0.0055)); }
  // lance rest (arrêt) on the right breast
  add('chest', 'plate', xf(new THREE.BoxGeometry(0.012, 0.03, 0.06), { p: [-0.11, -0.02, 0.15], r: [0, -0.5, 0] }));

  // plackart (spine joint — slides under the breastplate as the torso bends)
  const pk = shell({
    a0: -1.3, a1: 1.3, y0: -0.07, y1: 0.12,
    aOfV: (v) => { const m = lerp(1.3, style === 'gothic' ? 0.25 : 0.7, smooth(clamp((v - 0.4) / 0.6, 0, 1))); return [-m, m]; },
    rx: () => 0.158, rz: () => 0.14, extra: (th, v) => (fl ? fl(th, v) : 0) + 0.006, nu: 30, nv: 10,
  });
  add('spine', 'plate', pk.geo); add('spine', 'trim', edge(pk.fn, 'v1', 0.005, 24));
  // culet lames over the small of the back
  for (let i = 0; i < 2; i++) {
    const c = shell({ a0: 2.0, a1: PI * 2 - 2.0, y0: -0.05 - i * 0.05, y1: 0.0 - i * 0.05, rx: () => 0.16 + i * 0.008, rz: () => 0.125 + i * 0.008, nu: 20, nv: 3 });
    add('spine', 'plate', c.geo); add('spine', 'trim', edge(c.fn, 'v0', 0.004, 16));
  }

  // fauld: three hooped lames (hips)
  for (let i = 0; i < 3; i++) {
    const r0 = 0.17 + i * 0.012, z0 = 0.145 + i * 0.012;
    const f = shell({ a0: -1.95, a1: 1.95, y0: 0.0 - i * 0.05, y1: 0.06 - i * 0.05, rx: (v) => r0 + (1 - v) * 0.012, rz: (v) => z0 + (1 - v) * 0.012, extra: fl ? (th, v) => fl(th, 0.5) * 0.6 : null, nu: 32, nv: 3 });
    add('hips', 'plate', f.geo); add('hips', 'trim', edge(f.fn, 'v0', 0.0045, 24));
    if (i === 0) for (const s of [-1, 1]) add('hips', 'brass', rivetOut([s * r0 * Math.sin(1.7), 0.03, z0 * Math.cos(1.7)], [s, 0, 0], 0.006));
  }
  // tassets: four lames each, hung from the fauld, following the thigh by half
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    for (let i = 0; i < 4; i++) {
      const t = shell({
        a0: -0.95, a1: 0.95, y0: -0.07 - i * 0.055, y1: -0.0 - i * 0.055,
        rx: () => 0.105 + i * 0.002, rz: () => 0.075 + i * 0.002, cz: 0.02, nu: 18, nv: 3,
        extra: fl ? (th, v) => fl(th * 1.5, 0.5) * 0.5 : null,
      });
      const g = xf(t.geo, { r: [0, sx * 0.35, 0] });
      add('hips', 'plate', g, { joint: 'thigh' + s, k: 0.25 + i * 0.12, pivot: [sx * 0.10, -0.06, 0.0] });
      add('hips', 'trim', xf(edge(t.fn, 'v0', 0.004, 14), { r: [0, sx * 0.35, 0] }), { joint: 'thigh' + s, k: 0.25 + i * 0.12, pivot: [sx * 0.10, -0.06, 0.0] });
    }
  }

  // ---------------- gorget (chest) + top lame following the neck
  for (let i = 0; i < 3; i++) {
    const r = 0.105 - i * 0.008;
    const g = shell({ a0: 0, a1: PI * 2, y0: 0.15 + i * 0.03, y1: 0.19 + i * 0.03, rx: (v) => r + (1 - v) * 0.03, rz: (v) => r * 0.95 + (1 - v) * 0.025, nu: 28, nv: 3 });
    if (i < 2) { add('chest', 'plate', g.geo); add('chest', 'trim', edge(g.fn, 'v1', 0.0045, 24)); }
    else { add('chest', 'plate', g.geo, { joint: 'neck', k: 0.5, pivot: [0, 0.2, 0] }); add('chest', 'trim', edge(g.fn, 'v1', 0.0045, 24), { joint: 'neck', k: 0.5, pivot: [0, 0.2, 0] }); }
  }

  // ---------------- helmet (head joint; skull centre ~ +0.11)
  buildHelm(S, style, add, opts);

  // ---------------- arms
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    const big = S.grandGuard && s === 'L' ? 1.18 : 1;
    const ps = S.pauldron * big;
    // pauldron cap on the clavicle joint, sitting over the shoulder ball
    const cap = surf((u, v) => {
      const th = lerp(-1.9, 1.9, u); const ph = lerp(0, 1.45, v);
      const R = 0.105 * ps;
      const flt = S.flutes ? Math.sin(th * 7) * 0.003 * Math.sin(v * PI) : 0;
      return [sx * 0.15 + sx * Math.sin(ph) * (R + flt) * 1.05 * Math.abs(Math.cos(th * 0.25)) + sx * 0.012, 0.03 + Math.cos(ph) * R * 0.9, Math.sin(ph) * Math.sin(th) * (R + flt) * 1.12];
    }, 28, 12);
    add('clav' + s, 'plate', cap);
    for (let i = 0; i < 3; i++) {
      // lames hang from the cap, follow the upper arm progressively
      const lame = surf((u, v) => {
        const th = lerp(-2.0, 2.0, u); const R = (0.1 + i * 0.002) * ps;
        const y = -0.012 - i * 0.034 - v * 0.04;
        return [sx * 0.15 + sx * Math.abs(Math.cos(th * 0.5)) * R * 0.95 * (1 + v * 0.06), y, Math.sin(th) * R * 1.05 * (1 + v * 0.05)];
      }, 22, 3);
      add('clav' + s, 'plate', lame, { joint: 'uArm' + s, k: 0.3 + i * 0.22, pivot: [sx * 0.15, 0, 0], composeWithParent: false });
      add('clav' + s, 'trim', edge((u, v) => {
        const th = lerp(-2.0, 2.0, u); const R = (0.1 + i * 0.002) * ps; const y = -0.012 - i * 0.034 - 0.04;
        return [sx * 0.15 + sx * Math.abs(Math.cos(th * 0.5)) * R * 0.95 * 1.06, y, Math.sin(th) * R * 1.05 * 1.05];
      }, 'u0', 0.004, 18), { joint: 'uArm' + s, k: 0.3 + i * 0.22, pivot: [sx * 0.15, 0, 0] });
    }
    if (S.haute) { // haute-piece: upstanding neck guard flange on the pauldron
      const h = surf((u, v) => { const t = lerp(-0.9, 0.9, u); return [sx * (0.1 + 0.02 * v), 0.11 * ps + v * 0.06, Math.sin(t) * 0.09 * ps]; }, 12, 3);
      add('clav' + s, 'plate', h); add('clav' + s, 'trim', edge((u) => { const t = lerp(-0.9, 0.9, u); return [sx * 0.12, 0.11 * ps + 0.06, Math.sin(t) * 0.09 * ps]; }, 'u0', 0.005, 12));
    }
    // rosette rivets on the cap
    add('clav' + s, 'brass', rivetOut([sx * 0.22 * ps, 0.07, 0.0], [sx, 0.6, 0], 0.008));
    // rerebrace (upper arm)
    const rr = shell({ a0: 0, a1: PI * 2, y0: -0.25, y1: -0.07, rx: (v) => lerp(0.05, 0.056, v), rz: (v) => lerp(0.047, 0.054, v), extra: S.flutes ? (th, v) => Math.sin(th * 9) * 0.0018 : null, nu: 20, nv: 6 });
    add('uArm' + s, 'plate', rr.geo); add('uArm' + s, 'trim', edge(rr.fn, 'v1', 0.004, 18));
    // couter: elbow cop with a heart-shaped side wing; follows the forearm by half
    const cop = xf(new THREE.SphereGeometry(0.058, 16, 10, 0, PI * 2, 0, PI * 0.55), { r: [-PI / 2, 0, 0], p: [0, 0, -0.012] });
    const wing = surf((u, v) => { const a = lerp(-1.3, 1.3, u); const r = 0.075 * (1 - v * 0.35) * (0.6 + 0.4 * Math.cos(a * 1.2)); return [sx * (0.05 + v * 0.008), Math.sin(a) * r, -Math.cos(a) * r * 0.55 - 0.01]; }, 14, 4);
    add('uArm' + s, 'plate', xf(mergeGeometries([cop, wing]), { p: [0, -0.30, 0] }), { joint: 'fArm' + s, k: 0.5, pivot: [0, -0.30, 0] });
    for (let i = 0; i < 2; i++) { // couter lames above & below
      const l = shell({ a0: 1.6, a1: PI * 2 - 1.6, y0: -0.265 + i * -0.055, y1: -0.245 + i * -0.055, rx: () => 0.056, rz: () => 0.056, nu: 12, nv: 2 });
      add('uArm' + s, 'plate', l.geo, { joint: 'fArm' + s, k: i ? 0.75 : 0.25, pivot: [0, -0.30, 0] });
    }
    // vambrace (forearm), closed, tapering to the wrist
    const vb = shell({ a0: 0, a1: PI * 2, y0: -0.235, y1: -0.04, rx: (v) => lerp(0.04, 0.05, v), rz: (v) => lerp(0.036, 0.047, v), nu: 18, nv: 6 });
    add('fArm' + s, 'plate', vb.geo); add('fArm' + s, 'trim', edge(vb.fn, 'v0', 0.0035, 16));
    // gauntlet: flared cuff, metacarpal plate, finger lames over a gloved fist
    const cuff = new THREE.LatheGeometry([new THREE.Vector2(0.040, 0.0), new THREE.Vector2(0.046, 0.03), new THREE.Vector2(0.058, 0.07)], 16);
    add('hand' + s, 'plate', xf(cuff, { p: [0, -0.02, 0] }));
    add('hand' + s, 'leather', xf(new THREE.BoxGeometry(0.05, 0.095, 0.075, 2, 3, 2), { p: [0, -0.07, 0.008] }));
    const meta = surf((u, v) => { const a = lerp(-1.2, 1.2, u); return [sx * (0.024 + 0.006 * Math.cos(a)) * 1, -0.02 - v * 0.055, Math.sin(a) * 0.04 + 0.008]; }, 10, 4);
    add('hand' + s, 'plate', meta);
    for (let i = 0; i < 4; i++) {
      const fl2 = surf((u, v) => { const a = lerp(-1.3, 1.3, u); const ang = 0.4 + i * 0.42 + v * 0.38; const R = 0.03; return [sx * Math.cos(ang) * R * 1.05, -0.078 - Math.sin(ang) * R * 0.7 - i * 0.004, Math.sin(a) * 0.041 + 0.008]; }, 8, 2);
      add('hand' + s, 'plate', fl2);
    }
    add('hand' + s, 'plate', xf(new THREE.CapsuleGeometry(0.012, 0.03, 3, 6), { p: [-sx * 0.012, -0.06, 0.045], r: [0.9, 0, -sx * 0.5] })); // thumb
  }

  // ---------------- legs
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? -1 : 1;
    // cuisse: front and outer thigh
    const cu = shell({ a0: -2.1, a1: 2.1, y0: -0.37, y1: -0.02, rx: (v) => lerp(0.066, 0.086, v), rz: (v) => lerp(0.064, 0.086, v), extra: fl ? (th, v) => fl(th * 0.6, v) : null, cz: 0.004, nu: 24, nv: 10 });
    add('thigh' + s, 'plate', cu.geo); add('thigh' + s, 'trim', edge(cu.fn, 'v1', 0.005, 20));
    // poleyn: knee cop + outer wing, following the shin by half
    const kc = xf(new THREE.SphereGeometry(0.062, 16, 10, 0, PI * 2, 0, PI * 0.55), { r: [PI / 2, 0, 0], p: [0, 0, 0.018] });
    const kw = surf((u, v) => { const a = lerp(-1.4, 1.4, u); const r = 0.075 * (1 - v * 0.3) * (0.55 + 0.45 * Math.cos(a)); return [sx * (0.058 + v * 0.01), Math.sin(a) * r, Math.cos(a) * r * 0.5]; }, 14, 4);
    add('thigh' + s, 'plate', xf(mergeGeometries([kc, kw]), { p: [0, -0.45, 0] }), { joint: 'shin' + s, k: 0.5, pivot: [0, -0.45, 0] });
    add('thigh' + s, 'brass', rivetOut([0, -0.45, 0.083], [0, 0, 1], 0.008), { joint: 'shin' + s, k: 0.5, pivot: [0, -0.45, 0] });
    for (let i = 0; i < 2; i++) {
      const l = shell({ a0: -1.6, a1: 1.6, y0: -0.41 + i * -0.065, y1: -0.385 + i * -0.065, rx: () => 0.066, rz: () => 0.07, cz: 0.006, nu: 12, nv: 2 });
      add('thigh' + s, 'plate', l.geo, { joint: 'shin' + s, k: i ? 0.8 : 0.2, pivot: [0, -0.45, 0] });
    }
    // greave: closed, shaped to the calf
    const gr = shell({
      a0: 0, a1: PI * 2, y0: -0.405, y1: -0.05,
      rx: (v) => lerp(0.042, 0.054, smooth(v)) + Math.sin(v * PI) * 0.006,
      rz: (v) => lerp(0.042, 0.052, smooth(v)),
      extra: (th, v) => { const calf = Math.max(0, -Math.cos(th)) * 0.016 * Math.exp(-(((v - 0.68) / 0.22) ** 2)); const shinR = Math.max(0, Math.cos(th)) * 0.004 * Math.exp(-((th / 0.3) ** 2)); return calf + shinR; },
      nu: 24, nv: 12,
    });
    add('shin' + s, 'plate', gr.geo); add('shin' + s, 'trim', edge(gr.fn, 'v1', 0.0045, 22)); add('shin' + s, 'trim', edge(gr.fn, 'v0', 0.004, 22));
    // sabaton: overlapping lames from instep to toe
    const toeLen = S.pointedToe ? 0.24 : S.bearPaw ? 0.18 : 0.2;
    const lames = 6;
    for (let i = 0; i < lames; i++) {
      const t0 = i / lames, t1 = (i + 1.25) / lames;
      const z0 = lerp(-0.02, toeLen, t0), z1 = lerp(-0.02, toeLen, Math.min(1, t1));
      const width = (t) => {
        if (S.bearPaw) return lerp(0.048, 0.07, smooth(t));
        if (S.pointedToe) return lerp(0.048, 0.008, Math.pow(t, 1.6));
        return lerp(0.048, 0.04, t);
      };
      const height = (t) => lerp(0.058, S.pointedToe ? 0.012 : 0.026, smooth(t));
      const sab = surf((u, v) => {
        const a = lerp(-1.6, 1.6, u); const z = lerp(z0, z1, v); const t = clamp((z + 0.02) / (toeLen + 0.02), 0, 1);
        return [Math.sin(a) * width(t), -0.075 + Math.cos(a) * height(t) * (1 - t * 0.2), z];
      }, 12, 2);
      add('foot' + s, 'plate', sab);
    }
    add('foot' + s, 'leather', xf(new THREE.BoxGeometry(0.1, 0.02, toeLen + 0.08), { p: [0, -0.072, toeLen / 2 - 0.03] })); // sole
    const heel = shell({ a0: 2.0, a1: PI * 2 - 2.0, y0: -0.07, y1: -0.02, rx: () => 0.046, rz: () => 0.05, nu: 10, nv: 2 });
    add('foot' + s, 'plate', heel.geo);
    add('foot' + s, 'plate', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 4), { p: [0, -0.06, -0.075], r: [PI / 2, 0, 0] })); // spur stub
  }
  return parts;
}

function buildHelm(S, style, add, opts) {
  const plume = opts.plume ?? true;
  if (S.helm === 'sallet') {
    // German sallet: rounded skull flowing into a long tail, with a slit visor; bevor covers the jaw
    const sk = surf((u, v) => {
      const th = lerp(-PI, PI, u); const ph = lerp(0, PI * 0.62, v);
      const back = Math.max(0, -Math.cos(th));
      const R = 0.128;
      let y = 0.115 + Math.cos(ph) * R * 1.02; let r = Math.sin(ph) * R;
      // tail sweeps out and down at the back
      if (v > 0.7) { const t = (v - 0.7) / 0.3; y -= back * t * 0.06; r += back * t * 0.05; }
      const comb = Math.exp(-((th / 0.12) ** 2 + (th - PI) ** 2 / 0.02)) * 0;
      return [Math.sin(th) * r, y + comb, Math.cos(th) * r * 1.08 + 0.01];
    }, 36, 16);
    add('head', 'plate', sk);
    // low comb ridge
    add('head', 'plate', tubeAlong([[0, 0.2, 0.11], [0, 0.247, 0.02], [0, 0.235, -0.07], [0, 0.18, -0.12]], 0.007, 16, 5));
    // visor slit
    add('head', 'dark', xf(new THREE.BoxGeometry(0.15, 0.012, 0.03), { p: [0, 0.115, 0.122], s: [1, 1, 1] }));
    add('head', 'trim', edge((u, v) => { const th = lerp(-1.3, 1.3, u); return [Math.sin(th) * 0.13, 0.105, Math.cos(th) * 0.13 * 1.08 + 0.01]; }, 'u0', 0.005, 16));
    // bevor: chin/throat defence strapped to the breastplate (chest joint)
    const bv = shell({ a0: -1.8, a1: 1.8, y0: 0.2, y1: 0.33, rx: (v) => lerp(0.11, 0.135, v), rz: (v) => lerp(0.1, 0.14, v), cz: 0.03, nu: 24, nv: 6, extra: (th, v) => 0.015 * Math.exp(-((th / 0.4) ** 2)) * v });
    add('chest', 'plate', bv.geo, { joint: 'neck', k: 0.35, pivot: [0, 0.2, 0] });
    add('chest', 'trim', edge(bv.fn, 'v1', 0.006, 22), { joint: 'neck', k: 0.35, pivot: [0, 0.2, 0] });
  } else {
    // armet / close helmet: rounded bowl with comb, articulated visor, bevor and neck lames
    const sk = surf((u, v) => {
      const th = lerp(-PI, PI, u); const ph = lerp(0, PI * 0.82, v); const R = 0.122;
      const flt = style === 'maximilian' ? Math.sin(th * 12) * 0.0035 * Math.sin(ph * 2) : 0;
      return [Math.sin(th) * Math.sin(ph) * (R + flt), 0.12 + Math.cos(ph) * R * 1.05, Math.cos(th) * Math.sin(ph) * (R + flt) * 1.05];
    }, 36, 16);
    add('head', 'plate', sk);
    add('head', 'plate', tubeAlong([[0, 0.23, 0.08], [0, 0.262, 0.0], [0, 0.25, -0.08], [0, 0.2, -0.13]], 0.006, 16, 5));
    if (style === 'maximilian') {
      // bellows visor: horizontal ridges with sight slits
      const vis = surf((u, v) => { const th = lerp(-1.4, 1.4, u); const y = lerp(0.05, 0.17, v); const rid = Math.abs(Math.sin(v * PI * 5)) * 0.012; const r = 0.13 + rid + 0.02 * Math.cos(th); return [Math.sin(th) * r * 0.95, y, Math.cos(th) * r * 1.05 + 0.005]; }, 24, 20);
      add('head', 'plate', vis);
      for (const y of [0.115, 0.137]) add('head', 'dark', xf(new THREE.BoxGeometry(0.15, 0.006, 0.03), { p: [0, y, 0.155] }));
    } else {
      // Milanese armet visor: pointed "sparrow beak" with a single sight
      const vis = surf((u, v) => { const th = lerp(-1.4, 1.4, u); const y = lerp(0.05, 0.17, v); const beak = Math.exp(-((th / 0.5) ** 2)) * 0.04 * Math.sin(v * PI); const r = 0.13 + beak; return [Math.sin(th) * r * 0.95, y, Math.cos(th) * r * 1.03 + 0.004]; }, 24, 12);
      add('head', 'plate', vis);
      add('head', 'dark', xf(new THREE.BoxGeometry(0.14, 0.011, 0.04), { p: [0, 0.128, 0.16] }));
      // rondel on the back of the helmet
      add('head', 'plate', xf(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 20), { p: [0, 0.07, -0.135], r: [PI / 2, 0, 0] }));
      add('head', 'plate', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), { p: [0, 0.07, -0.11], r: [PI / 2, 0, 0] }));
    }
    // breaths (ventilation holes) on the right of the lower visor
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) add('head', 'dark', xf(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 5), { p: [-0.07 - k * 0.012, 0.055 + i * 0.012, 0.11 - k * 0.02], r: [0, 0, PI / 2 + 0.4] }));
    // visor pivots
    for (const s of [-1, 1]) add('head', 'brass', rivetOut([s * 0.125, 0.13, 0.0], [s, 0, 0], 0.011));
    // bevor + chin
    const bv = shell({ a0: -2.0, a1: 2.0, y0: -0.02, y1: 0.07, rx: (v) => lerp(0.1, 0.122, v), rz: (v) => lerp(0.1, 0.13, v), cz: 0.01, nu: 24, nv: 5 });
    add('head', 'plate', bv.geo); add('head', 'trim', edge(bv.fn, 'v0', 0.005, 20));
    for (let i = 0; i < 2; i++) { const nl = shell({ a0: 0, a1: PI * 2, y0: -0.06 - i * 0.03, y1: -0.025 - i * 0.03, rx: () => 0.1 + i * 0.006, rz: () => 0.1 + i * 0.006, nu: 24, nv: 2 }); add('head', 'plate', nl.geo); }
  }
  if (plume) {
    // ostrich-plume: drooping feathers rising from a holder at the back of the helmet
    const feathers = [];
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.22;
      const g = surf((u, v) => {
        const len = 0.42 + i % 2 * 0.06; const s = v * len;
        const x = Math.sin(a) * s * 0.4 + (u - 0.5) * 0.06 * Math.sin(v * PI) * (1 - v * 0.3);
        const y = Math.sin(v * PI * 0.55) * len * 0.45 - v * v * 0.12;
        const z = -Math.cos(a) * s * 0.9;
        return [x, y, z];
      }, 4, 12);
      feathers.push(g);
    }
    add('head', 'plume', xf(mergeGeometries(feathers), { p: [0, 0.22, -0.1] }));
    add('head', 'brass', xf(new THREE.CylinderGeometry(0.012, 0.008, 0.05, 8), { p: [0, 0.22, -0.11], r: [-0.5, 0, 0] }));
  }
}

// ---------------------------------------------------------------- materials
export function harnessMaterials(finish, quality, colors = {}) {
  const size = quality.tex;
  const at = armorTextures(finish, size);
  const F = FINISHES[finish];
  const plate = new THREE.MeshStandardMaterial({
    map: at.map, normalMap: at.normalMap, roughnessMap: at.roughnessMap, metalness: 1, roughness: 1,
    normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, envMapIntensity: 1.25,
  });
  const gilt = F.gilt;
  const trim = gilt
    ? new THREE.MeshStandardMaterial({ color: 0xc8962e, metalness: 1, roughness: 0.32, envMapIntensity: 1.3 })
    : plate;
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.35, envMapIntensity: 1.2 });
  const mt = mailTextures(512);
  const mail = new THREE.MeshStandardMaterial({ map: mt.map, normalMap: mt.normalMap, roughnessMap: mt.roughnessMap, metalness: 1, roughness: 1, side: THREE.DoubleSide });
  mail.map.repeat.set(4, 3); mail.normalMap.repeat.set(4, 3); mail.roughnessMap.repeat.set(4, 3);
  const ct = clothTextures(colors.cloth || [92, 22, 24], true, 512, 'doublet');
  const cloth = new THREE.MeshStandardMaterial({ map: ct.map, normalMap: ct.normalMap, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  const lt = leatherTextures();
  const leather = new THREE.MeshStandardMaterial({ map: lt.map, normalMap: lt.normalMap, roughness: 0.75, metalness: 0 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x020202 });
  const plume = new THREE.MeshStandardMaterial({ color: new THREE.Color(...(colors.plume || [0.85, 0.82, 0.78])), roughness: 0.9, side: THREE.DoubleSide });
  return { plate, trim, brass, mail, cloth, leather, dark, plume };
}

// Assemble the harness onto a rig. Static parts are merged per joint+material;
// articulated lames get their own follower nodes.
export function dressRig(rig, style, finish, quality, colors) {
  const mats = harnessMaterials(finish, quality, colors);
  const parts = buildHarness(style, { plume: colors?.plume !== null });
  const groups = new Map();
  for (const p of parts) {
    const key = p.follow ? `${p.joint}|${p.follow.joint}|${p.follow.k}|${p.follow.pivot.join(',')}|${p.mat}` : `${p.joint}||${p.mat}`;
    if (!groups.has(key)) groups.set(key, { joint: p.joint, follow: p.follow, mat: p.mat, geos: [] });
    groups.get(key).geos.push(p.geo);
  }
  const followers = [];
  const meshes = [];
  const followerNodes = new Map();
  for (const g of groups.values()) {
    for (const geo of g.geos) { if (geo.index === null) console.warn('non-indexed armour part'); for (const n in geo.attributes) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n); }
    const geo = mergeGeometries(g.geos, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mats[g.mat]);
    mesh.castShadow = g.mat !== 'dark'; mesh.receiveShadow = true;
    if (g.follow) {
      const fk = `${g.joint}|${g.follow.joint}|${g.follow.k}|${g.follow.pivot.join(',')}`;
      let node = followerNodes.get(fk);
      if (!node) {
        node = new THREE.Group(); node.position.set(...g.follow.pivot);
        rig.j[g.joint].add(node);
        followers.push({ node, src: rig.j[g.follow.joint], k: g.follow.k });
        followerNodes.set(fk, node);
      }
      mesh.position.set(-g.follow.pivot[0], -g.follow.pivot[1], -g.follow.pivot[2]);
      node.add(mesh);
    } else {
      rig.j[g.joint].add(mesh);
    }
    meshes.push(mesh);
  }
  const _id = new THREE.Quaternion();
  function updateFollowers() {
    for (const f of followers) f.node.quaternion.slerpQuaternions(_id, f.src.quaternion, f.k);
  }
  return { mats, meshes, updateFollowers };
}
