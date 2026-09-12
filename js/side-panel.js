import { applyLocalizedAttributes, isLocalizedText, localized, textFor } from './language.js';
import { languageText, startSearchBox } from './ui.js';

// ids connect the controller to the matching buttons and regions in index.html
const IDS = {
    panel: 'side-panel',
    toggle: 'side-panel-toggle',
    close: 'side-panel-close',
    input: 'language-search-input',
    results: 'language-search-results',
    searchToggle: 'language-search-toggle',
    searchRegion: 'language-search-region',
    locationToggle: 'location-search-toggle',
    locationRegion: 'location-search-region'
};

const RESULT_TYPES = new Set(['family', 'group', 'language', 'place']);
const STICKY_RESULT_TYPES = new Set(['family', 'group', 'language']);
// language and place use different shortcut letters in Spanish
const RESULT_KEYS = {
    family: localized('F', 'F'),
    group: localized('G', 'G'),
    language: localized('L', 'I'),
    place: localized('P', 'L')
};
const RESULT_TYPE_LABELS = {
    family: localized('family', 'familia'),
    group: localized('group', 'grupo'),
    language: localized('language', 'idioma'),
    place: localized('place', 'lugar'),
    heading: localized('heading', 'encabezado')
};
const RESULT_FRAME_GUTTER = 48;
// normalize search text the same way the index does, so accents and punctuation dont block matches
const normalize = (value) => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function appendHighlighted(parent, label, query) {
    // add the label as text, wrapping matching characters in <mark>
    const text = String(label ?? '');
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) { parent.append(text); return; }
    const originalCharacters = Array.from(text);
    const normalizedCharacters = [];
    // keep the original position while making an accent-free copy to search
    originalCharacters.forEach((character, index) => {
        normalize(character).replace(/[^a-z0-9]/g, '').split('').forEach((normalizedCharacter) => {
            normalizedCharacters.push({ character: normalizedCharacter, index });
        });
    });
    const normalizedText = normalizedCharacters.map(({ character }) => character).join('');
    const ranges = [];
    // find every matching part, then convert it back to positions in the real label
    terms.forEach((term) => {
        let position = normalizedText.indexOf(term);
        while (position !== -1) {
            const end = position + term.length - 1;
            ranges.push([normalizedCharacters[position].index, normalizedCharacters[end].index + 1]);
            position = normalizedText.indexOf(term, position + term.length);
        }
    });
    ranges.sort((a, b) => a[0] - b[0]);
    // combine overlapping words so nested <mark> tags dont get built
    const merged = ranges.reduce((out, range) => {
        const previous = out[out.length - 1];
        if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
        else out.push(range);
        return out;
    }, []);
    let cursor = 0;
    // add normal text and highlighted text in their original order
    merged.forEach(([start, end]) => {
        if (start > cursor) parent.append(originalCharacters.slice(cursor, start).join(''));
        const mark = document.createElement('mark');
        mark.textContent = originalCharacters.slice(start, end).join('');
        parent.append(mark);
        cursor = end;
    });
    if (cursor < originalCharacters.length) parent.append(originalCharacters.slice(cursor).join(''));
}

function appendLocalizedHighlighted(parent, label, query) {
    // localized labels render both language spans, while plain labels use the normal path
    if (!isLocalizedText(label)) {
        appendHighlighted(parent, label, query);
        return;
    }

    for (const language of ['en', 'es']) {
        const span = document.createElement('span');
        span.className = language;
        span.lang = language;
        appendHighlighted(span, textFor(label, language), query);
        parent.append(span);
    }
}

