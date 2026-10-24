// Companion knights for empty lobby slots. They fight, guard whoever is
// praying, kneel at the altar themselves, and raise fallen brothers.
import { angleDiff, clamp } from './util.js';

const REACH = { longsword: 2.0, zweihander: 2.5, mace: 1.6, halberd: 2.6, pike: 3.4, pollaxe: 2.2 };

export class Companion {
  constructor(knight, role) {
    this.k = knight; this.role = role; // 0..3; even roles favour prayer, odd roles guard
    this.react = 0; this.combo = 0; this.attackT = 0; this.thinkT = 0; this.goal = null; this.target = null; this.strafeSign = Math.random() < 0.5 ? -1 : 1;
  }
  // returns an input object for Knight.simulate
  think(dt, G) {
    const k = this.k; const inp = { mx: 0, mz: 0, aimYaw: k.yaw, sprint: false, block: false, pray: false, attack: false, heavy: false, dodge: false, relic: false };
    if (k.downed) return inp;
    this.thinkT -= dt; this.attackT -= dt;
    const demons = G.horde.list;
    // nearest threat
    let nearest = null, nd = 1e9;
    for (const d of demons) { if (!d.alive || d.state === 0) continue; const dd = Math.hypot(d.pos.x - k.pos.x, d.pos.z - k.pos.z); if (dd < nd) { nd = dd; nearest = d; } }
    const boss = G.boss && G.boss.alive ? G.boss : null;
    const moveTo = (x, z, stopAt = 1.2, run = false) => {
      const dx = x - k.pos.x, dz = z - k.pos.z; const l = Math.hypot(dx, dz);
      if (l > stopAt) { inp.mx = dx / l; inp.mz = dz / l; inp.sprint = run && l > 10 && k.stamina > 30; }
      return l;
    };
    const fight = (tx, tz, reachMul = 1, isBoss = false) => {
      const reach = (REACH[k.loadout.weapon] || 2) * reachMul + (isBoss ? 2.5 : 0.4);
      const dx = tx - k.pos.x, dz = tz - k.pos.z; const l = Math.hypot(dx, dz);
      inp.aimYaw = Math.atan2(dx, dz);
      if (l > reach) moveTo(tx, tz, reach * 0.9, l > 8);
      else if (l < reach * 0.5) { inp.mx = -dx / l; inp.mz = -dz / l; }
      else { inp.mx = -dz / l * this.strafeSign * 0.4; inp.mz = dx / l * this.strafeSign * 0.4; }
      if (l <= reach * 1.1 && this.attackT <= 0 && k.stamina > 15) {
        if (Math.random() < 0.18 && k.stamina > 45) inp.heavy = true; else inp.attack = true;
        this.attackT = 0.25 + Math.random() * 0.3; this.combo++;
        if (this.combo > 3) { this.combo = 0; this.attackT = 0.9 + Math.random() * 0.6; this.strafeSign *= -1; }
      }
      return l;
    };
    // 1) raise a fallen brother
    const fallen = G.knightList.filter((o) => o !== k && o.downed).sort((a, b) => a.pos.distanceTo(k.pos) - b.pos.distanceTo(k.pos))[0];
    if (fallen && fallen.pos.distanceTo(k.pos) < 40 && nd > 3.5) {
      const l = moveTo(fallen.pos.x, fallen.pos.z, 1.6, true);
      if (l < 2.2) { inp.pray = true; inp.mx = 0; inp.mz = 0; }
      return inp;
    }
    // react to danger: block a winding-up attacker, roll away from a swelling husk
    if (nearest && nd < 4.5) {
      if (nearest.type === 'husk' && nearest.state === 7) { const dx = k.pos.x - nearest.pos.x, dz = k.pos.z - nearest.pos.z; const l = Math.hypot(dx, dz) || 1; inp.mx = dx / l; inp.mz = dz / l; if (Math.random() < dt * 4) inp.dodge = true; return inp; }
      if (nearest.state === 2 && k.stamina > 30 && Math.random() < 0.6) { this.react += dt; if (this.react > 0.18) { inp.block = true; inp.aimYaw = Math.atan2(nearest.pos.x - k.pos.x, nearest.pos.z - k.pos.z); } }
      else this.react = 0;
    }
    if (boss) {
      // wards (dragon in flight): go and pray
      const ward = G.activeWard?.();
      if (ward && (this.role % 2 === 0 || !nearest || nd > 8)) { const l = moveTo(ward.x, ward.z, 2.5, true); if (l < 5) { inp.pray = true; inp.mx = inp.mz = 0; } return inp; }
      const bd = Math.hypot(boss.pos.x - k.pos.x, boss.pos.z - k.pos.z);
      // avoid the dragon's breath and tail
      if (['breath', 'tail', 'stomp', 'pounce', 'strike'].includes(boss.state) && bd < 12 && boss.t < 1.2 && Math.random() < dt * 3) { inp.dodge = true; const a = Math.atan2(k.pos.x - boss.pos.x, k.pos.z - boss.pos.z) + this.strafeSign * 0.9; inp.mx = Math.sin(a); inp.mz = Math.cos(a); return inp; }
      if (nearest && nd < 5) { fight(nearest.pos.x, nearest.pos.z); return inp; }
      if ((boss.alt || 0) < 4) fight(boss.pos.x, boss.pos.z, 1, true);
      else moveTo(boss.pos.x, boss.pos.z, 9);
      if (k.relicCd <= 0 && bd < 10 && Math.random() < dt * 0.3) inp.relic = true;
      return inp;
    }
    const altar = G.currentAltar();
    if (altar && altar.state === 'active') {
      const dA = Math.hypot(altar.x - k.pos.x, altar.z - k.pos.z);
      const prayers = G.knightList.filter((o) => o.praying).length;
      const guard = this.role % 2 === 1 && prayers > 0;
      const threatNearAltar = nearest && Math.hypot(nearest.pos.x - altar.x, nearest.pos.z - altar.z) < 9;
      if (!guard && (!threatNearAltar || nd > 5)) {
        const ang = this.role * 1.6; const px = altar.x + Math.cos(ang) * 3.5, pz = altar.z + Math.sin(ang) * 3.5;
        const l = moveTo(px, pz, 0.8, true);
        if (l < 1.5) { inp.pray = true; inp.mx = inp.mz = 0; inp.aimYaw = Math.atan2(altar.x - k.pos.x, altar.z - k.pos.z); }
        return inp;
      }
      if (nearest && (nd < 14 || threatNearAltar)) { fight(nearest.pos.x, nearest.pos.z); if (k.relicCd <= 0 && nd < 6 && G.horde.aliveCount > 6 && Math.random() < dt * 0.4) inp.relic = true; return inp; }
      moveTo(altar.x, altar.z, 5);
      return inp;
    }
    // travelling: fight what's near, otherwise follow the party leader
    if (nearest && nd < 12) { fight(nearest.pos.x, nearest.pos.z); if (k.relicCd <= 0 && G.horde.aliveCount > 8 && nd < 6 && Math.random() < dt * 0.3) inp.relic = true; return inp; }
    const leader = G.leader();
    if (leader && leader !== k) {
      const a = leader.yaw + Math.PI + (this.role - 1.5) * 0.7; const tx = leader.pos.x + Math.sin(a) * 4.5, tz = leader.pos.z + Math.cos(a) * 4.5;
      const l = moveTo(tx, tz, 1.5, true); if (l < 3) { inp.mx *= 0.3; inp.mz *= 0.3; }
      inp.aimYaw = leader.yaw;
    } else if (altar) moveTo(altar.x, altar.z, 3, true);
    return inp;
  }
}
