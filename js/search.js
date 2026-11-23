import { matchRange } from './search-index.js';
import { suggestPlaces } from './place-search.js';
import { documentedResult, geocoderResult, languageResult } from './matches-panel.js';
import { applyLocalizedAttributes, isLocalizedText, localized, onLanguageChange, textFor } from './language.js';
import { html, languageText } from './ui.js';

// step 1, three choices: search by location, search by language, or view interpreter coverage
// location and language show a search bar under the choices, coverage skips the search
// typing drops down suggestions under the bar, picking one skips straight to it in step 2
// enter w/o picking one, or the arrow button, runs the search and step 2 lists everything it found
// the dropdown follows the aria combobox pattern, arrow keys move thru it, escape closes it then clears the bar
// a spot picked on the map switches to location and empties the bar, step 2 lists that spot instead
// exports initSearch

// placeholder for each search mode, in both languages
const PLACEHOLDERS = {
    place: { en: 'Town, village, hamlet, or rancho…', es: 'Pueblo, aldea, caserío o rancho…' },
    language: { en: 'Language, group, or family…', es: 'Lengua, grupo o familia…' }
};

const MAX_DOCUMENTED = 5; // documented places suggested before the geocoder's other places
const MAX_LANGUAGES = 8; // languages, groups, and families suggested
const GEOCODER_MIN_LENGTH = 3; // shorter queries return mostly noise from the geocoder
const GEOCODER_DELAY = 250; // ms of no typing before asking the geocoder
const LIST_GAP = 6; // px between the bar and the suggestions
const LIST_ROWS = 2.5; // rows that show before the list scrolls, the half row hints that it does
const LIST_MARGIN = 16; // px kept clear under the list at the bottom of the page

// copy for the note row under the suggestions
const NOTES = {
    loading: localized('Loading…', 'Cargando…'),
    searchingPlaces: localized('Searching places…', 'Buscando lugares…'),
    placesFailed: localized('Other places are unavailable right now', 'Los demás lugares no están disponibles en este momento'),
    noPlaces: localized('No places found. Try a town, village, hamlet, or rancho.', 'No se encontraron lugares. Prueba con un pueblo, aldea, caserío o rancho.'),
    noLanguages: localized('No languages found. Try a language, group, or family name.', 'No se encontraron lenguas. Prueba con el nombre de una lengua, grupo o familia.'),
    languagesFailed: localized('Languages are unavailable right now', 'Las lenguas no están disponibles en este momento')
};

const suggestionCount = (count) => localized(
    count ? `${count} ${count === 1 ? 'suggestion' : 'suggestions'}` : 'No suggestions',
    count ? `${count} ${count === 1 ? 'sugerencia' : 'sugerencias'}` : 'Sin sugerencias'
);

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

