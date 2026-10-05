import { mapElement } from './map.js';
import { html } from './ui.js';

// hover boxes for map features, with each layer supplying render(graphic)
// these replace the sdk's own popup, so layers using them need popupEnabled: false
// exports detailList, hoverBox, hoverPopup, clickPopup

// layouts where hovering isnt possible, these get click popups
const TOUCH_LAYOUT = '(max-width: 600px), (hover: none), (pointer: coarse)';
const isTouchLayout = () => window.matchMedia(TOUCH_LAYOUT).matches;

const OFFSET = 10; // gap between the feature and the popup tip, in px
const EDGE_PADDING = 8; // closest the popup gets to the edge of the map, in px

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

// builds one popup element that sits over the map and follows a map location
// closeButton: adds an x button, used by click popups
function createPopup(view, { closeButton = false } = {}) {
    const element = document.createElement('div');
    element.className = 'map-popup';
    element.hidden = true;

    const content = document.createElement('div');
    content.className = 'map-popup-content';

    const body = document.createElement('div');
    content.append(body);

    const tip = document.createElement('div');
    tip.className = 'map-popup-tip';

    element.append(content, tip);
    mapElement.parentElement.append(element); // sits beside the map, positioned over it by css

    let location = null; // map point the popup is attached to

    function position() {
        if (!location) return;

        const screen = view.toScreen(location);
        if (!screen) return;

        const width = element.offsetWidth;
        const height = element.offsetHeight;

        // sit above the feature, or flip below it when there isnt room
        const above = screen.y - OFFSET - height >= EDGE_PADDING;
        element.classList.toggle('map-popup-below', !above);

        // center on the feature, but keep the whole popup on the map
        const left = Math.min(
            Math.max(screen.x - width / 2, EDGE_PADDING),
            Math.max(view.width - width - EDGE_PADDING, EDGE_PADDING)
        );
        const top = above ? screen.y - OFFSET - height : screen.y + OFFSET;

        element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        element.style.setProperty('--tip-x', `${Math.round(screen.x - left)}px`); // tip keeps pointing at the feature
    }

    function show(point, markup) {
        location = point;
        body.innerHTML = String(markup);
        element.hidden = false;
        position();
    }

    function hide() {
        location = null;
        element.hidden = true;
    }

    if (closeButton) {
        element.classList.add('map-popup-interactive'); // hover popups ignore the mouse, click popups dont
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-popup-close';
        button.setAttribute('aria-label', 'Close popup');
        button.textContent = '×';
        button.addEventListener('click', hide);
        content.append(button);
    }

    // keep the popup on its feature while the map moves
    $arcgis.import('@arcgis/core/core/reactiveUtils.js').then((reactiveUtils) => {
        reactiveUtils.watch(() => [view.extent, view.size], position);
    });

    return { element, show, hide, isOpen: () => !element.hidden };
}

// find the top feature from one layer under a pointer or click event
async function featureAt(view, layer, event) {
    const { results } = await view.hitTest(event, { include: [layer] });
    return results.find((result) => result.type === 'graphic')?.graphic || null;
}

// connect popup to a map layer
// view: MapView from ready in js/map.js
// layer: map layer to watch
// render: func that converts a feature (graphic) to popup html
export function hoverPopup(view, layer, render) {
    const popup = createPopup(view);

    let shownId = null; // feature the popup is showing, so moving within one marker doesnt rebuild it
    let latest = null; // newest mouse position still waiting to be checked
    let checking = false;

    function clear() {
        shownId = null;
        popup.hide();
        view.container.style.cursor = '';
    }

    // only one check runs at a time, the mouse moves faster than the map can answer
    async function check() {
        checking = true;

        while (latest) {
            const event = latest;
            latest = null;

            const feature = await featureAt(view, layer, event).catch(() => null);
            if (latest) continue; // mouse already moved, check the newer position

            if (!feature || left) {
                clear();
                continue;
            }

            // show the pointer cursor so the hover area feels interactive
            view.container.style.cursor = 'pointer';

            const id = feature.getObjectId();
            if (id === shownId) continue;

            shownId = id;
            popup.show(feature.geometry, render(feature));
        }

        checking = false;
    }

    let left = false; // true once the mouse is off the map, so a late answer cant reopen the popup

    // listen for mouse movement and display the layer's popup
    view.on('pointer-move', (event) => {
        if (isTouchLayout() || event.pointerType !== 'mouse') return; // touches get the click popup
        left = false;
        latest = event;
        if (!checking) check();
    });

    view.container.addEventListener('pointerleave', () => {
        left = true;
        latest = null;
        clear();
    });

    return popup;
}

// connect a click popup to a map layer
// view: MapView from ready in js/map.js
// layer: map layer to watch for clicks
// render: func that converts a feature (graphic) to popup html
// options: touchOnly limits clicks to touch layouts
export function clickPopup(view, layer, render, options = {}) {
    const { touchOnly = false } = options;
    const popup = createPopup(view, { closeButton: true });

    view.on('click', async (event) => {
        if (touchOnly && !(event.native?.pointerType === 'touch' || isTouchLayout())) return;

        const feature = await featureAt(view, layer, event).catch(() => null);

        // clicking empty map closes the popup
        if (!feature) {
            popup.hide();
            return;
        }

        const content = render(feature);
        if (!content) return;

        popup.show(feature.geometry, content);
    });

    return popup;
}
