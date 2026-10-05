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

// hosted feature layer w/ the attested sites, published from Attested_Sites_With_Family.shp
const SITES_URL = 'https://services5.arcgis.com/W1uyphp8h2tna3qJ/arcgis/rest/services/Attested_Sites_With_Family/FeatureServer';

// field names on the feature layer, they come from the shapefile so some are cut off at 10 characters
// the survey's own iso_code and glottocode cover sites that never got matched to a language
const FIELDS = {
    name: 'final_name',
    language: 'Language',
    isoCode: 'ISO_Code_1',
    glottocode: 'Glotto_Cod',
    surveyIsoCode: 'iso_code',
    surveyGlottocode: 'glottocode',
    family: 'Family',
    group: 'Group_',
    country: 'country',
    adminArea: 'admin_area',
    placeRole: 'place_role'
};

// place_role value for sites that were reported as a town of origin
const ORIGIN_ROLE = 'town_origin';

// marker shape is decided by place_role. plus = town of origin, circle = anything else
const SHAPES = [
    { shape: 'plus', label: 'reported origin place' },
    { shape: 'circle', label: 'attested site' }
];

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
// sites w/o a family in the data draw as Unclassified
const MARKER_EXPRESSION = `
    var family = Trim(DefaultValue($feature['${FIELDS.family}'], ''));
    if (family == '') { family = 'Unclassified'; }
    var slug = Decode(family, ${decodePairs(FAMILIES)}, '');
    if (family == 'Otomanguean') {
        slug = Decode(Trim(DefaultValue($feature['${FIELDS.group}'], '')), ${decodePairs(OTOMANGUEAN_GROUPS)}, slug);
    }
    if (slug == '') { return null; }
    return slug + IIf($feature['${FIELDS.placeRole}'] == '${ORIGIN_ROLE}', '-plus', '-circle');
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
    const attributes = feature.attributes || {}; // one map feature, one location from the feature layer

    // read one field as trimmed text, empty fields come back as ''
    const value = (field) => String(attributes[field] ?? '').trim();

    // build the popup HTML
    // includes alternatives if no data exist (||)
    return hoverBox({
        title: value(FIELDS.name) || 'Attested site',
        subtitle: value(FIELDS.language) || 'Language not recorded',
        rows: [
            ['Family', value(FIELDS.family)],
            ['Group', value(FIELDS.group)],
            ['ISO 639-3', value(FIELDS.isoCode) || value(FIELDS.surveyIsoCode)],
            ['Glottocode', value(FIELDS.glottocode) || value(FIELDS.surveyGlottocode)],
            ['Area', value(FIELDS.adminArea)],
            ['Country', value(FIELDS.country)]
        ]
    });
}

export async function addMapLayers(view) {
    const FeatureLayer = await $arcgis.import('@arcgis/core/layers/FeatureLayer.js');

    // language sites, operational layers draw below the basemap's labels
    const sites = new FeatureLayer({
        id: 'sites',
        title: 'Attested language sites',
        url: SITES_URL, // w/o a layer number the sdk uses the service's first layer
        copyright: 'UO InfoGraphics Lab',
        opacity: 0.9,
        renderer: siteRenderer(),
        outFields: Object.values(FIELDS), // only ask the service for the fields the markers and popups use
        popupEnabled: false // js/popup.js draws our own popups instead of the sdk's
    });

    view.map.add(sites);
    await view.whenLayerView(sites);

    hoverPopup(view, sites, sitePopup); // connect sitePopup func to layer, for hovering
    clickPopup(view, sites, sitePopup, { touchOnly: true });

    return { sites };
}
