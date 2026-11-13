import { FIELDS } from './map-layers.js';
import { applyLocalizedAttributes, localized, textFor } from './language.js';
import { html, languageText } from './ui.js';

// lists the interpreters from data/interpreters.json in the panel in index.html
// clicking one highlights the sites of the languages they cover
// clicking it again, the clear button, or escape inside the panel clears it
// step 3, a language or place picked in step 2 filters the list down to the interpreters who cover it

// sql text value, quotes in names like K'iche' have to be doubled
const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

const GLOW_FADE = 80; // fade in on every selection, in ms

// screen reader message when the list changes
const listStatus = (count, label) => localized(
    `${count} ${count === 1 ? 'interpreter' : 'interpreters'} for ${textFor(label, 'en')}`,
    `${count} ${count === 1 ? 'intérprete' : 'intérpretes'} para ${textFor(label, 'es')}`
);

// the interpreter's own site, their request page when they have one, otherwise their main page
// only http(s) links get through, so a bad value in the data cant become a javascript: link
function siteUrl(provider) {
    for (const value of [provider.requestUrl, provider.primarySourceUrl]) {
        try {
            const url = new URL(value);
            if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
        } catch {
            // missing or not a url, try the next one
        }
    }
    return null;
}

// arrow out of a box, the usual opens-somewhere-else icon
const EXTERNAL_ICON = html`<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"
        fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

// "3 of 14", how many of a filtered family, group, or place's languages an interpreter covers
const coverageCount = (count, total) => localized(`${count} of ${total}`, `${count} de ${total}`);

// onSelect(id): runs when an interpreter gets picked, so other highlights can make way for it
// returns { clear, filter } for step 2 picks to drop the highlight and narrow the list
export async function initInterpretersPanel(view, siteGlow, { onSelect = () => {} } = {}) {
    const response = await fetch('data/interpreters.json');
    if (!response.ok) throw new Error(`Interpreter data returned ${response.status}`);
    const { providers, languageProviders } = await response.json();

    const panel = document.getElementById('step-interpreters');
    const list = document.getElementById('interpreters-list');
    const clearButton = document.getElementById('interpreters-clear');
    const filterBar = document.getElementById('interpreters-filter');
    const filterLabel = document.getElementById('interpreters-filter-label');
    const empty = document.getElementById('interpreters-empty');
    const status = document.getElementById('interpreters-status');

    // languages each interpreter covers, by provider id
    const coverage = new Map(providers.map((provider) => [provider.id, new Set()]));
    for (const { providerId, language } of languageProviders) coverage.get(providerId)?.add(language);

    const [glowView, reactiveUtils] = await Promise.all([
        view.whenLayerView(siteGlow),
        $arcgis.import('@arcgis/core/core/reactiveUtils.js')
    ]);
    let glowRequest = 0; // newest glow, so a slow filter cant fade in after a later pick
    let selectedId = null;
    let fadeFrame = null;
    let current = null; // active filter, { label, languages: Set } or null for the full list

    // how many of the filter's languages an interpreter covers
    const matches = (id) => [...current.languages].filter((language) => coverage.get(id)?.has(language)).length;

    // announce: tell screen readers how many are left, only for filter changes and not every redraw
    // full list in data order, or only the matching interpreters, the ones covering the most languages first
    function render({ announce = false } = {}) {
        let shown = providers.map((provider) => ({ provider, count: 0 }));
        if (current) {
            shown = shown
                .map(({ provider }) => ({ provider, count: matches(provider.id) }))
                .filter(({ count }) => count)
                .sort((a, b) => b.count - a.count); // sort is stable, so ties stay alphabetical
        }
        const total = current?.languages.size || 0;

        // counts only mean something when the pick has more than one language
        // the name selects the interpreter on the map, the icon beside it opens their site in a new tab
        list.innerHTML = String(html`${shown.map(({ provider, count }) => {
            const url = siteUrl(provider);
            return html`
            <li class="interpreter">
                <button type="button" data-id="${provider.id}" aria-pressed="${String(provider.id === selectedId)}">
                    <span class="interpreter-name">${provider.name}</span>
                    ${total > 1 ? html`<span class="interpreter-count">${languageText(coverageCount(count, total))}</span>` : ''}
                </button>
                ${url ? html`<a class="interpreter-site" href="${url}" target="_blank" rel="noopener noreferrer"
                    data-en-title="Visit website" data-es-title="Visitar sitio web">
                    ${EXTERNAL_ICON}
                    <span class="visually-hidden"><span class="en" lang="en">Visit the ${provider.name} website (opens in a new tab)</span><span class="es" lang="es">Visitar el sitio web de ${provider.name} (se abre en una pestaña nueva)</span></span>
                </a>` : ''}
            </li>`;
        })}`);
        applyLocalizedAttributes(list);
        list.scrollTop = 0;

        filterBar.hidden = !current;
        filterLabel.innerHTML = current ? String(languageText(current.label)) : '';
        empty.hidden = !current || shown.length > 0;
        empty.querySelectorAll('.interpreters-empty-label').forEach((label) => {
            label.innerHTML = current ? String(languageText(current.label)) : '';
        });
        if (announce) status.textContent = current ? textFor(listStatus(shown.length, current.label)) : '';
    }
    render();

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

        glowRequest += 1;
        cancelAnimationFrame(fadeFrame);
        siteGlow.opacity = 0;
        if (!selectedId) return;

        // while filtered, only the searched languages glow, so the map shows where they can help w/ what was searched
        const languages = [...coverage.get(id)]
            .filter((language) => !current || current.languages.has(language))
            .map(sqlText);
        glowView.filter = { where: `${FIELDS.language} IN (${languages.join(', ')})` };
        showGlowWhenFiltered(glowRequest);
    }

    // the layer view takes a moment to apply a new filter, fading in right away flashed the last pick's sites
    // wait a frame for the update to start, then for it to finish
    async function showGlowWhenFiltered(request) {
        await new Promise(requestAnimationFrame);
        await reactiveUtils.whenOnce(() => !glowView.updating);
        if (request === glowRequest) fadeInGlow();
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

    // label: what was picked, plain text or a localized() pair
    // languages: language names for the pick, none means no interpreters match and the empty message shows
    function filter({ label, languages }) {
        current = { label, languages: new Set([...languages].filter(Boolean)) };
        refresh();
    }

    // redraw the list and keep the selected interpreter's glow scoped to the new filter
    function refresh() {
        if (selectedId && current && !matches(selectedId)) selectedId = null;
        render({ announce: true });
        select(selectedId);
    }

    clearButton.addEventListener('click', () => clear({ focus: true }));

    // escape drops the selection
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && selectedId) clear({ focus: true });
    });

    return { clear: () => clear(), filter };
}
