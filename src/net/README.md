# Two-player room (`src/net`)

Both people open the same URL: `/2d?seed=ROOM`. The seed is the room id. There is no `?relay=`, no Copy-invite with a different host, and no Seat A/B picker.

## Room

Server (`server/sync.mjs`) owns:

`Room { seed, seats[2], commands[], config, phase: lobby | live | over }`

Seat: `{ token, connected, lastSeen, deck, ready, ai }`. Max two seats. A third client is a spectator.

- First join → seat 0 (You on that device, bottom of the board).
- Second → seat 1 (also You on that device; rival is at the top).
- Each player picks their own team and readies. Live when both are ready.
- vs-AI: you ready via Start vs AI; the server fills seat 1 as `ai`. Still You at the bottom.

Commands are proposed by a seated client. The server appends them (seq) and broadcasts `commit`. Clients rehydrate by replaying `seed + commands`. The engine is not loaded in Node — legality is the client UI plus `applyRemote`. `# ponytail: persist the log, do not boot createEngine in the sidecar.`

## Reconnect

1. **Same tab / refresh.** `sessionStorage` seat token. Hello with that token reclaims the seat and kicks the old socket if it is still hanging (refresh race).
2. **Same browser, new tab while the first tab is live.** Session token is empty. `localStorage` reclaim is ignored while that seat is connected, so the new tab takes the vacant seat (two tabs, two players).
3. **Same browser after the tab is gone.** `localStorage` reclaim token. If that seat is stale or disconnected, you get it back (same team, same log).
4. **Other device (iPhone → iPad).** No token. If a seat is disconnected (socket close) or heartbeat-stale (~16s), the new client claims that vacant seat, gets a new token, and continues the same command log / decks. Claiming a stale seat disconnects the old socket.
5. **Both seats still heartbeating.** Third client is a spectator. Table is full. Open iPad while the phone is still alive → spectator until the phone’s heartbeat dies, then refresh (or the spectator hello retries when a seat drops).
6. **Process restart.** `.rooms/{seed}.json` keeps tokens, decks, and the command list. Seats come back disconnected. Token holders reclaim; strangers can take a stale seat.

## WebSocket discovery

The client always uses `ws(s)://<window.location.host>/sync`.

- `https` page → `wss`. `http` → `ws`.
- Dev: `vite --host` proxies `/sync` to `npm run sync` on `:8787`. A phone opens `http://192.168.x.x:5173/2d?seed=X`. It never types `:8787`.
- Production: `npm run start` serves `dist/` and `/sync` on one port.

In-memory only: live sockets, heartbeat timers, the `Map` of rooms (mirrored to `.rooms/*.json`). Spectators are not persisted.

## `/dev`

Does not yank the Deck Builder into a leftover server room when you type a seed. Same-tab `/2d` → `/dev` restores from sessionStorage. Deck Builder `start` overwrites that seed’s room (debug). Undo on `/dev` is local and does not rewrite the server log.
