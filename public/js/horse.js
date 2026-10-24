// A draught horse in harness: a deep barrel, a powerful arched neck with a mane, a long head with ears and a
// blaze, feathered legs on big hooves, a long tail; collar, hames, traces and a bridle with blinkers. Built from
// lofted sections on a jointed skeleton (no skinning), and animated: at rest it shifts, tosses its head, flicks
// its ears and swishes its tail; at a gallop its legs run in the four-beat rotary gait, the body rocks and the
// head and neck pump.
import * as THREE from 'three';
import { rng, lerp, smooth } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// rings along a smooth path; section(u) -> { rx, ry, yo, xo }
function loft(points, rings, seg, section, up = V(0, 1, 0)) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings, C = curve.getPoint(u), T = curve.getTangent(u).normalize();
    let U = up.clone().sub(T.clone().multiplyScalar(up.dot(T))); if (U.lengthSq() < 1e-6) U = V(1, 0, 0); U.normalize();
    const S = new THREE.Vector3().crossVectors(U, T).normalize(); const s = section(u);
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const sx = Math.sign(sn) * Math.abs(sn) ** (2 / 2.2), sy = Math.sign(c) * Math.abs(c) ** (2 / 2.2);
      const p = C.clone().addScaledVector(S, sx * s.rx + (s.xo || 0)).addScaledVector(U, sy * s.ry * (c > 0 ? (s.top || 1) : 1) + (s.yo || 0));
      pos.push(p.x, p.y, p.z); uv.push(k / seg, u);
    }
  }
  for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) { const a = i * (seg + 1) + k, b = a + seg + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const prof = (pts) => (u) => { const f = u * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = smooth(f - i); const a = pts[i], b = pts[i + 1]; return { rx: lerp(a[0], b[0], t), ry: lerp(a[1], b[1], t), yo: lerp(a[2] || 0, b[2] || 0, t), top: lerp(a[3] || 1, b[3] || 1, t) }; };

function coatMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vHP;\nfloat hh(vec3 p){ return fract(sin(dot(p, vec3(12.99, 78.23, 45.16))) * 43758.55); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float n = hh(floor(vHP * 60.0)) * 0.5 + hh(floor(vHP * 9.0)) * 0.5; diffuseColor.rgb *= 0.86 + 0.24 * n;');
  };
  m.customProgramCacheKey = () => 'horseCoat';
  return m;
}

