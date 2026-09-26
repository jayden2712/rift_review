# Rift Review — Riot history integration

Private, English/Vietnamese League of Legends history dashboard and post-match coaching workspace. Vanilla HTML/CSS/ES modules with a private Cloudflare Worker backend. No added dependencies or model calls. The server retrieves completed matches from Riot with a secret environment key. Summoner’s Rift history uses the existing coaching rules; ARAM Mayhem has separate post-match history and descriptive statistics without coaching. A history containing Mayhem can be saved on this browser, including match details; SR-only lookups stay in tab memory and do not replace that saved snapshot. On reload, a valid saved snapshot is restored, otherwise the app opens clearly labelled fictional data. JSON export/import remains available for backups. Source and hosting remain attached to the original private Site.

## Workflows

- Enter Riot ID, server, mode (**Summoner’s Rift** or **ARAM Mayhem**) and a 10/20-match page size. Refresh manually or load older pages, up to the 500-match/request-offset limit. There is no background polling.
- Use the integrated history filters to switch between SR queues and **ARAM Mayhem**. Mayhem is distinct from regular ARAM and Ranked; its statistics never include SR matches.
- Review wins/losses, win rate, pooled KDA/KP, per-champion records, damage, gold and available match details. Missing values remain unknown. Mayhem has no lane-role requirement, rank estimate, coaching signals or progress conclusions.
- For SR, retain role distribution, coaching evidence and two practice priorities. SR trend comparisons use adjacent groups of 5–10 matches of the same dominant role, with at least five known observations per group.
- Paste JSON, choose a JSON file, or add a match manually. Choose **ARAM Mayhem** in the manual form to disable lane-role input. The first personal match replaces fictional sample data; replacing a dataset can be undone once in memory.
- Select **Mẫu ARAM Mayhem / ARAM Mayhem sample** in the sample selector for 12 explicitly fictional matches without a Riot key. Sample data does not establish live API availability.
- Export the complete History v3 JSON, including validated match details. The SR coaching report remains available; Mayhem is statistics-only.

## Local commands

Requires Node.js 20.12 or newer. No dependency installation is needed.

```bash
# Run once if you do not already have a .env file:
cp .env.example .env
# Edit .env and fill in RIOT_API_KEY, then start:
npm start
```

Open http://localhost:4173. `npm start` serves both the UI and `/api/status` + `/api/history` using the existing Riot backend. Without a key, sample data and JSON/manual input still work; live lookup returns a configuration message. To use real history, set your own valid `RIOT_API_KEY` in `.env`, restart the server, then enter your Riot ID and server in the lookup form. `.env` is ignored by Git; never place keys in `public/` or commit them. Shell environment variables override `.env`. Set `PORT` to change the port, and stop an old static server if it already uses 4173. Press Ctrl+C to stop.

The development server binds only to `127.0.0.1` and accepts `localhost` or `127.0.0.1` with its listening port. Local requests do not require a hosted login: the adapter checks the peer, Host and browser origin before supplying a local identity to the shared API. It rejects cross-origin requests and limits API bodies to 2 KB. Use the hosted Worker for deployment; do not expose the local adapter through a proxy or tunnel. The hosted authentication path is unchanged. Local lookups use the existing Riot throttling/retries and a bounded memory cache (128 entries, maximum 512 KiB per entry). Restarting clears local cache and throttling state; hosted deployments use the Worker Cache API.

`npm test` runs domain, translation and local HTTP integration tests; `python3 tests/wiki-assets.test.py` checks the wiki importer. The Node suite also checks the browser data provider against mocked Riot responses. `npm run build` embeds the existing public assets and hosted server modules in a self-contained Worker entrypoint at `dist/server/index.js`; it does not include `.env` or the local adapter. The build manifest is copied to `dist/.openai/hosting.json`. The optional browser regression script uses mocked Riot responses, not a live key. With Playwright and its browser installed outside the repository, run:

```bash
PLAYWRIGHT_MODULE=/tmp/rift-mayhem-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/rift-mayhem-browser/browsers \
node tests/e2e/mayhem.mjs
```

These example paths can be changed to an existing Playwright installation. They add no runtime dependency to the project. Tests/build and browser mocks do not verify live Mayhem availability.

## Interface language

