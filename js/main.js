import { ready } from './map.js';
import { addMapLayers } from './map-layers.js';

// coordinates js files on site load

ready.then(async (view) => { // wait for map before adding layers
    try {
        await addMapLayers(view);
    } catch (error) {
        console.error('Unable to add map layers:', error);
    }
}).catch((error) => console.error('Map failed to become ready:', error));
