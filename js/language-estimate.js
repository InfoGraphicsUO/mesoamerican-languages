import { FAMILY_LABELS, GROUP_LABELS, localized, localizedLookup, textFor } from './language.js';

// estimates which languages are most likely spoken at any point on the map
// reads one pixel of data/language-probability.tif, built by analysis/build_raster.py
// bands: 1-3 top language index, 4-6 percent, 7 km to the nearest documented site,
// 8 percent for a language nobody reported nearby, 9 confidence level (index into lookup.confidence),
// 10 effective respondents x 10, 255 = no estimate (band 7 is also set on water near a report)
// exports initLanguageEstimate

const RASTER_URL = 'data/language-probability.tif';
const LOOKUP_URL = 'data/language-probability.json';
const GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@3.0.5/+esm';
const MIN_PERCENT = 1; // shares that round below this are left off the list

const CONFIDENCE_TEXT = {
    high: localized('High confidence', 'Confianza alta'),
    medium: localized('Medium confidence', 'Confianza media'),
    low: localized('Low confidence', 'Confianza baja')
};

// why the confidence is what it is: distance to our data, how many people reported nearby, or both
// people is the raster's effective respondents, each person counted once and fading w/ walking time
const distanceText = (km) => (km < 1 ? localized('under 1 km', 'menos de 1 km') : localized(`${km} km`, `${km} km`));

// word joiners keep a range like 5–10 from wrapping at the dash
const range = (from, to) => `${from}\u2060–\u2060${to}`;

// a rough range rather than a count, effective respondents fade w/ walking time so an exact number would mislead
function peopleText(people) {
    if (people < 1) return localized('few', 'pocas');
    if (people < 5) return localized(range(1, 5), range(1, 5));
    if (people < 10) return localized(range(5, 10), range(5, 10));
    return localized('10+', 'más de 10');
}

// which rule held the level back
const LIMIT_TEXT = {
    far: localized('Limited by distance.', 'Limitado por la distancia.'),
    few: localized('Limited by few reports.', 'Limitado por pocos reportes.'),
    both: localized('Limited by distance and few reports.', 'Limitado por la distancia y pocos reportes.')
};

// level: index into lookup.confidence, levels: lookup.confidence
// short facts: distance, people reporting nearby, and below high, which rule held it back
function confidenceDetail(km, people, level, levels) {
    const facts = (lang, limit) => [
        `${lang === 'en' ? 'Nearest site' : 'Sitio más cercano'}: ${textFor(distanceText(km), lang)}.`,
        `${lang === 'en' ? 'People reporting nearby' : 'Personas que reportaron cerca'}: ${textFor(peopleText(people), lang)}.`,
        limit ? textFor(limit, lang) : ''
    ].filter(Boolean).join(' ');
    const detail = (limit) => localized(facts('en', limit), facts('es', limit));

    if (level === 0) return detail(null);

    // km and people are rounded in the raster, so a value just past a rule can land right on it
    // when neither rule fails here, the one sitting on its threshold is the one that held it back
    const better = levels[level - 1];
    let tooFar = km > better.max_km;
    let tooFew = people < better.min_respondents;
    if (!tooFar && !tooFew) {
        tooFar = km >= better.max_km;
        tooFew = people <= better.min_respondents;
    }
    return detail(LIMIT_TEXT[tooFar && tooFew ? 'both' : tooFew ? 'few' : 'far']);
}


const NO_ESTIMATE = (maxKm) => localized(
    `No estimate. No documented sites within ${maxKm} km.`,
    `Sin estimación. No hay sitios documentados a menos de ${maxKm} km.`
);

// within reach of documented sites, but on water or land walking can't reach from them
const NO_ESTIMATE_WATER = localized(
    `No estimate. On water or not reachable on foot from nearby sites.`,
    `Sin estimación. En el agua o sin acceso a pie desde sitios cercanos.`
);

// "Otomanguean › Mixtec" like search results, the group is left off when it repeats the family
export function classification({ family, group }) {
    const parts = [family, group !== family ? group : ''].filter(Boolean);
    if (!parts.length) return '';
    const labels = [localizedLookup(family, FAMILY_LABELS), group !== family ? localizedLookup(group, GROUP_LABELS) : ''].filter(Boolean);
    return localized(labels.map((label) => textFor(label, 'en')).join(' › '), labels.map((label) => textFor(label, 'es')).join(' › '));
}

// loads the raster and its lookup once
// returns { estimate(point), image, lookup }, step 2 in js/matches-panel.js lists what estimate() finds
export async function initLanguageEstimate() {
    const [lookupResponse, rasterResponse, geotiff] = await Promise.all([
        fetch(LOOKUP_URL),
        fetch(RASTER_URL),
        import(GEOTIFF_URL)
    ]);
    if (!lookupResponse.ok) throw new Error(`Language estimate lookup returned ${lookupResponse.status}`);
    const lookup = await lookupResponse.json();
    if (!rasterResponse.ok) throw new Error(`Language estimate raster returned ${rasterResponse.status}`);
    // the whole file in one request, it's small and this works on servers that ignore range requests
    const tiff = await geotiff.fromArrayBuffer(await rasterResponse.arrayBuffer());
    const image = await tiff.getImage();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const width = image.getWidth();
    const height = image.getHeight();
    const maxKm = lookup.model.max_nearest_km;

    // ten band values at a longitude/latitude, or null outside the raster
    async function sample(longitude, latitude) {
        const col = Math.floor((longitude - originX) / resX);
        const row = Math.floor((latitude - originY) / resY); // resY is negative, rows run north to south
        if (col < 0 || row < 0 || col >= width || row >= height) return null;
        const bands = await image.readRasters({ window: [col, row, col + 1, row + 1], interleave: true });
        return Array.from(bands);
    }

    // point: anything w/ longitude/latitude, like a site geometry or a geocoded Point
    // returns { languages: [{ language, percent, classification }], confidence } or { languages: [], message }
    async function estimate(point) {
        let values = null;
        try {
            values = await sample(point.longitude, point.latitude);
        } catch (error) {
            console.error('Unable to read language estimate:', error);
        }
        const nodata = lookup.nodata;
        if (!values || values[0] === nodata) {
            // band 7 is kept on water within reach of a report, empty everywhere else
            const water = values && values[6] !== undefined && values[6] !== nodata;
            return { languages: [], message: water ? NO_ESTIMATE_WATER : NO_ESTIMATE(maxKm) };
        }

        // set in the raster from distance and how many people reported nearby, so a lone report can't read as high
        const levelIndex = lookup.confidence[values[8]] ? values[8] : lookup.confidence.length - 1;
        const level = lookup.confidence[levelIndex].level;
        const languages = [0, 1, 2]
            .filter((i) => values[i] !== nodata && values[3 + i] >= MIN_PERCENT)
            .map((i) => {
                const language = lookup.languages[values[i]];
                return { language, percent: values[3 + i], classification: classification(language) };
            });

        return {
            languages,
            level,
            confidence: CONFIDENCE_TEXT[level],
            detail: confidenceDetail(values[6], values[9] / 10, levelIndex, lookup.confidence)
        };
    }

    return { estimate, image, lookup }; // image + lookup are shared w/ js/raster-overlay.js
}
