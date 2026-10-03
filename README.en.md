# Photo World

> A local photo / video metadata management and search system — runs entirely on your machine, no cloud, no external database service.

Photo World is a photo / video management tool that runs on your own computer. It focuses on **metadata management, organization, and multi-dimensional search** — no thumbnails, and it never uploads your photos anywhere. The library follows a two-level "**year / YYYYMMDD+topic**" convention: pick a year, select topics, and import in one click. Once imported, it scans recursively in the background, parsing file name, MD5, capture time, resolution, EXIF, GPS, duration, codec and more into a local SQLite database, so you can quickly find any shot through filters, sorting, duplicate detection, and a map.

中文版 (Chinese): [README.md](./README.md)

---

## Features

- **Local-first**: all data lives in a local `data/photo_world.db` (SQLite + WAL). No network, no cloud.
- **Year / topic folder convention**: the library is organized as `2026/20260101-newyear`. Enter the library root or a year path and the system lists all topic directories, parsing date and topic name, counting files and marking imported ones — select and import in bulk.
- **Multi-format parsing**:
  - Images: JPG / JPEG, HEIC (iPhone captures), WEBP, PNG, TIFF, etc. (sharp-supported).
  - Videos: MOV, MP4, AVI (duration / codec / resolution / GPS / device via ffprobe).
- **iPhone Live Photos**: automatically recognizes same-name HEIC + MOV pairs in the same folder and marks them as Live Photos (`is_livephoto`).
- **Full EXIF / GPS**: camera make, model, lens, aperture, shutter, ISO, focal length, orientation, latitude / longitude / altitude — all stored.
- **Incremental scanning**: skips unchanged files by mtime + size, so re-scans finish in seconds; can be cancelled mid-run.
- **Sequential scan queue**: batch imports and year-wide re-scans run one job at a time (`queued → running`) instead of hammering the disk with parallel scans.
- **Missing-file retention**: if the source file is moved / deleted, the record is kept and flagged `is_missing` + missing-since timestamp for traceability.
- **Media list + multi-dimensional filters**: filter by source format, capture time, attributes (Live Photo / has GPS / missing / user-marked); sortable headers and pagination.
- **Detail modal**: click any row to see all 37 fields of that record, including `raw_metadata` (pretty-printed JSON); jump to a map with one click when coordinates exist.
- **Duplicate detection**: by file MD5 (videos can participate too; MD5 switch configurable).
- **Map view**: Leaflet + OpenStreetMap plots GPS-tagged photos / videos, clustered, click to open the detail modal.
- **Dashboard**: home-page summary stats; a jobs page shows per-topic scan progress and status.
- **Settings**: configure ffmpeg / ffprobe paths, concurrency, and more.

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22+ |
| Web framework | Fastify 4 |
| Database | better-sqlite3 (WAL mode, plain local file) |
| Image parsing | sharp (resolution), exifr (EXIF / GPS) |
| A/V parsing | ffmpeg / ffprobe (user-provided, path configurable) |
| Templates / frontend | EJS + htmx + Alpine.js (no SPA framework) |
| Map | Leaflet 1.9.4 + leaflet.markercluster 1.5.3 + OpenStreetMap tiles (library self-hosted, works offline) |

## Project Structure

```
photo_lake/
├── src/
│   ├── server.js          # Fastify entry, listens on 127.0.0.1:3000
│   ├── db/                # SQLite schema and connection (WAL, with column migration)
│   ├── config/            # config loader (reads config/settings.json)
│   ├── routes/            # api.js (REST), pages.js (page routes)
│   ├── library.js         # year / topic directory parsing & import (inspect / topics / import / rescan-year)
│   ├── scanner.js         # scan engine (recursive / incremental / streaming MD5 / cancelable / queue)
│   └── util/
│       ├── meta.js        # metadata parse pipeline (image / video / HEIC)
│       └── dirconv.js     # directory naming convention parser (YYYY / YYYYMMDD+topic)
├── views/                 # EJS pages and partials (nav / foot)
├── public/                # app.js, styles.css (map libs self-hosted under /vendor)
├── design/               # page prototypes (mockup / basemap-less map preview)
├── data/                 # local database (generated at runtime, gitignored)
├── config/               # local config settings.json (gitignored)
├── photo_desc.md          # AI photo description design (planned)
├── design_prd.md          # product requirement doc v1.3
├── package.json
└── .gitignore
```

## Quick Start

```bash
git clone https://github.com/iwantleave/photo_lake.git
cd photo_lake
npm install
npm start
```

Open **http://127.0.0.1:3000** in your browser.

> Note: `npm start` and `npm run dev` both run `node src/server.js`.

## Folder Convention & Import Flow

The library follows a fixed two-level structure. **Each second-level directory is a "topic"**, and every photo/video inside it belongs to that topic:

```
<library root>/
└── 2026/                  <- level 1: year YYYY
    ├── 20260101-newyear/  <- level 2: YYYYMMDD + topic
    │   ├── IMG_0001.HEIC
    │   └── IMG_0002.MOV
    └── 20260217-westlake/
```

Import steps (Folder management page `/folders`):

