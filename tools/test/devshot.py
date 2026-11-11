# devshot.py file.js out.jpg : open the bare dev page and run file.js (an async function body returning a data URL)
import asyncio, base64, sys
from playwright.async_api import async_playwright
from shots import ARGS
async def main():
    js = open(sys.argv[1]).read(); out = sys.argv[2]
    for t in range(3):
        try:
            async with async_playwright() as p:
                b = await p.chromium.launch(args=ARGS); pg = await b.new_page(viewport={'width': 960, 'height': 540})
                pg.on('pageerror', lambda e: print('PAGEERROR', str(e)[:300], flush=True)); pg.on('console', lambda m: print('CONSOLE', m.type, m.text[:600], flush=True) if m.type in ('error', 'warning') else None)
                await pg.goto('http://localhost:7797/dev.html'); await pg.wait_for_function('window.devReady === true', timeout=60000)
                r = await pg.evaluate("async () => { const THREE = window.THREE, R = window.R; " + js + "\n}")
                (open(out, 'wb').write(base64.b64decode(r.split(',', 1)[1])) if len(r) > 6 else None); print('saved', out); await b.close(); return
        except Exception as e: print('retry', t, str(e)[:160])
asyncio.run(main())
