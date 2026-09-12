// anything map.js needs at load time has to be defined before main.js runs

// Mapbox access token for this project
export const MAPBOX_TOKEN = 'pk.eyJ1IjoiaW5mb2dyYXBoaWNzIiwiYSI6ImNqaTR0eHhnODBjeTUzdmx0N3U2dWU5NW8ifQ.fVbTCmIrqILIzv5QGtVJ2Q';

// keep map settings in one place so other js files can reuse the same bounds and zooms
export const MAP = {
    style: 'mapbox://styles/infographics/cmlhb3rze006q01sn2k2k5qki', // custom basemap for this project
    center: [-96.355, 17.8],
    zoom: 4.5,
    minZoom: 4.35,
    bounds: [
        [-120.425, -1], // southwest
        [-61, 34] // northeast
    ]
};

// shared icon scale so every point layer grows the same way as you zoom
export const ICON_SIZE = ['interpolate', ['linear'], ['zoom'], MAP.minZoom, 0.6, 8, 0.82, 12, 1];

// store folders used to build data and marker urls
export const PATHS = {
    data: 'data',
    markers: 'img/markers'
};

mapboxgl.accessToken = MAPBOX_TOKEN; // set the token

// main map
export const map = new mapboxgl.Map({
    container: 'map',
    style: MAP.style, // use the custom basemap stored above
    center: MAP.center,
    zoom: MAP.zoom,
    minZoom: MAP.minZoom,
    maxBounds: MAP.bounds,
    projection: 'mercator',
    pitchWithRotate: false,
});

// add zoom controls without the compass (rotation is disabled below)
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

map.dragRotate.disable();
map.touchZoomRotate.disableRotation();
if (map.touchPitch) map.touchPitch.disable();
map.keyboard.disableRotation();

// creates promise that waits for map to finish loading
// doing things like adding sources/layers need to happen after map load
export const ready = new Promise((resolve) => map.on('load', () => resolve(map)));

// find first text-label layer so new map layers can sit below the labels
export function labelLayerId() {
    return map.getStyle().layers?.find(
        (layer) => 
            layer.type === 'symbol' && // mapbox symbol layer
            layer.layout?.['text-field'] // layer actually draws text
    )?.id;
}

// fetch geojson, register it w/ mapbox, and return the parsed data for legends/search
export async function addGeojsonSource(id, url) {
    // id: name mapbox uses for the source
    // url: location of the geojson file

    const response = await fetch(url); // get file from path

    if (!response.ok) throw new Error(`${url} failed with ${response.status}`); // success?

    const data = await response.json(); // convert json text into a js object

    // the search focus layer needs predictable ids
    // source data has no reliable ids, so use each feature's position in the file
    if (Array.isArray(data.features)) {
        data.features.forEach((feature, index) => {
            feature.id = index + 1;
        });
    }

    // register data w/ mapbox as a geojson source
    map.addSource(id, {
        type: 'geojson',
        data 
    });

    return data; // parsed geojson for the caller to build layers and legends
}

function loadImage(url) {
    // load one image from a url (not exported bc only map.js uses it)

    // image loading is async, so wrap it in a promise
    return new Promise((resolve, reject) => {
        const image = new Image(); // new browser image object
        image.onload = () => resolve(image); // success!
        image.onerror = () => reject(new Error(`could not load ${url}`)); // keep the failed url in the warning
        image.src = url; // start loading the image
    });
}

// load marker images and register w/ mapbox
// icons will be a list looking something like this:
// [
//     {
//         id: 'mayan-plus',
//         url: 'img/markers/mayan-plus.svg'
//     }
// ]
export async function loadIcons(icons) {
    const loaded = new Set(); // ids for icons that loaded successfully

    // load all marker images and record which ones load successfully
    await Promise.all(icons.map(async ({ id, url }) => {
        // reuse an image mapbox already knows about
        if (map.hasImage(id)) { 
            loaded.add(id); 
            return; 
        }

        // try loading the image, add it w/ this id, and record it in the set
        try {
            map.addImage(id, await loadImage(url));
            loaded.add(id);
        } catch (error) {
            console.warn(error.message);
        }
    }));

    return loaded; // set of successfully loaded icon ids
}
