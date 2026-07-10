# Guruji

A calm, single-user **study-coach PWA**. It ingests a study plan (JSON) and does
one job: given the current day and time, it tells you the **single thing to study
right now** — then runs a distraction-free Pomodoro focus session and tracks what
you finished.

No menus, no backend, no accounts, no notifications. The intelligence lives in the
data; the app just runs it.

## What it does (v1)

- **Now** — the home screen. From your schedule it works out which *pocket* you're
  in (Desk / Transit / Wind-down) and surfaces exactly **one** `todo` item of that
  mode whose dependencies are all done. One line, one Start button. If no pocket is
  active, it shows the next one and what it'll hold.
- **Focus** — full-screen Pomodoro (25 on / 5 off, long break after 4). Only Pause
  and End. A brief start ritual. On End you mark the item done / not-finished /
  skipped, and the session is logged.
- **Week** — a read-only day×time grid of your pockets, colored by mode, with the
  current hour highlighted and non-study time muted.
- **Plan** — every item grouped by phase; mark items done or skipped by hand.
  Dependency-gated items show what they're waiting on.
- **Data** — import a plan from a file *or* pasted JSON; export your whole state
  (plan + schedule + statuses + log) to a JSON file for backup.

## Privacy — this repo is public

**No personal data is ever committed.** Your plan and all progress live only in
your browser's **IndexedDB** (not localStorage — iOS evicts that for home-screen
PWAs). The only way data leaves the device is the export file *you* download.
`.gitignore` blocks `plan.json` and any `*-export.json` so a real plan can't be
committed by accident.

Sync between devices is manual and yours to control: **export → drop the file in
iCloud Drive → import on the other device.**

## Run locally

No build step, no dependencies. Serve the folder over HTTP (a service worker needs
http/https, not `file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

Pushing to the default branch triggers `.github/workflows/deploy-pages.yml`, which
publishes the repo root as a static site. Enable Pages once under
**Settings → Pages → Source: GitHub Actions**. The app is path-relative, so it works
from `https://<user>.github.io/guruji/`.

## Install as an app

- **iOS/iPadOS:** open the deployed URL in Safari → Share → *Add to Home Screen*.
- **macOS (Safari):** File → *Add to Dock*. (Chrome/Edge: the install icon in the
  address bar.)

Once installed it works offline — the service worker precaches the shell.

## The plan format

The app ingests one JSON plan: a list of **phases**, each with **items**. Every item
has `id`, `title`, `phase`, `week`, `mode` (`DESK` | `TRANSIT` | `WIND_DOWN`),
`estMinutes`, `dependsOn` (array of item ids), and `status`
(`todo` | `done` | `skipped`). The plan may also carry a `schedule` (weekly pockets)
which seeds the schedule editor on first import.

See [`docs/plan.example.json`](docs/plan.example.json) for a minimal, non-personal
example. Keep your real plan in iCloud Drive — never in this repo.

## Tech

Plain HTML + vanilla ES modules. IndexedDB for storage. A cache-first service worker
for offline. Zero runtime dependencies.
