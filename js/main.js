import { ready } from './map.js';
import { startSearchBox } from './ui.js';
import { makeLegend } from './legend.js';
import { addMapLayers } from './map-layers.js';

// coordinates js files on site load

startSearchBox();

ready.then(async () => { // waits for map to finish loading
    try {
        makeLegend(document.querySelector('#legend'), {
            title: 'Attested language sites',
            sections: await addMapLayers() // add map layers before legend
        });
    } catch (error) {
        console.error(error);
    }
});
