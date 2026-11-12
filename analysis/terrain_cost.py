"""Terrain-aware distance: walking time over a DEM grid, via Dijkstra on an 8-neighbour graph.

Edge cost = horizontal length / speed, speed from Tobler's hiking function on the edge slope
(symmetric: uphill and downhill cost the same so distances stay a proper metric).
Sea cells (elevation <= 0) are impassable.
"""
import numpy as np
from osgeo import gdal
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra


def load_dem(path):
    ds = gdal.Open(path)
    dem = ds.GetRasterBand(1).ReadAsArray().astype(np.float64)
    return dem, ds.GetGeoTransform(), ds.GetProjection()


def tobler_hours(length_m, rise_m, slope_factor=3.5):
    slope = np.abs(rise_m) / length_m
    speed_kmh = 6.0 * np.exp(-slope_factor * (slope + 0.05))  # 5 km/h on the flat
    return (length_m / 1000.0) / speed_kmh


def build_graph(dem, cell, slope_factor=3.5):
    rows, cols = dem.shape
    idx = np.arange(rows * cols).reshape(rows, cols)
    land = dem > 0
    src, dst, cost = [], [], []
    # four directions cover all 8 neighbours when the graph is undirected
    for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
        r0, r1 = 0, rows - dr
        c0, c1 = max(0, -dc), cols - max(0, dc)
        a = (slice(r0, r1), slice(c0, c1))
        b = (slice(r0 + dr, r1 + dr), slice(c0 + dc, c1 + dc))
        ok = land[a] & land[b]
        length = cell * np.hypot(dr, dc)
        rise = dem[b] - dem[a]
        src.append(idx[a][ok])
        dst.append(idx[b][ok])
        cost.append(tobler_hours(length, rise[ok], slope_factor))
    src, dst, cost = map(np.concatenate, (src, dst, cost))
    n = rows * cols
    return coo_matrix((cost, (src, dst)), shape=(n, n)).tocsr()


def cell_index(x, y, gt, shape):
    col = np.floor((x - gt[0]) / gt[1]).astype(int)
    row = np.floor((y - gt[3]) / gt[5]).astype(int)
    col = np.clip(col, 0, shape[1] - 1)
    row = np.clip(row, 0, shape[0] - 1)
    return row * shape[1] + col


def snap_to_land(cells, dem):
    """Move any site that falls on a sea cell to the nearest land cell (coastal towns)."""
    rows, cols = dem.shape
    land_r, land_c = np.nonzero(dem > 0)
    out = cells.copy()
    for i, c in enumerate(cells):
        r, cc = divmod(int(c), cols)
        if dem[r, cc] <= 0:
            j = np.argmin((land_r - r) ** 2 + (land_c - cc) ** 2)
            out[i] = land_r[j] * cols + land_c[j]
    return out


def cost_from(graph, source_cell, limit_hours):
    return dijkstra(graph, directed=False, indices=int(source_cell), limit=limit_hours)
