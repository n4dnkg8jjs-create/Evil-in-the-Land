// The cave on the Ascent. Near the top the way goes into the mountain: a long, low, dripping tunnel through a
// shoulder of rock, black as pitch. At its mouth lie three of the Emperor's soldiers who got that far, and the
// torch one of them was carrying; take it up and light it, or you go no further. Inside, He is waiting, and does
// everything He can to make you turn back: the torch gutters and something stands in the dark; footsteps keep
// pace behind; the dead turn their heads; writing in blood comes up on the wall; eyes all round; a swarm of
// crawlers when the light fails; Him walking upside down across the roof; and at the far mouth, Him again.
//
// The terrain carries a trench along the cave's line (world.gorgeHeight); here the trench is roofed with the
// mountain's own surface (world.lidHeight, same material, so it reads as one hillside), the tunnel is lined with
// wet rock, the ends are closed round the tunnel mouths, and the light goes out inside.
import * as THREE from 'three';
import { boneLibrary, boneMaterial } from './bones.js';
import { phantomDevil, releasePhantom } from './devil.js';
import { makeNoise, rng, clamp, lerp, smooth, damp, TAU } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// the cave's frame at t: centre on the floor, direction along, across (to the left)
function frame(W, t) {
  const p = W.path.at(t), a = W.path.at(Math.max(0, t - 0.003)), b = W.path.at(Math.min(1, t + 0.003));
  let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { x: p.x, z: p.z, y: W.heightAt(p.x, p.z), tx, tz, nx: -tz, nz: tx };
}

export class Cave {
  constructor(game) {
    this.g = game; const W = this.W = game.world, C = this.C = W.cave;
    this.group = new THREE.Group(); game.scene.add(this.group);
    this.noise = makeNoise(4711); this.r = rng(4711);
    this.done = {}; this.torch = null; this.inside = 0; this.u = -1; this.base = null; this.gutter = 0; this.time = 0;
    this.buildTunnel(); this.buildRoof(); this.buildDressing(); this.buildMouth();   // (the tunnel runs out past the mouths as a rock arch, so no end faces are needed)
  }

