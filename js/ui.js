import { MAPBOX_TOKEN, map } from './map.js';
import { getLanguage, isLocalizedText, localized, onLanguageChange } from './language.js';

// shared ui tools for safe html, css values, and map search
// exports escape, raw, html, cssVar, startSearchBox

// turn any value into safe text before it gets added to html
// null/undefined = empty string
export function escape(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;'); // replace chars that browser might read as markup
}

// mark a string as safe html so html`` leaves it alone
// String(fragment) still gives back the finished markup
export function raw(value) {
    const markup = String(value ?? '');
    return { __html: markup, toString: () => markup };
}

// tagged template func, regular values get escaped before going into html
// raw()/html`` fragments and lists can be nested w/o getting escaped again
export function html(strings, ...values) {
    const render = (value) => {
        if (Array.isArray(value)) return value.map(render).join(''); // render list items and combine into one string
        if (value && typeof value === 'object' && '__html' in value) return value.__html; // already safe, dont escape twice
        return escape(value); // anything else becomes safe text
    };

    // combine template parts w/ rendered values and return another safe fragment
    return raw(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ''), ''));
}

// return both translations; css shows one span based on the root html language class
export function languageText(value) {
    if (!isLocalizedText(value)) return html`${value}`;
    return html`<span class="en" lang="en">${value.en}</span><span class="es" lang="es">${value.es}</span>`;
}

// get one css setting from :root
// name example: '--surface'
export function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// search-js lives in a shadow root, so regular site css cant style it
// map our css settings into its theme api
function searchTheme() {
    return {
        variables: {
            fontFamily: cssVar('--font'),
            unit: '14px',
            padding: '0.6em',
            borderRadius: cssVar('--radius'),
            border: `1px solid ${cssVar('--border')}`,
            boxShadow: 'none',
            colorBackground: cssVar('--surface'),
            colorBackgroundHover: 'rgb(25 34 29 / 6%)',
            colorBackgroundActive: 'rgb(25 34 29 / 12%)',
            colorText: cssVar('--text'),
            colorPrimary: cssVar('--text'),
            colorSecondary: cssVar('--text-muted'),
            fontWeightBold: '600',
            fontWeightSemibold: '500'
        },
        // josefin sans sits high, move input text down so it looks centered
        cssText: '.Input { padding-top: 0.2em; }'
    };
}

// create the mapbox search box and connect it to our map
// selector: element where search box gets added
const searchMounts = new Map();
export function startSearchBox(selector = '#location-search') {
    if (searchMounts.has(selector)) return searchMounts.get(selector);
    const promise = new Promise((resolve) => {
        const mount = () => {
            // find where to add search and whichever global name search-js supplied
            const container = document.querySelector(selector); // search box container in page html
            const SearchBox = globalThis.mapboxsearch?.MapboxSearchBox || globalThis.MapboxSearchBox; // fallback for other build

            if (!container || !SearchBox) {
                if (container) container.innerHTML = String(languageText(localized(
                    'Location search unavailable',
                    'La búsqueda de ubicaciones no está disponible'
                )));
                resolve(null);
                return;
            }
            if (container.querySelector('mapbox-search-box')) {
                resolve(container.querySelector('mapbox-search-box'));
                return;
            }

            // build search box and keep its language/proximity options current
            const box = new SearchBox();
            box.accessToken = MAPBOX_TOKEN;
            box.theme = searchTheme();
            const updateLanguage = (language = getLanguage()) => {
                box.placeholder = language === 'es' ? 'Buscar ubicaciones' : 'Search locations';
                box.options = {
                    ...(box.options || {}),
                    language,
                    proximity: map.getCenter().toArray()
                };
            };
            updateLanguage();
            box.componentOptions = { allowReverse: true, flipCoordinates: true }; // allow coordinate search in either order
            box.mapboxgl = mapboxgl; // give search box our mapbox library
            box.marker = true; // show marker when result gets picked

            container.append(box); // display finished search box
            box.bindMap(map); // move our map when user picks a result
            onLanguageChange(updateLanguage);
            resolve(box);
        };

    // deferred script is ready after window load, or run now if page already finished
        if (document.readyState === 'complete') mount();
        else window.addEventListener('load', mount, { once: true });
    });
    searchMounts.set(selector, promise);
    return promise;
}
