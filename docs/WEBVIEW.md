# The AI view: a website on the phone

> **Status: planned, not built yet.** Only the block codec (`voxel.js`) exists. This is the design the work will follow.

The bridge (the Node program on the phone) serves a small website. Open it in
the phone's browser and you watch the AI play: a live 3D first-person picture of
what it sees, what it is holding, how healthy it is, what it is doing and
thinking, and the chat. Nothing happens in the game for this: nobody becomes a
spectator, no camera is set, no controls are locked.

```
 Minecraft world                      phone (Termux)                          phone (browser)
 ┌──────────────┐  Player.sendMessage ┌─────────────────────────┐  SSE /events  ┌────────────────────┐
 │ Real AI pack │ ───── AIB1| frames ─▶│ bridge  (index.mjs)     │ ────────────▶ │ index.html + app.js │
 │ viewstream.js│ ◀── /scriptevent ────│ web.mjs  (HTTP server)  │ ◀── GET /… ── │ render.js (raycast) │
 └──────────────┘   {t:"view"}        └─────────────────────────┘                └────────────────────┘
```

* The **pack** (`viewstream.js`) reads the world around the AI and the AI's
  state and sends it to the bridge **only while a browser is watching**.
* The **bridge** (`bridge/web.mjs`) keeps the latest copy, adds what only it
  knows (the model's decisions with their timing and cost, the chat it relays),
  and serves it to browsers over Server-Sent Events.
* The **page** (`bridge/web/`) rebuilds the blocks in memory and draws them
  itself with a small ray caster on a canvas (no libraries, no internet needed),
  from the AI's eyes, from behind it, or from wherever you drag.

## Opening it

The bridge prints the address when it starts:

```
[web] AI view: http://127.0.0.1:8787/   (open this in the phone's browser)
```

* On the same phone: open that address in Chrome. Use Android's split-screen
  or a floating window to see it next to Minecraft.
* On another device on the same Wi-Fi: set `"web": { "lan": true }` in
  `config.json`. The bridge then listens on the network and prints an address
  with a secret key (`http://192.168.1.20:8787/?key=...`).
* Off: `"web": { "enabled": false }`.

## config.json

```json
"web": {
  "enabled": true,      // serve the page at all
  "host": "127.0.0.1",  // 127.0.0.1 = this phone only; 0.0.0.0 = the whole network (a key is then required)
  "lan": false,         // shortcut: true = host 0.0.0.0 and a key
  "port": 8787,         // the next free port is used if this one is taken
  "key": "",            // secret for the page; generated for LAN use when empty and printed with the address
  "radius": 16          // blocks of world sent around the AI, 8 to 24
}
```

## Security

The page shows the AI's position, inventory, thoughts and chat. It is served only
from the bridge process, read-only, and:

* it listens on `127.0.0.1` unless `lan`/`host` says otherwise; with anything
  else a key is required (`?key=` once, then an `HttpOnly; SameSite=Strict` cookie);
* every request's `Host` header must be an address of this machine (`localhost`,
  `127.0.0.1`, `[::1]`, or an IP literal), which stops a web page opened in the
  same browser from reading it through DNS rebinding; `Origin`, when present,
  must match the `Host`;
* only the files in `bridge/web/` are served, by exact name;
* the page puts everything the AI says through `textContent`, never `innerHTML`;
* responses carry a strict Content-Security-Policy, `nosniff`, `no-store`;
* at most 8 browsers at once, with a cap on what is buffered for a slow one.

## Wire formats

### Addon to bridge (`Player.sendMessage` frames, like every other message)

All numbers are finite; strings are short. The bridge ignores anything else.

`vp` pose, every 4 ticks (5 per second) while streaming:

```json
{"t":"vp","k":123456,"d":"overworld","x":-347.5,"y":69,"z":-1001.5,"yaw":-90,"pitch":12.5,
 "vx":0.1,"vz":0,"f":5,"hp":20,"mhp":20,"hu":17,
 "e":[["h",-340.1,69,-1000.2,90,"zombie"],["p",-350,69,-1004,0,"Steve"]]}
```

* `x,y,z`: the feet, two decimals. `yaw`/`pitch`: Bedrock's (yaw 0 faces south
  +z, 90 west, 180 north, -90 east; negative pitch looks up). The eyes are 1.62
  above the feet (1.27 when sneaking).
* `f`: bit flags: 1 sneaking, 2 sprinting, 4 on the ground, 8 in water, 16 dead.
* `hp`, `mhp`, `hu`: health, maximum health, hunger 0-20 (`null` when unknown).
* `e`: at most 40 creatures within 48 blocks, nearest first:
  `[kind, x, y, z, yaw, label]`, kind one of `p` player, `b` other bot, `h`
  hostile, `a` animal, `i` dropped item, `o` other; x,y,z at the feet; label is
  a name or a short type ("zombie"), at most 24 characters.
* `d`: `overworld`, `nether` or `end`.

`vw` world snapshot, when a browser asks, when the AI has moved more than 6
blocks from the middle of the last one, and every 8 seconds otherwise:

```json
{"t":"vw","n":7,"d":"overworld","o":[-363,57,-1017],"s":[33,32,33],"p":["","minecraft:air","minecraft:stone","minecraft:grass_block"],"z":"<base64>"}
```

