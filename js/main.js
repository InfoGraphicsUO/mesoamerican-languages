import { ready } from './map.js';
import { mountSearch } from './ui.js';
import { renderLegend } from './legend.js';
import { addMapLayers } from './map-layers.js';

mountSearch();

ready.then(async () => {
    try {
        renderLegend(document.querySelector('#legend'), {
            title: 'Attested language sites',
            sections: await addMapLayers()
        });
    } catch (error) {
        console.error(error);
    }
});
