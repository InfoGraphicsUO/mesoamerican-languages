// keeps the shared language state and copy that css alone cannot switch
const SUPPORTED_LANGUAGES = new Set(['en', 'es']);
const listeners = new Set();

let currentLanguage = 'en';

// keep both versions together so copy edits are easy to review
export function localized(en, es) {
    return { en: String(en ?? ''), es: String(es ?? '') };
}

export function isLocalizedText(value) {
    return Boolean(value && typeof value === 'object' && 'en' in value && 'es' in value);
}

export function textFor(value, language = currentLanguage) {
    if (!isLocalizedText(value)) return String(value ?? '');
    return String(value[language] ?? value.en ?? value.es ?? '');
}

export const FAMILY_LABELS = {
    Mayan: localized('Mayan', 'Maya'),
    Otomanguean: localized('Otomanguean', 'Otomangue'),
    'Purépecha': localized('Purépecha', 'Purépecha'),
    'Sign Language': localized('Sign Language', 'Lengua de señas'),
    'Uto-Aztecan': localized('Uto-Aztecan', 'Yutoazteca'),
    Unclassified: localized('Unclassified', 'Sin clasificar')
};

export const COUNTRY_LABELS = {
    Belize: localized('Belize', 'Belice'),
    'Costa Rica': localized('Costa Rica', 'Costa Rica'),
    'El Salvador': localized('El Salvador', 'El Salvador'),
    Guatemala: localized('Guatemala', 'Guatemala'),
    Honduras: localized('Honduras', 'Honduras'),
    Mexico: localized('Mexico', 'México'),
    Nicaragua: localized('Nicaragua', 'Nicaragua'),
    Panama: localized('Panama', 'Panamá'),
    'United States': localized('United States', 'Estados Unidos')
};

export function localizedLookup(value, labels) {
    return labels?.[value] || value;
}

// return the language every generated label should use right now
export function getLanguage() {
    return currentLanguage;
}

function elementsMatching(root, selector) {
    const matches = [];
    if (root?.matches?.(selector)) matches.push(root);
    if (root?.querySelectorAll) matches.push(...root.querySelectorAll(selector));
    return matches;
}

// attributes and document-only text cant use .en/.es spans, so paired data attributes hold both translations
export function applyLocalizedAttributes(root = globalThis.document) {
    if (!root) return;

    const language = getLanguage();
    const attributes = [
        ['aria-label', 'data-en-aria-label', 'data-es-aria-label'],
        ['title', 'data-en-title', 'data-es-title'],
        ['placeholder', 'data-en-placeholder', 'data-es-placeholder']
    ];

    for (const [attribute, enAttribute, esAttribute] of attributes) {
        for (const element of elementsMatching(root, `[${enAttribute}][${esAttribute}]`)) {
            element.setAttribute(attribute, element.getAttribute(language === 'es' ? esAttribute : enAttribute));
        }
    }

    for (const element of elementsMatching(root, '[data-en-text][data-es-text]')) {
        element.textContent = element.getAttribute(language === 'es' ? 'data-es-text' : 'data-en-text');
    }
}

// mapbox creates these controls outside our templates, so add paired attributes after creation
export function applyMapboxLanguage(root = globalThis.document) {
    if (!root) return;

    const controls = [
        ['.mapboxgl-ctrl-zoom-in', localized('Zoom in', 'Acercar')],
        ['.mapboxgl-ctrl-zoom-out', localized('Zoom out', 'Alejar')],
        ['.mapboxgl-popup-close-button', localized('Close popup', 'Cerrar ventana emergente')]
    ];

    for (const [selector, copy] of controls) {
        for (const element of elementsMatching(root, selector)) {
            element.setAttribute('data-en-aria-label', copy.en);
            element.setAttribute('data-es-aria-label', copy.es);
            element.setAttribute('data-en-title', copy.en);
            element.setAttribute('data-es-title', copy.es);
        }
    }

    applyLocalizedAttributes(root);
}

export function setLanguage(language) {
    // update root classes first so all side-by-side .en/.es copy changes together
    const nextLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en'; // unknown values fall back to English
    const changed = nextLanguage !== currentLanguage;
    currentLanguage = nextLanguage;

    const root = globalThis.document?.documentElement;
    if (root) {
        root.classList.toggle('lang-en', currentLanguage === 'en');
        root.classList.toggle('lang-es', currentLanguage === 'es');
        root.lang = currentLanguage;
        applyLocalizedAttributes(globalThis.document);
        applyMapboxLanguage(globalThis.document);
    }

    if (changed) {
        // notify search, side-panel, and other listeners after the page copy updates
        for (const listener of listeners) listener(currentLanguage);
    }

    return currentLanguage;
}

export function toggleLanguage() {
    return setLanguage(currentLanguage === 'en' ? 'es' : 'en');
}

// subscribers update generated copy that cannot change thru css alone
export function onLanguageChange(listener, { immediate = false } = {}) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (immediate) listener(currentLanguage);
    return () => listeners.delete(listener);
}

// Mapbox controls use onAdd/onRemove so the map can place and clean them up
class LanguageControl {
    onAdd() {
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group language-control';

        this.button = document.createElement('button');
        this.button.className = 'language-toggle';
        this.button.type = 'button';
        this.button.setAttribute('role', 'switch');

        const english = document.createElement('span');
        english.className = 'language-option language-option-en';
        english.textContent = 'English';

        const spanish = document.createElement('span');
        spanish.className = 'language-option language-option-es';
        spanish.textContent = 'Español';

        this.button.append(english, spanish);
        this.button.addEventListener('click', toggleLanguage);
        this.container.append(this.button);

        const update = (language) => {
            const spanishMode = language === 'es';
            this.button.setAttribute('aria-checked', String(spanishMode));
            this.button.setAttribute('aria-label', spanishMode ? 'Modo español' : 'Spanish mode');
            this.button.title = spanishMode ? 'Cambiar a inglés' : 'Switch to Spanish';
        };
        this.unsubscribe = onLanguageChange(update, { immediate: true });

        return this.container;
    }

    onRemove() {
        this.unsubscribe?.();
        this.container?.remove();
    }
}

export function initLanguageControl(map, position = 'top-left') {
    if (!map?.addControl) return null;
    const control = new LanguageControl(); // one mapbox control toggles the shared language state
    map.addControl(control, position);
    applyMapboxLanguage(globalThis.document);
    return control;
}
