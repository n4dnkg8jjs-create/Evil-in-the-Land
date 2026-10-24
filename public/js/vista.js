// What lies beyond the battlefield. Behind the knights, the walled city they
// ride to defend, its windows lit; ahead, the Devil's mountain wrapped in
// thunderheads, lightning stabbing its flanks. Both are far beyond the fog, so
// they are drawn without it and hazed by hand, like a painted backdrop. Each
// chapter the city falls further behind and the mountain draws nearer.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { stoneTextures, cloudTexture } from './textures.js';
import { rng, makeNoise, clamp, lerp, smooth, TAU } from './util.js';

const PI = Math.PI;
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  return g;
}
function clean(g) { g = g.index ? g.toNonIndexed() : g; for (const n in g.attributes) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); return g; }
function merge(list) { return mergeGeometries(list.map(clean)); }
function prism(w, h, d) { // a gabled roof: ridge along z
  const g = new THREE.BufferGeometry();
  const x = w / 2, z = d / 2;
  const v = [-x, 0, -z, x, 0, -z, 0, h, -z, -x, 0, z, x, 0, z, 0, h, z];
  const idx = [0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  const uv = []; for (let i = 0; i < 6; i++) uv.push(v[i * 3] / 4, v[i * 3 + 1] / 4); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
// aerial perspective by hand: lit normally, then sunk into the haze
function hazed(mat, haze) {
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHaze = haze.color; sh.uniforms.uHazeAmt = haze.amt; sh.uniforms.uFlash = haze.flash;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt, uFlash;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt) + vec3(0.55, 0.6, 0.8) * uFlash * 0.25;');
  };
  return mat;
}

export class Vista {
  constructor(engine, chIdx, ch, groundAt) {
    this.engine = engine; this.idx = chIdx; this.ch = ch;
    this.group = new THREE.Group(); engine.scene.add(this.group);
    this.time = 0; this.strikes = []; this.nextStrike = 2; this.flash = 0;
    const fog = new THREE.Color(ch.atmos.fog);
    this.haze = { color: { value: fog.clone().lerp(new THREE.Color(ch.atmos.skyBottom), 0.5) }, amt: { value: 0.5 }, flash: { value: 0 } };
    this.groundAt = groundAt;
    const kind = ch.terrain.kind;
    if (kind !== 'peak') this.buildCity(kind === 'mountain' ? 2600 : 700 + chIdx * 230, kind === 'mountain' ? -300 : null);
    if (kind !== 'peak') this.buildMountain(kind === 'mountain' ? 1500 : 2700 - chIdx * 330, kind === 'mountain' ? 260 : 0);
    else this.storm = this.buildStorm(new THREE.Vector3(0, 60, 0), 900, 160, true);
  }

