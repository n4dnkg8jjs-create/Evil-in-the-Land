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
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt) + vec3(0.55, 0.6, 0.8) * uFlash * 0.25;\n#include <tonemapping_fragment>');
  };
  return mat;
}

export class Vista {
  constructor(engine, chIdx, ch, groundAt) {
    this.engine = engine; this.idx = chIdx; this.ch = ch;
    this.group = new THREE.Group(); engine.scene.add(this.group);
    this.time = 0; this.strikes = []; this.nextStrike = 2; this.flash = 0;
    const fog = new THREE.Color(ch.atmos.fog);
    this.haze = { color: { value: fog.clone() }, amt: { value: 0.5 }, flash: { value: 0 } };
    this.hazeDark = { color: { value: fog.clone().multiplyScalar(0.8) }, amt: { value: 0.72 }, flash: this.haze.flash };
    this.groundAt = groundAt;
    const kind = ch.terrain.kind;
    if (kind !== 'peak') this.buildCity(kind === 'mountain' ? 3300 : 1500 + chIdx * 280, kind === 'mountain' ? -300 : null);
    if (chIdx > 0 && kind !== 'peak' && kind !== 'mountain') this.buildBehind(chIdx);
    if (kind !== 'peak') this.buildMountain(kind === 'mountain' ? 1500 : 2700 - chIdx * 330, kind === 'mountain' ? 260 : 0);
    else {
      // on the Peak the storm is all round and close: cloud boils up the faces from below, and the lightning
      // strikes the arêtes and the summit fang, lighting the whole mountain top
      this.storm = this.buildStorm(new THREE.Vector3(0, -40, 0), 900, 160, true, true);
      this.boltLight = new THREE.DirectionalLight(0xc0c8ff, 0); engine.scene.add(this.boltLight); engine.scene.add(this.boltLight.target);
      this.peak = true;
    }
  }

