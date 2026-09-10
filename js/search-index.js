// Search data is deliberately plain objects: the UI can render this tree and
// tests can use it without needing a Mapbox map or a browser DOM.
const keyName = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (value) => Array.isArray(value) ? value.join(' ') : String(value ?? '');

export const normalizeSearchText = (value) => text(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

const valuesFor = (properties, wanted) => Object.entries(properties || {})
    .filter(([key]) => wanted(keyName(key)))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map((value) => text(value).trim()).filter(Boolean);

const firstValue = (properties, wanted) => valuesFor(properties, wanted)[0] || '';
const FAMILY_COLORS = {
    Mayan: '#4ec340',
    Otomanguean: '#2eacc9',
    'Purépecha': '#a36b27',
    'Sign Language': '#3935c6',
    'Uto-Aztecan': '#2b72cb',
    Unclassified: '#777a80'
};
const COUNTRY_CODES = {
    Belize: 'BZ', 'Costa Rica': 'CR', 'El Salvador': 'SV', Guatemala: 'GT', Honduras: 'HN',
    Mexico: 'MX', Nicaragua: 'NI', Panama: 'PA', 'United States': 'US'
};
const countryCode = (properties) => {
    const code = Object.entries(properties || {}).find(([key, value]) =>
        /country(code|iso|abbr)/i.test(keyName(key)) && /^[A-Za-z]{2,3}$/.test(String(value || '').trim()));
    if (code) return String(code[1]).trim().toUpperCase();
    const country = valuesFor(properties, (key) => key.startsWith('country'))[0];
    return COUNTRY_CODES[country] || country;
};
const coordinatesOf = (feature) => {
    const coordinates = feature.geometry?.coordinates;
    return Array.isArray(coordinates) && coordinates.length >= 2
        ? [Number(coordinates[0]), Number(coordinates[1])] : null;
};

function node(kind, label, featureIds = [], coordinates = [], familyColor = '') {
    return { kind, label, featureIds, coordinates, children: [], familyColor };
}

function addChild(parent, kind, label, row) {
    // Empty labels and repeated adjacent labels are not useful taxonomy rows.
    const same = normalizeSearchText(parent.label) === normalizeSearchText(label);
    if (!label || same) return parent;
    let child = parent.children.find((candidate) => candidate.kind === kind && candidate.label === label);
    if (!child) { child = node(kind, label); parent.children.push(child); }
    child.featureIds.push(...row.featureIds);
    child.coordinates.push(...row.coordinates);
    return child;
}

function finish(nodes) {
    // Sort the list being finished too, not just each node's children.  The
    // root family list otherwise kept source insertion order.
    nodes.sort((a, b) => {
        const aUnclassified = normalizeSearchText(a.label) === 'unclassified';
        const bUnclassified = normalizeSearchText(b.label) === 'unclassified';
        if (aUnclassified !== bUnclassified) return aUnclassified ? 1 : -1;
        return a.label.localeCompare(b.label);
    });
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
    const features = Array.isArray(sites) ? sites : (sites?.features || []);
    // Collapse exact duplicate records while retaining every stable feature id.
    const rows = [...features.reduce((groups, feature, index) => {
        const properties = feature.properties || {};
        const comparable = Object.keys(properties).sort().reduce((out, key) => {
            out[key] = properties[key]; return out;
        }, {});
        const key = JSON.stringify(comparable);
        const row = groups.get(key) || { properties, featureIds: [], coordinates: [], searchable: '' };
        row.featureIds.push(Number.isFinite(Number(feature.id)) ? Number(feature.id) : index + 1);
        const point = coordinatesOf(feature);
        if (point && point.every(Number.isFinite) && !row.coordinates.some((item) => item[0] === point[0] && item[1] === point[1])) row.coordinates.push(point);
        // Search the visible taxonomy plus location context.  Identifiers and
        // booleans are intentionally excluded; admin/place_text stay useful
        // for matching but never become rendered taxonomy labels.
        const resolvedPlaceLabel = firstValue(properties, (key) => key === 'finalname')
            || firstValue(properties, (key) => key === 'name');
        row.searchable = [
            firstValue(properties, (key) => key === 'family'),
            firstValue(properties, (key) => key === 'group'),
            firstValue(properties, (key) => key === 'language'),
            ...valuesFor(properties, (key) => key.startsWith('country')),
            ...valuesFor(properties, (key) => key.startsWith('admin')),
            resolvedPlaceLabel,
            ...valuesFor(properties, (key) => key === 'placetext')
        ].join(' ');
        groups.set(key, row);
        return groups;
    }, new Map()).values()];

    const build = (matchingRows) => {
        const families = new Map();
        for (const row of matchingRows) {
            const p = row.properties;
            const labels = [
                ['family', firstValue(p, (key) => key === 'family')],
                ['group', firstValue(p, (key) => key === 'group')],
                ['language', firstValue(p, (key) => key === 'language')]
            ];
            let parent = { children: [...families.values()], label: '' };
            for (const [position, [kind, label]] of labels.entries()) {
                if (!label || normalizeSearchText(parent.label) === normalizeSearchText(label)) continue;
                let child = parent.children.find((candidate) => candidate.kind === kind && candidate.label === label);
                const familyLabel = labels[0][1];
                const familyColor = FAMILY_COLORS[familyLabel] || '';
                if (!child) {
                    child = node(kind, label, [], [], familyColor);
                    parent.children.push(child);
                    // Only family nodes belong in the root index.  A previous
                    // version put suppressed group/language nodes in this map,
                    // which made them appear again as extra top-level results.
                    if (position === 0) families.set(child.label, child);
                }
                child.featureIds.push(...row.featureIds); child.coordinates.push(...row.coordinates); parent = child;
            }
            const placeLabel = firstValue(p, (key) => key === 'finalname') || firstValue(p, (key) => key === 'name') || 'Unnamed place';
            const familyLabel = labels[0][1];
            const familyColor = FAMILY_COLORS[familyLabel] || '';
            const place = node('place', placeLabel, [...row.featureIds], [...row.coordinates], familyColor);
            const countries = valuesFor(p, (key) => key.startsWith('country'));
            const displayCountry = countryCode(p);
            place.countries = [...new Set(displayCountry ? [displayCountry] : countries)];
            place.country = place.countries[0] || '';
            parent.children.push(place);
        }
        return finish([...families.values()]);
    };

    const all = build(rows);
    return {
        search(query = '') {
            const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
            if (!tokens.length) return all;
            return build(rows.filter((row) => {
                const searchable = normalizeSearchText(row.searchable);
                return tokens.every((token) => searchable.includes(token));
            }));
        }
    };
}
