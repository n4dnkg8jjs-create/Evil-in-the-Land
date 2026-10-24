# Evil in the Land

Anno Domini 1523. The land is dead, and something walks the hills watching.

A cooperative action game for one to five knights in 16th-century plate. Fight the demonic swarm, kneel at the blighted altars and pray while your brothers hold the line, and win back the land piece by piece. The road climbs through seven chapters to the mountain's peak, where the Devil waits in his final shape. A full pilgrimage takes about an hour to an hour and a half.

## Start the game

You need **Node.js 18 or newer**, free from https://nodejs.org (the "LTS" download).

- **Windows:** double-click `start-windows.bat`
- **macOS:** double-click `start-mac.command`. The first time, macOS may ask you to allow it: right-click → Open.
- **Linux:** run `./start-linux.sh`, or `node server.js`

Leave the server window open while you play, then open **http://localhost:7777** in Chrome, Edge or Firefox.

The very first time, the host computer needs internet so the server can download the 3D engine (Three.js). It keeps a copy in the `vendor` folder, so after that nobody needs internet to play.

## Play with friends

1. One player starts the server and chooses **Host a Lobby**. A four-letter code appears.
2. Friends on the same Wi-Fi or network open the address shown in the server window and in the lobby, for example `http://192.168.1.20:7777`.
3. They choose **Join with a Code** and type the code.
4. Everyone picks a harness and marks themselves ready; the host chooses difficulty and companions, then **Ride Out**.

Empty places can be filled with companion knights who fight, pray and raise the fallen.

Friends somewhere else need a way to reach your computer. The simplest is a free private network such as Tailscale on every computer, then join using the host's Tailscale address. Forwarding port 7777 on your router also works.

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
| E (hold) | Kneel and pray at an altar, or raise a fallen knight |
| R | Use your relic |
| Mouse wheel | Camera distance |
| Esc | Pause |

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
- **Friends can't connect.** They must be on the same network and use the host's address, not `localhost`. Windows may ask to allow Node.js through the firewall; allow it on private networks.
- **"No lobby with that code".** Codes vanish when the host leaves. Check the code with your host.
