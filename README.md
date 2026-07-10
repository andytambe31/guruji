# Guruji

A calm, single-user **study-coach PWA**. It ingests a study plan (JSON) and does
one job: hand you the **single thing to study right now** and let you say
*"I'm sitting down for N minutes"* — then it runs a distraction-free timer and
tracks what you finished.

No schedule to configure, no menus, no backend, no accounts, no notifications.
The intelligence lives in the data; the app just runs it.

## What it does (v1)

- **Now** — the dashboard. Shows the one next `todo` item whose dependencies are
  all done. Pick your context (Desk / Transit / Wind-down) if you want a
  different kind of task, choose how long you're sitting (25 / 50 / 90 min), and
  **Sit down**. That's the whole interaction — no weekly schedule to set up.
- **Focus** — a full-screen timer for the length you chose. Only Pause and End.
  When time's up (or you End), you mark the item done / not-finished / skipped
  and the session is logged.
- **Plan** — every item grouped by phase with a progress bar; mark items done or
  skipped by hand. Dependency-locked items show what they're waiting on.
- **Data** — import a plan from a file *or* pasted JSON; export your whole state
  (plan + statuses + log) to a JSON file for backup.

## Privacy — this repo is public

**No personal data is ever committed.** Your plan and all progress live only in
your browser's **IndexedDB** (not localStorage — iOS evicts that for home-screen
PWAs). The only way data leaves the device is the export file *you* download.
`.gitignore` blocks `plan.json` and any `*-export.json`.

Sync between devices is manual and yours to control: **export → drop the file in
iCloud Drive → import on the other device.**

## Run locally

No build step, no dependencies. Serve the folder over HTTP (a service worker
needs http/https, not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

Pushing to the default branch triggers `.github/workflows/deploy-pages.yml`,
which publishes the repo root as a static site. Enable Pages once under
**Settings → Pages → Source: GitHub Actions**. The app is path-relative, so it
works from `https://<user>.github.io/guruji/`.

## Install as an app

- **iOS/iPadOS:** open the deployed URL in Safari → Share → *Add to Home Screen*.
- **macOS (Safari):** File → *Add to Dock*. (Chrome/Edge: the install icon in the
  address bar.)

Once installed it works offline — the service worker precaches the shell.

## The plan format

The app ingests one JSON plan: a list of **phases**, each with **items**. Every
item has `id`, `title`, `phase`, `week`, `mode` (`DESK` | `TRANSIT` |
`WIND_DOWN`), `estMinutes`, `dependsOn` (array of item ids), and `status`
(`todo` | `done` | `skipped`). `mode` is used only as the "what are you doing
right now" switch on the dashboard; `dependsOn` gates what gets surfaced.

See [`docs/plan.example.json`](docs/plan.example.json) for a minimal example.
Keep your real plan in iCloud Drive — never in this repo.

## Tech

Plain HTML + vanilla ES modules. IndexedDB for storage. A cache-first service
worker for offline. Zero runtime dependencies.
