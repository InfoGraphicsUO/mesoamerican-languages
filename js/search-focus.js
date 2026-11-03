import { PATHS } from './map.js';
import { FIELDS, GLOW_SIZES, sitePopup } from './map-layers.js';
import { locatePlace } from './place-search.js';

// shows a picked search result on the map
// families, groups, and languages: zoom to all their sites and glow them
// documented places: zoom in, glow the site, and open its popup
// other places: zoom to the geocoded spot and drop a pin
// exports createSearchFocus

const SITE_ZOOM = 11; // closest our sites get framed
const PLACE_ZOOM = 12; // closest a geocoded place gets framed, town extents would otherwise zoom to street level
const FRAME_GUTTER = 48; // px kept clear between framed results and the map edge or panels

// panels that sit over the map, results get framed in the part of the map they leave open
// only their position is read, nothing about them changes
const OVERLAYS = ['.map-toolbar', '.interpreters-panel'];

// web mercator meters per pixel at zoom 0, and the scale that goes w/ one meter per pixel at 96 dpi
const RESOLUTION_AT_ZOOM_0 = 156543.03392804097;
const SCALE_PER_RESOLUTION = 96 * 39.37;

// part of the map not covered by a panel, in px from the map's top-left
// tall panels on the left push the open area right, short ones along the top push it down
// on narrow screens a left panel covers most of the width, so it gets ignored there
function openArea(view) {
    const box = view.container.getBoundingClientRect();
    const area = { left: 0, top: 0, right: box.width, bottom: box.height };

    for (const selector of OVERLAYS) {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) continue;
        const left = rect.left - box.left;
        const top = rect.top - box.top;

        if (left < box.width * 0.25 && rect.height > box.height * 0.3) {
            if (left + rect.width < box.width * 0.6) area.left = Math.max(area.left, left + rect.width);
        } else if (top < box.height * 0.25) {
            area.top = Math.max(area.top, top + rect.height);
        }
    }

    return {
        left: area.left + FRAME_GUTTER,
        top: area.top + FRAME_GUTTER,
        right: area.right - FRAME_GUTTER,
        bottom: area.bottom - FRAME_GUTTER
    };
}

// glow size in px at a zoom, between the stops in GLOW_SIZES
function glowSize(zoom) {
    const stops = GLOW_SIZES;
    if (zoom <= stops[0].zoom) return stops[0].size;
    const upper = stops.findIndex((stop) => stop.zoom >= zoom);
    if (upper < 0) return stops.at(-1).size;
    const low = stops[upper - 1];
    const high = stops[upper];
    return low.size + (high.size - low.size) * (zoom - low.zoom) / (high.zoom - low.zoom);
}

