import { ready } from './map.js';
import { addMapLayers } from './map-layers.js';
import { initInterpretersPanel } from './interpreters-panel.js';
import { loadSearchIndex } from './search-index.js';
import { initSearch } from './search.js';

// coordinates js files on site load

let view = null;

// sites get indexed once the layer is on the map, the search bar works w/ other places until then
const layers = ready.then(async (readyView) => {
    view = readyView;
    return addMapLayers(view);
});

const searchIndex = layers.then(({ sites }) => loadSearchIndex(sites, view.spatialReference));

initSearch({
    index: searchIndex,
    center: () => view && [view.center.longitude, view.center.latitude]
});

layers.then(async ({ siteGlow }) => {
    try {
        await initInterpretersPanel(view, siteGlow);
    } catch (error) {
        console.error('Unable to load interpreters panel:', error);
    }
}).catch((error) => console.error('Unable to add map layers:', error));

searchIndex.catch((error) => console.error('Unable to build the search index:', error));
