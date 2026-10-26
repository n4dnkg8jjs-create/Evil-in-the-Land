// Cloth that behaves like cloth: a Verlet mass-spring sheet (stretch, shear and bend springs), pinned along one
// edge to a body (a belt line, the shoulders), swinging with gravity and a gusting wind, and pushed out of the
// body by capsules on its bones so it drapes over hips, thighs and knees instead of passing through them.
// Used for the priest's cassock and the sutler's cloak: a few hundred particles each, simulated only while
// someone is close enough to see it.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();
// what the camera can see this frame (set by the game); cloth out of view is not simulated, and catches up when seen
const VIEW = { frustum: new THREE.Frustum(), m: new THREE.Matrix4(), set: false }, _s = new THREE.Sphere();
export function setViewFrustum(cam) { VIEW.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); VIEW.frustum.setFromProjectionMatrix(VIEW.m); VIEW.set = true; }
export function inView(p, r = 2.5) { if (!VIEW.set) return true; _s.center.copy(p); _s.radius = r; return VIEW.frustum.intersectsSphere(_s); }

export class Cloth {
  // pins(i) -> { bone, local: Vector3 } for each column i of the top row; ring: true joins the last column to the first
  constructor({ cols, rows, pins, len, material, ring = false, stiff = 0.95, damping = 0.985, mass = 1, thick = 0.02, axis = null, hold = 0.88, hull = null }) {
    this.hull = hull;
    this.cols = cols; this.rows = rows; this.ring = ring; this.pins = pins; this.damping = damping; this.thick = thick; this.axis = axis; this.hold = hold;
    const n = cols * rows; this.n = n;
    this.pos = new Float32Array(n * 3); this.prev = new Float32Array(n * 3); this.rest = [];
    this.capsules = []; this.wind = new THREE.Vector3(); this.gust = 0; this.time = Math.random() * 10; this.ground = -1e9; this.inited = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(n * 2), idx = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { uv[(j * cols + i) * 2] = i / (cols - (ring ? 0 : 1)) * (ring ? 3 : 1.5); uv[(j * cols + i) * 2 + 1] = j / (rows - 1) * 2; }
    const C = ring ? cols : cols - 1;
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < C; i++) {
      const a = j * cols + i, b = j * cols + ((i + 1) % cols), c = a + cols, d = b + cols;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material); this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    // springs: [a, b, restLength, stiffness]
    this.springs = []; this.lenAlong = len / (rows - 1);
    const add = (a, b, k) => this.springs.push([a, b, 0, k]);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * cols + i; const right = (i + 1 < cols) ? a + 1 : ring ? j * cols : -1, right2 = (i + 2 < cols) ? a + 2 : ring ? j * cols + (i + 2) % cols : -1;
      if (right >= 0) add(a, right, stiff);
      if (j + 1 < rows) add(a, a + cols, stiff);
      if (j + 1 < rows && right >= 0) { add(a, right + cols, stiff * 0.5); add(right, a + cols, stiff * 0.5); }
      if (right2 >= 0) add(a, right2, 0.25);
      if (j + 2 < rows) add(a, a + 2 * cols, 0.3);
    }
  }
  // the pins are fixed in their bones' frames: work them out once
  pinData() { if (!this._pins) { this._pins = []; for (let i = 0; i < this.cols; i++) this._pins.push(this.pins(i)); this._pinBones = [...new Set(this._pins.map((p) => p.bone))]; } return this._pins; }
  pinWorld(i, out, fresh = true) { const p = this.pinData()[i]; if (fresh) p.bone.updateWorldMatrix(true, false); return out.copy(p.local).applyMatrix4(p.bone.matrixWorld); }
  // springs packed into flat typed arrays (endpoints, rest length, stiffness, and which ends are free to move)
  packSprings() {
    const S = this.springs, n = S.length, cols = this.cols;
    this.sA = new Int32Array(n); this.sB = new Int32Array(n); this.sL = new Float32Array(n); this.sK = new Float32Array(n); this.sWa = new Float32Array(n); this.sWb = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [a, b, L, k] = S[i]; const pa = a < cols ? 0 : 1, pb = b < cols ? 0 : 1, w = pa + pb;
      this.sA[i] = a * 3; this.sB[i] = b * 3; this.sL[i] = L; this.sK[i] = k; this.sWa[i] = w ? pa / w : 0; this.sWb[i] = w ? pb / w : 0;
    }
    this.capBuf = new Float32Array(this.capsules.length * 7);
  }
  // lay the cloth out hanging straight down from its pins, and measure its springs there
  init() {
    const P = this.pos;
    for (let i = 0; i < this.cols; i++) {
      this.pinWorld(i, _a);
      const flare = this.pinData()[i].flare || V0;
      for (let j = 0; j < this.rows; j++) {
        const k = (j * this.cols + i) * 3, t = j * this.lenAlong;
        P[k] = _a.x + flare.x * t; P[k + 1] = _a.y - t; P[k + 2] = _a.z + flare.z * t;
      }
    }
    this.prev.set(P);
    // a skirt keeps its body: no particle may fall closer to the wearer's axis than most of the radius it hung at
    if (this.axis) { this.axis.updateWorldMatrix(true, false); _b.setFromMatrixPosition(this.axis.matrixWorld); this.minR = new Float32Array(this.n); for (let i = 0; i < this.n; i++) this.minR[i] = Math.hypot(P[i * 3] - _b.x, P[i * 3 + 2] - _b.z) * this.hold; }
    for (const s of this.springs) { const a = s[0] * 3, b = s[1] * 3; s[2] = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
    this.inited = true; this.packSprings();
    for (let k = 0; k < 90; k++) this.step(1 / 60);   // let it settle onto the body
  }
  // capsule: { a: bone, b: bone | null, ao, bo: local offsets, r }
  addCapsule(c) { this.capsules.push(c); return this; }
  step(dt) {
    const P = this.pos, Q = this.prev, n = this.n, cols = this.cols;
    this.time += dt;
    const g = -9.8 * dt * dt, damp = this.damping;
    const gust = 0.6 + 0.4 * Math.sin(this.time * 0.9) + 0.25 * Math.sin(this.time * 2.7 + 1.3);
    const wx = this.wind.x * gust * dt * dt, wz = this.wind.z * gust * dt * dt;
    for (let i = cols; i < n; i++) {
      const k = i * 3; const x = P[k], y = P[k + 1], z = P[k + 2];
      const j = (i / cols) | 0, flutter = Math.sin(this.time * 6 + j * 0.9 + (i % cols) * 0.7) * 0.4;
      P[k] += (x - Q[k]) * damp + wx * (1 + flutter); P[k + 1] += (y - Q[k + 1]) * damp + g; P[k + 2] += (z - Q[k + 2]) * damp + wz * (1 + flutter);
      Q[k] = x; Q[k + 1] = y; Q[k + 2] = z;
    }
    // the pinned edge follows the body (each bone brought up to date once, not once per pin)
    this.pinData(); for (const bn of this._pinBones) bn.updateWorldMatrix(true, false);
    for (let i = 0; i < cols; i++) { this.pinWorld(i, _a, false); const k = i * 3; P[k] = Q[k] = _a.x; P[k + 1] = Q[k + 1] = _a.y; P[k + 2] = Q[k + 2] = _a.z; }
    // capsules in world space this step: [ax, ay, az, bx, by, bz, r]
    const CB = this.capBuf, nc = this.capsules.length;
    for (let c = 0; c < nc; c++) {
      const C = this.capsules[c]; C.a.updateWorldMatrix(true, false); _a.copy(C.ao || V0).applyMatrix4(C.a.matrixWorld);
      if (C.b) { C.b.updateWorldMatrix(true, false); _b.copy(C.bo || V0).applyMatrix4(C.b.matrixWorld); } else _b.copy(_a);
      const o = c * 7; CB[o] = _a.x; CB[o + 1] = _a.y; CB[o + 2] = _a.z; CB[o + 3] = _b.x; CB[o + 4] = _b.y; CB[o + 5] = _b.z; CB[o + 6] = C.r + this.thick;
    }
    if (this.axis) { this.axis.updateWorldMatrix(true, false); _b.setFromMatrixPosition(this.axis.matrixWorld); this.ax = _b.x; this.az = _b.z; }
    const H = this.hull; let HI = null, HW = null;
    if (H) { H.bone.updateWorldMatrix(true, false); (this.hullInv || (this.hullInv = new THREE.Matrix4())).copy(H.bone.matrixWorld).invert(); HI = this.hullInv.elements; HW = H.bone.matrixWorld.elements; }
    const sA = this.sA, sB = this.sB, sL = this.sL, sK = this.sK, sWa = this.sWa, sWb = this.sWb, ns = sA.length, minR = this.minR, ground = this.ground + 0.01, thick = this.thick;
    for (let it = 0; it < 6; it++) {
      for (let q = 0; q < ns; q++) {
        const a = sA[q], b = sB[q];
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6; const f = (d - sL[q]) / d * sK[q];
        const fa = f * sWa[q], fb = f * sWb[q];
        P[a] += dx * fa; P[a + 1] += dy * fa; P[a + 2] += dz * fa;
        P[b] -= dx * fb; P[b + 1] -= dy * fb; P[b + 2] -= dz * fb;
      }
      for (let i = cols; i < n; i++) {
        const k = i * 3; let px = P[k], py = P[k + 1], pz = P[k + 2];
        for (let c = 0; c < nc; c++) {
          const o = c * 7, ax = CB[o], ay = CB[o + 1], az = CB[o + 2], r = CB[o + 6];
          const ux = CB[o + 3] - ax, uy = CB[o + 4] - ay, uz = CB[o + 5] - az, L2 = ux * ux + uy * uy + uz * uz;
          let t = L2 > 1e-8 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = ax + ux * t, cy = ay + uy * t, cz = az + uz * t; let ex = px - cx, ey = py - cy, ez = pz - cz;
          const l2 = ex * ex + ey * ey + ez * ez;
          if (l2 < r * r) { const l = Math.sqrt(l2); if (l < 1e-5) { ex = 0; ey = 0; ez = 1; } else { ex /= l; ey /= l; ez /= l; } px = cx + ex * r; py = cy + ey * r; pz = cz + ez * r; }
        }
        if (H) {   // stay outside the body itself: its measured outline at this height and bearing
          const lx = HI[0] * px + HI[4] * py + HI[8] * pz + HI[12], ly = HI[1] * px + HI[5] * py + HI[9] * pz + HI[13], lz = HI[2] * px + HI[6] * py + HI[10] * pz + HI[14];
          const yi = Math.round((ly - H.y0) / H.dy);
          if (yi >= 0 && yi < H.nY) {
            const r = Math.sqrt(lx * lx + lz * lz); let an = Math.atan2(lx, lz); if (an < 0) an += Math.PI * 2;
            const ai = Math.round(an / (Math.PI * 2) * H.nA) % H.nA; const m = H.R[yi * H.nA + ai] + thick;
            if (r < m && m > 0) {
              let nx = lx, nz = lz; const kk = r > 1e-5 ? m / r : 1; nx *= kk; nz *= kk; if (r <= 1e-5) nz = m;
              px = HW[0] * nx + HW[4] * ly + HW[8] * nz + HW[12]; py = HW[1] * nx + HW[5] * ly + HW[9] * nz + HW[13]; pz = HW[2] * nx + HW[6] * ly + HW[10] * nz + HW[14];
            }
          }
        }
        if (minR) { const dx = px - this.ax, dz = pz - this.az, d = Math.sqrt(dx * dx + dz * dz), m = minR[i]; if (d < m && d > 1e-5) { px = this.ax + dx / d * m; pz = this.az + dz / d * m; } }
        if (py < ground) { py = ground; Q[k] = px * 0.2 + Q[k] * 0.8; Q[k + 2] = pz * 0.2 + Q[k + 2] * 0.8; }   // rests, with friction, on the ground
        P[k] = px; P[k + 1] = py; P[k + 2] = pz;
      }
    }
  }
  // not seen this frame: remember how long, so it can catch up before it is next drawn
  idle(dt) { this.idleT = (this.idleT || 0) + dt; }
  update(dt) {
    if (!this.inited) this.init();
    if (this.idleT > 0.2) { const n = Math.min(40, Math.round(this.idleT * 30)); for (let i = 0; i < n; i++) { this.step(1 / 60); this.step(1 / 60); } }
    this.idleT = 0;
    const h = Math.min(dt, 1 / 30); this.step(h / 2); this.step(h / 2);
    this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals();
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); }
}
const V0 = new THREE.Vector3();
