// keeps the shared english/spanish state and the copy that css alone cant switch
// static copy sits side by side in .en/.es spans, the class on <html> decides which one shows
// attributes (aria-label, placeholder, title) hold both versions in data-en-*/data-es-* pairs
// exports localized, isLocalizedText, textFor, localizedLookup, localizedPlaceName, FAMILY_LABELS, GROUP_LABELS, COUNTRY_LABELS,
// getLanguage, applyLocalizedAttributes, setLanguage, toggleLanguage, onLanguageChange, initLanguageSwitch

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

// one language's text from a localized pair, plain strings come back as they are
export function textFor(value, language = currentLanguage) {
    if (!isLocalizedText(value)) return String(value ?? '');
    return String(value[language] ?? value.en ?? value.es ?? '');
}

// translated label for a data value, or the value itself when there's no translation
export function localizedLookup(value, labels) {
    return labels?.[value] || value;
}

// language names and place names stay as recorded, only the classification and countries get translated
export const FAMILY_LABELS = {
    Mayan: localized('Mayan', 'Maya'),
    Otomanguean: localized('Otomanguean', 'Otomangue'),
    'Purépecha': localized('Purépecha', 'Purépecha'),
    'Sign Language': localized('Sign Language', 'Lengua de señas'),
    'Uto-Aztecan': localized('Uto-Aztecan', 'Yutoazteca'),
    Unclassified: localized('Unclassified', 'Sin clasificar')
};

export const GROUP_LABELS = {
    Chinantec: localized('Chinantec', 'Chinanteco'),
    Mixtec: localized('Mixtec', 'Mixteco'),
    Nahuan: localized('Nahuan', 'Nahua'),
    Tarahumara: localized('Tarahumara', 'Tarahumara'),
    Triqui: localized('Triqui', 'Triqui'),
    Zapotec: localized('Zapotec', 'Zapoteco'),
    ...FAMILY_LABELS // Mayan, Purépecha, and Sign Language groups repeat the family name
};

export const COUNTRY_LABELS = {
    Belize: localized('Belize', 'Belice'),
    'El Salvador': localized('El Salvador', 'El Salvador'),
    Guatemala: localized('Guatemala', 'Guatemala'),
    Honduras: localized('Honduras', 'Honduras'),
    Mexico: localized('Mexico', 'México'),
    'United States': localized('United States', 'Estados Unidos')
};

// place and area names from the data are local names, but some carry an english suffix
// 'Huehuetenango Department' reads 'Departamento de Huehuetenango' in spanish
const PLACE_SUFFIXES = [
    [' Municipality', 'Municipio de '],
    [' Department', 'Departamento de '],
    [' County', 'Condado de ']
];

// returns a localized() pair when the name has a suffix to translate, otherwise the name as it is
export function localizedPlaceName(name) {
    const text = String(name ?? '').trim();
    for (const [suffix, prefix] of PLACE_SUFFIXES) {
        if (text.endsWith(suffix)) return localized(text, prefix + text.slice(0, -suffix.length));
    }
    return text;
}

// the language every generated label should use right now
export function getLanguage() {
    return currentLanguage;
}

function elementsMatching(root, selector) {
    const matches = [];
    if (root?.matches?.(selector)) matches.push(root);
    if (root?.querySelectorAll) matches.push(...root.querySelectorAll(selector));
    return matches;
}

// attributes and document-only text like <title> cant use .en/.es spans, so paired data attributes hold both
export function applyLocalizedAttributes(root = document) {
    const language = getLanguage();
    const attributes = ['aria-label', 'title', 'placeholder'];

    for (const attribute of attributes) {
        for (const element of elementsMatching(root, `[data-en-${attribute}][data-es-${attribute}]`)) {
            element.setAttribute(attribute, element.getAttribute(`data-${language}-${attribute}`));
        }
    }

    for (const element of elementsMatching(root, '[data-en-text][data-es-text]')) {
        element.textContent = element.getAttribute(`data-${language}-text`);
    }
}

// the sdk's own controls (zoom, home, attribution) come w/ their own translations
// intl.setLocale switches them, the import is shared so this only loads once
const sdkIntl = $arcgis.import('@arcgis/core/intl.js');

export function setLanguage(language) {
    const nextLanguage = SUPPORTED_LANGUAGES.has(language) ? language : 'en'; // unknown values fall back to english
    const changed = nextLanguage !== currentLanguage;
    currentLanguage = nextLanguage;

    // update the root class first so all side by side .en/.es copy changes together
    const root = document.documentElement;
    root.classList.toggle('lang-en', currentLanguage === 'en');
    root.classList.toggle('lang-es', currentLanguage === 'es');
    root.lang = currentLanguage;
    applyLocalizedAttributes(document);

    sdkIntl.then((intl) => intl.setLocale(currentLanguage)).catch((error) => {
        console.error('Unable to switch the map controls language:', error);
    });

    // tell search and other listeners after the page copy updates
    if (changed) {
        for (const listener of listeners) listener(currentLanguage);
    }

    return currentLanguage;
}

export function toggleLanguage() {
    return setLanguage(currentLanguage === 'en' ? 'es' : 'en');
}

// subscribers update generated copy that cant change thru css alone
// returns a func that unsubscribes
export function onLanguageChange(listener, { immediate = false } = {}) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    if (immediate) listener(currentLanguage);
    return () => listeners.delete(listener);
}

// one switch w/ both languages always showing, the current one filled in
// button: the role="switch" button in index.html, checked means spanish
export function initLanguageSwitch(button) {
    if (!button) return;
    button.addEventListener('click', toggleLanguage);
    onLanguageChange((language) => {
        button.setAttribute('aria-checked', String(language === 'es'));
    }, { immediate: true });
}