// keep rendered nodes in memory so each result button only needs a small number
// this keeps feature ids and coordinate arrays out of the html attributes
export function initSidePanel({ searchIndex, mapFocus } = {}) {
    const panel = document.getElementById(IDS.panel);
    const legend = document.getElementById('legend');
    const app = document.querySelector('.app');
    const panelColumn = document.querySelector('.panel');
    const toggle = document.getElementById(IDS.toggle);
    const closeButton = document.getElementById(IDS.close);
    const input = document.getElementById(IDS.input);
    const results = document.getElementById(IDS.results);
    const searchToggle = document.getElementById(IDS.searchToggle);
    const searchRegion = document.getElementById(IDS.searchRegion);
    const locationToggle = document.getElementById(IDS.locationToggle);
    const locationRegion = document.getElementById(IDS.locationRegion);
    if (![panel, legend, toggle, closeButton, input, results, searchToggle, searchRegion,
        locationToggle, locationRegion].every(Boolean)) return null;

    const rendered = [];
    const stickyRows = [];
    const updateStickyOffsets = () => {
        // use the rendered header heights so wrapped names still form one clean sticky stack
        stickyRows.forEach(({ row, ancestors }) => {
            const top = ancestors.reduce((offset, ancestor) =>
                offset + ancestor.getBoundingClientRect().height, 0);
            row.style.setProperty('--sticky-top', `${top}px`);
        });
    };
    const stickyResizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(updateStickyOffsets)
        : null;
    let transitionId = 0;
    const clear = () => mapFocus?.clearHighlight?.();
    // css owns the animation length, js uses the same value before hiding elements
    const duration = () => {
        const value = getComputedStyle(panel).getPropertyValue('--motion-duration').trim();
        const milliseconds = Number.parseFloat(value);
        return value.endsWith('ms') ? milliseconds : milliseconds * 1000;
    };

    const search = () => {
        try { return searchIndex?.search?.(input.value) || []; }
        catch (error) { console.error(error); return []; }
    };

    // each node is a family, group, language, or place from createSearchIndex
    const render = () => {
        rendered.length = 0;
        stickyRows.length = 0;
        stickyResizeObserver?.disconnect();
        const roots = search();
        const list = Array.isArray(roots) ? roots : [roots];
        const query = input.value.trim();
        // walk the taxonomy and build one button for every visible node
        const walk = (node, depth = 0, parent = results, stickyAncestors = []) => {
            if (!node) return;
            const resultId = rendered.push(node) - 1;
            const isPlace = node.kind === 'place';
            // country context appears only on place rows
            const countries = isPlace
                ? [...new Set(Array.isArray(node.countries) ? node.countries : node.country ? [node.country] : [])]
                    .filter(Boolean).join(', ')
                : '';
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const type = RESULT_TYPES.has(node.kind) ? node.kind : 'heading';
            const generic = isPlace ? 'place' : 'heading';
            const displayLabel = node.displayLabel ?? node.label;
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `side-panel-row side-panel-${generic} side-panel-row--${type}`;
            row.dataset.resultId = String(resultId);
            row.style.setProperty('--result-depth', depth);
            const typeLabel = RESULT_TYPE_LABELS[type] || RESULT_TYPE_LABELS.heading;
            row.setAttribute('data-en-aria-label', `${textFor(typeLabel, 'en')}: ${textFor(displayLabel, 'en')}${countries ? `, ${countries}` : ''}`);
            row.setAttribute('data-es-aria-label', `${textFor(typeLabel, 'es')}: ${textFor(displayLabel, 'es')}${countries ? `, ${countries}` : ''}`);
            applyLocalizedAttributes(row);
            const nextStickyAncestors = STICKY_RESULT_TYPES.has(type)
                ? [...stickyAncestors, row]
                : stickyAncestors;
            if (STICKY_RESULT_TYPES.has(type)) stickyRows.push({ row, ancestors: stickyAncestors });
            // the small letter key lets users scan the result type quickly
            const resultKey = document.createElement('span');
            resultKey.className = 'side-panel-result-key';
            resultKey.innerHTML = String(languageText(RESULT_KEYS[type] || localized('R', 'R')));
            resultKey.setAttribute('aria-hidden', 'true');
            row.append(resultKey);
            const label = document.createElement('span');
            label.className = 'side-panel-row-label';
            appendLocalizedHighlighted(label, displayLabel, query);
            row.append(label);
            if (countries) {
                const metadata = document.createElement('span');
                metadata.className = 'side-panel-country';
                metadata.textContent = countries;
                row.append(metadata);
            }
            if (node.familyColor || node.color) row.style.setProperty('--family-color', node.familyColor || node.color);
            if (node.countryCode || node.countryShort) row.dataset.country = node.countryCode || node.countryShort;

            let childGroup;
            if (hasChildren) {
                // search results open their matching branch, the full browse tree starts closed
                const childId = `side-panel-children-${resultId}`;
                childGroup = document.createElement('div');
                childGroup.id = childId;
                childGroup.className = 'side-panel-children';
                childGroup.setAttribute('role', 'group');
                row.setAttribute('aria-controls', childId);
                const open = Boolean(query);
                row.setAttribute('aria-expanded', String(open));
                const chevron = document.createElement('i');
                chevron.className = 'side-panel-chevron fa-sharp fa-light fa-chevron-down';
                chevron.setAttribute('aria-hidden', 'true');
                row.append(chevron);
                childGroup.hidden = !open;
                childGroup.inert = !open;
                childGroup.setAttribute('aria-hidden', String(!open));
            }
            parent.append(row);
            if (childGroup) {
                parent.append(childGroup);
                (node.children || []).forEach((child) =>
                    walk(child, depth + 1, childGroup, nextStickyAncestors));
            }
        };
        results.replaceChildren();
        list.forEach((node) => walk(node));
        if (!list.length) {
            const empty = document.createElement('p');
            empty.className = 'side-panel-empty';
            empty.innerHTML = String(languageText(localized(
                'No matching languages or places.',
                'No hay lenguas ni lugares que coincidan.'
            )));
            results.append(empty);
        }
        updateStickyOffsets();
        stickyResizeObserver?.observe(results);
        stickyRows.forEach(({ row }) => stickyResizeObserver?.observe(row));
    };

    const setSection = (button, region, open) => {
        // keep button state, hidden state, and inert state in sync during the panel transition
        button.setAttribute('aria-expanded', String(open));
        region.setAttribute('aria-hidden', String(!open));
        region.inert = !open;
        button.classList.toggle('is-open', open);
        button.closest('.side-panel-section')?.classList.toggle('is-open', open);
        if (open) {
            region.hidden = false;
            requestAnimationFrame(() => region.classList.add('is-visible'));
        } else {
            region.classList.remove('is-visible');
            setTimeout(() => { if (!region.classList.contains('is-visible')) region.hidden = true; }, duration());
        }
    };

    const close = () => {
        // hide both side panels together, then return focus to the launcher
        const closingTransition = ++transitionId;
        clear();
        for (const sidebarPanel of [panel, legend]) {
            sidebarPanel.classList.remove('is-visible');
            sidebarPanel.setAttribute('aria-hidden', 'true');
            sidebarPanel.inert = true;
        }
        app?.classList.add('is-collapsing-side-panel');
        toggle.setAttribute('aria-expanded', 'false');
        setTimeout(() => {
            if (closingTransition !== transitionId || panel.classList.contains('is-visible')) return;
            panelColumn?.classList.remove('has-open-side-panel');
            app?.classList.remove('has-open-side-panel', 'is-collapsing-side-panel');
            panel.hidden = true;
            legend.hidden = true;
            toggle.hidden = false;
            applyLocalizedAttributes(toggle);
            toggle.focus();
        }, duration());
    };

    const open = () => {
        // show both side panels together and restore the default search section
        transitionId += 1;
        app?.classList.remove('is-collapsing-side-panel');
        for (const sidebarPanel of [panel, legend]) {
            sidebarPanel.hidden = false;
            sidebarPanel.inert = false;
            sidebarPanel.setAttribute('aria-hidden', 'false');
        }
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'true');
        panelColumn?.classList.add('has-open-side-panel');
        app?.classList.add('has-open-side-panel');
        // open the language browser first, so the sidebar never starts empty
        setSection(searchToggle, searchRegion, true);
        setSection(locationToggle, locationRegion, false);
        render();
        requestAnimationFrame(() => {
            panel.classList.add('is-visible');
            legend.classList.add('is-visible');
        });
    };

    const activateSection = (which) => {
        // these work like radio buttons: opening one always closes the other
        clear();
        const searchOpen = which === 'search';
        const locationOpen = which === 'location';
        setSection(searchToggle, searchRegion, searchOpen);
        setSection(locationToggle, locationRegion, locationOpen);
        if (searchOpen) {
            render();
            input.focus();
        }
    };

    toggle.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    searchToggle.addEventListener('click', () => activateSection('search'));
    locationToggle.addEventListener('click', () => activateSection('location'));
    // both visual panels share this controller, so they are always open or hidden together
    // one search section also stays active while the sidebar is open
    input.addEventListener('input', () => { clear(); render(); });

    // keep map highlights matched to whichever result the user is reading
    const focusResult = (event) => {
        const button = event.target.closest('[data-result-id]');
        const node = button && rendered[Number(button.dataset.resultId)];
        if (node) mapFocus?.highlight?.(node.featureIds || []);
    };
    results.addEventListener('pointerover', focusResult);
    results.addEventListener('focusin', focusResult);
    results.addEventListener('pointerout', (event) => {
        if (!event.relatedTarget?.closest?.('[data-result-id]')) clear();
    });
    results.addEventListener('focusout', (event) => {
        if (!results.contains(event.relatedTarget)) clear();
    });
    results.addEventListener('click', (event) => {
        // heading rows open their children, every row with coordinates can frame the map
        const button = event.target.closest('[data-result-id]');
        const node = button && rendered[Number(button.dataset.resultId)];
        if (button?.hasAttribute('aria-controls')) {
            const childGroup = document.getElementById(button.getAttribute('aria-controls'));
            const open = button.getAttribute('aria-expanded') !== 'true';
            button.setAttribute('aria-expanded', String(open));
            if (childGroup) {
                childGroup.hidden = !open;
                childGroup.inert = !open;
                childGroup.setAttribute('aria-hidden', String(!open));
            }
        }
        if (node?.coordinates?.length) {
            mapFocus?.frame?.(node.coordinates, panel, RESULT_FRAME_GUTTER);
        }
    });

    render();
    startSearchBox('#location-search');
    open();
    return { open, close };
}
