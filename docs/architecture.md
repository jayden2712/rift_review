# Architecture

- `server/riot.js`: server-only ACCOUNT-V1, SUMMONER-V4, MATCH-V5 and LEAGUE-V4 client, routing allowlist, cache, Retry-After handling and PUUID-selected mapping.
- `server/worker.js`: authenticated same-origin JSON API, protected status route and static asset responses.
- `server/local.js`: loopback-only development HTTP server, public assets and adapter to the shared API.
- `server/local-config.js`: server-side `.env` loading, local port validation and explicit Data Lab flag.
- `server/data-lab.js`: local-only collection and bounded UUID snapshot storage; never bundled into the hosted Worker.
- `public/data-lab-model.js` / `data-lab-metrics.js`: versioned snapshots, original/projection provenance, normalized records and explicit metric denominators.
- `public/data-lab-findings.js`: rules-based findings, linked evidence and structured coaching exports.
- `public/data-lab.js` / `data-lab-view.js`: local-only inspector UI and shared filtered cohort.
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

### Analysis boundaries

Mode is selected before statistics: Mayhem and SR never share aggregate metrics, champion records or trend/coaching cohorts. Filters and the newest-N limit define the current scope. Confirmed Mayhem remakes remain visible but do not count toward aggregate statistics. Mayhem has descriptive statistics only: no SR CS/vision/death/KP thresholds, coaching messages, progress comparison or augment recommendations. For SR, evidence navigation only narrows the visible match list while preserving the report's wider scope.

KDA is total kills plus assists divided by total deaths, not an average of match KDA. Per-minute fields use total known values divided by their matches' total minutes. KP uses pooled kills and assists divided by pooled team kills, excluding unknown and zero-denominator matches. Zero deaths with no kills/assists displays unknown, not a perfect performance. Missing values are never replaced with zero.

SR rules are illustrative practice targets, not calibrated rank, patch or champion benchmarks. A recurring problem requires at least five eligible observations, at least three flagged matches, and at least 30% flagged. Strengths require at least three matches and at least 60% of eligible observations. These are practice heuristics, not statistical confidence. Each signal uses its own eligible denominator; Support is excluded from farm checks. Priorities rank repetition first, then observed frequency times the rule's review weight.

No replay, timeline, positioning, mechanics, item builds or death causes are inferred from scoreboard data. Player notes are displayed unchanged and never alter analysis. Damage and gold are descriptive, without invented rank targets. Trend comparisons keep the same role but do not control for champion, patch, matchup or opponent; they are descriptive changes, not proof of improvement.

### Live Riot data and secrets

`POST /api/history` accepts `{"riotId":"Name#TAG","region":"oce","mode":"mayhem","start":0,"count":20}`. Modes are allowlisted as `sr` and `mayhem`; omitted mode/start retain the legacy `sr`/0 defaults. Counts are 10 or 20. Start must be a nonnegative integer with `start + count <= 500`; the browser adjusts the final request to the remaining allowed page size. Mayhem adds `queue=2400` to the MATCH-V5 match-ID request and checks queue 2400 again in each detail response. SR keeps its existing map/queue scope. Regular ARAM is not aliased to Mayhem.

**Implementation assumption, not live verification:** this feature assumes MATCH-V5 can return Mayhem queue 2400 as requested. Development fixtures and browser mocks explicitly model that assumption. No successful real Mayhem history or augment payload has been verified for this implementation. The adapter does not bypass authentication or access restrictions, and it never substitutes fixtures for a failed live lookup.

Pagination metadata is flat under `source`: `mode`, `start`, `count`, `nextStart` and `hasMore`, alongside request/cache counts. The cursor advances over upstream IDs, including skipped or duplicate IDs, rather than the number of displayed matches. An initial empty result fails visibly; a later page with no valid matches can return `history: null` with warnings/cursor metadata. An exhausted page does not erase the current history. Successful refreshes and older pages merge only into matching account/server/mode data, deduplicate IDs and preserve user notes plus existing details. Fetches are bounded to one requested page; there is no automatic backfill or polling.

