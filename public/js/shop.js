// The sutler's wagon. A camp-follower who has trailed every army into the blight
// waits at the start of each road with steel to sell, for the silver the knights
// win: from the demons they cut down, the altars they hallow, the pages they find.
// What a knight owns and has had tempered is kept between pilgrimages.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { TAU } from './util.js';

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
  const canvasM = new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.95, side: THREE.DoubleSide });
  const iron = new THREE.MeshStandardMaterial({ color: 0x5a5650, metalness: 0.8, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.3 });
  const add = (geo, m, p, r = [0, 0, 0]) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(1.8, 0.14, 3.6), wood, [0, 0.95, 0]);                       // bed
  for (const s of [-1, 1]) { add(new THREE.BoxGeometry(0.08, 0.5, 3.6), wood, [s * 0.88, 1.25, 0]); add(new THREE.BoxGeometry(1.8, 0.5, 0.08), wood, [0, 1.25, s * 1.76]); }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.TorusGeometry(0.55, 0.07, 6, 16), wood, [sx * 1.0, 0.55, sz * 1.15], [0, Math.PI / 2, 0]);
  // the canvas tilt over hoops
  const tilt = new THREE.CylinderGeometry(1.0, 1.0, 3.4, 16, 1, true, -Math.PI / 2, Math.PI); add(tilt, canvasM, [0, 1.55, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.BoxGeometry(0.1, 0.1, 2.6), wood, [0, 0.62, 2.9], [0.2, 0, 0]);         // the shafts
  // a rack of arms and a hanging lantern at the tailboard
  add(new THREE.BoxGeometry(1.4, 0.08, 0.08), wood, [0, 2.0, -2.0]);
  for (let i = 0; i < 4; i++) { add(new THREE.BoxGeometry(0.04, 1.0 + i * 0.1, 0.01), steel, [-0.5 + i * 0.33, 1.4 + i * 0.05, -2.02]); add(new THREE.BoxGeometry(0.18, 0.025, 0.03), iron, [-0.5 + i * 0.33, 1.9 + i * 0.05 - 0.05, -2.02]); }
  for (let i = 0; i < 2; i++) add(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 10), wood, [1.4, 0.43, -1.2 + i * 0.7]);
  add(new THREE.BoxGeometry(0.7, 0.55, 0.6), wood, [-1.4, 0.28, -1.5]);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.75, 0.35).multiplyScalar(4), toneMapped: false }));
  lamp.position.set(0.75, 2.15, -2.05); g.add(lamp);
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
    this.g.scene.add(w); world.addCollider(x, z, 2.0);
    this.spot = { x, z };
  }
  near() { if (!this.spot) return false; const m = this.g.me.pos; return Math.hypot(m.x - this.spot.x, m.z - this.spot.z) < 4.2; }

  update(dt) {
    const g = this.g, I = g.input, me = g.me;
    // the healing draught
    if (this.heal > 0) { const h = Math.min(this.heal, dt * 70 / 3); this.heal -= h; if (!me.downed) me.hp = Math.min(me.maxHp, me.hp + h); }
    if (!this.open && I.pressed('KeyH') && this.a.draughts > 0 && !me.downed && me.hp < me.maxHp && this.heal <= 0) {
      this.a.draughts--; saveArmoury(this.a); this.heal = 70; g.audio.holy?.(me.pos, 0.3); g.fx.holyMotes(me.pos.clone().setY(me.pos.y + 1.2), 0.6, 6); this.showWallet(true);
    }
    if (this.open && (I.pressed('Escape') || I.pressed('KeyF') || (this.spot && !this.near()))) { this.close(); return; }
    if (!this.open && this.near() && I.pressed('KeyF') && !g.cinema.active) this.show();
  }
  prompt() { return this.near() && !this.open ? '<kbd>F</kbd>Trade with the sutler' : ''; }

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
  dispose() { if (this.wagon) { this.wagon.removeFromParent(); this.wagon.traverse((o) => o.geometry?.dispose?.()); this.wagon = null; } this.spot = null; if (this.open) this.close(); }
}