1. Enter the library root (e.g. `D:\Photos`) or a year path (e.g. `D:\Photos\2026`) and click "Parse directory";
2. If a root was given, click a year chip — the system lists all topic directories under that year (parses `YYYYMMDD` into a date, the rest into the topic name, counts files, and marks already-imported ones);
3. Select the topics you want and click "Import & scan" — each topic becomes one record and scan jobs are queued to extract metadata into SQLite.

- Directories that don't follow `YYYYMMDD+topic` are flagged with ⚠ but can still be imported (date empty, full name used as topic).
- Already-imported topics show "imported · status" and their checkbox is disabled, so nothing is duplicated.
- Scan jobs run **sequentially through a queue**, so batch imports never run several scans at once; existing topics can be rescanned individually or per year.

### Data Model

One row in `folders` = one topic (second-level directory):

| Column | Meaning | Example |
|---|---|---|
| `path` | absolute path of the second-level directory (unique) | `D:\Photos\2026\20260101-newyear` |
| `alias` | display name, defaults to `YYYY / dirname` | `2026 / 20260101-newyear` |
| `year` | first-level year | `2026` |
| `topic` | topic keyword (dirname minus the date prefix) | `newyear` |
| `event_date` | date parsed from the `YYYYMMDD` prefix | `2026-01-01` |
| `parent_path` | absolute path of the year directory | `D:\Photos\2026` |

Each photo / video under a topic is one row in `media`, linked by `folder_id` (see [design_prd.md](./design_prd.md)).

Upgrading an older database adds these columns automatically and backfills existing records per the convention — no manual migration needed.

### Related Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/library/inspect` | Parse the input path; returns mode (year / root / plain) and the year list |
| POST | `/api/library/topics` | List topics under a year directory (date, topic name, file count, imported flag) |
| POST | `/api/library/import` | Import selected topics in bulk and trigger scans; returns imported / skipped |
| POST | `/api/library/rescan-year` | Rescan every topic of a given year |
| GET | `/api/folders` | Managed topics (ordered by year, then date) |
| POST | `/api/folders` | Add a single directory manually (year / topic parsed the same way) |
| POST | `/api/folders/:id/rescan` | Rescan a single topic |
| DELETE | `/api/folders/:id` | Remove a topic, with its media records and scan jobs |
| GET | `/api/jobs` | Job list plus `queue:{active,pending}` queue state |

## Configure ffmpeg / ffprobe

Video and HEIC resolution / metadata parsing depends on `ffmpeg` / `ffprobe`. Enable in either way:

1. **Settings page (recommended)**: on the app's Settings page, enter the full paths to `ffmpeg.exe` and `ffprobe.exe`; it takes effect immediately, no restart needed.
2. **Config file**: edit `config/settings.json` (create it on first use):

   ```json
   {
     "ffmpegPath": "D:/ffmpeg/bin/ffmpeg.exe",
     "ffprobePath": "D:/ffmpeg/bin/ffprobe.exe"
   }
   ```

Without configuration the app still runs, but video / HEIC fall back to **degraded mode** (only the limited fields it can get). `ffprobe` / `ffmpeg` on PATH are also auto-detected.

> Note: the `config/` directory is excluded by `.gitignore`, so your local paths and secrets never enter the repository.

## Supported Media Formats

| Type | Formats | Notes |
|---|---|---|
| Image | JPG / JPEG | full EXIF + resolution |
| Image | HEIC | needs ffprobe; EXIF from exifr, resolution from true EXIF pixels |
| Image | WEBP / PNG / TIFF etc. | sharp-supported |
| Video | MOV / MP4 / AVI | needs ffprobe; duration / codec / resolution / GPS / device |

## Data Notes

- All scan results are stored locally in `data/photo_world.db` (better-sqlite3, WAL mode) and **never uploaded to any server**.
- `data/`, `config/`, `logs/`, `node_modules/`, `.workbuddy/` are all excluded by `.gitignore`. The repo contains only source and docs — not your photos or local config.
- Removing a topic (second-level directory) also cleans up its media records and scan jobs. Files on disk are never touched.

## Core Capabilities (selected fields)

Each media record carries: file name, path, MD5, capture time (with source tag), format, type (image/video), resolution, megapixels, duration, codec, camera make / model, lens, aperture, shutter, ISO, focal length, orientation, GPS lat / lon / altitude, scan status, missing flag, Live Photo flag, user mark, created / modified time, plus a `raw_metadata` blob.

Full database design: [design_prd.md](./design_prd.md).

## Roadmap (M2, planned)

- **AI photo description**: generate a natural-language caption per photo with a multimodal model (design: [photo_desc.md](./photo_desc.md)).
- CSV export (current filtered result / full set).
- Stats charts (by camera model / year / month / location).
- One-click duplicate cleanup (move / delete).
- Offline basemap (self-hosted tiles for fully air-gapped scenarios).

## Compliance

This project targets US-based clients and complies with US law. The map uses OpenStreetMap public tiles with the WGS-84 coordinate system, so iPhone's native GPS is plotted directly with no GCJ-02 offset. Basemap tiles are fetched by the browser directly from `tile.openstreetmap.org` — the only network touchpoint; the rendering and clustering logic is fully self-hosted and runs offline.

## License

This project is licensed under the [MIT License](./LICENSE).

- Anyone may use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, provided the copyright notice and permission notice are included.
- The software is provided "as is", without warranty of any kind.
- Copyright: iwantleave (2026).
