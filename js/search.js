// step 1, a search bar for places only
// typing does nothing on its own, enter or the arrow button runs the search and step 2 lists what it found
// exports initSearch

// onSubmit(query): runs w/ the trimmed text when a search is entered
// onClear(): runs when the search gets cleared
export function initSearch({ onSubmit = () => {}, onClear = () => {} }) {
    const form = document.getElementById('search');
    const input = document.getElementById('search-input');
    const clearButton = document.getElementById('search-clear');

    const query = () => input.value.trim();

    input.addEventListener('input', () => {
        clearButton.hidden = !input.value;
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (query()) onSubmit(query());
        else input.focus();
    });

    function clear() {
        input.value = '';
        clearButton.hidden = true;
        onClear();
        input.focus();
    }

    clearButton.addEventListener('click', clear);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && input.value) clear();
    });

    return { clear };
}
