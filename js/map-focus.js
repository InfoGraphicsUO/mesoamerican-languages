import { map } from './map.js';

// One small controller keeps search-result highlighting separate from the
// marker layer.  Updating one filter is noticeably cheaper than rebuilding a
// source every time the user moves through the result tree.
export function createMapFocus({ highlightLayerId = 'sites-highlight' } = {}) {
    const emptyFilter = ['==', ['id'], -1];

    function highlight(ids = []) {
        const values = [...new Set((Array.isArray(ids) ? ids : [ids])
            .map(Number)
            .filter(Number.isFinite))];
        if (map.getLayer(highlightLayerId)) {
            map.setFilter(highlightLayerId, values.length
                ? ['in', ['id'], ['literal', values]]
                : emptyFilter);
        }
        return values;
    }

    function clearHighlight() {
        if (map.getLayer(highlightLayerId)) map.setFilter(highlightLayerId, emptyFilter);
    }

    function frame(coordinates = [], panelElement, gutter = 24) {
        const unique = [];
        const seen = new Set();
        for (const coordinate of coordinates || []) {
            if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
            const point = [Number(coordinate[0]), Number(coordinate[1])];
            if (!point.every(Number.isFinite)) continue;
            const key = point.join(',');
            if (!seen.has(key)) { seen.add(key); unique.push(point); }
        }
        if (!unique.length) return;
        const options = { duration: 600, essential: false };
        if (unique.length === 1) {
            map.easeTo({ ...options, center: unique[0], zoom: Math.max(map.getZoom(), 11) });
            return;
        }
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
