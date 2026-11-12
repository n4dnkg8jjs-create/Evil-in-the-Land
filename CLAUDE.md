# Evil in the Land — continuation sheet for Claude

Read this before touching anything. It is the handoff from the previous long Claude session that built most of this
game with the owner. `README.md` is the player-facing manual; this file is for you.

## What this is

A cooperative 3D action-horror game played in the browser. It's set in German lands in 1523. One to five knights in
Gothic plate fight a demonic horde, kneel at blighted altars to pray while the others hold the line, and heal the land
over seven chapters, from the Vale of Ashes to the Peak, where the Devil waits.

- **Live:** https://n4dnkg8jjs-create.github.io/Evil-in-the-Land/ (GitHub Pages serves the repo root; the root
  `index.html` redirects into `public/`).
- **Repo:** github.com/n4dnkg8jjs-create/Evil-in-the-Land, branch `main`. **Pushing to `main` deploys**, usually
  within 1–2 minutes. The branch `wip-round-8` is an old scratch branch for unfinished snapshots; ignore it.
- **Stack:** Three.js r160 as plain ES modules, loaded from a CDN by the import map in `public/index.html`, with no
  build step and no bundler. Plain JS, HTML and CSS. `server.js` is an optional local Node server (see Running).
- **Size:** about 20,600 lines across `public/js/*.js`.

## The owner, and how to work with them

- **Wants:** scary, realistic, period-accurate (16th-century Landsknecht era), and continually improving. They judge
  by looking at the game and are exacting about visual quality: "way worse than the other models" is a real complaint.
- **Impatient:**
  - Start working in your first reply; don't ask permission for clear requests.
  - Keep testing to basic checks. They said "Are you just testing? I can do that myself."
  - Send few pictures, only the ones that show the result.
- **Honesty:** never claim something works or looks good unless you checked it. Say plainly what you didn't verify.
  When they say something looks bad, look at it critically yourself before defending it; they are usually right.
- **Ship:** commit and push to `main` when a piece of work is done, so they can test on the live site. Tell them in a
  few lines what changed and what's unverified.
- **Commit messages:** descriptive. The previous session ended them with Claude attribution trailers. Use whatever
  attribution your current environment specifies.
- **Parallel work:** it's fine to split independent requests across sub-agents. Give each one clear file ownership so
  they don't edit the same functions, and don't commit half-finished work from one while another is mid-edit in the
  same file.
- **Deferred ideas:**
  - Hiding the source code: they decided to upload to itch.io later instead, where a minified or obfuscated build
    could be shipped. Don't add anti-copy tricks unless asked.
  - Real accounts: the plan is a backend later (Supabase or Firebase). See `account.js`.

## Design decisions the owner has made (don't undo these)

- **Demons:**
  - Blood is **black**: spray, splats, pools, weapon stains, stumps and gore. Bone stays pale.
  - **No red around demon eyes.**
  - Severed heads and arms are cut from the demon's *own* skinned mesh (`demons.js`) and must match the attached head
    exactly.
- **The dead:** they never turn their heads to look at you, and they must not float.
- **Scares:** no reliance on red eyes.
- **Grass:**
  - None in water (the Fen).
  - None on the mountain chapters (Ascent, Peak), even when healed. Healing up there makes the place brighter and
    calmer: the ash tint goes, snow stays white and **snow never disappears**, a light shaft appears, the weather calms.
- **The Devil:**
  - A MakeHuman body, no eyebrows, deep face shadows.
  - The hood is one garment with the robe, skinned with a spring "lag" bone.
  - The robe hem rests on the ground.
  - "The Thing on the Ridge" boss *is* the Devil.
  - Cutscene cameras track His real head bone (`game.devilFace()`), and He is moved onto visible ground if terrain
    would hide Him (`placeDevilInView`).
- **Knights:**
  - Gothic sallet: big upper bowl, two-lame plate neck guard (no mail at the back), dark interior, small slit.
  - A MakeHuman face in the visor opening.
  - Mail coif and wool arming cap under the helmet; no bare neck (`coif.js`).
  - Hinged plate gauntlets with three-joint fingers curling around the grip.
- **Title screen:**
  - Five knights close together in a half circle, in the game's real ready stance (not custom poses).
  - Demons rise at the bottom of the screen, more on the left.
  - The wasteland and mountain behind, an altar with a holy light.
  - Choir and organ music.
  - A skippable intro cinematic plays once per browser (`intro.js`).
