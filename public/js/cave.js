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
import { makeFlame } from './flame.js';
import { makeFrozen } from './people.js';
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
    W.caveHalf = (t, side = 0) => Math.max(1.5, this.sizeAt(t).w - 1.0) + (side ? W.passageAt(t, side) * 0.85 : 0);   // how far from the line of the way the walls let you go
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
    const NT = 260, NA = 52, pos = [], uv = [], idx = [];
    // side passages: openings that run off into the black and are never explored
    this.rings = [];
    for (let i = 0; i <= NT; i++) {
      const t = lerp(C.t0 - C.e, C.t1 + C.e, i / NT), F = frame(W, t), floor = this.floorAt(t), S = this.sizeAt(t);
      const ring = [];
      for (let k = 0; k <= NA; k++) {
        const a = (k / NA) * TAU;   // 0 = the left wall at floor height, up over the roof, down the right wall and under
        const cx = Math.cos(a), cy = Math.sin(a);
        // broken, uneven rock: big lumps and hollows, ribs and fractures, none of it regular
        const lump = n.fbm(t * 70 + cx * 1.3, cy * 1.3 + 3.1, 4) * 1.3 + (n.ridge(t * 210 + cx * 0.6, a * 2.7, 3) - 0.5) * 0.9 + (n.fbm(t * 400 + a, a * 6.1, 2) - 0.2) * 0.3;
        const wall = Math.max(0, 1 - Math.abs(cy - 0.25) * 1.6);
        const niche = Math.max(0, n.fbm(t * 26 + 7, cx * 2 + 5, 2) - 0.55) * 7 * wall;
        const sd = cx >= 0 ? 1 : -1, side = W.passageAt(t, sd) * Math.max(0, 1 - Math.abs(cy - 0.3) * 1.4);
        let lx = cx * (S.w + lump * (0.5 + 0.3 * S.k) + niche + side) * (1 + 0.12 * Math.max(0, cy));
        lx = clamp(lx, -(W.caveWidthAt(t, -1) - 0.5), W.caveWidthAt(t, 1) - 0.5);   // never out past the trench
        const ly = cy > 0 ? 0.3 + Math.pow(cy, 0.8) * (S.h + lump * 0.7) : cy * 1.6;
        const x = F.x + F.nx * lx, z = F.z + F.nz * lx, y = floor + ly;
        pos.push(x, y, z); uv.push(k / NA * 7, i / NT * 46); ring.push(V(x, y, z));
      }
      this.rings.push({ t, F, floor, ring, S });
    }
    for (let i = 0; i < NT; i++) for (let k = 0; k < NA; k++) { const a = i * (NA + 1) + k, b = a + NA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, rock); m.receiveShadow = true; this.group.add(m);
    // the floor: wet rock, grit and mud over the trench (no snow under the mountain), uneven
    { const fp = [], fu = [], fi = [], NS = 14;
      for (let i = 0; i <= NT; i++) { const R = this.rings[i]; for (let j = 0; j <= NS; j++) { const q = j / NS, s = lerp(-R.S.w - W.passageAt(R.t, -1) + 0.3, R.S.w + W.passageAt(R.t, 1) - 0.3, q); const edge = Math.abs(q - 0.5) * 2;
        const fx = R.F.x + R.F.nx * s, fzz = R.F.z + R.F.nz * s; fp.push(fx, W.heightAt(fx, fzz) + 0.02 + Math.max(0, edge - 0.8) * 2.0, fzz); fu.push(q * 5, i / NT * 46); } }
      for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) { const a = i * (NS + 1) + j, b = a + NS + 1; fi.push(a, a + 1, b, a + 1, b + 1, b); }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi); fg.computeVertexNormals();
      const floorM = rock.clone(); floorM.color = new THREE.Color(0x3a3530); floorM.side = THREE.FrontSide; floorM.onBeforeCompile = rock.onBeforeCompile; floorM.customProgramCacheKey = () => 'caveFloor';
      floorM.polygonOffset = true; floorM.polygonOffsetFactor = -4; floorM.polygonOffsetUnits = -4; const fm = new THREE.Mesh(fg, floorM); fm.receiveShadow = true; this.group.add(fm); }
    // stalactites: crooked, knobbled points of rock, in clusters where water has run; stalagmites rising to meet them;
    // fallen blocks along the walls
    const r = this.r, sg = []; this.drips = [];
    const spike = (len, rad, seed, up) => {
      const cg = new THREE.ConeGeometry(rad, len, 7, 6, false); const P = cg.attributes.position, nz = makeNoise(seed);
      for (let v = 0; v < P.count; v++) {
        let x = P.getX(v), y = P.getY(v), z = P.getZ(v); const k = 0.5 - y / len;   // 0 at the base, 1 at the tip
        const knob = 1 + (nz.fbm(y * 9 + seed, Math.atan2(z, x) * 1.5, 3) - 0.3) * 0.7 + Math.sin(y * 23 + seed) * 0.08;
        x *= knob; z *= knob;
        x += (nz.fbm(seed, y * 2.1, 2) - 0.5) * len * 0.22 * k; z += (nz.fbm(y * 2.1, seed, 2) - 0.5) * len * 0.22 * k;   // crooked
        P.setXYZ(v, x, y, z);
      }
      if (!up) cg.rotateX(Math.PI); cg.computeVertexNormals(); return cg;
    };
    for (let k = 0; k < 150; k++) {
      const t = lerp(C.t0 + 0.006, C.t1 - 0.006, r()), F = frame(W, t), floor = this.floorAt(t), S = this.sizeAt(t);
      const lx = (r() - 0.5) * S.w * 1.5, roof = this.roofAt(t, lx) - 0.25;
      const n0 = 1 + Math.floor(r() * 3);
      for (let c = 0; c < n0; c++) {
        const len = (0.25 + r() ** 2 * 2.2) * (0.6 + 0.6 * S.k), rad = 0.06 + len * (0.09 + r() * 0.07);
        const ox = (r() - 0.5) * 0.9, oz = (r() - 0.5) * 0.9;
        const cg = spike(len, rad, k * 7 + c, false); cg.translate(F.x + F.nx * (lx + ox) + F.tx * oz, roof - len / 2 + 0.15, F.z + F.nz * (lx + ox) + F.tz * oz); sg.push(cg);
        if (c === 0 && k % 3 === 0) this.drips.push({ x: F.x + F.nx * (lx + ox) + F.tx * oz, y: roof - len, z: F.z + F.nz * (lx + ox) + F.tz * oz, floor, next: r() * 4 });
      }
    }
    for (let k = 0; k < 60; k++) {
      const t = lerp(C.t0 + 0.006, C.t1 - 0.006, r()), F = frame(W, t), S = this.sizeAt(t), side = r() < 0.5 ? -1 : 1;
      const lx = side * (S.w - 0.4 - r() * 1.6), y = this.floorAt(t) + 0.1;
      if (r() < 0.55) { const len = 0.3 + r() ** 2 * 1.4; const cg = spike(len, 0.12 + len * 0.18, 900 + k, true); cg.translate(F.x + F.nx * lx, y + len / 2 - 0.05, F.z + F.nz * lx); sg.push(cg); }
      else { const sz = 0.3 + r() * 0.9; const bg = new THREE.IcosahedronGeometry(sz, 1); const P = bg.attributes.position; for (let v = 0; v < P.count; v++) { const f = 0.75 + r() * 0.45; P.setXYZ(v, P.getX(v) * f, P.getY(v) * f * 0.7, P.getZ(v) * f); } bg.computeVertexNormals(); bg.translate(F.x + F.nx * lx, y + sz * 0.25, F.z + F.nz * lx); sg.push(bg); }
    }
    for (let k = 0; k < 40; k++) {
      const t = lerp(C.t0 + 0.01, C.t1 - 0.01, r()), S = this.sizeAt(t); if (S.k < 0.45) continue;
      const F = frame(W, t), side = r() < 0.5 ? -1 : 1, lx = side * S.w * (0.45 + r() * 0.35), x = F.x + F.nx * lx, z = F.z + F.nz * lx;
      const y0 = W.heightAt(x, z), y1 = this.roofAt(t, lx), rad = 0.25 + r() * 0.45, hh = y1 - y0 + 0.4;
      const cg = new THREE.CylinderGeometry(rad * 0.7, rad, hh, 10, 12); const P = cg.attributes.position, nz = makeNoise(4000 + k);
      for (let v = 0; v < P.count; v++) { const yy = P.getY(v) / hh + 0.5, waist = 1 - 0.45 * Math.exp(-(((yy - 0.55) / 0.18) ** 2)), flare = 1 + 1.2 * Math.pow(1 - yy, 6) + 0.9 * Math.pow(yy, 6); const knob = waist * flare * (1 + (nz.fbm(yy * 6, Math.atan2(P.getZ(v), P.getX(v)) * 1.3, 3) - 0.3) * 0.5); P.setX(v, P.getX(v) * knob); P.setZ(v, P.getZ(v) * knob); }
      cg.computeVertexNormals(); cg.translate(x, y0 + hh / 2 - 0.2, z); sg.push(cg); W.addCollider(x, z, rad * 1.1);
    }
    const merged = this.merge(sg); if (merged) { const sm = new THREE.Mesh(merged, rock); sm.castShadow = true; this.group.add(sm); }
    // pools of black water on the floor
    const water = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.03, metalness: 0.2 });
    for (let k = 0; k < 14; k++) {
      const t = lerp(C.t0 + 0.02, C.t1 - 0.02, r()), F = frame(W, t), S = this.sizeAt(t), lx = (r() - 0.5) * S.w;
      const pg = new THREE.CircleGeometry(0.6 + r() * 1.6, 20); pg.scale(1, 0.5 + r() * 0.5, 1); pg.rotateX(-Math.PI / 2);
      const pm = new THREE.Mesh(pg, water); pm.position.set(F.x + F.nx * lx, this.floorAt(t) + 0.2, F.z + F.nz * lx); pm.rotation.y = r() * TAU; this.group.add(pm);
    }
  }
  // the tunnel's half-width and height at t: narrow at the mouths, opening into high chambers and pinching between
  sizeAt(t) {
    const C = this.C, u = clamp((t - (C.t0 - C.e)) / (C.t1 - C.t0 + 2 * C.e), 0, 1), n = this.noise;
    const k = clamp(0.5 + 0.5 * Math.sin(u * Math.PI * 3.4 - 1.3) + (n.fbm(u * 9, 4.2, 2) - 0.25) * 0.5, 0, 1) * smooth(clamp(u / 0.12, 0, 1)) * smooth(clamp((1 - u) / 0.12, 0, 1));
    return { k, w: 3.6 + 3.6 * k, h: 3.4 + 3.4 * k };
  }
  roofAt(t, lx) { const S = this.sizeAt(t); const c = clamp(lx / (S.w * 1.05), -0.99, 0.99); return this.floorAt(t) + 0.3 + Math.pow(Math.sqrt(1 - c * c), 0.8) * S.h; }
  floorAt(t) { const p = this.W.path.at(t); return this.W.pathH[Math.round(clamp(t, 0, 1) * 400)]; }
  merge(list) { if (!list.length) return null; let n = 0; for (const g of list) n += g.attributes.position.count; const P = new Float32Array(n * 3), I = []; let o = 0;
    for (const g of list) { const gi = g.index ? g.index.array : null; const c = g.attributes.position.count; P.set(g.attributes.position.array, o * 3); if (gi) for (const v of gi) I.push(v + o); else for (let v = 0; v < c; v++) I.push(v + o); o += c; }
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setIndex(I); m.computeVertexNormals(); m.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2)); return m; }

  // ---------------------------------------------------------------- the roof: the hillside itself, over the trench
  buildRoof() {
    const W = this.W, C = this.C, NT = 90, NS = 18, pos = [], idx = [];
    const t0 = C.t0 - C.e - 0.002, t1 = C.t1 + C.e + 0.002;
    for (let i = 0; i <= NT; i++) {
      const t = lerp(t0, t1, i / NT), F = frame(W, t);
      for (let j = 0; j <= NS; j++) {
        const s = lerp(-W.caveWidthAt(t, -1) - 1.2, W.caveWidthAt(t, 1) + 1.2, j / NS), x = F.x + F.nx * s, z = F.z + F.nz * s;
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
      const F = frame(W, t), lx = side * (this.sizeAt(t).w - 1.1), x = F.x + F.nx * lx, z = F.z + F.nz * lx, floor = W.heightAt(x, z);
      const fz = makeFrozen('slump', 3 + Math.round(t * 1000)), g = fz ? fz.root : new THREE.Group();
      g.position.set(x, floor, z); g.rotation.y = Math.atan2(-F.nx * side, -F.nz * side); this.group.add(g);
      const head = fz ? fz.head : new THREE.Group(); const base = head.rotation.clone();
      return { g, head, base, F, floor, lx };
    };
    this.dead = [corpse(lerp(C.t0, C.t1, 0.47), 1, true), corpse(lerp(C.t0, C.t1, 0.52), -1, true)];
    // NON EXIBIS, in blood, come up on the wall where you were not looking
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d');
    x.clearRect(0, 0, 1024, 256); x.font = 'bold 150px serif'; x.fillStyle = 'rgba(110,8,6,0.95)'; x.textAlign = 'center'; x.fillText('NON EXIBIS', 512, 170);
    for (let i = 0; i < 60; i++) { const px = 120 + r() * 780, py = 150 + r() * 30; x.fillRect(px, py, 2 + r() * 4, 30 + r() * 80); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const t = lerp(C.t0, C.t1, 0.33), F = frame(W, t), floor = this.floorAt(t);
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0, roughness: 0.25, depthWrite: false }));
    const ww = this.sizeAt(t).w - 0.35; pm.position.set(F.x + F.nx * ww, floor + 1.9, F.z + F.nz * ww); pm.lookAt(F.x, floor + 1.7, F.z); this.group.add(pm); this.writing = { m: pm, t, show: 0 };
  }
  // ---------------------------------------------------------------- the mouth: three of the Emperor's men, and the torch
  buildMouth() {
    const W = this.W, C = this.C, L = boneLibrary('hi'), bm = boneMaterial(), r = this.r;
    const t = C.t0 - C.e - 0.012, F = frame(W, t), y0 = W.heightAt(F.x, F.z);
    const iron = new THREE.MeshStandardMaterial({ color: 0x5a5048, metalness: 0.7, roughness: 0.6 }), wood = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.85 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x5a1a14, roughness: 0.95, side: THREE.DoubleSide });
    const poses = ['lie', 'sit', 'kneel'];
    for (let k = 0; k < 3; k++) {
      const sd = k - 1, x = F.x + F.nx * (sd * 2.1 + (sd ? 0 : 0.5)) - F.tx * (k * 0.9), z = F.z + F.nz * (sd * 2.1) - F.tz * (k * 0.9), y = W.heightAt(x, z);
      const fz = makeFrozen(poses[k], 11 + k * 5); if (!fz) continue;
      fz.root.position.set(x, y, z); fz.root.rotation.y = Math.atan2(F.tx, F.tz) + Math.PI + (r() - 0.5) * 1.2; this.group.add(fz.root);
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.9, 6), wood); hb.position.set(x + (r() - 0.5) * 1.2, y + 0.05, z + (r() - 0.5) * 1.2); hb.rotation.set(Math.PI / 2, r() * 3, 0.1); hb.castShadow = true; this.group.add(hb);
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
      const tip = new THREE.Object3D(); tip.position.y = 0.53; grp.add(tip);   // where the flame stands (it burns upright, in the world)
      const fl = makeFlame({ height: 0.46, width: 0.2, tongues: 3, sparks: 26 }); this.group.add(fl.group);
      let L = null; if (light) { L = new THREE.PointLight(0xff8a3a, 10, 14, 1.8); L.position.y = 0.6; L.castShadow = false; grp.add(L); }
      grp.position.set(0.0, -0.06, 0.02); grp.rotation.set(0.9, 0, 0); k.rig.j.handL.add(grp);
      return { grp, tip, fl, L, k };
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
    const S = this.sizeAt(nr.t), lim = Math.max(1.5, S.w - 1.2);
    if (nr.d > lim) { const k = lim / nr.d; want.x = p.x + (want.x - p.x) * k; want.z = p.z + (want.z - p.z) * k; }
    want.y = clamp(want.y, floor + 0.6, floor + Math.max(2.2, S.h - 0.8));
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
        T.tip.getWorldPosition(T.fl.group.position); T.fl.group.scale.setScalar(Math.max(0.25, Math.min(1, gut * 1.2))); T.fl.update(time, g.engine.camera.position, fl * Math.max(0.15, gut));
        if (T.L) T.L.intensity = 10 * fl * gut;
        if (Math.random() < dt * 5) g.fx.wisp?.(T.fl.group.position.clone().add(V(0, 0.45, 0)), 0.25, [0.08, 0.07, 0.065]);
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
      for (let i = 0; i < 7; i++) setTimeout(() => { if (!g.world || g.world !== this.W || !g.dread) return; g.dread.spawnPhantom(i % 3 ? 'rush' : 'lurk'); }, 2400 + i * 650);
      setTimeout(() => { if (g.world === this.W) g.audio.scream(me.pos.clone().add(V(0, 1.6, 0)), false, 0.7, 0.85); }, 2600); });
    // 7: He walks upside down across the roof, over your head
    this.once('roof', 0.72, () => { this.act = { kind: 'roof', t: 0 }; g.audio.stinger('cluster', 0.5); dread(0.1); });
    // 8: at the far mouth, against the light, Him
    this.once('exit', 0.9, () => { this.act = { kind: 'exit', t: 0 }; });
    // the writing comes up, slowly
    if (this.writing.show) { const M = this.writing.m.material; M.opacity = Math.min(1, M.opacity + dt * 0.35); }
    // the dead watch
    if (this.watchDead) for (const d of this.dead) { d.head.updateWorldMatrix(true, false); const hp = d.head.getWorldPosition(V(0, 0, 0)); const want = Math.atan2(me.pos.x - hp.x, me.pos.z - hp.z) - d.g.rotation.y; let a = Math.atan2(Math.sin(want), Math.cos(want)); a = clamp(a, -1.3, 1.3); d.turn = damp(d.turn || 0, a, 0.9, dt); d.head.rotation.set(d.base.x - 0.25 * Math.abs(d.turn), d.base.y + d.turn, d.base.z * (1 - Math.abs(d.turn)), 'YXZ'); }
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
      // he comes over the roof toward you, stops right above you and looks down, then scuttles away behind you
      const W = this.W; if (A.t0 === undefined) { A.t0 = W.path.nearest(me.pos.x, me.pos.z).t; A.side = Math.random() < 0.5 ? -1 : 1; }
      const T = A.t, u = T < 2.6 ? lerp(0.014, 0.0015, smooth(T / 2.6)) : T < 4.4 ? 0.0015 : lerp(0.0015, -0.024, smooth(clamp((T - 4.4) / 1.6, 0, 1)));
      const go = T < 2.6 ? 1 : T < 4.4 ? 0 : 2.6;
      const t = A.t0 + u, F = frame(W, t), S = this.sizeAt(t), lx = A.side * S.w * (0.25 + 0.1 * Math.sin(T * 1.7));
      const yaw = T < 4.4 ? Math.atan2(-F.tx, -F.tz) : Math.atan2(-F.tx, -F.tz);
      D.state = 'watch'; D.mesh.visible = true; D.yaw = yaw; D.animate(dt, time, g.engine.camera.position, [me]);
      D.crawl(dt, time, V(F.x + F.nx * lx, 0, F.z + F.nz * lx), yaw, this.roofAt(t, lx) - 0.35, go);
      if (T > 2.6 && !A.still) { A.still = true; g.audio.whisper(D.pos.clone(), 1.6, 0.6); g.audio.heartbeat?.(0.7); dread(0.12); }
      if (T > 4.4 && !A.run) { A.run = true; g.audio.scream(D.pos.clone(), false, 0.35, 1.4); g.engine.shake(0.15, 0.3); for (let i = 0; i < 4; i++) setTimeout(() => this.W === g.world && g.audio.footstep(D.pos.clone(), true, 0.7), i * 140); }
      if (T > 6.1) { releasePhantom(D, 'cave'); this.act = null; g.audio.whisper(me.pos.clone().setY(me.pos.y + 2.5), 1.4, 0.5); }
    } else if (A.kind === 'exit') {
      if (!A.shown) { A.shown = true; const F = frame(this.W, this.C.t1 - 0.004); D.pos.set(F.x, this.floorAt(this.C.t1), F.z); D.yaw = Math.atan2(-F.tx, -F.tz); D.state = 'watch'; D.t = 2; D.mesh.visible = true; g.audio.stinger('drone', 0.7);
        g.ui.subtitle(['Go on up, then. He has been waiting for you longer than I have.', ''], 5, true); }
      D.animate(dt, time, g.engine.camera.position, [me]);
      if (A.t > 4.5 && D.state === 'watch') { D.state = 'vanish'; D.t = 0; g.engine.shake(0.5, 0.8); g.audio.scream(D.pos.clone().setY(D.pos.y + 20), true, 0.6, 0.45); }
      if (D.state === 'vanish' && D.t > 1.4) { releasePhantom(D, 'cave'); this.act = null; }
    }
  }
  dispose() {
    if (this.torch) for (const T of this.torch) { T.grp.removeFromParent(); T.fl.group.removeFromParent(); }
    const D = this.g._phantomDevil; if (D && D.owner === 'cave') releasePhantom(D, 'cave');
    if (this.base) { const e = this.g.engine, B = this.base; e.sun.intensity = B.sun; e.hemi.intensity = B.hemi; e.fill.intensity = B.fill; this.g.scene.fog.color.copy(B.fog); this.g.scene.fog.density = B.fd; }
    this.group.removeFromParent(); this.group.traverse((o) => o.geometry?.dispose?.());
  }
}
