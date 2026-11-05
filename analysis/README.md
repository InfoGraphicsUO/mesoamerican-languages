# Language probability surface

Estimates the most likely languages at any point from the attested sites, for the
"Likely languages here" panel (`js/language-estimate.js`).

Open `language-probability.qgz` in QGIS to inspect every layer.

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
   - Rows with a blank `Language` are recovered from the survey `iso_code`, mostly Todos Santos Mam.
   - Five languages exist only in survey codes and are added here (Southern Mam, Central Mam,
     Sierra Negra Nahuatl, Silacayoapan Mixtec, San Vicente Coatlán Zapotec).
   - Spanish, English, Mexican Sign Language and US sites are dropped.
   - A place naming k languages gives each 1/k.
   - Duplicates within a respondent collapse.
   - Each respondent's total weight is capped at 3, so one prolific respondent can't dominate an area.
   - `town_origin` and `intelligible_place` are weighted equally.
2. **Distance** (`terrain_cost.py`). Walking time over a 1 km DEM from the AWS Terrarium tiles, using
   Tobler's hiking function on an 8-neighbour grid (Dijkstra). Sea cells are impassable.
3. **Model** (`build_raster.py`). A Gaussian kernel on walking time, bandwidth 3 h.
   P(language | cell) = that language's weighted kernel sum ÷ the sum over all languages.
   Cells more than 60 km (straight line) from any report get no estimate.
4. **Evidence check**, so a lone report like Hidalgo del Parral can't read as 100%:
   - **Effective respondents:** each respondent counts once, at their nearest report's kernel weight,
     so a single report right here counts as about 1.
   - **"Another language":** the share of held-out reports, at that level of effective respondents,
     whose language was missing from the nearby reports. It runs from about 47% with almost no evidence to
     31% at about 1 respondent and about 6% at 8 or more. `validate.py` measures it and writes it to
     `output/calibration.json`.
   - Shown percentage = share × (1 − another language). The remainder shows as "Another language".

## Validation (`validate.py` → `output/validation_*.csv`)

Each observation is predicted without its own respondent's reports. In the spatial runs, all
reports within a gap of 5, 15 or 30 km are hidden too, which mimics clicking an undocumented place.

| Model | gap 5 km top-3 | gap 15 km top-3 | gap 30 km top-3 |
|---|---|---|---|
| Straight-line Gaussian 10 km | 0.85 | 0.61 | 0.44 |
| **Terrain Gaussian 3 h (used)** | **0.86** | **0.63** | **0.50** |
| Most common language overall | 0.36 | 0.36 | 0.36 |

A paired, respondent-level bootstrap on these held-out sets (2000 draws, run while choosing the model) favours
terrain at the 15 and 30 km gaps, with log-loss and top-3 confidence intervals above zero. At 5 km there's no difference.

Accuracy depends on distance to the nearest report **and** on how many independent people
reported nearby. A share near 100% from a single respondent was right only about 43–58% of the time,
but about 96–99% with 2 or more. Calibrated percentages track what actually happened
(`validation_calibration.csv`). For example, shown ≈ 57% was right 54% of the time, where the uncalibrated model claimed 86%.

The confidence level needs both conditions (`calibration.json`):

| Level | Rule | Top-3 hit rate | Top-1 hit rate |
|---|---|---|---|
| High | ≤ 10 km and ≥ 2.5 effective respondents | ~90% | ~78% |
| Medium | ≤ 25 km and ≥ 1 effective respondent | ~69% | ~50% |
| Low | anything else within 60 km | ~43% | ~26% |
| No estimate | > 60 km from any report | | |

## Outputs

`data/language-probability.tif` is the web raster: EPSG:4326 at 0.01°, a byte COG, 255 = no estimate.
- Bands 1–3: top language index (into `languages` in the `.json`)
- Bands 4–6: calibrated percent
- Band 7: km to the nearest report
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
