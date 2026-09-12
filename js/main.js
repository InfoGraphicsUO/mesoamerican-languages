import { map, ready } from './map.js';
import { makeLegend } from './legend.js';
import { addMapLayers } from './map-layers.js';
import { createSearchIndex } from './search-index.js';
import { createMapFocus } from './map-focus.js';
import { initSidePanel } from './side-panel.js';
import { initLanguageControl, localized, setLanguage } from './language.js';

// coordinates js files on site load

setLanguage('en');
initLanguageControl(map);

ready.then(async () => { // wait for map before adding sources, layers, search, and legend
    let mapData = { sites: null, sections: [] };

    try {
        mapData = await addMapLayers(); // search and legend need the data returned here
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
            title: localized('Legend', 'Leyenda'),
            sections: mapData.sections || [],
            mapFocus
        });
    } catch (error) {
        console.error('Unable to initialize the legend:', error);
    }
}).catch((error) => console.error('Map failed to become ready:', error));
