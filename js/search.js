import { PATHS } from './map.js';
import { FAMILIES, OTOMANGUEAN_GROUPS } from './map-layers.js';
import { KINDS, matchRange } from './search-index.js';
import { suggestPlaces } from './place-search.js';
import { isLocalizedText, localized, onLanguageChange, textFor } from './language.js';
import { html, languageText } from './ui.js';

// one search bar for languages, families, groups, documented places, and other places
// results from our data come first, the geocoder's other places get added under them when they arrive
// follows the aria combobox pattern, arrow keys move thru results, enter picks one, escape closes then clears

const GEOCODER_MIN_LENGTH = 3; // shorter queries return mostly noise from the geocoder
const GEOCODER_DELAY = 250; // ms of no typing before asking the geocoder

const PIN_ICON = `${PATHS.markers}/place-pin.svg`;

// type tag color for each marker, so a tag matches the family or group it belongs to
const TAG_COLORS = Object.fromEntries([...FAMILIES, ...OTOMANGUEAN_GROUPS].map(({ slug, text }) => [slug, text]));

// copy for the note row under the results and the screen reader status
const NOTES = {
    indexFailed: localized('Languages are unavailable right now', 'Las lenguas no están disponibles en este momento'),
    loading: localized('Loading languages…', 'Cargando lenguas…'),
    searchingPlaces: localized('Searching other places…', 'Buscando otros lugares…'),
    placesFailed: localized('Other places are unavailable right now', 'Los demás lugares no están disponibles en este momento'),
    noMatches: localized('No matches. Try a language, family, town, or state.', 'Sin resultados. Prueba con una lengua, familia, pueblo o estado.')
};

const resultCount = (count) => localized(
    count ? `${count} ${count === 1 ? 'result' : 'results'}` : 'No results',
    count ? `${count} ${count === 1 ? 'resultado' : 'resultados'}` : 'Sin resultados'
);

const PLACE_TAG = localized('Place', 'Lugar');

// small oregon shape next to the tag on places from our data, css colors it w/ the tag color
const OREGON_ICON = html`<span class="search-result-tag-icon" aria-hidden="true"></span>`;

// name w/ the matched part bolded, alias matches (like ISO codes) just show the name
// translated names get both versions bolded on their own
function highlightedName(label, query) {
    if (isLocalizedText(label)) {
        return html`<span class="en" lang="en">${highlightedName(label.en, query)}</span><span class="es" lang="es">${highlightedName(label.es, query)}</span>`;
    }
    const range = matchRange(label, query);
    if (!range) return html`${label}`;
    const [start, end] = range;
    return html`${label.slice(0, start)}<mark>${label.slice(start, end)}</mark>${label.slice(end)}`;
}

// a result row for one of our entries
const dataResult = (item) => ({
    source: 'data',
    kind: item.kind,
    label: item.display,
    context: item.context,
    tag: KINDS[item.kind].tag,
    tagColor: TAG_COLORS[item.slug],
    icon: `${PATHS.markers}/${item.slug}-${item.kind === 'place' && item.origin ? 'plus' : 'circle'}.svg`,
    item
});

// a result row for a geocoder suggestion
const placeResult = (suggestion) => ({
    source: 'geocoder',
    kind: 'other-place',
    label: suggestion.label,
    context: suggestion.context,
    tag: PLACE_TAG,
    icon: PIN_ICON,
    suggestion
});

