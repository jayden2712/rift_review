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

The development server binds only to `127.0.0.1` and accepts `localhost` or `127.0.0.1` with its listening port. Local requests do not require a hosted login: the adapter checks the peer, Host and browser origin before supplying a local identity to the shared API. It rejects cross-origin requests and limits existing API bodies to 2 KB; explicitly enabled Data Lab routes have a separate 8 MiB limit. Use the hosted Worker for deployment; do not expose the local adapter through a proxy or tunnel. The hosted authentication path is unchanged. Local lookups use the existing Riot throttling/retries and a bounded memory cache (128 entries, maximum 524,288 JSON string code units per entry). Restarting clears local cache and throttling state; hosted deployments use the Worker Cache API.

`npm test` runs domain, translation and local HTTP integration tests; `python3 tests/wiki-assets.test.py` checks the wiki importer. The Node suite also checks the browser data provider against mocked Riot responses. `npm run build` embeds the existing public assets and hosted server modules in a self-contained Worker entrypoint at `dist/server/index.js`; it does not include `.env`, the local adapter, Data Lab server code or any `public/data-lab*` assets. The build manifest is copied to `dist/.openai/hosting.json`. The optional browser regression script uses mocked Riot responses, not a live key. With Playwright and its browser installed outside the repository, run:

```bash
PLAYWRIGHT_MODULE=/tmp/rift-mayhem-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/rift-mayhem-browser/browsers \
node tests/e2e/mayhem.mjs
```

These example paths can be changed to an existing Playwright installation. They add no runtime dependency to the project. Tests/build and browser mocks do not verify live Mayhem availability.

## Development

```bash
npm install          # dev tools only: ESLint and Prettier
npm run lint
npm run format       # or format:check
```

CI (`.github/workflows/ci.yml`) runs lint, format check, Node tests, the Worker build and the Python importer tests on Ubuntu and Windows. Symlink tests are skipped on Windows without Developer Mode.

## Interface language

Use the **VI / EN** control in the upper-right corner to switch Vietnamese and English. The choice is stored as `rift-review-language` in browser localStorage; if browser storage is unavailable, switching still works for the current session. This language preference is independent of the separate history snapshot; neither stores API credentials.

Navigation, forms, accessible labels, dynamic statistics/coaching, loadout names, errors and report exports follow the selected language. Riot IDs, champion identities, notes and imported data remain unchanged. Queue/role values in JSON and form submissions remain canonical, independent of their display labels. Changing language preserves filters, the selected tab, open match details and in-progress form input.

`public/i18n.js` provides explicit source-string translations and interpolation; dictionaries are split into static, app, match and domain modules. Add translations at rendering/validation boundaries rather than rewriting arbitrary DOM text or user data.

## Troubleshooting

- **HTTP 403 in the browser Network tab for `/api/...`:** the local server rejected the request because the page was not opened from `http://localhost:<PORT>` or `http://127.0.0.1:<PORT>` (for example Live Server on port 5500, a LAN IP or `[::1]`). Open the URL printed by `npm start`.
- **HTTP 502 with "Riot từ chối quyền truy cập" / access denied:** Riot answered 403. Common causes are an expired or regenerated development key (they last 24 hours), a key without access to the endpoint, or a wrong route. Replace `RIOT_API_KEY` in `.env` and restart. See the [Riot portal documentation](https://developer.riotgames.com/docs/portal).
- **`NO_MATCHES` in ARAM Mayhem mode:** the account has no queue 2400 matches in the requested page. Mayhem is a rotating mode, so this is expected outside its rotation.

## Hosting

`.openai/hosting.json` retains the original project ID. The former static deployment has been converted to a Worker serving the same frontend plus the API; no replacement Site was created. Sites, not the private badge, enforces owner-only access. Preserve that audience and deploy after secret updates. The source repository contains implementation only, not fetched account data or credentials.

### Local verification of Mayhem

A bounded live lookup using the account already prefilled in the local form reached the queue-filtered match list and returned `NO_MATCHES`. This verifies that this request received a response, **not** that Mayhem match-detail or augment payloads are available or correct. No live match payload was saved in the repository. The populated history, pagination, details, and browser flows are verified with clearly synthetic fixtures; queue 2400 remains the requested implementation assumption.

## Documentation

- [Architecture, analysis boundaries and Riot API integration](docs/architecture.md)
- [History v3 contract and on-device storage](docs/history-v3.md)
- [Game assets, match cards and lobby ranks](docs/assets.md)
- [Data Lab (tiếng Việt, local-only)](docs/data-lab.md)