// index: from buildSearchIndex, or a promise of one while the sites load
// center(): map center as [longitude, latitude], nearer geocoder places rank higher
// onSubmit(query, mode): runs w/ the trimmed text and 'place' or 'language' when a search is entered
// onChoose(result, mode): runs w/ a picked suggestion, a step 2 row from js/matches-panel.js
// onClear(): runs when the search gets cleared
// onModeChange(mode, previous): runs when a different choice is picked, 'place', 'language', or 'coverage'
export function initSearch({ index, center, onSubmit = () => {}, onChoose = () => {}, onClear = () => {}, onModeChange = () => {} }) {
    const steps = document.querySelector('.steps');
    const form = document.getElementById('search');
    const input = document.getElementById('search-input');
    const clearButton = document.getElementById('search-clear');
    const list = document.getElementById('search-suggestions');
    const status = document.getElementById('search-status');
    const choices = document.querySelectorAll('.search-choice');

    let mode = null; // nothing picked yet, only the choices show
    let searched = false; // a search ran and hasnt been cleared, so switching modes runs it again
    let settled = false; // what's in the bar was searched or picked, so coming back to it doesnt reopen the dropdown

    let dataIndex = null;
    let indexFailed = false;
    let suggestions = [];
    let activeIndex = -1;
    let places = { query: '', results: [], loading: false, failed: false };
    let placeTimer = null;
    let placeRequest = null;

    Promise.resolve(index).then((loaded) => {
        dataIndex = loaded;
    }, () => {
        indexFailed = true; // other places still work w/o our data
    }).then(() => {
        if (query() && !list.hidden) render();
    });

    const query = () => input.value.trim();

    // the list sits outside the steps, so it gets lined up under the bar (field and arrow button) each time it opens or moves
    function place() {
        if (list.hidden) return;
        const bar = form.getBoundingClientRect();
        const page = list.offsetParent?.getBoundingClientRect() ?? { top: 0, left: 0, height: window.innerHeight };
        const top = bar.bottom - page.top + LIST_GAP;
        const row = list.querySelector('.search-result, .search-note')?.offsetHeight || 60;
        list.style.top = `${top}px`;
        list.style.left = `${bar.left - page.left}px`;
        list.style.width = `${bar.width}px`;
        list.style.maxHeight = `${Math.max(row * 2, Math.min(row * LIST_ROWS, page.height - top - LIST_MARGIN))}px`;
    }

    function setOpen(open) {
        list.hidden = !open;
        place();
        input.setAttribute('aria-expanded', String(open));
        form.classList.toggle('is-open', open);
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
    const noteRow = (text, className = '') => html`<li class="search-note ${className}" role="presentation">${languageText(text)}</li>`;

    // documented places first, then the geocoder's other places once they arrive
    function placeSuggestions(text) {
        const documented = dataIndex
            ? dataIndex.search(text).filter((item) => item.kind === 'place').slice(0, MAX_DOCUMENTED)
            : [];
        const others = places.query === text ? places.results : [];
        // skip geocoder places that are already in the list as one of our documented places
        const names = new Set(documented.map((item) => item.label.replace(/ Municipality$/, '').toLowerCase()));
        return [
            ...documented.map(documentedResult),
            ...others.filter((place) => !names.has(place.label.toLowerCase())).map(geocoderResult)
        ];
    }

    const languageSuggestions = (text) => (dataIndex ? dataIndex.search(text) : [])
        .filter((item) => item.kind !== 'place')
        .slice(0, MAX_LANGUAGES)
        .map((item) => languageResult(item));

    function render() {
        const text = query();
        const isPlace = mode === 'place';
        const waitingOnPlaces = isPlace && text.length >= GEOCODER_MIN_LENGTH && (places.query !== text || places.loading);
        const waitingOnIndex = !dataIndex && !indexFailed;

        suggestions = isPlace ? placeSuggestions(text) : languageSuggestions(text);

        const rows = suggestions.map((row, i) => html`
            <li class="search-result search-result-${row.source}" id="search-option-${i}" role="option"
                aria-selected="false" data-index="${i}">
                <img class="search-result-icon" src="${row.icon}" alt="" width="22" height="22">
                <span class="search-result-text">
                    <span class="search-result-name">${highlightedName(row.label, text)}</span>
                    ${textFor(row.context) ? html`<span class="search-result-context">${languageText(row.context)}</span>` : ''}
                    ${textFor(row.tag) ? html`<span class="search-result-tag"${row.tagColor ? html` style="color: ${row.tagColor}"` : ''}>${languageText(row.tag)}</span>` : ''}
                </span>
            </li>
        `);

        let note = '';
        if (waitingOnIndex) note = noteRow(NOTES.loading, 'is-loading');
        else if (waitingOnPlaces) note = noteRow(NOTES.searchingPlaces, 'is-loading');
        else if (isPlace && places.failed && places.query === text) note = noteRow(NOTES.placesFailed);
        else if (!suggestions.length && !isPlace && indexFailed) note = noteRow(NOTES.languagesFailed);
        else if (!suggestions.length) note = noteRow(isPlace ? NOTES.noPlaces : NOTES.noLanguages);

        list.innerHTML = String(html`${rows}${note}`);
        activeIndex = -1;
        input.removeAttribute('aria-activedescendant');
        if (!waitingOnPlaces && !waitingOnIndex) status.textContent = textFor(suggestionCount(suggestions.length));
        place();
    }

    function cancelPlaces() {
        clearTimeout(placeTimer);
        placeRequest?.abort();
    }

    // ask the geocoder once typing pauses, a newer query cancels the older request
    function schedulePlaces() {
        cancelPlaces();
        const text = query();
        if (mode !== 'place' || text.length < GEOCODER_MIN_LENGTH) {
            places = { query: text, results: [], loading: false, failed: false };
            return;
        }
        if (places.query === text && !places.loading) return; // already have them, like coming back to the bar

        places = { query: text, results: [], loading: true, failed: false };
        placeTimer = setTimeout(async () => {
            const controller = new AbortController();
            placeRequest = controller;
            try {
                const found = await suggestPlaces(text, { center: center?.(), signal: controller.signal });
                places = { query: text, results: found, loading: false, failed: false };
            } catch (error) {
                if (error.name === 'AbortError') return;
                console.error('Place search failed:', error);
                places = { query: text, results: [], loading: false, failed: true };
            }
            if (query() === text && !list.hidden) render();
        }, GEOCODER_DELAY);
    }

    // opens the dropdown for what's in the bar, or closes it when the bar is empty
    function suggest() {
        if (!query() || !PLACEHOLDERS[mode]) {
            cancelPlaces();
            list.innerHTML = '';
            suggestions = [];
            setOpen(false);
            return;
        }
        schedulePlaces();
        render();
        setOpen(true);
    }

    function close() {
        cancelPlaces();
        setOpen(false);
    }

    function submit() {
        close();
        searched = true;
        settled = true;
        onSubmit(query(), mode);
    }

    function choose(row) {
        if (!row) return;
        close();
        input.value = textFor(row.label);
        clearButton.hidden = false;
        searched = true;
        settled = true;
        status.textContent = textFor(row.label);
        onChoose(row, mode);
    }

    function setMode(next) {
        const previous = mode;
        mode = next;
        steps.dataset.searchMode = mode;
        choices.forEach((choice) => choice.setAttribute('aria-pressed', String(choice.dataset.mode === mode)));
        form.hidden = mode === 'coverage';
        close();
        if (PLACEHOLDERS[mode]) {
            input.dataset.enPlaceholder = PLACEHOLDERS[mode].en;
            input.dataset.esPlaceholder = PLACEHOLDERS[mode].es;
            applyLocalizedAttributes(input);
        }
        onModeChange(mode, previous);
    }

    choices.forEach((choice) => choice.addEventListener('click', () => {
        const next = choice.dataset.mode;
        if (next === mode) {
            if (mode !== 'coverage') input.focus();
            return;
        }

        // coverage hides the search, so the last one goes w/ it instead of coming back on a return
        if (next === 'coverage') {
            if (input.value || searched) clear({ focus: false });
            setMode(next);
            return;
        }

        setMode(next);
        if (searched && query()) submit();
        else input.focus();
    }));

    input.addEventListener('input', () => {
        settled = false;
        clearButton.hidden = !input.value;
        suggest();
    });

    // reopen the suggestions when coming back to the bar w/ something still being typed
    input.addEventListener('focus', () => {
        if (query() && list.hidden && !settled) suggest();
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (query()) submit();
        else input.focus();
    });

    function clear({ focus = true } = {}) {
        close();
        input.value = '';
        clearButton.hidden = true;
        searched = false;
        status.textContent = '';
        onClear();
        if (focus) input.focus();
    }

    clearButton.addEventListener('click', () => clear());

    input.addEventListener('keydown', (event) => {
        const open = !list.hidden;
        switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (!open && query()) suggest();
            if (suggestions.length) setActive(Math.min(activeIndex + 1, suggestions.length - 1));
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (open && suggestions.length) setActive(Math.max(activeIndex - 1, 0));
            break;
        case 'Enter':
            // a highlighted suggestion gets picked, otherwise the form submits and step 2 lists every match
            if (!open || activeIndex < 0) break;
            event.preventDefault();
            choose(suggestions[activeIndex]);
            break;
        case 'Escape':
            if (open) close();
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
        if (option) choose(suggestions[Number(option.dataset.index)]);
    });
    list.addEventListener('pointermove', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option && Number(option.dataset.index) !== activeIndex) setActive(Number(option.dataset.index), { scroll: false });
    });

    // close when focus or a click goes somewhere else on the page
    form.addEventListener('focusout', (event) => {
        if (!form.contains(event.relatedTarget) && !list.contains(event.relatedTarget)) close();
    });

    // keep the list under the bar when the steps scroll or the page resizes
    steps.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);

    // the suggestions and notes switch on their own thru the .en/.es spans, a re-render keeps the status in step
    onLanguageChange(() => {
        if (!list.hidden) render();
    });

    // for a spot picked on the map, step 2 gets filled by js/matches-panel.js instead of a search
    function startFromMap() {
        close();
        input.value = '';
        clearButton.hidden = true;
        searched = false;
        if (mode !== 'place') setMode('place');
    }

    return { clear, startFromMap };
}
