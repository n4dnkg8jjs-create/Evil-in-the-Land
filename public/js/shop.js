// The sutler's wagon. A camp-follower who has trailed every army into the blight
// waits at the start of each road with steel to sell, for the silver the knights
// win: from the demons they cut down, the altars they hallow, the pages they find.
// What a knight owns and has had tempered is kept between pilgrimages.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { clothTextures } from './textures.js';
import { makePerson } from './people.js';
import { bodyReady } from './body.js';
import { TAU } from './util.js';
import { makeHorse } from './horse.js';

export const TRADE_TIME = 75;   // seconds the sutler waits before he whips up the horses

const KEY = 'evil.armoury';
const START_WEAPONS = ['longsword', 'mace', 'pike'];
export const PRICES = { zweihander: 180, halberd: 140, pollaxe: 160 };
export const UPGRADES = {
  edge: { name: 'Temper the edge', desc: 'The armourer re-hardens and hones your weapon. +12% damage per stage.', max: 3, cost: [80, 150, 240] },
  proof: { name: 'Proof the harness', desc: 'Thicker plates riveted in where the demons find gaps. +20 health per stage.', max: 3, cost: [100, 180, 280] },
  blessing: { name: 'Have the relic blessed', desc: 'A friar travelling with the wagon says a Mass over it. Relic ready 15% sooner per stage.', max: 2, cost: [90, 170] },
};
const DRAUGHT = { name: 'Healing draught', desc: 'Wine, myrrh and a prayer. Press H in battle to drink: heals 70 over three seconds. Carry up to three.', cost: 35, max: 3 };

export function loadArmoury() {
  let a = null; try { a = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  a = Object.assign({ silver: 60, owned: [...START_WEAPONS], up: {}, draughts: 1 }, a || {});
  for (const w of START_WEAPONS) if (!a.owned.includes(w)) a.owned.push(w);
  return a;
}
export function saveArmoury(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} }
// edge is kept per weapon; proof and blessing belong to the knight
export function upgradesFor(a, weapon) { return { edge: (a.up['edge:' + weapon] || 0), proof: a.up.proof || 0, blessing: a.up.blessing || 0 }; }

// ---------------------------------------------------------------- the wagon
function wagonModel() {
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
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = wheel(); w.position.set(sx * 1.02, 0.6, sz * 1.15); w.rotation.y = Math.PI / 2; w.rotation.z = sz * 0.3; g.add(w); g.userData.wheels.push(w); }
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
  // a rack of arms and a hanging lantern at the tailboard
  add(new THREE.BoxGeometry(1.4, 0.08, 0.08), wood, [0, 2.0, -2.18]);
  for (let i = 0; i < 4; i++) { add(new THREE.BoxGeometry(0.04, 1.0 + i * 0.1, 0.01), steel, [-0.5 + i * 0.33, 1.4 + i * 0.05, -2.2]); add(new THREE.BoxGeometry(0.18, 0.025, 0.03), iron, [-0.5 + i * 0.33, 1.9 + i * 0.05 - 0.05, -2.2]); }
  for (let i = 0; i < 2; i++) add(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 10), wood, [1.4, 0.43, -1.2 + i * 0.7]);
  add(new THREE.BoxGeometry(0.7, 0.55, 0.6), wood, [-1.4, 0.28, -1.5]);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.35).multiplyScalar(4), toneMapped: false }));
  lamp.position.set(0.75, 2.15, -2.22); g.add(lamp);
  const light = new THREE.PointLight(0xffb060, 6, 9, 2); light.position.copy(lamp.position); g.add(light);
  return g;
}

export class Shop {
  constructor(game) {
    this.g = game; this.a = loadArmoury(); this.open = false; this.wagon = null;
    this.el = document.getElementById('shop'); this.wallet = document.getElementById('silver');
    this.heal = 0;
    if (this.el) this.el.addEventListener('click', (e) => this.onClick(e));
  }
  // the knight as the armoury left him: weapon edge, harness proof, relic blessing
  applyToMe() { const me = this.g.me; me.applyUpgrades(upgradesFor(this.a, me.loadout.weapon)); this.showWallet(); }
  earn(n, why) { this.a.silver += n; saveArmoury(this.a); this.showWallet(true); if (why) this.g.ui.toast(`+${n} silver · ${why}`, 1.6); }
  showWallet(flash) { if (!this.wallet) return; this.wallet.textContent = `${this.a.silver} silver · ${this.a.draughts} draught${this.a.draughts === 1 ? '' : 's'}`; if (flash) { this.wallet.classList.remove('flash'); void this.wallet.offsetWidth; this.wallet.classList.add('flash'); } }

