// The sutler's wagon. A camp-follower who has trailed every army into the blight
// waits at the start of each road with steel to sell, for the silver the knights
// win: from the demons they cut down, the altars they hallow, the pages they find.
// What a knight owns and has had tempered is kept between pilgrimages.
import { account } from './account.js';
import * as THREE from 'three';
import { WEAPONS, buildWeapon } from './weapons.js';
import { clothTextures } from './textures.js';
import { makePerson } from './people.js';
import { bodyReady } from './body.js';
import { TAU } from './util.js';
import { makeHorse } from './horse.js';

export const TRADE_TIME = 75;   // seconds the sutler waits before he whips up the horses

const KEY = 'evil.armoury';
const START_WEAPONS = ['longsword', 'mace', 'pike'];
export const PRICES = { zweihander: 180, halberd: 140, pollaxe: 160 };
for (const [k, w] of Object.entries(WEAPONS)) if (w.price) PRICES[k] = w.price;
// every trade the wagon offers, by the section of the panel it sits in; each stage costs more
export const UPGRADES = {
  edge: { tab: 'harness', name: 'Temper the edge', desc: 'The armourer re-hardens and hones the weapon in your hands. +12% damage per stage.', max: 3, cost: [80, 150, 240] },
  grip: { tab: 'harness', name: 'Rewrap the grip', desc: 'Ray-skin and waxed cord, so the blows take less out of you. Attacks cost 10% less breath per stage.', max: 3, cost: [70, 130, 210] },
  proof: { tab: 'harness', name: 'Proof the harness', desc: 'Thicker plates riveted in where the demons find gaps. +20 health per stage.', max: 3, cost: [100, 180, 280] },
  fleet: { tab: 'harness', name: 'Lighten the harness', desc: 'Mail cut away under the plates, straps re-hung. You roll 12% quicker per stage.', max: 2, cost: [110, 220] },
  wind: { tab: 'harness', name: 'Train your wind', desc: 'The old sergeant\'s drills. +15 breath and it comes back 12% sooner per stage.', max: 3, cost: [90, 160, 250] },
  riposte: { tab: 'harness', name: 'Learn the riposte', desc: 'A master\'s tricks of the bind. A wider moment to parry, and for a breath after a parry your blows strike 25% harder per stage.', max: 2, cost: [140, 260] },
  blessing: { tab: 'faith', name: 'Have the relic blessed', desc: 'Father Bertram says a Mass over it. Relic ready 15% sooner per stage.', max: 2, cost: [90, 170] },
  faith: { tab: 'faith', name: 'Keep a vigil', desc: 'A night on your knees before the wagon\'s little altar. Your prayers at the altars and over the fallen are 20% swifter per stage, and they quiet the dread.', max: 3, cost: [80, 150, 230] },
  secondwind: { tab: 'faith', name: 'Second wind', desc: 'A scapular blessed for the dying. Once each chapter, if you fall with no brother near, you rise again by yourself.', max: 1, cost: [300] },
  satchel: { tab: 'stores', name: 'A bigger satchel', desc: 'Room for another draught. Carry 4, then 5.', max: 2, cost: [80, 140] },
  physic: { tab: 'stores', name: 'Stronger physic', desc: 'Better wine, dearer myrrh. Each draught heals 30 more per stage.', max: 2, cost: [90, 170] },
};
const DRAUGHT = { name: 'Healing draught', desc: 'Wine, myrrh and a prayer. Press H in battle to drink; it heals over three seconds.', cost: 35, max: 3 };
const FLASK = { name: 'Flask of holy water', desc: 'Press G to hurl it: it bursts in holy fire that burns every demon it splashes, whatever relic you carry. Carry up to three.', cost: 45, max: 3 };
const BLESS_TIME = 240;   // the blessing lasts the next stretch of road
export const draughtMax = (a) => DRAUGHT.max + (a.up.satchel || 0);

export function loadArmoury() {
  let a = account.get(KEY, null);
  a = Object.assign({ silver: 60, owned: [...START_WEAPONS], up: {}, draughts: 1, flasks: 0 }, a || {});
  for (const w of START_WEAPONS) if (!a.owned.includes(w)) a.owned.push(w);
  return a;
}
export function saveArmoury(a) { account.set(KEY, a); }
// edge is kept per weapon; proof and blessing belong to the knight
export function upgradesFor(a, weapon) { const u = { ...a.up }; u.edge = a.up['edge:' + weapon] || 0; return u; }

