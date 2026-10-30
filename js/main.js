import { ready } from './map.js';
import { addMapLayers } from './map-layers.js';
import { initInterpretersPanel } from './interpreters-panel.js';

// coordinates js files on site load

ready.then(async (view) => { // wait for map before adding layers
    try {
        await addMapLayers(view);
    } catch (error) {
        console.error('Unable to add map layers:', error);
        return;
    }

    try {
        await initInterpretersPanel();
    } catch (error) {
        console.error('Unable to load interpreters panel:', error);
    }
}).catch((error) => console.error('Map failed to become ready:', error));
