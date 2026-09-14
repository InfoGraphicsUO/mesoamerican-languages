import { map } from './map.js';

// keeps search-result highlighting separate from the marker source
// updating a filter is cheaper than rebuilding the source for every result
export function createMapFocus({ highlightLayerId = 'sites-highlight' } = {}) {
    const emptyFilter = ['==', ['id'], -1];

    // show only the selected feature ids in the highlight layer
    function highlight(ids = []) {
        // normalize one id or a list of ids into unique finite numbers
        const values = [...new Set((Array.isArray(ids) ? ids : [ids])
            .map(Number)
            .filter(Number.isFinite))];
        if (map.getLayer(highlightLayerId)) {
            map.setFilter(highlightLayerId, values.length
                ? ['in', ['id'], ['literal', values]]
                : emptyFilter);
        }
        return values; // caller can see which ids were accepted
    }

    // hide every highlighted feature
    function clearHighlight() {
        if (map.getLayer(highlightLayerId)) map.setFilter(highlightLayerId, emptyFilter);
    }

    // leave room for whichever edge the tools cover: left on desktop, bottom on mobile
    function frame(coordinates = [], panelElement, gutter = 24) {
        const unique = [];
        const seen = new Set();

        // keep valid, unique longitude/latitude pairs only
        for (const coordinate of coordinates || []) {
            if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
            const point = [Number(coordinate[0]), Number(coordinate[1])];
            if (!point.every(Number.isFinite)) continue;
            const key = point.join(',');
            if (!seen.has(key)) { seen.add(key); unique.push(point); }
        }
        if (!unique.length) return; // nothing to frame
        const options = { duration: 600, essential: false };
        const mapRect = map.getContainer().getBoundingClientRect();
        const panelRect = panelElement?.getBoundingClientRect?.();
        const spacing = Number.isFinite(gutter) ? Math.max(0, gutter) : 24;
        const padding = { top: spacing, right: spacing, bottom: spacing, left: spacing };

        if (panelRect && mapRect.width > 0 && mapRect.height > 0) {
            const overlapWidth = Math.max(0, Math.min(mapRect.right, panelRect.right) - Math.max(mapRect.left, panelRect.left));
            const overlapHeight = Math.max(0, Math.min(mapRect.bottom, panelRect.bottom) - Math.max(mapRect.top, panelRect.top));

            if (overlapWidth > 0 && overlapHeight > 0) {
                // sheet covers more of map width, sidebar covers more height
                if (overlapWidth / mapRect.width >= overlapHeight / mapRect.height) {
                    padding.bottom += mapRect.bottom - Math.max(mapRect.top, panelRect.top);
                } else {
                    padding.left += Math.min(mapRect.right, panelRect.right) - mapRect.left;
                }
            }
        }

        // keep at least 1px visible so Mapbox padding stays valid on short screens
        padding.left = Math.min(padding.left, Math.max(0, mapRect.width - padding.right - 1));
        padding.bottom = Math.min(padding.bottom, Math.max(0, mapRect.height - padding.top - 1));

        if (unique.length === 1) {
            // use the same unobscured area as bounds fitting for one site
            map.easeTo({ ...options, center: unique[0], zoom: Math.max(map.getZoom(), 11), padding, retainPadding: false });
            return;
        }

        // several sites use bounds within the exposed portion of the map
        const lngs = unique.map(([lng]) => lng);
        const lats = unique.map(([, lat]) => lat);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
            ...options,
            padding,
            maxZoom: 11,
            retainPadding: false
        });
    }

    return { highlight, clearHighlight, frame };
}
