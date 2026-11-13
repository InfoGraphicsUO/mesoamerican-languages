import { PATHS } from './map.js';
import { FAMILIES, OTOMANGUEAN_GROUPS, FIELDS } from './map-layers.js';
import { KINDS, markerSlug } from './search-index.js';
import { suggestPlaces } from './place-search.js';
import { classification } from './language-estimate.js';
import { localized, textFor } from './language.js';
import { html, languageText } from './ui.js';

// step 2, the places that match a search, then the languages at whichever place gets picked
// languages are the ones we've verified at the place, then the ones the estimate says are likely nearby
// picking a language hands it to step 3
// exports initMatchesPanel

const MAX_DOCUMENTED = 8; // documented places listed before the geocoder's other places

const PIN_ICON = `${PATHS.markers}/place-pin.svg`;
const TAG_COLORS = Object.fromEntries([...FAMILIES, ...OTOMANGUEAN_GROUPS].map(({ slug, text }) => [slug, text]));

const TEXT = {
    searching: localized('Searching…', 'Buscando…'),
    noPlaces: localized('No places found. Try a town, village, hamlet, or rancho.', 'No se encontraron lugares. Prueba con un pueblo, aldea, caserío o rancho.'),
    placesFailed: localized('Places are unavailable right now', 'Los lugares no están disponibles en este momento'),
    finding: localized('Finding languages…', 'Buscando lenguas…'),
    noLanguages: localized('No languages found here yet.', 'Todavía no se encontraron lenguas aquí.'),
    languages: localized('Languages', 'Lenguas'),
    pickPlace: localized('Select a place to see the languages spoken there.', 'Elige un lugar para ver las lenguas que se hablan ahí.'),
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

// one row, the search result styles from css/search.css on a button
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
// onPick({ label, languages }): a language or place was picked, step 3 lists its interpreters
// onReset(): a new search started, step 3 hides until something is picked again
export function initMatchesPanel({ index, estimate, focus, center, onPick = () => {}, onReset = () => {} }) {
    const step = document.getElementById('step-matches');
    const languagesHeading = document.getElementById('matches-languages-heading');
    const languagesList = document.getElementById('matches-languages');
    const languagesNote = document.getElementById('matches-languages-note');
    const placesHeading = document.getElementById('matches-places-heading');
    const placesList = document.getElementById('matches-places');
    const status = document.getElementById('matches-status');

    let run = 0; // newest search, so a slow answer cant overwrite a later one
    let places = [];
    let languages = [];

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

    function renderPlaces(query, text) {
        placesHeading.innerHTML = String(languageText(placesMatching(query)));
        placesList.innerHTML = String(text
            ? note(text, text === TEXT.searching ? 'is-loading' : '')
            : html`${places.map((place, i) => option('place', i, place))}`);
    }

    // place: the picked place, or null before one is picked
    // found: its languages, or null while they load
    function renderLanguages(place, found) {
        languages = [];
        languagesHeading.innerHTML = String(languageText(place ? languagesNear(place.label) : TEXT.languages));
        if (!place) {
            languagesList.innerHTML = String(note(TEXT.pickPlace));
            languagesNote.textContent = '';
            return;
        }
        if (!found) {
            languagesList.innerHTML = String(note(TEXT.finding, 'is-loading'));
            languagesNote.textContent = '';
            return;
        }
        languages = found.languages;
        languagesList.innerHTML = String(languages.length
            ? html`${languages.map((language, i) => {
                const slug = markerSlug(language.family, language.group);
                return option('language', i, {
                    icon: `${PATHS.markers}/${slug}-plus.svg`,
                    label: language.name,
                    context: language.classification,
                    tag: language.verified ? TEXT.verified : likelyTag(language.percent),
                    tagColor: TAG_COLORS[slug]
                });
            })}`
            : note(TEXT.noLanguages));
        languagesNote.innerHTML = found.note ? String(languageText(found.note)) : '';
    }

    async function search(query) {
        const current = ++run;
        onReset();
        step.hidden = false;
        places = [];
        renderPlaces(query, TEXT.searching);
        renderLanguages(null);

        let dataIndex = null;
        try {
            dataIndex = await index;
        } catch {
            // other places still work w/o our data
        }
        const documented = dataIndex
            ? dataIndex.search(query).filter((item) => item.kind === 'place').slice(0, MAX_DOCUMENTED)
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
        places = [
            ...documented.map(documentedResult),
            ...suggestions.filter((place) => !names.has(place.label.toLowerCase())).map(geocoderResult)
        ];

        if (!places.length) {
            renderPlaces(query, failed ? TEXT.placesFailed : TEXT.noPlaces);
            status.textContent = textFor(failed ? TEXT.placesFailed : TEXT.noPlaces);
            return;
        }
        renderPlaces(query);
        status.textContent = textFor(localized(
            `${places.length} ${places.length === 1 ? 'place' : 'places'} found`,
            `${places.length} ${places.length === 1 ? 'lugar encontrado' : 'lugares encontrados'}`
        ));
    }

    // only one row picked per list, a language pick keeps its place picked
    function setPressed(button) {
        button.closest('ul').querySelectorAll('.step-option').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    }

    step.addEventListener('click', async (event) => {
        const button = event.target.closest('.step-option');
        if (!button) return;
        setPressed(button);
        const i = Number(button.dataset.index);

        if (button.dataset.kind === 'language') {
            onPick({ label: languages[i].name, languages: [languages[i].name] });
            return;
        }

        // a place goes on the map and its languages fill the other list, step 3 waits for a language
        const current = ++run;
        const place = places[i];
        onReset();
        renderLanguages(place, null);
        const point = await (await focus).show(place);
        const found = await languagesAt(place, point);
        if (current !== run) return;
        renderLanguages(place, found);
        status.textContent = textFor(localized(
            `${languages.length} ${languages.length === 1 ? 'language' : 'languages'} near ${textFor(place.label, 'en')}`,
            `${languages.length} ${languages.length === 1 ? 'lengua' : 'lenguas'} cerca de ${textFor(place.label, 'es')}`
        ));
    });

    function clear() {
        run += 1;
        step.hidden = true;
        places = [];
        languages = [];
        status.textContent = '';
        onReset();
    }

    return { search, clear };
}
