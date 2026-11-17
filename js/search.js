import { applyLocalizedAttributes } from './language.js';

// step 1, a search bar for places or languages, the place | language switch on its left picks which
// typing does nothing on its own, enter or the arrow button runs the search and step 2 lists what it found
// exports initSearch

// placeholder for each mode, in both languages
const PLACEHOLDERS = {
    place: { en: 'Town, village, hamlet, or rancho…', es: 'Pueblo, aldea, caserío o rancho…' },
    language: { en: 'Language, group, or family…', es: 'Lengua, grupo o familia…' }
};

// onSubmit(query, mode): runs w/ the trimmed text and 'place' or 'language' when a search is entered
// onClear(): runs when the search gets cleared
export function initSearch({ onSubmit = () => {}, onClear = () => {} }) {
    const steps = document.querySelector('.steps');
    const form = document.getElementById('search');
    const input = document.getElementById('search-input');
    const clearButton = document.getElementById('search-clear');
    const modeSwitch = document.getElementById('search-mode');

    let mode = 'place';
    let searched = false; // a search ran and hasnt been cleared, so switching modes runs it again

    const query = () => input.value.trim();

    function submit() {
        searched = true;
        onSubmit(query(), mode);
    }

    function setMode(next) {
        mode = next;
        steps.dataset.searchMode = mode;
        modeSwitch.setAttribute('aria-checked', String(mode === 'language'));
        input.dataset.enPlaceholder = PLACEHOLDERS[mode].en;
        input.dataset.esPlaceholder = PLACEHOLDERS[mode].es;
        applyLocalizedAttributes(input);
    }

    modeSwitch.addEventListener('click', () => {
        setMode(mode === 'place' ? 'language' : 'place');
        if (searched && query()) submit();
    });

    input.addEventListener('input', () => {
        clearButton.hidden = !input.value;
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (query()) submit();
        else input.focus();
    });

    function clear() {
        input.value = '';
        clearButton.hidden = true;
        searched = false;
        onClear();
        input.focus();
    }

    clearButton.addEventListener('click', clear);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && input.value) clear();
    });

    return { clear };
}