  // ---------------------------------------------------------------- the city
  buildCity(dist, baseY) {
    const r = rng(9001);
    const cz = -128 - dist, cx = 60;
    // sit on the highest ground under the walls (the mound hides the rest)
    let y0 = baseY ?? -1e9; if (baseY == null) for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; y0 = Math.max(y0, this.groundAt(cx + Math.cos(a) * 200, cz + Math.sin(a) * 150)); }
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
    // the city stands on its own low hill, whose skirts run down below the surrounding land so nothing floats
    const earth = hazed(new THREE.MeshStandardMaterial({ color: 0x3a3428, roughness: 1 }), haze);
    const mound = xf(new THREE.CylinderGeometry(R + 34, R + 190, 140, 40, 3), [0, -70, 0], [0, 0, 0], [1, 1, 0.75]);
    { const mp = mound.attributes.position; for (let i = 0; i < mp.count; i++) { const y = mp.getY(i); if (y < -1 && y > -139) { const a = Math.atan2(mp.getZ(i), mp.getX(i)); mp.setY(i, y + Math.sin(a * 5 + 1) * 12 + Math.cos(a * 9) * 6); } } mound.computeVertexNormals(); }
    const g = new THREE.Group(); g.position.set(cx, y0, cz);
    g.add(new THREE.Mesh(mound, earth));
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
    // thin smoke from a few chimneys, rising and leaning with the wind (no great banks of cloud over the walls)
    this.smoke = [];
    const smokeTex = cloudTexture();
    for (let k = 0; k < 6; k++) {
      const a = r() * TAU, d = r() * 150, x0 = Math.cos(a) * d, z0 = Math.sin(a) * d * 0.75;
      for (let j = 0; j < 7; j++) {
        const sm = new THREE.SpriteMaterial({ map: smokeTex, color: 0x5a5652, transparent: true, opacity: 0.32 * (1 - j / 8), depthWrite: false, fog: true });
        const sp = new THREE.Sprite(sm); const h = 22 + j * 6;
        sp.position.set(x0 + j * 2.5, h, z0 + j * 1.2); sp.scale.setScalar(6 + j * 3); g.add(sp); this.smoke.push({ s: sp, base: h, ph: k * 3 + j * 0.4 });
      }
    }
    this.group.add(g); this.city = g;
  }

  // ---------------------------------------------------------------- the road behind
  // The country already won does not vanish: back down the road, past the living fields, the village you saved
  // from the last chapter still stands, its church tower whole again, its chimneys smoking.
  buildBehind(chIdx) {
    const r = rng(4400 + chIdx), g = new THREE.Group(), haze = this.haze;
    const st = stoneTextures(256, true);
    const stone = hazed(new THREE.MeshStandardMaterial({ color: 0xb0a690, map: st.map, roughness: 0.9 }), haze);
    const plaster = hazed(new THREE.MeshStandardMaterial({ color: 0xc8bca4, roughness: 0.92 }), haze);
    const thatch = hazed(new THREE.MeshStandardMaterial({ color: 0x6a5434, roughness: 0.95 }), haze);
    const slate = hazed(new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 0.75 }), haze);
    const cx = (r() - 0.5) * 120, cz = -128 - 330 - r() * 80;
    const parts = { stone: [], plaster: [], thatch: [], slate: [] };
    const put = (list, geo, x, z, y, ry = 0) => { geo.rotateY(ry); geo.translate(x, y, z); list.push(geo); };
    for (let k = 0; k < 16; k++) {
      const a = r() * TAU, d = 18 + r() * 70, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.6; const y = this.groundAt(x, z) - 0.5;
      const w = 5 + r() * 4, l = 7 + r() * 6, h = 3.5 + r() * 2.5, ry = r() * Math.PI;
      put(parts.plaster, new THREE.BoxGeometry(w, h + 1, l), x, z, y + h / 2, ry);
      const roof = new THREE.CylinderGeometry(0.01, w * 0.78, w * 0.6, 4, 1); roof.rotateY(Math.PI / 4); roof.scale(1, 1, l / w); put(parts.thatch, roof, x, z, y + h + w * 0.3 + 0.3, ry);
    }
    // the church: nave, tower and spire
    const y0 = this.groundAt(cx, cz) - 0.5;
    put(parts.stone, new THREE.BoxGeometry(11, 9, 24), cx, cz, y0 + 4.5);
    const nr = new THREE.CylinderGeometry(0.01, 8.6, 5.5, 4, 1); nr.rotateY(Math.PI / 4); nr.scale(1, 1, 24 / 11 * 0.95); put(parts.slate, nr, cx, cz, y0 + 9 + 2.75);
    put(parts.stone, new THREE.BoxGeometry(6, 21, 6), cx, cz + 14.5, y0 + 10.5);
    put(parts.slate, new THREE.ConeGeometry(4.6, 13, 4), cx, cz + 14.5, y0 + 27.5, Math.PI / 4);
    for (const [k, m] of [['stone', stone], ['plaster', plaster], ['thatch', thatch], ['slate', slate]]) if (parts[k].length) { const mesh = new THREE.Mesh(mergeGeometries(parts[k]), m); mesh.castShadow = false; g.add(mesh); }
    const smokeTex = cloudTexture();
    for (let k = 0; k < 4; k++) {
      const a = r() * TAU, d = 20 + r() * 50, x0 = cx + Math.cos(a) * d, z0 = cz + Math.sin(a) * d * 0.6, yb = this.groundAt(x0, z0) + 7;
      for (let j = 0; j < 6; j++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0x6a6662, transparent: true, opacity: 0.3 * (1 - j / 7), depthWrite: false })); sp.position.set(x0 + j * 1.5, yb + j * 3.5, z0 + j * 0.6); sp.scale.setScalar(3 + j * 1.8); g.add(sp); }
    }
    this.group.add(g); this.behind = g;
  }

  // ---------------------------------------------------------------- the mountain and its storm
  buildMountain(dist, baseY) {
    const n = makeNoise(666);
    const cz = 128 + dist, cx = -120;
    const Rm = 1500, Hm = 1550;
    const rings = 70, segs = 120;
    const pos = [], idx = [];
    // one extra ring: a skirt that plunges far below the horizon, so the mountain never floats
    for (let i = 0; i <= rings + 1; i++) {
      const t = Math.min(1, i / rings), skirt = i > rings;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * TAU;
        const rr = skirt ? Rm * 1.35 : t * Rm;
        const ridge = n.ridge(Math.cos(a) * t * 3 + 5, Math.sin(a) * t * 3 + 5, 5);
        let h = Hm * Math.pow(1 - t, 1.55) * (0.78 + ridge * 0.45) + n.fbm(Math.cos(a) * t * 9, Math.sin(a) * t * 9, 4) * 70 * (1 - t);
        h += Math.exp(-(((t - 0.3) / 0.08) ** 2)) * Math.max(0, Math.sin(a * 3 + 1)) * 160;   // shoulder crags
        if (i === 0) h = Hm * 1.06;
        if (skirt) h = -700;
        pos.push(Math.cos(a) * rr * (1 + ridge * 0.06), h - 60 * t, Math.sin(a) * rr * (1 + ridge * 0.06));
      }
    }
    for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }   // outward-facing
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // dark rock sunk in haze, and a mist that thickens toward its foot so it rises out of the distant land rather than sitting on it
    const mat = new THREE.MeshStandardMaterial({ color: 0x24201e, roughness: 1, flatShading: true }); mat.fog = false;
    const hz = this.haze, my = { value: new THREE.Vector2((baseY || 0) - 40, (baseY || 0) + 760) };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = hz.color; sh.uniforms.uFlash = hz.flash; sh.uniforms.uMistY = my;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uFlash; uniform vec2 uMistY; varying float vWY;')
        .replace('#include <tonemapping_fragment>', 'float hh = smoothstep(uMistY.x, uMistY.y, vWY); float mist = mix(0.97, 0.4, hh);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze * mix(1.0, 0.3, smoothstep(0.0, 2.2, (vWY - uMistY.x) / (uMistY.y - uMistY.x))), mist) + vec3(0.55, 0.6, 0.8) * uFlash * 0.06;\n#include <tonemapping_fragment>');
    };
    mat.customProgramCacheKey = () => 'vistaMountain';
    // the summit glows faintly red, as if something burns inside
    const m = new THREE.Mesh(g, mat);
    const y0 = baseY || 0;
    m.position.set(cx, y0 - 40, cz); this.group.add(m); this.mountain = m;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.18, 0.04).multiplyScalar(2.2), fog: false, transparent: true, opacity: 0.55, depthWrite: false }));
    glow.position.set(cx, y0 + Hm * 1.0, cz); this.group.add(glow); this.summitGlow = glow;
    this.storm = this.buildStorm(new THREE.Vector3(cx, y0 + Hm * 1.02, cz), 1300, Hm * 0.28, false);
    this.peakPos = new THREE.Vector3(cx, y0 + Hm, cz);
  }
  buildStorm(centre, radius, thick, around, close = false) {
    // The thunderhead as a volume: a stack of slices across the view, each one cutting through a 3-D noise field
    // shaped like a storm cell (a ring hugging the summit that spreads into an anvil above it, or, on the peak
    // itself, a wall of cloud all round). Lightning lights the cloud from inside, near where it strikes.
    const n = this.engine.q && !this.engine.q.post ? 9 : 14;
    const U = {
      uCentre: { value: centre.clone() }, uTime: { value: 0 }, uFlash: { value: 0 }, uStrike: { value: centre.clone() },
      uHaze: this.haze.color, uAround: { value: around ? 1 : 0 }, uAlpha: { value: (around ? 3.2 : 5.5) / n },
      uR0: { value: close ? 48 : around ? 520 : radius * 0.18 }, uR1: { value: close ? 1300 : around ? 1500 : radius * 1.45 },
      uH0: { value: close ? -170 : around ? -260 : -thick * 1.9 }, uH1: { value: close ? 75 : around ? 170 : thick * 1.6 },
      uRamp: { value: close ? 70 : 220 }, uScale: { value: close ? 170 : 420 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform vec3 uCentre, uStrike, uHaze; uniform float uTime, uFlash, uAround, uAlpha, uR0, uR1, uH0, uH1, uRamp, uScale;
        varying vec3 vW;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
        void main(){
          vec3 q = vW - uCentre; float h = q.y, r = length(q.xz);
          float k = clamp((h - uH0) / (uH1 - uH0), 0.0, 1.0);
          float band = smoothstep(0.0, 0.18, k) * (1.0 - smoothstep(0.8, 1.0, k));
          float rIn = uAround > 0.5 ? uR0 : uR0 * (1.0 - 0.85 * smoothstep(0.35, 0.75, k));   // low down it rings the summit; high up it closes over it
          float rOut = uR1 * (uAround > 0.5 ? 1.0 : mix(0.7, 1.35, smoothstep(0.45, 0.95, k)));   // and spreads into an anvil
          float shape = band * smoothstep(rIn, rIn + uRamp, r) * (1.0 - smoothstep(rOut * 0.7, rOut, r));
          if (shape < 0.02) discard;
          vec3 w = q / uScale + vec3(uTime * 0.012, -uTime * 0.004, uTime * 0.007);
          float n = fbm(w + 0.6 * vec3(fbm(w * 0.7 + 4.0), 0.0, fbm(w * 0.7 + 8.0)));     // warped: billows, not blobs
          float dens = smoothstep(0.3, 0.62, n * (0.6 + 0.65 * shape));
          if (dens < 0.01) discard;
          // dark, heavy undersides; tops faintly catching what light there is
          vec3 col = mix(vec3(0.016, 0.015, 0.02), vec3(0.075, 0.072, 0.085), k * (0.4 + 0.6 * n));
          col *= 0.7 + 0.6 * smoothstep(0.45, 0.8, n);
          float lit = uFlash * exp(-length(vW - uStrike) / (uScale * 1.25));
          col += vec3(0.55, 0.6, 0.85) * lit * (0.5 + 1.6 * (1.0 - dens));
          col = mix(col, uHaze * 0.75, 0.3);
          gl_FragColor = vec4(col, clamp(dens * uAlpha * (0.6 + 0.4 * shape), 0.0, 0.95));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const slices = [];
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); m.frustumCulled = false; this.group.add(m); slices.push(m); }
    // the bolt is a camera-facing ribbon rather than GL lines: lines are a single pixel wide on most GPUs and some drivers choke on them
    const bolt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.85, 1.0).multiplyScalar(6), toneMapped: false, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    bolt.frustumCulled = false; this.group.add(bolt);
    return { centre, radius, thick, around, close, slices, U, mat, bolt, span: close ? [30, 1400] : around ? [300, 1900] : [radius * 1.6, radius * 1.6] };
  }
  // lay the slices across the view, back to front, each just big enough to fill the frame at its distance
  placeSlices() {
    const S = this.storm; if (!S || !S.slices) return;
    const cam = this.engine.camera, cp = cam.position;
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    let d0, d1;
    if (S.around) { d0 = S.span[0]; d1 = S.span[1]; }
    else { const dc = f.dot(new THREE.Vector3().subVectors(S.centre, cp)); d0 = Math.max(60, dc - S.span[0]); d1 = Math.max(d0 + 200, dc + S.span[1]); }
    const n = S.slices.length, th = Math.tan(cam.fov * Math.PI / 360) * 1.15;
    S.slices.forEach((m, i) => {
      const t = 1 - i / (n - 1); const d = S.close ? d0 * Math.pow(d1 / d0, t) : d1 - (d1 - d0) * (1 - t);   // far first (close storms: spaced out geometrically, dense near)
      m.position.copy(cp).addScaledVector(f, d); m.quaternion.copy(cam.quaternion);
      m.scale.set(d * th * 2 * cam.aspect, d * th * 2, 1); m.renderOrder = -5 + i * 0.01;
    });
  }
  strike() {
    const S = this.storm; if (!S) return;
    const r = Math.random;
    if (S.close) return this.strikePeak();
    const a = r() * TAU, d = S.radius * (0.15 + r() * 0.5);
    const top = new THREE.Vector3(S.centre.x + Math.cos(a) * d, S.centre.y + S.thick * 0.2, S.centre.z + Math.sin(a) * d * (S.around ? 1 : 0.6));
    const target = this.peakPos && r() < 0.6 ? this.peakPos.clone().add(new THREE.Vector3((r() - 0.5) * 400, -r() * 500, (r() - 0.5) * 300)) : new THREE.Vector3(top.x + (r() - 0.5) * 200, S.centre.y - S.thick * (S.around ? 1.2 : 1.6), top.z + (r() - 0.5) * 200);
    this.drawBolt(top, target);
  }
  // on the Peak: a bolt out of the cloud ceiling onto a crest, a spire or the summit fang, close enough to light
  // the knights and the dragon, the thunder hard on its heels
  strikePeak() {
    const r = Math.random; let x, z;
    const a = r() * TAU, d = 50 + r() * 170; x = Math.cos(a) * d; z = Math.sin(a) * d;
    const target = new THREE.Vector3(x, Math.max(-160, this.groundAt(x, z)), z);
    const top = new THREE.Vector3(x + (r() - 0.5) * 120, 230 + r() * 60, z + (r() - 0.5) * 120);
    this.drawBolt(top, target);
    const L = this.boltLight; if (L) { L.position.copy(top); L.target.position.copy(target).multiplyScalar(0.3); this.boltPower = 1; }
    this.lastStrike = target;
  }
  drawBolt(top, target) {
    const S = this.storm, r = Math.random, segs = [];
    const branch = (p0, p1, jag, depth) => {
      const n = S.close ? 34 : 14; let prev = p0.clone();
      for (let i = 1; i <= n; i++) {
        const t = i / n; const p = p0.clone().lerp(p1, t);
        if (i < n) p.add(new THREE.Vector3((r() - 0.5) * jag, (r() - 0.5) * jag * 0.4, (r() - 0.5) * jag));
        segs.push([prev, p, depth]);
        if (depth < 2 && r() < (S.close ? 0.1 : 0.18)) branch(p.clone(), p.clone().add(new THREE.Vector3((r() - 0.5) * jag * 4, -jag * (2 + r() * 3), (r() - 0.5) * jag * 4)), jag * 0.6, depth + 1);
        prev = p;
      }
    };
    branch(top, target, top.distanceTo(target) * (S.close ? 0.05 : 0.08), 0);
    const cam0 = this.engine.camera.position, pos = [], dir = new THREE.Vector3(), toCam = new THREE.Vector3(), side = new THREE.Vector3();
    for (const [a0, a1, dp] of segs) {
      dir.subVectors(a1, a0); toCam.subVectors(cam0, a0);
      side.crossVectors(dir, toCam); if (side.lengthSq() < 1e-6) continue;
      side.normalize().multiplyScalar(S.close ? (dp === 0 ? 0.9 : dp === 1 ? 0.45 : 0.25) * Math.max(1, toCam.length() / 260) : (dp === 0 ? 4.5 : dp === 1 ? 2.4 : 1.4) * Math.max(1, toCam.length() / 1800));
      pos.push(a0.x - side.x, a0.y - side.y, a0.z - side.z, a0.x + side.x, a0.y + side.y, a0.z + side.z, a1.x + side.x, a1.y + side.y, a1.z + side.z,
        a0.x - side.x, a0.y - side.y, a0.z - side.z, a1.x + side.x, a1.y + side.y, a1.z + side.z, a1.x - side.x, a1.y - side.y, a1.z - side.z);
    }
    S.bolt.geometry.dispose(); S.bolt.geometry = new THREE.BufferGeometry(); S.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.boltT = 0.22 + r() * 0.15; this.flash = 1;
    S.U.uStrike.value.copy(top).lerp(target, 0.15); this.cloudFlash = 1.6;
    const cam = this.engine.camera.position; const dist = cam.distanceTo(top);
    if (this.onThunder) this.onThunder(clamp(1.4 - dist / 2500, 0.25, 1), clamp(dist / 900, 0.6, 3.5));
  }
  update(dt, camPos) {
    this.time += dt;
    // lightning: bursts of strikes, sometimes double
    this.nextStrike -= dt;
    if (this.nextStrike <= 0) { this.strike(); this.nextStrike = Math.random() < 0.3 ? 0.12 + Math.random() * 0.2 : this.peak ? 1.4 + Math.random() * 4 : 2.5 + Math.random() * 6; }
    if (this.boltLight) { this.boltPower = Math.max(0, (this.boltPower || 0) - dt * 3.2); const f = this.boltT > 0 ? (Math.sin(this.time * 60) > -0.3 ? 1 : 0.35) : 0.4; this.boltLight.intensity = this.boltPower * this.boltPower * 9 * f; }
    if (this.boltT > 0) { this.boltT -= dt; const S = this.storm; if (S) { S.bolt.visible = this.boltT > 0 && Math.sin(this.time * 90) > -0.6; } }
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.haze.flash.value = this.flash * this.flash;
    // follow the sky as the land heals: the haze is always the colour of the horizon
    const fc = this.engine.scene.fog.color; this.haze.color.value.copy(fc); this.hazeDark.color.value.copy(fc).multiplyScalar(0.8);
    if (this.storm && this.storm.U) {
      this.cloudFlash = Math.max(0, (this.cloudFlash || 0) - dt * 5);
      // the flicker of a strike, lighting the cloud in pulses
      this.storm.U.uFlash.value = this.cloudFlash * (this.boltT > 0 ? 0.75 + 0.25 * Math.sin(this.time * 70) : 1);
      this.storm.U.uTime.value = this.time; this.placeSlices();
    }
    if (this.summitGlow) this.summitGlow.material.opacity = 0.45 + Math.sin(this.time * 0.7) * 0.1;
    if (this.smoke) for (const s of this.smoke) { s.s.position.y = s.base + Math.sin(this.time * 0.3 + s.ph) * 0.8; s.s.material.rotation += dt * 0.03; }
    // the backdrop never moves with the camera's small shifts, but follows it far enough to avoid parallax errors at the edges
  }
  dispose() { this.engine.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose?.(); }); }
}
