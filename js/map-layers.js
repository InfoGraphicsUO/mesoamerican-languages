import { MAP, PATHS } from './map.js';
import { hoverPopup, clickPopup, hoverBox } from './popup.js';

// language families in the mapped data, slug matches the marker file names
export const FAMILIES = [
    { name: 'Mayan', slug: 'mayan' },
    { name: 'Otomanguean', slug: 'otomanguean' },
    { name: 'Purépecha', slug: 'purepecha' },
    { name: 'Sign Language', slug: 'sign-language' },
    { name: 'Uto-Aztecan', slug: 'uto-aztecan' },
    { name: 'Unclassified', slug: 'unclassified' }
];

// Otomanguean uses a different blue for each group in the mapped data
export const OTOMANGUEAN_GROUPS = [
    { name: 'Chinantec', slug: 'chinantec' },
    { name: 'Mixtec', slug: 'mixtec' },
    { name: 'Triqui', slug: 'triqui' },
    { name: 'Zapotec', slug: 'zapotec' }
];

// marker shape is decided by reportedOriginPlace. plus = true, circle = false/missing
const SHAPES = [
    { shape: 'plus', label: 'reported origin place' },
    { shape: 'circle', label: 'attested site' }
];

// properties on every site in the geojson
// the sdk drops true/false properties when it guesses field types, so the fields are listed here
// reportedOriginPlace comes thru as the text 'true' or 'false'
const SITE_FIELDS = ['name', 'language', 'isoCode', 'glottocode', 'family', 'group', 'country', 'adminArea', 'reportedOriginPlace'];

// marker svgs are drawn at 28px, they shrink a little as you zoom out
const ICON_SIZE = 28;
const ICON_SCALES = [
    { zoom: MAP.minZoom, scale: 0.6 },
    { zoom: 9, scale: 0.82 },
    { zoom: 13, scale: 1 }
];

// map scale (1:x) at a whole zoom level, size stops are set by scale and not zoom
const scaleAtZoom = (zoom) => 591657527.591555 / 2 ** zoom;

// turns [{ name, slug }] into the name/slug pairs arcade's Decode() expects
const decodePairs = (items) => items.map(({ name, slug }) => `'${name}', '${slug}'`).join(', ');

// arcade that names the marker for each site, such as 'mayan-plus' or 'mixtec-circle'
// Otomanguean sites use their group marker, the family marker covers other or missing groups
const MARKER_EXPRESSION = `
    var slug = Decode($feature.family, ${decodePairs(FAMILIES)}, '');
    if ($feature.family == 'Otomanguean') {
        slug = Decode($feature['group'], ${decodePairs(OTOMANGUEAN_GROUPS)}, slug);
    }
    if (slug == '') { return null; }
    return slug + IIf($feature.reportedOriginPlace == 'true', '-plus', '-circle');
`;

function siteRenderer() {
    // one picture marker for every family or group and shape combination
    const uniqueValueInfos = [...FAMILIES, ...OTOMANGUEAN_GROUPS].flatMap(({ name, slug }) =>
        SHAPES.map(({ shape, label }) => ({
            value: `${slug}-${shape}`,
            label: `${name}, ${label}`,
            symbol: {
                type: 'picture-marker',
                url: `${PATHS.markers}/${slug}-${shape}.svg`,
                width: `${ICON_SIZE}px`,
                height: `${ICON_SIZE}px`
            }
        })));

    return {
        type: 'unique-value',
        valueExpression: MARKER_EXPRESSION,
        uniqueValueInfos, // sites w/o a matching family get no marker
        visualVariables: [{
            type: 'size',
            valueExpression: '$view.scale',
            stops: ICON_SCALES.map(({ zoom, scale }) => ({
                value: scaleAtZoom(zoom),
                size: `${ICON_SIZE * scale}px`
            }))
        }]
    };
}

function sitePopup(feature) {
    // creates the info box that appears when you hover over a language site
    const p = feature.attributes || {}; // one map feature, one location from geojson data

    // build the popup HTML
    // includes alternatives if no data exist (||)
    return hoverBox({
        title: p.name || 'Attested site',
        subtitle: p.language || 'Language not recorded',
        rows: [
            ['Family', p.family === 'Unclassified' ? '' : p.family], // dont show Unclassified as a useful detail
            ['Group', p.group],
            ['ISO 639-3', p.isoCode],
            ['Glottocode', p.glottocode],
            ['Area', p.adminArea],
            ['Country', p.country]
        ]
    });
}

export async function addMapLayers(view) {
    const GeoJSONLayer = await $arcgis.import('@arcgis/core/layers/GeoJSONLayer.js');

    // language sites, operational layers draw below the basemap's labels
    const sites = new GeoJSONLayer({
        id: 'sites',
        title: 'Attested language sites',
        url: `${PATHS.data}/attested-sites-with-family.geojson`,
        copyright: 'UO InfoGraphics Lab',
        objectIdField: 'OBJECTID', // source data has no ids, the sdk numbers features by their position in the file
        fields: [
            { name: 'OBJECTID', type: 'oid' },
            ...SITE_FIELDS.map((name) => ({ name, type: 'string' }))
        ],
        opacity: 0.9,
        renderer: siteRenderer(),
        outFields: ['*'], // popup rows need every property
        popupEnabled: false // js/popup.js draws our own popups instead of the sdk's
    });

    view.map.add(sites);
    await view.whenLayerView(sites);

    hoverPopup(view, sites, sitePopup); // connect sitePopup func to layer, for hovering
    clickPopup(view, sites, sitePopup, { touchOnly: true });

    return { sites };
}
