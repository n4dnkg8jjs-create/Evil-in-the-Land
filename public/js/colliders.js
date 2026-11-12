// What a body cannot walk through. Three shapes, all on the ground plane:
//   circle  {t: 0, x, z, r}                      a tree, a rock, a post, a barrel
//   capsule {t: 1, ax, az, bx, bz, r}            a fence run between two posts, a stretch of wall
//   box     {t: 2, x, z, hx, hz, c, s}           a house, a cart, a headstone (c, s: cos and sin of its yaw)
// A box's frame is three.js's rotation.y: its local x runs along (c, -s), its local z along (s, c).
// Each one sits in every cell of a uniform grid its bounds touch, so a body asks only the cell or two it stands in.
// `low` ones (fences, low walls, graves, troughs) stop knights, who vault them; demons and bosses clamber over.
// `h` is how high a thing stands (for the vault).
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Solids {
  constructor(cell = 4) { this.cell = cell; this.map = new Map(); this.list = []; this.stamp = 1; this._out = []; this._hit = { t: 0, t2: 0, nx: 0, nz: 0 }; }
  key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  insert(c) {
    const C = this.cell; let x0, x1, z0, z1;
    if (c.t === 0) { const r = Math.max(0, c.r); x0 = c.x - r; x1 = c.x + r; z0 = c.z - r; z1 = c.z + r; }
    else if (c.t === 1) { x0 = Math.min(c.ax, c.bx) - c.r; x1 = Math.max(c.ax, c.bx) + c.r; z0 = Math.min(c.az, c.bz) - c.r; z1 = Math.max(c.az, c.bz) + c.r; }
    else { const ex = Math.abs(c.c) * c.hx + Math.abs(c.s) * c.hz, ez = Math.abs(c.s) * c.hx + Math.abs(c.c) * c.hz; x0 = c.x - ex; x1 = c.x + ex; z0 = c.z - ez; z1 = c.z + ez; }
    c.q = 0; this.list.push(c);
    for (let ix = Math.floor(x0 / C), i1 = Math.floor(x1 / C); ix <= i1; ix++) for (let iz = Math.floor(z0 / C), j1 = Math.floor(z1 / C); iz <= j1; iz++) {
      const k = this.key(ix, iz); let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); } b.push(c);
    }
    return c;
  }
  circle(x, z, r, o = {}) { return this.insert({ t: 0, x, z, r, low: !!o.low, h: o.h ?? 2, tag: o.tag }); }
  capsule(ax, az, bx, bz, r, o = {}) { return this.insert({ t: 1, ax, az, bx, bz, r, low: !!o.low, h: o.h ?? 2, tag: o.tag }); }
  box(x, z, hx, hz, rot, o = {}) { return this.insert({ t: 2, x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), r: 0, low: !!o.low, h: o.h ?? 2, tag: o.tag }); }
  // every collider whose cells touch the rectangle, each once
  query(x0, z0, x1, z1, out = this._out) {
    out.length = 0; const C = this.cell, st = ++this.stamp;
    for (let ix = Math.floor(x0 / C), i1 = Math.floor(x1 / C); ix <= i1; ix++) for (let iz = Math.floor(z0 / C), j1 = Math.floor(z1 / C); iz <= j1; iz++) {
      const b = this.map.get(this.key(ix, iz)); if (!b) continue;
      for (let i = 0; i < b.length; i++) { const c = b[i]; if (c.q !== st) { c.q = st; out.push(c); } }
    }
    return out;
  }

  // Where along the move a->b (0..1) it first enters the collider's core (the centre line of a capsule, the box
  // itself), or -1. Circles are left to the overlap pass: they are all thick enough not to be stepped through.
  enter(c, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    if (c.t === 1) {
      const ex = c.bx - c.ax, ez = c.bz - c.az, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) return -1;
      const wx = c.ax - ax, wz = c.az - az, t = (wx * ez - wz * ex) / den, u = (wx * dz - wz * dx) / den;
      const L = Math.hypot(ex, ez) || 1, cap = c.r / L;
      return t >= 0 && t <= 1 && u >= -cap && u <= 1 + cap ? t : -1;
    }
    if (c.t === 2) {
      const lx0 = (ax - c.x) * c.c - (az - c.z) * c.s, lz0 = (ax - c.x) * c.s + (az - c.z) * c.c;
      if (Math.abs(lx0) < c.hx && Math.abs(lz0) < c.hz) return -1;   // began inside (a spawn): the overlap pass pushes it out
      const lx1 = (bx - c.x) * c.c - (bz - c.z) * c.s, lz1 = (bx - c.x) * c.s + (bz - c.z) * c.c;
      const h = this._hit; return this.slab(lx0, lz0, lx1 - lx0, lz1 - lz0, c.hx, c.hz, h) && h.t <= 1 ? h.t : -1;
    }
    return -1;
  }
  // Liang-Barsky: a ray p + t d (t >= 0) against the box |x| < hx, |z| < hz; entry t, exit t2 and the entry face's normal
  slab(px, pz, dx, dz, hx, hz, h) {
    let t0 = -Infinity, t1 = Infinity, nx = 0, nz = 0;
    for (let a = 0; a < 2; a++) {
      const p = a ? pz : px, d = a ? dz : dx, e = a ? hz : hx;
      if (Math.abs(d) < 1e-12) { if (p < -e || p > e) return false; continue; }
      let ta = (-e - p) / d, tb = (e - p) / d, n = -1; if (ta > tb) { const q = ta; ta = tb; tb = q; n = 1; }
      if (ta > t0) { t0 = ta; nx = a ? 0 : n; nz = a ? n : 0; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    if (t1 < 0) return false;
    h.t = Math.max(0, t0); h.t2 = t1; h.nx = nx; h.nz = nz; return true;
  }

  // Push a body (p, radius) out of everything it overlaps. low: whether low things stop it. prev: where it stood
  // last frame (so nothing thin is stepped through between frames). vel: its velocity, from which the part that
  // drives into a wall is taken away (so it slides and does not keep running on the spot). slide: for a body
  // that is not steered by a player (a demon), a push off a wall also carries it along the wall, so it works its
  // way round a house rather than pressing on it. Returns the number of contacts.
  resolve(p, rad, low, prev, vel, slide) {
    let x0 = p.x, x1 = p.x, z0 = p.z, z1 = p.z;
    const sweep = prev && Number.isFinite(prev.x) && ((p.x - prev.x) ** 2 + (p.z - prev.z) ** 2) > 1e-10 && ((p.x - prev.x) ** 2 + (p.z - prev.z) ** 2) < 9;
    if (sweep) { x0 = Math.min(x0, prev.x); x1 = Math.max(x1, prev.x); z0 = Math.min(z0, prev.z); z1 = Math.max(z1, prev.z); }
    const near = this.query(x0 - rad - 0.1, z0 - rad - 0.1, x1 + rad + 0.1, z1 + rad + 0.1);
    if (!near.length) return 0;
    // 1) through a thin wall between two frames: back to where it met it
    if (sweep) {
      let tMin = 2;
      for (const c of near) { if ((c.low && !low) || c.r < 0) continue; const t = this.enter(c, prev.x, prev.z, p.x, p.z); if (t >= 0 && t < tMin) tMin = t; }
      if (tMin <= 1) { const dx = p.x - prev.x, dz = p.z - prev.z, L = Math.hypot(dx, dz), back = Math.max(0, tMin - 0.002 / L); p.x = prev.x + dx * back; p.z = prev.z + dz * back; }
    }
    // 2) out of whatever it overlaps; a few passes settle a corner between two walls
    let n = 0;
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (const c of near) {
        if ((c.low && !low) || c.r < 0) continue;
        let nx = 0, nz = 0, depth = 0;
        if (c.t === 0) {
          const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), m = c.r + rad;
          if (d >= m || d < 1e-4) continue;
          nx = dx / d; nz = dz / d; depth = m - d; p.x = c.x + nx * m; p.z = c.z + nz * m;
        } else if (c.t === 1) {
          const ex = c.bx - c.ax, ez = c.bz - c.az, L2 = ex * ex + ez * ez;
          const u = L2 > 0 ? clamp(((p.x - c.ax) * ex + (p.z - c.az) * ez) / L2, 0, 1) : 0;
          const qx = c.ax + ex * u, qz = c.az + ez * u, dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz), m = c.r + rad;
          if (d >= m) continue;
          if (d > 1e-6) { nx = dx / d; nz = dz / d; }
          else { const L = Math.sqrt(L2) || 1; nx = -ez / L; nz = ex / L; if (prev && (prev.x - qx) * nx + (prev.z - qz) * nz < 0) { nx = -nx; nz = -nz; } }
          depth = m - d; p.x = qx + nx * m; p.z = qz + nz * m;
        } else {
          const dx = p.x - c.x, dz = p.z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
          const ax = Math.abs(lx), az = Math.abs(lz);
          if (ax >= c.hx + rad || az >= c.hz + rad) continue;
          let ox, oz, onx, onz;
          if (ax < c.hx && az < c.hz) {   // inside it: out by the nearer face
            if (c.hx - ax < c.hz - az) { onx = lx < 0 ? -1 : 1; onz = 0; ox = onx * (c.hx + rad); oz = lz; depth = c.hx + rad - ax; }
            else { onx = 0; onz = lz < 0 ? -1 : 1; ox = lx; oz = onz * (c.hz + rad); depth = c.hz + rad - az; }
          } else {
            const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz), ddx = lx - qx, ddz = lz - qz, d = Math.hypot(ddx, ddz);
            if (d >= rad || d < 1e-9) continue;
            onx = ddx / d; onz = ddz / d; ox = qx + onx * rad; oz = qz + onz * rad; depth = rad - d;
          }
          // back to the world (the inverse of the turn above)
          nx = onx * c.c + onz * c.s; nz = -onx * c.s + onz * c.c;
          p.x = c.x + ox * c.c + oz * c.s; p.z = c.z - ox * c.s + oz * c.c;
        }
        moved = true; n++;
        if (vel) { const vin = vel.x * nx + vel.z * nz; if (vin < 0) { vel.x -= vin * nx; vel.z -= vin * nz; } }
        if (slide && c.t !== 0 && depth > 0) {
          const tx = -nz, tz = nx; let s = vel ? vel.x * tx + vel.z * tz : 0;
          s = Math.abs(s) > 0.3 ? Math.sign(s) : slide.sign; slide.sign = s;
          const k = Math.min(depth, 0.3) * 0.9; p.x += tx * s * k; p.z += tz * s * k;
        }
      }
      if (!moved) break;
    }
    return n;
  }

  // does a body of this radius at (x, z) overlap anything?
  solidAt(x, z, rad, low = true) {
    const near = this.query(x - rad - 0.1, z - rad - 0.1, x + rad + 0.1, z + rad + 0.1, this._out2 || (this._out2 = []));
    for (const c of near) {
      if ((c.low && !low) || c.r < 0) continue;
      if (c.t === 0) { if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + rad) ** 2) return c; }
      else if (c.t === 1) {
        const ex = c.bx - c.ax, ez = c.bz - c.az, L2 = ex * ex + ez * ez, u = L2 > 0 ? clamp(((x - c.ax) * ex + (z - c.az) * ez) / L2, 0, 1) : 0;
        if ((x - c.ax - ex * u) ** 2 + (z - c.az - ez * u) ** 2 < (c.r + rad) ** 2) return c;
      } else {
        const dx = x - c.x, dz = z - c.z, lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        if ((lx - qx) ** 2 + (lz - qz) ** 2 < rad * rad) return c;
      }
    }
    return null;
  }
  // can a body of this radius go straight from a to b?
  clear(ax, az, bx, bz, rad, low = true, step = 0.35) {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let i = 1; i <= n; i++) if (this.solidAt(ax + (bx - ax) * i / n, az + (bz - az) * i / n, rad, low)) return false;
    return true;
  }

  // The low thing a knight at (x, z) would vault, going along (dx, dz): the nearest low collider the line meets
  // within `reach` of his body, met no more than ~60 degrees off square. Gives where the line crosses it, where he
  // comes down on the far side, and how high it stands; or null.
  vaultLine(x, z, dx, dz, rad, reach) {
    const L = rad + reach + 1.6, ex = x + dx * L, ez = z + dz * L;
    const near = this.query(Math.min(x, ex) - 1, Math.min(z, ez) - 1, Math.max(x, ex) + 1, Math.max(z, ez) + 1, this._out3 || (this._out3 = []));
    let best = null;
    for (const c of near) {
      if (c.r < 0 || !c.low) continue;   // what is not low and in the way is found by the caller's clear line
      let tIn, tOut, nx, nz, thick;
      if (c.t === 1) {
        const t = this.enter(c, x, z, ex, ez); if (t < 0) continue;
        const sx = c.bx - c.ax, sz = c.bz - c.az, sl = Math.hypot(sx, sz) || 1; nx = -sz / sl; nz = sx / sl;
        const cos = Math.abs(dx * nx + dz * nz); if (cos < 0.5) continue;
        tIn = t * L - c.r / cos; tOut = t * L + c.r / cos; thick = c.r;
        if (dx * nx + dz * nz > 0) { nx = -nx; nz = -nz; }
        if ((tIn * cos) - rad > reach) continue;
      } else if (c.t === 2) {
        const lx = (x - c.x) * c.c - (z - c.z) * c.s, lz = (x - c.x) * c.s + (z - c.z) * c.c;
        const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c, h = this._hit;
        if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) continue;
        if (!this.slab(lx, lz, ldx, ldz, c.hx, c.hz, h) || h.t > L) continue;
        const cos = Math.abs(ldx * h.nx + ldz * h.nz); if (cos < 0.5) continue;
        tIn = h.t; tOut = h.t2; thick = 0;
        if (tIn * cos - rad > reach) continue;
      } else {
        // a circle (a post of a fence): only met near its middle
        const fx = c.x - x, fz = c.z - z, along = fx * dx + fz * dz, off = Math.abs(fx * dz - fz * dx);
        if (along < 0 || off > c.r * 0.7) continue;
        tIn = along - c.r; tOut = along + c.r; thick = c.r;
        if (tIn - rad > reach) continue;
      }
      if (!best || tIn < best.tIn) best = { c, tIn, tOut, thick };
    }
    if (!best) return null;
    const cross = (best.tIn + best.tOut) / 2;
    return { c: best.c, h: best.c.h, cx: x + dx * cross, cz: z + dz * cross, tIn: best.tIn, tOut: best.tOut, land: best.tOut + rad + 0.14 };
  }
}

