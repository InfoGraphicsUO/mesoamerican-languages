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

    // move the map so the selected sites fit beside the open side panel
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
        if (unique.length === 1) {
            // one site gets a centered zoom instead of a bounds calculation
            map.easeTo({ ...options, center: unique[0], zoom: Math.max(map.getZoom(), 11) });
            return;
        }

        // several sites use bounds, leaving room for the panel on the left
        const lngs = unique.map(([lng]) => lng);
        const lats = unique.map(([, lat]) => lat);
        const panelRight = panelElement?.getBoundingClientRect?.().right || 0;
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
            ...options,
            padding: { top: gutter, right: gutter, bottom: gutter, left: panelRight + gutter },
            maxZoom: 11,
            retainPadding: false
        });
    }

    return { highlight, clearHighlight, frame };
}
