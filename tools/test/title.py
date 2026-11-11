# title.py out.jpg [wait_s] : load the game and photograph the title screen as it really looks
import asyncio, sys
from playwright.async_api import async_playwright
from shots import ARGS
async def main():
    out = sys.argv[1]; wait = float(sys.argv[2]) if len(sys.argv) > 2 else 8
    for t in range(3):
        try:
            async with async_playwright() as p:
                b = await p.chromium.launch(args=ARGS); pg = await b.new_page(viewport={'width': 1280, 'height': 720})
                pg.on('pageerror', lambda e: print('PAGEERROR', str(e)[:400], flush=True))
                pg.on('console', lambda m: print('CONSOLE', m.type, m.text[:300], flush=True) if m.type in ('error', 'warning') else None)
                await pg.add_init_script("try{localStorage.setItem('evil.settings', JSON.stringify({quality:'medium'}))}catch(e){}")
                await pg.goto('http://localhost:7797/'); await pg.wait_for_selector('#title.show', timeout=300000)
                await asyncio.sleep(wait)
                import base64
                r = await pg.evaluate("() => { const e = __app.engine; e.render(0.016); return e.renderer.domElement.toDataURL('image/jpeg', 0.88); }")
                open(out, 'wb').write(base64.b64decode(r.split(',', 1)[1])); print('saved', out); await b.close(); return
        except Exception as e: print('retry', t, str(e)[:200])
asyncio.run(main())
