import { initLanguageSwitch, setLanguage } from './language.js';
import { ready } from './map.js';
import { addMapLayers } from './map-layers.js';
import { initInterpretersPanel } from './interpreters-panel.js';
import { loadSearchIndex } from './search-index.js';
import { initSearch } from './search.js';
import { createSearchFocus } from './search-focus.js';
import { initLanguageEstimate } from './language-estimate.js';
import { initRasterOverlay } from './raster-overlay.js';
import { initMatchesPanel } from './matches-panel.js';

// coordinates js files on site load
// three steps down the left: (1) search for a place, (2) pick a language or place, (3) find an interpreter

// the site opens in english, the switch in the top right flips everything to spanish and back
setLanguage('en');
initLanguageSwitch(document.getElementById('language-switch'));

let view = null;

const layers = ready.then(async (readyView) => {
    view = readyView;
    return addMapLayers(view);
});

const searchIndex = layers.then(({ sites }) => loadSearchIndex(sites, view.spatialReference));
const languageEstimate = initLanguageEstimate();
Promise.all([ready, languageEstimate]).then(([readyView, estimate]) => {
    initRasterOverlay(readyView, estimate); // hidden, 1 2 3 4 shows the whole raster
}, () => {});

const searchFocus = layers.then((mapLayers) => createSearchFocus(view, mapLayers));

// search and the interpreters panel share the purple glow, so only the newest pick keeps it
const interpretersPanel = layers.then(({ siteGlow }) => initInterpretersPanel(view, siteGlow, {
    onSelect: () => searchFocus.then((focus) => focus.clearGlow(), () => {})
}));

const interpretersStep = document.getElementById('step-interpreters');

// temporary checkbox that shows steps 2 and 3 before they're reached
const steps = document.querySelector('.steps');
document.getElementById('steps-show-all').addEventListener('change', (event) => {
    steps.classList.toggle('is-showing-all', event.target.checked);
});

const matches = initMatchesPanel({
    index: searchIndex,
    estimate: languageEstimate,
    focus: searchFocus,
    center: () => view && [view.center.longitude, view.center.latitude],
    onPick: ({ label, languages }) => {
        interpretersPanel.then((panel) => {
            panel.clear();
            panel.filter({ label, languages });
            interpretersStep.hidden = false;
            interpretersStep.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, () => {});
    },
    onReset: () => {
        interpretersStep.hidden = true;
        interpretersPanel.then((panel) => panel.clear(), () => {});
    }
});

initSearch({
    onSubmit: (query) => matches.search(query),
    onClear: () => {
        matches.clear();
        searchFocus.then((focus) => focus.clear(), () => {});
    }
});

layers.catch((error) => console.error('Unable to add map layers:', error));
interpretersPanel.catch((error) => console.error('Unable to load interpreters panel:', error));
languageEstimate.catch((error) => console.error('Unable to load language estimates:', error));
searchIndex.catch((error) => console.error('Unable to build the search index:', error));
searchFocus.catch((error) => console.error('Unable to connect search to the map:', error));