// ---------------------------------------------------------------- the wagon
function wagonModel(quality) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 });
  const ct = clothTextures([150, 136, 106], false, 256, 'tilt');
  const canvasM = new THREE.MeshStandardMaterial({ map: ct.map, normalMap: ct.normalMap, color: 0xd8ccb0, roughness: 0.95, side: THREE.DoubleSide });
  const iron = new THREE.MeshStandardMaterial({ color: 0x5a5650, metalness: 0.8, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.3 });
  const add = (geo, m, p, r = [0, 0, 0]) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(1.8, 0.14, 3.6), wood, [0, 0.95, 0]);                       // bed
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.08, 0.5, 3.6), wood, [s * 0.88, 1.25, 0]); add(new THREE.BoxGeometry(1.8, 0.5, 0.08), wood, [0, 1.25, s * 1.76]); }
  // spoked wheels: iron tyre on a felloe, twelve spokes, a stout hub; and the axles under the bed
  const wheel = () => {
    const parts = [new THREE.TorusGeometry(0.55, 0.055, 6, 28), new THREE.TorusGeometry(0.585, 0.022, 4, 28), new THREE.CylinderGeometry(0.1, 0.12, 0.28, 12).rotateX(Math.PI / 2)];
    for (let k = 0; k < 12; k++) { const sp = new THREE.CylinderGeometry(0.022, 0.03, 0.46, 6); sp.translate(0, 0.32, 0); sp.rotateZ((k / 12) * Math.PI * 2); parts.push(sp); }
    const gw = new THREE.Group(); parts.forEach((pg, k) => { const o = new THREE.Mesh(pg, k === 1 ? iron : wood); o.castShadow = true; gw.add(o); }); return gw;
  };
  g.userData.wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = wheel(); w.position.set(sx * 1.02, 0.6, sz * 1.15); w.rotation.y = Math.PI / 2; w.rotation.z = sz * 0.3; w.userData.front = sz > 0; g.add(w); g.userData.wheels.push(w); }
  for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 8), wood, [0, 0.6, sz * 1.15], [0, 0, Math.PI / 2]);
  // the tilt: canvas over five bows, sagging between them, creased, gathered and puckered at each end by its cord
  { const NU = 40, NV = 60, pos = [], uv = [], idx = [];
    const hn = (x, y) => { const t = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return t - Math.floor(t); };
    const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, e = y - j, u = f * f * (3 - 2 * f), v = e * e * (3 - 2 * e); return (hn(i, j) * (1 - u) + hn(i + 1, j) * u) * (1 - v) + (hn(i, j + 1) * (1 - u) + hn(i + 1, j + 1) * u) * v; };
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const a = (i / NU - 0.5) * Math.PI * 1.04, zf = j / NV, z = (zf - 0.5) * 3.9;
      const bz = (z + 1.6) / 0.8, bow = Math.abs(Math.sin(bz * Math.PI)) * (z > -1.6 && z < 1.6 ? 1 : 0);   // 0 over each of the five bows (z = -1.6 … 1.6)
      let r = 1.0 - 0.05 * bow * (0.4 + 0.6 * Math.cos(a) ** 2);
      const ends = Math.max(0, (Math.abs(z) - 1.66) / 0.29);   // drawn in only beyond the end bows
      r *= 1 - ends * 0.22;
      r += vn(a * 5, zf * 18) * 0.03 + Math.sin(a * 18 + zf * 9) * 0.006 * bow;   // creases only ever push outward, never through a bow
      r += ends * Math.sin(a * 22) * 0.025;
      pos.push(Math.sin(a) * r, 1.05 + Math.cos(a) * r * 1.25, z);
      uv.push(i / NU * 2, zf * 4);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const p0 = j * (NU + 1) + i, p1 = p0 + 1, p2 = p0 + NU + 1, p3 = p2 + 1; idx.push(p0, p2, p1, p1, p2, p3); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.setIndex(idx); tg.computeVertexNormals();
    const tilt = new THREE.Mesh(tg, canvasM); tilt.castShadow = tilt.receiveShadow = true; g.add(tilt);
    for (let k = 0; k <= 4; k++) { const b = add(new THREE.TorusGeometry(0.92, 0.025, 5, 20, Math.PI * 1.04), wood, [0, 1.05, -1.6 + k * 0.8], [0, 0, -Math.PI * 0.02]); b.scale.y = 1.25; }
  }
  add(new THREE.BoxGeometry(1.5, 0.1, 0.42), wood, [0, 1.42, 2.12]); add(new THREE.BoxGeometry(1.5, 0.08, 0.34), wood, [0, 0.98, 2.62]);   // the box seat out in front of the tilt, and the footboard
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.07, 0.42, 0.07), wood, [s * 0.68, 1.18, 2.12]); add(new THREE.BoxGeometry(0.06, 0.06, 0.9), wood, [s * 0.68, 1.0, 2.25]); }
  add(new THREE.BoxGeometry(0.1, 0.1, 3.4), wood, [0, 0.95, 3.6], [-0.08, 0, 0]);       // the pole
  add(new THREE.BoxGeometry(1.5, 0.08, 0.08), wood, [0, 0.82, 3.2]);                     // the swingletree
  // a pair of draught horses in harness either side of the pole
  g.userData.horses = [];
  for (const [sx, seed, coat] of [[-0.62, 3, 0x7a4426], [0.62, 7, 0x4a2c1c]]) { const h = makeHorse(seed, coat); h.root.position.set(sx, 0, 4.25); g.add(h.root); g.userData.horses.push(h); }
  // an iron rod between two points (the step's hangers, the grab iron)
  const rod = (a, b, r, m) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 6), m); o.position.copy(A).add(B).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize()); o.castShadow = true; g.add(o); return o; };
  // a step iron hung from the end of the footboard, and a grab iron at the end of the box seat, for climbing up
  for (const z of [2.575, 2.705]) rod([0.7, 0.95, z], [0.86, 0.565, z], 0.012, iron);
  add(new THREE.BoxGeometry(0.17, 0.025, 0.15), iron, [0.9, 0.5575, 2.64]);
  rod([0.74, 1.44, 1.98], [0.88, 1.48, 1.98], 0.014, iron); rod([0.88, 1.48, 1.98], [0.88, 1.87, 1.98], 0.014, iron); rod([0.88, 1.87, 1.98], [0.6, 1.97, 1.66], 0.014, iron);
  // a rack of arms at the tailboard: the armourer's own blades (the very models the knights carry), hung point down
  // by their cross-guards between pegs on a bar, and a hanging lantern
  add(new THREE.BoxGeometry(1.5, 0.08, 0.08), wood, [0, 1.76, -2.18]);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.95, 0.07), wood, [sx * 0.72, 1.32, -2.06]);
  g.userData.rack = [];
  ['zweihander', 'longsword', 'mace', 'longsword'].forEach((key, i) => {
    const x = -0.5 + i * 0.33;
    for (const px of [-0.045, 0.045]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), wood, [x + px, 1.79, -2.27], [Math.PI / 2, 0, 0]);
    const wpn = buildWeapon(key, quality); wpn.rotation.set(Math.PI, 0, (i % 2 ? 1 : -1) * 0.02); wpn.position.set(x, 1.815, -2.28);
    wpn.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.add(wpn); g.userData.rack.push(wpn);
  });
  for (let i = 0; i < 2; i++) add(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 10), wood, [1.4, 0.43, -1.2 + i * 0.7]);
  add(new THREE.BoxGeometry(0.7, 0.55, 0.6), wood, [-1.4, 0.28, -1.5]);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.35).multiplyScalar(4), toneMapped: false }));
  lamp.position.set(0.75, 2.15, -2.22); g.add(lamp);
  const light = new THREE.PointLight(0xffb060, 6, 9, 2); light.position.copy(lamp.position); g.add(light);
  return g;
}

