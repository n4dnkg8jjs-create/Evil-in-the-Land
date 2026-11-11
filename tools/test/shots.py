# One-shot: start a solo game on the real engine, simulate headless, render chosen frames to JPG.
import asyncio, base64, sys
from playwright.async_api import async_playwright
ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
URL = 'http://localhost:7797/'
QUAL = sys.argv[1] if len(sys.argv) > 1 else 'medium'
SETUP = """async () => { const app = __app; app.hold = () => {}; app.engine.headless = true;
document.getElementById('btnSolo').click(); await new Promise(r => setTimeout(r, 300));
document.getElementById('optAI').value = (window.__ai || '1'); document.getElementById('btnStart').click();
for (let i = 0; i < 600 && !app.game; i++) await new Promise(r => setTimeout(r, 100));
const g = app.game;
window.__sim = (sec) => { const n = Math.round(sec * 30); for (let i = 0; i < n; i++) { if (g.cinema.active) g.cinema.finish(); g.update(1 / 30); } };
window.__shot = () => { app.engine.headless = false; g.update(1 / 60); const u = app.engine.renderer.domElement.toDataURL('image/jpeg', 0.88); app.engine.headless = true; return u; };
__sim(3); return [g.me.pos.x, g.me.pos.z]; }"""
STEPS = [
 ('w_back', "g.cam.targetDist = 5.5; g.cam.yaw = Math.PI - 0.09; g.cam.pitch = -0.04; __sim(1.5);"),
 ('w_ahead', "g.cam.yaw = -0.04; g.cam.pitch = -0.02; __sim(1.5); g.world.vista.strike(); g.update(1/30);"),
 ('w_side', "g.cam.yaw = 0.7; g.cam.pitch = 0.05; __sim(1);"),
 ('fight1', """g.loadChapter(2, { skipIntro: true }); __sim(1.5); const a = g.world.altars[0];
   g.me.pos.set(a.x + 2, g.world.heightAt(a.x + 2, a.z), a.z);
   dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); __sim(5); dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })); __sim(3);
   window.__aim = () => { let best = null, bd = 1e9; for (const d of g.horde.list) { if (!d.alive) continue; const q = (d.pos.x - g.me.pos.x) ** 2 + (d.pos.z - g.me.pos.z) ** 2; if (q < bd) { bd = q; best = d; } }
     if (best) g.cam.yaw = Math.atan2(best.pos.x - g.me.pos.x, best.pos.z - g.me.pos.z); };
   __aim(); g.cam.pitch = 0.08; g.cam.targetDist = 4.5; __sim(0.6);"""),
 ('fight2', "g.me.tryAttack(false); __sim(0.25);"),
 ('fight3', "__sim(2.5); __aim(); __sim(0.3);"),
]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:400]))
        await pg.add_init_script("try{localStorage.setItem('evil.settings', JSON.stringify({quality:'" + QUAL + "'}))}catch(e){}")
        await pg.goto(URL); await pg.wait_for_selector('#title.show', timeout=300000)
        print('start', await pg.evaluate(SETUP), flush=True)
        for name, js in STEPS:
            u = await pg.evaluate("() => { const app = __app, g = app.game; " + js + " return __shot(); }")
            open(f'shots/{name}.jpg', 'wb').write(base64.b64decode(u.split(',', 1)[1]))
            print('saved', name, 'errs', errs[-3:], flush=True)
        await b.close()
if __name__ == "__main__": asyncio.run(main())