// index: from buildSearchIndex, or a promise of one while the sites load
// center(): map center as [longitude, latitude], nearer geocoder places rank higher
// onSelect(result): runs when a result gets picked
// onClear(): runs when the search gets cleared
export function initSearch({ index, center, onSelect = () => {}, onClear = () => {} }) {
    const root = document.getElementById('search');
    const input = document.getElementById('search-input');
    const clearButton = document.getElementById('search-clear');
    const list = document.getElementById('search-results');
    const status = document.getElementById('search-status');

    let dataIndex = null;
    let indexFailed = false;
    let results = [];
    let activeIndex = -1;
    let places = { query: '', results: [], loading: false, failed: false };
    let placeTimer = null;
    let placeRequest = null;
    let chosen = null; // last picked result, while the bar still shows its name

    Promise.resolve(index).then((loaded) => {
        dataIndex = loaded;
    }, () => {
        indexFailed = true; // other places still work w/o our data
    }).then(() => {
        if (query() && !list.hidden) render();
    });

    const query = () => input.value.trim();

    function setOpen(open) {
        list.hidden = !open;
        input.setAttribute('aria-expanded', String(open));
        root.classList.toggle('is-open', open);
        if (!open) setActive(-1);
    }

    // scroll: keep the active row in view, off for mouse hover so the list doesnt jump under the pointer
    function setActive(next, { scroll = true } = {}) {
        activeIndex = next;
        list.querySelectorAll('[role="option"]').forEach((option) => {
            const active = Number(option.dataset.index) === activeIndex;
            option.setAttribute('aria-selected', String(active));
            if (active && scroll) option.scrollIntoView({ block: 'nearest' });
        });
        const activeOption = list.querySelector(`[data-index="${activeIndex}"]`);
        if (activeOption) input.setAttribute('aria-activedescendant', activeOption.id);
        else input.removeAttribute('aria-activedescendant');
    }

    // message row at the bottom of the list, not selectable
    function noteRow(text, className = '') {
        return html`<li class="search-note ${className}" role="presentation">${languageText(text)}</li>`;
    }

    function render() {
        const text = query();
        const placesCurrent = places.query === text;
        const waitingOnPlaces = text.length >= GEOCODER_MIN_LENGTH && (!placesCurrent || places.loading);

        results = [
            ...(dataIndex ? dataIndex.search(text).map(dataResult) : []),
            ...(placesCurrent ? places.results.map(placeResult) : [])
        ];

        const rows = results.map((result, i) => html`
            <li class="search-result search-result-${result.source}" id="search-option-${i}" role="option"
                aria-selected="false" data-index="${i}">
                <img class="search-result-icon" src="${result.icon}" alt="" width="22" height="22">
                <span class="search-result-text">
                    <span class="search-result-name">${highlightedName(result.label, text)}</span>
                    ${textFor(result.context) ? html`<span class="search-result-context">${languageText(result.context)}</span>` : ''}
                </span>
                <span class="search-result-tag${result.kind === 'place' ? ' search-result-tag-oregon' : ''}"${result.tagColor ? html` style="color: ${result.tagColor}"` : ''}>${result.kind === 'place' ? OREGON_ICON : ''}${languageText(result.tag)}</span>
            </li>
        `);

        let note = '';
        if (indexFailed && !waitingOnPlaces && !results.length) note = noteRow(NOTES.indexFailed);
        else if (!dataIndex && !indexFailed) note = noteRow(NOTES.loading, 'is-loading');
        else if (waitingOnPlaces) note = noteRow(NOTES.searchingPlaces, 'is-loading');
        else if (placesCurrent && places.failed) note = noteRow(NOTES.placesFailed);
        else if (!results.length) note = noteRow(NOTES.noMatches);

        list.innerHTML = String(html`${rows}${note}`);
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');

        if (!waitingOnPlaces) {
            status.textContent = textFor(resultCount(results.length));
        }
    }

    // ask the geocoder once typing pauses, a newer query cancels the older request
    function schedulePlaces() {
        clearTimeout(placeTimer);
        placeRequest?.abort();
        const text = query();
        if (text.length < GEOCODER_MIN_LENGTH) {
            places = { query: text, results: [], loading: false, failed: false };
            return;
        }

        places = { query: text, results: [], loading: true, failed: false };
        placeTimer = setTimeout(async () => {
            const controller = new AbortController();
            placeRequest = controller;
            try {
                const found = await suggestPlaces(text, { center: center?.(), signal: controller.signal });
                places = { query: text, results: dropDocumented(found), loading: false, failed: false };
            } catch (error) {
                if (error.name === 'AbortError') return;
                console.error('Place search failed:', error);
                places = { query: text, results: [], loading: false, failed: true };
            }
            if (query() === text && !list.hidden) render();
        }, GEOCODER_DELAY);
    }

    // skip geocoder places that are already in the list as one of our documented places
    function dropDocumented(found) {
        if (!dataIndex) return found;
        const documented = new Set(dataIndex.entries
            .filter((item) => item.kind === 'place')
            .map((item) => item.label.replace(/ Municipality$/, '').toLowerCase()));
        return found.filter((place) => !documented.has(place.label.toLowerCase()));
    }

    function update() {
        clearButton.hidden = !input.value;
        if (!query()) {
            clearTimeout(placeTimer);
            placeRequest?.abort();
            list.innerHTML = '';
            results = [];
            setOpen(false);
            return;
        }
        schedulePlaces();
        render();
        setOpen(true);
    }

    function choose(result) {
        if (!result) return;
        chosen = result;
        input.value = textFor(result.label);
        clearButton.hidden = false;
        setOpen(false);
        status.textContent = `${textFor(result.label)}, ${textFor(result.tag)}`;
        onSelect(result);
    }

    function clear() {
        chosen = null;
        input.value = '';
        update();
        status.textContent = '';
        onClear();
        input.focus();
    }

    input.addEventListener('input', () => {
        chosen = null;
        update();
    });

    // a picked family or group shows its name in the new language, typed text stays as typed
    // results and notes switch on their own thru the .en/.es spans
    onLanguageChange((language) => {
        if (chosen && isLocalizedText(chosen.label)) input.value = textFor(chosen.label, language);
        if (!list.hidden) render();
    });

    // reopen the last results when coming back to the bar
    input.addEventListener('focus', () => {
        if (query() && list.hidden) {
            render();
            setOpen(true);
        }
    });

    input.addEventListener('keydown', (event) => {
        const open = !list.hidden;
        switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (!open && query()) { render(); setOpen(true); }
            if (results.length) setActive(Math.min(activeIndex + 1, results.length - 1));
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (results.length) setActive(Math.max(activeIndex - 1, 0));
            break;
        case 'Home':
        case 'End':
            if (!open || !results.length) break;
            event.preventDefault();
            setActive(event.key === 'Home' ? 0 : results.length - 1);
            break;
        case 'Enter':
            if (!open) break;
            event.preventDefault();
            choose(results[activeIndex] || results[0]); // enter w/o picking takes the top result
            break;
        case 'Escape':
            if (open) setOpen(false);
            else if (input.value) clear();
            break;
        default:
            break;
        }
    });

    // mousedown would blur the input before the click lands, keep focus in the bar
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option) choose(results[Number(option.dataset.index)]);
    });
    list.addEventListener('pointermove', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option && Number(option.dataset.index) !== activeIndex) setActive(Number(option.dataset.index), { scroll: false });
    });

    clearButton.addEventListener('click', clear);

    // close when focus or a click goes somewhere else on the page
    root.addEventListener('focusout', (event) => {
        if (!root.contains(event.relatedTarget)) setOpen(false);
    });

    return { clear };
}
