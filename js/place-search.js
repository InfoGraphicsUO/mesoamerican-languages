import { MAP } from './map.js';
import { COUNTRY_LABELS, localized, localizedLookup, textFor } from './language.js';

// looks up places that arent in our data w/ esri's World Geocoding Service
// lets someone find a town we havent documented yet and see what's spoken nearby
// exports suggestPlaces, locatePlace

// the keyless geocode.arcgis.com host is what the sdk's own search uses w/o an api key
// geocode-api.arcgis.com is the same service but needs a key
// these lookups arent stored, which is what the keyless service allows
const LOCATOR_URL = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer';

// study area, Mesoamerican countries as ISO 3166-1 alpha-3 codes, also limited to the map bounds below
export const STUDY_COUNTRIES = {
    MEX: 'Mexico',
    GTM: 'Guatemala',
    BLZ: 'Belize',
    SLV: 'El Salvador',
    HND: 'Honduras'
};

// towns, villages, neighborhoods, municipalities, and states, but not streets or businesses
const CATEGORIES = 'Populated Place,Admin';
const MAX_SUGGESTIONS = 6;

const SEARCH_EXTENT = JSON.stringify({
    xmin: MAP.bounds[0][0],
    ymin: MAP.bounds[0][1],
    xmax: MAP.bounds[1][0],
    ymax: MAP.bounds[1][1],
    spatialReference: { wkid: 4326 }
});

async function request(operation, params, signal) {
    const url = `${LOCATOR_URL}/${operation}?${new URLSearchParams({ f: 'json', ...params })}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message || 'Geocoder error');
    return body;
}

// 'San Juan Copala, Santiago Juxtlahuaca, Oaxaca, MEX' -> name + 'Santiago Juxtlahuaca, Oaxaca, Mexico'
// the context comes back as a localized() pair so the country name follows the site language
function splitSuggestion(text) {
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts.at(-1);
    if (STUDY_COUNTRIES[last]) parts[parts.length - 1] = localizedLookup(STUDY_COUNTRIES[last], COUNTRY_LABELS);
    const context = parts.slice(1);
    return {
        label: parts[0],
        context: localized(
            context.map((part) => textFor(part, 'en')).join(', '),
            context.map((part) => textFor(part, 'es')).join(', ')
        )
    };
}

// text: what the user typed
// center: [longitude, latitude], nearer places rank higher
// returns [{ label, context, text, magicKey }]
export async function suggestPlaces(text, { center, signal } = {}) {
    const { suggestions = [] } = await request('suggest', {
        text,
        category: CATEGORIES,
        countryCode: Object.keys(STUDY_COUNTRIES).join(','),
        searchExtent: SEARCH_EXTENT,
        maxSuggestions: MAX_SUGGESTIONS,
        ...(center ? { location: center.join(',') } : {})
    }, signal);

    return suggestions
        .filter((suggestion) => !suggestion.isCollection) // collections are categories like 'restaurants'
        .map((suggestion) => ({ ...splitSuggestion(suggestion.text), text: suggestion.text, magicKey: suggestion.magicKey }));
}

// turns a picked suggestion into a location, the magicKey makes it the exact place that was suggested
// returns { x, y, extent } in longitude/latitude, or null if the geocoder lost it
export async function locatePlace({ text, magicKey }, { signal } = {}) {
    const { candidates = [] } = await request('findAddressCandidates', {
        singleLine: text,
        magicKey,
        maxLocations: 1,
        outSR: 4326
    }, signal);

    const [candidate] = candidates;
    if (!candidate) return null;
    return { ...candidate.location, extent: candidate.extent };
}
