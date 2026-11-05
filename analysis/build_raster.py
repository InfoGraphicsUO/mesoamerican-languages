"""Build the language-probability rasters from cleaned observations.

Model (chosen by spatial cross-validation, see analysis/README.md):
  terrain walking-time distance (Tobler, 1 km DEM) + Gaussian kernel, bandwidth 3 h.
  share(language | cell) = weighted kernel sum for that language / sum over languages.
Evidence check, so a lone report can't read as certain:
  effective respondents = each respondent counted once, at their nearest report's kernel weight.
  'another language' = the tested chance that the language here is none of the documented nearby ones,
  looked up from effective respondents (calibration.json from validate.py).
  shown probability = share x (1 - another language).
  confidence level = distance to the nearest report AND effective respondents (calibration.json).
Cells further than MAX_NEAREST_KM (straight line) from any report are left empty.

Run inside QGIS Python (needs GDAL, numpy, scipy):
  build(obs_csv, dem_tif, out_dir, web_dir)   # out_dir must hold calibration.json
"""
import json
import os

import numpy as np
from osgeo import gdal
from scipy.spatial import cKDTree

import language_model as lm
import terrain_cost as tc

BANDWIDTH_HOURS = 3.0
SLOPE_FACTOR = 3.5
MAX_NEAREST_KM = 60
DIJKSTRA_LIMIT_HOURS = 110  # exp(-0.5*(110/3)^2) is still above float64 underflow
WEB_RES_DEG = 0.01
WEB_BANDS = ['top1', 'top2', 'top3', 'p1', 'p2', 'p3', 'nearest_km', 'another_language', 'confidence', 'respondents_x10']


def write_tif(path, arrays, gt, prj, dtype, nodata, names=None):
    rows, cols = arrays[0].shape
    ds = gdal.GetDriverByName('GTiff').Create(path, cols, rows, len(arrays), dtype,
                                              ['COMPRESS=DEFLATE', 'TILED=YES', 'PREDICTOR=2' if dtype != gdal.GDT_Float32 else 'PREDICTOR=3'])
    ds.SetGeoTransform(gt)
    ds.SetProjection(prj)
    for i, a in enumerate(arrays, 1):
        b = ds.GetRasterBand(i)
        b.WriteArray(a)
        b.SetNoDataValue(nodata)
        if names:
            b.SetDescription(names[i - 1])
    ds = None


