# Rift Review — Riot history integration

Private, Vietnamese League of Legends history dashboard and post-match coaching workspace. Vanilla HTML/CSS/ES modules with a private Cloudflare Worker backend. No added dependencies or model calls. The server retrieves completed matches from Riot with a secret environment key. Browser state stays in tab memory; refreshing opens clearly labeled fictional data until a lookup or import is performed. Export/import JSON preserves a user's history between sessions. Source and hosting remain attached to the original private Site.

## Workflows

- Enter Riot ID, server and a 10/20-match limit to retrieve real recent matches. The supplied test account is prefilled with OCE. A match detail panel includes statistics for both teams.

- Review the latest 10, 20, 50, 100, or up to 500 eligible matches, filtered by queue, champion and role.
- See weighted aggregate stats, per-champion records, role distribution, individual match details, and data coverage.
- Compare two adjacent groups of 5–10 matches of the dominant role in the selected sample. At least five known observations per group are required for each optional metric.
- Read strengths, recurring review signals, and two measurable priorities for the next five matches. Open the exact matches supporting each finding.
- Paste history JSON, choose a local JSON file, or add one match manually. The first personal match replaces the fictional sample. Replacing a dataset can be undone once in memory.
- Copy or download the scoped coaching report, or export the complete input history as JSON.

## Local commands

`npm start` serves only the static UI at port 4173; live API routes require the hosted Worker. `npm test` runs all domain tests. `npm run build` embeds the existing public assets and server modules in a self-contained Worker entrypoint at `dist/server/index.js`. The build manifest is copied to `dist/.openai/hosting.json`. Managed Sites preview limitations apply; the current update was checked with domain tests, static HTML/CSS/asset checks, and JavaScript syntax validation, without browser layout testing.

## Architecture

- `server/riot.js`: server-only ACCOUNT-V1, SUMMONER-V4 and MATCH-V5 client, routing allowlist, cache, Retry-After handling and PUUID-selected mapping.
- `server/worker.js`: authenticated same-origin JSON API, protected status route and static asset responses.
- `public/riot-source.js`: live provider adapter; validates the same History v2 contract used by manual data.
- `public/data.js`: legacy Match v1 validator and adapters; still accepts single-match input. Short durations are permitted only for the history validator, which subsequently excludes them from coaching.
- `public/history-data.js`: History v2 validation, manual/JSON provider boundary, fictional samples, source export, supported-queue exclusions. An approved backend can later return the same normalized contract.
- `public/coach.js`: original transparent per-match rules. Existing tests and provider remain intact.
- `public/history-coach.js`: pure selection, aggregation, role cohorts, evidence counts, coaching priorities, and Markdown export.
- `public/app.js`: view state, input validation UI, filters, match details, evidence navigation, export and scoped rendering. User input is HTML-escaped. Data-source labels are controlled by the app, never treated as a verified identity.
- `public/styles.css`: original responsive dark interface, retaining Rift Review's purple/lime identity and adding blue/red match rows.

## History v2 contract

```json
{
  "schemaVersion": 2,
  "profile": {"riotId": "Example#TAG", "region": "OCE", "rank": ""},
  "matches": [
    {
      "id": "example-1",
      "playedAt": "2026-09-14T10:30:00Z",
      "queue": "Ranked Solo",
      "champion": "Ahri",
      "role": "Mid",
      "result": "Victory",
      "durationMinutes": 30,
      "kills": 6, "deaths": 4, "assists": 12,
      "cs": 198, "visionScore": 25, "teamKills": 28,
      "damageToChampions": 22000, "goldEarned": 13000,
      "notes": "", "isRemake": false
    }
  ]
}
```

The root may also be an array, or a legacy single-match object. Required match fields: champion, role, result, durationMinutes, kills, deaths, assists. Optional numeric fields stay null when omitted or blank. Profile values are display labels supplied by the user, not authenticated Riot values. Rank is never inferred.

