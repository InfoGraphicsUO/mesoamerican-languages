"""Click-a-pixel inspector for language-probability.qgz.

Run from the QGIS Python console with the project open:
    exec(open('/Users/owen/Documents/IGL/mesoamerican-languages/analysis/qgis_pixel_inspector.py').read())
Then click anywhere on the map. A "Pixel inspector" panel shows, for that 1 km cell:
  - every language with a non-zero probability, ranked
  - km and walking hours to the nearest report, and the confidence level the site panel would show
  - the reports that drive the estimate: nearby observations with their language, weight and distance
Switch to any other map tool (pan, identify) to stop; run the script again to resume.
"""
import json
import math
import os

from qgis.core import (QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsPointXY, QgsProject,
                       QgsRasterLayer, QgsVectorLayer, QgsWkbTypes)
from qgis.gui import QgsMapToolEmitPoint, QgsRubberBand, QgsVertexMarker
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtWidgets import QDockWidget, QTextBrowser

HERE = os.path.dirname(QgsProject.instance().fileName()) or os.path.expanduser(
    '~/Documents/IGL/mesoamerican-languages/analysis')
OUT = os.path.join(HERE, 'output')
NEARBY_KM = 25  # reports listed in the panel
BANDWIDTH_HOURS = 3.0


class PixelInspector:
    def __init__(self, iface):
        self.iface = iface
        self.canvas = iface.mapCanvas()
        self.crs = QgsCoordinateReferenceSystem('EPSG:6372')
        self.prob = QgsRasterLayer(os.path.join(OUT, 'probability_by_language.tif'), 'p')
        self.near = QgsRasterLayer(os.path.join(OUT, 'nearest_report_km.tif'), 'km')
        self.hours = QgsRasterLayer(os.path.join(OUT, 'walk_hours_to_nearest_report.tif'), 'h')
        self.evidence = QgsRasterLayer(os.path.join(OUT, 'effective_respondents.tif'), 'e')
        self.level = QgsRasterLayer(os.path.join(OUT, 'confidence_level.tif'), 'c')
        lookup = json.load(open(os.path.join(HERE, '..', 'data', 'language-probability.json'), encoding='utf-8'))
        self.languages = lookup['languages']
        self.confidence = lookup['confidence']
        self.obs = QgsVectorLayer('file://' + os.path.join(OUT, 'observations.csv') +
                                  '?delimiter=,&xField=lon&yField=lat&crs=EPSG:4326', 'obs', 'delimitedtext')
        to_m = QgsCoordinateTransform(self.obs.crs(), self.crs, QgsProject.instance())
        self.reports = []
        for f in self.obs.getFeatures():
            p = to_m.transform(f.geometry().asPoint())
            self.reports.append(dict(x=p.x(), y=p.y(), place=f['place'], language=f['language'],
                                     role=f['role'], weight=float(f['weight']), respondent=f['respondent']))

        self.dock = QDockWidget('Pixel inspector', iface.mainWindow())
        self.dock.setObjectName('LanguagePixelInspector')
        self.view = QTextBrowser()
        self.view.setOpenExternalLinks(False)
        self.dock.setWidget(self.view)
        iface.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.dock)

        self.marker = QgsVertexMarker(self.canvas)
        self.marker.setColor(QColor('#9525d1'))
        self.marker.setIconSize(14)
        self.marker.setPenWidth(3)
        self.ring = QgsRubberBand(self.canvas, QgsWkbTypes.GeometryType.PolygonGeometry)
        self.ring.setColor(QColor(149, 37, 209, 30))
        self.ring.setStrokeColor(QColor('#9525d1'))

        self.tool = QgsMapToolEmitPoint(self.canvas)
        self.tool.canvasClicked.connect(self.inspect)
        self.view.setHtml('<p>Click anywhere on the map.</p>')

    def activate(self):
        self.dock.show()
        self.canvas.setMapTool(self.tool)

    def sample(self, layer, point, band=1):
        value, ok = layer.dataProvider().sample(point, band)
        return value if ok and not math.isnan(value) else None

    def inspect(self, map_point, _button):
        to_m = QgsCoordinateTransform(self.canvas.mapSettings().destinationCrs(), self.crs, QgsProject.instance())
        pt = to_m.transform(map_point)
        self.marker.setCenter(map_point)
        from_m = QgsCoordinateTransform(self.crs, self.canvas.mapSettings().destinationCrs(), QgsProject.instance())
        self.ring.reset(QgsWkbTypes.GeometryType.PolygonGeometry)
        for i in range(73):
            a = 2 * math.pi * i / 72
            self.ring.addPoint(from_m.transform(QgsPointXY(pt.x() + NEARBY_KM * 1000 * math.cos(a),
                                                           pt.y() + NEARBY_KM * 1000 * math.sin(a))), i == 72)

        lonlat = QgsCoordinateTransform(self.crs, QgsCoordinateReferenceSystem('EPSG:4326'),
                                        QgsProject.instance()).transform(pt)
        km = self.sample(self.near, pt)
        hours = self.sample(self.hours, pt)
        evidence = self.sample(self.evidence, pt)
        level_code = self.sample(self.level, pt)
        other = self.sample(self.prob, pt, len(self.languages) + 1)
        probs = []
        for band, lang in enumerate(self.languages, 1):
            v = self.sample(self.prob, pt, band)
            if v is not None and v != 255 and v > 0:
                probs.append((v, lang))
        probs.sort(key=lambda t: -t[0])

        html = [f'<h3>{lonlat.y():.4f}, {lonlat.x():.4f}</h3>']
        if km is None or not probs:
            nearest = min((math.hypot(r['x'] - pt.x(), r['y'] - pt.y()) for r in self.reports), default=0) / 1000
            html.append(f'<p><b>No estimate.</b> Nearest report is {nearest:.0f} km away (cut-off 60 km), '
                        'or the cell is sea.</p>')
        else:
            level = self.confidence[int(level_code) - 1] if level_code else self.confidence[-1]
            html.append(f'<p><b>{level["level"].title()} confidence</b>: nearest report {km:.1f} km'
                        f'{f", {hours:.1f} h walk" if hours is not None else ""}; '
                        f'≈{evidence:.1f} effective respondents nearby. '
                        f'Tested hit rate at this level: top-3 ≈ {level["top3"]:.0%}, top-1 ≈ {level["top1"]:.0%}.</p>'
                        f'<p style="color:#666">High needs ≤{self.confidence[0]["max_km"]} km and '
                        f'≥{self.confidence[0]["min_respondents"]} effective respondents; medium ≤{self.confidence[1]["max_km"]} km '
                        f'and ≥{self.confidence[1]["min_respondents"]}.</p>')
            html.append('<table cellspacing="0" cellpadding="3"><tr><th align="left">Language</th>'
                        '<th align="left">Family / group</th><th align="right">%</th></tr>')
            for i, (v, lang) in enumerate(probs):
                style = ' style="font-weight:bold"' if i < 3 else ''
                group = lang['group'] if lang['group'] != lang['family'] else ''
                html.append(f'<tr{style}><td>{lang["name"]}</td><td>{lang["family"]}{" / " + group if group else ""}'
                            f'</td><td align="right">{v:.0f}</td></tr>')
            if other is not None and other != 255:
                html.append(f'<tr style="color:#666;font-style:italic"><td>Another language</td>'
                            f'<td>not in nearby reports</td><td align="right">{other:.0f}</td></tr>')
            html.append('</table>')

        nearby = sorted(((math.hypot(r['x'] - pt.x(), r['y'] - pt.y()) / 1000, r) for r in self.reports),
                        key=lambda t: t[0])
        within = [(d, r) for d, r in nearby if d <= NEARBY_KM]
        html.append(f'<h4>Reports within {NEARBY_KM} km ({len(within)})</h4>')
        if within:
            html.append('<p style="color:#666">Kernel weight = report weight × exp(−½(walk h / 3 h)²); '
                        'straight-line km shown here.</p>')
            html.append('<table cellspacing="0" cellpadding="3"><tr><th align="right">km</th><th align="left">Place</th>'
                        '<th align="left">Language</th><th align="left">Role</th><th align="right">Weight</th>'
                        '<th align="left">Respondent</th></tr>')
            for d, r in within:
                role = 'origin' if r['role'] == 'town_origin' else 'intelligible'
                html.append(f'<tr><td align="right">{d:.1f}</td><td>{r["place"]}</td><td>{r["language"]}</td>'
                            f'<td>{role}</td><td align="right">{r["weight"]:.2f}</td><td>…{r["respondent"][-5:]}</td></tr>')
            html.append('</table>')
        else:
            d, r = nearby[0]
            html.append(f'<p>None. Closest: {r["place"]} ({r["language"]}), {d:.0f} km.</p>')
        self.view.setHtml(''.join(html))


# keep it on qgis.utils so it outlives this script, and a rerun replaces the old panel
import qgis.utils  # noqa: E402

_old = getattr(qgis.utils, 'language_pixel_inspector', None)
if _old:
    _old.dock.close()
    _old.dock.deleteLater()
    _old.marker.hide()
    _old.ring.reset()
qgis.utils.language_pixel_inspector = PixelInspector(qgis.utils.iface)
qgis.utils.language_pixel_inspector.activate()
