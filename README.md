<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
  <img src="docs/images/logo-light.svg" width="96" height="96" alt="SIGAP Bencana logo: an S drawn from three contour lines around an amber summit point">
</picture>

# SIGAP Bencana

**Open-data web GIS for disaster early warning and mitigation across Indonesia**

Earthquakes, volcanoes, floods, landslides, and heavy rain on one map, checked against official data from BMKG, PVMBG, and BNPB.

[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-3c873a?logo=nodedotjs&logoColor=white)](server/package.json)
[![PostGIS 3.6](https://img.shields.io/badge/PostGIS-3.6-336791?logo=postgresql&logoColor=white)](docker-compose.yml)
[![Leaflet 1.9](https://img.shields.io/badge/Leaflet-1.9-199900?logo=leaflet&logoColor=white)](web/package.json)
[![Python 3.11](https://img.shields.io/badge/Python-3.11-3776ab?logo=python&logoColor=white)](research/requirements.txt)
[![Data recorder](https://github.com/Bintangilham10/webgis-bencana-alam/actions/workflows/rekam-data.yml/badge.svg)](https://github.com/Bintangilham10/webgis-bencana-alam/actions/workflows/rekam-data.yml)

[Features](#what-it-does) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Landslide research](#landslide-research-sigap-l) · [Quick start](#quick-start) · [API](#api) · [Data sources](#data-sources-and-attribution) · [Bahasa Indonesia](README.id.md)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/app-dark.jpg">
  <img src="docs/images/app-light.jpg" alt="SIGAP Bencana map of Indonesia with the SIGAP 3-day outlook for every regency, active faults, earthquakes of the last 7 days, and volcano alert levels, with the overview panel on the left">
</picture>

> [!IMPORTANT]
> SIGAP is a student research system, **not an official warning service**. For safety decisions, follow [BMKG](https://www.bmkg.go.id/), [MAGMA Indonesia (PVMBG)](https://magma.esdm.go.id/), and your local BPBD or [BNPB](https://bnpb.go.id/).

SIGAP (*Sistem Informasi Geospasial Antisipasi & Peringatan*) is the term project for the Web-Based Mapping Technology course (ACK4LBB3) at Telkom University. It is also the instrument for a research track on landslide early warning. The interface is in Indonesian, because it is built for people living in Indonesia.

The logo is an **S drawn from three contour lines** around an amber summit point. The S stands for SIGAP, the contour lines stand for terrain, and the point is the place being watched. When the app loads, the point appears first, the contours are plotted one by one, and a signal pulses out through them.

## At a glance

| 514 | 69 | 401 | 1,884 | 10 |
|:---:|:---:|:---:|:---:|:---:|
| regencies and cities, each with a 3-day SIGAP outlook every 12 hours | volcanoes with live PVMBG alert levels | active fault segments (PuSGeN 2024) | landslide events in the deduplicated inventory | open data feeds in the research archive |

## What it does

<table>
<tr>
<td width="50%" valign="top">

### Live hazards on one map
- **SIGAP 3-day outlook** for all 514 regencies and cities, recomputed every 12 hours: heavy rain, flood, and landslide levels from Open-Meteo rain at 3,222 monitoring points × InaRISK hazard classes. It is on by default, and each popup shows BMKG's official warning next to it. It is a system indication, not an official warning.
- **Earthquakes** from BMKG, synced every 60 seconds. Circles are sized by magnitude, coloured by depth class, and fade over 7 days. Popups carry the tsunami flag and the ShakeMap.
- **Volcanoes** from MAGMA Indonesia, synced every 30 minutes, with alert level I–IV, eruption status, and aviation ash warnings (VONA).
- **Heavy-rain warnings** from BMKG CEWS for the current dasarian (10-day period), drawn on regency boundaries and listed in the overview.
- **Rain from satellite**: the latest 30-minute NASA GPM IMERG rainfall, about 5 hours behind real time.
- **Landslides**: 1,884 past events from PVMBG and MAGMA, coloured by age.
- **Hazard maps** from BNPB InaRISK for earthquake, extreme weather, flood, landslide, and volcano, in the three official BNPB classes, plus the PVMBG landslide susceptibility zones (ZKGT) in the same colours.
- **Geology and boundaries**: active faults, tectonic plate boundaries (Bird 2003), and 514 regency and city boundaries.

</td>
<td width="50%" valign="top">

### Risk check for any point
Pick a point by search, GPS, right-click, or long press. SIGAP runs 11 lookups in parallel (web services and PostGIS queries) and returns one profile:
- a 3-day outlook (Normal, Waspada, Siaga, Awas) for heavy rain, flood, and landslide, from rainfall × hazard class, with the same rules as the regency outlook;
- the five InaRISK hazard indices;
- the nearest active fault and volcanoes, drawn as distance lines;
- recent earthquakes within 100 km;
- **landslide and rain**: the PVMBG monthly landslide forecast and susceptibility zone, the BMKG heavy-rain warning for the regency, rain over the last 3 days, the odds of ≥ 50 mm from 51 ECMWF ensemble members, terrain slope, and past landslides within 5 km.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Built for the field
- An opening page that tours the product before the map: real screenshots in tablet, laptop, and phone mockups, live counts, the features, how the outlook is computed, and the data sources. Opening the map reveals it through an expanding circle.
- Full-bleed map with floating panels; on phones the panel becomes a bottom sheet.
- Dark and light themes, flat colours, and one blue accent. Bright colours are reserved for hazard data.
- Cartographic essentials: collapsible legend, scale bar with a 1:n reading, north arrow, and cursor coordinates in WGS84, UTM, and EPSG:3857.
- Animations switch off when the system asks for reduced motion.

</td>
<td width="50%" valign="top">

### A research archive that fills itself
Several official products vanish once they expire, such as short weather warnings, revised earthquake parameters, and monthly forecasts. A small recorder on GitHub Actions saves them to the [`arsip-data`](https://github.com/Bintangilham10/webgis-bencana-alam/tree/arsip-data) branch every 15 minutes. That archive becomes the ground truth for testing warnings during the 2026/27 rainy season.

</td>
</tr>
</table>

## Screenshots

**Opening page.** A product tour built from real screenshots of the app (`web/public/images/landing/`, dark and light versions that follow the theme). The hero shows the app on a tablet mockup that tilts upright as you scroll, and the live counts come from the same API as the overview. In the feature tour a laptop mockup stays pinned and slides to the next screenshot as you read: the overview, the 3-day outlook, BMKG rain warnings, and the risk check. Motion stops when the system asks for reduced motion.

![Opening page: the headline "Semua informasi bencana Indonesia, di satu peta." with live counts, above a tablet mockup showing the SIGAP map and overview panel](docs/images/landing.jpg)

**Risk check in Lembang, West Java.** The point sits 1.4 km from the Lembang Fault and 4.9 km from Tangkuban Parahu, and InaRISK rates its earthquake hazard as high (0.862).

![Risk check profile for Lembang with distance lines to the Lembang Fault and Tangkuban Parahu volcano](docs/images/risk-check-lembang.jpg)

**Landslide check in Banjarnegara, Central Java.** PVMBG susceptibility zones (ZKGT) share the InaRISK colours, and past landslides appear as purple triangles, darker for more recent events. The risk card adds the monthly PVMBG forecast, the BMKG heavy-rain warning, rain over the last 3 days, the ensemble odds of heavy rain, and the terrain slope.

![Banjarnegara with PVMBG landslide susceptibility zones, past landslides as purple triangles, and the landslide section of the risk card](docs/images/landslide-banjarnegara.jpg)

**BMKG heavy-rain warnings for 21–30 September 2026.** Ten regencies in North and West Sumatra were under Waspada. Picking one in the overview flies the map there and opens the warning with a link to BMKG.

![Agam regency highlighted as Waspada on the heavy-rain warning layer, with the warning list in the overview panel](docs/images/rain-warnings-agam.jpg)

**SIGAP 3-day outlook for 29 September–1 October 2026.** All 514 regencies are rated: Nias Selatan is Awas, Kepulauan Mentawai is Siaga, four regencies are Waspada, and 508 are Normal. The Nias Selatan level comes from one monitoring point in a high flood-hazard zone, where the model forecasts 261.6 mm for 30 September. The popup lists the three hazards with their reasons and can open the risk check at that point. It also shows BMKG's official CEWS level (Aman for this dasarian), because one uncalibrated 9 km forecast cell can be enough to raise a regency.

![Nias Selatan at Awas on the SIGAP 3-day outlook, with Kepulauan Mentawai at Siaga, the regency popup, and the outlook summary in the overview panel](docs/images/outlook-nias-selatan.jpg)

<table>
<tr>
<td width="50%"><img src="docs/images/mobile-overview.jpg" alt="Phone layout: map with the overview bottom sheet"></td>
<td width="50%"><img src="docs/images/mobile-risk.jpg" alt="Phone layout: risk profile for Lembang in the bottom sheet"></td>
</tr>
<tr>
<td align="center">Phone layout: overview</td>
<td align="center">Phone layout: risk profile</td>
</tr>
</table>

## How the 3-day outlook works

Every 12 hours the server rates heavy rain, flood, and landslide for all 514 regencies and cities. Every run is stored, Normal regencies included, so the outlook can be verified against events later.

1. **Hazard zones.** InaRISK flood and landslide classes for the whole country, at about 550 m, are loaded into PostGIS rasters and clipped to each regency. The same step records the area of each class per regency.
2. **Monitoring points.** Each regency gets up to three points per hazard, in the 0.25° cells with the highest class, plus one reference point. The server smooths the 550 m export, so each point's class is checked against the native 100 m InaRISK value (`getSamples`). The risk check at that point therefore shows the same class.
3. **Rain.** Open-Meteo daily rain for the past 3 and next 3 days at every monitoring point, at the same coordinates the risk check uses. In Indonesia Open-Meteo serves ECMWF IFS at 9 km, much finer than a 0.25° cell, so the rain is not averaged over a cell. The job asks for 100 points per request with pauses, about 3,200 calls per run, which is why it runs every 12 hours within the free quota.
4. **Rules v0.1** in [`rules.json`](server/src/config/rules.json):
   - heavy rain follows the BMKG category: heavy, very heavy, and extreme rain give Waspada, Siaga, and Awas;
   - flood and landslide combine the peak daily rain with the hazard class at the point;
   - for landslides, 100 mm over any 3 days, including the last few days, counts as heavy rain.

   A regency takes the highest level among its points.

The rules are not calibrated yet (that is RQ-L2), so the map labels the result as a system indication and shows BMKG's CEWS level next to it.

## Architecture

```mermaid
flowchart LR
  subgraph sources["Open data sources"]
    BMKG["BMKG<br/>earthquakes, CAP warnings, CEWS"]
    ESDM["PVMBG / MAGMA<br/>volcanoes, landslide forecast"]
    BNPB["BNPB InaRISK<br/>hazard index, ZKGT"]
    OM["Open-Meteo<br/>rain, ECMWF ensemble, DEM"]
    OSMN["OpenStreetMap<br/>Nominatim"]
    NASA["NASA GIBS<br/>IMERG rain"]
  end

  subgraph server["server/ (Node.js, Express)"]
    SYNC["Scheduler<br/>quakes 60 s, volcanoes 30 min,<br/>3-day outlook 12 h"]
    API["REST API<br/>GeoJSON"]
    RISK["Risk check<br/>11 lookups in parallel"]
  end

  DB[("PostgreSQL 18<br/>PostGIS 3.6")]
  WEB["web/<br/>Vite + Leaflet"]
  REC["recorder/<br/>GitHub Actions, every 15 min"]
  ARCH[("arsip-data<br/>branch")]
  RES["research/<br/>Python analysis"]

  BMKG --> SYNC
  ESDM --> SYNC
  OM --> SYNC
  BNPB -. hazard classes, at seed .-> DB
  SYNC --> DB
  DB --> API
  BNPB --> RISK
  OM --> RISK
  ESDM --> RISK
  BMKG --> RISK
  RISK --> API
  OSMN --> API
  NASA -->|latest time| API
  NASA -->|map tiles| WEB
  API --> WEB
  sources --> REC
  REC --> ARCH
  ARCH --> RES
  RES -->|landslide history| DB
```

- **Server.** Express 5 with plain SQL on PostGIS, so every spatial query can be read and cited. Distances are computed on the ellipsoid (`geography`); nearest neighbours use GiST indexes. External calls are cached, and a slow or failing source never breaks the rest of a response.
- **Web.** Vanilla JavaScript on Vite and Leaflet, with no CSS framework. The font is self-hosted (±27 KB).
- **Recorder.** A separate Node package with no dependency on the server. It writes append-only files, so a revised product shows up as a new file instead of overwriting the old one.
- **Shared definitions.** The server reuses the recorder's parsers for BMKG CEWS, PVMBG, and the ensemble summary, so the app and the research archive count things the same way.

## Landslide research (SIGAP-L)

Indonesia has official landslide products: the monthly landslide potential forecast from PVMBG and the dasarian (10-day) heavy-rain warnings from BMKG. We have not found a study that measures how well they match landslides that actually happened. SIGAP-L sets out to do that, and then to test whether an open-data model can do better.

| Question | What is measured | Status |
|---|---|---|
| **RQ-L1** | Skill of the PVMBG monthly forecast and BMKG CEWS warnings, 2022–2025, using a matched case-control design and EDuMaP | First results (below) |
| **RQ-L2** | Do soil moisture × rainfall thresholds (ERA5-Land) beat rainfall-only thresholds? | Planned |
| **RQ-L3** | Skill of a daily SIGAP-L model at 0–2 days lead time against the official products | Planned |

The analysis plan was written and committed **before any result was computed** ([`research/PROTOKOL.md`](research/PROTOKOL.md), commits `88819cd` and `9da4339`). Version 1.1 added one rule after a data check: 83 of 788 PVMBG field reports fall on 1 January, a placeholder for "year only", so those dates are kept out of the main monthly analysis.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/chart-inventory-dark.svg">
  <img src="docs/images/chart-inventory-light.svg" alt="Stacked bar chart of landslide events per year from 2017 to 2025. Totals: 238, 114, 173, 676, 350, 151, 45, 129, 1. MAGMA responses stop after April 2023.">
</picture>

The inventory merges two PVMBG sources and removes duplicates (≤ 2 km and ≤ 3 days apart). The public MAGMA feed stopped after April 2023, and the field-report portal has almost nothing for 2025. That gap is why the recorder now archives landslide news and new field reports as they appear.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/chart-forecast-layers-dark.svg">
  <img src="docs/images/chart-forecast-layers-light.svg" alt="Grid of 48 months from 2022 to 2025. Six months are not published (April, September, October, November 2023; August 2024; November 2025) and December 2025 is broken.">
</picture>

Seven of the 48 monthly forecast maps cannot be read through PVMBG's public map service. That availability gap is a finding in its own right, and those months are excluded from the analysis as stated in the protocol. BMKG CEWS has the same issue on a smaller scale: 7 of 144 dasarian are empty at the source.

### First results (RQ-L1)

Matched AUC compares each landslide with its own controls: other places in the same province at the same time (**where**), and the same place in other periods (**when**). A value of 0.5 means no better than chance. Brackets give the 95% cluster bootstrap interval.

| Official product | Tells **where** landslides happen? | Tells **when**? |
|---|---|---|
| PVMBG monthly landslide forecast (303 events) | Yes, 0.63 [0.60–0.66] | Yes, 0.56 [0.53–0.59] |
| PVMBG susceptibility map (ZKGT) | Yes, 0.65 [0.63–0.68] | No, 0.50, as expected for a map that barely changes |
| BMKG CEWS heavy-rain warnings (211–225 events) | Not shown, 0.52 [0.50–0.54] | Yes, 0.57 [0.54–0.60] |

- The monthly forecast adds timing information but **no spatial skill** over the susceptibility map it is built on: the difference is −0.023 [−0.036 to −0.009].
- The conclusions hold across all the preregistered sensitivity analyses.
- BMKG warnings show a clear dose-response in an EDuMaP analysis (Calvello & Piciullo 2016) over all 514 regencies and 137 dasarian. Compared with Aman, recorded landslides were 2.5 times as frequent under Waspada, 3.9 times under Siaga, and 4.6 times under Awas.
- Siaga or higher still covered only 10% of the regency-days with a recorded landslide. CEWS is a rainfall product, not a landslide warning.

Details and caveats are in [`research/results/rq_l1_ringkasan.md`](research/results/rq_l1_ringkasan.md) and [`rq_l1_edumap_cews.md`](research/results/rq_l1_edumap_cews.md). The main caveats are an incomplete event inventory, the dominance of 2022, and possible seasonal effects in the timing signal.

```mermaid
flowchart LR
  P["PROTOKOL.md<br/>committed first"] -.-> E
  I["01_inventaris.py<br/>1,884 events"] --> S["02_produk_resmi.py<br/>cases + matched controls"]
  S --> E["06_evaluasi_rq_l1.py<br/>matched AUC, TSS, bootstrap CI, EDuMaP"]
  A[("recorder archive<br/>BMKG CEWS 2022-")] --> S
  I --> H["server/data/landslides.geojson<br/>history layer in the app"]
```

## What the recorder archives

| Feed | Source | Why it is archived |
|---|---|---|
| Weather warnings (CAP 1.2) | BMKG nowcast | Disappear from the feed when they expire |
| Earthquakes (3 feeds) | BMKG | Parameters get revised after the first release |
| Volcano alert levels | MAGMA Indonesia | Only the current level is public |
| Citizen flood reports | PetaBencana.id | Reports expire from the live map |
| Heavy-rain warnings by regency | BMKG CEWS | Per dasarian, backfilled to January 2022 |
| Monthly landslide potential | PVMBG | Sampled at one point in each of the 514 regencies |
| Landslide field reports | PVMBG Portal MBG | New, changed, and removed reports are logged weekly |
| 3-day rainfall ensemble | Open-Meteo (ECMWF, 51 members) | The API keeps only 3 past days |
| Weekly disaster events | BNPB | Kept in case the service resumes |
| Landslide news headlines | Google News RSS | Independent ground truth, matched to regencies |

GitHub runs scheduled workflows much less often than requested, about 6 times a day in practice. An external cron job therefore triggers the workflow every 15 minutes through the `workflow_dispatch` API, using a token that can only start workflow runs on this repository. The archive layout is documented in [`recorder/ARSIP_README.md`](recorder/ARSIP_README.md).

## Quick start

Requirements: Node.js 22 or newer and Docker Desktop. Python 3.11 is needed only for `research/`.

```bash
docker compose up -d          # PostGIS on localhost:5433

cd server
npm install
npm run migrate               # create tables
npm run seed                  # boundaries, volcanoes, faults, landslides, hazard zones (±5 min the first time)
npm run dev                   # API on http://localhost:3000/api; first 3-day outlook ±10 min later
```

In a second terminal:

```bash
cd web
npm install
npm run dev                   # open http://localhost:5173
```

Use a regular browser (Chrome, Edge, Brave, or Firefox). VS Code's built-in browser gets HTTP 403 from the French OSM server, so the Humanitarian basemap stays blank there.

The server computes the 3-day outlook every 12 hours and skips the run after a restart if the last one is still fresh. `npm run indikasi` in `server/` runs it once on demand, for example before a demo; each run uses about a third of Open-Meteo's free daily quota.

The defaults match `docker-compose.yml`. Copy `.env.example` to `.env` only if you need to change them.

<details>
<summary><strong>Running the tests</strong></summary>

```bash
cd server && npm test         # unit tests
cd recorder && npm test
research/.venv/Scripts/python -m unittest discover -s research/tests
```

The server's integration tests use a separate database so development data is never touched:

```bash
docker compose exec db createdb -U sigap sigap_test      # once
cd server
TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5433/sigap_test npm test
```

In PowerShell: `$env:TEST_DATABASE_URL="postgres://sigap:sigap@localhost:5433/sigap_test"; npm test`

Current counts: 75 server tests (with the integration database), 37 recorder tests, and 18 research tests. One research test reproduces the worked example of the EDuMaP paper.

</details>

## API

Every endpoint returns JSON; spatial data is GeoJSON with `[lon, lat]` coordinates.

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Database status and the last sync of each source |
| `GET /api/earthquakes?days=7` | Earthquakes from the last 1–90 days |
| `GET /api/volcanoes` | Volcanoes with alert level, eruption status, and VONA |
| `GET /api/faults` | PuSGeN 2024 active fault segments |
| `GET /api/wilayah?tingkat=provinsi` or `kabkota` | Province or regency boundaries, simplified for display |
| `GET /api/risk?lat=-6.81&lon=107.62` | Risk profile for one point, cached 10 minutes per ±100 m cell, including the `landslide` section |
| `GET /api/rain-warnings` | Regencies under a BMKG heavy-rain warning (Waspada or higher) for the current dasarian |
| `GET /api/rain-warnings/summary` | The same warnings without geometry, with province and bounds, for lists |
| `GET /api/rain-now` | Time and tile URL of the latest NASA IMERG rainfall map |
| `GET /api/outlook` | Latest SIGAP 3-day outlook: heavy rain, flood, and landslide level per regency, with reason, peak day, and worst monitoring point, plus counts per level |
| `GET /api/landslides` | Landslide history from PVMBG and MAGMA |
| `GET /api/geocode?q=bandung` | Regency search in the database, other places through Nominatim |

<details>
<summary><strong>Example: the landslide section of a risk profile</strong> (Banjarnegara, 27 September 2026)</summary>

```json
{
  "potential": { "month": "2026-09", "current": true, "potensi": "Tinggi", "zkgt": "Tinggi" },
  "rain_warning": { "dasarian": { "start": "2026-09-21", "end": "2026-09-30" }, "level": 0, "label": "Aman" },
  "antecedent_rain": { "total_mm": 12.9 },
  "ensemble": { "model": "ecmwf_ifs025", "days": [{ "date": "2026-09-27", "members": 51, "median_mm": 5.8, "prob_50mm": 0 }] },
  "slope": { "degrees": 7.4, "class": { "id": "miring", "label": "Miring" } },
  "history": { "radius_km": 5, "count": 10, "nearest": { "tanggal": "2021-01-06", "distance_km": 0.4 } }
}
```

Shortened from the real response. If one source fails, only its own part carries an `error`; the rest of the profile is still returned.

</details>

## Project structure

| Path | Contents |
|---|---|
| [`server/`](server) | Express API, sync scheduler, migrations, seeds, and warning rules (`src/config/rules.json`) |
| [`web/`](web) | Vite + Leaflet frontend |
| [`recorder/`](recorder) | Data recorder that runs on GitHub Actions |
| [`research/`](research) | Python analysis for SIGAP-L, the preregistered protocol, and results |
| [`docs/images/`](docs/images) | Screenshots and charts used in this README |
| [`docker-compose.yml`](docker-compose.yml) | PostgreSQL 18 + PostGIS 3.6 |

## Data sources and attribution

| Data | Source | Terms |
|---|---|---|
| Earthquakes | [BMKG](https://data.bmkg.go.id/) | Credit BMKG as the source |
| Heavy-rain early warnings | [BMKG CEWS](https://cews.bmkg.go.id/) | Credit BMKG as the source |
| Hazard indices (point lookups, samples, and ~550 m class rasters for the outlook), active faults | [BNPB InaRISK](https://inarisk.bnpb.go.id/); PuSGeN 2024 fault model | Credit BNPB and PuSGeN |
| Volcano alert levels | [MAGMA Indonesia](https://magma.esdm.go.id/), PVMBG, Ministry of Energy and Mineral Resources | Credit PVMBG |
| Monthly landslide forecast, ZKGT, landslide events | PVMBG, Geological Agency ([Portal MBG](https://vsi.esdm.go.id/portalmbg/) and MAGMA Indonesia) | Credit PVMBG. The event history is rebuilt by `research/01_inventaris.py` without personal data |
| Plate boundaries | Bird (2003) PB2002, converted by H. Ahlenius / Nordpil | ODC-By |
| Administrative boundaries | Kepmendagri No 300.2.2-2430 of 2025, [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries) | MIT |
| Citizen reports (research archive) | [PetaBencana.id](https://petabencana.id/) | CC BY-NC 4.0 |
| Rain forecast (also for the 3-day outlook), ensemble, elevation | [Open-Meteo](https://open-meteo.com/) (ECMWF; Copernicus DEM 90 m) | CC BY 4.0, free for non-commercial use |
| Satellite rainfall | [NASA GPM IMERG](https://gpm.nasa.gov/data/imerg) Early Run through [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | Open NASA data; credit NASA |
| Place search | [Nominatim](https://nominatim.org/), © OpenStreetMap contributors | ODbL; at most 1 request per second, no autocomplete |
| Basemaps | Esri; © OpenStreetMap contributors (ODbL); Humanitarian OpenStreetMap Team; OpenTopoMap | CC-BY-SA for OpenTopoMap |

Portal MBG and CEWS endpoints are internal site APIs, not documented services. SIGAP sends an identifying User-Agent, keeps request rates low, and caches every response.

---

<sub>Built at Telkom University for ACK4LBB3 Web-Based Mapping Technology. Screenshots and charts use real data captured on 27 September 2026.</sub>
