// keep map settings in one place so other js files can reuse the same bounds and zooms
export const MAP = {
    // basemap that works w/o an api key
    // other keyless options: 'gray-vector', 'topo-vector', 'streets-vector', 'dark-gray-vector', 'satellite', 'hybrid'
    // the newer 'arcgis/...' styles (like 'arcgis/light-gray') need an api key
    basemap: 'gray-vector',

    // optional: item id of a web map shared publicly on arcgis online
    // when set, the web map's basemap and layers replace the basemap above
    webMapId: '',

    center: [-96.355, 17.8], // [longitude, latitude]
    zoom: 4.5,
    minZoom: 4, // furthest zoom out, has to be a whole number
    bounds: [
        [-120.425, -1], // southwest
        [-61, 34] // northeast
    ]
};

// store folders used to build data and marker urls
export const PATHS = {
    data: 'data',
    markers: 'img/markers'
};

// the <arcgis-map> element in index.html
export const mapElement = document.querySelector('arcgis-map');

// set these before the map finishes loading so it starts in the right place
if (MAP.webMapId) mapElement.itemId = MAP.webMapId;
else mapElement.basemap = MAP.basemap;
mapElement.center = MAP.center;
mapElement.zoom = MAP.zoom;

// keep the map north-up and inside the project area
mapElement.constraints = {
    rotationEnabled: false,
    snapToZoom: false, // allow in-between zooms like 4.5
    minZoom: MAP.minZoom,
    geometry: {
        type: 'extent',
        xmin: MAP.bounds[0][0],
        ymin: MAP.bounds[0][1],
        xmax: MAP.bounds[1][0],
        ymax: MAP.bounds[1][1],
        spatialReference: { wkid: 4326 } // bounds are longitude/latitude
    }
};

// creates promise that waits for map to finish loading
// doing things like adding layers needs to happen after map load
// resolves w/ the MapView, most sdk work happens thru this
export const ready = mapElement.viewOnReady().then(() => mapElement.view);
