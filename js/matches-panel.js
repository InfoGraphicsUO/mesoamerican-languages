import { PATHS } from './map.js';
import { FAMILIES, OTOMANGUEAN_GROUPS, FIELDS } from './map-layers.js';
import { KINDS, markerSlug } from './search-index.js';
import { suggestPlaces } from './place-search.js';
import { classification } from './language-estimate.js';
import { localized, textFor } from './language.js';
import { html, languageText } from './ui.js';

// step 2, two columns that work one of two ways depending on step 1's place | language switch
// place search: the places that match, then the languages at whichever place gets picked
//   languages are the ones we've verified at the place, then the ones the estimate says are likely nearby
//   picking a language hands it to step 3
// language search: the languages, groups, and families that match, then the communities of origin for the one picked
//   picking a language hands it to step 3 right away, picking a community shows it on the map
// exports initMatchesPanel

const MAX_DOCUMENTED = 8; // documented places listed before the geocoder's other places
const MAX_LANGUAGES = 30; // languages, groups, and families listed for a language search

const PIN_ICON = `${PATHS.markers}/place-pin.svg`;
const TAG_COLORS = Object.fromEntries([...FAMILIES, ...OTOMANGUEAN_GROUPS].map(({ slug, text }) => [slug, text]));

const TEXT = {
    searching: localized('Searching…', 'Buscando…'),
    noPlaces: localized('No places found. Try a town, village, hamlet, or rancho.', 'No se encontraron lugares. Prueba con un pueblo, aldea, caserío o rancho.'),
    placesFailed: localized('Places are unavailable right now', 'Los lugares no están disponibles en este momento'),
    noMatchingLanguages: localized('No languages found. Try a language, group, or family name.', 'No se encontraron lenguas. Prueba con el nombre de una lengua, grupo o familia.'),
    languagesFailed: localized('Languages are unavailable right now', 'Las lenguas no están disponibles en este momento'),
    finding: localized('Finding languages…', 'Buscando lenguas…'),
    noLanguages: localized('No languages found here yet.', 'Todavía no se encontraron lenguas aquí.'),
    languages: localized('Languages', 'Lenguas'),
    communities: localized('Communities of origin', 'Comunidades de origen'),
    pickPlace: localized('Select a place to see the languages spoken there.', 'Elige un lugar para ver las lenguas que se hablan ahí.'),
    pickLanguage: localized('Select a language to see its communities of origin.', 'Elige una lengua para ver sus comunidades de origen.'),
    noCommunities: localized('No communities of origin are mapped for this yet.', 'Todavía no hay comunidades de origen en el mapa para esto.'),
    verified: localized('Verified here', 'Verificada aquí'),
    place: localized('Place', 'Lugar')
};

// the estimate's share in words, a percent read as more exact than it is
function likelyTag(percent) {
    if (percent >= 30) return localized('Very likely', 'Muy probable');
    if (percent >= 10) return localized('Likely', 'Probable');
    return localized('Less likely', 'Menos probable');
}
const languagesNear = (label) => localized(`Languages near ${textFor(label, 'en')}`, `Lenguas cerca de ${textFor(label, 'es')}`);
const placesMatching = (query) => localized(`Places matching “${query}”`, `Lugares que coinciden con “${query}”`);
const languagesMatching = (query) => localized(`Languages matching “${query}”`, `Lenguas que coinciden con “${query}”`);
const communitiesOf = (label) => localized(`Communities of origin for ${textFor(label, 'en')}`, `Comunidades de origen de ${textFor(label, 'es')}`);

const countText = (count, [enOne, enMany], [esOne, esMany], [enRest, esRest] = ['found', '']) => localized(
    `${count} ${count === 1 ? enOne : enMany} ${enRest}`.trim(),
    `${count} ${count === 1 ? esOne : esMany} ${esRest}`.trim()
);

// language names on a set of sites, each once, in data order
const languageNames = (sites) => [...new Set(sites.map((site) => String(site.attributes[FIELDS.language] ?? '').trim()).filter(Boolean))];

const documentedResult = (item) => ({
    source: 'data',
    kind: 'place',
    label: item.display,
    context: item.context,
    tag: KINDS.place.tag,
    tagColor: TAG_COLORS[item.slug],
    icon: `${PATHS.markers}/${item.slug}-plus.svg`,
    item
});

const geocoderResult = (suggestion) => ({
    source: 'geocoder',
    kind: 'other-place',
    label: suggestion.label,
    context: suggestion.context,
    tag: TEXT.place,
    icon: PIN_ICON,
    suggestion
});

// a language, group, or family from our data, for a language search
const languageResult = (item) => ({
    source: 'data',
    kind: item.kind,
    label: item.display,
    context: item.context,
    tag: KINDS[item.kind].tag,
    tagColor: TAG_COLORS[item.slug],
    icon: `${PATHS.markers}/${item.slug}-plus.svg`,
    item
});

