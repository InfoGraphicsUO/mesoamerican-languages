"""Cross-validation behind the model choice and the panel's confidence levels.

Holdouts: each observation is predicted without its own respondent's reports, and for the
spatial runs also without any report within `gap` km, which mimics clicking an undocumented place.
Writes:
  validation_models.csv       model comparison (top-1, top-3, log loss) per holdout gap
  validation_distance.csv     hit rates by distance to the nearest remaining report
  validation_calibration.csv  shown (calibrated) vs actual top-1 rates
  calibration.json            read by build_raster.py: 'another language' share by effective respondents,
                              and the confidence levels with their tested hit rates
"""
import csv
import json

import numpy as np

import language_model as lm
import terrain_cost as tc

GAPS_KM = [0, 5, 15, 30]
CALIBRATION_GAPS_KM = [0, 2, 5, 10, 15, 20, 30, 40, 50, 75]
DISTANCE_BINS_KM = [0, 1, 5, 10, 15, 25, 40, 60, 100, 10000]
EVIDENCE_BINS = [0, 0.25, 0.5, 1, 1.5, 2.5, 4, 8, 1e9]  # effective respondents
CALIBRATED_BINS = [0, 0.3, 0.5, 0.7, 0.85, 1.01]
MAX_KM = 60  # same cut-off as the raster
# (level, max km to nearest report, min effective respondents): both must pass
CONFIDENCE_RULES = [('high', 10, 2.5), ('medium', 25, 1.0), ('low', MAX_KM, 0.0)]


def terrain_hours(obs, x, y, dem_tif, slope_factor, limit_hours=60):
    dem, gt, _ = tc.load_dem(dem_tif)
    cells = tc.snap_to_land(tc.cell_index(x, y, gt, dem.shape), dem)
    ucells, inv = np.unique(cells, return_inverse=True)
    graph = tc.build_graph(dem, abs(gt[1]), slope_factor)
    T = np.array([tc.cost_from(graph, c, limit_hours)[ucells] for c in ucells])
    T = np.minimum(T, T.T)
    return T[np.ix_(inv, inv)]


def run(obs_csv, dem_tif, out_dir):
    obs = lm.load_obs(obs_csv)
    x, y = lm.project(obs['lon'], obs['lat'])
    D = np.hypot(x[:, None] - x[None, :], y[:, None] - y[None, :])
    T = {sf: terrain_hours(obs, x, y, dem_tif, sf) for sf in (3.5, 10.0)}

    models = [(f'straight-line gaussian {h} km', D, h * 1000) for h in (5, 7.5, 10, 12.5, 15, 20, 30, 60)]
    models += [(f'terrain sf{sf} gaussian {h} h', T[sf], h) for sf in T for h in (1.5, 2, 2.5, 3, 4, 6, 8)]
    with open(f'{out_dir}/validation_models.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['model', 'gap_km', 'top1', 'top3', 'logloss', 'mean_p_true'])
        for name, dist, bw in models:
            for gap in GAPS_KM:
                e = lm.evaluate(lm.class_density(dist, obs, bw, lm.holdout_masks(obs, D, gap * 1000 or None)), obs)
                w.writerow([name, gap, round(e['top1'], 4), round(e['top3'], 4), round(e['logloss'], 4), round(e['p_true'], 4)])

    # calibration for the chosen model, pooled over holdout gaps
    # per held-out report: km to nearest remaining report, effective respondents nearby, raw top share,
    # whether top-1 / top-3 were right, and whether its language was missing from the nearby evidence
    records = []
    for gap in CALIBRATION_GAPS_KM:
        m = lm.holdout_masks(obs, D, gap * 1000 or None)
        K = lm.kernel(T[3.5], 3.0) * m
        dens = lm.class_density(T[3.5], obs, 3.0, m)
        total = dens.sum(1)
        p = dens / np.where(total > 0, total, 1)[:, None]
        rank = np.argmax(np.argsort(-p, 1) == obs['lang'][:, None], 1)
        near = np.where(m, D, np.inf).min(1) / 1000
        absent = p[np.arange(len(p)), obs['lang']] < 0.01
        records.append(np.column_stack([near, lm.effective_respondents(K, obs), p.max(1),
                                        (rank == 0) & (total > 0), (rank < 3) & (total > 0), absent, obs['weight']]))
    r = np.vstack(records)
    near, ev, share, hit1, hit3, absent, wt = r.T

    def wavg(s, v):
        return float((v[s] * wt[s]).sum() / wt[s].sum())

    # 'another language' share by effective respondents, made monotone so more evidence never means less trust
    table = []
    for lo, hi in zip(EVIDENCE_BINS[:-1], EVIDENCE_BINS[1:]):
        s = (ev >= lo) & (ev < hi) & (near <= MAX_KM)
        if s.any():
            table.append([round(float(np.median(ev[s])), 3), wavg(s, absent)])
    shares = np.minimum.accumulate([u for _, u in table])
    table = [[e, round(float(u), 3)] for (e, _), u in zip(table, shares)]

    levels = [dict(level=name, max_km=km, min_respondents=n) for name, km, n in CONFIDENCE_RULES]
    lv = lm.confidence_level(near, ev, levels)
    for i, level in enumerate(levels):
        s = (lv == i) & (near <= MAX_KM)
        level.update(top1=round(wavg(s, hit1), 3), top3=round(wavg(s, hit3), 3))

    json.dump(dict(other_share=table, confidence=levels), open(f'{out_dir}/calibration.json', 'w'), indent=2)

    calibrated = share * (1 - lm.other_share(ev, table))
    with open(f'{out_dir}/validation_calibration.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['shown_top1_from', 'shown_top1_to', 'n', 'mean_shown_top1', 'actual_top1', 'mean_uncalibrated_top1'])
        for lo, hi in zip(CALIBRATED_BINS[:-1], CALIBRATED_BINS[1:]):
            s = (calibrated >= lo) & (calibrated < hi) & (near <= MAX_KM)
            if s.any():
                w.writerow([lo, hi, int(s.sum()), round(wavg(s, calibrated), 3), round(wavg(s, hit1), 3), round(wavg(s, share), 3)])
    with open(f'{out_dir}/validation_distance.csv', 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['nearest_km_from', 'nearest_km_to', 'n', 'top1', 'top3'])
        for lo, hi in zip(DISTANCE_BINS_KM[:-1], DISTANCE_BINS_KM[1:]):
            s = (near >= lo) & (near < hi)
            if s.any():
                w.writerow([lo, hi, int(s.sum()), round(wavg(s, hit1), 3), round(wavg(s, hit3), 3)])
