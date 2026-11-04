import { FAMILIES, OTOMANGUEAN_GROUPS, FIELDS } from './map-layers.js';
import { COUNTRY_LABELS, FAMILY_LABELS, GROUP_LABELS, localized, localizedLookup, localizedPlaceName, textFor } from './language.js';

// searchable index of our own data, built once from the sites layer
// results are families, groups, languages, and documented places, each w/ the sites it covers
// exports KINDS, normalizeText, matchRange, buildSearchIndex, loadSearchIndex

// extra fields the index reads on top of FIELDS
const PLACE_FIELDS = {
    officialName: 'place_offi' // official name of the matched place
};
// place_text (what the respondent typed) is left out, it often names the state and buried real matches

// kind of each result, in the order they sort when they match equally well
export const KINDS = {
    family: { tag: localized('Family', 'Familia'), order: 0 },
    group: { tag: localized('Group', 'Grupo'), order: 1 },
    language: { tag: localized('Language', 'Lengua'), order: 2 },
    place: { tag: localized('Language found in Oregon', 'Lengua encontrada en Oregón'), order: 3 }
};

// spanish and alternate names so people can search the way they say it
const ALIASES = {
    Mayan: ['Maya', 'Mayense'],
    Otomanguean: ['Otomangue', 'Oto-Manguean'],
    'Purépecha': ['Tarasco', 'Purhépecha', 'Purepecha'],
    'Sign Language': ['Lengua de señas', 'LSM'],
    'Uto-Aztecan': ['Yuto-nahua', 'Uto-azteca', 'Yutoazteca'],
    Chinantec: ['Chinanteco'],
    Mixtec: ['Mixteco', "Tu'un savi"],
    Triqui: ['Trique'],
    Zapotec: ['Zapoteco'],
    Nahuan: ['Nahuatl', 'Náhuatl', 'Nahua', 'Mexicano'],
    Tarahumara: ['Rarámuri']
};

// how much a match on each kind of name counts, the shown name always counts most
// codes (iso, glottocode) only count as exact matches, otherwise 'san' would match every 'sanm1234'
const WEIGHTS = { label: 1, alias: 0.85, extra: 0.6 };

// accents, apostrophes, punctuation, and case dont block a match, so kiche finds K'iche'
export const normalizeText = (value) => String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’'ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

// how well one normalized name matches the normalized query, 0 = no match
function matchScore(name, query, tokens) {
    if (!name) return 0;
    if (name === query) return 1;
    if (name.startsWith(query)) return 0.9;
    if (` ${name}`.includes(` ${query}`)) return 0.75; // a later word starts w/ the query
    const words = name.split(' ');
    if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 0.6; // words in any order
    if (query.length >= 3 && name.includes(query)) return 0.4; // middle of a word
    return 0;
}