// a language found at or near a picked place
function nearbyLanguage(language) {
    const slug = markerSlug(language.family, language.group);
    return {
        label: language.name,
        context: language.classification,
        tag: language.verified ? TEXT.verified : likelyTag(language.percent),
        tagColor: TAG_COLORS[slug],
        icon: `${PATHS.markers}/${slug}-plus.svg`,
        language
    };
}

// a community of origin for a picked language, group, or family
// a group or family's tag names which of its languages are spoken there, a language's would just repeat it
function community(place, picked, ids) {
    const row = documentedResult(place);
    if (picked.kind !== 'language') row.tag = languageNames(place.sites.filter((site) => ids.has(site.objectId))).join(', ');
    return row;
}

// one row, the search result styles from css/search.css on a button
// kind: 'result' for the left list, 'detail' for the right one
function option(kind, i, { icon, label, context, tag, tagColor }) {
    return html`
        <li>
            <button class="search-result step-option" type="button" data-kind="${kind}" data-index="${i}" aria-pressed="false">
                <img class="search-result-icon" src="${icon}" alt="" width="22" height="22">
                <span class="search-result-text">
                    <span class="search-result-name">${languageText(label)}</span>
                    ${textFor(context) ? html`<span class="search-result-context">${languageText(context)}</span>` : ''}
                    <span class="search-result-tag"${tagColor ? html` style="color: ${tagColor}"` : ''}>${languageText(tag)}</span>
                </span>
            </button>
        </li>`;
}

const note = (text, className = '') => html`<li class="search-note ${className}">${languageText(text)}</li>`;