export function makeHorse(seed = 1, coat = 0x4a2a18) {
  const r = rng(seed);
  const root = new THREE.Group();
  const coatM = coatMaterial(coat), dark = coatMaterial(0x14100e), hoofM = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d0c4, roughness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.6 }), brass = new THREE.MeshStandardMaterial({ color: 0xa08040, metalness: 0.8, roughness: 0.4 });
  const mk = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const body = new THREE.Group(); body.position.set(0, 1.28, 0); root.add(body);   // pivot at the barrel's centre
  // the barrel, from the round of the quarters to the deep chest
  mk(loft([V(0, 0.12, -0.92), V(0, 0.16, -0.7), V(0, 0.08, -0.2), V(0, 0.06, 0.35), V(0, 0.08, 0.72), V(0, 0.02, 0.9)], 30, 22,
    prof([[0.12, 0.12], [0.32, 0.36, 0, 1.05], [0.36, 0.42], [0.37, 0.45, -0.03], [0.33, 0.44, -0.04], [0.2, 0.3, -0.05]])), coatM, body);
  // haunches and shoulders: muscle over the joints
  for (const s of [-1, 1]) {
    mk(new THREE.SphereGeometry(0.3, 16, 12).scale(0.75, 1.15, 1.1).translate(s * 0.17, 0.05, -0.62), coatM, body);
    mk(new THREE.SphereGeometry(0.27, 16, 12).scale(0.65, 1.3, 0.9).translate(s * 0.16, 0.0, 0.6), coatM, body);
  }
  // the neck, arched, with a crest; and the head
  const neck = new THREE.Group(); neck.position.set(0, 0.22, 0.75); body.add(neck);
  mk(loft([V(0, -0.12, -0.1), V(0, 0.12, 0.18), V(0, 0.42, 0.38), V(0, 0.66, 0.5)], 22, 18, prof([[0.22, 0.38, 0, 1.0], [0.19, 0.32, 0.02, 1.15], [0.14, 0.22, 0.02, 1.2], [0.11, 0.16]]), V(0, 0, -1)), coatM, neck);
  const head = new THREE.Group(); head.position.set(0, 0.7, 0.52); head.scale.setScalar(1.18); neck.add(head);
  mk(loft([V(0, 0.02, -0.08), V(0, -0.1, 0.12), V(0, -0.3, 0.33), V(0, -0.46, 0.5), V(0, -0.52, 0.55)], 24, 18,
    prof([[0.1, 0.12], [0.115, 0.14], [0.085, 0.1], [0.075, 0.08], [0.05, 0.05]]), V(0, 1, 0.4).normalize()), coatM, head);
  mk(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 0.8, 0.9).translate(0, -0.48, 0.5), coatM, head);   // the muzzle
  for (const s of [-1, 1]) mk(new THREE.SphereGeometry(0.09, 12, 10).scale(0.55, 1, 1).translate(s * 0.07, -0.1, 0.02), coatM, head);   // the jowls
  mk(new THREE.PlaneGeometry(0.06, 0.4).rotateX(-1.0).translate(0, -0.2, 0.31), white, head).material.side = THREE.DoubleSide;   // the blaze
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group(); ear.position.set(s * 0.06, 0.08, -0.04); head.add(ear); ears.push(ear);
    mk(new THREE.ConeGeometry(0.035, 0.15, 8).scale(1, 1, 0.6).translate(0, 0.075, 0), coatM, ear);
    mk(new THREE.SphereGeometry(0.022, 8, 6).translate(s * 0.1, -0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x060404, roughness: 0.1 }), head);   // eyes
    mk(new THREE.SphereGeometry(0.018, 6, 4).scale(1, 0.6, 1).translate(s * 0.04, -0.47, 0.58), dark, head);   // nostrils
    mk(new THREE.BoxGeometry(0.01, 0.07, 0.08).translate(s * 0.13, -0.05, 0.12), leather, head);              // blinkers
  }
  // bridle straps and the bit
  for (const [y, z, w] of [[-0.05, 0.12, 0.13], [-0.4, 0.42, 0.095], [-0.47, 0.5, 0.085]]) mk(new THREE.TorusGeometry(w, 0.008, 4, 18).rotateX(Math.PI / 2 - 0.7).translate(0, y, z), leather, head);
  // the mane along the crest and a forelock, the tail
  const maneM = new THREE.MeshStandardMaterial({ color: 0x0e0a08, roughness: 0.8, side: THREE.DoubleSide });
  { // the mane: falls from the crest down the off side of the neck, ragged at its edge
    const crest = new THREE.CatmullRomCurve3([V(0, 0.2, -0.02), V(0, 0.42, 0.2), V(0, 0.68, 0.38), V(0, 0.86, 0.5)]);
    const pos = [], idx = [], N = 24;
    for (let i = 0; i <= N; i++) {
      const c = crest.getPoint(i / N), len = 0.16 + r() * 0.09 - (i / N) * 0.04;
      pos.push(c.x, c.y + 0.04, c.z, c.x + 0.05, c.y - 0.02, c.z, c.x + 0.13, c.y - len * 0.7, c.z - 0.02, c.x + 0.15, c.y - len, c.z - 0.03);
      if (i < N) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); mg.setIndex(idx); mg.computeVertexNormals();
    mk(mg, maneM, neck);
  }
  mk(new THREE.PlaneGeometry(0.06, 0.16).translate(0, -0.08, 0).rotateX(-0.4).translate(0, 0.04, 0.05), maneM, head);
  const tail = new THREE.Group(); tail.position.set(0, 0.32, -0.9); body.add(tail);
  mk(loft([V(0, 0, 0), V(0, -0.08, -0.12), V(0, -0.4, -0.2), V(0, -0.8, -0.18)], 16, 10, prof([[0.05, 0.05], [0.08, 0.07], [0.11, 0.05], [0.06, 0.02]])), maneM, tail);
  // legs: fore from the shoulder, hind from the stifle; joints: elbow/stifle, knee/hock, fetlock
  const legs = [];
  for (const [s, fore] of [[-1, true], [1, true], [-1, false], [1, false]]) {
    const top = new THREE.Group(); top.position.set(s * 0.19, -0.22, fore ? 0.55 : -0.62); body.add(top);
    const L1 = fore ? 0.47 : 0.48, L2 = fore ? 0.35 : 0.34, L3 = 0.16;
    mk(loft([V(0, 0.05, 0), V(0, -L1 * 0.5, fore ? 0.02 : 0.08), V(0, -L1, fore ? 0 : -0.08)], 10, 12, prof([[0.12, 0.15], [0.09, 0.11], [0.07, 0.07]])), coatM, top);
    const mid = new THREE.Group(); mid.position.set(0, -L1, fore ? 0 : -0.08); top.add(mid);
    mk(new THREE.SphereGeometry(0.065, 10, 8), coatM, mid);
    mk(loft([V(0, 0, 0), V(0, -L2 * 0.5, 0), V(0, -L2, 0)], 8, 10, prof([[0.055, 0.06], [0.042, 0.05], [0.046, 0.05]])), dark, mid);
    const low = new THREE.Group(); low.position.set(0, -L2, 0); mid.add(low);
    mk(new THREE.SphereGeometry(0.052, 10, 8), dark, low);
    mk(loft([V(0, 0, 0), V(0, -L3 * 0.6, 0.04), V(0, -L3, 0.06)], 6, 10, prof([[0.048, 0.05], [0.05, 0.05], [0.07, 0.06]])), dark, low);
    // feathering round the hoof, and the hoof
    mk(new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12, 1, true).translate(0, -L3 + 0.02, 0.05), maneM, low);
    mk(new THREE.CylinderGeometry(0.062, 0.078, 0.09, 14).translate(0, -L3 - 0.045, 0.07), hoofM, low);
    legs.push({ top, mid, low, fore, s });
  }
  // the harness: a collar and hames round the neck, a saddle pad and belly band, traces back to the wagon
  mk(new THREE.TorusGeometry(0.27, 0.07, 10, 24).scale(0.85, 1.25, 1).rotateX(-0.45).translate(0, 0.36, 0.78), leather, body);
  for (const s of [-1, 1]) mk(new THREE.TorusGeometry(0.31, 0.015, 4, 20, Math.PI * 0.6).rotateZ(Math.PI * 0.2).scale(s, 1.3, 1).rotateX(-0.45).translate(0, 0.4, 0.8), brass, body);
  mk(new THREE.CylinderGeometry(0.39, 0.39, 0.12, 24, 1, true).scale(0.95, 1, 1.18).rotateX(Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0.02, 0.2), leather, body);
  mk(new THREE.BoxGeometry(0.42, 0.04, 0.3).translate(0, 0.48, 0.2), leather, body);
  for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.02, 0.05, 1.3).translate(s * 0.37, 0.0, -0.35), leather, body);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const st = { t: r() * 10, phase: 0, toss: 0, earT: 0, tailT: 0 };
  const R = (o, x, y = 0, z = 0) => o.rotation.set(x, y, z);
  // speed in m/s; at 0 it stands; above ~5 it gallops
  const update = (dt, speed) => {
    st.t += dt; const gal = Math.min(1, speed / 6), walk = Math.min(1, speed / 1.5) * (1 - gal);
    st.phase += dt * (gal ? 2.1 : walk ? 1.4 : 0) * (speed > 0.05 ? 1 : 0);
    const P = st.phase * Math.PI * 2;
    // body: the rocking canter of the gallop, the bob of the walk, a slow breath at rest
    body.position.y = 1.28 + Math.sin(P * 2) * 0.03 * walk + Math.sin(P) * 0.08 * gal + Math.sin(st.t * 1.4) * 0.006;
    body.rotation.x = Math.sin(P + 0.6) * 0.07 * gal;
    // neck and head pump with the stride; at rest a toss now and then
    st.toss = Math.max(0, st.toss - dt); if (!speed && r() < dt * 0.08) st.toss = 1.2;
    const toss = Math.sin(Math.min(1, st.toss) * Math.PI) * 0.35;
    R(neck, -0.15 + Math.sin(P + 1.2) * 0.12 * gal + Math.sin(P * 2) * 0.04 * walk - toss * 0.5 + gal * 0.25, Math.sin(st.t * 0.3) * 0.08 * (1 - gal));
    R(head, 0.1 + Math.sin(P + 1.6) * 0.1 * gal + toss * 0.4, 0, Math.sin(st.t * 0.7) * 0.03);
    st.earT -= dt; if (st.earT < 0) { st.earT = 1 + r() * 4; st.earA = (r() - 0.5) * 0.9; st.earB = (r() - 0.5) * 0.9; }
    ears[0].rotation.set(-0.2 - gal * 0.6, st.earA || 0, 0); ears[1].rotation.set(-0.2 - gal * 0.6, st.earB || 0, 0);
    // the tail swishes at rest and streams out behind at a gallop
    R(tail, -0.2 - gal * 0.9 + Math.sin(st.t * 3.1) * 0.08 * gal, Math.sin(st.t * 1.1) * 0.35 * (1 - gal) + Math.sin(st.t * 5) * 0.05 * gal);
    // legs: the rotary gallop (near hind, off hind, off fore, near fore) or a four-beat walk
    const off = gal ? [0.0, 0.12, 0.62, 0.5] : [0.0, 0.5, 0.25, 0.75];   // fore L, fore R, hind L, hind R (fraction of the stride)
    legs.forEach((L, i) => {
      const a = (st.phase + off[i]) * Math.PI * 2;
      const swing = Math.sin(a), lift = Math.max(0, Math.cos(a));
      const A = gal ? 0.75 : walk ? 0.32 : 0;
      if (L.fore) { R(L.top, swing * A * 0.8); R(L.mid, -lift * A * 1.6); R(L.low, lift * A * 0.6); }
      else { R(L.top, swing * A * 0.7); R(L.mid, lift * A * 1.3); R(L.low, -lift * A * 0.7); }
      if (!A) { R(L.top, i === 3 ? Math.sin(st.t * 0.4) * 0.05 : 0); R(L.mid, i === 3 && Math.sin(st.t * 0.25) > 0.6 ? 0.35 : 0); }   // resting a hind leg
    });
  };
  return { root, update };
}
