import { map, ICON_SIZE, PATHS, labelLayerId, addGeojsonSource, loadIcons } from './map.js';
import { hoverPopup, hoverBox } from './popup.js';

const FAMILIES = [
    { name: 'Mayan', slug: 'mayan', color: '#4ec340' },
    { name: 'Otomanguean', slug: 'otomanguean', color: '#2eacc9' },
    { name: 'Purépecha', slug: 'purepecha', color: '#a36b27' },
    { name: 'Sign Language', slug: 'sign-language', color: '#3935c6' },
    { name: 'Uto-Aztecan', slug: 'uto-aztecan', color: '#2b72cb' },
    { name: 'Unclassified', slug: 'unclassified', color: '#777a80' }
];

// marker shape encodes reportedOriginPlace, plus = true, circle = false/missing
const SHAPES = { origin: 'plus', other: 'circle' };

const iconId = (slug, shape) => `${slug}-${shape}`;
const iconUrl = (slug, shape) => `${PATHS.markers}/${iconId(slug, shape)}.svg`;

function sitePopup(feature) {
    const p = feature.properties || {};
    return hoverBox({
        title: p.name || 'Attested site',
        subtitle: p.language || 'Language not recorded',
        rows: [
            ['Family', p.family === 'Unclassified' ? '' : p.family],
            ['Group', p.group],
            ['ISO 639-3', p.isoCode],
            ['Glottocode', p.glottocode],
            ['Area', p.adminArea],
            ['Country', p.country]
        ]
    });
}

// icon-image expression, family picks colour and reportedOriginPlace picks shape
function siteIconExpression(loaded) {
    const expression = ['match', ['get', 'family']];
    for (const { name, slug } of FAMILIES) {
        const plus = iconId(slug, SHAPES.origin);
        const circle = iconId(slug, SHAPES.other);
        if (!loaded.has(plus) || !loaded.has(circle)) continue;
        expression.push(name, ['case', ['==', ['get', 'reportedOriginPlace'], true], plus, circle]);
    }
    expression.push('');
    return expression;
}

// one { id, url } per family x shape so loadIcons can register them all at once
const siteIcons = FAMILIES.flatMap(({ slug }) => Object.values(SHAPES).map((shape) => ({
    id: iconId(slug, shape),
    url: iconUrl(slug, shape)
})));

// legend sections for the sites layer, only lists families that appear in the data
function siteLegend(data) {
    const present = new Set(data.features.map((f) => f.properties?.family || 'Unclassified'));
    return [
        {
            title: 'Language family',
            items: FAMILIES
                .filter(({ name }) => present.has(name))
                .map(({ name, slug }) => ({ label: name, icon: iconUrl(slug, SHAPES.other) }))
        },
        {
            title: 'Reported origin place',
            items: [
                { label: 'True', icon: iconUrl('unclassified', SHAPES.origin) },
                { label: 'False', icon: iconUrl('unclassified', SHAPES.other) }
            ]
        }
    ];
}

export async function addMapLayers() {
    const sections = [];

    // attested language sites
    const sites = await addGeojsonSource('sites', `${PATHS.data}/attested-sites-with-family.geojson`);
    const loadedSiteIcons = await loadIcons(siteIcons);
    map.addLayer({
        id: 'sites',
        type: 'symbol',
        source: 'sites',
        layout: {
            'icon-image': siteIconExpression(loadedSiteIcons),
            'icon-size': ICON_SIZE,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: { 'icon-opacity': 0.9 }
    }, labelLayerId());
    hoverPopup('sites', sitePopup);
    sections.push(...siteLegend(sites));

    return sections;
}