- **Thunder:** real recordings (`public/audio/sfx`), no rain audible in the samples, louder in the final fight.
- **Economy:**
  - Father Bertram's blessing is a 4-minute buff: +15% damage against demons, dread builds 45% slower, a single
    self-revive.
  - Generous silver; tiered upgrades.
  - Purchase-only relic weapons: Holy Lance 3000, Flamberge of St Michael 2400, Joyeuse 1800, Hammer of St Eligius
    1500.
  - Anything bought sells back for half.
- **Film grain:** soft, refreshed at 24 fps, weighted to the midtones. It must never look like TV static.

## Running and testing

```bash
node server.js                 # http://localhost:7777 ; first run downloads Three.js into ./vendor (needs internet)
PORT=7797 node server.js       # another port
EVIL_VENDOR=/path/to/vendor node server.js   # use an existing vendor folder
```
The live site needs no server. It loads Three from the CDN.

Headless checks use Playwright with Chromium (SwiftShader software GL). The harness is in `tools/test/` and expects
the server on **port 7797**:

| Script | Use |
|---|---|
| `devshot.py file.js out.jpg` | Opens `public/dev.html` (a bare page with `window.THREE` and the renderer `R`), runs the JS body and saves the data URL it returns. Fast. Use it for model and FX renders. Examples: `relics_dev.js` (weapons), `blood_dev.js`, `dead_close.js`, `hood_dev.js`, `bless_dev.js`, `water_dev.js`. |
| `title.py` | Renders the title screen. |
| `bootcheck.py [url]` | Boots the full game and reports errors. |
| `mp2.py` | Two-browser multiplayer test: host, join by code, start, sync, drop. Point `URL` at the live site to test production. |
| `floaters.js`, `cavewalk.js` | Numeric checks: floating props in the village; walking the cave and firing its scares. |

Testing gotchas:
- SwiftShader is very slow (about 1 fps for the full game) and crashes ("Target crashed") on long single
  `evaluate` calls. Step the simulation in short chunks.
- Full-chapter renders of the Ascent can run out of memory. Prefer `dev.html` scenes.
- Frame times in SwiftShader don't reflect a real GPU. Draw calls, triangles and JS time are the useful metrics.
- Serialize browser use if several agents test at once, e.g. `flock /tmp/evil-browser.lock python3 ...`.
- Run `node --check` on every JS file you edit; it's the cheapest sanity check.
- When you verify geometry (floating, gaps, clipping), prefer numeric checks over pictures.

## Architecture (public/js)

**Boot and flow**
- `main.js`: boot, menus, lobby, the main loop, the title stage, pause (losing the pointer lock = pause; P also
  pauses).
- `ui.js`: DOM screens and HUD; keyboard and controller focus navigation.
- `intro.js`: the first-visit cinematic. `?intro` forces it, `?nointro` skips it.
- `menu_scene.js`: the 3D title stage (`MenuStage`), which builds a real `World` for chapter 0.
- `game.js`: the game itself.
  - Chapter flow, prayer and waves, combat resolution, bosses, camera, cutscenes.
  - The multiplayer sync: host snapshots at 15 Hz, `k:ks` knight states, the `o.n` prayer count sent by the host.
  - `checkDevilReveal` and `playOutro` handle the Devil shots.
- `cinema.js`: scripted camera shots. A shot can have `track` + `anchor` (follow a moving target), `trackLook`
  (follow it with the look only) and `ground` (keep the camera above the terrain).
- `chapters.js`: the seven chapters, their altars and palettes. `story.js` holds the First Company lore and lore
  models; `terror.js` and `dread.js` handle fear and scripted scares.

**World**
- `world.js` (largest file): deterministic generation per chapter.
  - Heightfield, `heightAt` and `normalAt`.
  - The blight/life terrain shader: healing, the road painted into the terrain, mountain snow.
  - Props, Saint Aldric's village, altars, colliders, water, the cave plan (`CavePlan`).
- `buildings.js`: the church of Saint Aldric, the houses, barns and burnt wrecks, as real geometry (Fachwerk frames,
  jetties, traceried windows, buttresses, the broach spire). `placeHouse` and `placeChurch` in `world.js` call it.
  It draws its own detail randomness from a generator seeded per lot, so it does not shift the rest of the world.
- `weather.js`: rain, snow, splashes, the water ripple simulation (shared by every water surface), wading wakes, the
  calm near healed ground.
