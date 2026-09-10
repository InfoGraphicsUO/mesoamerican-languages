import { map } from './map.js';
import { html } from './ui.js';

// hover boxes for map features, layers supply the content via render(feature)
// exports detailList, hoverBox, hoverPopup, clickPopup

// creates the detailed info section of a popup
// rows example:
// [
//     ['Family', 'Mayan'], 
//     ['Country', 'Mexico']
// ]
export function detailList(rows) {

    // remove rows that dont have useful info
    const kept = rows.filter(
        ([, value]) =>  // ignore first item (label), store second item (value)
            value !== undefined && 
            value !== null && 
            value !== ''
    );

    
    if (!kept.length) return html``; // if every row empty, return empty html fragment and not list

    // return the detail list in html
    return html`
        <dl class="popup-details">
            ${kept.map(([label, value]) => html`
                <div>
                    <dt>${label}</dt>
                    <dd>${value}</dd>
                </div>
            `)}
        </dl>
    `;
}

// create complete popup content
// title: main heading
// subtitle: optional secondary text
// rows: optional detail rows
export function hoverBox({ title, subtitle, rows = [] }) {
    return html`
        <article class="popup">
            <h2>${title}</h2>
            ${subtitle ? html`<p class="popup-subtitle">${subtitle}</p>` : ''}
            ${detailList(rows)}
        </article>
    `;
}

// connect popup to a map layer
// layerId: id of map layer to watch
// render: func that converts map feature to popup html
// options: optional mapbox popup settings
export function hoverPopup(layerId, render, options = {}) {
    const popup = new mapboxgl.Popup({
        offset: 10,
        maxWidth: '320px',
        closeButton: false,
        closeOnClick: false,
        ...options
    });

    //listens for mouse move and display popup
    map.on('mousemove', layerId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        popup
            .setLngLat(feature.geometry.coordinates.slice())
            .setHTML(String(render(feature)))
            .addTo(map);
    });

    // adhysts style  of cursor when hovering
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });

    return popup;
}

// connect a click popup to a map layer
// layerId: layer to watch for clicks
// render: func that converts the click event and features to popup html
// options: optional Mapbox popup settings
export function clickPopup(layerId, render, options = {}) {
    const popup = new mapboxgl.Popup({
        offset: 10,
        maxWidth: '320px',
        closeButton: true,
        closeOnClick: true,
        ...options
    });

    map.on('click', layerId, (event) => {
        const content = render(event, event.features || []);
        if (!content) return;

        popup
            .setLngLat(event.lngLat)
            .setHTML(String(content))
            .addTo(map);
    });

    // Clickable areas are invisible, so the normal pointer cursor provides
    // the only map-level affordance that a suggestion is available here.
    map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

    return popup;
}