def build(obs_csv, dem_tif, out_dir, web_dir):
    os.makedirs(out_dir, exist_ok=True)
    calibration = json.load(open(os.path.join(out_dir, 'calibration.json')))
    levels = calibration['confidence']
    obs = lm.load_obs(obs_csv)
    x, y = lm.project(obs['lon'], obs['lat'])
    dem, gt, prj = tc.load_dem(dem_tif)
    rows, cols = dem.shape
    n_lang = len(obs['langs'])

    # cells to model: land within MAX_NEAREST_KM of a report
    cx = gt[0] + (np.arange(cols) + 0.5) * gt[1]
    cy = gt[3] + (np.arange(rows) + 0.5) * gt[5]
    gx, gy = np.meshgrid(cx, cy)
    nearest_m, _ = cKDTree(np.column_stack([x, y])).query(np.column_stack([gx.ravel(), gy.ravel()]))
    nearest_km = (nearest_m / 1000).reshape(rows, cols)
    target = np.flatnonzero(((nearest_km <= MAX_NEAREST_KM) & (dem > 0)).ravel())

    # weight per (site cell, language), and which site cells each respondent reported
    cells = tc.snap_to_land(tc.cell_index(x, y, gt, dem.shape), dem)
    ucells, inv = np.unique(cells, return_inverse=True)
    site_w = np.zeros((len(ucells), n_lang))
    np.add.at(site_w, (inv, obs['lang']), obs['weight'])
    _, resp_idx = np.unique(obs['respondent'], return_inverse=True)

    graph = tc.build_graph(dem, abs(gt[1]), SLOPE_FACTOR)
    dens = np.zeros((len(target), n_lang))
    hours_nearest = np.full(len(target), np.inf)
    site_kernel = np.zeros((len(ucells), len(target)), dtype=np.float32)  # kept for effective respondents
    for i, c in enumerate(ucells):
        t = tc.cost_from(graph, c, DIJKSTRA_LIMIT_HOURS)[target]
        hours_nearest = np.minimum(hours_nearest, t)
        k = np.exp(-0.5 * (t / BANDWIDTH_HOURS) ** 2)  # inf -> 0
        site_kernel[i] = k
        dens += k[:, None] * site_w[i][None, :]

    evidence = np.zeros(len(target))
    for j in range(resp_idx.max() + 1):
        evidence += site_kernel[np.unique(inv[resp_idx == j])].max(axis=0)
    del site_kernel

    total = dens.sum(axis=1)
    ok = total > 0
    share = np.zeros_like(dens)
    share[ok] = dens[ok] / total[ok, None]
    other = lm.other_share(evidence, calibration['other_share'])
    prob = share * (1 - other)[:, None]
    order = np.argsort(-prob, axis=1)[:, :3]
    top_p = np.take_along_axis(prob, order, axis=1)
    near_t = nearest_km.ravel()[target]
    level = lm.confidence_level(near_t, evidence, levels)

    def grid(values, fill, dtype):
        g = np.full(rows * cols, fill, dtype=dtype)
        g[target] = values
        return g.reshape(rows, cols)

    # full-precision outputs for QGIS
    valid = ok
    idx_bands = [grid(np.where(valid & (top_p[:, j] > 0), order[:, j], 255), 255, np.uint8) for j in range(3)]
    write_tif(f'{out_dir}/top3_language.tif', idx_bands, gt, prj, gdal.GDT_Byte, 255, ['top1', 'top2', 'top3'])
    write_tif(f'{out_dir}/top3_probability.tif', [grid(np.where(valid, top_p[:, j], np.nan), np.nan, np.float32)
                                                  for j in range(3)], gt, prj, gdal.GDT_Float32, float('nan'), ['p1', 'p2', 'p3'])
    write_tif(f'{out_dir}/nearest_report_km.tif', [grid(np.where(valid, near_t, np.nan), np.nan, np.float32)],
              gt, prj, gdal.GDT_Float32, float('nan'))
    write_tif(f'{out_dir}/walk_hours_to_nearest_report.tif',
              [grid(np.where(valid & np.isfinite(hours_nearest), hours_nearest, np.nan), np.nan, np.float32)],
              gt, prj, gdal.GDT_Float32, float('nan'))
    write_tif(f'{out_dir}/effective_respondents.tif', [grid(np.where(valid, evidence, np.nan), np.nan, np.float32)],
              gt, prj, gdal.GDT_Float32, float('nan'))
    write_tif(f'{out_dir}/another_language_probability.tif', [grid(np.where(valid, other, np.nan), np.nan, np.float32)],
              gt, prj, gdal.GDT_Float32, float('nan'))
    write_tif(f'{out_dir}/confidence_level.tif', [grid(np.where(valid, level + 1, 0), 0, np.uint8)],
              gt, prj, gdal.GDT_Byte, 0)  # 1 high, 2 medium, 3 low
    pct = [grid(np.where(valid, np.round(prob[:, li] * 100), 255), 255, np.uint8) for li in range(n_lang)]
    pct.append(grid(np.where(valid, np.round(other * 100), 255), 255, np.uint8))
    write_tif(f'{out_dir}/probability_by_language.tif', pct, gt, prj, gdal.GDT_Byte, 255,
              [m['name'] for m in obs['meta']] + ['Another language'])

    # web raster: EPSG:4326, one byte per band, read one pixel at a time in the browser
    #   1-3 top language index, 4-6 percent, 7 km to nearest report, 8 another language percent,
    #   9 confidence level index into lookup.confidence, 10 effective respondents x 10 (capped at 25.4)
    #   (255 = no estimate everywhere)
    tmp = f'{out_dir}/_web_6372.tif'
    pct_bands = [grid(np.where(valid, np.round(top_p[:, j] * 100), 255), 255, np.uint8) for j in range(3)]
    extra = [grid(np.where(valid, np.round(near_t), 255), 255, np.uint8),
             grid(np.where(valid, np.round(other * 100), 255), 255, np.uint8),
             grid(np.where(valid, level, 255), 255, np.uint8),
             grid(np.where(valid, np.round(np.minimum(evidence, 25.4) * 10), 255), 255, np.uint8)]
    write_tif(tmp, idx_bands + pct_bands + extra, gt, prj, gdal.GDT_Byte, 255, WEB_BANDS)
    warped = f'{out_dir}/_web_4326.tif'
    gdal.Warp(warped, tmp, dstSRS='EPSG:4326', xRes=WEB_RES_DEG, yRes=WEB_RES_DEG, resampleAlg='near',
              srcNodata=255, dstNodata=255, targetAlignedPixels=True, creationOptions=['COMPRESS=DEFLATE'])
    os.makedirs(web_dir, exist_ok=True)
    gdal.Translate(f'{web_dir}/language-probability.tif', warped, format='COG',
                   creationOptions=['COMPRESS=DEFLATE', 'PREDICTOR=2', 'BLOCKSIZE=256', 'OVERVIEWS=NONE'])
    os.remove(tmp)
    os.remove(warped)

    lookup = dict(
        model=dict(method='terrain walking-time Gaussian kernel density, evidence-calibrated',
                   bandwidth_hours=BANDWIDTH_HOURS, tobler_slope_factor=SLOPE_FACTOR, max_nearest_km=MAX_NEAREST_KM,
                   observations=len(obs['rows']), respondents=int(len(set(obs['respondent'])))),
        bands=WEB_BANDS,
        nodata=255,
        confidence=levels,
        other_share=calibration['other_share'],
        languages=obs['meta'],
    )
    json.dump(lookup, open(f'{web_dir}/language-probability.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return dict(cells=int(valid.sum()), languages=n_lang)
