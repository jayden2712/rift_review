# Rift Review — Riot history integration

Private, English/Vietnamese League of Legends history dashboard and post-match coaching workspace. Vanilla HTML/CSS/ES modules with a private Cloudflare Worker backend. No added dependencies or model calls. The server retrieves completed matches from Riot with a secret environment key. Summoner’s Rift history uses the existing coaching rules; ARAM Mayhem has separate post-match history and descriptive statistics without coaching. A history containing Mayhem can be saved on this browser, including match details; SR-only lookups stay in tab memory and do not replace that saved snapshot. On reload, a valid saved snapshot is restored, otherwise the app opens clearly labelled fictional data. JSON export/import remains available for backups. Source and hosting remain attached to the original private Site.

## Workflows

- Enter Riot ID, server, mode (**Summoner’s Rift** or **ARAM Mayhem**) and a 10/20-match page size. Refresh manually or load older pages, up to the 500-match/request-offset limit. There is no background polling.
- Use the integrated history filters to switch between SR queues and **ARAM Mayhem**. Mayhem is distinct from regular ARAM and Ranked; its statistics never include SR matches.
- Review wins/losses, win rate, pooled KDA/KP, per-champion records, damage, gold and available match details. Missing values remain unknown. Mayhem has no lane-role requirement, rank estimate, coaching signals or progress conclusions.
- Expand **Đồ thị thống kê / Statistics charts** in match history to view CS, KDA, kill participation, damage, gold, deaths and (SR only) vision over the selected matches. Select a point or use the slider and accessible data table. Champion win-rate bars include game counts. Charts follow the current filters across all result pages, exclude remakes, and keep missing values as gaps; deathless KDA is labelled rather than assigned an artificial number.
- Riot lookups and League client imports include the account's selected summoner icon. Existing saved histories gain it after a fresh lookup/import; older JSON without an icon still works. Images come through the same-origin `/api/profile-icon/{id}.png` endpoint from Riot Data Dragon, using `PROFILE_ICON_PATCH` in `server/riot.js` (currently 16.21.1). Initials remain visible when an icon is missing or unavailable; no Riot key is sent to the image CDN.
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

## ARAM Mayhem from the League client

Riot's public MATCH-V5 API does not return ARAM Mayhem games: Riot keeps them private by design ([developer-relations#1109](https://github.com/RiotGames/developer-relations/issues/1109)). The local server can instead read your own games from the League client running on the same computer:

1. Add `LCU_ENABLED=1` to `.env` (and `LCU_INSTALL_DIR` if League is not installed in a standard place), then `npm start`.
2. Open League of Legends and wait for the home screen.
3. Click **Nhập Mayhem từ client LoL / Import Mayhem from League client**. The button appears only when the feature is enabled; hover it to see the signed-in account.

The client only exposes its latest 20 games, so import regularly; each import merges into the saved Mayhem history of that account. Matches include all ten players, items, spells and augments (names and icons vendored by `python scripts/sync-augments.py`). The reader is read-only, limited to an allowlist of client paths, verifies TLS against Riot's published root certificate (`server/riotgames.pem`) and never sends the client password to the browser. It is local-only: the hosted Worker contains none of it. The League client API is unofficial and may change. Design notes: [docs/plans/lcu-mayhem-import.md](docs/plans/lcu-mayhem-import.md).

## AI summary for coaching (optional, local)

The coaching tab can turn its computed comparisons into written advice with a language model. The model never calculates: the browser sends the figures the app already computed (as full sentences, without any Riot ID), and the local server drops every sentence or focus item containing a number that is not in those figures, including any percentage or decimal; a number written as a percentage must also be a percentage in the figures. Whole counts up to 10 are allowed.