- `vista.js`: the far city and mountain, lightning (`onThunder`).
- `cave.js`: the cave inside the mountain on the Ascent: chambers, tunnels, drips and its scares.
- `battlefield.js` and `bones.js`: the Emperor's fallen army.
- `statue.js`: Our Lady of the Fen.
- `flame.js`: layered fire. `textures.js`: procedural PBR textures on canvas.
- `util.js`: math helpers, the seeded PRNG (mulberry32; the world must be identical for every player) and noise.

**Characters**
- `rig.js`: the knight skeleton.
  - YXZ Euler joints.
  - **+z is forward and +x is the character's LEFT.**
  - Pose blending and analytic two-bone IK.
- `knight.js`: rig, harness and weapon.
  - Locomotion, the combat state machine, prayer, the face via `headOnRig`.
  - `compileClip(clip, st)` is exported. A clip needs `fullBody: true` for the legs to apply.
  - Weapon channel `w {p,d,u}`, left hand `l`, poles `pr`/`pl`.
- `moves.js`: move sets per weapon.
- `armor.js`: the plate harness.
  - Sallet, gauntlets, rivets.
  - The rigid pieces are merged into one skinned mesh per material for performance; see the perf note below.
- `weapons.js`: weapon models, built along +Y with the edge toward +X and y = 0 at the right-hand grip.
  - Helpers `shapedBlade(len, w(t), th(t), opts)`, `sweep(points, r(t))` and `lathe`.
  - Relic weapons: `lance`, `joyeuse`, `flamberge`, `hammer`.
- `body.js`, `people.js`, `coif.js`: MakeHuman-based humans.
  - `PEOPLE`, `personMesh`, `personMat` (uniforms `uFrozen`, `uDead`, `uBrow`, `uShade`, `uAge`), `humanBody`,
    `headOnRig(rig, look, variant)`.
  - The priest Father Bertram and his blessing, done with arm IK.
  - The sutler.
  - The frozen dead: `makeFrozen` with settling, fitted clothing layers, drifts, crucifixes; results are cached.
- `cloth.js`: Verlet cloth, paused while off screen.
- `horse.js`: the draught horse.
- `demons.js`: the horde.
  - Seven kinds, one skinned mesh each.
  - Severing parts from a demon's own mesh, with capped stumps.
  - Black gore.
- `horror.js`: demon skin, eyes, wings and horns; `buildHumanDevil` / `dressDevil`; robe planting and the hood
  spring in `tickRobes`.
- `devil.js`: the Watcher (crawl, stare), the Old Serpent boss, the Devil boss on the Ridge, the dragon
  (`dragon_model.js`).
- `ai.js`: companion knights.

**Systems**
- `engine.js`: the renderer, post grade (vignette, grain, fringe, tints), sky, lights and the `QUALITY` presets
  (low/medium/high). The shader-error check is off for speed; `?glcheck` turns it back on.
- `fx.js`: particles, trails, flashes, and the `Blood` system.
  - Droplets, splats and pools: instanced, capped, lower on low quality.
  - `fx.blood(pos, dir, sweep, power, ground, kind)` and `corpsePool`. `bloodyWeapon` stains the weapon.
- `batch.js`: merges static meshes per material, used for the village cells and the wagon.
- `audio.js`: an offline-rendered sample library (`RENDER.*`), music moods (`Score`; `menu` is choir and organ),
  recorded thunder with a synthetic fallback.
- `shop.js`: the sutler's wagon.
  - Tabs: Arms, Holy Relics, Armourer, Relic & Faith, Provisions.
  - `UPGRADES`, `PRICES`, sell-back, the blessing.
  - `loadArmoury()` / `saveArmoury()` go through the profile.
- `account.js`: browser-only profiles.
  - The `account` singleton (class `Account`: `create`, `signIn`, `signOut`, `current`, `save`, `load`, plus `get`/`set` per key) sits on a
    swappable storage backend; today that's `LocalBackend` (localStorage, every access in try/catch).
  - **A real backend (Supabase/Firebase) is a new class with the same methods as `LocalBackend` (list, create, signIn, remove, read, write) passed to `account.setBackend()`.**
- `net.js`: multiplayer transport; see below.

**Assets**
- `public/models/*.json`: MakeHuman CC0 meshes, preprocessed by the scripts in `tools/` (`build_body.py`,
  `build_person.py` with `--lady`, `build_demons.py`, `build_horse.mjs`).