// index, estimate, focus: promises from js/main.js
// center(): map center as [longitude, latitude], nearer geocoder places rank higher
// onPick({ label, languages }): a language was picked, step 3 lists its interpreters
// onReset(): a new search started, step 3 hides until something is picked again
export function initMatchesPanel({ index, estimate, focus, center, onPick = () => {}, onReset = () => {} }) {
    const step = document.getElementById('step-matches');
    const resultsHeading = document.getElementById('matches-results-heading');
    const resultsList = document.getElementById('matches-results');
    const detailsHeading = document.getElementById('matches-details-heading');
    const detailsList = document.getElementById('matches-details');
    const detailsNote = document.getElementById('matches-details-note');
    const status = document.getElementById('matches-status');

    let run = 0; // newest search or pick, so a slow answer cant overwrite a later one
    let mode = 'place';
    let results = []; // left list, places or languages
    let details = []; // right list, the picked result's languages or communities

    // languages for a place: verified at the documented place first, then likely ones from the estimate
    async function languagesAt(result, point) {
        const found = new Map();
        if (result.source === 'data') {
            for (const { attributes } of result.item.sites) {
                const name = String(attributes[FIELDS.language] ?? '').trim();
                if (!name || found.has(name)) continue;
                const family = String(attributes[FIELDS.family] ?? '').trim();
                const group = String(attributes[FIELDS.group] ?? '').trim();
                found.set(name, { name, family, group, classification: classification({ family, group }), verified: true });
            }
        }

        let detail = null;
        if (point) {
            let guess = { languages: [] };
            try {
                guess = await (await estimate).estimate(point);
            } catch (error) {
                console.error('Unable to estimate languages:', error);
            }
            for (const { language, percent, classification: context } of guess.languages) {
                if (!found.has(language.name)) found.set(language.name, { ...language, classification: context, percent });
            }
            detail = guess.message || null; // only the no estimate reasons, not the confidence level
        }
        return { languages: [...found.values()], note: detail };
    }

    // heading: localized text over the list
    // text: a note in place of the rows, w/ a spinner while searching
    function renderResults(heading, text = null) {
        resultsHeading.innerHTML = String(languageText(heading));
        resultsList.innerHTML = String(text
            ? note(text, text === TEXT.searching ? 'is-loading' : '')
            : html`${results.map((row, i) => option('result', i, row))}`);
    }

    // text: a note in place of the rows, loading adds a spinner to it
    // footnote: a line under the list
    function renderDetails(heading, { text = null, loading = false, footnote = null } = {}) {
        detailsHeading.innerHTML = String(languageText(heading));
        detailsList.innerHTML = String(text
            ? note(text, loading ? 'is-loading' : '')
            : html`${details.map((row, i) => option('detail', i, row))}`);
        detailsNote.innerHTML = footnote ? String(languageText(footnote)) : '';
    }

    // our own data, or null when it failed to load
    async function dataIndex() {
        try {
            return await index;
        } catch {
            return null;
        }
    }

    async function searchPlaces(query, current) {
        const data = await dataIndex();
        const documented = data
            ? data.search(query).filter((item) => item.kind === 'place').slice(0, MAX_DOCUMENTED)
            : [];

        let failed = false;
        let suggestions = [];
        try {
            suggestions = await suggestPlaces(query, { center: center() });
        } catch (error) {
            console.error('Place search failed:', error);
            failed = true;
        }
        if (current !== run) return;

        // skip geocoder places that are already listed as one of our documented places
        const names = new Set(documented.map((item) => item.label.replace(/ Municipality$/, '').toLowerCase()));
        results = [
            ...documented.map(documentedResult),
            ...suggestions.filter((place) => !names.has(place.label.toLowerCase())).map(geocoderResult)
        ];

        if (!results.length) {
            const text = failed ? TEXT.placesFailed : TEXT.noPlaces;
            renderResults(placesMatching(query), text);
            status.textContent = textFor(text);
            return;
        }
        renderResults(placesMatching(query));
        status.textContent = textFor(countText(results.length, ['place', 'places'], ['lugar', 'lugares'], ['found', results.length === 1 ? 'encontrado' : 'encontrados']));
    }

    async function searchLanguages(query, current) {
        const data = await dataIndex();
        if (current !== run) return;
        results = data
            ? data.search(query).filter((item) => item.kind !== 'place').slice(0, MAX_LANGUAGES).map(languageResult)
            : [];

        if (!results.length) {
            const text = data ? TEXT.noMatchingLanguages : TEXT.languagesFailed;
            renderResults(languagesMatching(query), text);
            status.textContent = textFor(text);
            return;
        }
        renderResults(languagesMatching(query));
        status.textContent = textFor(countText(results.length, ['language', 'languages'], ['lengua', 'lenguas'], ['found', results.length === 1 ? 'encontrada' : 'encontradas']));
    }

    // query: trimmed search text, nextMode: 'place' or 'language'
    async function search(query, nextMode = 'place') {
        const current = ++run;
        mode = nextMode;
        onReset();
        focus.then((searchFocus) => searchFocus.clear(), () => {}); // the last search's pin or glow, a mode switch would leave it behind
        step.hidden = false;
        results = [];
        details = [];
        const isPlace = mode === 'place';
        renderResults(isPlace ? placesMatching(query) : languagesMatching(query), TEXT.searching);
        renderDetails(isPlace ? TEXT.languages : TEXT.communities, { text: isPlace ? TEXT.pickPlace : TEXT.pickLanguage });

        if (isPlace) await searchPlaces(query, current);
        else await searchLanguages(query, current);
    }

    // a place goes on the map and its languages fill the other list, step 3 waits for a language
    async function pickPlace(place) {
        const current = ++run;
        onReset();
        details = [];
        renderDetails(languagesNear(place.label), { text: TEXT.finding, loading: true });
        const point = await (await focus).show(place);
        const found = await languagesAt(place, point);
        if (current !== run) return;
        details = found.languages.map(nearbyLanguage);
        renderDetails(languagesNear(place.label), { text: details.length ? null : TEXT.noLanguages, footnote: found.note });
        status.textContent = textFor(localized(
            `${details.length} ${details.length === 1 ? 'language' : 'languages'} near ${textFor(place.label, 'en')}`,
            `${details.length} ${details.length === 1 ? 'lengua' : 'lenguas'} cerca de ${textFor(place.label, 'es')}`
        ));
    }

    // a language, group, or family glows on the map, step 3 lists its interpreters,
    // and its communities of origin fill the other list
    async function pickLanguage(result) {
        const current = ++run;
        const { item } = result;
        onPick({ label: result.label, languages: languageNames(item.sites) });

        const ids = new Set(item.sites.map((site) => site.objectId));
        const data = await dataIndex();
        if (current !== run) return;
        details = (data?.entries || [])
            .filter((entry) => entry.kind === 'place' && entry.sites.some((site) => ids.has(site.objectId)))
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((place) => community(place, item, ids));
        renderDetails(communitiesOf(result.label), { text: details.length ? null : TEXT.noCommunities });
        status.textContent = textFor(countText(
            details.length,
            ['community of origin', 'communities of origin'],
            ['comunidad de origen', 'comunidades de origen'],
            [`for ${textFor(result.label, 'en')}`, `de ${textFor(result.label, 'es')}`]
        ));

        (await focus).show(result);
    }

    // only one row picked per list, a pick in the right list keeps the left one picked
    function setPressed(button) {
        button.closest('ul').querySelectorAll('.step-option').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    }

    step.addEventListener('click', (event) => {
        const button = event.target.closest('.step-option');
        if (!button) return;
        setPressed(button);
        const i = Number(button.dataset.index);

        if (button.dataset.kind === 'result') {
            if (mode === 'place') pickPlace(results[i]);
            else pickLanguage(results[i]);
            return;
        }

        const row = details[i];
        if (mode === 'place') onPick({ label: row.label, languages: [row.language.name] });
        else focus.then((searchFocus) => searchFocus.show(row), () => {}); // the community's popup, step 3 keeps the language
    });

    function clear() {
        run += 1;
        step.hidden = true;
        results = [];
        details = [];
        status.textContent = '';
        onReset();
    }

    return { search, clear };
}