// Where Father Bertram climbs up, in the wagon's own frame: he stands on the ground beside the step iron, takes the
// grab iron, puts his left foot on the step and hauls himself up onto the footboard, turns, and sits beside the sutler.
const BOARD = { stand: [1.3, 2.42], step: [0.96, 0.57, 2.64], fbR: [0.42, 1.02, 2.5], fbL: [0.6, 1.02, 2.7], turnR: [0.36, 1.02, 2.58], turnL: [0.64, 1.02, 2.58], grip: [0.88, 1.68, 1.98], grip2: [0.74, 1.5, 2.3], seat: [0.5, 1.53, 2.08] };
// The wagon's height and lean from the ground under its four wheels (its rotation order is YXZ: heading, then pitch and roll)
const _wv = new THREE.Vector3();
function wheelGround(W, w) {
  const c = Math.cos(w.rotation.y), s = Math.sin(w.rotation.y), h = {};
  for (const [k, lx, lz] of [['fl', 1.02, 1.15], ['fr', -1.02, 1.15], ['rl', 1.02, -1.15], ['rr', -1.02, -1.15]]) {
    const x = w.position.x + lx * c + lz * s, z = w.position.z - lx * s + lz * c; h[k] = W.groundAt(x, z);
  }
  const front = (h.fl + h.fr) / 2, rear = (h.rl + h.rr) / 2, left = (h.fl + h.rl) / 2, right = (h.fr + h.rr) / 2;
  return { y: (front + rear) / 2, pitch: Math.atan2(rear - front, 2.3), roll: Math.atan2(left - right, 2.04) };
}
// The way out: on along the road, down the valley it runs through. A line is found along it (a little to the right
// of the crown where it can) that keeps the wagon clear of everything standing near the road: the standing stones
// and cross of an altar's circle (it threads between them, or swings out round them), trees and rocks; off steep
// banks; and never turning more sharply than the pole lets it.
function roadRoute(W, from, far = 230) {
  const N = 800, S = [0]; let a = W.path.at(0);
  for (let i = 1; i <= N; i++) { const b = W.path.at(i / N); S.push(S[i - 1] + Math.hypot(b.x - a.x, b.z - a.z)); a = b; }
  const tAt = (d) => { let lo = 0, hi = N; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] < d) lo = m; else hi = m; } return (lo + (d - S[lo]) / Math.max(1e-6, S[hi] - S[lo])) / N; };
  const t0 = W.path.nearest(from.x, from.z).t, s0 = S[Math.round(t0 * N)];
  let tEnd = 0.97; if (W.cave) tEnd = Math.min(tEnd, W.cave.t0 - W.cave.e - 0.04);
  const sEnd = Math.min(S[Math.round(tEnd * N)], s0 + far);
  const frame = (t) => { const p = W.path.at(t), q = W.path.at(Math.min(1, t + 0.002)), o = W.path.at(Math.max(0, t - 0.002)); let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return { p, tx, tz, rx: -tz, rz: tx }; };
  const cols = (W.colliders || []).filter((c) => c.r > 0 && c.r < 20);
  const OFF = []; for (let o = -11; o <= 11.001; o += 0.5) OFF.push(o);
  const pts = [], cost = [];
  for (let d = s0 + 5; d < sEnd; d += 2.5) {
    const f = frame(tAt(d)); pts.push(f);
    const near = cols.filter((c) => (c.x - f.p.x) ** 2 + (c.z - f.p.z) ** 2 < 16 * 16);
    cost.push(OFF.map((o) => {
      const x = f.p.x + f.rx * o, z = f.p.z + f.rz * o;
      if (!W.inBounds(x, z)) return Infinity;
      for (const k of [-1.7, 0, 1.7]) { const qx = x + f.tx * k, qz = z + f.tz * k; for (const c of near) if ((c.x - qx) ** 2 + (c.z - qz) ** 2 < (c.r + 1.3) ** 2) return Infinity; }
      const ny = W.normalAt(x, z).y; if (ny < 0.85) return Infinity;
      return 0.08 * Math.abs(o - 0.4) + 40 * (1 - ny) + 0.5 * Math.max(0, Math.abs(W.groundAt(x, z) - W.groundAt(f.p.x, f.p.z)) - 0.25);
    }));
  }
  if (!pts.length) return [];
  // the cheapest line through them (dynamic programming over the offsets, easing across from one to the next)
  const n = pts.length, M = OFF.length, best = [cost[0].slice()], back = [];
  for (let i = 1; i < n; i++) {
    const row = new Array(M).fill(Infinity), bk = new Array(M).fill(-1);
    for (let j = 0; j < M; j++) { if (cost[i][j] === Infinity) continue; for (let dj = -3; dj <= 3; dj++) { const k = j + dj; if (k < 0 || k >= M || best[i - 1][k] === Infinity) continue; const c = best[i - 1][k] + cost[i][j] + 0.25 * dj * dj; if (c < row[j]) { row[j] = c; bk[j] = k; } } }
    if (row.every((c) => c === Infinity)) { for (let j = 0; j < M; j++) { row[j] = Math.min(...best[i - 1]) + 50 + Math.abs(OFF[j] - 0.9); bk[j] = best[i - 1].indexOf(Math.min(...best[i - 1])); } }   // nothing clear: go on along the road
    best.push(row); back.push(bk);
  }
  let j = best[n - 1].indexOf(Math.min(...best[n - 1])); const offs = new Array(n);
  for (let i = n - 1; i >= 0; i--) { offs[i] = OFF[j]; if (i > 0) j = back[i - 1][j]; }
  const sm = offs.slice(); for (let i = 1; i < n - 1; i++) sm[i] = (offs[i - 1] + offs[i] * 2 + offs[i + 1]) / 4;
  return pts.map((f, i) => ({ x: f.p.x + f.rx * sm[i], z: f.p.z + f.rz * sm[i] }));
}
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();

