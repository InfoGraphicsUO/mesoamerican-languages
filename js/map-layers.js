import { map, ICON_SIZE, PATHS, labelLayerId, addGeojsonSource, loadIcons } from './map.js';
import { hoverPopup, hoverBox } from './popup.js';

// dict to hold each language family and their color
const FAMILIES = [
    { name: 'Mayan', slug: 'mayan', color: '#4ec340' },
    { name: 'Otomanguean', slug: 'otomanguean', color: '#2eacc9' },
    { name: 'Purépecha', slug: 'purepecha', color: '#a36b27' },
    { name: 'Sign Language', slug: 'sign-language', color: '#3935c6' },
    { name: 'Uto-Aztecan', slug: 'uto-aztecan', color: '#2b72cb' },
    { name: 'Unclassified', slug: 'unclassified', color: '#777a80' }
];

// marker shape is decided by reportedOriginPlace. plus = true, circle = false/missing
const SHAPES = { origin: 'plus', other: 'circle' };

// combines a language family's short name and a shape into one id
const iconId = (slug, shape) => `${slug}-${shape}`;

// uses the id from iconId to create the path to the SVG marker image
const iconUrl = (slug, shape) => `${PATHS.markers}/${iconId(slug, shape)}.svg`;

function sitePopup(feature) {
    // creates the info box that appears when you hover over a language site
    const p = feature.properties || {}; // one map feature, one location from geojson data

    // build the popup HTML
    // includes alternatives if no data exist (||)
    return hoverBox({
        title: p.name || 'Attested site', 
        subtitle: p.language || 'Language not recorded',
        rows: [
            ['Family', p.family === 'Unclassified' ? '' : p.family], // hides word from family row
            ['Group', p.group],
            ['ISO 639-3', p.isoCode],
            ['Glottocode', p.glottocode],
            ['Area', p.adminArea],
            ['Country', p.country]
        ]
    });
}

function siteIconExpression(loaded) {
    // decides which marker icon each map location should display
    // loaded = a set containing the icons that loaded successfully

    // look at the feature's 'family' value and choose icon based on it
    const expression = ['match', ['get', 'family']];

    // go thru every language family 
    for (const { name, slug } of FAMILIES) {
        const plus = iconId(slug, SHAPES.origin); // reported origin place
        const circle = iconId(slug, SHAPES.other); // not reported origin place

        // if either family icon failed to load, skip it
        if (!loaded.has(plus) || !loaded.has(circle)) continue;

        // if family matches this name, use plus icon when reportedOriginPlace == true
        expression.push(name, ['case', ['==', ['get', 'reportedOriginPlace'], true], plus, circle]);
    }

    expression.push(''); // if no family matches show no icon

    return expression; // returns complete mapbox expression
}

// creates a list of all marker icons the map might need
// for each family: get short name, go thru both shapes, create object
// flatMap combines all of them into one list
const siteIcons = FAMILIES.flatMap(({ slug }) => Object.values(SHAPES).map((shape) => ({
    id: iconId(slug, shape), // icons name, such as 'mayan-plus'
    url: iconUrl(slug, shape) // file path, such as 'img/markers/mayan-plus.svg'
})));

function siteLegend(data) {
    // creates info needed to display map legend

    // collects language families that appear in map data
    const present = new Set(data.features.map((f) => f.properties?.family || 'Unclassified'));

    return [
        {
            title: 'Language family',
            items: FAMILIES
                .filter(({ name }) => present.has(name)) // show only families found in data
                .map(({ name, slug }) => ({ label: name, icon: iconUrl(slug, SHAPES.other) }))
        },
        {
            title: 'Reported origin place',
            items: [
                { label: 'True', icon: iconUrl('unclassified', SHAPES.origin) }, // plus icon
                { label: 'False', icon: iconUrl('unclassified', SHAPES.other) } // circle icon
            ]
        }
    ];
}

export async function addMapLayers() {
    const sections = []; // init empty list  for legend sections

    // load the geojson file containing language locations, add to map as datasource
    const sites = await addGeojsonSource('sites', `${PATHS.data}/attested-sites-with-family.geojson`);

    // load all marker images and record which ones load succesfully
    const loadedSiteIcons = await loadIcons(siteIcons);

    // add language sites layer
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
    }, labelLayerId()); // place new layer before map text label layer, visual hirarchy

    hoverPopup('sites', sitePopup); // connect sitePopup func to layer, for hovering
    sections.push(...siteLegend(sites)); // create legend info and add sections

    return sections; // return legend sections
}
