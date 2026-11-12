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
    this.goal = null;
    const inp = this.decide(dt, G);
    this.navigate(inp, dt, G);
    return inp;
  }
  // Getting round what is solid (fences, houses, the churchyard): where the way to the goal is blocked, a path
  // round (world.findPath, a grid search over the colliders) is followed; where something is just ahead, the
  // step turns aside; and one stuck for long, far from the leader, with no way round, rejoins him out of sight.
  navigate(inp, dt, G) {
    const k = this.k, W = G.world, now = G.time || 0;
    if (!W || !W.solidAt || k.downed) return;
    const N = this.nav || (this.nav = { t: 0, px: k.pos.x, pz: k.pos.z, stuck: 0, path: null, pi: 0, pathT: -99, losT: 0, failT: -99, side: 1, gx: 0, gz: 0 });
    let m = Math.hypot(inp.mx, inp.mz);
    if (m < 0.1 || inp.pray || k.action) { N.stuck = 0; N.t = 0; N.px = k.pos.x; N.pz = k.pos.z; return; }
    let g = this.goal;
    // a goal inside something (the place behind the leader falls in a house): the nearest free ground to it
    if (g && W.solidAt(g[0], g[1], 0.46)) {
      let f = null; for (let r = 0.8; r <= 4.8 && !f; r += 0.8) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, x = g[0] + Math.cos(a) * r, z = g[1] + Math.sin(a) * r; if (!W.solidAt(x, z, 0.5)) { f = [x, z]; break; } }
      if (f) { g = f; const dx = g[0] - k.pos.x, dz = g[1] - k.pos.z, l = Math.hypot(dx, dz); if (l > 0.5) { inp.mx = dx / l * m; inp.mz = dz / l * m; } }
    }
    if (N.path && (!g || Math.hypot(g[0] - N.gx, g[1] - N.gz) > 4 || now > N.pathT + 8)) N.path = null;
    if (g && !N.path && now > N.failT + 3 && Math.hypot(g[0] - k.pos.x, g[1] - k.pos.z) > 1.5) {
      let blocked = N.stuck > 0.8;
      if (!blocked && now >= N.losT) { N.losT = now + 0.6; blocked = !W.clearLine(k.pos.x, k.pos.z, g[0], g[1], 0.44); }
      if (blocked) {
        N.path = W.findPath(k.pos.x, k.pos.z, g[0], g[1], 0.46); N.pi = 1; N.gx = g[0]; N.gz = g[1]; N.pathT = now; N.stuck = 0;
        if (!N.path) N.failT = now;
      }
    }
    if (N.path) {
      const P = N.path; while (N.pi < P.length - 1 && Math.hypot(P[N.pi][0] - k.pos.x, P[N.pi][1] - k.pos.z) < 0.8) N.pi++;
      const q = P[N.pi], dx = q[0] - k.pos.x, dz = q[1] - k.pos.z, l = Math.hypot(dx, dz);
      if (N.pi >= P.length - 1 && l < 0.8) N.path = null;
      else if (l > 1e-3) { inp.mx = dx / l * m; inp.mz = dz / l * m; }
    }
    // something just ahead: turn aside, to the side that went last time first
    const dx = inp.mx / m, dz = inp.mz / m;
    if (W.solidAt(k.pos.x + dx * 0.8, k.pos.z + dz * 0.8, 0.4)) {
      for (const a of [0.45, 0.9, 1.35, 1.8]) {
        let hit = false;
        for (const sd of [N.side, -N.side]) {
          const c = Math.cos(a * sd), s = Math.sin(a * sd), rx = dx * c + dz * s, rz = -dx * s + dz * c;
          if (!W.solidAt(k.pos.x + rx * 0.8, k.pos.z + rz * 0.8, 0.4)) { inp.mx = rx * m; inp.mz = rz * m; N.side = sd; hit = true; break; }
        }
        if (hit) break;
      }
    }
    // progress: has it got anywhere in the last half second?
    N.t += dt;
    if (N.t >= 0.5) { const moved = Math.hypot(k.pos.x - N.px, k.pos.z - N.pz); N.stuck = moved < 0.35 ? N.stuck + N.t : 0; N.px = k.pos.x; N.pz = k.pos.z; N.t = 0; }
    const lead = G.leader?.();
    if (N.stuck > 7 && lead && lead !== k && Math.hypot(lead.pos.x - k.pos.x, lead.pos.z - k.pos.z) > 18) {
      for (let i = 0; i < 12; i++) {
        const a = lead.yaw + Math.PI + (i - 5.5) * 0.4, x = lead.pos.x + Math.sin(a) * 5, z = lead.pos.z + Math.cos(a) * 5;
        if (!W.solidAt(x, z, 0.6) && W.clearLine(lead.pos.x, lead.pos.z, x, z, 0.44)) { k.pos.x = x; k.pos.z = z; k._cx = undefined; N.stuck = 0; N.path = null; break; }
      }
    }
  }
  decide(dt, G) {
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
      this.goal = l > stopAt ? [x, z] : null;
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
