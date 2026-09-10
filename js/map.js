//anything map.js needs at load time has to be defined before main.js runs

// IGL access token
export const MAPBOX_TOKEN = 'pk.eyJ1IjoiaW5mb2dyYXBoaWNzIiwiYSI6ImNqaTR0eHhnODBjeTUzdmx0N3U2dWU5NW8ifQ.fVbTCmIrqILIzv5QGtVJ2Q';

// store our map settings in one global const if we need to pull these values at any time
export const MAP = {
    style: 'mapbox://styles/infographics/cmlhb3rze006q01sn2k2k5qki', //frank.....
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

// store folders where project files are located
export const PATHS = {
    data: 'data',
    markers: 'img/markers'
};

mapboxgl.accessToken = MAPBOX_TOKEN; // set the token

// main map
export const map = new mapboxgl.Map({
    container: 'map',
    style: MAP.style, //frank!!!!
    center: MAP.center,
    zoom: MAP.zoom,
    minZoom: MAP.minZoom,
    maxBounds: MAP.bounds,
    projection: 'mercator'
});

// add the zoom controls, hide compass
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

// creates promise that waits for map to finish loading
// doing things like adding sources/layers need to happen after map load
export const ready = new Promise((resolve) => map.on('load', () => resolve(map)));

// find id of first text-label layer in mapbox style
export function labelLayerId() {
    return map.getStyle().layers?.find(
        (layer) => 
            layer.type === 'symbol' && // has symbol
            layer.layout?.['text-field'] // contains text 
    )?.id;
}

// fetches geojson and registers it as a source, returns the parsed data for legends etc
export async function addGeojsonSource(id, url) {
    //id: name mapbox uses for source
    //url: location of geojson file

    const response = await fetch(url); // get file from path

    if (!response.ok) throw new Error(`${url} failed with ${response.status}`); // success?

    const data = await response.json(); // concert json text into js object

    // register data w/ mapbox as a geojson source
    map.addSource(id, {
        type: 'geojson',
        data 
    });

    return data; // returns parsed data
}

function loadImage(url) {
    // loads image from url (not exported bc only map.js uses it)

    // create promise because image loading is asynchronous
    return new Promise((resolve, reject) => {
        const image = new Image(); // new browser image object
        image.onload = () => resolve(image); // success!
        image.onerror = () => reject(new Error(`could not load ${url}`)); // oopss....
        image.src = url;// load image from url
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
    const loaded = new Set(); // tracks which icons were successful

    // begin loading each icon
    await Promise.all(icons.map(async ({ id, url }) => {
        // check if mapbox already has the icon first
        if (map.hasImage(id)) { 
            loaded.add(id); 
            return; 
        }

        //try loading image, add image using id, and record it into the set
        try {
            map.addImage(id, await loadImage(url));
            loaded.add(id);
        } catch (error) {
            console.warn(error.message);
        }
    }));

    return loaded; // set of successfully loaded icon ids
}
