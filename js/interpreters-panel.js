import { FIELDS } from './map-layers.js';
import { html } from './ui.js';

// lists the interpreters from data/interpreters.json in the panel in index.html
// clicking one highlights the sites of the languages they cover
// clicking it again, the clear button, or escape inside the panel clears it

// sql text value, quotes in names like K'iche' have to be doubled
const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

const GLOW_FADE = 80; // fade in on every selection, in ms

// onSelect(id): runs when an interpreter gets picked, so other highlights can make way for it
// returns { clear } so a search pick can drop the interpreter highlight
export async function initInterpretersPanel(view, siteGlow, { onSelect = () => {} } = {}) {
    const response = await fetch('data/interpreters.json');
    if (!response.ok) throw new Error(`Interpreter data returned ${response.status}`);
    const { providers, languageProviders } = await response.json();

    const panel = document.getElementById('interpreters');
    const list = document.getElementById('interpreters-list');
    const clearButton = document.getElementById('interpreters-clear');
    list.innerHTML = String(html`${providers.map((provider) => html`
        <li><button type="button" data-id="${provider.id}" aria-pressed="false">${provider.name}</button></li>
    `)}`);

    const glowView = await view.whenLayerView(siteGlow);
    let selectedId = null;
    let fadeFrame = null;

    function fadeInGlow() {
        const start = performance.now();
        const step = (now) => {
            const progress = Math.min((now - start) / GLOW_FADE, 1);
            siteGlow.opacity = progress;
            fadeFrame = progress < 1 ? requestAnimationFrame(step) : null;
        };
        fadeFrame = requestAnimationFrame(step);
    }

    // id: interpreter to highlight, or null for none
    function select(id) {
        selectedId = id;
        list.querySelectorAll('button').forEach((item) => {
            item.setAttribute('aria-pressed', String(item.dataset.id === selectedId));
        });
        clearButton.hidden = !selectedId;

        cancelAnimationFrame(fadeFrame);
        siteGlow.opacity = 0;
        if (!selectedId) return;

        const languages = languageProviders
            .filter((link) => link.providerId === id)
            .map((link) => sqlText(link.language));
        glowView.filter = { where: `${FIELDS.language} IN (${languages.join(', ')})` };
        fadeInGlow();
    }

    // focus: move focus back to the interpreter that was selected, for clears from inside the panel
    // the clear button hides once nothing is selected, and focus would otherwise drop to the page
    function clear({ focus = false } = {}) {
        if (!selectedId) return;
        const selected = list.querySelector(`[data-id="${CSS.escape(selectedId)}"]`);
        select(null);
        if (focus) selected?.focus();
    }

    list.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const { id } = button.dataset;
        if (id === selectedId) {
            select(null);
            return;
        }
        select(id);
        onSelect(id);
    });

    clearButton.addEventListener('click', () => clear({ focus: true }));

    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && selectedId) clear({ focus: true });
    });

    return { clear: () => clear() };
}
