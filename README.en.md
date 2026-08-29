# Photo World

> A local photo / video metadata management and search system — runs entirely on your machine, no cloud, no external database service.

Photo World is a photo / video management tool that runs on your own computer. It focuses on **metadata management, organization, and multi-dimensional search** — no thumbnails, and it never uploads your photos anywhere. Add a folder and it scans recursively in the background, parsing file name, MD5, capture time, resolution, EXIF, GPS, duration, codec and more into a local SQLite database, so you can quickly find any shot through filters, sorting, duplicate detection, and a map.

中文版 (Chinese): [README.md](./README.md)

---

## Features

- **Local-first**: all data lives in a local `data/photo_world.db` (SQLite + WAL). No network, no cloud.
- **Multi-format parsing**:
  - Images: JPG / JPEG, HEIC (iPhone captures), WEBP, PNG, TIFF, etc. (sharp-supported).
  - Videos: MOV, MP4, AVI (duration / codec / resolution / GPS / device via ffprobe).
- **iPhone Live Photos**: automatically recognizes same-name HEIC + MOV pairs in the same folder and marks them as Live Photos (`is_livephoto`).
- **Full EXIF / GPS**: camera make, model, lens, aperture, shutter, ISO, focal length, orientation, latitude / longitude / altitude — all stored.
- **Incremental scanning**: skips unchanged files by mtime + size, so re-scans finish in seconds; can be cancelled mid-run.
- **Missing-file retention**: if the source file is moved / deleted, the record is kept and flagged `is_missing` + missing-since timestamp for traceability.
- **Media list + multi-dimensional filters**: filter by source format, capture time, attributes (Live Photo / has GPS / missing / user-marked); sortable headers and pagination.
- **Detail modal**: click any row to see all 37 fields of that record, including `raw_metadata` (pretty-printed JSON); jump to a map with one click when coordinates exist.
- **Duplicate detection**: by file MD5 (videos can participate too; MD5 switch configurable).
- **Map view**: Leaflet + OpenStreetMap plots GPS-tagged photos / videos, clustered, click to open the detail modal.
- **Dashboard**: home-page summary stats; a jobs page shows per-folder scan progress and status.
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
│   ├── db/                # SQLite schema and connection (WAL)
│   ├── config/            # config loader (reads config/settings.json)
│   ├── routes/            # api.js (REST), pages.js (page routes)
│   ├── scanner.js         # scan engine (recursive / incremental / streaming MD5 / cancelable)
│   └── util/meta.js       # metadata parse pipeline (image / video / HEIC)
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
- Removing a folder also cleans up the media records it produced.

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

For study and research purposes. See the repository LICENSE file (if any).
