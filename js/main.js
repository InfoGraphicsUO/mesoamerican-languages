mapboxgl.accessToken = 'pk.eyJ1IjoiaW5mb2dyYXBoaWNzIiwiYSI6ImNqaTR0eHhnODBjeTUzdmx0N3U2dWU5NW8ifQ.fVbTCmIrqILIzv5QGtVJ2Q';

const dataUrl = 'data/attested-sites-with-family.geojson';

const familyColors = {
    Mayan: '#4ec340',
    Otomanguean: '#2eacc9',
    'Purépecha': '#a36b27',
    'Sign Language': '#3935c6',
    'Uto-Aztecan': '#2b72cb',
    Unclassified: '#777a80'
};

const bounds = [
    [-120.425, -1],
    [-61, 34.009]
];

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: [-96.355, 17.800],
    zoom: 4.5,
    minZoom: 4.35,
    maxBounds: bounds,
    projection: 'mercator',
    style: 'mapbox://styles/infographics/cmlhb3rze006q01sn2k2k5qki',
});

map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

const statusElement = document.querySelector('#map-status');
const legendElement = document.querySelector('#family-legend');

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function popupRow(label, value) {
    if (!value || value === 'Unclassified') return '';

    return `<div class="popup-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderLegend(features) {
    const counts = features.reduce((totals, feature) => {
        const family = feature.properties.family;
        totals[family] = (totals[family] || 0) + 1;
        return totals;
    }, {});

    legendElement.innerHTML = Object.entries(familyColors)
        .filter(([family]) => counts[family])
        .map(([family, color]) => `
            <li>
                <span class="legend-swatch" style="--family-color: ${color}"></span>
                <span class="legend-label">${escapeHtml(family)}</span>
                <span class="legend-count">${counts[family]}</span>
            </li>
        `)
        .join('');
}

map.on('load', async () => {
    try {
        const response = await fetch(dataUrl);
        if (!response.ok) throw new Error(`Site data request failed with ${response.status}`);

        const sites = await response.json();
        const labelLayer = map.getStyle().layers.find(
            (layer) => layer.type === 'symbol' && layer.layout?.['text-field']
        );

        map.addSource('attested-sites', {
            type: 'geojson',
            data: sites
        });

        map.addLayer({
            id: 'attested-sites',
            type: 'circle',
            source: 'attested-sites',
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    4.35, 5,
                    8, 7,
                    12, 9
                ],
                'circle-color': [
                    'match', ['get', 'family'],
                    'Mayan', familyColors.Mayan,
                    'Otomanguean', familyColors.Otomanguean,
                    'Purépecha', familyColors['Purépecha'],
                    'Sign Language', familyColors['Sign Language'],
                    'Uto-Aztecan', familyColors['Uto-Aztecan'],
                    familyColors.Unclassified
                ],
                'circle-opacity': 0.82,
                'circle-stroke-color': '#ffffff',
                'circle-stroke-opacity': 0.92,
                'circle-stroke-width': 1
            }
        }, labelLayer?.id);

        renderLegend(sites.features);
        statusElement.textContent = `${sites.features.length.toLocaleString()} sites · select a point for details`;
    } catch (error) {
        console.error(error);
        statusElement.textContent = 'Site data could not be loaded.';
        statusElement.classList.add('error');
    }
});

map.on('click', 'attested-sites', (event) => {
    const feature = event.features[0];
    const properties = feature.properties;
    const coordinates = feature.geometry.coordinates.slice();

    const details = [
        popupRow('Family', properties.family),
        popupRow('Group', properties.group),
        popupRow('ISO 639-3', properties.isoCode),
        popupRow('Glottocode', properties.glottocode),
        popupRow('Area', properties.adminArea),
        popupRow('Country', properties.country)
    ].join('');

    new mapboxgl.Popup({ offset: 10, maxWidth: '320px' })
        .setLngLat(coordinates)
        .setHTML(`
            <article class="site-popup">
                <p class="popup-kicker">${escapeHtml(properties.language)}</p>
                <h2>${escapeHtml(properties.name || 'Attested site')}</h2>
                <dl>${details}</dl>
            </article>
        `)
        .addTo(map);
});

map.on('mouseenter', 'attested-sites', () => {
    map.getCanvas().style.cursor = 'pointer';
});

map.on('mouseleave', 'attested-sites', () => {
    map.getCanvas().style.cursor = '';
});
