"""Rebuild everything: download sites, clean them, fetch the DEM, validate, build rasters.

Run from the QGIS Python console (needs GDAL, numpy, scipy):
    exec(open('/path/to/mesoamerican-languages/analysis/run_all.py').read())
or with any Python that has those:  python3 analysis/run_all.py
Takes ~5 minutes, mostly the DEM download (cached after the first run) and the cost-distance passes.
"""
import os
import sys
import urllib.request

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:  # exec() from the QGIS console
    HERE = os.path.join(os.getcwd(), 'analysis') if os.path.isdir('analysis') else os.path.expanduser(
        '~/Documents/IGL/mesoamerican-languages/analysis')
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'output')
WORK = os.path.join(HERE, '.cache')

SITES_URL = ('https://services5.arcgis.com/W1uyphp8h2tna3qJ/arcgis/rest/services/Attested_Sites_With_Family/'
             'FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson')

import build_raster  # noqa: E402
import fetch_dem  # noqa: E402
import prep_sites  # noqa: E402
import validate  # noqa: E402

os.makedirs(OUT, exist_ok=True)
os.makedirs(WORK, exist_ok=True)
sites = os.path.join(OUT, 'attested_sites.geojson')
obs = os.path.join(OUT, 'observations.csv')
dem = os.path.join(OUT, 'dem_1km.tif')

print('downloading sites')
urllib.request.urlretrieve(SITES_URL, sites)
print('cleaning sites')
prep_sites.main(sites, obs)
if not os.path.exists(dem):
    print('fetching DEM')
    fetch_dem.fetch(dem, WORK)
print('validating')
validate.run(obs, dem, OUT)
print('building rasters')
print(build_raster.build(obs, dem, OUT, os.path.join(ROOT, 'data')))
