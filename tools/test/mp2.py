# two separate browsers: A hosts (peer to peer), B joins by code; checks lobby, start, sync, disconnect
import asyncio, json, sys
from playwright.async_api import async_playwright
from shots import ARGS
URL = 'http://localhost:7797/'
STAGE = sys.argv[1] if len(sys.argv) > 1 else 'all'

def hook(pg, tag):
    pg.on('pageerror', lambda e: print(tag, 'PAGEERROR', str(e)[:300], flush=True))
    pg.on('console', lambda m: print(tag, m.type, m.text[:200], flush=True) if m.type in ('error', 'warning') and 'GL_' not in m.text and 'WebGL' not in m.text else None)

async def wait(pg, js, t=60):
    for _ in range(int(t * 4)):
        r = await pg.evaluate(js)
        if r: return r
        await asyncio.sleep(0.25)
    raise Exception('timeout: ' + js)

async def main():
    async with async_playwright() as p:
        ba = await p.chromium.launch(args=ARGS); bb = await p.chromium.launch(args=ARGS)
        A = await (await ba.new_context(viewport={'width': 480, 'height': 270})).new_page(); hook(A, 'A')
        B = await (await bb.new_context(viewport={'width': 480, 'height': 270})).new_page(); hook(B, 'B')
        for pg in (A, B): await pg.add_init_script("try{localStorage.setItem('evil.deviceSettings', JSON.stringify({quality:'low'}))}catch(e){}")
        await A.goto(URL + '?nointro'); await A.wait_for_selector('#title.show', timeout=300000)
        # profile flow on A: create a second profile with a PIN, sign out to it, sign back in
        print('A profile', await A.evaluate("""async () => {
          document.getElementById('btnProfile').click(); await new Promise(r => setTimeout(r, 300));
          const onProfiles = __app.ui.current;
          document.getElementById('newName').value = 'Sir Aldric'; document.getElementById('newPin').value = '1234';
          document.getElementById('newGo').click(); await new Promise(r => setTimeout(r, 500));
          const after = [__app.ui.current, __app.name, document.getElementById('profName').textContent];
          __account.set('evil.armoury', { silver: 999, owned: ['longsword','mace','pike','halberd'], up: {}, draughts: 2 });
          await __account.save();
          // switch away and back: PIN needed
          const list = await __account.list(); const tester = list.find(p => p.name === 'Tester'), al = list.find(p => p.name === 'Sir Aldric');
          await __app.pickProfile(tester.id); const t1 = __app.name;
          document.getElementById('btnProfile').click(); await new Promise(r => setTimeout(r, 300));
          await __app.pickProfile(al.id); const pinShown = !document.getElementById('pinBox').hidden;
          document.getElementById('pinInput').value = '9999'; document.getElementById('pinGo').click(); await new Promise(r => setTimeout(r, 300));
          const wrong = document.getElementById('profErr').textContent;
          document.getElementById('pinInput').value = '1234'; document.getElementById('pinGo').click(); await new Promise(r => setTimeout(r, 300));
          return { onProfiles, after, t1, pinShown, wrong, now: __app.name, silver: __account.load().armoury.silver, weapons: [...document.getElementById('loWeapon').options].map(o => o.value) };
        }"""), flush=True)
        await A.evaluate("document.getElementById('btnHost').click()")
        code = await wait(A, "(() => { const c = __app.net.code; return __app.ui.current === 'lobby' && c && c.length === 5 ? c : (document.getElementById('titleErr').textContent.includes('Could') ? 'ERR:' + document.getElementById('titleErr').textContent : null); })()", 40)
        print('A hosted', code, await A.evaluate("__app.net.mode"), flush=True)
        if code.startswith('ERR'): return
        await B.goto(URL + '?nointro&join=' + code)
        await wait(B, "__app.ui.current === 'lobby' || (document.getElementById('joinErr').textContent.length > 0 && !document.getElementById('joinErr').textContent.startsWith('Finding'))", 300)
        print('B', await B.evaluate("({ screen: __app.ui.current, err: document.getElementById('joinErr').textContent, id: __app.net.id, players: __app.net.players })"), flush=True)
        await wait(A, "document.querySelectorAll('#partyList li:not(.empty)').length === 2", 20)
        print('A party', await A.evaluate("[...document.querySelectorAll('#partyList li')].map(l => l.textContent.replace(/\\s+/g, ' ').trim())"), flush=True)
        print('B party', await B.evaluate("[...document.querySelectorAll('#partyList li')].map(l => l.textContent.replace(/\\s+/g, ' ').trim())"), flush=True)
        await B.evaluate("document.getElementById('btnReady').click()")
        await wait(A, "!document.getElementById('btnStart').disabled", 10)
        if STAGE == 'lobby':
            await A.evaluate("document.getElementById('btnLeave').click()")
            await asyncio.sleep(2)
            print('B after host left', await B.evaluate("({ screen: __app.ui.current, msg: document.getElementById('titleErr').textContent })"), flush=True)
            return
        await A.evaluate("document.getElementById('optAI').value = '3'; document.getElementById('optChapter').value = '0'; document.getElementById('btnStart').click()")
        await wait(A, "!!__app.game", 120); await wait(B, "!!__app.game", 120)
        print('started', flush=True)
        info = """(() => { const g = __app.game; return { me: g.meId, knights: [...g.knights.values()].map(k => [k.id, k.name, k.isAI ? 'ai' : 'human']), companions: g.companions.length, demons: g.horde.list.length, ch: g.chapterIdx }; })()"""
        print('A game', await A.evaluate(info), flush=True)
        print('B game', await B.evaluate(info), flush=True)
        await asyncio.sleep(6)
        # inputs: B walks forward, A walks forward; each should see the other move
        st = "(id) => { const k = __app.game.knights.get(id); return [k.pos.x.toFixed(2), k.pos.z.toFixed(2), !!k.netS]; }"
        a0 = await A.evaluate(f"({st})(2)"); b0 = await B.evaluate(f"({st})(1)")
        print('cinema', await A.evaluate("__app.game.cinema.active"), await B.evaluate("__app.game.cinema.active"), flush=True)
        # each side shoves its own knight 4 m along x; the other side must see it arrive
        await B.evaluate("(() => { const k = __app.game.me; k.pos.x += 4; })()"); await A.evaluate("(() => { const k = __app.game.me; k.pos.z += 4; })()")
        await asyncio.sleep(3)
        a1 = await A.evaluate(f"({st})(2)"); b1 = await B.evaluate(f"({st})(1)")
        print('A sees B', a0, '->', a1, '| B sees A', b0, '->', b1, flush=True)
        print('B own', await B.evaluate(f"({st})(2)"), 'A own', await A.evaluate(f"({st})(1)"), flush=True)
        print('B snap demons', await B.evaluate("__app.game.horde.list.length"), 'A', await A.evaluate("__app.game.horde.list.length"), flush=True)
        # B drops out: its knight passes to a companion on A
        await B.close(); await bb.close()
        await asyncio.sleep(3)
        print('A after B left', await A.evaluate(info), flush=True)
        await ba.close()

asyncio.run(main())