// start/end of the query inside the original (accented) label, for bolding the matched part
// returns null when the match came from an alias or the words were out of order
export function matchRange(label, query) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return null;

    // fold one char at a time so every folded char points back at its original position
    let folded = '';
    const positions = [];
    let offset = 0;
    for (const char of label) {
        const part = normalizeText(char) || (/[’'ʼ]/.test(char) ? '' : ' ');
        for (const piece of part) {
            folded += piece;
            positions.push({ start: offset, end: offset + char.length });
        }
        offset += char.length;
    }

    const at = folded.indexOf(normalizedQuery);
    if (at < 0) return null;
    return [positions[at].start, positions[at + normalizedQuery.length - 1].end];
}

// marker file for a site, mirrors MARKER_EXPRESSION in js/map-layers.js
function markerSlug(family, group) {
    if (family === 'Otomanguean') {
        const groupSlug = OTOMANGUEAN_GROUPS.find((item) => item.name === group)?.slug;
        if (groupSlug) return groupSlug;
    }
    return FAMILIES.find((item) => item.name === family)?.slug || 'unclassified';
}

// a place's own name w/o the municipality, state, and country some names carry after commas
// 'Ensenada, Oaxaca, Mexico' is searched as 'Ensenada', otherwise every place in Oaxaca matched 'oaxaca'
const placeName = (name) => name.split(',')[0].trim();

const languageCount = (count) => localized(
    `${count} ${count === 1 ? 'language' : 'languages'}`,
    `${count} ${count === 1 ? 'lengua' : 'lenguas'}`
);

// join plain and localized parts into one localized() pair, blanks get skipped
function joinText(parts, separator) {
    const kept = parts.filter((part) => textFor(part, 'en'));
    return localized(
        kept.map((part) => textFor(part, 'en')).join(separator),
        kept.map((part) => textFor(part, 'es')).join(separator)
    );
}

// label: the name as it is in the data, used for matching and sorting
// display: what the results show, families and groups are translated, languages and places stay as recorded
function entry(kind, label, slug, display = label) {
    return { kind, label, display, slug, context: '', keys: [], sites: [] };
}

// add searchable names to an entry, skipping blanks and repeats
function addKeys(item, values, weight, exact = false) {
    for (const value of values) {
        const text = normalizeText(value);
        if (text && !item.keys.some((key) => key.text === text)) item.keys.push({ text, weight, exact });
    }
}

const keyScore = (key, query, tokens) => key.exact
    ? Number(key.text === query) * key.weight
    : matchScore(key.text, query, tokens) * key.weight;

// sites: graphics from queryFeatures, with geometry and the fields above
export function buildSearchIndex(sites, objectIdField) {
    const families = new Map();
    const groups = new Map();
    const languages = new Map();
    const places = new Map();

    for (const graphic of sites) {
        const attributes = graphic.attributes || {};
        const value = (field) => String(attributes[field] ?? '').trim();

        const site = {
            objectId: attributes[objectIdField],
            geometry: graphic.geometry,
            attributes
        };
        const family = value(FIELDS.family);
        const group = value(FIELDS.group);
        const language = value(FIELDS.language);
        const slug = markerSlug(family, group);

        if (family) {
            if (!families.has(family)) families.set(family, entry('family', family, markerSlug(family), localizedLookup(family, FAMILY_LABELS)));
            families.get(family).sites.push(site);
        }

        // groups that just repeat the family name (Mayan, Purépecha) arent their own result
        if (group && group !== family) {
            if (!groups.has(group)) {
                const item = entry('group', group, slug, localizedLookup(group, GROUP_LABELS));
                item.family = family;
                groups.set(group, item);
            }
            groups.get(group).sites.push(site);
        }

        if (language) {
            if (!languages.has(language)) {
                const item = entry('language', language, slug);
                Object.assign(item, { family, group });
                languages.set(language, item);
            }
            const item = languages.get(language);
            item.sites.push(site);
            addKeys(item, [
                value(FIELDS.isoCode), value(FIELDS.glottocode),
                value(FIELDS.surveyIsoCode), value(FIELDS.surveyGlottocode)
            ], WEIGHTS.alias, true);
        }

        // one documented place per name and area, several languages can share it
        const name = value(FIELDS.name);
        if (name) {
            const key = [name, value(FIELDS.adminArea), value(FIELDS.country)].map(normalizeText).join('|');
            if (!places.has(key)) {
                const item = entry('place', name, slug, localizedPlaceName(name));
                Object.assign(item, {
                    area: joinText([localizedPlaceName(value(FIELDS.adminArea)), localizedLookup(value(FIELDS.country), COUNTRY_LABELS)], ', '),
                    origin: false
                });
                places.set(key, item);
            }
            const item = places.get(key);
            item.sites.push(site);
            if (value(FIELDS.placeRole) === 'town_origin') item.origin = true;
            addKeys(item, [placeName(value(PLACE_FIELDS.officialName))], WEIGHTS.alias);
        }
    }

    // context line under each name, enough to tell similar results apart
    // places show where they are, the languages spoken there are in the popup once picked
    for (const item of families.values()) {
        const count = new Set(item.sites.map((site) => site.attributes[FIELDS.language]).filter(Boolean)).size;
        item.context = languageCount(count);
    }
    for (const item of groups.values()) item.context = localizedLookup(item.family, FAMILY_LABELS);
    for (const item of languages.values()) {
        const family = localizedLookup(item.family || 'Unclassified', FAMILY_LABELS);
        item.context = item.group && item.group !== item.family
            ? joinText([family, localizedLookup(item.group, GROUP_LABELS)], ' › ')
            : family;
    }
    for (const item of places.values()) item.context = item.area;

    const entries = [...families.values(), ...groups.values(), ...languages.values(), ...places.values()];
    for (const item of entries) {
        addKeys(item, [item.kind === 'place' ? placeName(item.label) : item.label], WEIGHTS.label);
        addKeys(item, [textFor(item.display, 'es')], WEIGHTS.label); // translated families and groups count as their shown name
        addKeys(item, ALIASES[item.label] || [], WEIGHTS.alias);
    }

    // a language also answers to its group and family's other names, so mixteco lists the Mixtec languages
    for (const item of languages.values()) {
        addKeys(item, [...(ALIASES[item.group] || []), ...(ALIASES[item.family] || [])], WEIGHTS.extra);
    }

    return {
        entries,

        // every entry that matches, best first
        // languages and families come before documented places, the order the search promises
        search(query) {
            const normalized = normalizeText(query);
            if (!normalized) return [];
            const tokens = normalized.split(' ');

            return entries
                .map((item) => ({
                    item,
                    score: Math.max(...item.keys.map((key) => keyScore(key, normalized, tokens)))
                }))
                .filter(({ score }) => score > 0)
                .sort((a, b) =>
                    (a.item.kind === 'place') - (b.item.kind === 'place') ||
                    b.score - a.score ||
                    KINDS[a.item.kind].order - KINDS[b.item.kind].order ||
                    a.item.label.localeCompare(b.item.label))
                .map(({ item }) => item);
        }
    };
}

// query every site from the layer and index them
// spatialReference: the view's, so geometries can go straight to goTo and popups
// the service returns up to 2000 sites per query, well above what we have
export async function loadSearchIndex(layer, spatialReference) {
    const { features } = await layer.queryFeatures({
        where: '1=1',
        outFields: [layer.objectIdField, ...Object.values(FIELDS), ...Object.values(PLACE_FIELDS)],
        returnGeometry: true,
        outSpatialReference: spatialReference
    });
    return buildSearchIndex(features, layer.objectIdField);
}
