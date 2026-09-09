import { MAPBOX_TOKEN, map } from './map.js';

// small shared ui bits: html templating and the search box

export function escape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// wraps an already-safe string so `html` leaves it alone
// String(fragment) gives back the markup
export function raw(value) {
    const markup = String(value ?? '');
    return { __html: markup, toString: () => markup };
}

// tagged template, escapes every interpolation unless its a raw()/html`` fragment
// arrays are joined so nested html`` calls can be mapped directly
export function html(strings, ...values) {
    const render = (value) => {
        if (Array.isArray(value)) return value.map(render).join('');
        if (value && typeof value === 'object' && '__html' in value) return value.__html;
        return escape(value);
    };
    return raw(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ''), ''));
}

// reads a design token off :root, eg cssVar('--surface')
export function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// search-js renders in a shadow root so page css cant reach it, map our tokens onto its theme api
function searchTheme() {
    return {
        variables: {
            fontFamily: cssVar('--font'),
            unit: '14px',
            padding: '0.6em',
            borderRadius: cssVar('--radius'),
            border: `1px solid ${cssVar('--border')}`,
            boxShadow: cssVar('--shadow'),
            colorBackground: cssVar('--surface'),
            colorBackgroundHover: 'rgb(25 34 29 / 6%)',
            colorBackgroundActive: 'rgb(25 34 29 / 12%)',
            colorText: cssVar('--text'),
            colorPrimary: cssVar('--text'),
            colorSecondary: cssVar('--text-muted'),
            fontWeightBold: '600',
            fontWeightSemibold: '500'
        },
        // josefin sans sits high on its baseline so centred text reads as too far up, nudge it down
        cssText: '.Input { padding-top: 0.2em; }'
    };
}

// mapbox search-js web component, script is deferred so wait for window load
export function mountSearch(selector = '#search') {
    const mount = () => {
        const container = document.querySelector(selector);
        const SearchBox = globalThis.mapboxsearch?.MapboxSearchBox || globalThis.MapboxSearchBox;
        if (!container || !SearchBox) return;

        const box = new SearchBox();
        box.accessToken = MAPBOX_TOKEN;
        box.theme = searchTheme();
        box.placeholder = 'Search locations';
        box.options = { language: 'en', proximity: map.getCenter().toArray() };
        box.componentOptions = { allowReverse: true, flipCoordinates: true };
        box.mapboxgl = mapboxgl;
        box.marker = true;
        container.append(box);
        box.bindMap(map);
    };

    if (document.readyState === 'complete') mount();
    else window.addEventListener('load', mount, { once: true });
}
