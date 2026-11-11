g.loadChapter(5, { skipIntro: true }); __sim(1); return 'cave ' + !!g.cave + ' plan ' + !!g.world.caveSys;
----
// walk the Ascent's cave along its line at a brisk walk, the game running; list what He did, and anything amiss
const w = g.world, S = w.caveSys, C = g.cave, me = g.me, out = { fired: [], pushes: 0, maxPush: 0, err: null, demonsIn: 0, deadAt: [], comp: [] };
C.takeTorch(); let last = null, t0 = performance.now(), frames = 0;
try {
  for (let s = S.sA - 6; s < S.sB + 4; s += 4.2 / 30) {
    const F = S.mainAt(s); me.pos.set(F.x, w.heightAt(F.x, F.z), F.z); me.yaw = Math.atan2(F.tx, F.tz); if (g.cam) g.cam.yaw = me.yaw;
    g.update(1 / 30); frames++;
    const d = Math.hypot(me.pos.x - F.x, me.pos.z - F.z); if (d > 0.05) { out.pushes++; out.maxPush = Math.max(out.maxPush, +d.toFixed(2)); }
    const k = C.act?.kind || null; if (k !== last) { if (k) out.fired.push(k + '@' + Math.round(s)); last = k; }
    if (C.inside) for (const dm of g.horde.list) if (dm.alive && w.inCaveZone(dm.pos.x, dm.pos.z, 0)) out.demonsIn++;
    if (C.deadAt !== out.lastDead) { out.lastDead = C.deadAt; out.deadAt.push(C.deadAt + '@' + Math.round(s)); }
    if (frames % 90 === 0) out.comp.push(g.knightList.filter((k2) => k2 !== me).map((k2) => Math.round(Math.hypot(k2.pos.x - me.pos.x, k2.pos.z - me.pos.z))).join('/'));
  }
} catch (e) { out.err = String(e.stack || e).slice(0, 500); }
out.nDead = C.dead.length; out.msPerFrame = +((performance.now() - t0) / frames).toFixed(1); out.done = Object.keys(C.done); out.limb = C.limb.state; out.inCamEnd = +C.inCam.toFixed(2);
return out;