export class Shop {
  constructor(game) {
    this.g = game; this.a = loadArmoury(); this.open = false; this.wagon = null;
    this.el = document.getElementById('shop'); this.wallet = document.getElementById('silver');
    this.heal = 0;
    if (this.el) this.el.addEventListener('click', (e) => this.onClick(e));
  }
  // the knight as the armoury left him: weapon edge, harness proof, relic blessing
  applyToMe() { const me = this.g.me; me.applyUpgrades(upgradesFor(this.a, me.loadout.weapon)); this.showWallet(); }
  earn(n, why) {
    this.a.silver += n; this.a.earned = (this.a.earned || 0) + n; saveArmoury(this.a); this.showWallet(true);
    if (why) this.g.ui.toast(`+${n} silver · ${why}`, 2.2);
    // a running tally beside the purse: kills in quick succession add up
    if (!this.pop && this.wallet) { this.pop = document.createElement('div'); this.pop.className = 'silver-pop'; this.wallet.parentNode.appendChild(this.pop); }
    if (this.pop) { this.popN = (this.popT > 0 ? this.popN : 0) + n; this.popT = 1.6; this.pop.textContent = `+${this.popN}`; this.pop.classList.remove('go'); void this.pop.offsetWidth; this.pop.classList.add('go'); }
  }
  showWallet(flash) {
    if (!this.wallet) return; const a = this.a;
    this.wallet.textContent = `${a.silver} silver · ${a.draughts} draught${a.draughts === 1 ? '' : 's'}${a.flasks ? ` · ${a.flasks} flask${a.flasks === 1 ? '' : 's'}` : ''}`;
    if (flash) { this.wallet.classList.remove('flash'); void this.wallet.offsetWidth; this.wallet.classList.add('flash'); }
  }
  // the blessing on the HUD: a small cross and how long it has left
  showBlessing() {
    const me = this.g.me; const t = me?.blessT || 0;
    if (!this.blessEl && t > 0 && this.wallet) { this.blessEl = document.createElement('div'); this.blessEl.className = 'bless-icon'; this.wallet.parentNode.appendChild(this.blessEl); }
    if (!this.blessEl) return;
    if (t <= 0) { this.blessEl.remove(); this.blessEl = null; return; }
    const s = Math.ceil(t); this.blessEl.innerHTML = `<span class="x">✠</span> Blessed <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b>${me.blessRise ? ' · <i>rise once</i>' : ''}`;
  }

