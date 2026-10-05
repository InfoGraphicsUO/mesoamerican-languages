import { MAP, PATHS } from './map.js';

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

function sitePopupContent({ graphic }) {
    // builds the detail list for one site, skipping rows that have no useful info
    const p = graphic.attributes || {};
    const rows = [
        ['Language', p.language],
        ['Family', p.family === 'Unclassified' ? '' : p.family], // dont show Unclassified as a useful detail
        ['Group', p.group === 'Unclassified' ? '' : p.group],
        ['ISO 639-3', p.isoCode],
        ['Glottocode', p.glottocode],
        ['Area', p.adminArea],
        ['Country', p.country]
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');

    // the popup renders inside the sdk's shadow dom where css/main.css cant reach, so styles are set here
    const list = document.createElement('dl');
    list.style.margin = '0';

    for (const [label, value] of rows) {
        const row = document.createElement('div');
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        row.style.cssText = 'display: flex; gap: 0.35rem; line-height: 1.5;';
        term.style.cssText = 'flex: none; opacity: 0.65;';
        detail.style.margin = '0';
        term.textContent = `${label}:`;
        detail.textContent = value;
        row.append(term, detail);
        list.append(row);
    }

    return list;
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
        popupTemplate: {
            title: '{name}',
            outFields: ['*'], // popup rows need every property
            content: sitePopupContent
        }
    });

    view.map.add(sites);
    await view.whenLayerView(sites);

    return { sites };
}
