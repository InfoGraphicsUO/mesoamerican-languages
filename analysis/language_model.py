"""Kernel-density language classifier: shared math for validation and raster output.

P(language | x) = sum of weighted kernels for that language / sum over all languages.
Distances are either straight-line (projected metres) or terrain cost-distance; the
kernel just takes a distance matrix, so both paths share this code.

Runs anywhere with numpy (QGIS Python is fine).
"""
import csv

import numpy as np

CRS = 'EPSG:6372'  # Mexico ITRF2008 / LCC, metres, also fine for Guatemala


def load_obs(path):
    rows = list(csv.DictReader(open(path, encoding='utf-8')))
    langs = sorted({r['iso'] for r in rows})
    meta = {}
    for r in rows:
        meta[r['iso']] = dict(iso=r['iso'], name=r['language'], glottocode=r['glottocode'],
                              family=r['family'], group=r['group'])
    return dict(
        rows=rows,
        langs=langs,
        meta=[meta[l] for l in langs],
        lon=np.array([float(r['lon']) for r in rows]),
        lat=np.array([float(r['lat']) for r in rows]),
        lang=np.array([langs.index(r['iso']) for r in rows]),
        weight=np.array([float(r['weight']) for r in rows]),
        respondent=np.array([r['respondent'] for r in rows]),
        origin=np.array([r['role'] == 'town_origin' for r in rows]),
    )


def project(lon, lat):
    from osgeo import osr
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    dst.ImportFromEPSG(int(CRS.split(':')[1]))
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    t = osr.CoordinateTransformation(src, dst)
    xy = np.array(t.TransformPoints(np.column_stack([lon, lat]).tolist()))[:, :2]
    return xy[:, 0], xy[:, 1]


def kernel(dist, bandwidth):
    """Gaussian kernel, unnormalised so a sum reads as 'effective nearby observations'."""
    return np.exp(-0.5 * (dist / bandwidth) ** 2)


def adaptive_bandwidths(dist_between_obs, k, h_min, h_max):
    """Per-observation bandwidth = distance to the k-th nearest *other location*.
    Dense areas get tight kernels (sharp boundaries), isolated sites spread wider."""
    d = np.where(dist_between_obs > 1.0, dist_between_obs, np.inf)  # ignore same-location stacks
    kth = np.sort(d, axis=1)[:, min(k, d.shape[1]) - 1]
    return np.clip(kth, h_min, h_max)


def class_density(dist, obs, bandwidth, mask=None):
    """dist: (n_targets, n_obs). bandwidth: scalar or (n_obs,). mask: (n_targets, n_obs) bool of obs to use.
    Returns (n_targets, n_langs) weighted kernel sums."""
    k = kernel(dist, bandwidth) * obs['weight'][None, :]
    if mask is not None:
        k = k * mask
    out = np.zeros((dist.shape[0], len(obs['langs'])))
    for li in range(len(obs['langs'])):
        sel = obs['lang'] == li
        out[:, li] = k[:, sel].sum(axis=1)
    return out


def evaluate(dens, obs, test_weight=None):
    """Weighted top-1 / top-3 accuracy and log loss of each observation's own language."""
    w = obs['weight'] if test_weight is None else test_weight
    total = dens.sum(axis=1)
    has = total > 1e-12
    p = np.divide(dens, total[:, None], out=np.zeros_like(dens), where=has[:, None])
    order = np.argsort(-p, axis=1)
    true = obs['lang']
    rank = np.argmax(order == true[:, None], axis=1)
    p_true = p[np.arange(len(true)), true]
    hit1 = (rank == 0) & has
    hit3 = (rank < 3) & has
    eps = 1e-3
    W = w.sum()
    return dict(
        top1=float((hit1 * w).sum() / W),
        top3=float((hit3 * w).sum() / W),
        logloss=float((-np.log(np.clip(p_true, eps, 1)) * w).sum() / W),
        p_true=float((p_true * w).sum() / W),
        coverage=float((has * w).sum() / W),
    )


def holdout_masks(obs, dist, radius=None):
    """Mask (test, train): drop the test respondent's own reports, and optionally everything within radius."""
    m = obs['respondent'][:, None] != obs['respondent'][None, :]
    if radius:
        m &= dist > radius
    return m


def effective_respondents(kernel_matrix, obs):
    """Independent sources behind an estimate: each respondent counts once, at their nearest report's kernel
    weight (1 = right here, fading with walking time). A lone report reads as ~1 however strong its share is."""
    _, ri = np.unique(obs['respondent'], return_inverse=True)
    out = np.zeros(kernel_matrix.shape[0])
    for j in range(ri.max() + 1):
        cols = ri == j
        out += kernel_matrix[:, cols].max(axis=1)
    return out


def other_share(evidence, table):
    """Chance the language here is none of the documented nearby ones, from the validation table
    [[effective_respondents, share], ...] (monotone, interpolated, flat beyond the ends)."""
    xs, us = zip(*table)
    return np.interp(evidence, xs, us)


def confidence_level(nearest_km, evidence, levels):
    """First level whose distance and evidence rules both pass, else the last (lowest) one."""
    out = np.full(np.shape(nearest_km), len(levels) - 1)
    for i in reversed(range(len(levels))):
        ok = (nearest_km <= levels[i]['max_km']) & (evidence >= levels[i]['min_respondents'])
        out = np.where(ok, i, out)
    return out
