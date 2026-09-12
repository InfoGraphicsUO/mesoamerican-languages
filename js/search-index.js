// keep search data as plain objects so the ui can render the tree
// this also works without a Mapbox map or browser DOM
import { COUNTRY_LABELS, FAMILY_LABELS, localized, localizedLookup, textFor } from './language.js';

const keyName = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value) => Array.isArray(value) ? value.join(' ') : String(value ?? '');

// make names comparable across accents, punctuation, and letter case
export const normalizeSearchText = (value) => text(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

// collect values from fields whose normalized keys match the caller's rule
const valuesFor = (properties, wanted) => Object.entries(properties || {})
    .filter(([key]) => wanted(keyName(key)))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map((value) => text(value).trim()).filter(Boolean);

const firstValue = (properties, wanted) => valuesFor(properties, wanted)[0] || '';
// add translated family/country names to search without changing the stored data label
const searchAliases = (value, labels) => {
    const display = localizedLookup(value, labels);
    return display === value ? [value] : [textFor(display, 'en'), textFor(display, 'es')];
};
// family color follows each result from its heading down to its places
const FAMILY_COLORS = {
    Mayan: '#4ec340',
    Otomanguean: '#2eacc9',
    'Purépecha': '#a36b27',
    'Sign Language': '#3935c6',
    'Uto-Aztecan': '#2b72cb',
    Unclassified: '#777a80'
};
// use these when the source gives a country name but no short code
const COUNTRY_CODES = {
    Belize: 'BZ', 'Costa Rica': 'CR', 'El Salvador': 'SV', Guatemala: 'GT', Honduras: 'HN',
    Mexico: 'MX', Nicaragua: 'NI', Panama: 'PA', 'United States': 'US'
};
// prefer a real two or three letter code, then fall back to the known country name
const countryCode = (properties) => {
    const code = Object.entries(properties || {}).find(([key, value]) =>
        /country(code|iso|abbr)/i.test(keyName(key)) && /^[A-Za-z]{2,3}$/.test(String(value || '').trim()));
    if (code) return String(code[1]).trim().toUpperCase();
    const country = valuesFor(properties, (key) => key.startsWith('country'))[0];
    return COUNTRY_CODES[country] || country;
};
// return one map point when the feature has usable coordinates
const coordinatesOf = (feature) => {
    const coordinates = feature.geometry?.coordinates;
    return Array.isArray(coordinates) && coordinates.length >= 2
        ? [Number(coordinates[0]), Number(coordinates[1])] : null;
};

function node(kind, label, featureIds = [], coordinates = [], familyColor = '', displayLabel = label) {
    // one searchable result, with ids and points collected from matching rows
    return { kind, label, displayLabel, featureIds, coordinates, children: [], familyColor };
}

function addChild(parent, kind, label, row) {
    // empty labels and repeated parent labels dont make useful taxonomy rows
    const same = normalizeSearchText(parent.label) === normalizeSearchText(label);
    if (!label || same) return parent;
    let child = parent.children.find((candidate) => candidate.kind === kind && candidate.label === label);
    if (!child) { child = node(kind, label); parent.children.push(child); }
    child.featureIds.push(...row.featureIds);
    child.coordinates.push(...row.coordinates);
    return child;
}

function finish(nodes) {
    // sort this list too, not only each node's children
    // otherwise the root family list keeps the source insertion order
    nodes.sort((a, b) => {
        const aUnclassified = normalizeSearchText(a.label) === 'unclassified';
        const bUnclassified = normalizeSearchText(b.label) === 'unclassified';
        if (aUnclassified !== bUnclassified) return aUnclassified ? 1 : -1;
        return a.label.localeCompare(b.label);
    });
    // clean ids and coordinates at every level of the finished tree
    for (const current of nodes) {
        current.featureIds = [...new Set(current.featureIds)];
        const seen = new Set();
        current.coordinates = current.coordinates.filter((point) => {
            const key = point.join(',');
            if (seen.has(key)) return false;
            seen.add(key); return true;
        });
        current.children.sort((a, b) => a.label.localeCompare(b.label));
        finish(current.children);
    }
    return nodes;
}

export function createSearchIndex(sites) {
    // build a taxonomy once, then rebuild only the matching branch for a query
    const features = Array.isArray(sites) ? sites : (sites?.features || []);

    // collapse exact duplicate records, but keep every stable feature id
    const rows = [...features.reduce((groups, feature, index) => {
        const properties = feature.properties || {};
        const comparable = Object.keys(properties).sort().reduce((out, key) => {
            out[key] = properties[key]; return out;
        }, {});
        // sorted properties make matching rows produce the same lookup key
        const key = JSON.stringify(comparable);
        const row = groups.get(key) || { properties, featureIds: [], coordinates: [], searchable: '' };
        row.featureIds.push(Number.isFinite(Number(feature.id)) ? Number(feature.id) : index + 1);
        const point = coordinatesOf(feature);
        if (point && point.every(Number.isFinite) && !row.coordinates.some((item) => item[0] === point[0] && item[1] === point[1])) row.coordinates.push(point);

        // search the visible taxonomy plus location context
        // ids and booleans stay out of search; admin/place_text help matches but never render as labels
        const resolvedPlaceLabel = firstValue(properties, (key) => key === 'finalname')
            || firstValue(properties, (key) => key === 'name');
        const family = firstValue(properties, (key) => key === 'family');
        const countries = valuesFor(properties, (key) => key.startsWith('country'));
        row.searchable = [
            ...searchAliases(family, FAMILY_LABELS),
            firstValue(properties, (key) => key === 'group'),
            firstValue(properties, (key) => key === 'language'),
            ...countries.flatMap((country) => searchAliases(country, COUNTRY_LABELS)),
            ...valuesFor(properties, (key) => key.startsWith('admin')),
            resolvedPlaceLabel,
            ...valuesFor(properties, (key) => key === 'placetext')
        ].join(' ');
        groups.set(key, row);
        return groups;
    }, new Map()).values()];

    const build = (matchingRows) => {
        // turn flat site rows into family > group > language > place results
        const families = new Map();
        for (const row of matchingRows) {
            const p = row.properties;
            const labels = [
                ['family', firstValue(p, (key) => key === 'family')],
                ['group', firstValue(p, (key) => key === 'group')],
                ['language', firstValue(p, (key) => key === 'language')]
            ];
            // walk down the three headings, reusing a node when it already exists
            let parent = { children: [...families.values()], label: '' };
            for (const [position, [kind, label]] of labels.entries()) {
                if (!label || normalizeSearchText(parent.label) === normalizeSearchText(label)) continue;
                let child = parent.children.find((candidate) => candidate.kind === kind && candidate.label === label);
                const familyLabel = labels[0][1];
                const familyColor = FAMILY_COLORS[familyLabel] || '';
                if (!child) {
                    const displayLabel = kind === 'family'
                        ? localizedLookup(label, FAMILY_LABELS) : label;
                    child = node(kind, label, [], [], familyColor, displayLabel);
                    parent.children.push(child);
                    // only family nodes belong in the root index
                    // putting group/language nodes here makes them show up twice as top-level results
                    if (position === 0) families.set(child.label, child);
                }
                child.featureIds.push(...row.featureIds); child.coordinates.push(...row.coordinates); parent = child;
            }
            const recordedPlaceLabel = firstValue(p, (key) => key === 'finalname') || firstValue(p, (key) => key === 'name');
            const placeLabel = recordedPlaceLabel || 'Unnamed place';
            const placeDisplayLabel = recordedPlaceLabel || localized('Unnamed place', 'Lugar sin nombre');
            const familyLabel = labels[0][1];
            const familyColor = FAMILY_COLORS[familyLabel] || '';
            // every source row ends as a place under its deepest available heading
            const place = node('place', placeLabel, [...row.featureIds], [...row.coordinates], familyColor, placeDisplayLabel);
            const countries = valuesFor(p, (key) => key.startsWith('country'));
            const displayCountry = countryCode(p);
            place.countries = [...new Set(displayCountry ? [displayCountry] : countries)];
            place.country = place.countries[0] || '';
            parent.children.push(place);
        }
        return finish([...families.values()]);
    };

    const all = build(rows);
    // callers get one search func over the rows collected above
    return {
        search(query = '') {
            // an empty query returns the complete tree; otherwise every token must match
            const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
            if (!tokens.length) return all;
            return build(rows.filter((row) => {
                const searchable = normalizeSearchText(row.searchable);
                return tokens.every((token) => searchable.includes(token));
            }));
        }
    };
}
