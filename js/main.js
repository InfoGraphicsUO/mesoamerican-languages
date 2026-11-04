import { ready } from './map.js';
import { addMapLayers } from './map-layers.js';
import { initInterpretersPanel } from './interpreters-panel.js';
import { loadSearchIndex } from './search-index.js';
import { initSearch } from './search.js';
import { createSearchFocus } from './search-focus.js';

// coordinates js files on site load

let view = null;

// sites get indexed once the layer is on the map, the search bar works w/ other places until then
const layers = ready.then(async (readyView) => {
    view = readyView;
    return addMapLayers(view);
});

const searchIndex = layers.then(({ sites }) => loadSearchIndex(sites, view.spatialReference));
const searchFocus = layers.then((mapLayers) => createSearchFocus(view, mapLayers));

// search and the interpreters panel share the purple glow, so only the newest pick keeps it
const interpretersPanel = layers.then(({ siteGlow }) => initInterpretersPanel(view, siteGlow, {
    onSelect: () => searchFocus.then((focus) => focus.clearGlow(), () => {})
}));

initSearch({
    index: searchIndex,
    center: () => view && [view.center.longitude, view.center.latitude],
    onSelect: (result) => {
        interpretersPanel.then((panel) => panel.clear(), () => {});
        searchFocus.then((focus) => focus.show(result));
    },
    onClear: () => searchFocus.then((focus) => focus.clear())
});

layers.catch((error) => console.error('Unable to add map layers:', error));
interpretersPanel.catch((error) => console.error('Unable to load interpreters panel:', error));

searchIndex.catch((error) => console.error('Unable to build the search index:', error));
searchFocus.catch((error) => console.error('Unable to connect search to the map:', error));
