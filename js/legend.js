import { html } from './ui.js';

export function makeLegend(container, { title, sections, mapFocus } = {}) {
    // in: container element, title, and legend sections
    // out: finished HTML for each section and list of respective items
    if (!container) return;

    // create each legend symbol for each legend element
    const legendSymbol = ({ icon, color }) => { // icon = image, color = colored square, nothing = empty
        if (icon) return html`<img class="legendSymbol" src="${icon}" alt="">`;
        if (color) return html`<span class="legendSymbol" style="background:${color}"></span>`;

        return html`<span class="legendSymbol"></span>`;
    };

    const items = [];
    const itemButton = (item) => {
        const index = items.push(item) - 1;
        return html`<button class="legendItem" type="button" data-legend-item="${index}" aria-label="${item.label}">
            ${legendSymbol(item)}<span>${item.label}</span>
        </button>`;
    };

    // build each section of the legend
    container.innerHTML = String(html`
        ${title ? html`<h1>${title}</h1>` : ''}
        ${(sections || []).filter((section) => section.items?.length).map((section) => html
            /* start legend section */
            `
            <section>
                <h2>${section.title}</h2>
                <ul>${section.items.map((item) => html`
                    <li>${itemButton(item)}</li>
                `)}</ul>
            </section>
            `
        /* end legend section */)}
    `);

    // One delegated set of handlers keeps every legend row keyboard and pointer accessible.
    const focusItem = (button) => {
        const item = items[Number(button?.dataset.legendItem)];
        if (!item || !mapFocus) return;
        if (item.featureIds?.length) mapFocus.highlight(item.featureIds);
    };
    const clearFocus = () => mapFocus?.clearHighlight();
    container.addEventListener('mouseover', (event) => {
        const button = event.target.closest?.('.legendItem');
        if (button && container.contains(button)) focusItem(button);
    });
    container.addEventListener('mouseout', (event) => {
        if (!event.relatedTarget || !event.target.closest?.('.legendItem')
            || !event.relatedTarget.closest?.('.legendItem')) clearFocus();
    });
    container.addEventListener('focusin', (event) => focusItem(event.target.closest?.('.legendItem')));
    container.addEventListener('focusout', (event) => {
        if (!event.relatedTarget || !event.relatedTarget.closest?.('.legendItem')) clearFocus();
    });
    container.addEventListener('mouseleave', clearFocus);
    container.addEventListener('click', (event) => {
        const button = event.target.closest?.('.legendItem');
        const item = items[Number(button?.dataset.legendItem)];
        if (!button || !item || !mapFocus?.frame || !item.coordinates) return;
        mapFocus.frame(item.coordinates, document.querySelector('#side-panel'));
    });
}

/*
example of what above function would build

<section>
    <h2>Language families</h2>
    <ul>
        <li>
            <span class="legendSymbol"></span>
            <span>Mayan</span>
        </li>
    </ul>
</section>

*/
