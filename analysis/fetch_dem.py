"""Download a 1 km DEM for the study area in EPSG:6372 from the public AWS Terrarium tiles (no key needed).

Terrarium encodes elevation as R*256 + G + B/256 - 32768 metres, zoom 8 is ~600 m at these latitudes.
"""
import os

import numpy as np
from osgeo import gdal, osr

BBOX_LONLAT = (-108.0, 12.5, -87.0, 29.0)
CELL = 1000

WMS = '''<GDAL_WMS><Service name="TMS"><ServerUrl>https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${{z}}/${{x}}/${{y}}.png</ServerUrl></Service>
<DataWindow><UpperLeftX>-20037508.34</UpperLeftX><UpperLeftY>20037508.34</UpperLeftY><LowerRightX>20037508.34</LowerRightX><LowerRightY>-20037508.34</LowerRightY><TileLevel>8</TileLevel><TileCountX>1</TileCountX><TileCountY>1</TileCountY><YOrigin>top</YOrigin></DataWindow>
<Projection>EPSG:3857</Projection><BlockSizeX>256</BlockSizeX><BlockSizeY>256</BlockSizeY><BandsCount>3</BandsCount><DataType>Byte</DataType><Cache><Path>{cache}</Path></Cache></GDAL_WMS>'''


def projected_bounds(crs='EPSG:6372'):
    src, dst = osr.SpatialReference(), osr.SpatialReference()
    src.ImportFromEPSG(4326)
    dst.SetFromUserInput(crs)
    for s in (src, dst):
        s.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    t = osr.CoordinateTransformation(src, dst)
    w, s, e, n = BBOX_LONLAT
    edge = [(lo, la) for lo in np.linspace(w, e, 30) for la in (s, n)] + [(lo, la) for la in np.linspace(s, n, 30) for lo in (w, e)]
    xs, ys = zip(*[t.TransformPoint(lo, la)[:2] for lo, la in edge])
    return [np.floor(min(xs) / CELL) * CELL, np.floor(min(ys) / CELL) * CELL,
            np.ceil(max(xs) / CELL) * CELL, np.ceil(max(ys) / CELL) * CELL]


def fetch(out_tif, work_dir):
    os.makedirs(work_dir, exist_ok=True)
    xml = os.path.join(work_dir, 'terrarium.xml')
    open(xml, 'w').write(WMS.format(cache=os.path.join(work_dir, 'tilecache')))
    rgb = os.path.join(work_dir, 'terrarium_rgb.tif')
    ds = gdal.Warp(rgb, xml, dstSRS='EPSG:6372', outputBounds=projected_bounds(), xRes=CELL, yRes=CELL,
                   resampleAlg='near', multithread=True, creationOptions=['COMPRESS=DEFLATE', 'TILED=YES'])
    a = ds.ReadAsArray().astype(np.float64)
    dem = a[0] * 256 + a[1] + a[2] / 256 - 32768
    out = gdal.GetDriverByName('GTiff').Create(out_tif, dem.shape[1], dem.shape[0], 1, gdal.GDT_Float32,
                                               ['COMPRESS=DEFLATE', 'PREDICTOR=3', 'TILED=YES'])
    out.SetGeoTransform(ds.GetGeoTransform())
    out.SetProjection(ds.GetProjection())
    out.GetRasterBand(1).WriteArray(dem)
    out = ds = None