Use the **VI / EN** control in the upper-right corner to switch Vietnamese and English. The choice is stored as `rift-review-language` in browser localStorage; if browser storage is unavailable, switching still works for the current session. This language preference is independent of the separate history snapshot; neither stores API credentials.

Navigation, forms, accessible labels, dynamic statistics/coaching, loadout names, errors and report exports follow the selected language. Riot IDs, champion identities, notes and imported data remain unchanged. Queue/role values in JSON and form submissions remain canonical, independent of their display labels. Changing language preserves filters, the selected tab, open match details and in-progress form input.

`public/i18n.js` provides explicit source-string translations and interpolation; dictionaries are split into static, app, match and domain modules. Add translations at rendering/validation boundaries rather than rewriting arbitrary DOM text or user data.

## Champion icons

Champion portraits are bundled under `public/champions/` from [TheePepS/League_Of_Legends_Assets](https://github.com/TheePepS/League_Of_Legends_Assets/tree/6d4dd81a9fde8408d409f9b76b914b7485bd037e/Champions_assets), pinned to commit `6d4dd81a9fde8408d409f9b76b914b7485bd037e`. The 173 unique PNGs are unmodified 128×128 source images; filenames are normalized to lowercase letters/numbers, and the duplicate `Dr_Mundo.png` is omitted in favor of `Dr._Mundo.png`. Artwork belongs to Riot Games; the source repository supplies the asset collection.

`public/champion-icons.js` resolves display names and Riot IDs, including MonkeyKing/Wukong, Nunu/Nunu & Willump, and Renata/Renata Glasc. History rows, champion statistics and both-team participant tables use these local portraits. Unknown champions or failed image loads retain initials. No image CDN requests or CSP exceptions are required. The local server serves PNGs directly and the hosted build embeds their binary data. To update the collection, use a reviewed upstream revision, normalize filenames, update the helper list and this attribution, then run the asset tests and build.

## Architecture

- `server/riot.js`: server-only ACCOUNT-V1, SUMMONER-V4, MATCH-V5 and LEAGUE-V4 client, routing allowlist, cache, Retry-After handling and PUUID-selected mapping.
- `server/worker.js`: authenticated same-origin JSON API, protected status route and static asset responses.
- `server/local.js`: loopback-only development HTTP server, public assets and adapter to the shared API.
- `server/local-config.js`: server-side `.env` loading and local port validation.
- `public/riot-source.js`: live provider adapter; validates History v3 and the exhausted-page response, and translates sanitized API errors.
- `public/data.js`: legacy Match v1 validator and adapters, with explicit Mayhem role and numeric limits. Short durations do not automatically imply a Mayhem remake.
- `public/history-data.js`: History v3 validation with legacy import support, mode-aware exclusions, fictional samples and lossless export of supported normalized fields.
- `public/history-details.js`: bounded validation of participant/loadout metadata and unknown augment values.
- `public/history-store.js`: validated browser snapshots and account/mode-safe page merging with ID deduplication.
- `public/coach.js`: original transparent per-match rules. Existing tests and provider remain intact.
- `public/history-coach.js`: mode-separated selection and aggregation; SR-only rules, trends and coaching exports.
- `public/match-view.js`: compact match-card, loadout/rune rendering and duration formatting.
- `public/sample-loadouts.js`: explicitly fictional sample-only loadout fixtures.
- `public/app.js`: view state, input validation UI, filters, match details, evidence navigation, export and scoped rendering. User input is HTML-escaped. Data-source labels are controlled by the app, never treated as a verified identity.
- `public/styles.css`: original responsive dark interface, retaining Rift Review's purple/lime identity and adding blue/red match rows.

## Match cards, loadouts and lobby ranks

Match cards show champion level, two summoner spells, the keystone and secondary rune path, seven ordered inventory slots (including trinket), KDA, CS/KP/vision and compact team rosters. Expanding a match shows the complete primary/secondary rune selections and three stat shards, plus the separately styled blue/red scoreboards. Match duration is displayed as `31m05s`; source values and per-minute coaching calculations retain their numeric units.

Riot MATCH-V5 metadata stays in `details[matchId]`: `durationSeconds` and participants with `championLevel`, `summonerSpells`, `items` and `runes`. Missing IDs are unknown; item ID 0 is an empty inventory slot. An unavailable icon keeps a labelled fallback. The sample history has explicitly fictional loadouts/ranks; imported or manual matches never acquire invented metadata. History v3 JSON export/import now preserves supported participant/loadout metadata. Current lobby-rank snapshots are not included in the history contract. Mayhem augments are explicitly unknown until their Riot payload is verified; they are never inferred from items or runes.

The **Xem rank lobby** button calls `POST /api/lobby-rank` with `{"matchId":"OC1_123","region":"oce"}`. It fetches current LEAGUE-V4 ranks for the players in that completed match: Solo/Duo for queue 420, Flex for queue 440. The displayed average uses ordinal tier/division positions, excludes confirmed unranked and unknown players, and shows coverage such as 8/10. Master, Grandmaster and Challenger are distinct top positions without invented LP divisions. This is a descriptive average of **current ranks**, not historical match-time rank or MMR. The response includes `asOf`, `basis:"current"`, counts and a five-minute cache TTL. Unknown rank data is distinguished from confirmed unranked players.

Mayhem does not request or display SR lobby rank as Mayhem rank/MMR. For supported Ranked queues, rank lookup runs only when requested, one lobby at a time in the browser, so opening 20 matches does not automatically trigger 200 extra upstream calls. Existing Riot throttling/cooldown still applies. Errors and retry messages affect only that lobby badge; match history and coaching remain intact. No external OP.GG data endpoints are used.

`public/game-assets.js` resolves local icons and English/Vietnamese names using pinned Riot Data Dragon 16.18.1 metadata. **303 of 316 item icons now come directly from the current [League of Legends Wiki Item catalog](https://wiki.leagueoflegends.com/en-us/Item)**. The other 13 internal/special entries (such as structure effects and recall placeholders) use pinned Riot Data Dragon images, not the older repository artwork. `scripts/item-icon-sources.json` records every item’s exact image URL, wiki name where available, SHA-256 and fallback reason. Champion, spell, rune and rank images retain their previously documented sources. There are also 34 spells, 76 runes/styles/shards and nine rank badges; Emerald uses a text fallback. Refresh intentionally with `python3 scripts/sync-game-assets.py`; the importer reads the public wiki catalog and stops on unexpected or blocked HTML. Normal build/start uses bundled local files and makes no wiki image requests. Icon artwork is a current reference set, not a reconstruction of historical patches. Sources: [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon), [LEAGUE-V4](https://developer.riotgames.com/api-details/league-v4), and the [original asset repository](https://github.com/TheePepS/League_Of_Legends_Assets).

## History v3 contract

This minimal example is fictional and intentionally has no participant metadata:

```json
{
  "schemaVersion": 3,
  "profile": {"riotId": "Example#DEMO", "region": "OCE", "rank": ""},
  "matches": [
    {
      "id": "example-mayhem-1",
      "playedAt": "2026-09-24T10:30:00Z",
      "queue": "ARAM Mayhem",
      "champion": "Ahri",
      "role": null,
      "result": "Victory",
      "durationMinutes": 20.5,
      "kills": 10, "deaths": 8, "assists": 24,
      "cs": null, "visionScore": null, "teamKills": 48,
      "damageToChampions": 35000, "goldEarned": null,
      "notes": "Fictional example", "isRemake": null
    }
  ],
  "details": {}
}
```

Imports still accept History v2, arrays of matches and legacy single-match objects. Exports use v3. Required match fields are champion, result, durationMinutes, kills, deaths and assists; SR still requires a valid role. Mayhem uses `role: null`, rendered as not applicable. Its validator permits up to 180 minutes, 1,000 per kills/deaths/assists field and 5,000 team kills; these are input bounds, not expected gameplay values. Existing SR limits remain unchanged. Optional numeric fields stay null when missing or blank. Profile labels and rank are user-provided unless obtained during the current API request; rank is never inferred from lobby averages.

Queue values are `Ranked Solo`, `Ranked Flex`, `Normal`, `Standard`, `ARAM`, `ARAM Mayhem` and `Other`. A missing queue remains `Standard`, preserving legacy SR imports. Regular ARAM and Other records can still be imported/exported, but are outside the supported statistics/coaching modes. Mayhem records remain visible even when excluded from aggregate statistics as confirmed remakes. For Mayhem, `isRemake: null` means unknown, `true` means confirmed remake, and `false` means explicitly not a remake. The live adapter currently leaves this unknown; short duration alone is not evidence of a remake. SR remake/under-five-minute exclusions remain unchanged.

`details[matchId]` may contain `durationSeconds`, `gameVersion` and up to ten normalized participants, with at most five per team. Participant fields include identity display labels, team, player marker, statistics, champion level, seven item slots, two summoner spells, runes and `augments: null`. Detail keys must refer to existing matches. Unknown slots stay null while item ID 0 remains an empty slot. The augment adapter is isolated and deliberately returns null: no real Mayhem augment structure has been verified, and non-null imported augment payloads are rejected rather than silently discarded or guessed. Supported details survive export/import, manual additions, page merging and device restore.

If every match has a timezone-qualified ISO timestamp, sorting is newest first; otherwise the complete input order is preserved and should be newest first. Duplicate IDs reject a JSON import. IDs generated for records without IDs are import-local; identical statistics do not imply duplicate matches. Imports are atomic and limited to 500 matches and two million characters/bytes for text/files respectively. Full participant metadata may reach the size limit before 500 matches.

## Saving on this device

A non-sample history containing at least one Mayhem match is automatically saved under localStorage key `rift-review-history-v1`. The snapshot contains History v3 data and, when applicable, a validated lookup cursor. This is one latest active history/account snapshot, not a multi-account archive or database. Activating another Mayhem account replaces the previous saved snapshot; export JSON first to keep multiple histories. SR-only lookups and fictional samples do not overwrite the saved Mayhem history.

On reload, a valid snapshot is labelled as device data (`source: "device"`), not newly verified Riot data. Browser edits/imported source labels cannot turn it into authenticated provenance. Blocked storage, quota errors or oversized snapshots leave the current in-memory history and previous saved bytes intact and show a JSON-backup fallback. Device storage is specific to the browser/origin and can be cleared by the user; it is not cloud sync. API keys and current rank lookups are never persisted in it.

## Analysis boundaries

Mode is selected before statistics: Mayhem and SR never share aggregate metrics, champion records or trend/coaching cohorts. Filters and the newest-N limit define the current scope. Confirmed Mayhem remakes remain visible but do not count toward aggregate statistics. Mayhem has descriptive statistics only: no SR CS/vision/death/KP thresholds, coaching messages, progress comparison or augment recommendations. For SR, evidence navigation only narrows the visible match list while preserving the report's wider scope.

KDA is total kills plus assists divided by total deaths, not an average of match KDA. Per-minute fields use total known values divided by their matches' total minutes. KP uses pooled kills and assists divided by pooled team kills, excluding unknown and zero-denominator matches. Zero deaths with no kills/assists displays unknown, not a perfect performance. Missing values are never replaced with zero.

SR rules are illustrative practice targets, not calibrated rank, patch or champion benchmarks. A recurring problem requires at least five eligible observations, at least three flagged matches, and at least 30% flagged. Strengths require at least three matches and at least 60% of eligible observations. These are practice heuristics, not statistical confidence. Each signal uses its own eligible denominator; Support is excluded from farm checks. Priorities rank repetition first, then observed frequency times the rule's review weight.

No replay, timeline, positioning, mechanics, item builds or death causes are inferred from scoreboard data. Player notes are displayed unchanged and never alter analysis. Damage and gold are descriptive, without invented rank targets. Trend comparisons keep the same role but do not control for champion, patch, matchup or opponent; they are descriptive changes, not proof of improvement.

## Live Riot data and secrets

`POST /api/history` accepts `{"riotId":"Name#TAG","region":"oce","mode":"mayhem","start":0,"count":20}`. Modes are allowlisted as `sr` and `mayhem`; omitted mode/start retain the legacy `sr`/0 defaults. Counts are 10 or 20. Start must be a nonnegative integer with `start + count <= 500`; the browser adjusts the final request to the remaining allowed page size. Mayhem adds `queue=2400` to the MATCH-V5 match-ID request and checks queue 2400 again in each detail response. SR keeps its existing map/queue scope. Regular ARAM is not aliased to Mayhem.

**Implementation assumption, not live verification:** this feature assumes MATCH-V5 can return Mayhem queue 2400 as requested. Development fixtures and browser mocks explicitly model that assumption. No successful real Mayhem history or augment payload has been verified for this implementation. The adapter does not bypass authentication or access restrictions, and it never substitutes fixtures for a failed live lookup.

Pagination metadata is flat under `source`: `mode`, `start`, `count`, `nextStart` and `hasMore`, alongside request/cache counts. The cursor advances over upstream IDs, including skipped or duplicate IDs, rather than the number of displayed matches. An initial empty result fails visibly; a later page with no valid matches can return `history: null` with warnings/cursor metadata. An exhausted page does not erase the current history. Successful refreshes and older pages merge only into matching account/server/mode data, deduplicate IDs and preserve user notes plus existing details. Fetches are bounded to one requested page; there is no automatic backfill or polling.

Region values are allowlisted in `server/riot.js`. ACCOUNT-V1 uses the globally replicated Asia cluster; SUMMONER-V4 confirms the selected platform; MATCH-V5 uses its regional route (OCE → oc1 / sea). Riot ID components are encoded separately and Unicode accents are preserved.

Configure `RIOT_API_KEY` as a secret in the Site environment, then deploy to apply that environment revision. Never put its value in `.openai/hosting.json`, browser files, Git, logs or URLs. `.env.example` documents the name only. `GET /api/status` returns a boolean indicating whether it is configured, never the value or proof of upstream validity. Authentication uses the platform's trusted `oai-authenticated-user-id` header; Sites access controls remain owner-only. Cross-origin browser requests and wrong content types are rejected before contacting Riot.

A completed match is selected by exact PUUID and checked against its requested match ID, result and required statistics. SR requires a supported map/queue and lane role; Mayhem requires queue 2400 without a Summoner’s Rift map/role assumption. Teammate kills are totaled only when all five teammate values are known. Optional data remains null. Unsupported queues and missing details have explicit warning reasons. Authentication/access errors, timeouts, throttling and provider outages fail visibly and leave the current dataset untouched rather than becoming an empty or fictional success.

Riot account/platform responses are cached for 10 minutes, match lists for 2 minutes and completed match details for 24 hours, using the Worker Cache API. Cache is opportunistic and per data center; it is not a permanent record store. Cache failure falls back to the provider. API keys and response authentication headers never enter cache. API output is private/no-store. Manual inputs remain browser-side, with the Mayhem snapshot policy described above. History v3 export/import includes normalized supplemental two-team/loadout details; it does not persist credentials or current rank responses.

Requests are paced at up to roughly 6 per second per route in a Worker isolate, with a conservative 90-per-120-second budget in that isolate. This is a courtesy limiter, not a globally coordinated quota: Riot remains authoritative across isolates, other applications and data centers. Every 429 halts further upstream calls on that route for the supplied Retry-After interval; successful earlier responses remain cached for a later retry. One bounded retry is allowed for 5xx responses. Timeout, missing account, wrong server, authentication and access errors are reported separately with sanitized messages. HTTP 403 uses neutral access wording: it does not establish that the API key expired. Riot’s [portal documentation](https://developer.riotgames.com/docs/portal) describes several possible forbidden-request causes involving keys, paths and permissions.

The client does not call Riot or OP.GG directly. Browser CSP permits only same-origin connections. No timeline analysis, live-game assistance or language-model API is implemented. Current lobby ranks are optional and never used for coaching thresholds. Official references: https://developer.riotgames.com/docs/lol, https://developer.riotgames.com/docs/portal, https://developer.riotgames.com/apis and https://developers.cloudflare.com/workers/runtime-apis/cache/.

## Hosting

`.openai/hosting.json` retains the original project ID. The former static deployment has been converted to a Worker serving the same frontend plus the API; no replacement Site was created. Sites, not the private badge, enforces owner-only access. Preserve that audience and deploy after secret updates. The source repository contains implementation only, not fetched account data or credentials.

### Local verification of Mayhem

A bounded live lookup using the account already prefilled in the local form reached the queue-filtered match list and returned `NO_MATCHES`. This verifies that this request received a response, **not** that Mayhem match-detail or augment payloads are available or correct. No live match payload was saved in the repository. The populated history, pagination, details, and browser flows are verified with clearly synthetic fixtures; queue 2400 remains the requested implementation assumption.