  // ---------------------------------------------------------------- the city
  buildCity(dist, baseY) {
    const r = rng(9001);
    const cz = -128 - dist, cx = 60;
    const y0 = baseY ?? (this.groundAt(cx, cz) - 4);
    const st = stoneTextures(256, true);
    const haze = this.haze;
    const stone = hazed(new THREE.MeshStandardMaterial({ color: 0xb8ad98, map: st.map, roughness: 0.9 }), haze);
    const roofM = hazed(new THREE.MeshStandardMaterial({ color: 0x5a3a2c, roughness: 0.85 }), haze);
    const slate = hazed(new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.7 }), haze);
    const walls = [], roofs = [], slates = [], lights = [];
    const R = 230;
    // curtain wall with towers
    const sides = 16;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * TAU, a1 = ((i + 1) / sides) * TAU;
      const p0 = [Math.cos(a0) * R, Math.sin(a0) * R * 0.75], p1 = [Math.cos(a1) * R, Math.sin(a1) * R * 0.75];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
      const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
      walls.push(xf(new THREE.BoxGeometry(len, 16, 5), [mx, 8, mz], [0, -ang, 0]));
      for (let k = 0; k < len / 4; k++) { const t = (k + 0.5) / Math.ceil(len / 4) - 0.5; walls.push(xf(new THREE.BoxGeometry(2, 2.4, 5.4), [mx + Math.cos(ang) * t * len, 17.2, mz + Math.sin(ang) * t * len], [0, -ang, 0])); }
      walls.push(xf(new THREE.CylinderGeometry(8, 9, 30, 12), [p0[0], 15, p0[1]]));
      slates.push(xf(new THREE.ConeGeometry(9.5, 14, 12), [p0[0], 37, p0[1]]));
    }
    // gatehouse facing the road
    walls.push(xf(new THREE.BoxGeometry(30, 34, 22), [0, 17, R * 0.75]));
    for (const s of [-1, 1]) { walls.push(xf(new THREE.CylinderGeometry(9, 10, 42, 12), [s * 16, 21, R * 0.75])); slates.push(xf(new THREE.ConeGeometry(10.5, 16, 12), [s * 16, 50, R * 0.75])); }
    // houses along curving streets
    const rand = (a, b) => a + r() * (b - a);
    for (let k = 0; k < 340; k++) {
      const ang = r() * TAU, d = Math.sqrt(r()) * (R - 22);
      const x = Math.cos(ang) * d, z = Math.sin(ang) * d * 0.75;
      if (Math.hypot(x + 30, z + 10) < 55) continue;  // cathedral close
      const w = rand(7, 13), dp = rand(9, 16), h = rand(9, 17) * (1 - d / R * 0.3);
      const rot = ang + PI / 2 + rand(-0.2, 0.2) + (r() < 0.5 ? PI / 2 : 0);
      walls.push(xf(new THREE.BoxGeometry(w, h, dp), [x, h / 2, z], [0, rot, 0]));
      roofs.push(xf(prism(w + 1, w * 0.62, dp + 0.6), [x, h, z], [0, rot, 0]));
      // a few lit windows on each house
      const nwin = r() < 0.5 ? 2 : 1;
      for (let q = 0; q < nwin; q++) lights.push({ x, y: h * rand(0.35, 0.75), z, rot, w, dp });
    }
    // the keep on its motte
    walls.push(xf(new THREE.CylinderGeometry(42, 60, 26, 16), [130, 13, -60]));
    walls.push(xf(new THREE.BoxGeometry(32, 58, 32), [130, 55, -60]));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { walls.push(xf(new THREE.CylinderGeometry(5, 5, 68, 10), [130 + sx * 16, 60, -60 + sz * 16])); slates.push(xf(new THREE.ConeGeometry(6, 14, 10), [130 + sx * 16, 101, -60 + sz * 16])); }
    // the cathedral: long nave, transept, two west spires and a crossing tower
    const C = [-30, -10];
    walls.push(xf(new THREE.BoxGeometry(26, 36, 100), [C[0], 18, C[1]]));
    roofs.push(xf(prism(28, 18, 102), [C[0], 36, C[1]]));
    walls.push(xf(new THREE.BoxGeometry(70, 32, 22), [C[0], 16, C[1] - 18]));
    roofs.push(xf(prism(24, 16, 72), [C[0], 32, C[1] - 18], [0, PI / 2, 0]));
    for (const s of [-1, 1]) {
      walls.push(xf(new THREE.BoxGeometry(16, 74, 16), [C[0] + s * 12, 37, C[1] + 52]));
      slates.push(xf(new THREE.ConeGeometry(10, 58, 8), [C[0] + s * 12, 103, C[1] + 52], [0, PI / 8, 0]));
      for (let k = 0; k < 4; k++) slates.push(xf(new THREE.ConeGeometry(1.5, 12, 4), [C[0] + s * 12 + (k % 2 ? 7 : -7), 80, C[1] + 52 + (k < 2 ? 7 : -7)]));
    }
    walls.push(xf(new THREE.BoxGeometry(18, 30, 18), [C[0], 45, C[1] - 18]));
    slates.push(xf(new THREE.ConeGeometry(11, 46, 8), [C[0], 83, C[1] - 18], [0, PI / 8, 0]));
    // great west window and the rose
    lights.push({ x: C[0], y: 30, z: C[1] + 60, rot: 0, w: 8, dp: 0, rose: true });
    const g = new THREE.Group(); g.position.set(cx, y0, cz);
    g.rotation.y = Math.atan2(-cx, 128 + 128 - cz) * 0.3;
    const add = (list, m) => { if (!list.length) return; const mesh = new THREE.Mesh(merge(list), m); g.add(mesh); };
    add(walls, stone); add(roofs, roofM); add(slates, slate);
    // windows: warm, steady points that read through the haze at any distance
    const wg = new THREE.PlaneGeometry(1.4, 2.2);
    const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.28).multiplyScalar(3.2), toneMapped: false, fog: false, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(wg, wm, lights.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    lights.forEach((L, i) => {
      // on the face of the house turned toward the road (north)
      const fx = Math.sin(L.rot), fz = Math.cos(L.rot); const face = fz > 0 ? 1 : -1;
      const off = (L.dp / 2 + 0.3) * face;
      P.set(L.x + fx * off + (r() - 0.5) * L.w * 0.6 * Math.cos(L.rot), L.y, L.z + fz * off);
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), L.rot); S.setScalar(L.rose ? 6 : 1);
      M.compose(P, Q, S); im.setMatrixAt(i, M);
    });
    g.add(im);
    // smoke from the chimneys and the siege fires on the plain before it
    this.smoke = [];
    const smokeTex = cloudTexture();
    for (let k = 0; k < 8; k++) {
      const sm = new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a625c, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
      const s = new THREE.Sprite(sm); const a = r() * TAU, d = r() * 160;
      s.position.set(Math.cos(a) * d, 40 + r() * 30, Math.sin(a) * d * 0.75); s.scale.setScalar(60 + r() * 40); g.add(s); this.smoke.push({ s, base: s.position.y, ph: r() * 10 });
    }
    this.group.add(g); this.city = g;
  }

  // ---------------------------------------------------------------- the mountain and its storm
  buildMountain(dist, baseY) {
    const n = makeNoise(666);
    const cz = 128 + dist, cx = -120;
    const Rm = 1300, Hm = 1250;
    const rings = 70, segs = 120;
    const pos = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * TAU;
        const rr = t * Rm;
        const ridge = n.ridge(Math.cos(a) * t * 3 + 5, Math.sin(a) * t * 3 + 5, 5);
        let h = Hm * Math.pow(1 - t, 1.55) * (0.78 + ridge * 0.45) + n.fbm(Math.cos(a) * t * 9, Math.sin(a) * t * 9, 4) * 70 * (1 - t);
        h += Math.exp(-(((t - 0.3) / 0.08) ** 2)) * Math.max(0, Math.sin(a * 3 + 1)) * 160;   // shoulder crags
        if (i === 0) h = Hm * 1.06;
        pos.push(Math.cos(a) * rr * (1 + ridge * 0.06), h - 60 * t, Math.sin(a) * rr * (1 + ridge * 0.06));
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const mat = hazed(new THREE.MeshStandardMaterial({ color: 0x0b0909, roughness: 1, flatShading: true }), { color: { value: this.haze.color.value.clone().multiplyScalar(0.3) }, amt: { value: 0.32 }, flash: this.haze.flash });
    // the summit glows faintly red, as if something burns inside
    const m = new THREE.Mesh(g, mat);
    const y0 = baseY || 0;
    m.position.set(cx, y0 - 40, cz); this.group.add(m); this.mountain = m;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.18, 0.04).multiplyScalar(2.2), fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
    glow.position.set(cx, y0 + Hm * 1.0, cz); this.group.add(glow); this.summitGlow = glow;
    this.storm = this.buildStorm(new THREE.Vector3(cx, y0 + Hm * 0.78, cz), 1500, Hm * 0.5, false);
    this.peakPos = new THREE.Vector3(cx, y0 + Hm, cz);
  }
  buildStorm(centre, radius, thick, around) {
    // thunderheads: big dark billows ringed around the mountain, lit from within by the lightning
    const tex = cloudTexture();
    const r = rng(4040);
    const clouds = [];
    const n = around ? 36 : 44;
    for (let k = 0; k < n; k++) {
      const a = r() * TAU, d = radius * (around ? lerp(0.35, 1.0, r()) : lerp(0.05, 0.75, Math.sqrt(r())));
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0x1a1820, transparent: true, opacity: around ? 0.9 : 0.95, depthWrite: false, fog: false });
      const s = new THREE.Sprite(mat);
      s.position.set(centre.x + Math.cos(a) * d, centre.y + (r() - 0.25) * thick * (around ? 1 : 1.4), centre.z + Math.sin(a) * d * (around ? 1 : 0.6));
      const sc = around ? lerp(220, 420, r()) : lerp(650, 1150, r()); s.scale.set(sc, sc * 0.6, 1);
      mat.rotation = r() * TAU;
      this.group.add(s); clouds.push({ s, mat, a, d, base: s.position.clone(), spin: (r() - 0.5) * 0.004, lit: 0 });
    }
    const bolt = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color(0.85, 0.85, 1.0).multiplyScalar(8), toneMapped: false, fog: false, transparent: true }));
    bolt.frustumCulled = false; this.group.add(bolt);
    return { centre, radius, thick, clouds, bolt, around };
  }
  strike() {
    const S = this.storm; if (!S) return;
    const r = Math.random;
    const a = r() * TAU, d = S.radius * (0.15 + r() * 0.5);
    const top = new THREE.Vector3(S.centre.x + Math.cos(a) * d, S.centre.y + S.thick * 0.2, S.centre.z + Math.sin(a) * d * (S.around ? 1 : 0.6));
    const target = this.peakPos && r() < 0.6 ? this.peakPos.clone().add(new THREE.Vector3((r() - 0.5) * 400, -r() * 500, (r() - 0.5) * 300)) : new THREE.Vector3(top.x + (r() - 0.5) * 200, S.centre.y - S.thick * (S.around ? 1.2 : 1.6), top.z + (r() - 0.5) * 200);
    const segs = [];
    const branch = (p0, p1, jag, depth) => {
      const n = 14; let prev = p0.clone();
      for (let i = 1; i <= n; i++) {
        const t = i / n; const p = p0.clone().lerp(p1, t);
        if (i < n) p.add(new THREE.Vector3((r() - 0.5) * jag, (r() - 0.5) * jag * 0.4, (r() - 0.5) * jag));
        segs.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        if (depth < 2 && r() < 0.18) branch(p.clone(), p.clone().add(new THREE.Vector3((r() - 0.5) * jag * 4, -jag * (2 + r() * 3), (r() - 0.5) * jag * 4)), jag * 0.6, depth + 1);
        prev = p;
      }
    };
    branch(top, target, top.distanceTo(target) * 0.08, 0);
    S.bolt.geometry.dispose(); S.bolt.geometry = new THREE.BufferGeometry(); S.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    this.boltT = 0.22 + r() * 0.15; this.flash = 1;
    for (const c of S.clouds) { const dd = c.s.position.distanceTo(top); c.lit = Math.max(c.lit, clamp(1 - dd / (S.radius * 0.7), 0, 1)); }
    const cam = this.engine.camera.position; const dist = cam.distanceTo(top);
    if (this.onThunder) this.onThunder(clamp(1.4 - dist / 2500, 0.25, 1), clamp(dist / 900, 0.6, 3.5));
  }
  update(dt, camPos) {
    this.time += dt;
    // lightning: bursts of strikes, sometimes double
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) { this.strike(); this.nextStrike = Math.random() < 0.25 ? 0.12 + Math.random() * 0.2 : 2.5 + Math.random() * 6; }
    if (this.boltT > 0) { this.boltT -= dt; const S = this.storm; if (S) { S.bolt.visible = this.boltT > 0 && Math.sin(this.time * 90) > -0.6; } }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.haze.flash.value = this.flash * this.flash;
    if (this.storm) for (const c of this.storm.clouds) {
      c.lit = Math.max(0, c.lit - dt * 3);
      const L = c.lit * c.lit;
      c.mat.color.setRGB(0.07 + L * 1.4, 0.065 + L * 1.4, 0.08 + L * 1.8);
      c.mat.rotation += c.spin * dt * 60 * 0.05;
      const a = c.a + this.time * 0.004; if (!this.storm.around) { c.s.position.x = c.base.x + Math.cos(this.time * 0.05 + c.a) * 20; } else { c.s.position.x = this.storm.centre.x + Math.cos(a) * c.d; c.s.position.z = this.storm.centre.z + Math.sin(a) * c.d; }
    }
    if (this.summitGlow) this.summitGlow.material.opacity = 0.45 + Math.sin(this.time * 0.7) * 0.1;
    if (this.smoke) for (const s of this.smoke) { s.s.position.y = s.base + Math.sin(this.time * 0.05 + s.ph) * 6; s.s.material.rotation += dt * 0.01; }
    // the backdrop never moves with the camera's small shifts, but follows it far enough to avoid parallax errors at the edges
  }
  dispose() { this.engine.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose?.(); }); }
}