// pickedPopup: from addMapLayers in js/map-layers.js
export async function createSearchFocus(view, { pickedPopup }) {
    const [Graphic, GraphicsLayer, Point, reactiveUtils, webMercatorUtils] = await Promise.all([
        $arcgis.import('@arcgis/core/Graphic.js'),
        $arcgis.import('@arcgis/core/layers/GraphicsLayer.js'),
        $arcgis.import('@arcgis/core/geometry/Point.js'),
        $arcgis.import('@arcgis/core/core/reactiveUtils.js'),
        $arcgis.import('@arcgis/core/geometry/support/webMercatorUtils.js')
    ]);

    // search highlight, the same purple glow as the interpreters but on its own layer
    // so a search result and an interpreter can be highlighted at the same time
    // a graphics layer draws as soon as graphics are added, a filtered or client-side feature layer
    // took seconds to catch up while the map zoomed. it has no size by zoom, so glowSymbol does that
    const glows = new GraphicsLayer({ id: 'search-glow', title: 'Searched language sites' });
    view.map.add(glows, 0); // bottom, so it draws behind the site markers

    // pin for other places, on top of everything else
    const pins = new GraphicsLayer({ id: 'search-pin', title: 'Searched place' });
    view.map.add(pins);

    const glowSymbol = (zoom) => {
        const size = `${Math.round(glowSize(zoom))}px`;
        return { type: 'picture-marker', url: `${PATHS.markers}/highlight-glow.svg`, width: size, height: size };
    };

    // resize the glow once the map settles at a new zoom
    reactiveUtils.watch(() => view.stationary && view.zoom, (zoom) => {
        if (zoom === false || !glows.graphics.length) return;
        const symbol = glowSymbol(zoom);
        glows.graphics.forEach((graphic) => { graphic.symbol = symbol; });
    });

    let pick = 0; // newest pick, so a slow geocoder answer cant undo a later one

    function glow(sites) {
        const symbol = glowSymbol(view.zoom);
        glows.removeAll();
        glows.addMany(sites.filter((site) => site.geometry).map((site) => new Graphic({ geometry: site.geometry, symbol })));
    }

    // goTo rejects when another move interrupts it, which is fine
    const goTo = (target) => view.goTo(target, { duration: 700 }).catch(() => {});

    // fit a box of web mercator coordinates into the open part of the map, no closer than maxZoom
    // goTo on its own would center on the whole map and leave results under the panels
    function frame({ xmin, ymin, xmax, ymax }, maxZoom) {
        const area = openArea(view);
        const width = Math.max(area.right - area.left, 1);
        const height = Math.max(area.bottom - area.top, 1);

        // meters per px that fits the box, capped so single sites dont zoom in too far
        const resolution = Math.max(
            (xmax - xmin) / width,
            (ymax - ymin) / height,
            RESOLUTION_AT_ZOOM_0 / 2 ** maxZoom
        );

        // put the box's center at the open area's center, then work out where that puts the map's center
        const offsetX = view.width / 2 - (area.left + area.right) / 2;
        const offsetY = view.height / 2 - (area.top + area.bottom) / 2;
        const center = new Point({
            x: (xmin + xmax) / 2 + offsetX * resolution,
            y: (ymin + ymax) / 2 - offsetY * resolution, // screen y runs down, map y runs up
            spatialReference: view.spatialReference
        });

        goTo({ center, scale: resolution * SCALE_PER_RESOLUTION });
    }

    // points: geometries in the view's spatial reference
    function framePoints(points, maxZoom) {
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        frame({ xmin: Math.min(...xs), ymin: Math.min(...ys), xmax: Math.max(...xs), ymax: Math.max(...ys) }, maxZoom);
    }

    // the math above needs meters, a web map in another projection just gets the sdk's own framing
    const canFrame = () => view.spatialReference.isWebMercator;

    // forget the last pick, returns the new pick's number
    function reset() {
        pick += 1;
        pins.removeAll();
        pickedPopup.hide();
        return pick;
    }

    function clear() {
        reset();
        glow([]);
    }

    async function show(result) {
        const current = reset();

        if (result.source === 'data') {
            const { item } = result;
            const points = item.sites.map((site) => site.geometry).filter(Boolean);
            glow(item.sites);
            if (!points.length) return;
            if (canFrame()) framePoints(points, SITE_ZOOM);
            else goTo(points);

            // a documented place opens the same popup as clicking its marker
            // prefer a row that names its language, some rows at a place only have survey codes
            if (item.kind === 'place') {
                const site = item.sites.find((row) => String(row.attributes[FIELDS.language] ?? '').trim()) || item.sites[0];
                pickedPopup.show(site.geometry, sitePopup({ attributes: site.attributes }));
            }
            return;
        }

        glow([]);
        let location = null;
        try {
            location = await locatePlace(result.suggestion);
        } catch (error) {
            console.error('Unable to locate place:', error);
        }
        if (!location || current !== pick) return;

        const point = new Point({ x: location.x, y: location.y, spatialReference: { wkid: 4326 } });
        pins.add(new Graphic({
            geometry: point,
            symbol: {
                type: 'picture-marker',
                url: `${PATHS.markers}/place-pin.svg`,
                width: '32px',
                height: '32px',
                yoffset: '13px' // tip of the pin sits on the place, not its middle
            },
            attributes: { name: result.label }
        }));

        // states and municipalities come back w/ a big extent, towns w/ a small one that the zoom cap handles
        if (!canFrame()) {
            goTo({ target: point, zoom: PLACE_ZOOM });
            return;
        }
        const extent = location.extent || { xmin: location.x, ymin: location.y, xmax: location.x, ymax: location.y };
        const [xmin, ymin] = webMercatorUtils.lngLatToXY(extent.xmin, extent.ymin);
        const [xmax, ymax] = webMercatorUtils.lngLatToXY(extent.xmax, extent.ymax);
        frame({ xmin, ymin, xmax, ymax }, PLACE_ZOOM);
    }

    return { show, clear };
}