* `o`: the world coordinates of cell (0,0,0). `s`: `[W,H,D]` cell counts
  along x, y, z (W = D = 2·radius+1, H = 32; the y range is 12 below the AI's
  feet to 19 above, clipped to the dimension's height).
* `p`: the palette: block ids. **Index 0 is always `""`: the block was not
  loaded.** At most 255 entries; a world with more kinds in the box puts the
  rest at index 255 as `"minecraft:unknown"`.
* `cell index = (y·D + z)·W + x` with x, y, z relative to `o`.
* `z`: the cells as a run-length list, base64 (standard alphabet, padded):
  a sequence of `(varint(run − 1), index byte)` pairs, runs in cell order,
  varint = LEB128 (7 bits per byte, low group first, high bit = more follows).
  The runs add up to exactly `W·H·D`.
* `n`: a counter that grows with each snapshot.

`vb` changed blocks, within a second of the AI breaking or placing one:

```json
{"t":"vb","d":"overworld","b":[[-340,65,-1001,"minecraft:air"],[-341,65,-1001,"minecraft:oak_log"]]}
```

At most 64 per message.

`vh` state, once a second and when something important changes:

```json
{"t":"vh","name":"RealAIBridge","dim":"overworld","biome":"snowy plains","time":"midday","tod":6000,"weather":"clear",
 "hotbar":[["minecraft:wooden_axe",1],null,["minecraft:oak_log",12],null,null,null,null,null,null],"sel":0,
 "inv":[["minecraft:oak_log",12],["minecraft:stick",4]],"armor":[null,null,null,null],
 "act":"gather oak_log","queue":["move_to 12 64 40"],"goal":"get wood for tools","mood":"focused",
 "thought":{"text":"Trees to the east, go chop","say":null,"actions":["gather"],"tick":123400},
 "mission":"stage 1: wood (3/10 logs)","home":"-340 64 -1000 (12m away)","paused":false,
 "sight":"Sight: facing E ...\n..."}
```

Every field is optional. `inv` has at most 36 entries, `queue` at most 4,
strings at most 300 characters, `sight` (the AI's own text picture, exactly what
its model reads) at most 2400.

### Bridge to addon (`/scriptevent realai:in` frames)

`{"t":"view","on":true,"fresh":true,"radius":16}` when a browser connects
(`fresh`: send a world and a state now), re-sent every 20 seconds while any
browser is connected as a keep-alive, and `{"t":"view","on":false}` 15
seconds after the last browser leaves. The pack streams only while the
last `on` is less than 60 seconds old. `radius` is clamped to 8-24.

### Bridge to browser (Server-Sent Events on `/events`)

One SSE event per message, `event: <name>`, `data: <one line of JSON>`:

| event | data |
|---|---|
| `status` | `{ "bridge": {"version","username","inWorld","addon":"2.11.0"|null,"walks":bool}, "stream": bool (a pose arrived in the last 3 s), "clients": n }`, every 2 s and on change |
| `pose` | the `vp` message (without `t`), plus `"at"` (bridge time, ms) |
| `world` | the `vw` message (without `t`) |
| `blocks` | the `vb` message (without `t`) |
| `hud` | the `vh` message (without `t`) |
| `decision` | `{ "at", "bot", "ms", "provider", "model", "tokensIn", "tokensOut", "thought", "say", "actions": [{"type", "detail"}] , "ok": bool, "error"? }` for every model call |
| `chat` | `{ "at", "from", "text", "ai": bool, "whisper": bool }` public chat the bridge sees and what the AI says |
| `notice` | `{ "at", "kind", "text" }` the bridge's own warnings (rubber-banding, old pack, ...) |

A new browser first receives `status`, then the last `world`, `hud`, `pose`
and up to the last 60 `decision`/`chat`/`notice` entries (the bridge keeps them).

HTTP: `GET /` (the page), `GET /app.js`, `GET /render.js`, `GET /style.css`,
`GET /events`, `GET /state` (the same replay as one JSON, for debugging).
Anything else is 404.

## The renderer (`bridge/web/render.js`)

Pure functions, no DOM, so they run in Node tests and in the page:

* `decodeWorld(msg)` to a world object; `applyBlocks(world, list)`.
* `kindOf(id)`: `air`, `plant` (see-through decoration), `water`, `lava`,
  `glass`, `leaves`, `solid`, `unknown`.
* `colorOf(id)`: `{ side:[r,g,b], top:[r,g,b], alpha }`. Known blocks have
  fixed colours (stone grey, grass green on top and brown-green on the sides, ...);
  any other id gets a stable colour hashed from its name, so modded blocks are
  told apart.
* `renderView(world, cam, entities, opts) -> { width, height, pixels, depth }`:
  a voxel ray caster (Amanatides-Woo). `cam = {x,y,z,yaw,pitch,fov}` (eye
  position, Bedrock yaw and pitch, horizontal field of view in degrees). Sky
  gradient by time of day and dimension, fog with distance, faces shaded by
  direction (top lightest), a little per-block texture noise, translucent
  water and glass, lava glowing, creatures and the AI itself as coloured boxes
  depth-tested against the blocks. `unknown` cells are not drawn (void haze).
* `project(cam, width, height, x, y, z) -> {x, y, depth} | null` for labels.

## Files

| file | role |
|---|---|
| `packs/RealAI_BP/scripts/brain/voxel.js` | pure: palette and run-length codec for snapshots |
| `packs/RealAI_BP/scripts/brain/viewstream.js` | in-game: scans the world, sends `vp`/`vw`/`vb`/`vh` while watched |
| `bridge/web.mjs` | the HTTP/SSE server and the replay cache |
| `bridge/web/index.html`, `style.css`, `app.js`, `render.js` | the page |
| `tests/voxel.test.mjs`, `tests/web.test.mjs`, `tests/render.test.mjs` | unit tests |
| `tests/web/shots.mjs` | headless-Chromium screenshots of the page |
