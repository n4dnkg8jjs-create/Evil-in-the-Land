# Evil in the Land

Anno Domini 1523. The land is dead, and something walks the hills watching.

A cooperative action game for one to five knights in 16th-century plate. Fight the demonic swarm, kneel at the blighted altars and pray while your brothers hold the line, and win back the land piece by piece. The road climbs through seven chapters to the mountain's peak, where the Devil waits in his final shape. A full pilgrimage takes about an hour to an hour and a half.

## Play in your browser

**https://n4dnkg8jjs-create.github.io/Evil-in-the-Land/**

Ride alone or with friends, nothing to install. Everyone just opens the page.

## Profiles

The first time you play, make a profile: your knight's name and, if you like, a PIN so others on the same computer can't play as you. Your profile keeps your harness, settings, silver, armoury and how far you've got, and saves itself as you play. Several people can have profiles on one computer; **switch profile** on the title screen changes who is riding.

Profiles are saved in your browser on this computer, so clearing the browser's site data deletes them, and they don't follow you to another computer yet.

## Play with friends

Nothing to download or run: the host's browser holds the lobby.

1. **The host** opens the page and chooses **Host a Lobby**. The lobby shows a five-letter code, with buttons to copy the code or an invite link.
2. **Friends** open the same page, choose **Join with a Code** and type the code, or just open the invite link. They arrive in the lobby under their profile names.
3. Everyone picks a harness and marks themselves **Ready**. The host chooses difficulty, companions and chapter, then **Ride Out**.

Each friend's knight takes the place of a companion. Companions fill any places that are left, up to five knights in all. If a friend drops out mid-game, a companion carries on in their knight's harness. If the host leaves, the game ends for everyone and they're sent back to the title.

Players find each other through the free PeerJS matchmaking service, then connect directly browser to browser. Everyone needs an internet connection. A few strict networks, such as some offices, schools and mobile hotspots, block direct connections; if friends can't join, try another network, or use the local server below.

## Run the game yourself (optional)

You need **Node.js 18 or newer**, free from https://nodejs.org (the "LTS" download).

- **Windows:** double-click `start-windows.bat`
- **macOS:** double-click `start-mac.command`. The first time, macOS may ask you to allow it: right-click → Open.
- **Linux:** run `./start-linux.sh`, or `node server.js`

Leave the server window open while you play, then open **http://localhost:7777** in Chrome, Edge or Firefox.

The very first time, the host computer needs internet so the server can download the 3D engine (Three.js). It keeps a copy in the `vendor` folder, so after that nobody needs internet to play.

### Lobbies on the local server

Opened from your own server, the game still uses five-letter lobbies by default. If the matchmaking service can't be reached, **Host a Lobby** opens the lobby on your server instead and shows a four-letter code. Friends on the same network open the server's address, such as `http://192.168.1.20:7777`, and join with that code.

If port 7777 is taken, start the server on another one: `PORT=7788 node server.js`. On Windows, use `set PORT=7788` then `node server.js`.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Left click | Strike; click again to chain the combo |
| Right click | Heavy blow |
| Q (hold) | Guard. Raise it just before a blow lands to parry |
| Space | Roll |
| Shift | Run |
| Ctrl | Shift lock: your knight faces where the camera looks, for strafing. Settings can move it to Caps Lock or Tab |
| E (hold) | Kneel and pray at an altar, or raise a fallen knight |
| R | Use your relic |
| H | Drink a healing draught |
| F | Trade at the sutler's wagon |
| Mouse wheel | Camera distance |
| Esc | Pause |

## On the road

- **Prayer and altars.** Kneel at each blighted altar and hold your prayer while the others defend you. Each answered prayer heals the land around it.
- **Dread.** Fear rises when you stand alone in the blight, when demons close in, when you are wounded, and when the hooded figure on the ridge is watching. As it rises you will hear whispers, the edges of the screen go dark, and you will see things that are not there. At its worst your hands shake. Praying, staying near your fellow knights and standing in the light of cleansed altars bring it down.
- **It gets worse.** Each chapter deeper into the blight, fear builds faster and things start happening on the road: a figure standing in your way, something crossing the path in the fog, a silence broken by a scream, footsteps behind you, your own name whispered, and the light going out. Every player experiences these separately.
- **The First Company.** Twenty knights took this road a year before you and never came back. Their graves lie beside it, each marked with a cross and a helm, and their chaplain's pages are on the graves. Walk up to one to read it.
- **The sutler's wagon.** Every road starts at a trader's wagon. Spend the silver you earn from kills, altars, finished roads and found pages on new weapons, tempered blades, stronger armour, a blessed relic and healing draughts. Purchases are saved in your profile.

## Your own music

The score is rendered by the game itself: choir, strings, low brass and war drums. To use recorded music instead, put audio files in `public/audio` with these names (`.ogg`, `.mp3`, `.wav`, `.m4a` or `.flac`):

- `music_explore` while travelling
- `music_battle` in heavy fighting
- `music_prayer` while you kneel at an altar
- `music_boss` for the great fights
- `music_victory` when the land is healed

Any you leave out fall back to the built-in score. Only use music you have the rights to.

## Graphics

Settings → Graphics has Low, Medium, High and Ultra. High suits most gaming PCs; use Medium or Low on laptops. The game is designed for desktop computers with a keyboard and mouse.

## Troubleshooting

- **The loading screen says the 3D engine could not be loaded.** The host computer had no internet on the first run. Connect once, restart the server, and reload.
- **Friends can't join a five-letter lobby.** Check the code. If it's right but joining times out, one of your networks is blocking direct connections; try another network (a phone hotspot often works, and so does a home network instead of a work one).
- **Friends can't join a four-letter lobby on your own server.** They must be on the same network and use the host's address, not `localhost`. Windows may ask to allow Node.js through the firewall; allow it on private networks.
- **"No lobby with that code".** Codes vanish when the host leaves. Check the code with your host.

## Credits

The knights' bodies and the demons are built from the [MakeHuman](http://www.makehumancommunity.org) base mesh, targets, skeleton and skin weights, released under CC0. `tools/build_body.py` and `tools/build_demons.py` turn them into `public/models/body.json` and `public/models/demons.json`. The thunder is recorded: "Thunder crack 2B" by Bubba73 and "Thunder 01" by Amuzujoe, from Wikimedia Commons, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (trimmed, faded and levelled into `public/audio/sfx/`; those files are shared under the same licence). Everything else (armour, weapons, world, the other sound and the music) is generated by the game's own code.
