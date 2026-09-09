import { html } from './ui.js';

// renders the legend panel from plain data so layers only describe their keys
// sections: [{ title, items: [{ label, icon?, color? }] }]
export function renderLegend(container, { title, sections }) {
    if (!container) return;

    const swatch = ({ icon, color }) => {
        if (icon) return html`<img class="swatch" src="${icon}" alt="">`;
        if (color) return html`<span class="swatch" style="background:${color}"></span>`;
        return html`<span class="swatch"></span>`;
    };

    container.innerHTML = String(html`
        ${title ? html`<h1>${title}</h1>` : ''}
        ${sections.filter((section) => section.items.length).map((section) => html`
            <section>
                <h2>${section.title}</h2>
                <ul>${section.items.map((item) => html`
                    <li>${swatch(item)}<span>${item.label}</span></li>
                `)}</ul>
            </section>
        `)}
    `);
}