  build(world) {
    this.dispose();
    if (!world || world.ch.terrain.kind === 'peak') return;
    // beside the road, just ahead of where the company starts
    const sp = world.startPos, p = world.path.at(0.04), q = world.path.at(0.05);
    let nx = -(q.z - p.z), nz = q.x - p.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    let x = p.x + nx * 7, z = p.z + nz * 7; if (!world.inBounds(x, z)) { x = p.x - nx * 7; z = p.z - nz * 7; }
    const w = this.wagon = wagonModel(); w.position.set(x, world.heightAt(x, z), z); w.rotation.y = Math.atan2(q.x - p.x, q.z - p.z) + 0.3;
    const n = world.normalAt(x, z); w.rotation.x = Math.atan2(n.z, n.y) * 0.5; w.rotation.z = -Math.atan2(n.x, n.y) * 0.5;
    this.g.scene.add(w); this.cols = [world.addCollider(x, z, 2.0), world.addCollider(x + Math.sin(w.rotation.y) * 4.2, z + Math.cos(w.rotation.y) * 4.2, 1.1)];
    this.spot = { x, z };
    // the sutler on his box seat, and Father Bertram standing by the wagon, a sanctuary round the wagon
    if (bodyReady()) {
      const su = makePerson('sutler', this.g.engine.q); su.root.position.set(0, 1.47 - su.hipsY + 0.06, 2.08); w.add(su.root);
      const pr = makePerson('priest', this.g.engine.q); const px = x + Math.cos(w.rotation.y) * 3.2, pz = z - Math.sin(w.rotation.y) * 3.2;
      pr.root.position.set(px, world.heightAt(px, pz) + (pr.groundOffset || 0), pz); pr.root.rotation.y = w.rotation.y + Math.PI / 2; this.g.scene.add(pr.root); this.priest = pr; this.cols.push(world.addCollider(px, pz, 0.6));
      this.people = [su, pr];
      for (const pp of this.people) for (const c of pp.cloths || []) { c.ground = world.heightAt(pr.root.position.x, pr.root.position.z); this.g.scene.add(c.mesh); }
      if (su.cloths) { su.cloths[0].ground = w.position.y + 1.0; su.cloths[1].ground = w.position.y + 1.47; }
    }
    this.sanctuary = { x, z, r: 13 };
    this.g.ui.toast('Sanctuary: near the wagon and Father Bertram you are safe. Trade with the sutler, ask his blessing, then ride on.', 6);
    this.blessed = false; this.world = world;
    this.tradeT = TRADE_TIME; this.leave = null; this.awayT = 0;
  }
  // the trading time: the sutler waits, then the priest climbs up beside him and they drive off fast, back down the road
  tradeLabel() { if (!this.wagon || this.leave || this.tradeT <= 0) return ''; const s = Math.ceil(this.tradeT); return `Trade with the sutler, ask Father Bertram's blessing · the wagon leaves in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  updateWagon(dt) {
    const g = this.g, w = this.wagon, W = this.world;
    const speed = this.leave ? this.leave.v : 0;
    for (const h of w.userData.horses || []) h.update(dt, speed);
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
    if (L.stage === 'board') return;   // the priest is walking to the wagon
    // whip up the horses and away down the road
    L.v = Math.min(11, L.v + dt * 4);
    const tgt = L.route[L.i]; if (!tgt) { this.dispose(); return; }
    const dx = tgt.x - w.position.x, dz = tgt.z - w.position.z, d = Math.hypot(dx, dz);
    if (d < 4) { L.i++; return; }
    let dy = Math.atan2(dx, dz) - w.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); w.rotation.y += dy * Math.min(1, dt * 2.2);
    w.position.x += Math.sin(w.rotation.y) * L.v * dt; w.position.z += Math.cos(w.rotation.y) * L.v * dt;
    const gy = W.groundAt(w.position.x, w.position.z); w.position.y = gy;
    const n = W.inBounds(w.position.x, w.position.z) ? W.normalAt(w.position.x, w.position.z) : new THREE.Vector3(0, 1, 0);
    w.rotation.x = Math.atan2(n.z * Math.cos(w.rotation.y) + n.x * Math.sin(w.rotation.y), n.y) * 0.6 + Math.sin(L.t * 9) * 0.012; w.rotation.z = Math.sin(L.t * 7.3) * 0.015;
    for (const pp of this.people || []) for (const c of pp.cloths || []) c.ground = w.position.y + 1.0;
    L.hoof -= dt; if (L.hoof <= 0) { L.hoof = 0.19; g.audio.footstep?.(w.position.clone(), true, 1.3); }
    if (Math.random() < dt * 14) g.fx.wisp?.(w.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.2, 0)), 0.8, [0.35, 0.3, 0.25]);
    if (L.t > 40) this.dispose();
  }
  depart() {
    const g = this.g, w = this.wagon, W = this.world;
    for (const c of this.cols || []) c.r = -100;   // the colliders go with them
    this.sanctuary = null; if (this.open) this.close();
    // back down the road the way they came, then on out of sight
    const route = []; const nr = W.path.nearest(w.position.x, w.position.z);
    for (let t = Math.max(0, nr.t - 0.01); t > 0; t -= 0.02) route.push(W.path.at(t));
    const a = W.path.at(0), b = W.path.at(0.02); const ox = a.x - b.x, oz = a.z - b.z, ol = Math.hypot(ox, oz) || 1;
    for (let k = 1; k <= 8; k++) route.push({ x: a.x + ox / ol * k * 25, z: a.z + oz / ol * k * 25 });
    this.leave = { stage: 'board', t: 0, v: 0, i: 0, route, hoof: 0 };
    g.ui.toast('The sutler whips up his horses. Father Bertram climbs up beside him. You are on your own now.', 5);
    const pr = this.priest, go = () => {
      // up onto the box, beside the sutler
      pr.root.removeFromParent(); w.add(pr.root); pr.root.position.set(0.52, 1.47 - pr.hipsY + 0.06, 2.08); pr.root.rotation.set(0, 0, 0); pr.sit?.();
      this.leave.stage = 'drive'; g.audio.whinny?.(w.position);
    };
    if (pr?.walkTo) {
      w.updateMatrixWorld(true); const side = new THREE.Vector3(1.4, 0, 2.2).applyMatrix4(w.matrixWorld);
      pr.walkTo(side, go, (x, z) => W.heightAt(x, z));
    } else go();
    if (pr) setTimeout(() => { if (this.leave?.stage === 'board') go(); }, 6000);
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
      if (!this.blessed) { this.blessed = true; this.priest?.bless?.(); this.blessFx = 2.6; me.hp = me.maxHp; g.dread.level = 0; g.audio.holy?.(me.pos, 0.6); g.fx.holyBurst(me.pos, 2); g.ui.subtitle(['Benedicat te omnipotens Deus. Go with God, my son, and keep close to your brothers.', ''], 5); }
      else g.ui.subtitle(['I have blessed you already. Go. They are waiting for you out there.', ''], 3.5);
      return;
    }
    // the healing draught
    if (this.heal > 0) { const h = Math.min(this.heal, dt * 70 / 3); this.heal -= h; if (!me.downed) me.hp = Math.min(me.maxHp, me.hp + h); }
    if (!this.open && I.pressed('KeyH') && this.a.draughts > 0 && !me.downed && me.hp < me.maxHp && this.heal <= 0) {
      this.a.draughts--; saveArmoury(this.a); this.heal = 70; g.audio.holy?.(me.pos, 0.3); g.fx.holyMotes(me.pos.clone().setY(me.pos.y + 1.2), 0.6, 6); this.showWallet(true);
    }
    if (this.open && (I.pressed('Escape') || I.pressed('KeyF') || (this.spot && !this.near()))) { this.close(); return; }
    if (!this.open && this.near() && !this.nearPriest() && I.pressed('KeyF') && !g.cinema.active) this.show();
  }
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
    const a = this.a, me = this.g.me, cur = me.loadout.weapon;
    const w = Object.entries(WEAPONS).map(([k, d]) => {
      const owned = a.owned.includes(k), price = PRICES[k] || 0, equipped = k === cur;
      const btn = equipped ? '<span class="tag">Wielding</span>' : owned ? `<button class="btn small" data-equip="${k}">Take up</button>` : `<button class="btn small" data-buy="${k}" ${a.silver < price ? 'disabled' : ''}>Buy · ${price}</button>`;
      return `<div class="ware${equipped ? ' on' : ''}"><div><b>${d.name}</b> ${a.up['edge:' + k] ? `<span class="tag">tempered ${'✦'.repeat(a.up['edge:' + k])}</span>` : ''}<p>${d.desc}</p></div>${btn}</div>`;
    }).join('');
    const u = Object.entries(UPGRADES).map(([k, d]) => {
      const key = k === 'edge' ? 'edge:' + cur : k; const lvl = a.up[key] || 0; const maxed = lvl >= d.max; const cost = d.cost[lvl];
      return `<div class="ware"><div><b>${d.name}${k === 'edge' ? ` (${WEAPONS[cur].name})` : ''}</b> <span class="tag">${'✦'.repeat(lvl)}${'·'.repeat(d.max - lvl)}</span><p>${d.desc}</p></div>${maxed ? '<span class="tag">Done</span>' : `<button class="btn small" data-up="${key}" ${a.silver < cost ? 'disabled' : ''}>${cost}</button>`}</div>`;
    }).join('');
    const dr = `<div class="ware"><div><b>${DRAUGHT.name}</b> <span class="tag">${a.draughts} / ${DRAUGHT.max}</span><p>${DRAUGHT.desc}</p></div>${a.draughts >= DRAUGHT.max ? '<span class="tag">Full</span>' : `<button class="btn small" data-draught="1" ${a.silver < DRAUGHT.cost ? 'disabled' : ''}>${DRAUGHT.cost}</button>`}</div>`;
    this.el.innerHTML = `<div class="panel shop-panel"><h2 class="title-sm">The Sutler's Wagon</h2><p class="small">"Steel, sirs. Good steel, for good silver. The dead don't need it." · You have <b>${a.silver} silver</b></p>
      <h4>Arms</h4>${w}<h4>The armourer and the friar</h4>${u}<h4>Supplies</h4>${dr}
      <div class="row"><button class="btn primary" data-close="1">Ride on (F)</button></div></div>`;
  }
  onClick(e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = this.a, me = this.g.me, d = b.dataset;
    if (d.close) return this.close();
    if (d.buy) { const p = PRICES[d.buy]; if (a.silver < p) return; a.silver -= p; a.owned.push(d.buy); this.equip(d.buy); this.g.audio.clang?.(me.pos, 0.3, 1.4); }
    else if (d.equip) this.equip(d.equip);
    else if (d.up) { const k = d.up.startsWith('edge') ? 'edge' : d.up; const lvl = a.up[d.up] || 0; const cost = UPGRADES[k].cost[lvl]; if (cost === undefined || a.silver < cost) return; a.silver -= cost; a.up[d.up] = lvl + 1; this.g.audio.clang?.(me.pos, 0.3, 1.2); this.applyToMe(); }
    else if (d.draught) { if (a.silver < DRAUGHT.cost || a.draughts >= DRAUGHT.max) return; a.silver -= DRAUGHT.cost; a.draughts++; }
    saveArmoury(a); this.showWallet(); this.render();
  }
  equip(key) {
    const g = this.g; g.me.setWeapon(key, g.engine.q); this.applyToMe();
    g.ui.setSelf(g.me);
    // the lobby remembers it, and everyone else sees the new weapon in your hands
    g.app.loadout.weapon = key; try { localStorage.setItem('evil.loadout', JSON.stringify(g.app.loadout)); } catch {}
    if (!g.opts.solo) g.net.send('gear', { id: g.meId, weapon: key, maxHp: g.me.maxHp });
  }
  dispose() { if (this.people) { for (const pp of this.people) pp.dispose?.(); this.people = null; } if (this.ring) { this.ring.removeFromParent(); this.ring = null; } if (this.priest) { this.priest.root.removeFromParent(); this.priest = null; } this.sanctuary = null; if (this.wagon) { this.wagon.removeFromParent(); this.wagon.traverse((o) => o.geometry?.dispose?.()); this.wagon = null; } this.spot = null; if (this.open) this.close(); }
}
