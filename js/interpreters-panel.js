import { html } from './ui.js';

// lists the interpreters from data/interpreters.json in the panel in index.html

export async function initInterpretersPanel() {
    const response = await fetch('data/interpreters.json');
    if (!response.ok) throw new Error(`Interpreter data returned ${response.status}`);
    const { providers } = await response.json();

    const list = document.getElementById('interpreters-list');
    list.innerHTML = String(html`${providers.map((provider) => html`
        <li><button type="button" data-id="${provider.id}" aria-pressed="false">${provider.name}</button></li>
    `)}`);
}
