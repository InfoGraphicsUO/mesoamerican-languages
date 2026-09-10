import { startSearchBox } from './ui.js';

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
const RESULT_KEYS = { family: 'F', group: 'G', language: 'L', place: 'P' };
const normalize = (value) => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function appendHighlighted(parent, label, query) {
    const text = String(label ?? '');
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) { parent.append(text); return; }
    const originalCharacters = Array.from(text);
    const normalizedCharacters = [];
    originalCharacters.forEach((character, index) => {
        normalize(character).replace(/[^a-z0-9]/g, '').split('').forEach((normalizedCharacter) => {
            normalizedCharacters.push({ character: normalizedCharacter, index });
        });
    });
    const normalizedText = normalizedCharacters.map(({ character }) => character).join('');
    const ranges = [];
    terms.forEach((term) => {
        let position = normalizedText.indexOf(term);
        while (position !== -1) {
            const end = position + term.length - 1;
            ranges.push([normalizedCharacters[position].index, normalizedCharacters[end].index + 1]);
            position = normalizedText.indexOf(term, position + term.length);
        }
    });
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = ranges.reduce((out, range) => {
        const previous = out[out.length - 1];
        if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
        else out.push(range);
        return out;
    }, []);
    let cursor = 0;
    merged.forEach(([start, end]) => {
        if (start > cursor) parent.append(originalCharacters.slice(cursor, start).join(''));
        const mark = document.createElement('mark');
        mark.textContent = originalCharacters.slice(start, end).join('');
        parent.append(mark);
        cursor = end;
    });
    if (cursor < originalCharacters.length) parent.append(originalCharacters.slice(cursor).join(''));
}

// Rendered nodes stay in memory so result buttons only need a small numeric key.
// This avoids putting feature IDs and coordinate arrays into HTML attributes.
export function initSidePanel({ searchIndex, mapFocus } = {}) {
    const panel = document.getElementById(IDS.panel);
    const toggle = document.getElementById(IDS.toggle);
    const closeButton = document.getElementById(IDS.close);
    const input = document.getElementById(IDS.input);
    const results = document.getElementById(IDS.results);
    const searchToggle = document.getElementById(IDS.searchToggle);
    const searchRegion = document.getElementById(IDS.searchRegion);
    const locationToggle = document.getElementById(IDS.locationToggle);
    const locationRegion = document.getElementById(IDS.locationRegion);
    if (![panel, toggle, closeButton, input, results, searchToggle, searchRegion,
        locationToggle, locationRegion].every(Boolean)) return null;

    const rendered = [];
    let transitionId = 0;
    const clear = () => mapFocus?.clearHighlight?.();
    const duration = () => {
        const value = getComputedStyle(panel).getPropertyValue('--motion-duration').trim();
        const milliseconds = Number.parseFloat(value);
        return value.endsWith('ms') ? milliseconds : milliseconds * 1000;
    };

    const search = () => {
        try { return searchIndex?.search?.(input.value) || []; }
        catch (error) { console.error(error); return []; }
    };

    // Each node is a family, group, language, or place supplied by createSearchIndex.
    const render = () => {
        rendered.length = 0;
        const roots = search();
        const list = Array.isArray(roots) ? roots : [roots];
        const query = input.value.trim();
        const walk = (node, depth = 0, parent = results) => {
            if (!node) return;
            const resultId = rendered.push(node) - 1;
            const isPlace = node.kind === 'place';
            const countries = isPlace
                ? [...new Set(Array.isArray(node.countries) ? node.countries : node.country ? [node.country] : [])]
                    .filter(Boolean).join(', ')
                : '';
            const hasChildren = Array.isArray(node.children) && node.children.length > 0;
            const type = RESULT_TYPES.has(node.kind) ? node.kind : 'heading';
            const generic = isPlace ? 'place' : 'heading';
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `side-panel-row side-panel-${generic} side-panel-row--${type}`;
            row.dataset.resultId = String(resultId);
            row.style.setProperty('--result-depth', depth);
            row.setAttribute('aria-label', `${type}: ${node.label}${countries ? `, ${countries}` : ''}`);
            const resultKey = document.createElement('span');
            resultKey.className = 'side-panel-result-key';
            resultKey.textContent = RESULT_KEYS[type] || 'R';
            resultKey.setAttribute('aria-hidden', 'true');
            row.append(resultKey);
            const label = document.createElement('span');
            label.className = 'side-panel-row-label';
            appendHighlighted(label, node.label, query);
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
                (node.children || []).forEach((child) => walk(child, depth + 1, childGroup));
            }
        };
        results.replaceChildren();
        list.forEach((node) => walk(node));
        if (!list.length) {
            const empty = document.createElement('p');
            empty.className = 'side-panel-empty';
            empty.textContent = 'No matching languages or places.';
            results.append(empty);
        }
    };

    const setSection = (button, region, open) => {
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
        const closingTransition = ++transitionId;
        clear();
        panel.classList.remove('is-visible');
        panel.setAttribute('aria-hidden', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        setSection(searchToggle, searchRegion, false);
        setSection(locationToggle, locationRegion, false);
        setTimeout(() => {
            if (closingTransition !== transitionId || panel.classList.contains('is-visible')) return;
            document.querySelector('.panel')?.classList.remove('has-open-side-panel');
            panel.hidden = true;
            panel.inert = true;
            toggle.hidden = false;
            toggle.setAttribute('aria-label', 'Open map tools');
            toggle.focus();
        }, duration());
    };

    const open = () => {
        transitionId += 1;
        panel.hidden = false;
        panel.inert = false;
        toggle.hidden = true;
        panel.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-expanded', 'true');
        document.querySelector('.panel')?.classList.add('has-open-side-panel');
        setSection(searchToggle, searchRegion, false);
        setSection(locationToggle, locationRegion, false);
        requestAnimationFrame(() => panel.classList.add('is-visible'));
    };

    const togglePanel = () => panel.classList.contains('is-visible') ? close() : open();
    const toggleSection = (which) => {
        clear();
        const searchOpen = which === 'search' && !searchToggle.classList.contains('is-open');
        const locationOpen = which === 'location' && !locationToggle.classList.contains('is-open');
        setSection(searchToggle, searchRegion, searchOpen);
        setSection(locationToggle, locationRegion, locationOpen);
        if (searchOpen) {
            render();
            input.focus();
        }
    };

    toggle.addEventListener('click', togglePanel);
    closeButton.addEventListener('click', close);
    searchToggle.addEventListener('click', () => toggleSection('search'));
    locationToggle.addEventListener('click', () => toggleSection('location'));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && panel.classList.contains('is-visible')) close();
    });
    input.addEventListener('input', () => { clear(); render(); });

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
        if (node?.coordinates?.length) mapFocus?.frame?.(node.coordinates, panel);
    });

    render();
    startSearchBox('#location-search');
    return { open, close };
}
