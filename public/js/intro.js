// The opening, played once before the title: black; a bolt over the mountain and the thunder of it; the camera
// comes down out of the storm over the dead land and the horde to the five before the altar in its light; a line
// of the Latin; the name forms; and the menu comes up under it. Any key or click skips it. After the first time it
// is skipped by itself (and for links that go straight to a lobby, and for automated test browsers).
import { esc } from './ui.js';

const SEEN = 'evil.introSeen';
const TITLE = 'Evil in the Land';
const LATIN = ['Libera nos a malo.', 'Deliver us from evil.'];

export function introWanted() {
  const q = new URLSearchParams(location.search);
  if (q.has('intro')) return true;
  if (q.has('nointro') || q.has('host') || q.has('join') || navigator.webdriver) return false;
  try { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch {}
  try { return !localStorage.getItem(SEEN); } catch { return true; }
}
function markSeen() { try { localStorage.setItem(SEEN, '1'); } catch {} }

// stage: the MenuStage; audio: the AudioEngine; ui: the UI; onTitle: shows the title screen (called once, as the menu comes up)
export function playIntro({ stage, audio, ui, onTitle }) {
  return new Promise((resolve) => {
    const boot = document.getElementById('boot'), msg = document.getElementById('bootMsg');
    // sound may only start after a gesture, and the thunder is half of it: so first, "press any key"
    boot.classList.add('gate'); msg.textContent = 'Press any key to begin';
    const gate = (e) => {
      if (e.type === 'keydown' && (e.repeat || ['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key))) return;
      removeEventListener('keydown', gate, true); removeEventListener('pointerdown', gate, true);
      try { audio.init(); } catch {}
      boot.classList.remove('gate');
      run();
    };
    addEventListener('keydown', gate, true); addEventListener('pointerdown', gate, true);

    function run() {
      const V = stage.world.vista;
      const el = document.createElement('div'); el.id = 'intro'; el.className = 'intro';
      el.innerHTML = `<i class="intro-bar top"></i><i class="intro-bar bot"></i><div class="intro-flash"></div>
        <div class="intro-line"><span class="la">${esc(LATIN[0])}</span><span class="tr">${esc(LATIN[1])}</span></div>
        <h1 class="title big intro-title" aria-label="${TITLE}">${[...TITLE].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}</h1>
        <div class="intro-black"></div><div class="intro-skip">Press any key to skip</div>`;
      document.body.appendChild(el);
      const $ = (s) => el.querySelector(s);
      ui.show(null);
      stage.intro = { u: 0, drift: 0 };
      const keepStrike = V ? V.nextStrike : 0; if (V) V.nextStrike = 1e9;   // the storm waits for its cue
      const t0 = performance.now(); let rev = -1, done = false, raf = 0, titled = false;
      const cues = new Set(), once = (k, r, fn) => { if (rev >= 0 && r >= 0 && !cues.has(k) && (performance.now() - rev) / 1000 >= r) { cues.add(k); fn(); } };
      const strike = (thunder, strength) => {
        if (!V) return;
        const keep = V.onThunder; if (!thunder) V.onThunder = null;
        try { V.strike(); } catch {} V.onThunder = keep;
        if (thunder) return;
        try { audio.thunder(strength, 0.06); } catch {}
        const f = $('.intro-flash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      };
      const thunderReady = () => !!(audio.lib && audio.lib.thunderNear && audio.lib.thunderNear.length);
      const frame = () => {
        if (done) return;
        const now = performance.now(), t = (now - t0) / 1000;
        // black until the thunder is loaded (at least a beat of it; never more than a few seconds)
        if (rev < 0 && t > 1.1 && (thunderReady() || t > 3.2)) {
          rev = now; strike(false, 1.5);
          const b = $('.intro-black'); b.style.transition = 'none'; b.style.opacity = '0.45'; void b.offsetWidth; b.style.transition = 'opacity 2.6s cubic-bezier(.3,.6,.4,1)'; b.style.opacity = '0';
        }
        if (rev >= 0) {
          const r = typeof window.__introAt === 'number' ? window.__introAt : (now - rev) / 1000;   // (tests can pin the clock)
          stage.intro.drift = Math.min(r, 2.2);
          const k = Math.min(1, Math.max(0, (r - 1.6) / 9.2));
          stage.intro.u = k * k * (3 - 2 * k);
          once('latin', 2.2, () => $('.intro-line').classList.add('show'));
          once('second', 5.0, () => strike(true));
          once('latinOut', 6.8, () => $('.intro-line').classList.remove('show'));
          once('title', 8.2, () => $('.intro-title').classList.add('show'));
          once('third', 9.0, () => strike(false, 0.9));
          once('menu', 11.0, () => toMenu());
          once('end', 12.4, () => finish(false));
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      // the name flies to its place on the title screen as the menu comes up round it
      const toMenu = () => {
        if (titled) return; titled = true;
        el.classList.add('out');
        const scr = document.getElementById('title'); scr.classList.add('arriving');
        onTitle();
        const dst = scr.querySelector('.title.big'), src = $('.intro-title');
        if (!scr.classList.contains('show')) { try { src.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }); } catch {} }   // something else came up first (choosing a profile)
        else if (dst && src) {
          dst.style.visibility = 'hidden';
          const box = (n) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect(); };   // the letters, not the block
          const a = box(src), b = box(dst);
          const s = b.height / Math.max(1, a.height);
          const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
          try { src.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], { duration: 1300, easing: 'cubic-bezier(.6,0,.25,1)', fill: 'forwards' }); } catch {}
        }
        requestAnimationFrame(() => scr.classList.remove('arriving'));
      };
      const finish = (skipped) => {
        if (done) return; done = true; cancelAnimationFrame(raf);
        removeEventListener('keydown', skip, true); removeEventListener('pointerdown', skip, true);
        if (V) V.nextStrike = Math.max(2, keepStrike);
        markSeen();
        const end = () => {
          stage.intro = null; stage.snapped = false;   // on its own pose already, unless frames are slow: then cut to it
          const dst = document.querySelector('#title .title.big'); if (dst) dst.style.visibility = '';
          el.remove(); resolve();
        };
        if (!skipped) { end(); return; }
        // skipped: a quick dip to black, cut to the title, and up again
        const b = $('.intro-black'); b.style.transition = 'opacity 0.25s'; b.style.opacity = '1';
        setTimeout(() => {
          stage.intro = null; stage.snapped = false;
          if (!titled) { titled = true; onTitle(); }
          const dst = document.querySelector('#title .title.big'); if (dst) dst.style.visibility = '';
          for (const n of el.children) if (!n.classList.contains('intro-black')) n.remove();
          b.style.transition = 'opacity 0.7s'; b.style.opacity = '0';
          setTimeout(() => { el.remove(); resolve(); }, 750);
        }, 260);
      };
      const skip = (e) => {
        if ((performance.now() - t0) < 500) return;
        if (e.type === 'keydown' && e.repeat) return;
        if (titled) { finish(false); return; }   // the menu is already up: let the click through to it
        e.preventDefault(); e.stopPropagation();
        finish(true);
      };
      addEventListener('keydown', skip, true); addEventListener('pointerdown', skip, true);
    }
  });
}
