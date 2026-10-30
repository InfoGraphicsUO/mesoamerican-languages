import { FIELDS } from './map-layers.js';
import { html } from './ui.js';

// lists the interpreters from data/interpreters.json in the panel in index.html
// clicking one highlights the sites of the languages they cover, clicking it again clears them

// sql text value, quotes in names like K'iche' have to be doubled
const sqlText = (value) => `'${value.replaceAll("'", "''")}'`;

export async function initInterpretersPanel(view, siteGlow) {
    const response = await fetch('data/interpreters.json');
    if (!response.ok) throw new Error(`Interpreter data returned ${response.status}`);
    const { providers, languageProviders } = await response.json();

    const list = document.getElementById('interpreters-list');
    list.innerHTML = String(html`${providers.map((provider) => html`
        <li><button type="button" data-id="${provider.id}" aria-pressed="false">${provider.name}</button></li>
    `)}`);

    const glowView = await view.whenLayerView(siteGlow);
    let selectedId = null;

    list.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button) return;

        const { id } = button.dataset;
        selectedId = id === selectedId ? null : id;

        list.querySelectorAll('button').forEach((item) => {
            item.setAttribute('aria-pressed', String(item.dataset.id === selectedId));
        });

        if (selectedId) {
            const languages = languageProviders
                .filter((link) => link.providerId === id)
                .map((link) => sqlText(link.language));
            glowView.filter = { where: `${FIELDS.language} IN (${languages.join(', ')})` };
        }
        siteGlow.visible = Boolean(selectedId);
    });
}
