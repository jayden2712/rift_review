# Game assets and match cards

### Champion icons

Champion portraits are bundled under `public/champions/` from the current [League of Legends Wiki champion catalog](https://wiki.leagueoflegends.com/en-us/List_of_champions). The 173 PNGs are unmodified 128×128 original square portraits, with normalized filenames. `scripts/champion-icon-sources.json` records the exact source URL and SHA-256 for each image. Artwork belongs to Riot Games.

`public/champion-icons.js` resolves display names and Riot IDs, including MonkeyKing/Wukong, Nunu/Nunu & Willump, and Renata/Renata Glasc. History rows, champion statistics and both-team participant tables use these local portraits. Unknown champions or failed image loads retain initials. The local server serves PNGs directly and the hosted build embeds their binary data. Refresh existing portraits with `python3 scripts/sync-wiki-champions.py`; when supporting a newly released champion, also add its identity to the helper list. No image CDN requests or CSP exceptions are required at runtime.

### Match cards, loadouts and lobby ranks

Match cards show champion level, two summoner spells, the keystone and secondary rune path, seven ordered inventory slots (including trinket), KDA, CS/KP/vision and compact team rosters. Expanding a match shows the complete primary/secondary rune selections and three stat shards, plus the separately styled blue/red scoreboards. Match duration is displayed as `31m05s`; source values and per-minute coaching calculations retain their numeric units.

Riot MATCH-V5 metadata stays in `details[matchId]`: `durationSeconds` and participants with `championLevel`, `summonerSpells`, `items` and `runes`. Missing IDs are unknown; item ID 0 is an empty inventory slot. An unavailable icon keeps a labelled fallback. The sample history has explicitly fictional loadouts/ranks; imported or manual matches never acquire invented metadata. History v3 JSON export/import now preserves supported participant/loadout metadata. Current lobby-rank snapshots are not included in the history contract. Mayhem augments are explicitly unknown until their Riot payload is verified; they are never inferred from items or runes.

The **Xem rank lobby** button calls `POST /api/lobby-rank` with `{"matchId":"OC1_123","region":"oce"}`. It fetches current LEAGUE-V4 ranks for the players in that completed match: Solo/Duo for queue 420, Flex for queue 440. The displayed average uses ordinal tier/division positions, excludes confirmed unranked and unknown players, and shows coverage such as 8/10. Master, Grandmaster and Challenger are distinct top positions without invented LP divisions. This is a descriptive average of **current ranks**, not historical match-time rank or MMR. The response includes `asOf`, `basis:"current"`, counts and a five-minute cache TTL. Unknown rank data is distinguished from confirmed unranked players.

Mayhem does not request or display SR lobby rank as Mayhem rank/MMR. For supported Ranked queues, rank lookup runs only when requested, one lobby at a time in the browser, so opening 20 matches does not automatically trigger 200 extra upstream calls. Existing Riot throttling/cooldown still applies. Errors and retry messages affect only that lobby badge; match history and coaching remain intact. No external OP.GG data endpoints are used.

`public/game-assets.js` resolves local icons and English/Vietnamese names using pinned Riot Data Dragon **16.19.1** metadata. All artwork previously sourced from the older TheePepS collection has been replaced. Bundled sources are:

- **173 champion portraits**, **33 of 34 summoner spells**, **76 runes/styles/shards**, and **10 rank badges**, including Emerald: League of Legends Wiki.
- **303 of 316 items**: League of Legends Wiki. The other 13 internal/special entries use current pinned Riot Data Dragon artwork.
- Spell ID **54** (`Placeholder`) has no exact Wiki catalog image and uses pinned Riot Data Dragon artwork. Legacy IDs remain supported using images for their actual identities.

The manifests `scripts/champion-icon-sources.json`, `scripts/item-icon-sources.json`, `scripts/spell-icon-sources.json` and `scripts/rune-rank-icon-sources.json` record exact URLs and SHA-256 hashes; Riot fallbacks include a reason. Files live under `public/champions/`, `public/items/`, `public/spells/`, `public/runes/` and `public/ranks/`. Icons are a current reference set, not a reconstruction of historical match patches. A year in an official rank image filename does not imply a fallback to the old repository: the importer selects the current Wiki rank table.

Refresh all groups intentionally with `python3 scripts/sync-game-assets.py`; update its pinned `VERSION` when adopting a new Data Dragon release. Existing images are overwritten after all downloads in their group validate. `--items-spells-only` refreshes those two groups using separately synced rune/rank files. The importer stops on unexpected or blocked catalog HTML, and passes freshly fetched rune IDs/names to the rune importer. Normal build/start uses only bundled local files and makes no Wiki image requests.

Verify with `npm test`, `npm run build`, and `for test in tests/wiki-*.test.py; do python3 "$test" || exit 1; done`. Sources: [Wiki items](https://wiki.leagueoflegends.com/en-us/Item), [summoner spells](https://wiki.leagueoflegends.com/en-us/Summoner_spell), [runes](https://wiki.leagueoflegends.com/en-us/Rune), [ranks](https://wiki.leagueoflegends.com/en-us/Rank_(League_of_Legends)), and [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon).
