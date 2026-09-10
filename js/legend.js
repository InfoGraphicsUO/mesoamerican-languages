import { html } from './ui.js';

export function makeLegend(container, { title, sections }) {
    // in: container element, title, and legend sections
    // out: finished HTML for each section and list of respective items
    if (!container) return;

    // create each legend symbol for each legend element
    const legendSymbol = ({ icon, color }) => { // icon = image, color = colored square, nothing = empty
        if (icon) return html`<img class="legendSymbol" src="${icon}" alt="">`;
        if (color) return html`<span class="legendSymbol" style="background:${color}"></span>`;

        return html`<span class="legendSymbol"></span>`;
    };

    // build each section of the legend
    container.innerHTML = String(html`
        ${title ? html`<h1>${title}</h1>` : ''}
        ${sections.filter((section) => section.items.length).map((section) => html
            /* start legend section */
            `
            <section>
                <h2>${section.title}</h2>
                <ul>${section.items.map((item) => html`
                    <li>${legendSymbol(item)}<span>${item.label}</span></li>
                `)}</ul>
            </section>
            `
        /* end legend section */)}
    `);
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