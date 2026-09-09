import { map } from './map.js';
import { html } from './ui.js';

// hover boxes for map features, layers supply the content via render(feature)

// rows: [[label, value]] with empty values dropped
export function detailList(rows) {
    const kept = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (!kept.length) return html``;
    return html`<dl class="popup-details">${kept.map(([label, value]) => html`
        <div><dt>${label}</dt><dd>${value}</dd></div>
    `)}</dl>`;
}

// title, optional subtitle, detail rows
export function hoverBox({ title, subtitle, rows = [] }) {
    return html`
        <article class="popup">
            <h2>${title}</h2>
            ${subtitle ? html`<p class="popup-subtitle">${subtitle}</p>` : ''}
            ${detailList(rows)}
        </article>
    `;
}

// one reusable popup that follows the pointer over `layerId`
// render(feature) returns an html`` fragment or string
export function hoverPopup(layerId, render, options = {}) {
    const popup = new mapboxgl.Popup({
        offset: 10,
        maxWidth: '320px',
        closeButton: false,
        closeOnClick: false,
        ...options
    });

    map.on('mousemove', layerId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        popup
            .setLngLat(feature.geometry.coordinates.slice())
            .setHTML(String(render(feature)))
            .addTo(map);
    });

    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });

    return popup;
}
