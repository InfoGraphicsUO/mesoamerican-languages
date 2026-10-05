import { ready } from './map.js';

// coordinates js files on site load

ready.then((view) => { // wait for map before adding layers
    // add layers and interactions here, for example:
    // const GeoJSONLayer = await $arcgis.import('@arcgis/core/layers/GeoJSONLayer.js');
    // view.map.add(new GeoJSONLayer({ url: 'data/sites.geojson' }));
}).catch((error) => console.error('Map failed to become ready:', error));