1. Install [Ollama](https://ollama.com) and pull a model, for example `ollama pull qwen3:4b-instruct` (about 2.5 GB; runs fully on an 8 GB GPU).
2. Add `AI_ENABLED=1` to `.env` (see `.env.example` for `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`), then `npm start`.
3. Look up a Riot ID, open **Báo cáo coaching** and click **Tóm tắt bằng AI / Summarise with AI**.

**Choosing a model.** Compared on the same data and style (RTX 5060 8 GB): `qwen3:4b-instruct` answers in about 5 s but sometimes reverses a comparison (for example calling a vision lead a weakness). `qwen3:8b` (5.2 GB, fits an 8 GB GPU) is clearly more accurate; with its default thinking it takes up to about 30 s, and with `AI_REASONING_EFFORT=none` it answers in about 5 s, at the cost of occasionally attaching a figure to the wrong metric. For `qwen3:8b` set `AI_MODEL=qwen3:8b` and usually `AI_REASONING_EFFORT=none`.

**Your own writing style.** Copy [docs/ai-style.example.md](docs/ai-style.example.md) to `.local/ai-style.md` (ignored by Git) and edit the tone, how the coach addresses you, the game terms to keep or translate, and one or two example paragraphs. The server re-reads the file on every click, so press **Viết lại / Rewrite** to see a change; no restart is needed. Use `AI_STYLE_FILE` for another path; at most 4000 characters are used. The style is added after the fixed rules and cannot switch off the number check. Small models copy examples closely, so write examples about a champion or situation you do not want repeated word for word, or keep them generic.

```bash
copy docsi-style.example.md .locali-style.md
```

Any OpenAI-compatible endpoint works by changing `AI_BASE_URL` and `AI_MODEL` (LM Studio, OpenRouter, Gemini's compatibility endpoint, OpenAI). Hosted providers receive the figures, so check their privacy terms. Small local models occasionally write impractical drills or causal wording; the panel labels the text as AI-written correlation. The hosted Worker contains none of this.

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

- **HTTP 403 in the browser Network tab for `/api/...`:** the local server rejected the request because its Host or Origin was not `localhost:<PORT>` / `127.0.0.1:<PORT>`, typically when it is reached through a proxy, tunnel, port forward or another host name. Open the URL printed by `npm start`.
- **"Rift Review API was not found" (`API_UNAVAILABLE`):** the page is served by another static server (Live Server, `npx serve`, opening the file directly), which has no `/api`. Open the URL printed by `npm start` instead.
- **HTTP 502 with "Riot từ chối quyền truy cập" / access denied:** Riot answered 403. Common causes are an expired or regenerated development key (they last 24 hours), a key without access to the endpoint, or a wrong route. Replace `RIOT_API_KEY` in `.env` and restart. See the [Riot portal documentation](https://developer.riotgames.com/docs/portal).
- **`NO_MATCHES` in ARAM Mayhem mode (Riot lookup):** expected. MATCH-V5 does not serve Mayhem games; use the League client import above.
- **"Could not reach the AI" (`AI_UNAVAILABLE`):** Ollama is not running or `AI_BASE_URL` is wrong. Start Ollama and check `ollama list` contains `AI_MODEL`. An HTTP error (`AI_UPSTREAM`) usually means the model name is not installed. If Ollama answers in a Windows browser at `http://127.0.0.1:11434` but the app still fails instantly, see the WSL entry below.
- **Server started inside WSL (AI or League client import fails immediately):** with WSL's default `nat` networking, `127.0.0.1` inside WSL is the Linux VM, not Windows, so a server started with `npm start` in a WSL shell cannot reach Ollama or the League client running on Windows (the browser can still open the app, because Windows forwards into WSL but not back). Check with `wsl.exe -e curl -s http://127.0.0.1:11434/api/version`: no answer means this is the cause. Fixes, simplest first:
  1. Run `npm start` from PowerShell or Command Prompt on Windows instead; `.env` and `.local/` are the same files.
  2. Keep WSL but share loopback with Windows: add `networkingMode=mirrored` under `[wsl2]` in `%USERPROFILE%\.wslconfig`, then run `wsl --shutdown` (closes every WSL window) and start again.
  3. Not recommended: expose Ollama with `OLLAMA_HOST=0.0.0.0` and point `AI_BASE_URL` at the Windows host IP; other devices on your network could then use your Ollama. The League client API cannot be reached this way.
- **"League client is not running" (`LCU_CLIENT_CLOSED`):** only the Riot Client launcher is open, or League is installed somewhere the server did not look. Start League of Legends, or set `LCU_INSTALL_DIR` to the folder that contains `LeagueClient.exe`.

## Hosting

`.openai/hosting.json` retains the original project ID. The former static deployment has been converted to a Worker serving the same frontend plus the API; no replacement Site was created. Sites, not the private badge, enforces owner-only access. Preserve that audience and deploy after secret updates. The source repository contains implementation only, not fetched account data or credentials.

### Local verification of Mayhem

On 2026-10-20 a MATCH-V5 lookup for an account with regular Mayhem games returned no queue 2400 IDs, confirming Riot does not serve them. The League client import was verified against a live client (patch 16.20, OC1): 19 Mayhem games with augments imported and rendered. One game, anonymised, is the fixture `tests/fixtures/lcu-mayhem-game.json`.

## Documentation

- [Architecture, analysis boundaries and Riot API integration](docs/architecture.md)
- [History v3 contract and on-device storage](docs/history-v3.md)
- [Game assets, match cards and lobby ranks](docs/assets.md)
- [Data Lab (tiếng Việt, local-only)](docs/data-lab.md)