- `public/audio/sfx`: thunder from Wikimedia Commons, CC BY-SA 4.0, credited in the README.
- `public/audio/PUT-MUSIC-HERE.txt`: players can drop in their own music.

## Multiplayer (net.js), important

- **Model:** host-authoritative. The host's browser simulates everything. Guests send their own knight state and
  receive snapshots. A joined player replaces an AI companion; when they drop, a companion takes over their knight.
  When the host leaves, everyone goes back to the title.
- **Transport, in order of preference:**
  1. **Direct WebRTC via PeerJS.** The library loads from a pinned jsdelivr URL and uses the free PeerJS cloud
     broker. The peer id is `evil-in-the-land-<5-letter code>`. It uses Google STUN plus Open Relay static-auth TURN
     with short-lived HMAC logins; that TURN path is unverified and may not work.
  2. **MQTT relay fallback.** A guest connects to the relay from the start and begins knocking there if the direct
     link is seen to fail (PeerJS broker unreachable, no such peer, ICE failed) or has no answer after 5 s.
     - The brokers are public MQTT services over WSS and are **not bridged to each other**, so host and guest must
       meet on the same one. Both therefore use **all of them at once** (`openRelays`): the host listens on every
       broker it reaches and keeps retrying the rest; a guest knocks on every one it reaches; the first broker to
       carry the knock keeps that guest's link (the host ignores the same guest key on another broker). The old code
       took "the first broker that answers" on each side separately, so the two could end up on different brokers.
     - `public.cloud.shiftr.io` on port 443 (user and password `public`) is the one that gets through strict
       networks. EMQX, HiveMQ and Mosquitto, on non-443 ports, are the others.
     - Topics: `evil-in-the-land/v<PROTO>/<code>/h` (to the host) and `.../g/<guestKey>` (to a guest).
     - `RelayConn` mimics a PeerJS DataConnection, so the rest of the code doesn't care which path is in use.
     - Keep-alive is 20 s: a lobby idles for minutes while the code is passed round, and idle sockets get dropped.
     - A guest repeats its `join` every 2.5 s on each open path until answered; the host answers a repeat again.
       The `join` carries a random `key` so the host seats a guest once when it knocks by two paths.
     - `?relay` makes a guest skip the direct attempt.
  3. **The local `server.js` WebSocket relay,** used only when the page is served by `server.js`.
- **Libraries:** PeerJS and mqtt.js are served from `public/lib/` (the CDN copy is a second try).
- **Diagnostics:** the lobby shows a line under the code (`net.statusLine()`): for the host, which ways in are open
  ("direct open · relay open (3 of 4)"); for a guest, how it is linked. A failed join ends with a bracketed reason,
  e.g. `[direct: blocked by the network; relay reached (2 of 4), no answer from the host]`. Ask the owner for these
  when they report a failure.
- **Testing without the public services** (they are unreachable from the cloud sandbox): run two local MQTT brokers
  (aedes over websocket-stream) and a local PeerJS server (`peer`), and open the game with
  `?peerjs=localhost:9000&brokers=ws://localhost:1884,ws://localhost:1885`. Giving host and guest different broker
  lists, or a dead `peerjs=` port, simulates blocked networks.
- **Why the fallback exists:** the owner's friends got "Could not reach the host" because their networks blocked
  direct links. The relay fixed it in testing; after the fix, the owner hadn't yet confirmed it on their real
  networks.
- **Timing details:**
  - `SILENT_MS` is 120 s, so slow chapter loads don't drop players.
  - The host sends Start and waits 400 ms before loading, so the message gets out before the loading freeze.
- **`PROTO`:** a mismatch shows "different version, reload". Bump it if the message format changes.
- **Pause:** in multiplayer it doesn't freeze the world for others.

## Performance notes

- **Never add or reveal a light in the middle of a game.** Three.js builds each lit shader for an exact number of
  lights, so a light that is added to the scene, or whose hidden parent becomes visible, makes every lit material
  recompile in one frame (this was the multi-second freeze when an altar was cleansed). Lights that will be needed
  later are created at load with intensity 0 and left in the scene: the altars' candle and shaft lights
  (`world.js`), `game.cineLights` for cutscenes, `cave.torchLights`, the `fx` and `world.fireLights` pools.
- `engine.warmUp()` runs at the end of `loadChapter`, behind the black: it compiles the whole scene and draws one
  frame with nothing culled, so shaders, meshes and textures are ready before the opening shots. Before it runs,
  the chapter's bosses are built and wait hidden (`game.readyBosses`, used by `createBoss`), and one demon of each
  kind is put out (`horde.keepWarm`); the kept demons stay hidden all game so their shaders are not thrown away
  between waves (each demon has its own material).
