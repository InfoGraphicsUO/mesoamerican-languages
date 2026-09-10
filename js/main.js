import { ready } from './map.js';
import { makeLegend } from './legend.js';
import { addMapLayers } from './map-layers.js';
import { createSearchIndex } from './search-index.js';
import { createMapFocus } from './map-focus.js';
import { initSidePanel } from './side-panel.js';

// coordinates js files on site load

ready.then(async () => { // waits for map to finish loading
    let mapData = { sites: null, sections: [] };

    try {
        mapData = await addMapLayers(); // add map layers before the controls
    } catch (error) {
        console.error('Unable to add map layers:', error);
    }

    let mapFocus;
    try {
        mapFocus = createMapFocus();
    } catch (error) {
        console.error('Unable to create map focus:', error);
    }

    try {
        const searchIndex = createSearchIndex(mapData.sites);
        initSidePanel({ searchIndex, mapFocus });
    } catch (error) {
        console.error('Unable to initialize the side panel:', error);
    }

    try {
        makeLegend(document.querySelector('#legend'), {
            title: 'Attested language sites',
            sections: mapData.sections || [],
            mapFocus
        });
    } catch (error) {
        console.error('Unable to initialize the legend:', error);
    }
}).catch((error) => console.error('Map failed to become ready:', error));
