import { map } from './map.js';
import { applyMapboxLanguage } from './language.js';
import { html, languageText } from './ui.js';

// hover boxes for map features, with each layer supplying render(feature)
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
                    <dt>${languageText(label)}</dt>
                    <dd>${languageText(value)}</dd>
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
            <h2>${languageText(title)}</h2>
            ${subtitle ? html`<p class="popup-subtitle">${languageText(subtitle)}</p>` : ''}
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

    // listen for mouse movement and display the layer's popup
    map.on('mousemove', layerId, (event) => {
        if (window.matchMedia('(max-width: 600px), (hover: none), (pointer: coarse)').matches) return;
        const feature = event.features?.[0];
        if (!feature) return;
        popup
            .setLngLat(feature.geometry.coordinates.slice())
            .setHTML(String(render(feature)))
            .addTo(map);
    });

    // show the pointer cursor so the hover area feels interactive
    map.on('mouseenter', layerId, () => {
        if (!window.matchMedia('(max-width: 600px), (hover: none), (pointer: coarse)').matches) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });

    return popup;
}

// connect a click popup to a map layer
// layerId: layer to watch for clicks
// render: func that converts the click event and features to popup html
// options: Mapbox popup settings, touchOnly limits clicks to touch layouts
export function clickPopup(layerId, render, options = {}) {
    const { touchOnly = false, ...popupOptions } = options;
    const popup = new mapboxgl.Popup({
        offset: 10,
        maxWidth: '320px',
        closeButton: true,
        closeOnClick: true,
        ...popupOptions
    });

    map.on('click', layerId, (event) => {
        if (touchOnly && !(
            event.originalEvent?.pointerType === 'touch' ||
            event.originalEvent?.sourceCapabilities?.firesTouchEvents ||
            window.matchMedia('(max-width: 600px), (hover: none), (pointer: coarse)').matches
        )) return;

        const content = render(event, event.features || []);
        if (!content) return;

        popup
            .setLngLat(event.lngLat)
            .setHTML(String(content))
            .addTo(map);
        applyMapboxLanguage(popup.getElement());
    });

    // pointer hints for invisible clickable areas, hoverPopup handles site markers
    if (!touchOnly) {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    }

    return popup;
}
