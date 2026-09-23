import { map, ready } from './map.js';
import { addMapLayers } from './map-layers.js';
import { createSearchIndex } from './search-index.js';
import { createMapFocus } from './map-focus.js';
import { initSidePanel } from './side-panel.js';
import { initLanguageControl, setLanguage } from './language.js';
import { createInterpreterView } from './interpreters-panel.js';

// coordinates js files on site load

setLanguage('en');
initLanguageControl(map);

ready.then(async () => { // wait for map before adding sources, layers, and search
    let mapData = { sites: null };

    try {
        mapData = await addMapLayers();
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
        let snapshot = null;
        try {
            const response = await fetch('data/interpreters.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            snapshot = await response.json();
        } catch (error) {
            console.error('Unable to load interpreter data:', error);
        }
        const container = document.getElementById('interpreters-view');
        let sidePanel = null;
        const interpreterView = createInterpreterView({
            container, snapshot, taxonomy: searchIndex.search(''),
            error: snapshot ? null : 'Interpreter data is unavailable.',
            onViewChange: (view) => sidePanel?.setInterpreterView?.(view)
        });
        sidePanel = initSidePanel({ searchIndex, mapFocus, interpreterView });

        // Marker taps take precedence over the invisible family hull underneath.
        map.on('click', (event) => {
            const features = map.queryRenderedFeatures(event.point, { layers: ['sites', 'family-hulls-fill'] });
            const marker = features.find((feature) => feature.layer.id === 'sites');
            if (marker) {
                sidePanel?.selectMapPoint(marker);
                return;
            }
            const families = [...new Set(features
                .filter((feature) => feature.layer.id === 'family-hulls-fill')
                .map((feature) => feature.properties?.family).filter(Boolean))];
            if (families.length) sidePanel?.setContext({ kind: 'family', family: families[0], families });
        });
    } catch (error) {
        console.error('Unable to initialize the side panel:', error);
    }

}).catch((error) => console.error('Map failed to become ready:', error));