Region values are allowlisted in `server/riot.js`. ACCOUNT-V1 uses the globally replicated Asia cluster; SUMMONER-V4 confirms the selected platform; MATCH-V5 uses its regional route (OCE → oc1 / sea). Riot ID components are encoded separately and Unicode accents are preserved.

Configure `RIOT_API_KEY` as a secret in the Site environment, then deploy to apply that environment revision. Never put its value in `.openai/hosting.json`, browser files, Git, logs or URLs. `.env.example` documents the name only. `GET /api/status` returns a boolean indicating whether it is configured, never the value or proof of upstream validity. Authentication uses the platform's trusted `oai-authenticated-user-id` header; Sites access controls remain owner-only. Cross-origin browser requests and wrong content types are rejected before contacting Riot.

A completed match is selected by exact PUUID and checked against its requested match ID, result and required statistics. SR requires a supported map/queue and lane role; Mayhem requires queue 2400 without a Summoner’s Rift map/role assumption. Teammate kills are totaled only when all five teammate values are known. Optional data remains null. Unsupported queues and missing details have explicit warning reasons. Authentication/access errors, timeouts, throttling and provider outages fail visibly and leave the current dataset untouched rather than becoming an empty or fictional success.

Riot account/platform responses are cached for 10 minutes, match lists for 2 minutes and completed match details for 24 hours, using the Worker Cache API. Cache is opportunistic and per data center; it is not a permanent record store. Cache failure falls back to the provider. API keys and response authentication headers never enter cache. API output is private/no-store. Manual inputs remain browser-side, with the Mayhem snapshot policy described above. History v3 export/import includes normalized supplemental two-team/loadout details; it does not persist credentials or current rank responses.

Requests are paced at up to roughly 6 per second per route in a Worker isolate, with a conservative 90-per-120-second budget in that isolate. This is a courtesy limiter, not a globally coordinated quota: Riot remains authoritative across isolates, other applications and data centers. Every 429 halts further upstream calls on that route for the supplied Retry-After interval; successful earlier responses remain cached for a later retry. One bounded retry is allowed for 5xx responses. Timeout, missing account, wrong server, authentication and access errors are reported separately with sanitized messages. HTTP 403 uses neutral access wording: it does not establish that the API key expired. Riot’s [portal documentation](https://developer.riotgames.com/docs/portal) describes several possible forbidden-request causes involving keys, paths and permissions.

The client does not call Riot or OP.GG directly. Browser CSP permits only same-origin connections. No timeline analysis, live-game assistance or language-model API is implemented. Current lobby ranks are optional and never used for coaching thresholds. Official references: https://developer.riotgames.com/docs/lol, https://developer.riotgames.com/docs/portal, https://developer.riotgames.com/apis and https://developers.cloudflare.com/workers/runtime-apis/cache/.

## League client import (local only)

- `server/lcu.js`: finds the client lockfile (`LCU_INSTALL_DIR`, Riot metadata, default path), talks HTTPS to `127.0.0.1` with Basic auth, verifies TLS against `server/riotgames.pem`, and only issues GETs to an allowlist of paths. `loadLcuMayhem` returns the same `{history, details, warnings, source}` envelope as `/api/history`, with `source.provider = 'lcu'`.
- `server/lcu-map.js`: maps client games (`/lol-match-history/v1/games/{id}`) to History v3; augments come from `stats.playerAugment1..6`, champion names from `champion-summary.json` aliases.
- `server/lcu-api.js`: `GET /api/lcu/status` and `POST /api/lcu/import`, mounted by `server/local.js` only when `LCU_ENABLED=1`. `build.mjs` never embeds these modules, so the hosted Worker answers 404.
- Browser: `lcuDataSource` in `public/riot-source.js`, the import button in `public/app.js`, augment rendering in `public/match-view.js` with names and icons from `public/augment-assets.js` and `public/augments/`.