Queue values: Ranked Solo, Ranked Flex, Normal, Standard (standard Summoner's Rift with unspecified queue), ARAM, Other. A missing queue preserves the old standard-SR scope as Standard, without inventing a ranked queue. ARAM, Other, remakes and matches under five minutes are preserved in the export but excluded from all reports. Unsupported role labels are rejected rather than silently mapped.

If every match has a timezone-qualified ISO timestamp, sort newest first. If any timestamp is absent, preserve the entire input order, explicitly requiring newest first. Duplicate match IDs reject the import. Generated IDs for records without IDs are import-local; identical stats alone are not treated as a duplicate. Imports are atomic and limited to 500 matches and two million characters/bytes for text/files respectively.

## Analysis boundaries

All top-level metrics, sidebars and coaching use the same selected subset: eligible queues, then filters, then newest-N limit. Evidence navigation only narrows the visible match list; its banner explicitly preserves the report's wider scope.

KDA is total kills plus assists divided by total deaths, not an average of match KDA. Per-minute fields use total known values divided by their matches' total minutes. KP uses pooled kills and assists divided by pooled team kills, excluding unknown and zero-denominator matches. Zero deaths with no kills/assists displays unknown, not a perfect performance. Missing values are never replaced with zero.

Rules are illustrative practice targets, not calibrated rank, patch or champion benchmarks. A recurring problem requires at least five eligible observations, at least three flagged matches, and at least 30% flagged. Strengths require at least three matches and at least 60% of eligible observations. These are practice heuristics, not statistical confidence. Each signal uses its own eligible denominator; Support is excluded from farm checks. Priorities rank repetition first, then observed frequency times the rule's review weight.

No replay, timeline, positioning, mechanics, item builds or death causes are inferred from scoreboard data. Player notes are displayed unchanged and never alter analysis. Damage and gold are descriptive, without invented rank targets. Trend comparisons keep the same role but do not control for champion, patch, matchup or opponent; they are descriptive changes, not proof of improvement.

## Live Riot data and secrets

`POST /api/history` accepts `{"riotId":"Name#TAG","region":"oce","count":20}`. Supported counts are 10 and 20. Region values are allowlisted in `server/riot.js`. ACCOUNT-V1 uses the globally replicated Asia cluster; SUMMONER-V4 confirms the selected platform; MATCH-V5 uses the platform's regional route (OCE → oc1 / sea). Riot ID components are encoded separately and Unicode accents are preserved.

Configure `RIOT_API_KEY` as a secret in the Site environment, then deploy to apply that environment revision. Never put its value in `.openai/hosting.json`, browser files, Git, logs or URLs. `.env.example` documents the name only. `GET /api/status` returns a boolean indicating whether it is configured, never the value or proof of upstream validity. Authentication uses the platform's trusted `oai-authenticated-user-id` header; Sites access controls remain owner-only. Cross-origin browser requests and wrong content types are rejected before contacting Riot.

A completed match is selected by exact PUUID and checked against its requested match ID. Champion, role, outcome, KDA, CS (lane + neutral), gold, champion damage and vision are mapped. Teammate kill totals are used only when all five teammates have known values. Optional stats remain null. The original coaching filters and limits still apply. Non-SR queues, games under five minutes, unknown positions and games over 90 minutes are skipped with explicit counts. Missing upstream match details can be skipped; key errors, throttling and provider outages fail visibly instead of turning into empty or fictional results.

Riot account/platform responses are cached for 10 minutes, match lists for 2 minutes and completed match details for 24 hours, using the Worker Cache API. Cache is opportunistic and per data center; it is not a permanent record store. Cache failure falls back to the provider. API keys and response authentication headers never enter cache. API output is private/no-store. Manual inputs remain browser-only, and JSON export/import remains available. Supplemental two-team tables are available in the live session; History v2 export contains the selected player's normalized records.

Requests are paced at up to roughly 6 per second per route in a Worker isolate, with a conservative 90-per-120-second budget in that isolate. This is a courtesy limiter, not a globally coordinated quota: Riot remains authoritative across isolates, other applications and data centers. Every 429 halts further upstream calls on that route for the supplied Retry-After interval; successful earlier responses remain cached for a later retry. One bounded retry is allowed for 5xx responses. Timeout, missing account, wrong server and rejected-key messages are sanitized.

The client does not call Riot or OP.GG directly. Browser CSP permits only same-origin connections. No timeline analysis, live-game assistance, rank retrieval or language-model API is implemented yet. Official references: https://developer.riotgames.com/docs/lol, https://developer.riotgames.com/docs/portal, https://developer.riotgames.com/apis and https://developers.cloudflare.com/workers/runtime-apis/cache/.

## Hosting

`.openai/hosting.json` retains the original project ID. The former static deployment has been converted to a Worker serving the same frontend plus the API; no replacement Site was created. Sites, not the private badge, enforces owner-only access. Preserve that audience and deploy after secret updates. The source repository contains implementation only, not fetched account data or credentials.