- To find a hitch, watch `renderer.info.programs.length` across the event: if it rises, something compiled.
- Trees: each kind is two instanced meshes, the full tree within 52 m and a quarter-weight twin beyond, refilled
  each frame with only the trees in view (`world.cullTrees`, called from `game.update` after the camera moves).
  `world.instanced(..., { cells })` splits static instances by map square so they can be culled (rocks).

- Draw calls were cut 35–76%, with no visual change:
  - each knight's rigid armour pieces are skinned into one mesh per material;
  - the village is merged in 24 m cells per material;
  - canvas readbacks stay CPU-side;
  - off-screen cloth is paused;
  - frozen-body fitting and settling are cached.
- Still slow at chapter load: frozen-body settling on the first Ascent load (~3 s), cave planning (~1 s), the Lady
  statue (~0.5 s or more).
- If you add many small meshes, batch them (`batch.js`) or instance them.

## Known open issues and rough edges

All reported or flagged, none confirmed fixed by the owner:
- **Multiplayer:** the relay now uses every broker at once and passes local simulations of blocked networks, but it
  has not been confirmed on the owner's friends' real networks. The public brokers are free shared services with
  unknown rate limits (the host sends each guest a snapshot 15 times a second through them). A link that dies in
  the middle of a game still sends that player to the title; there is no rejoin. An owned relay (Supabase Realtime,
  a Cloudflare Worker, or a paid TURN) would be the robust fix.
- **Fen Lady statue:** fifth pass (`statue.js`): hair and crown, relief texture for crisp drapery, black tears,
  aged and painted stone. Face still smooth up close, eyes read closed, hair tresses are smooth tubes.
- **Church and houses:** rebuilt in `buildings.js`. Standing-house interiors are empty (a door ajar shows black),
  wrecks are all of the stone-ground-storey kind, house colliders still let you walk through a closed door, and
  barns have not been seen in-game.
- **Cutscenes:** Space (a press) skips any of them; a guest's press asks the host (`k:skipreq`). Shots only one
  player sees are played with `{ local: true }`.
- **Bosses:** all four rebuilt (`devil.js` Hound/Serpent/Cryptid/Dragon classes, `hound_model.js`,
  `serpent_model.js`, `dragon_model.js`): situational movesets, target scoring, poise, phases. Tuned only against
  a headless test bot. Companions take reduced boss damage (Hound 0.55x, Serpent 0.45x, Devil/Dragon 0.3x) because
  `ai.js` does not read `boss.tele` or know the new attack names; teach it and those reductions can go. Never tried
  in a real two-browser fight; Serpent and Dragon not seen in their real chapter light.
- **Wagon:** parks facing back down the road and leaves that way (`roadRoute(..., home = true)`); its barrels and
  chest are a separate group (`shop.camp`) left on the ground.
- **Cave:** never visually checked in-game (renders ran out of memory). Companion herding through the bends is
  untested.
- **Holy Lance:** the knight's grip on it in the pike stance hasn't been checked.
- **Dead bodies:** battlefield dead rebuilt in `battlefield.js`/`bones.js` (posed Landsknecht dead, ground-exact
  shader, LOD cells). Frozen dead (`makeFrozen`) are baked to 2 draw calls a man after settling; seated men and
  the cave dead are only level with the old look. The fallen household knights (`game.layOutFallen`) are untouched:
  they lie in the downed-alive pose and are full Knight rigs (many draw calls).
- **Saint Aldric's:** cobbles are on a straight world grid and look large and regular across the altar square. The
  village well's water isn't on the new ripple system.
- **Blood:** armour doesn't get bloodied, because its materials are shared and would need per-knight copies.
- **Water:** no wet line on the knights' legs.
- **Wishlist:** real accounts (Supabase/Firebase) to replace `account.js`'s localStorage backend; packaging for
  itch.io with a minified build.

## Credits and licences

- MakeHuman meshes and targets: CC0.
- Thunder recordings, Wikimedia Commons, CC BY-SA 4.0:
  - "Thunder crack 2B" by Bubba73;
  - "Thunder 01" by Amuzujoe.
- Three.js: MIT.
- PeerJS: MIT.
- mqtt.js: MIT.
- The game itself is `UNLICENSED` (private, all rights reserved).
