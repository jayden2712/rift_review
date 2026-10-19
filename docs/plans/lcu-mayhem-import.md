# Plan: import ARAM Mayhem from the League client (LCU)

Status: plan only, nothing implemented. Written 2026-10-20.

## Why

Riot's public MATCH-V5 API does not serve ARAM Mayhem (queue 2400) or Mayhem Classic (2450).
Detail requests returned 403 at launch (the error behind commit 3f298c5) and the queue
filter now returns no IDs. Riot treats this as intended
([developer-relations#1109](https://github.com/RiotGames/developer-relations/issues/1109),
closed "is working"; [#1154](https://github.com/RiotGames/developer-relations/issues/1154) still open).
Checked on 2026-10-20 for `not tày enough#idc` (OCE): MATCH-V5 returns only 21 ranked games,
although the player has played Mayhem regularly since 2026-06-17.

The running League client exposes the player's own history, Mayhem included, on a local HTTPS
API (LCU). Desktop trackers such as [Yhprum/mayhem-tracker](https://github.com/Yhprum/mayhem-tracker)
(MIT) and OP.GG's desktop app use it.

## Scope

In scope (phase 1):

- Local-only, opt-in source `LCU_ENABLED=1`, mirroring how Data Lab is gated. The hosted Worker
  never contains this code (`build.mjs` only embeds `server/riot.js` and `server/worker.js`).
- Read-only GET requests to an allowlist of LCU paths, for the signed-in account only.
- Import the client's recent games, keep Mayhem/Mayhem Classic, map them to History v3, and
  merge them into the saved history so repeated imports accumulate.
- Augments shown for Mayhem matches.

Out of scope for phase 1: live in-game capture, websocket events, background polling, other
players' history, deep history through Riot's internal match-history service (see phase 2).

## Step 0 results (verified 2026-10-20, client 16.20, OC1, locale vi_VN)

Read-only GETs against the running client. Raw responses stayed outside the repository; one
game was anonymised into `tests/fixtures/lcu-mayhem-game.json`.

- **Lockfile** at `<install>/lockfile`: `LeagueClient:<pid>:<port>:<password>:https`. Only
  present while LeagueClient runs (the Riot Client launcher alone has none).
- **Account**: `/lol-summoner/v1/current-summoner` returns `gameName`, `tagLine`, `puuid`.
  `/riotclient/region-locale` returns `{"region":"OC1","locale":"vi_VN",...}`.
- **Match list**: `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19`
  returned 19 games (18 Mayhem, 1 custom game queue 3100), 2026-10-17 → 10-19. Each list entry
  contains **only the player's own participant**, so every game needs a detail request.
- **Game detail**: `/lol-match-history/v1/games/{gameId}` (~30 KB): 10 `participants` and 10
  `participantIdentities` (`player.puuid`, `gameName`, `tagLine`). Mayhem: `queueId: 2400`,
  `gameMode: "KIWI"`, `mapId: 12`, `gameType: "MATCHED_GAME"`, `gameDuration` in seconds
  (729–1304 across 18 games), `endOfGameResult: "GameComplete"`.
- **Participant**: `championId`, `teamId` (100/200), `spell1Id/spell2Id`, `stats` with 118 keys:
  `kills/deaths/assists`, `win`, `champLevel`, `goldEarned`, `totalDamageDealtToChampions`,
  `totalMinionsKilled`, `item0..6`, `playerAugment1..6` (0 = empty; 3–4 filled per player),
  `gameEndedInEarlySurrender`. All `perk*` are 0 in Mayhem (no runes). `playerSubteamId` is 0.
- **Champion names**: `/lol-game-data/assets/v1/champion-summary.json` (251 entries, `id`,
  `name`, `alias`); every champion in the 18 games resolved.
- **Augments**: `/lol-game-data/assets/v1/cherry-augments.json` (554 entries) covers every
  Mayhem augment seen: `id`, `augmentNameId`, `nameTRA` (in the client's locale), `rarity`
  (`kSilver`/`kGold`/`kPrismatic`), `augmentSmallIconPath` under `ASSETS/UX/Kiwi/Augments/Icons/`.
  An English catalogue must come from elsewhere (CommunityDragon `en_us` build of the same file).
- **Items**: 146 of 152 item IDs exist in `public/game-assets.js`; Mayhem-only items missing:
  `220013, 126697, 124011, 228002, 226668, 123430`. Spells all present.
- Not verified yet: Mayhem Classic (2450) payloads, remakes, `/lol-game-data` icon downloads.

## Design

### Server: `server/lcu.js` (new, local only)

- **Discovery.** Install dir from, in order: `LCU_INSTALL_DIR` in `.env`;
  `%ProgramData%/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml`
  (`product_install_full_path`); `C:\Riot Games\League of Legends`. On this machine the install
  is `E:/League/Riot Games/League of Legends`.
- **Lockfile** `LeagueClient:<pid>:<port>:<password>:<protocol>`. Validate every field; a
  lockfile whose port is not listening means the client is closed.
- **Transport.** `https.request` to `127.0.0.1:<port>`, Basic auth `riot:<password>`, verifying
  the certificate against Riot's published LCU root certificate (vendored PEM), not
  `rejectUnauthorized: false`. Timeout, response size limit, GET only, path allowlist.
- **Secrets.** The lockfile password never leaves the server process, never appears in
  responses, logs or errors.
- **Statuses:** `disabled`, `not_installed`, `client_closed`, `not_signed_in`, `connected`.

### Local routes (enabled only with `LCU_ENABLED=1`)

- `GET /api/lcu/status` → status plus Riot ID of the signed-in account.
- `POST /api/lcu/import` → `{history, warnings, source}` in the same envelope as `/api/history`,
  `source.provider = 'lcu'`. Non-Mayhem games are skipped with a reason.
- Same Host/Origin checks and body limit as the rest of the local server. 404 when disabled;
  the hosted Worker returns 404 for these paths even when the env var is set (test like Data Lab).

### Mapping `server/lcu-map.js` (pure, unit-tested)

- LCU game → History v3 match (`queue: 'ARAM Mayhem'` or `'Mayhem Classic'`, role `null`,
  KDA, damage, gold, duration, team kills) and detail participants (champion name from
  champion-summary, items, spells, augments).
- Unknown values stay `null`, same rule as the Riot adapter.
- Match IDs as `<PLATFORM>_<gameId>` (for example `OC1_123`) so they never collide with
  MATCH-V5 IDs and dedupe correctly across imports.

### History v3 changes

- `augments`: from always `null` to `null | Array<{id: number}>` (max 6, safe integers),
  validated in `public/history-details.js`. MATCH-V5 data keeps `null`.
- Accept queue `'Mayhem Classic'` alongside `'ARAM Mayhem'` wherever Mayhem rules apply.
- Provenance: matches imported from LCU are marked so export/import keeps the source.

### Augment names and icons

Vendor a manifest (ID → vi/en name, icon file) through a sync script like the existing
`scripts/sync-*.py`, sourced from the confirmed game-data file. Until names exist, show
"Augment #ID" rather than guessing.

### UI

- In Mayhem mode, show **Nhập từ client LoL / Import from League client** when
  `/api/lcu/status` is `connected`; otherwise a short status line (client closed, not signed in).
- Remove the "augments not verified" notice for LCU matches that carry augments.
- Mayhem statistics view: augment pick counts and win rate per augment (descriptive only,
  consistent with the "no coaching for Mayhem" rule).

## Phase 2 (decide later)

The LCU match list only returns the latest 20 games (paging is ignored). Reaching older games
needs Riot's internal match-history service (`*.pp.sgp.pvp.net/match-history-query/...`) with
the RSO access token from `/lol-rso-auth/v1/authorization/access-token`, then hydrating each
game through the LCU. That is an undocumented service, the token is a real account credential,
and mayhem-tracker reports its auth rules have already changed once. Do it only if accumulating
20 games per import is not enough.

## Risks

- LCU is unofficial and can change without notice; keep the adapter small and its failures visible.
- The lockfile password grants control of the client: GET-only allowlist, never expose it.
- Riot policy: reading the player's own data from the local client is what OP.GG and Porofessor
  do, but it is not an official API. Keep the feature local, opt-in and documented as such.

## Implementation order (TDD, one commit each)

1. Step 0 capture and anonymised fixture.
2. Lockfile discovery and parser + tests.
3. LCU transport with injectable request function, path allowlist + tests.
4. Mapper + tests against the fixture.
5. History v3 augment and Mayhem Classic support + tests.
6. Local routes behind `LCU_ENABLED`, hosted-Worker exclusion test.
7. UI button and status, augment display, i18n.
8. Augment manifest sync script and icons.
9. Docs: README troubleshooting, `docs/architecture.md`, `.env.example`.
