# Windows desktop

The desktop entry point is `desktop/main.js`. Electron hosts the existing frontend and starts `createLocalServer` in the main process; renderer Node integration is off, context isolation and sandboxing are on. No preload or privileged IPC is exposed. The server binds only to `127.0.0.1` and retains its Host/origin checks and Riot TLS certificate validation. Browser navigation stays on the app origin; new windows, webviews and unrelated permissions are denied. Clipboard writing remains available for copying reports. JSON and Markdown exports use the native save dialog.

## Running and packaging

For development on Node 22.12+:

```powershell
npm ci
npm run desktop
npm run desktop:build
```

The build creates `release/Rift-Review-2.1.0-Windows-x64.exe` and the unpacked `release/win-unpacked/Rift Review.exe`. Use the single portable EXE for normal use; the unpacked EXE needs all adjacent files. Electron and builder versions are pinned in the lockfile. The EXE has the app's existing logo and requests normal user privileges. It is not code signed and is not published automatically.

The builder's explicit file list includes the frontend, all local backend modules, the LCU certificate, and blank default configuration. It excludes real `.env`, `.local`, tests, source history and development dependencies. Updates should replace the EXE while it is closed; settings are stored separately. NSIS extracts to a unique temporary directory on every launch. Restart launches the portable wrapper again, rather than the temporary extracted EXE. A second instance focuses the existing window; it never attaches to an unrelated service occupying the selected port.

## Settings and data

The normal user-data directory is `%APPDATA%/Rift Review`. The native **Ứng dụng** menu can open this folder, edit `.env` in Notepad, import an existing `.env` and restart. Imported settings are parsed as data: arbitrary environment keys cannot change Electron's process environment. The importer copies an available AI style to `.local/ai-style.md` and up to 100 Data Lab JSON snapshots to `.local/data-lab`, never replacing existing style/snapshot files. Replaced config is kept in `.env.backup-<timestamp>`. Configuration and backups may contain API keys and should remain private.

Fresh installs enable the local League client reader and leave Riot API credentials, optional AI and Data Lab unconfigured/off. Import the existing project's `.env` to retain its selected features. The League client and Ollama are external applications; desktop does not install or start them. Riot network calls still require a valid key, except the public profile icon CDN.

The desktop uses the stable origin `http://127.0.0.1:4179`, separate from web `PORT=4173`, and a persistent Chromium partition. Mayhem history, language and practice-plan preferences use the same existing storage rules. SR-only history remains in memory. Desktop cannot inherit another browser's localStorage: use JSON export/import for history. Changing `DESKTOP_PORT` changes the storage origin; export JSON first if that is necessary. If the port is occupied, startup reports an error without connecting to the unknown service.

For an isolated local verification, `--rift-data-dir=<absolute-directory>` changes the data folder. `--import-config=<absolute-env-file>` is a one-time first-launch migration, ignored when desktop `.env` already exists. These flags do not embed settings in the EXE.

## Verification

`tests/desktop.test.js` covers configuration parsing, first-run migration, backup/no-overwrite behavior, stable paths, the packaging allowlist, shared API access/origin boundaries, port conflicts and shutdown. The Windows CI job also builds the portable executable. Check actual releases by opening the portable EXE, switching SR/Mayhem, opening charts and match details, importing/exporting JSON, restarting and reopening saved Mayhem history. Verify live Riot/client/AI connections separately when those services are available.

Packaging follows [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security) and [electron-builder's portable target](https://www.electron.build/v26/nsis/).