  // ---------------------------------------------------------------- the tunnel: wet rock, uneven, dripping
  buildTunnel() {
    const W = this.W, C = this.C, n = this.noise;
    const U = W.terrainUniforms, st = { map: U.tRock.value, normalMap: U.tRockN.value };   // the mountain's own raw rock, not dressed stone
    const rock = this.rockMat = new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, normalScale: new THREE.Vector2(1.6, 1.6), color: 0x5a544e, roughness: 0.32, metalness: 0.05, side: THREE.DoubleSide });
    rock.onBeforeCompile = (sh) => {   // wet: dark streaks running down the walls, glistening
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;\nfloat ch(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
        .replace('#include <map_fragment>', '#include <map_fragment>\nfloat streak = smoothstep(0.55, 1.0, ch(floor(vec2(vCW.x * 3.0 + vCW.z * 3.0, 0.0)))) * (0.6 + 0.4 * sin(vCW.y * 2.0));\ndiffuseColor.rgb *= 0.7 - 0.35 * streak;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, streak);');
    };
    rock.customProgramCacheKey = () => 'caveRock';
    const NT = 120, NA = 30, pos = [], uv = [], idx = [];
    this.rings = [];
    for (let i = 0; i <= NT; i++) {
      const t = lerp(C.t0 - C.e, C.t1 + C.e, i / NT), F = frame(W, t), floor = this.floorAt(t);
      const ring = [];
      for (let k = 0; k <= NA; k++) {
        const a = (k / NA) * TAU;   // 0 = the left wall at floor height, up over the roof, down the right wall and under
        const cx = Math.cos(a), cy = Math.sin(a);
        const wob = n.fbm(t * 60 + cx * 0.8, cy * 0.8 + k * 0.05, 3) * 0.9 + n.ridge(t * 140, a * 2.3, 2) * 0.35;
        const rw = C.R + wob * 0.6, rh = 2.55 + wob * 0.5 + (n.fbm(t * 25, 7, 2)) * 0.8;
        const lx = cx * rw, ly = cy > 0 ? 0.35 + cy * rh : cy * 1.2;
        const x = F.x + F.nx * lx, z = F.z + F.nz * lx, y = floor + ly;
        pos.push(x, y, z); uv.push(k / NA * 4, i / NT * 30); ring.push(V(x, y, z));
      }
      this.rings.push({ t, F, floor, ring });
    }
    for (let i = 0; i < NT; i++) for (let k = 0; k < NA; k++) { const a = i * (NA + 1) + k, b = a + NA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, rock); m.receiveShadow = true; this.group.add(m);
    // the floor: wet rock and mud over the trench (no snow under the mountain)
    { const fp = [], fu = [], fi = [], NS = 8;
      for (let i = 0; i <= NT; i++) { const R = this.rings[i]; for (let j = 0; j <= NS; j++) { const s = lerp(-C.R + 0.25, C.R - 0.25, j / NS); fp.push(R.F.x + R.F.nx * s, R.floor + 0.16 + n.fbm(R.t * 90, j * 0.7, 2) * 0.04, R.F.z + R.F.nz * s); fu.push(j / NS * 3, i / NT * 30); } }
      for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b = a + NS + 1; fi.push(a, a + 1, b, a + 1, b + 1, b); }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi); fg.computeVertexNormals();
      const floorM = rock.clone(); floorM.color = new THREE.Color(0x34302c); floorM.side = THREE.FrontSide; floorM.onBeforeCompile = rock.onBeforeCompile; floorM.customProgramCacheKey = () => 'caveFloor';
      floorM.polygonOffset = true; floorM.polygonOffsetFactor = -4; floorM.polygonOffsetUnits = -4; const fm = new THREE.Mesh(fg, floorM); fm.receiveShadow = true; this.group.add(fm); }
    // stalactites from the roof, and dripping
    const r = this.r, sg = []; this.drips = [];
    for (let k = 0; k < 70; k++) {
      const t = lerp(C.t0 + 0.01, C.t1 - 0.01, r()), F = frame(W, t), floor = this.floorAt(t), lx = (r() - 0.5) * C.R * 1.3;
      const roof = floor + 0.35 + 2.55 * Math.sqrt(Math.max(0, 1 - (lx / C.R) ** 2)) - 0.15;
      const len = 0.15 + r() ** 2 * 0.9; const cg = new THREE.ConeGeometry(0.04 + len * 0.08, len, 6); cg.rotateX(Math.PI); cg.translate(F.x + F.nx * lx, roof - len / 2, F.z + F.nz * lx); sg.push(cg);
      if (k % 4 === 0) this.drips.push({ x: F.x + F.nx * lx, y: roof - len, z: F.z + F.nz * lx, floor, next: r() * 4 });
    }
    const merged = this.merge(sg); if (merged) this.group.add(new THREE.Mesh(merged, rock));
    // pools of black water on the floor
    const water = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.03, metalness: 0.2 });
    for (let k = 0; k < 9; k++) {
      const t = lerp(C.t0 + 0.02, C.t1 - 0.02, r()), F = frame(W, t), lx = (r() - 0.5) * 3;
      const pg = new THREE.CircleGeometry(0.6 + r() * 1.1, 18); pg.scale(1, 0.6 + r() * 0.4, 1); pg.rotateX(-Math.PI / 2);
      const pm = new THREE.Mesh(pg, water); pm.position.set(F.x + F.nx * lx, this.floorAt(t) + 0.03, F.z + F.nz * lx); pm.rotation.y = r() * TAU; this.group.add(pm);
    }
  }
  floorAt(t) { const p = this.W.path.at(t); return this.W.pathH[Math.round(clamp(t, 0, 1) * 400)]; }
  merge(list) { if (!list.length) return null; let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), I = []; let o = 0;
    for (const g of list) { const gi = g.index ? g.index.array : null; const c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); if (gi) for (const v of gi) I.push(v + o); else for (let v = 0; v < c; v++) I.push(v + o); o += c; }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setIndex(I); m.computeVertexNormals(); m.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return m; }

  // ---------------------------------------------------------------- the roof: the hillside itself, over the trench
  buildRoof() {
    const W = this.W, C = this.C, NT = 90, NS = 18, pos = [], idx = [];
    const t0 = C.t0 - C.e - 0.002, t1 = C.t1 + C.e + 0.002, S = C.W + 1.2;
    for (let i = 0; i <= NT; i++) {
      const t = lerp(t0, t1, i / NT), F = frame(W, t);
      for (let j = 0; j <= NS; j++) {
        const s = lerp(-S, S, j / NS), x = F.x + F.nx * s, z = F.z + F.nz * s;
        const nr = W.path.nearest(x, z), ph = W.pathH[Math.round(nr.t * 400)];
        let y = W.lidHeight(x, z, nr, ph, W.baseHeight(x, z));
        // the edges tuck down into the ground they meet
        y = Math.max(y, W.heightAt(x, z)) - (j === 0 || j === NS ? 0.3 : 0);
        pos.push(x, y, z);
      }
    }
    for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b = a + NS + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const roof = new THREE.Mesh(g, this.terrainMat()); roof.castShadow = true; roof.receiveShadow = true; this.group.add(roof);
  }
  // the ground's own material (same textures, snow and blight), drawn just in front of the terrain it lies on
  terrainMat(double = false) {
    const base = this.W.terrain.material, m = base.clone();
    m.onBeforeCompile = (sh, r) => base.onBeforeCompile(sh, r); m.customProgramCacheKey = () => 'caveGround' + (double ? 2 : 1);
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; if (double) m.side = THREE.DoubleSide;
    return m;
  }
  // ---------------------------------------------------------------- each mouth: the rock round the tunnel's opening
  buildPortals() {
    const W = this.W, C = this.C;
    for (const end of [0, 1]) {
      const R = end ? this.rings[this.rings.length - 1] : this.rings[0], F = R.F, floor = R.floor;
      const top = Math.max(...[-C.W - 1, 0, C.W + 1].map((s) => { const x = F.x + F.nx * s, z = F.z + F.nz * s, nr = W.path.nearest(x, z); return W.lidHeight(x, z, nr, W.pathH[Math.round(nr.t * 400)], W.baseHeight(x, z)); })) + 1.5;
      // in the cross-section's own plane: u across (left +), v up from the floor
      const shape = new THREE.Shape(); const S = C.W + 1.4;
      shape.moveTo(-S, -1.5); shape.lineTo(S, -1.5); shape.lineTo(S, top - floor); shape.lineTo(-S, top - floor); shape.lineTo(-S, -1.5);
      const hole = new THREE.Path(); const pts = R.ring.filter((p, k) => true).map((p) => [(p.x - F.x) * F.nx + (p.z - F.z) * F.nz, p.y - floor]).filter((q) => q[1] > -0.05);
      pts.sort((a, b) => Math.atan2(b[1] - 0.3, b[0]) - Math.atan2(a[1] - 0.3, a[0]));
      hole.moveTo(pts[0][0], pts[0][1]); for (const q of pts.slice(1)) hole.lineTo(q[0], q[1]); hole.lineTo(pts[0][0], -0.05); hole.closePath();
      shape.holes.push(hole);
      const sg = new THREE.ShapeGeometry(shape, 8);
      const P = sg.attributes.position; const n = this.noise;
      for (let i = 0; i < P.count; i++) {
        const u = P.getX(i), v = P.getY(i); const push = (n.fbm(u * 0.5, v * 0.5 + end * 9, 3) - 0.2) * 0.8 * smooth(clamp((Math.hypot(u, v - 1.2) - 3.2) / 1.5, 0, 1));
        const d = end ? push : -push;
        P.setXYZ(i, F.x + F.nx * u + F.tx * d, floor + v, F.z + F.nz * u + F.tz * d);
      }
      sg.computeVertexNormals();
      const m = new THREE.Mesh(sg, this.terrainMat(true)); m.castShadow = true; m.receiveShadow = true; this.group.add(m);
    }
  }
  // ---------------------------------------------------------------- dressing: the dead along the walls, the writing
  buildDressing() {
    const W = this.W, C = this.C, r = this.r, L = boneLibrary('hi'), bm = boneMaterial();
    const corpse = (t, side, sitting) => {
      const F = frame(W, t), floor = this.floorAt(t), lx = side * (C.R - 0.7), g = new THREE.Group();
      g.position.set(F.x + F.nx * lx, floor, F.z + F.nz * lx); g.rotation.y = Math.atan2(-F.nx * side, -F.nz * side); this.group.add(g);
      const add = (geo, p, rr) => { const m = new THREE.Mesh(geo, bm); m.position.set(...p); m.rotation.set(...rr); m.castShadow = true; g.add(m); return m; };
      add(L.pelvis, [0, 0.12, -0.05], [-1.2, 0, 0]); add(L.cage0, [0, 0.55, -0.12], [0.25, 0, 0]);
      add(L.femur, [-0.1, 0.1, 0.2], [Math.PI / 2 - 0.1, 0, 0.1]); add(L.femur, [0.1, 0.1, 0.22], [Math.PI / 2 - 0.15, 0, -0.1]);
      add(L.humerus, [-0.2, 0.35, 0.05], [0.3, 0, 0.4]);
      const head = new THREE.Group(); head.position.set(0, 0.86, -0.1); g.add(head);
      const sk = new THREE.Mesh(L.skull0, bm); sk.castShadow = true; head.add(sk); const jaw = new THREE.Mesh(L.mandible, bm); jaw.rotation.x = 0.35; head.add(jaw);
      const iron = new THREE.MeshStandardMaterial({ color: 0x4a4038, metalness: 0.75, roughness: 0.7 });
      const mor = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.17], [0.07, 0.165], [0.11, 0.1], [0.12, 0.03], [0.2, 0.0], [0.21, -0.01]].map(([a, b]) => new THREE.Vector2(a, b)), 16), iron); mor.scale.set(1, 1, 1.35); mor.position.set(0.25, 0.02, 0.35); mor.rotation.set(0.4, 0.3, 1.2); g.add(mor);
      return { g, head, F, floor, lx };
    };
    this.dead = [corpse(lerp(C.t0, C.t1, 0.47), 1, true), corpse(lerp(C.t0, C.t1, 0.52), -1, true)];
    // NON EXIBIS, in blood, come up on the wall where you were not looking
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
    x.clearRect(0, 0, 1024, 256); x.font = 'bold 150px serif'; x.fillStyle = 'rgba(110,8,6,0.95)'; x.textAlign = 'center'; x.fillText('NON EXIBIS', 512, 170);
    for (let i = 0; i < 60; i++) { const px = 120 + r() * 780, py = 150 + r() * 30; x.fillRect(px, py, 2 + r() * 4, 30 + r() * 80); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const t = lerp(C.t0, C.t1, 0.33), F = frame(W, t), floor = this.floorAt(t);
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0, roughness: 0.25, depthWrite: false }));
    pm.position.set(F.x + F.nx * (C.R - 0.15), floor + 1.7, F.z + F.nz * (C.R - 0.15)); pm.lookAt(F.x, floor + 1.7, F.z); this.group.add(pm); this.writing = { m: pm, t, show: 0 };
  }
  // ---------------------------------------------------------------- the mouth: three of the Emperor's men, and the torch
  buildMouth() {
    const W = this.W, C = this.C, L = boneLibrary('hi'), bm = boneMaterial(), r = this.r;
    const t = C.t0 - C.e - 0.012, F = frame(W, t), y0 = W.heightAt(F.x, F.z);
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5048, metalness: 0.7, roughness: 0.6 }), wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x5a1a14, roughness: 0.95, side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) {
      const s = k - 1, x = F.x + F.nx * (s * 1.9 + (s ? 0 : 0.4)) - F.tx * (k * 0.8), z = F.z + F.nz * (s * 1.9) - F.tz * (k * 0.8), y = W.heightAt(x, z);
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = r() * TAU; this.group.add(g);
      const add = (geo, m, p, rr) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...rr); o.castShadow = true; g.add(o); return o; };
      add(L.skull1, bm, [0, 0.07, 0.75], [1.4, 0.3, 0]); add(L.cage1, bm, [0, 0.12, 0.35], [Math.PI / 2, 0, 0.1]); add(L.pelvis, bm, [0, 0.1, -0.05], [-1.5, 0, 0]);
      add(L.femur, bm, [-0.1, 0.05, -0.1], [-Math.PI / 2 + 0.1, 0, 0.15]); add(L.femur, bm, [0.12, 0.05, -0.1], [-Math.PI / 2, 0, -0.2]);
      add(new THREE.PlaneGeometry(0.7, 0.9, 6, 6), cloth, [0, 0.16, 0.25], [-Math.PI / 2 + 0.05, 0, 0.2]);   // the rags of a red doublet
      add(new THREE.LatheGeometry([[0, 0.17], [0.07, 0.165], [0.11, 0.1], [0.12, 0.03], [0.2, 0.0], [0.21, -0.01]].map(([a, b]) => new THREE.Vector2(a, b)), 16), iron, [0.4, 0.08, 0.6], [1.2, 0.3, 0.4]);   // morion
      add(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6), wood, [-0.35, 0.04, 0.2], [Math.PI / 2, 0, 0.3 + s]);   // a halberd's haft
    }
    // the torch, dropped by the last of them, its head of pitch-soaked rag
    const tg = this.torchProp = new THREE.Group();
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.62, 8), wood); haft.position.y = 0.31; tg.add(haft);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.9 })); head.position.y = 0.66; tg.add(head);
    const tx = F.x + F.nx * 0.9 - F.tx * 1.2, tz = F.z + F.nz * 0.9 - F.tz * 1.2;
    tg.position.set(tx, W.heightAt(tx, tz) + 0.03, tz); tg.rotation.set(Math.PI / 2 - 0.08, 0, 0.6); this.group.add(tg);
    this.torchSpot = V(tx, W.heightAt(tx, tz), tz);
    const glint = new THREE.PointLight(0xff9040, 0, 3, 2); glint.position.copy(this.torchSpot).add(V(0, 0.4, 0)); this.group.add(glint); this.glint = glint;
  }

  // ---------------------------------------------------------------- the torch in the hand
  takeTorch() {
    const g = this.g; if (this.torch) return;
    this.torchProp.visible = false;
    const make = (k, light) => {
      const grp = new THREE.Group();
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.62, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 })); haft.position.y = 0.12; grp.add(haft);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x1a120a, roughness: 0.9 })); head.position.y = 0.47; grp.add(head);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.55, 0.18).multiplyScalar(3), transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      flame.position.y = 0.66; grp.add(flame);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5).multiplyScalar(4), toneMapped: false })); core.position.y = 0.56; grp.add(core);
      let L = null; if (light) { L = new THREE.PointLight(0xff8a3a, 10, 14, 1.8); L.position.y = 0.6; L.castShadow = false; grp.add(L); }
      grp.position.set(0.0, -0.06, 0.02); grp.rotation.set(0.9, 0, 0); k.rig.j.handL.add(grp);
      return { grp, flame, core, L, k };
    };
    this.torch = [make(g.me, true)];
    const comp = g.knightList.filter((k) => k !== g.me && !k.downed).slice(0, 3);
    comp.forEach((k, i) => this.torch.push(make(k, i === 0)));
    g.audio.stinger?.('breath', 0.15);
    g.ui.subtitle(['The pitch takes the flame at the third strike. The dark draws back a little, and no further.', ''], 4.5);
  }
  prompt() {
    if (this.torch || !this.torchSpot) return '';
    const m = this.g.me.pos; return Math.hypot(m.x - this.torchSpot.x, m.z - this.torchSpot.z) < 2.6 ? '<kbd>F</kbd>Take up the soldier\'s torch and light it' : '';
  }
  // the camera stays inside the tunnel
  clampCamera(want, look) {
    if (this.inCam < 0.02 && this.inside < 0.02) return;
    const W = this.W, C = this.C, nr = W.path.nearest(want.x, want.z);
    if (nr.t < C.t0 - C.e || nr.t > C.t1 + C.e) return;
    const p = W.path.at(nr.t); const floor = this.floorAt(nr.t);
    if (nr.d > C.R - 0.8) { const k = (C.R - 0.8) / nr.d; want.x = p.x + (want.x - p.x) * k; want.z = p.z + (want.z - p.z) * k; }
    want.y = clamp(want.y, floor + 0.6, floor + 2.35);
  }

  // ---------------------------------------------------------------- every frame
  update(dt, time) {
    const g = this.g, W = this.W, C = this.C, me = g.me; this.time += dt;
    // where the knight is, and how far into the dark the eye is
    const nr = W.path.nearest(me.pos.x, me.pos.z);
    const inT = nr.t > C.t0 && nr.t < C.t1 && nr.d < C.W;
    this.u = inT ? (nr.t - C.t0) / (C.t1 - C.t0) : nr.t <= C.t0 ? -1 : 2;
    const cam = g.engine.camera.position, cn = W.path.nearest(cam.x, cam.z);
    const deep = clamp((cn.t - C.t0 + C.e * 0.5) / 0.02, 0, 1) * clamp((C.t1 + C.e * 0.5 - cn.t) / 0.02, 0, 1) * (cn.d < C.W + 1 && cam.y < this.floorAt(cn.t) + 3.2 ? 1 : 0);
    this.inCam = damp(this.inCam || 0, deep, 3, dt); this.inside = inT ? 1 : 0;
    this.applyDark(this.inCam);
    // no going in without a light
    if (!this.torch && W.path.nearest(me.pos.x, me.pos.z).t > C.t0 - C.e + 0.002 && this.u < 1) {
      const F = frame(W, C.t0 - C.e - 0.006); me.pos.x = F.x; me.pos.z = F.z; me.pos.y = W.heightAt(F.x, F.z);
      if (!this.warned || this.time - this.warned > 5) { this.warned = this.time; g.ui.subtitle(['It is black as the pit in there. The dead soldier\'s torch lies at the mouth.', ''], 4); }
    }
    if (!this.torch && g.input?.pressed('KeyF') && this.prompt()) this.takeTorch();
    // the torch: flicker, gutter
    this.glint.intensity = this.torch ? 0 : 0.6 + Math.sin(time * 3) * 0.2;
    if (this.torch) {
      const fl = 0.85 + Math.sin(time * 23) * 0.06 + Math.sin(time * 37.7) * 0.05 + (Math.random() - 0.5) * 0.08;
      const gut = this.gutter > 0 ? (this.gutter -= dt, 0.04 + Math.max(0, Math.sin(time * 41)) * 0.18 * (this.gutter < 0.6 ? 3 : 1)) : 1;
      for (const T of this.torch) {
        T.flame.scale.set(1, (0.85 + Math.sin(time * 17 + T.k.id) * 0.15) * Math.max(0.2, gut), 1); T.core.scale.setScalar(Math.max(0.3, gut));
        if (T.L) T.L.intensity = 10 * fl * gut;
        if (Math.random() < dt * 6) g.fx.wisp?.(T.flame.getWorldPosition(V(0, 0, 0)).add(V(0, 0.2, 0)), 0.25, [0.12, 0.1, 0.09]);
      }
      if (this.inCam > 0.5) g.terror && (g.terror.next = Math.max(g.terror.next, 15));   // the road's scares wait: He has His own in here
    }
    // drips
    for (const d of this.drips) { d.next -= dt; if (d.next < 0 && this.inCam > 0.3) { d.next = 2 + Math.random() * 6; this.drip(V(d.x, d.y, d.z)); } }
    this.updateScares(dt, time);
  }
  // inside, the sky's light does not reach: only the torches light it
  applyDark(k) {
    const e = this.g.engine, sc = this.g.scene;
    if (!this.base || k < 0.001) { this.base = { sun: e.sun.intensity, hemi: e.hemi.intensity, fill: e.fill.intensity, fog: sc.fog.color.clone(), fd: sc.fog.density }; if (k < 0.001) return; }
    const B = this.base;
    e.sun.intensity = B.sun * (1 - 0.97 * k); e.hemi.intensity = B.hemi * (1 - 0.93 * k); e.fill.intensity = B.fill * (1 - k);
    sc.fog.color.copy(B.fog).lerp(new THREE.Color(0x020203), k); sc.fog.density = lerp(B.fd, 0.055, k);
  }
  drip(p) {
    const A = this.g.audio, ctx = A.ctx; if (!ctx || !A.sfx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = 'sine'; o.frequency.setValueAtTime(1400 + Math.random() * 900, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.09);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.09, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(gn); if (pan) { pan.pan.value = (Math.random() - 0.5) * 1.6; gn.connect(pan).connect(A.sfx); } else gn.connect(A.sfx);
    o.start(t); o.stop(t + 0.3);
  }

  // ---------------------------------------------------------------- what He does in the dark
  once(k, u, fn) { if (!this.done[k] && this.u >= u && this.u < 1.05) { this.done[k] = true; fn(); } }
  devil() { const D = phantomDevil(this.g); D.owner = 'cave'; return D; }
  ahead(dist, lateral = 0) { const W = this.W, C = this.C, me = this.g.me.pos, nr = W.path.nearest(me.x, me.z); const t = clamp(nr.t + dist / 420, C.t0 + 0.002, C.t1 + 0.03); const F = frame(W, t); return V(F.x + F.nx * lateral, this.floorAt(Math.min(t, C.t1)), F.z + F.nz * lateral); }
  updateScares(dt, time) {
    const g = this.g, me = g.me; if (!this.torch) return;
    const dread = (a) => { if (g.dread) g.dread.level = Math.min(1, g.dread.level + a); };
    const camF = () => { const f = V(0, 0, 0); g.engine.camera.getWorldDirection(f); f.y = 0; return f.normalize(); };
    // 1: at the mouth, a voice
    this.once('voice', 0.04, () => { g.audio.whisper(g.engine.camera.position.clone().add(V(0.5, 0, 0)), 2.6, 0.5); g.ui.subtitle(['Leave the light behind, little knight. You will see me better.', ''], 4, true); dread(0.08); });
    // 2: the torch gutters almost out; when it comes back, He is standing in the tunnel ahead
    this.once('gutter', 0.14, () => { this.gutter = 2.6; g.audio.silence?.(3); g.audio.stinger('breath', 0.5);
      this.act = { kind: 'standAhead', t: 0 }; });
    // 3: the writing on the wall
    this.once('writing', 0.27, () => { this.writing.show = 1; });
    // 4: footsteps behind that keep pace, and stop a step after you do; breath at the ear; your name
    this.once('steps', 0.38, () => { this.act = { kind: 'steps', t: 0, n: 0 }; });
    // 5: the dead turn their heads to watch you pass
    this.once('dead', 0.44, () => { this.watchDead = 1; g.audio.whisper(this.dead[0].g.position.clone().setY(this.dead[0].floor + 1), 1.4, 0.35); });
    // 6: eyes in the dark ahead, the light fails, and they come
    this.once('eyes', 0.56, () => { if (g.terror && !g.terror.active) g.terror.active = g.terror.eyes(); this.gutter = 3.2; dread(0.12);
      setTimeout(() => { if (!g.world || g.world !== this.W) return; if (g.isHost) { const b = this.ahead(-9); g.summonAround(b, 'crawler', 3 + g.knightList.length); const a = this.ahead(10); g.summonAround(a, 'shade', 2); } g.audio.scream(me.pos.clone().add(V(0, 1.6, 0)), false, 0.7, 0.85); }, 2600); });
    // 7: He walks upside down across the roof, over your head
    this.once('roof', 0.72, () => { this.act = { kind: 'roof', t: 0 }; g.audio.stinger('cluster', 0.5); dread(0.1); });
    // 8: at the far mouth, against the light, Him
    this.once('exit', 0.9, () => { this.act = { kind: 'exit', t: 0 }; });
    // the writing comes up, slowly
    if (this.writing.show) { const M = this.writing.m.material; M.opacity = Math.min(1, M.opacity + dt * 0.35); }
    // the dead watch
    if (this.watchDead) for (const d of this.dead) { d.head.updateWorldMatrix(true, false); const hp = d.head.getWorldPosition(V(0, 0, 0)); const want = Math.atan2(me.pos.x - hp.x, me.pos.z - hp.z) - d.g.rotation.y; let a = Math.atan2(Math.sin(want), Math.cos(want)); a = clamp(a, -1.6, 1.6); d.head.rotation.y = damp(d.head.rotation.y, a, 1.2, dt); d.head.rotation.z = Math.sin(time * 0.3) * 0.15; }
    const A = this.act; if (!A) return; A.t += dt;
    const D = A.kind === 'steps' ? null : this.devil();
    if (A.kind === 'standAhead') {
      if (A.t > 2.4 && !A.shown) { A.shown = true; const p = this.ahead(7); D.pos.copy(p); D.yaw = Math.atan2(me.pos.x - p.x, me.pos.z - p.z); D.state = 'watch'; D.t = 2; D.mesh.visible = true; D.mesh.rotation.set(0, D.yaw, 0); g.audio.stinger('drone', 0.6); g.audio.heartbeat(0.6); dread(0.15); }
      if (A.shown) { D.animate(dt, time, g.engine.camera.position, [me]); if (A.t > 3.3) { releasePhantom(D, 'cave'); g.audio.whisper(D.pos.clone().setY(D.pos.y + 3), 1, 0.4); this.act = null; } }
    } else if (A.kind === 'steps') {
      const f = camF(); if (A.t > 0.5 * A.n + 0.4 && A.n < 8) { A.n++; g.audio.footstep(me.pos.clone().addScaledVector(f, -3 + A.n * 0.15), true, 1.3); }
      if (A.n >= 8 && A.t > 5.2 && !A.breath) { A.breath = true; g.audio.whisper(g.engine.camera.position.clone().addScaledVector(f, -0.3), 1.8, 0.7); g.ui.subtitle([`…${me.name || 'knight'}…`, ''], 3); dread(0.1); }
      if (A.t > 7) this.act = null;
    } else if (A.kind === 'roof') {
      const C = this.C, W = this.W; const k = clamp(A.t / 6, 0, 1);
      const nr = W.path.nearest(me.pos.x, me.pos.z), F = frame(W, nr.t + 0.01), floor = this.floorAt(nr.t + 0.01);
      const lx = lerp(-C.R * 0.8, C.R * 0.8, k);
      D.pos.set(F.x + F.nx * lx, floor + 2.75, F.z + F.nz * lx); D.yaw = Math.atan2(F.nx, F.nz); D.state = 'watch'; D.mesh.visible = true;
      D.animate(dt, time, g.engine.camera.position, [me]); D.mesh.scale.set(0.8, -0.8, 0.8);   // hanging from the roof, head down
      if (A.t > 6.2) { D.mesh.scale.set(1, 1, 1); releasePhantom(D, 'cave'); this.act = null; g.audio.whisper(me.pos.clone().setY(me.pos.y + 2.5), 1.4, 0.5); }
    } else if (A.kind === 'exit') {
      if (!A.shown) { A.shown = true; const F = frame(this.W, this.C.t1 - 0.004); D.pos.set(F.x, this.floorAt(this.C.t1), F.z); D.yaw = Math.atan2(-F.tx, -F.tz); D.state = 'watch'; D.t = 2; D.mesh.visible = true; D.mesh.scale.set(1, 1, 1); g.audio.stinger('drone', 0.7);
        g.ui.subtitle(['Go on up, then. He has been waiting for you longer than I have.', ''], 5, true); }
      D.animate(dt, time, g.engine.camera.position, [me]);
      if (A.t > 4.5 && D.state === 'watch') { D.state = 'vanish'; D.t = 0; g.engine.shake(0.5, 0.8); g.audio.scream(D.pos.clone().setY(D.pos.y + 20), true, 0.6, 0.45); }
      if (D.state === 'vanish' && D.t > 1.4) { releasePhantom(D, 'cave'); this.act = null; }
    }
  }
  dispose() {
    if (this.torch) for (const T of this.torch) T.grp.removeFromParent();
    const D = this.g._phantomDevil; if (D && D.owner === 'cave') { D.mesh.scale.set(1, 1, 1); releasePhantom(D, 'cave'); }
    if (this.base) { const e = this.g.engine, B = this.base; e.sun.intensity = B.sun; e.hemi.intensity = B.hemi; e.fill.intensity = B.fill; this.g.scene.fog.color.copy(B.fog); this.g.scene.fog.density = B.fd; }
    this.group.removeFromParent(); this.group.traverse((o) => o.geometry?.dispose?.());
  }
}