// A* over a grid of `step` metres between two points, through cells where blocked(x, z) is false, within `span`
// metres of their midpoint. Returns the way as a list of [x, z] (string-pulled), or null.
export function findPath(x0, z0, x1, z1, blocked, clearLine, { step = 0.5, span = 26 } = {}) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, half = Math.min(60, Math.max(span, Math.hypot(x1 - x0, z1 - z0) / 2 + 10));
  const n = Math.ceil(half * 2 / step) + 1, gx0 = cx - half, gz0 = cz - half;
  const idx = (x, z) => { const i = Math.round((x - gx0) / step), j = Math.round((z - gz0) / step); return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i; };
  const s = idx(x0, z0), g = idx(x1, z1); if (s < 0 || g < 0) return null;
  const state = new Uint8Array(n * n);   // 0 unknown, 1 free, 2 blocked
  const free = (k) => { if (!state[k]) state[k] = blocked(gx0 + (k % n) * step, gz0 + Math.floor(k / n) * step) ? 2 : 1; return state[k] === 1; };
  const G = new Float32Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), closed = new Uint8Array(n * n);
  const gi = g % n, gj = Math.floor(g / n), hf = (k) => { const i = k % n, j = Math.floor(k / n), a = Math.abs(i - gi), b = Math.abs(j - gj); return (Math.max(a, b) + 0.4142 * Math.min(a, b)) * step; };
  const heap = [], hk = [];   // a binary heap of (f, cell)
  const push = (f, k) => { heap.push(f); hk.push(k); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] <= heap[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
  const pop = () => { const k = hk[0], lf = heap.pop(), lk = hk.pop(); if (heap.length) { heap[0] = lf; hk[0] = lk; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l] < heap[m]) m = l; if (r < heap.length && heap[r] < heap[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; } } return k; };
  G[s] = 0; push(hf(s), s); state[s] = 1;   // where it stands counts as free (it may be brushing a wall)
  const goalFree = free(g);
  let found = -1, best = s, bestH = hf(s), it = 0;
  while (heap.length && it++ < 20000) {
    const k = pop(); if (closed[k]) continue; closed[k] = 1;
    if (k === g) { found = k; break; }
    const h = hf(k); if (h < bestH) { bestH = h; best = k; }
    const i = k % n, j = Math.floor(k / n);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const kk = jj * n + ii; if (closed[kk] || !free(kk)) continue;
      if (di && dj && (!free(j * n + ii) || !free(jj * n + i))) continue;   // no cutting a corner
      const ng = G[k] + (di && dj ? 1.4142 : 1) * step; if (ng < G[kk]) { G[kk] = ng; from[kk] = k; push(ng + hf(kk), kk); }
    }
  }
  if (found < 0) { if (goalFree || bestH > 3) return null; found = best; }   // the goal is inside something: as near as it gets
  const pts = []; for (let k = found; k >= 0; k = from[k]) pts.push([gx0 + (k % n) * step, gz0 + Math.floor(k / n) * step]);
  pts.reverse();
  // string-pull: from each point, on to the furthest one in plain sight
  const out = [pts[0]]; let a = 0;
  while (a < pts.length - 1) { let b = pts.length - 1; while (b > a + 1 && !clearLine(pts[a][0], pts[a][1], pts[b][0], pts[b][1])) b--; out.push(pts[b]); a = b; }
  return out;
}
