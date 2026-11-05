import { initLanguageSwitch, setLanguage } from './language.js';
import { ready } from './map.js';
import { addMapLayers, FIELDS } from './map-layers.js';
import { initInterpretersPanel } from './interpreters-panel.js';
import { loadSearchIndex } from './search-index.js';
import { initSearch } from './search.js';
import { createSearchFocus } from './search-focus.js';
import { initLanguageEstimate } from './language-estimate.js';

// coordinates js files on site load

// the site opens in english, the switch in the top right flips everything to spanish and back
setLanguage('en');
initLanguageSwitch(document.getElementById('language-switch'));

let view = null;

// sites get indexed once the layer is on the map, the search bar works w/ other places until then
const layers = ready.then(async (readyView) => {
    view = readyView;
    return addMapLayers(view);
});

const searchIndex = layers.then(({ sites }) => loadSearchIndex(sites, view.spatialReference));
// clicking anywhere, or landing on a searched place, shows the languages most likely spoken there
const languageEstimate = layers.then(() => initLanguageEstimate(view));
languageEstimate.then((estimate) => view.on('click', (event) => estimate.show(event.mapPoint)), () => {});

const searchFocus = layers.then((mapLayers) => createSearchFocus(view, mapLayers, {
    onPlace: (point, options) => languageEstimate.then((estimate) => estimate.show(point, options), () => {})
}));

// search and the interpreters panel share the purple glow, so only the newest pick keeps it
const interpretersPanel = layers.then(({ siteGlow }) => initInterpretersPanel(view, siteGlow, {
    onSelect: () => searchFocus.then((focus) => focus.clearGlow(), () => {})
}));

initSearch({
    index: searchIndex,
    center: () => view && [view.center.longitude, view.center.latitude],
    onSelect: (result) => {
        interpretersPanel.then((panel) => {
            panel.clear();
            // narrow the panel to the picked languages, other places have none of ours so the full list stays
            if (result.source === 'data') {
                const languages = result.item.sites.map((site) => String(site.attributes[FIELDS.language] ?? '').trim());
                panel.filter({ label: result.label, languages });
            } else {
                panel.showAll();
            }
        }, () => {});
        searchFocus.then((focus) => focus.show(result));
    },
    onClear: () => {
        interpretersPanel.then((panel) => panel.showAll(), () => {});
        searchFocus.then((focus) => focus.clear());
        languageEstimate.then((estimate) => estimate.hide(), () => {});
    }
});

layers.catch((error) => console.error('Unable to add map layers:', error));
interpretersPanel.catch((error) => console.error('Unable to load interpreters panel:', error));
languageEstimate.catch((error) => console.error('Unable to load language estimates:', error));

searchIndex.catch((error) => console.error('Unable to build the search index:', error));
searchFocus.catch((error) => console.error('Unable to connect search to the map:', error));