  build(world) {
    this.dispose();
    if (!world || world.ch.terrain.kind === 'peak') return;
    // beside the road, just ahead of where the company starts
    const sp = world.startPos, p = world.path.at(0.04), q = world.path.at(0.05);
    let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    // on level ground beside the road (in a gorge that may be right at the track's edge), never up a slope
    const py = world.heightAt(p.x, p.z); let x = p.x + nx * 3, z = p.z + nz * 3;
    search: for (const off of [7, 6, 5, 4, 3]) for (const sd of [1, -1]) {
      const cx = p.x + nx * off * sd, cz = p.z + nz * off * sd; if (!world.inBounds(cx, cz)) continue;
      let ok = Math.abs(world.heightAt(cx, cz) - py) < 0.8;
      const fl = Math.hypot(q.x - p.x, q.z - p.z) || 1, fx = (q.x - p.x) / fl, fz = (q.z - p.z) / fl;
      for (const [a, b] of [[2, 0], [-2, 0], [0, 2.5], [0, -2.5], [0, 5]]) { const qx = cx + nx * a + fx * b, qz = cz + nz * a + fz * b; if (Math.abs(world.heightAt(qx, qz) - py) > 0.9) ok = false; }
      if (ok) { x = cx; z = cz; break search; }
    }
    const w = this.wagon = wagonModel(this.g.engine.q); w.rotation.order = 'YXZ'; w.position.set(x, world.heightAt(x, z), z); w.rotation.y = Math.atan2(q.x - p.x, q.z - p.z) + 0.3;
    { const s = wheelGround(world, w); w.position.y = s.y; w.rotation.x = s.pitch; w.rotation.z = s.roll; }
    this.g.scene.add(w); this.cols = [world.addCollider(x, z, 2.0), world.addCollider(x + Math.sin(w.rotation.y) * 4.2, z + Math.cos(w.rotation.y) * 4.2, 1.1)];
    this.spot = { x, z };
    // the sutler on his box seat, and Father Bertram standing by the wagon, a sanctuary round the wagon
    if (bodyReady()) {
      const su = makePerson('sutler', this.g.engine.q); su.root.position.set(0, 1.47 - su.hipsY + 0.06, 2.08); w.add(su.root);
      const pr = makePerson('priest', this.g.engine.q); const px = x + Math.cos(w.rotation.y) * 3.2, pz = z - Math.sin(w.rotation.y) * 3.2;
      pr.root.position.set(px, world.heightAt(px, pz) + (pr.groundOffset || 0), pz); pr.root.rotation.y = w.rotation.y + Math.PI / 2; pr.setGround?.((gx, gz) => world.heightAt(gx, gz)); this.g.scene.add(pr.root); this.priest = pr; this.cols.push(world.addCollider(px, pz, 0.6));
      this.people = [su, pr];
      for (const pp of this.people) for (const c of pp.cloths || []) { c.ground = world.heightAt(pr.root.position.x, pr.root.position.z); this.g.scene.add(c.mesh); }
      if (su.cloths) { su.cloths[0].ground = w.position.y + 1.0; su.cloths[1].ground = w.position.y + 1.47; }
    }
    this.sanctuary = { x, z, r: 13 };
    this.g.ui.toast('Sanctuary: near the wagon and Father Bertram you are safe. Trade with the sutler, ask his blessing, then ride on.', 6);
    this.blessed = false; this.world = world;
    this.tradeT = TRADE_TIME; this.leave = null; this.awayT = 0;
  }
  // the trading time: the sutler waits, then the priest climbs up beside him and they drive off fast, on along the road
  tradeLabel() { if (!this.wagon || this.leave || this.tradeT <= 0) return ''; const s = Math.ceil(this.tradeT); return `Trade with the sutler, ask Father Bertram's blessing · the wagon leaves in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  updateWagon(dt) {
    const g = this.g, w = this.wagon, W = this.world;
    const speed = this.leave ? this.leave.v : 0;
    // each horse stands on the ground under its own hooves, not on the wagon's level
    w.updateMatrixWorld(true); const wi = new THREE.Matrix4().copy(w.matrixWorld).invert();
    for (const h of w.userData.horses || []) {
      h.update(dt, speed);
      const p = h.root.getWorldPosition(new THREE.Vector3()); p.y = W.groundAt(p.x, p.z); p.applyMatrix4(wi);
      h.root.position.y += (p.y - h.root.position.y) * Math.min(1, dt * 12 + (h.placed ? 0 : 1)); h.placed = true;
    }
    for (const wh of w.userData.wheels || []) wh.rotation.z -= speed * dt / 0.58;
    if (this.blessFx > 0) { this.blessFx -= dt; if (this.blessFx <= 0) { g.fx.holyBurst(g.me.pos, 2); g.audio.holy?.(g.me.pos, 0.4); } }
    if (!this.leave) {
      if (g.cinema.active || g.paused || this.open) return;
      this.tradeT -= dt;
      // the company has moved on without him: he does not wait the full time
      const far = g.knightList.every((k) => Math.hypot(k.pos.x - w.position.x, k.pos.z - w.position.z) > 40);
      this.awayT = far ? this.awayT + dt : 0;
      if (this.tradeT <= 0 || this.awayT > 6) this.depart();
      else if (Math.ceil(this.tradeT) === 10 && !this.warned) { this.warned = true; g.ui.toast('The sutler gathers his reins: ten seconds to trade', 3); }
      return;
    }
    const L = this.leave; L.t += dt;
    if (L.stage === 'board') {   // Father Bertram is climbing up; if something has stopped him, put him on the seat
      if (L.t > 30 && this.priest?.seatNow) { this.priest.seatNow(w, BOARD); L.stage = 'drive'; }
      return;
    }
    // whip up the horses and away along the road: the pace picked up from a walk, slowed for bends and hills
    const R = L.route, px = w.position.x, pz = w.position.z;
    while (L.i < R.length - 1 && Math.hypot(R[L.i + 1].x - px, R[L.i + 1].z - pz) < Math.hypot(R[L.i].x - px, R[L.i].z - pz) + 0.5) L.i++;
    const Ld = 4.5 + L.v * 0.55; let j = L.i; while (j < R.length - 1 && Math.hypot(R[j].x - px, R[j].z - pz) < Ld) j++;
    const T = R[j];
    let alpha = Math.atan2(T.x - px, T.z - pz) - w.rotation.y; alpha = Math.atan2(Math.sin(alpha), Math.cos(alpha));
    const kappa = Math.max(-0.19, Math.min(0.19, (2 * Math.sin(alpha)) / Ld));   // pure pursuit, never tighter than its lock allows
    // how sharply the road bends, and how steep it is, over the next stretch
    let bend = 0; for (let k = L.i + 1; k < Math.min(R.length - 1, L.i + 7); k++) { const a1 = Math.atan2(R[k].x - R[k - 1].x, R[k].z - R[k - 1].z), a2 = Math.atan2(R[k + 1].x - R[k].x, R[k + 1].z - R[k].z); bend = Math.max(bend, Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))) / 2.5); }
    const A6 = R[Math.min(R.length - 1, L.i + 3)], grade = (W.groundAt(A6.x, A6.z) - W.groundAt(px, pz)) / Math.max(3, Math.hypot(A6.x - px, A6.z - pz));
    const vmax = 7.5, vBend = Math.sqrt(2.4 / Math.max(1e-3, Math.max(bend, Math.abs(kappa)))), vHill = vmax * (grade > 0 ? 1 - Math.min(0.6, grade * 4) : 1 - Math.min(0.3, -grade * 2));
    const vt = Math.min(vmax, vBend, vHill);
    L.v += L.v < vt ? Math.min(vt - L.v, dt * (0.4 + 1.5 * (1 - L.v / vmax))) : -Math.min(L.v - vt, dt * 3);
    w.rotation.y += L.v * kappa * dt;
    w.position.x += Math.sin(w.rotation.y) * L.v * dt; w.position.z += Math.cos(w.rotation.y) * L.v * dt;
    // up and down over the ground under its wheels, jolting a little at speed
    const G = wheelGround(W, w), jolt = Math.min(1, L.v / 6);
    L.y = L.y === undefined ? G.y : L.y + (G.y - L.y) * Math.min(1, dt * 14);
    w.position.y = L.y + Math.abs(Math.sin(L.t * 11)) * 0.015 * jolt;
    w.rotation.x += (G.pitch + Math.sin(L.t * 9) * 0.01 * jolt - w.rotation.x) * Math.min(1, dt * 8);
    w.rotation.z += (G.roll + Math.sin(L.t * 7.3) * 0.012 * jolt - w.rotation.z) * Math.min(1, dt * 8);
    for (const wh of w.userData.wheels || []) if (wh.userData.front) wh.rotation.y = Math.PI / 2 + Math.atan(kappa * 2.3) * 0.8;
    (w.userData.rack || []).forEach((r, k) => { r.rotation.z = (k % 2 ? 1 : -1) * 0.02 + Math.sin(L.t * 8 + k * 1.7) * 0.05 * jolt; });
    for (const pp of this.people || []) for (const c of pp.cloths || []) c.ground = w.position.y + 1.0;
    L.hoof -= dt; if (L.hoof <= 0) { L.hoof = Math.max(0.16, 0.5 - L.v * 0.045); g.audio.footstep?.(w.position.clone(), true, 1.3); }
    if (L.v > 2 && Math.random() < dt * L.v * 2) g.fx.wisp?.(w.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.2, 0)), 0.8, [0.35, 0.3, 0.25]);
    // gone: round the bend and out of sight, or far down the valley, or at the end of the way
    const cam = g.engine.camera, dc = cam.position.distanceTo(w.position);
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
    const seen = _frustum.intersectsSphere(new THREE.Sphere(w.position.clone().setY(w.position.y + 1.5), 4.5));
    L.unseen = seen ? 0 : (L.unseen || 0) + dt;
    if (L.i >= R.length - 2 || dc > 110 || (dc > 40 && L.unseen > 1.5) || L.t > 90) this.dispose();
  }
  depart() {
    const g = this.g, w = this.wagon, W = this.world;
    for (const c of this.cols || []) c.r = -100;   // the colliders go with them
    this.sanctuary = null; if (this.open) this.close();
    // on along the road ahead, down the valley it runs through, and out of sight round its bends
    const route = roadRoute(W, w.position);
    this.leave = { stage: 'board', t: 0, v: 0, i: 0, route, hoof: 0 };
    g.ui.toast('The sutler whips up his horses. Father Bertram climbs up beside him. You are on your own now.', 5);
    const pr = this.priest, drive = () => { if (this.leave) { this.leave.stage = 'drive'; g.audio.whinny?.(w.position); } };
    if (pr?.board) pr.board(w, BOARD, drive, (x, z) => W.heightAt(x, z));
    else drive();
  }
  inSanctuary(p, pad = 0) { const S = this.sanctuary; return !!S && Math.hypot(p.x - S.x, p.z - S.z) < S.r + pad; }
  nearPriest() { if (!this.priest || this.leave) return false; const m = this.g.me.pos, p = this.priest.root.position; return Math.hypot(m.x - p.x, m.z - p.z) < 3; }
  near() { if (!this.spot || this.leave) return false; const m = this.g.me.pos; return Math.hypot(m.x - this.spot.x, m.z - this.spot.z) < 4.2; }

  update(dt) {
    if (this.wagon) this.updateWagon(dt);
    if (this.people) { const me = this.g.me?.pos, cam = this.g.engine.camera.position; for (const pp of this.people) pp.update?.(dt, cam, me); }
    const g = this.g, I = g.input, me = g.me;
    // nothing unholy comes near the priest: demons that reach the sanctuary are thrown back from it
    if (g.isHost && this.sanctuary) for (const d of g.horde.list) {
      if (!d.alive) continue; const S = this.sanctuary; const dx = d.pos.x - S.x, dz = d.pos.z - S.z, l = Math.hypot(dx, dz);
      if (l < S.r + 0.5) { const k = (S.r + 0.6) / (l || 1); d.pos.x = S.x + dx * k; d.pos.z = S.z + dz * k; d.flinch = 1; if (Math.random() < dt * 2) g.fx.holyMotes(d.chest, 0.6, 3); }
    }
    if (!this.open && this.nearPriest() && I.pressed('KeyF')) {
      if (!this.blessed) {
        this.blessed = true; this.priest?.bless?.(); this.blessFx = 2.6; me.hp = me.maxHp; g.dread.level = 0; g.audio.holy?.(me.pos, 0.6); g.fx.holyBurst(me.pos, 2);
        me.blessT = BLESS_TIME; me.blessRise = true;
        g.ui.subtitle(['Benedicat te omnipotens Deus. Go with God, my son, and keep close to your brothers.', ''], 5);
        setTimeout(() => g.ui.toast('Blessed for the road ahead: wounds healed, dread lifted, +15% against demons, the fear comes slower, and if you fall you will rise once by yourself', 7), 2600);
      }
      else g.ui.subtitle(['I have blessed you already. Go. They are waiting for you out there.', ''], 3.5);
      return;
    }
    // the healing draught
    this.popT = (this.popT || 0) - dt; this.showBlessing();
    if (this.heal > 0) { const h = Math.min(this.heal, dt * this.healAmt() / 3); this.heal -= h; if (!me.downed) me.hp = Math.min(me.maxHp, me.hp + h); }
    if (!this.open && I.pressed('KeyH') && this.a.draughts > 0 && !me.downed && me.hp < me.maxHp && this.heal <= 0) {
      this.a.draughts--; saveArmoury(this.a); this.heal = this.healAmt(); g.audio.holy?.(me.pos, 0.3); g.fx.holyMotes(me.pos.clone().setY(me.pos.y + 1.2), 0.6, 6); this.showWallet(true);
    }
    if (!this.open && I.pressed('KeyG') && this.a.flasks > 0 && me.canAct && !me.action && !g.cinema.active) {
      this.a.flasks--; saveArmoury(this.a); this.showWallet(true);
      me.startAction(me.common.relicThrow, 'relic', { relic: 'water' });
    }
    if (this.open && (I.pressed('Escape') || I.pressed('KeyF') || (this.spot && !this.near()))) { this.close(); return; }
    if (!this.open && this.near() && !this.nearPriest() && I.pressed('KeyF') && !g.cinema.active) this.show();
  }
  healAmt() { return 70 + 30 * (this.a.up.physic || 0); }
  prompt() { if (this.open) return ''; if (this.nearPriest()) return '<kbd>F</kbd>Ask Father Bertram for his blessing'; return this.near() ? '<kbd>F</kbd>Trade with the sutler' : ''; }

  show() {
    this.open = true; this.render(); this.el?.classList.add('show');
    if (this.g.opts.solo) this.g.paused = true;
    document.exitPointerLock?.();
  }
  close() {
    this.open = false; this.el?.classList.remove('show');
    if (this.g.opts.solo) this.g.paused = false;
    this.g.app.input.lock?.();
  }
  render() {
    if (!this.el) return;
    const a = this.a, me = this.g.me, cur = me.loadout.weapon, tab = this.tab || 'arms';
    const btn = (attrs, cost, label) => `<button class="btn small" ${attrs} ${a.silver < cost ? 'disabled' : ''}>${label || cost}</button>`;
    // selling back: half what it cost; a second click confirms anything worth 100 or more
    const sell = (attr, val) => { const sure = this.confirm === attr; return `<button class="btn small sell${sure ? ' sure' : ''}" ${attr} title="Sell back for half">${sure ? `Sure? +${val}` : `Sell · ${val}`}</button>`; };
    const pips = (lvl, max) => `<span class="pips">${'<i class="on"></i>'.repeat(lvl)}${'<i></i>'.repeat(Math.max(0, max - lvl))}</span>`;
    const weaponRow = ([k, d]) => {
      const owned = a.owned.includes(k), price = PRICES[k] || 0, equipped = k === cur, temper = a.up['edge:' + k] || 0;
      const act0 = equipped ? '<span class="tag">Wielding</span>' : owned ? `<button class="btn small" data-equip="${k}">Take up</button>` : btn(`data-buy="${k}"`, price, `Buy · ${price}`);
      const act = owned && price ? `<span class="ware-acts">${act0}${sell(`data-sellw="${k}"`, this.weaponRefund(k))}</span>` : act0;
      return `<div class="ware${equipped ? ' on' : ''}${d.legendary ? ' relic' : ''}"><div><b>${d.name}</b> ${temper ? pips(temper, 3) : ''}${d.lore ? `<p class="lore">${d.lore}</p>` : ''}<p>${d.desc}</p></div>${act}</div>`;
    };
    const upRow = (k) => {
      const d = UPGRADES[k]; const key = k === 'edge' ? 'edge:' + cur : k; const lvl = a.up[key] || 0; const cost = d.cost[lvl];
      const buyB = lvl >= d.max ? '<span class="tag">Done</span>' : btn(`data-up="${key}"`, cost);
      const acts = lvl > 0 ? `<span class="ware-acts">${buyB}${sell(`data-sellu="${key}"`, Math.floor(d.cost[lvl - 1] / 2))}</span>` : buyB;
      return `<div class="ware"><div><b>${d.name}${k === 'edge' ? ` · ${WEAPONS[cur].name}` : ''}</b> ${pips(lvl, d.max)}<p>${d.desc}</p></div>${acts}</div>`;
    };
    const stock = (name, desc, have, max, cost, attr) => `<div class="ware"><div><b>${name}</b> <span class="tag">${have} / ${max}</span><p>${desc}</p></div>${have >= max ? '<span class="tag">Full</span>' : btn(attr, cost)}</div>`;
    const W = Object.entries(WEAPONS).filter(([k]) => k !== 'buckler');
    const body = {
      arms: `<h4>Arms</h4>${W.filter(([, d]) => !d.legendary).map(weaponRow).join('')}`,
      relics: `<p class="small">Holy arms that no armoury sells. The sutler will not say how he came by them.</p>${W.filter(([, d]) => d.legendary).map(weaponRow).join('')}`,
      harness: Object.keys(UPGRADES).filter((k) => UPGRADES[k].tab === 'harness').map(upRow).join(''),
      faith: `<p class="small">Father Bertram's own blessing is free: speak to him before you ride.</p>` + Object.keys(UPGRADES).filter((k) => UPGRADES[k].tab === 'faith').map(upRow).join(''),
      stores: stock(DRAUGHT.name, `${DRAUGHT.desc} Heals ${this.healAmt()}.`, a.draughts, draughtMax(a), DRAUGHT.cost, 'data-draught="1"') + stock(FLASK.name, FLASK.desc, a.flasks || 0, FLASK.max, FLASK.cost, 'data-flask="1"') + Object.keys(UPGRADES).filter((k) => UPGRADES[k].tab === 'stores').map(upRow).join(''),
    }[tab];
    const tabs = [['arms', 'Arms'], ['relics', 'Holy Relics'], ['harness', 'Armourer'], ['faith', 'Relic & Faith'], ['stores', 'Provisions']]
      .map(([k, n]) => `<button class="shop-tab${k === tab ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('');
    this.el.innerHTML = `<div class="panel shop-panel"><h2 class="title-sm">The Sutler's Wagon</h2>
      <p class="small">"Steel, sirs. Good steel, for good silver. The dead don't need it."</p>
      <div class="shop-purse"><span class="coin"></span><b>${a.silver}</b> silver</div>
      <div class="shop-tabs">${tabs}</div><div class="shop-body">${body}</div>
      <div class="row"><button class="btn primary" data-close="1">Ride on (F)</button></div></div>`;
  }
  onClick(e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = this.a, me = this.g.me, d = b.dataset;
    if (d.close) return this.close();
    if (d.tab) { this.tab = d.tab; this.confirm = null; return this.render(); }
    // selling back, at half price; a second click confirms the dear ones
    if (d.sellw || d.sellu) {
      const attr = d.sellw ? `data-sellw="${d.sellw}"` : `data-sellu="${d.sellu}"`;
      const val = d.sellw ? this.weaponRefund(d.sellw) : Math.floor(UPGRADES[d.sellu.startsWith('edge') ? 'edge' : d.sellu].cost[(a.up[d.sellu] || 1) - 1] / 2);
      if (val >= 100 && this.confirm !== attr) { this.confirm = attr; clearTimeout(this._cf); this._cf = setTimeout(() => { if (this.confirm === attr) { this.confirm = null; if (this.open) this.render(); } }, 3000); return this.render(); }
      this.confirm = null;
      if (d.sellw) this.sellWeapon(d.sellw); else this.sellUpgrade(d.sellu);
      this.g.audio.coin?.(me.pos) ?? this.g.audio.clang?.(me.pos, 0.2, 1.8);
      saveArmoury(a); this.showWallet(); this.render(); return;
    }
    this.confirm = null;
    if (d.buy) { const p = PRICES[d.buy]; if (a.silver < p || a.owned.includes(d.buy)) return; a.silver -= p; a.owned.push(d.buy); this.equip(d.buy); this.g.audio.clang?.(me.pos, 0.3, 1.4); if (WEAPONS[d.buy].legendary) { this.g.audio.holy?.(me.pos, 0.8); this.g.fx.holyBurst(me.pos, 2); this.g.ui.toast(`${WEAPONS[d.buy].name} is yours`, 3); } }
    else if (d.equip) this.equip(d.equip);
    else if (d.up) { const k = d.up.startsWith('edge') ? 'edge' : d.up; const lvl = a.up[d.up] || 0; const cost = UPGRADES[k].cost[lvl]; if (cost === undefined || a.silver < cost) return; a.silver -= cost; a.up[d.up] = lvl + 1; this.g.audio.clang?.(me.pos, 0.3, 1.2); this.applyToMe(); }
    else if (d.draught) { if (a.silver < DRAUGHT.cost || a.draughts >= draughtMax(a)) return; a.silver -= DRAUGHT.cost; a.draughts++; }
    else if (d.flask) { if (a.silver < FLASK.cost || (a.flasks || 0) >= FLASK.max) return; a.silver -= FLASK.cost; a.flasks = (a.flasks || 0) + 1; }
    saveArmoury(a); this.showWallet(); this.render();
  }
  // half the weapon's price, and half of whatever was spent tempering its edge
  weaponRefund(k) {
    const a = this.a, t = a.up['edge:' + k] || 0; let spent = PRICES[k] || 0;
    for (let i = 0; i < t; i++) spent += UPGRADES.edge.cost[i] || 0;
    return Math.floor(spent / 2);
  }
  sellWeapon(k) {
    const a = this.a; if (!a.owned.includes(k) || !PRICES[k]) return;
    a.silver += this.weaponRefund(k); a.owned = a.owned.filter((w) => w !== k); delete a.up['edge:' + k];
    if (this.g.me.loadout.weapon === k) this.equip('longsword');
    this.g.ui.toast(`Sold ${WEAPONS[k].name}`, 2);
  }
  sellUpgrade(key) {
    const a = this.a, k = key.startsWith('edge') ? 'edge' : key, lvl = a.up[key] || 0; if (!lvl) return;
    a.silver += Math.floor(UPGRADES[k].cost[lvl - 1] / 2);
    if (lvl > 1) a.up[key] = lvl - 1; else delete a.up[key];
    a.draughts = Math.min(a.draughts, draughtMax(a));
    this.applyToMe();
  }
  equip(key) {
    const g = this.g; g.me.setWeapon(key, g.engine.q); this.applyToMe();
    g.ui.setSelf(g.me);
    // the lobby remembers it, and everyone else sees the new weapon in your hands
    g.app.loadout.weapon = key; account.set('evil.loadout', { ...g.app.loadout });
    if (!g.opts.solo) g.net.send('gear', { id: g.meId, weapon: key, maxHp: g.me.maxHp });
  }
  dispose() { if (this.people) { for (const pp of this.people) pp.dispose?.(); this.people = null; } if (this.ring) { this.ring.removeFromParent(); this.ring = null; } if (this.priest) { this.priest.root.removeFromParent(); this.priest = null; } this.sanctuary = null; if (this.wagon) { this.wagon.removeFromParent(); this.wagon.traverse((o) => o.geometry?.dispose?.()); this.wagon = null; } this.spot = null; if (this.open) this.close(); }
}
