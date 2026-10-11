# Afterglow — East Coast Sunset Forecast

A mobile-friendly, single-page web app that forecasts sunset color quality, the best viewing spots, and sky phenomena (sun dogs, halos, rainbows, rays, Belt of Venus, green flash, moon) for 42 curated, mostly west-facing spots from Maine to the Florida Gulf coast.

## Run

```bash
cd /workspace/sunset-app
python3 -m http.server 8787       # any static server works
# open http://localhost:8787
```

There's no build step and no API keys. Everything runs in the browser: plain HTML/CSS/JS, with Leaflet loaded from a CDN.

## Files
- `index.html`, `styles.css`: layout and the dark sunset theme
- `spots.js`: curated spots. Each has an open-view azimuth arc, a horizon obstruction estimate, and a flag for water toward the sunset
- `model.js`: solar geometry plus the scoring model (Sunset Metric Bible v1, `/workspace/research/sunset_metric_bible.md`)
- `preview.js`: draws the "what it might look like" illustration on a canvas. It is an illustration, not a photo
- `satellite.js`: live GOES-East tile overlays, plus pixel sampling for the plain-language satellite read
- `app.js`: data fetching, the map, the ranked list and the detail sheet

## Data sources (all free, CORS-enabled, no key)
- **Open-Meteo Forecast API**: cloud cover (total, low, mid, high), RH at 2 m, 850, 500 and 300 hPa, dew point, visibility, wind, gusts, precipitation and its probability, weather code, CAPE, MSL pressure, and sunset/sunrise. The app queries each spot, 3 points along the sunset azimuth (40, 120 and 200 km), and 1 point about 12 km on the opposite side from the sun (for rainbows and Belt of Venus).
- **Open-Meteo Air Quality API (CAMS)**: aerosol optical depth, PM2.5 and dust.
- **GOES-19 (GOES-East) ABI** through Iowa Environmental Mesonet tiles: band 2 visible, band 4 (1.37 µm cirrus) and band 13 clean IR, plus NEXRAD radar. These are map overlays, and the app also samples them per spot.
- **NOAA NESDIS STAR CDN**: latest Northeast and Southeast sector images (GeoColor, Visible, Cirrus, IR).
- Basemap: Esri Dark Gray Canvas.

## Scoring (Bible §13, all weights are starting estimates)
Sky score = western clear slot 25% + high/mid screen 25% (weighted by how much light gets in) + clean low-level air 20% (AOD, PM2.5, visibility, low-level RH) + post-front/pressure 10% + overhead low-cloud 10% + moisture aloft 5% + aerosol aloft 5%. The result is multiplied by a seasonal prior (×1.04 Oct–Feb, ×0.95 Jun–Aug).

Gates: clear sky is capped at 55. Visibility under about 3 mi caps the score at 45 (Fair). Low overcast along the sunset path, rain or fog at the spot, or full overcast with no western gap caps it at 20 (Poor).

Overall = sky × (0.78 + 0.22 × site fit). Site fit uses azimuth alignment, horizon obstruction, water and surface wind.

Timing: the sun elevation curve, golden hour (+6°), predicted best minute (based on the dominant cloud height), afterglow end (depression angle √(2h/R)), and civil twilight.

Phenomena are separate badges and are not blended into the color score.

## Limitations
- Every score, probability and inferred cloud type is a heuristic estimate. Forecast skill falls off quickly after about 2 days.
- Hourly model output smooths over showers, so rainbow odds are coarse.
- Satellite reads use pixel-color heuristics on rendered tiles, not calibrated L2 products. The visible and cirrus bands only work in daylight.
- View arcs and obstruction angles are hand-estimated. No DEM is used.
- Smoke aloft is a proxy (AOD vs surface PM2.5). HRRR-Smoke is not integrated.
- Forecast data is cached in localStorage for 30 min.
