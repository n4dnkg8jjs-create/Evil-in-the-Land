import asyncio, sys
from playwright.async_api import async_playwright
ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:7797/'


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:800]))
        pg.on('console', lambda m: errs.append(m.type + ' ' + m.text[:600]) if m.type in ('error', 'warning') else None)
        await pg.goto(URL)
        ok = False; msg = ''
        for i in range(80):
            await asyncio.sleep(3)
            ok = await pg.evaluate("() => !!document.querySelector('#title.show')")
            msg = await pg.evaluate("() => document.getElementById('bootMsg')?.textContent")
            if ok or any('PAGEERROR' in e or 'error' in e for e in errs):
                break
        print('title', ok, 'msg', msg, 'secs', (i + 1) * 3)
        print('\n'.join(errs[:12]))
        await b.close()

asyncio.run(main())
