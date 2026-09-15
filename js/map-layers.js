import { map, MAP, ICON_SIZE, PATHS, labelLayerId, addGeojsonSource, loadIcons } from './map.js';
import { HULL_FAMILY_NAMES, buildFamilyHullCollection } from './family-hulls.js';
import { hoverPopup, clickPopup, hoverBox } from './popup.js';
import { COUNTRY_LABELS, FAMILY_LABELS, localized, localizedLookup, textFor } from './language.js';
import { cssVar } from './ui.js';

// dict to hold each language family and their color
export const FAMILIES = [
    { name: 'Mayan', label: FAMILY_LABELS.Mayan, slug: 'mayan', color: '#4ec340' },
    { name: 'Otomanguean', label: FAMILY_LABELS.Otomanguean, slug: 'otomanguean', color: '#2eacc9' },
    { name: 'Purépecha', label: FAMILY_LABELS.Purépecha, slug: 'purepecha', color: '#a36b27' },
    { name: 'Sign Language', label: FAMILY_LABELS['Sign Language'], slug: 'sign-language', color: '#3935c6' },
    { name: 'Uto-Aztecan', label: FAMILY_LABELS['Uto-Aztecan'], slug: 'uto-aztecan', color: '#2b72cb' },
    { name: 'Unclassified', label: FAMILY_LABELS.Unclassified, slug: 'unclassified', color: '#777a80' }
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
        title: p.name || localized('Attested site', 'Sitio documentado'),
        subtitle: p.language || localized('Language not recorded', 'Lengua no registrada'),
        rows: [
            [localized('Family', 'Familia'), p.family === 'Unclassified'
                ? '' : localizedLookup(p.family, FAMILY_LABELS)], // dont show Unclassified as a useful detail
            [localized('Group', 'Grupo'), p.group],
            ['ISO 639-3', p.isoCode],
            ['Glottocode', p.glottocode],
            [localized('Area', 'Área'), p.adminArea],
            [localized('Country', 'País'), localizedLookup(p.country, COUNTRY_LABELS)]
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

    // collect ids and unique coordinates for one legend item
    const itemsFor = (predicate) => data.features
        .filter(predicate)
        .reduce((result, feature) => {
            result.featureIds.push(feature.id);
            const coordinates = feature.geometry?.coordinates;
            if (Array.isArray(coordinates) && coordinates.length >= 2) {
                const key = `${coordinates[0]},${coordinates[1]}`;
                if (!result.coordinateKeys.has(key)) {
                    result.coordinateKeys.add(key);
                    result.coordinates.push(coordinates.slice(0, 2));
                }
            }
            return result;
        }, { featureIds: [], coordinates: [], coordinateKeys: new Set() });

    const withMatches = (item, predicate) => {
        const matches = itemsFor(predicate);
        return { ...item, featureIds: matches.featureIds, coordinates: matches.coordinates };
    };

    return [
        {
            title: localized('Language family', 'Familia lingüística'),
            items: FAMILIES
                .filter(({ name }) => present.has(name)) // show only families found in data
                .map(({ name, label, slug }) => withMatches(
                    { label, icon: iconUrl(slug, SHAPES.other) },
                    (feature) => (feature.properties?.family || 'Unclassified') === name
                ))
        },
        {
            title: localized('Respondent location type', 'Localización del idioma'),
            items: [
                withMatches({ label: localized('Community of origin', 'Comunidad de origen'), icon: iconUrl('unclassified', SHAPES.origin) },
                    (feature) => feature.properties?.reportedOriginPlace === true), // plus icon
                withMatches({ label: localized('Mutually understood community', 'Comunidad de entendimiento mutuo'), icon: iconUrl('unclassified', SHAPES.other) },
                    (feature) => feature.properties?.reportedOriginPlace !== true) // circle icon
            ]
        }
    ];
}

function familyHullColorExpression() {
    // turn each family name into the fill color used by its suggested area
    const expression = ['match', ['get', 'family']];

    for (const { name, color } of FAMILIES) {
        if (HULL_FAMILY_NAMES.includes(name)) expression.push(name, color);
    }

    expression.push('#000000');
    return expression;
}

function familyHullPopup(event, features) {
    // keep site clicks going to the marker when the invisible hull sits under it
    if (map.queryRenderedFeatures(event.point, { layers: ['sites'] }).length) return '';

    // use visible hull features first, with the clicked features as a fallback
    const visibleFeatures = map.queryRenderedFeatures(event.point, {
        layers: ['family-hulls-fill']
    });
    const familyNames = [...new Set((visibleFeatures.length ? visibleFeatures : features)
        .map((feature) => feature.properties?.family)
        .filter((family) => HULL_FAMILY_NAMES.includes(family)))]
        .sort((first, second) => HULL_FAMILY_NAMES.indexOf(first) - HULL_FAMILY_NAMES.indexOf(second));

    if (!familyNames.length) return '';

    const localizedFamilyNames = localized(
        familyNames.map((name) => textFor(localizedLookup(name, FAMILY_LABELS), 'en')).join(', '),
        familyNames.map((name) => textFor(localizedLookup(name, FAMILY_LABELS), 'es')).join(', ')
    );

    return hoverBox({
        title: familyNames.length === 1
            ? localized('Suggested language family', 'Familia lingüística sugerida')
            : localized('Possible language families', 'Posibles familias lingüísticas'),
        subtitle: localized(
            'Approximate area based on mapped language sites',
            'Área aproximada basada en los sitios de lenguas del mapa'
        ),
        rows: [[localized('Family', 'Familia'), localizedFamilyNames]]
    });
}

export async function addMapLayers() {
    const sections = []; // init empty list for legend sections

    // load the geojson file containing language locations, add to map as datasource
    const sites = await addGeojsonSource('sites', `${PATHS.data}/attested-sites-with-family.geojson`);
    const hulls = buildFamilyHullCollection(sites);

    // load all marker images and record which ones load successfully
    const loadedSiteIcons = await loadIcons(siteIcons);

    // add the site markers at the label boundary so they stay below map labels
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
    }, labelLayerId()); // place new layer below map text labels in the visual order

    // put the highlight directly behind the markers
    map.addLayer({
        id: 'sites-highlight',
        type: 'circle',
        source: 'sites',
        filter: ['==', ['id'], -1],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], MAP.minZoom, 12, 8, 16, 12, 20],
            'circle-color': cssVar('--accent-bright'),
            'circle-blur': 0.65,
            'circle-opacity': 0.9
        }
    }, 'sites'); // directly behind the symbols, while still below labels

    // invisible fill areas make family hulls clickable without covering markers
    map.addSource('family-hulls', {
        type: 'geojson',
        data: hulls
    });

    map.addLayer({
        id: 'family-hulls-fill',
        type: 'fill',
        source: 'family-hulls',
        paint: {
            'fill-color': familyHullColorExpression(),
            'fill-opacity': 0.001
        }
    }, 'sites-highlight'); // invisible hit areas stay behind markers and highlights

    hoverPopup('sites', sitePopup); // connect sitePopup func to layer, for hovering
    clickPopup('sites', (_event, features) => features[0] ? sitePopup(features[0]) : '', { touchOnly: true });
    clickPopup('family-hulls-fill', familyHullPopup); // suggest families on empty-area clicks
    sections.push(...siteLegend(sites)); // create legend info and add sections

    return { sites, hulls, sections }; // callers need source data and legend metadata
}
