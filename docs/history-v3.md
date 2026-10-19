# History v3 contract

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

### Saving on this device

A non-sample history containing at least one Mayhem match is automatically saved under localStorage key `rift-review-history-v1`. The snapshot contains History v3 data and, when applicable, a validated lookup cursor. This is one latest active history/account snapshot, not a multi-account archive or database. Activating another Mayhem account replaces the previous saved snapshot; export JSON first to keep multiple histories. SR-only lookups and fictional samples do not overwrite the saved Mayhem history.

On reload, a valid snapshot is labelled as device data (`source: "device"`), not newly verified Riot data. Browser edits/imported source labels cannot turn it into authenticated provenance. Blocked storage, quota errors or oversized snapshots leave the current in-memory history and previous saved bytes intact and show a JSON-backup fallback. Device storage is specific to the browser/origin and can be cleared by the user; it is not cloud sync. API keys and current rank lookups are never persisted in it.
