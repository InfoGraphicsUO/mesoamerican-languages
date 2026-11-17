# Language probability surface

Estimates the most likely languages at any point from the attested sites, for the
"Likely languages here" panel (`js/language-estimate.js`).

Open `language-probability.qgz` in QGIS to inspect every layer. The DEM and the downloaded sites aren't committed, so run `run_all.py` once on a fresh clone first.

## Rebuild

From the QGIS Python console (or any Python with GDAL, numpy and scipy):

```python
exec(open('/Users/owen/Documents/IGL/mesoamerican-languages/analysis/run_all.py').read())
```

This downloads the current sites from the hosted feature layer, then cleans, validates and
rebuilds everything in about 4 minutes. It writes `data/language-probability.tif` and `.json` for the site, and
`analysis/output/` for QGIS. Rerun it whenever the survey data changes.

## Method

1. **Observations** (`prep_sites.py`). Each record is one (respondent, place, language).
   - Only towns of origin (`town_origin`, the + points on the map) are used. `intelligible_place` reports are left out,
     matching the map's `ORIGIN_ONLY` filter in `js/map-layers.js`.
   - Rows with a blank `Language` are recovered from the survey `iso_code`, mostly Todos Santos Mam.
   - Five languages exist only in survey codes and are added here (Southern Mam, Central Mam,
     Sierra Negra Nahuatl, Silacayoapan Mixtec, San Vicente Coatlán Zapotec).
   - Spanish, English, Mexican Sign Language and US sites are dropped.
   - A place naming k languages gives each 1/k.
   - Duplicates within a respondent collapse.
   - Each respondent's total weight is capped at 3, so one prolific respondent can't dominate an area.
2. **Distance** (`terrain_cost.py`). Walking time over a 1 km DEM from the AWS Terrarium tiles, using
   Tobler's hiking function on an 8-neighbour grid (Dijkstra). Sea cells are impassable.
3. **Model** (`build_raster.py`). A Gaussian kernel on walking time, bandwidth 3 h.
   P(language | cell) = that language's weighted kernel sum ÷ the sum over all languages.
   Cells more than 60 km (straight line) from any report get no estimate.
4. **Evidence check**, so a lone report like Hidalgo del Parral can't read as 100%:
   - **Effective respondents:** each respondent counts once, at their nearest report's kernel weight,
     so a single report right here counts as about 1.
   - **"Another language":** the share of held-out reports, at that level of effective respondents,
     whose language was missing from the nearby reports. It runs from about 61% with almost no evidence to
     33% at about 1 respondent and about 12% at 8 or more. `validate.py` measures it and writes it to
     `output/calibration.json`.
   - Shown percentage = share × (1 − another language). The remainder shows as "Another language".

## Validation (`validate.py` → `output/validation_*.csv`)

Each observation is predicted without its own respondent's reports. In the spatial runs, all
reports within a gap of 5, 15 or 30 km are hidden too, which mimics clicking an undocumented place.

| Model | gap 5 km top-3 | gap 15 km top-3 | gap 30 km top-3 |
|---|---|---|---|
| Straight-line Gaussian 10 km | 0.77 | 0.45 | 0.25 |
| **Terrain Gaussian 3 h (used)** | **0.78** | **0.46** | **0.26** |
| Most common 3 languages overall | 0.32 | 0.32 | 0.32 |

With towns of origin only there are 204 reports from 198 respondents (it was 553 from 212 with intelligible places),
so held-out accuracy at the larger gaps is lower than before. Terrain still edges out straight-line at every gap, most
clearly in log loss, so the model is unchanged. A paired, respondent-level bootstrap (2000 draws, run on the original
data while choosing the model) favoured terrain at the 15 and 30 km gaps.

Accuracy depends on distance to the nearest report **and** on how many independent people
reported nearby, so a share near 100% from a single respondent overstates it. Calibrated percentages track what
actually happened (`validation_calibration.csv`). For example, shown ≈ 59% was right 62% of the time, where the
uncalibrated model claimed 82%.

The confidence level needs both conditions (`calibration.json`):

| Level | Rule | Top-3 hit rate | Top-1 hit rate |
|---|---|---|---|
| High | ≤ 10 km and ≥ 2.5 effective respondents | ~85% | ~73% |
| Medium | ≤ 25 km and ≥ 1 effective respondent | ~70% | ~59% |
| Low | anything else within 60 km | ~37% | ~28% |
| No estimate | > 60 km from any report | | |

## Outputs

`data/language-probability.tif` is the web raster: EPSG:4326 at 0.01°, a byte COG, 255 = no estimate.
- Bands 1–3: top language index (into `languages` in the `.json`)
- Bands 4–6: calibrated percent
- Band 7: km to the nearest report, also set on water and unreachable cells within 60 km so the panel can say why there's no estimate
- Band 8: "another language" percent
- Band 9: confidence level (index into `confidence`)
- Band 10: effective respondents × 10, capped at 254

`analysis/output/` holds the full-precision versions in EPSG:6372, the per-language probability
stack (the last band is "Another language"), effective respondents, confidence level, walking hours to the nearest report, the DEM, the cleaned observations and the validation tables.

## Known issues and limits

- It reflects survey reports only, not census coverage. Languages nobody reported can't appear,
  and well-sampled areas (K'iche', Todos Santos Mam) pull nearby estimates toward them.
- "Santa Eloisa" (2 Q'anjob'al town-of-origin reports) is geocoded 6 km from Cobán, which
  makes Cobán come out as Q'anjob'al instead of Q'eqchi'. It is likely a mis-geocode of Santa Eulalia,
  Huehuetenango. Fixing it in the source layer and rerunning will correct it.
- One Central Guerrero Nahuatl town of origin sits in Tlalnepantla, so Mexico City shows that
  language. That's correct for the data, but it shows that urban reports are sparse and easily dominated.
