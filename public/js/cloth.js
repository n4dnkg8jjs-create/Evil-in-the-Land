// Cloth that behaves like cloth: a Verlet mass-spring sheet (stretch, shear and bend springs), pinned along one
// edge to a body (a belt line, the shoulders), swinging with gravity and a gusting wind, and pushed out of the
// body by capsules on its bones so it drapes over hips, thighs and knees instead of passing through them.
// Used for the priest's cassock and the sutler's cloak: a few hundred particles each, simulated only while
// someone is close enough to see it.
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();

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
  pinWorld(i, out) { const p = this.pins(i); p.bone.updateWorldMatrix(true, false); return out.copy(p.local).applyMatrix4(p.bone.matrixWorld); }
  // lay the cloth out hanging straight down from its pins, and measure its springs there
  init() {
    const P = this.pos;
    for (let i = 0; i < this.cols; i++) {
      this.pinWorld(i, _a);
      const flare = this.pins(i).flare || V0;
      for (let j = 0; j < this.rows; j++) {
        const k = (j * this.cols + i) * 3, t = j * this.lenAlong;
        P[k] = _a.x + flare.x * t; P[k + 1] = _a.y - t; P[k + 2] = _a.z + flare.z * t;
      }
    }
    this.prev.set(P);
    // a skirt keeps its body: no particle may fall closer to the wearer's axis than most of the radius it hung at
    if (this.axis) { this.axis.updateWorldMatrix(true, false); _b.setFromMatrixPosition(this.axis.matrixWorld); this.minR = new Float32Array(this.n); for (let i = 0; i < this.n; i++) this.minR[i] = Math.hypot(P[i * 3] - _b.x, P[i * 3 + 2] - _b.z) * this.hold; }
    for (const s of this.springs) { const a = s[0] * 3, b = s[1] * 3; s[2] = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]); }
    this.inited = true;
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
    // the pinned edge follows the body
    for (let i = 0; i < cols; i++) { this.pinWorld(i, _a); const k = i * 3; P[k] = Q[k] = _a.x; P[k + 1] = Q[k + 1] = _a.y; P[k + 2] = Q[k + 2] = _a.z; }
    // capsules in world space this step
    const caps = this.capsules.map((c) => { c.a.updateWorldMatrix(true, false); const A = (c.ao || V0).clone().applyMatrix4(c.a.matrixWorld); let B = A; if (c.b) { c.b.updateWorldMatrix(true, false); B = (c.bo || V0).clone().applyMatrix4(c.b.matrixWorld); } return [A, B, c.r + this.thick]; });
    if (this.axis) { this.axis.updateWorldMatrix(true, false); _b.setFromMatrixPosition(this.axis.matrixWorld); this.ax = _b.x; this.az = _b.z; }
    if (this.hull) { this.hull.bone.updateWorldMatrix(true, false); (this.hullInv || (this.hullInv = new THREE.Matrix4())).copy(this.hull.bone.matrixWorld).invert(); }
    for (let it = 0; it < 6; it++) {
      for (const s of this.springs) {
        const a = s[0] * 3, b = s[1] * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6; const diff = (d - s[2]) / d * 0.5 * s[3];
        const pa = s[0] < cols ? 0 : 1, pb = s[1] < cols ? 0 : 1; const w = pa + pb; if (!w) continue;
        const f = diff * 2 / w;
        if (pa) { P[a] += dx * f; P[a + 1] += dy * f; P[a + 2] += dz * f; }
        if (pb) { P[b] -= dx * f; P[b + 1] -= dy * f; P[b + 2] -= dz * f; }
      }
      for (let i = cols; i < n; i++) {
        const k = i * 3; _p.set(P[k], P[k + 1], P[k + 2]);
        for (const [A, B, r] of caps) {
          _d.subVectors(B, A); const L2 = _d.lengthSq(); let t = L2 > 1e-8 ? _b.subVectors(_p, A).dot(_d) / L2 : 0; t = Math.max(0, Math.min(1, t));
          _a.copy(A).addScaledVector(_d, t); _b.subVectors(_p, _a); const l = _b.length();
          if (l < r) { if (l < 1e-5) _b.set(0, 0, 1); else _b.multiplyScalar(1 / l); _p.copy(_a).addScaledVector(_b, r); }
        }
        if (this.hull) {   // stay outside the body itself: its measured outline at this height and bearing
          const H = this.hull; _a.copy(_p).applyMatrix4(this.hullInv);
          const yi = Math.round((_a.y - H.y0) / H.dy);
          if (yi >= 0 && yi < H.nY) {
            const r = Math.hypot(_a.x, _a.z); let an = Math.atan2(_a.x, _a.z); if (an < 0) an += Math.PI * 2;
            const ai = Math.round(an / (Math.PI * 2) * H.nA) % H.nA; const m = H.R[yi * H.nA + ai] + this.thick;
            if (r < m && m > 0) { const k = r > 1e-5 ? m / r : 1; _a.x *= k; _a.z *= k; if (r <= 1e-5) _a.z = m; _p.copy(_a).applyMatrix4(H.bone.matrixWorld); }
          }
        }
        if (this.minR) { const dx = _p.x - this.ax, dz = _p.z - this.az, d = Math.hypot(dx, dz), m = this.minR[i]; if (d < m && d > 1e-5) { _p.x = this.ax + dx / d * m; _p.z = this.az + dz / d * m; } }
        if (_p.y < this.ground + 0.01) { _p.y = this.ground + 0.01; Q[k] = _p.x * 0.2 + Q[k] * 0.8; Q[k + 2] = _p.z * 0.2 + Q[k + 2] * 0.8; }   // rests, with friction, on the ground
        P[k] = _p.x; P[k + 1] = _p.y; P[k + 2] = _p.z;
      }
    }
  }
  update(dt) {
    if (!this.inited) this.init();
    const h = Math.min(dt, 1 / 30); this.step(h / 2); this.step(h / 2);
    this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals();
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); }
}
const V0 = new THREE.Vector3();
