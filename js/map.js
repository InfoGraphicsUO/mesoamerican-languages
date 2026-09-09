// map config + the single map instance, layers import from here
// config lives here rather than main.js because main imports this module,
// so anything map.js needs at load time has to be defined before main runs

export const MAPBOX_TOKEN = 'pk.eyJ1IjoiaW5mb2dyYXBoaWNzIiwiYSI6ImNqaTR0eHhnODBjeTUzdmx0N3U2dWU5NW8ifQ.fVbTCmIrqILIzv5QGtVJ2Q';

export const MAP = {
    style: 'mapbox://styles/infographics/cmlhb3rze006q01sn2k2k5qki',
    center: [-96.355, 17.8],
    zoom: 4.5,
    minZoom: 4.35,
    bounds: [
        [-120.425, -1], // southwest
        [-61, 34] // northeast
    ]
};

// shared scale for point icons so every layer grows the same way with zoom
export const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], MAP.minZoom, 0.6, 8, 0.82, 12, 1];

export const PATHS = {
    data: 'data',
    markers: 'img/markers'
};

mapboxgl.accessToken = MAPBOX_TOKEN;

export const map = new mapboxgl.Map({
    container: 'map',
    style: MAP.style,
    center: MAP.center,
    zoom: MAP.zoom,
    minZoom: MAP.minZoom,
    maxBounds: MAP.bounds,
    projection: 'mercator'
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

// resolves once the style is in and sources/layers can be added
export const ready = new Promise((resolve) => map.on('load', () => resolve(map)));

// id of the first text layer in the style, insert data layers before it so place names stay on top
export function labelLayerId() {
    return map.getStyle().layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
}

// fetches geojson and registers it as a source, returns the parsed data for legends etc
export async function addGeojsonSource(id, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} failed with ${response.status}`);
    const data = await response.json();
    map.addSource(id, { type: 'geojson', data });
    return data;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`could not load ${url}`));
        image.src = url;
    });
}

// registers icons so symbol layers can use them by id
// icons: [{ id, url }], resolves with the ids that made it in, failures only warn
export async function loadIcons(icons) {
    const loaded = new Set();
    await Promise.all(icons.map(async ({ id, url }) => {
        if (map.hasImage(id)) { loaded.add(id); return; }
        try {
            map.addImage(id, await loadImage(url));
            loaded.add(id);
        } catch (error) {
            console.warn(error.message);
        }
    }));
    return loaded;
}
