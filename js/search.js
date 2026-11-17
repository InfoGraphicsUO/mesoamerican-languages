import { applyLocalizedAttributes } from './language.js';

// step 1, three choices: search by location, search by language, or view interpreter coverage
// location and language show a search bar under the choices, coverage skips the search
// typing does nothing on its own, enter or the arrow button runs the search and step 2 lists what it found
// exports initSearch

// placeholder for each search mode, in both languages
const PLACEHOLDERS = {
    place: { en: 'Town, village, hamlet, or rancho…', es: 'Pueblo, aldea, caserío o rancho…' },
    language: { en: 'Language, group, or family…', es: 'Lengua, grupo o familia…' }
};

// onSubmit(query, mode): runs w/ the trimmed text and 'place' or 'language' when a search is entered
// onClear(): runs when the search gets cleared
// onModeChange(mode, previous): runs when a different choice is picked, 'place', 'language', or 'coverage'
export function initSearch({ onSubmit = () => {}, onClear = () => {}, onModeChange = () => {} }) {
    const steps = document.querySelector('.steps');
    const form = document.getElementById('search');
    const input = document.getElementById('search-input');
    const clearButton = document.getElementById('search-clear');
    const choices = document.querySelectorAll('.search-choice');

    let mode = null; // nothing picked yet, only the choices show
    let searched = false; // a search ran and hasnt been cleared, so switching modes runs it again

    const query = () => input.value.trim();

    function submit() {
        searched = true;
        onSubmit(query(), mode);
    }

    function setMode(next) {
        const previous = mode;
        mode = next;
        steps.dataset.searchMode = mode;
        choices.forEach((choice) => choice.setAttribute('aria-pressed', String(choice.dataset.mode === mode)));
        form.hidden = mode === 'coverage';
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
        clearButton.hidden = !input.value;
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (query()) submit();
        else input.focus();
    });

    function clear({ focus = true } = {}) {
        input.value = '';
        clearButton.hidden = true;
        searched = false;
        onClear();
        if (focus) input.focus();
    }

    clearButton.addEventListener('click', () => clear());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && input.value) clear();
    });

    return { clear };
}
