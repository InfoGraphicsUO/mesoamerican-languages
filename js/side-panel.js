import { applyLocalizedAttributes, isLocalizedText, localized, onLanguageChange, textFor, toggleLanguage } from './language.js';
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
export function initSidePanel({ searchIndex, mapFocus, interpreterView } = {}) {
    const panel = document.getElementById(IDS.panel);
    const interpreterShell = document.getElementById('interpreters-shell');
    const interpreterContainer = document.getElementById('interpreters-view');
    const findButton = document.getElementById('find-interpreters');
    const mobileFindButton = document.getElementById('find-interpreters-mobile');
    const interpreterClose = document.getElementById('interpreters-close');
    const interpreterBack = document.getElementById('interpreters-back');
    const interpreterTitle = document.getElementById('interpreters-title');
    const mobileInterpreterBack = document.getElementById('mobile-interpreters-back');
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
    const mobileMedia = window.matchMedia('(max-width: 600px)');
    const mobileHeader = panel.querySelector('.mobile-sheet-header');
    const grip = document.getElementById('mobile-sheet-grip');
    const expandButton = document.getElementById('mobile-sheet-expand');
    const minimizeButton = document.getElementById('mobile-sheet-minimize');
    const mobileLanguageButton = document.getElementById('mobile-language-toggle');
    if (![panel, interpreterShell, interpreterContainer, findButton, mobileFindButton, interpreterClose, interpreterBack, interpreterTitle, mobileInterpreterBack, toggle, closeButton, input, results, searchToggle, searchRegion,
        locationToggle, locationRegion, mobileHeader, grip, expandButton, minimizeButton, mobileLanguageButton].every(Boolean)) return null;

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
    let selectionFrameId = 0;
    let selectedFeatureIds = [];
    let mobileState = 'half';
    let currentContext = null;
    let interpretersOpen = false;
    let interpreterViewName = 'list';
    const markSelectedRow = (row) => {
        results.querySelectorAll('.side-panel-row.is-selected').forEach((selected) => {
            selected.classList.remove('is-selected');
            selected.removeAttribute('aria-current');
        });
        if (row) {
            row.classList.add('is-selected');
            row.setAttribute('aria-current', 'true');
        }
    };
    const clear = () => {
        selectedFeatureIds = [];
        mapFocus?.clearHighlight?.();
        markSelectedRow(null);
    };
    const restoreSelection = () => {
        if (selectedFeatureIds.length) mapFocus?.highlight?.(selectedFeatureIds);
        else mapFocus?.clearHighlight?.();
    };
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

    const syncRowSemantics = () => {
        for (const row of results.querySelectorAll('.side-panel-row[data-child-id]')) {
            const expand = row.parentElement.querySelector('.side-panel-row-expand');
            if (mobileMedia.matches) {
                row.removeAttribute('aria-controls');
                row.removeAttribute('aria-expanded');
                expand.hidden = false;
            } else {
                row.setAttribute('aria-controls', row.dataset.childId);
                row.setAttribute('aria-expanded', expand.getAttribute('aria-expanded'));
                expand.hidden = true;
            }
        }
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
            const rowShell = document.createElement('div');
            rowShell.className = 'side-panel-row-shell';
            rowShell.style.setProperty('--result-depth', depth);
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
                ? [...stickyAncestors, rowShell]
                : stickyAncestors;
            if (STICKY_RESULT_TYPES.has(type)) stickyRows.push({ row: rowShell, ancestors: stickyAncestors });
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
            if (node.familyColor || node.color) {
                row.style.setProperty('--family-color', node.familyColor || node.color);
                rowShell.style.setProperty('--family-color', node.familyColor || node.color);
            }
            if (node.countryCode || node.countryShort) row.dataset.country = node.countryCode || node.countryShort;

            let childGroup;
            if (hasChildren) {
                // search results open their matching branch, the full browse tree starts closed
                const childId = `side-panel-children-${resultId}`;
                childGroup = document.createElement('div');
                childGroup.id = childId;
                childGroup.className = 'side-panel-children';
                childGroup.setAttribute('role', 'group');
                row.dataset.childId = childId;
                const open = Boolean(query);
                const chevron = document.createElement('i');
                chevron.className = 'side-panel-chevron fa-sharp fa-light fa-chevron-down';
                chevron.setAttribute('aria-hidden', 'true');
                row.append(chevron);
                const expand = document.createElement('button');
                expand.type = 'button';
                expand.className = 'side-panel-row-expand';
                expand.dataset.resultId = String(resultId);
                expand.setAttribute('aria-controls', childId);
                expand.setAttribute('aria-expanded', String(open));
                expand.setAttribute('data-en-aria-label', `${open ? 'Collapse' : 'Expand'} ${textFor(displayLabel, 'en')}`);
                expand.setAttribute('data-es-aria-label', `${open ? 'Contraer' : 'Ampliar'} ${textFor(displayLabel, 'es')}`);
                applyLocalizedAttributes(expand);
                expand.innerHTML = '<i class="side-panel-chevron fa-sharp fa-light fa-chevron-down" aria-hidden="true"></i>';
                rowShell.append(expand);
                childGroup.hidden = !open;
                childGroup.inert = !open;
                childGroup.setAttribute('aria-hidden', String(!open));
            }
            rowShell.prepend(row);
            parent.append(rowShell);
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
        syncRowSemantics();
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

    const mobileSections = [...panel.querySelectorAll('.side-panel-section')];
    const setMobileControlLabel = (button, en, es) => {
        button.setAttribute('data-en-aria-label', en);
        button.setAttribute('data-es-aria-label', es);
        applyLocalizedAttributes(button);
    };
    const setMobileState = (nextState) => {
        if (!mobileMedia.matches) return;
        mobileState = nextState;
        panelColumn.dataset.mobileSheetState = nextState;
        const peeking = nextState === 'peek';
        mobileSections.forEach((section) => { section.inert = peeking; });
        grip.setAttribute('aria-expanded', String(!peeking));
        expandButton.setAttribute('aria-expanded', String(nextState === 'expanded'));
        expandButton.disabled = nextState === 'expanded';
        minimizeButton.disabled = peeking;
        setMobileControlLabel(grip,
            peeking ? 'Open Menu' : nextState === 'half' ? 'Expand Menu' : 'Reduce Menu',
            peeking ? 'Abrir menú' : nextState === 'half' ? 'Ampliar menú' : 'Reducir menú');
    };
    const updateMobileViewport = () => {
        const viewport = window.visualViewport;
        const height = viewport?.height || window.innerHeight;
        const bottomOffset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0));
        app?.style.setProperty('--mobile-viewport-height', `${height}px`);
        app?.style.setProperty('--mobile-viewport-bottom-offset', `${bottomOffset}px`);
        app?.classList.toggle('is-short-visual-viewport', height <= 500);
        app?.classList.toggle('has-mobile-keyboard', bottomOffset > 100);
    };

    const frameMobileSelection = (node) => {
        const requestId = ++selectionFrameId;
        const wasPeeking = mobileState === 'peek';
        selectedFeatureIds = node.featureIds || [];
        setMobileState('peek');
        const coordinates = node.coordinates;
        const panelForFrame = panelColumn;
        let framed = false;
        const frame = () => {
            if (framed) return;
            framed = true;
            panelForFrame.removeEventListener('transitionend', onTransitionEnd);
            if (requestId !== selectionFrameId) return;
            mapFocus?.frame?.(coordinates, panelForFrame, RESULT_FRAME_GUTTER);
            mapFocus?.highlight?.(selectedFeatureIds);
        };
        const onTransitionEnd = (event) => {
            if (event.target === panelForFrame && event.propertyName === 'height') frame();
        };
        panelForFrame.addEventListener('transitionend', onTransitionEnd);
        if (wasPeeking) requestAnimationFrame(frame);
        else window.setTimeout(frame, duration() + 50);
        document.querySelector('.mapboxgl-canvas')?.focus();
    };

    const close = () => {
        if (mobileMedia.matches) {
            setMobileState('peek');
            grip.focus();
            return;
        }
        // hide the menu, then return focus to the launcher
        const closingTransition = ++transitionId;
        clear();
        panel.classList.remove('is-visible');
        panel.setAttribute('aria-hidden', 'true');
        panel.inert = true;
        app?.classList.add('is-collapsing-side-panel');
        toggle.setAttribute('aria-expanded', 'false');
        setTimeout(() => {
            if (closingTransition !== transitionId || panel.classList.contains('is-visible')) return;
            panelColumn?.classList.remove('has-open-side-panel');
            app?.classList.remove('has-open-side-panel', 'is-collapsing-side-panel');
            panel.hidden = true;
            if (!mobileMedia.matches) findButton.hidden = true;
            toggle.hidden = false;
            applyLocalizedAttributes(toggle);
            toggle.focus();
        }, duration());
    };

    const open = () => {
        // reopen the language browser with its search section active
        transitionId += 1;
        app?.classList.remove('is-collapsing-side-panel');
        panel.hidden = false;
        panel.inert = false;
        panel.setAttribute('aria-hidden', 'false');
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'true');
        panelColumn?.classList.add('has-open-side-panel');
        app?.classList.add('has-open-side-panel');
        findButton.hidden = interpretersOpen;
        mobileFindButton.hidden = interpretersOpen;
        // open the language browser first, so the sidebar never starts empty
        setSection(searchToggle, searchRegion, true);
        setSection(locationToggle, locationRegion, !mobileMedia.matches);
        render();
        requestAnimationFrame(() => {
            panel.classList.add('is-visible');
        });
        if (mobileMedia.matches) setMobileState(interpretersOpen ? 'expanded' : 'half');
    };

    const activateSection = (which) => {
        if (!mobileMedia.matches) return;
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

    const setContext = (context, node = null) => {
        currentContext = context || null;
        findButton.disabled = !currentContext || !interpreterView;
        mobileFindButton.disabled = findButton.disabled;
        if (currentContext) interpreterView?.setContext?.(currentContext);
        if (node) {
            selectedFeatureIds = node.featureIds || [];
            mapFocus?.highlight?.(selectedFeatureIds);
            if (mobileMedia.matches && node.coordinates?.length) frameMobileSelection(node);
            else if (node.coordinates?.length) mapFocus?.frame?.(node.coordinates, panel, RESULT_FRAME_GUTTER);
        }
    };
    const setInterpreterState = (open, resetView = true) => {
        interpretersOpen = open;
        const mobile = mobileMedia.matches;
        panel.setAttribute('data-en-aria-label', mobile ? open ? 'Find interpreters' : 'Menu' : 'Explore the language map');
        panel.setAttribute('data-es-aria-label', mobile ? open ? 'Buscar intérpretes' : 'Menú' : 'Explorar el mapa de lenguas');
        applyLocalizedAttributes(panel);
        if (mobile && interpreterShell.parentElement !== panel) panel.append(interpreterShell);
        if (!mobile && interpreterShell.parentElement !== panelColumn) panelColumn.prepend(interpreterShell);
        panel.classList.toggle('is-interpreters-open', open);
        panelColumn.classList.toggle('is-interpreters-open', open);
        interpreterShell.hidden = !open;
        interpreterShell.inert = !open;
        interpreterShell.setAttribute('aria-hidden', String(!open));
        mobileInterpreterBack.hidden = !open;
        findButton.hidden = open;
        mobileFindButton.hidden = open;
        if (mobile) {
            setMobileState(open ? 'expanded' : 'half');
            grip.hidden = open;
            expandButton.hidden = open;
            minimizeButton.hidden = open;
            for (const section of mobileSections) section.inert = open;
            panel.querySelectorAll('.side-panel-header, .side-panel-section').forEach((item) => {
                item.hidden = open;
            });
            const title = mobileHeader.querySelector('.mobile-sheet-title');
            if (title) title.innerHTML = open
                ? interpreterViewName === 'contact' || interpreterViewName === 'detail'
                    ? '<span class="en" lang="en">Contact info</span><span class="es" lang="es">Información de contacto</span>'
                    : '<span class="en" lang="en">Find interpreters</span><span class="es" lang="es">Buscar intérpretes</span>'
                : '<span class="en" lang="en">Menu</span><span class="es" lang="es">Menú</span>';
            mobileInterpreterBack.setAttribute('data-en-aria-label', interpreterViewName === 'detail' ? 'Back to interpreter list' : 'Back to menu');
            mobileInterpreterBack.setAttribute('data-es-aria-label', interpreterViewName === 'detail' ? 'Volver a la lista de intérpretes' : 'Volver al menú');
            applyLocalizedAttributes(mobileInterpreterBack);
            applyLocalizedAttributes(panel);
            if (open && resetView) interpreterView?.showList?.();
        } else if (open) {
            grip.hidden = false;
            interpreterShell.classList.add('is-visible');
            if (resetView) interpreterView?.showList?.();
        } else {
            grip.hidden = false;
            interpreterShell.classList.remove('is-visible');
        }
        if (open && resetView) requestAnimationFrame(() => {
            interpreterView?.setContext?.(currentContext);
            (mobile ? mobileInterpreterBack : interpreterClose).focus();
        });
    };

    for (const button of [findButton, mobileFindButton]) {
        button.addEventListener('click', () => { if (currentContext) setInterpreterState(true); });
    }
    interpreterClose.addEventListener('click', () => { setInterpreterState(false); (panel.hidden ? toggle : findButton).focus(); });
    interpreterBack.addEventListener('click', () => interpreterView?.back?.());
    mobileInterpreterBack.addEventListener('click', () => {
        if (interpreterViewName === 'contact' || interpreterViewName === 'detail') {
            interpreterView?.back?.();
            return;
        }
        interpreterView?.back?.();
        setInterpreterState(false);
        mobileFindButton.focus();
    });

    toggle.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    searchToggle.addEventListener('click', () => activateSection('search'));
    locationToggle.addEventListener('click', () => activateSection('location'));
    const cycleGrip = () => setMobileState(mobileState === 'peek' ? 'half' : mobileState === 'half' ? 'expanded' : 'half');
    let suppressGripClick = false;
    grip.addEventListener('click', () => {
        if (suppressGripClick) { suppressGripClick = false; return; }
        cycleGrip();
    });
    mobileHeader.addEventListener('click', (event) => {
        if (suppressGripClick) return;
        if (mobileMedia.matches && mobileState === 'peek' && !event.target.closest('button')) setMobileState('half');
    });
    expandButton.addEventListener('click', () => { setMobileState('expanded'); grip.focus(); });
    minimizeButton.addEventListener('click', () => { setMobileState('peek'); grip.focus(); });
    mobileLanguageButton.addEventListener('click', toggleLanguage);
    onLanguageChange((language) => {
        const spanish = language === 'es';
        mobileLanguageButton.setAttribute('aria-checked', String(spanish));
        mobileLanguageButton.setAttribute('aria-label', spanish ? 'Modo español' : 'Spanish mode');
        mobileLanguageButton.title = spanish ? 'Cambiar a inglés' : 'Switch to Spanish';
    }, { immediate: true });

    const safeAreaBottom = () => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)';
        panel.append(probe);
        const inset = Number.parseFloat(getComputedStyle(probe).paddingBottom) || 0;
        probe.remove();
        return inset;
    };
    let drag = null;
    grip.addEventListener('pointerdown', (event) => {
        if (!mobileMedia.matches || event.button !== 0) return;
        drag = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: panelColumn.getBoundingClientRect().height,
            peekHeight: 72 + safeAreaBottom(),
            moved: false
        };
        grip.setPointerCapture(event.pointerId);
    });
    grip.addEventListener('pointermove', (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = event.clientY - drag.startY;
        if (Math.abs(delta) < 6 && !drag.moved) return;
        drag.moved = true;
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        const minHeight = Math.min(drag.peekHeight, viewportHeight - 56);
        const maxHeight = Math.max(minHeight, viewportHeight - (viewportHeight <= 500 ? 36 : 112));
        const nextHeight = Math.max(minHeight, Math.min(maxHeight, drag.startHeight - delta));
        panelColumn.classList.add('is-dragging');
        panelColumn.style.setProperty('--mobile-sheet-drag-height', `${nextHeight}px`);
        app?.style.setProperty('--mobile-sheet-live-height', `${nextHeight}px`);
    });
    const endGripDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const moved = drag.moved;
        const releasedHeight = panelColumn.getBoundingClientRect().height;
        panelColumn.classList.remove('is-dragging');
        panelColumn.style.removeProperty('--mobile-sheet-drag-height');
        app?.style.removeProperty('--mobile-sheet-live-height');
        if (event.type === 'pointercancel') setMobileState(mobileState);
        else if (moved) {
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            const heights = [
                { state: 'peek', height: Math.min(drag.peekHeight, viewportHeight - 56) },
                { state: 'half', height: Math.min(Math.max(viewportHeight * .5, 320), viewportHeight - 112) },
                { state: 'expanded', height: viewportHeight <= 500
                    ? viewportHeight - 36
                    : Math.min(viewportHeight * .88, viewportHeight - 112) }
            ];
            const nearest = heights.reduce((best, candidate) =>
                Math.abs(candidate.height - releasedHeight) < Math.abs(best.height - releasedHeight) ? candidate : best);
            setMobileState(nearest.state);
            suppressGripClick = true;
            requestAnimationFrame(() => { suppressGripClick = false; });
        }
        drag = null;
    };
    grip.addEventListener('pointerup', endGripDrag);
    grip.addEventListener('pointercancel', endGripDrag);
    panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && interpretersOpen) {
            event.preventDefault();
            if (interpreterViewName === 'contact' || interpreterViewName === 'detail') interpreterView?.back?.();
            else setInterpreterState(false);
            return;
        }
        if (mobileMedia.matches && event.key === 'Escape' && mobileState !== 'peek') {
            event.preventDefault();
            setMobileState('peek');
            grip.focus();
        }
    });
    interpreterShell.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !interpretersOpen) return;
        event.preventDefault();
        if (interpreterViewName === 'contact' || interpreterViewName === 'detail') interpreterView?.back?.();
        else setInterpreterState(false);
    });
    input.addEventListener('focus', () => setMobileState('expanded'));
    locationRegion.addEventListener('focusin', () => setMobileState('expanded'));
    document.getElementById('map')?.addEventListener('click', (event) => {
        if (mobileMedia.matches && !interpretersOpen && event.target.classList.contains('mapboxgl-canvas')) setMobileState('peek');
    });
    const syncMode = () => {
        updateMobileViewport();
        searchRegion.setAttribute('aria-labelledby', mobileMedia.matches ? 'language-search-toggle' : 'desktop-explore-label');
        locationRegion.setAttribute('aria-labelledby', mobileMedia.matches ? 'location-search-toggle' : 'desktop-location-label');
        setSection(searchToggle, searchRegion, true);
        setSection(locationToggle, locationRegion, !mobileMedia.matches);
        setInterpreterState(interpretersOpen, false);
        if (!mobileMedia.matches) {
            panel.querySelectorAll('.side-panel-header, .side-panel-section').forEach((item) => { item.hidden = false; });
            mobileInterpreterBack.hidden = true;
            expandButton.hidden = false;
            minimizeButton.hidden = false;
        }
        if (mobileMedia.matches) {
            if (panel.hidden || panel.inert || !panel.classList.contains('is-visible')) open();
            else setMobileState(interpretersOpen ? 'expanded' : 'half');
        } else {
            panelColumn.removeAttribute('data-mobile-sheet-state');
            mobileSections.forEach((section) => { section.inert = false; });
            if (panel.hidden) open();
        }
        syncRowSemantics();
    };
    mobileMedia.addEventListener('change', syncMode);
    window.addEventListener('resize', updateMobileViewport);
    window.visualViewport?.addEventListener('resize', updateMobileViewport);
    window.visualViewport?.addEventListener('scroll', updateMobileViewport);
    // keep the search results current while the menu is visible
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
        if (!event.relatedTarget?.closest?.('[data-result-id]')) restoreSelection();
    });
    results.addEventListener('focusout', (event) => {
        if (!results.contains(event.relatedTarget)) restoreSelection();
    });
    const toggleChildGroup = (row, node) => {
        const expand = row.parentElement.querySelector('.side-panel-row-expand');
        const childGroup = document.getElementById(row.dataset.childId);
        if (!expand || !childGroup) return;
        const open = expand.getAttribute('aria-expanded') !== 'true';
        expand.setAttribute('aria-expanded', String(open));
        if (!mobileMedia.matches) row.setAttribute('aria-expanded', String(open));
        const name = node.displayLabel ?? node.label;
        expand.setAttribute('data-en-aria-label', `${open ? 'Collapse' : 'Expand'} ${textFor(name, 'en')}`);
        expand.setAttribute('data-es-aria-label', `${open ? 'Contraer' : 'Ampliar'} ${textFor(name, 'es')}`);
        applyLocalizedAttributes(expand);
        childGroup.hidden = !open;
        childGroup.inert = !open;
        childGroup.setAttribute('aria-hidden', String(!open));
    };
    const selectMapPoint = (feature) => {
        const featureId = Number(feature?.id);
        if (!Number.isFinite(featureId)) return;
        const properties = feature.properties || {};
        if (mobileMedia.matches && interpretersOpen) setInterpreterState(false);
        const hadQuery = Boolean(input.value);
        input.value = '';
        if (panel.hidden || panel.inert) open();
        else if (hadQuery) render();
        if (mobileMedia.matches) {
            setSection(searchToggle, searchRegion, true);
            setSection(locationToggle, locationRegion, false);
            setMobileState('expanded');
        }

        const placeRow = [...results.querySelectorAll('.side-panel-row--place')].find((row) =>
            rendered[Number(row.dataset.resultId)]?.featureIds?.includes(featureId));
        if (placeRow) {
            const ancestors = [];
            let parent = placeRow.parentElement?.parentElement;
            while (parent && parent !== results) {
                if (parent.classList.contains('side-panel-children')) ancestors.push(parent);
                parent = parent.parentElement;
            }
            for (const group of ancestors.reverse()) {
                if (!group.hidden) continue;
                const ownerRow = group.previousElementSibling?.querySelector('.side-panel-row[data-result-id]');
                const ownerNode = ownerRow && rendered[Number(ownerRow.dataset.resultId)];
                if (ownerRow && ownerNode) toggleChildGroup(ownerRow, ownerNode);
            }
            markSelectedRow(placeRow);
            requestAnimationFrame(() => placeRow.scrollIntoView({ block: 'center', inline: 'nearest' }));
        }

        setContext({
            kind: 'place', family: properties.family || '', group: properties.group || '',
            language: properties.language || '', place: properties.finalname || properties.name || '',
            featureIds: [featureId]
        });
        selectedFeatureIds = [featureId];
        mapFocus?.highlight?.(selectedFeatureIds);
    };
    results.addEventListener('click', (event) => {
        const button = event.target.closest('[data-result-id]');
        const node = button && rendered[Number(button.dataset.resultId)];
        if (!button || !node) return;
        const row = button.classList.contains('side-panel-row-expand') ? button.previousElementSibling : button;
        if (button.classList.contains('side-panel-row-expand')) {
            toggleChildGroup(row, node);
            return;
        }
        const context = { kind: node.kind, [node.kind]: node.label };
        if (node.kind === 'place') context.featureIds = node.featureIds || [];
        let parent = row.parentElement;
        while (parent && parent !== results) {
            const ancestor = parent.previousElementSibling?.querySelector?.('.side-panel-row[data-result-id]');
            const ancestorNode = ancestor && rendered[Number(ancestor.dataset.resultId)];
            if (ancestorNode && ['family', 'group', 'language'].includes(ancestorNode.kind) && !context[ancestorNode.kind]) {
                context[ancestorNode.kind] = ancestorNode.label;
            }
            parent = parent.parentElement;
        }
        markSelectedRow(row);
        setContext(context, node);
        if (mobileMedia.matches) {
            if (!node.coordinates?.length && row.dataset.childId) toggleChildGroup(row, node);
            return;
        }
        if (row.dataset.childId) toggleChildGroup(row, node);
    });

    render();
    startSearchBox('#location-search').then((box) => {
        box?.addEventListener('retrieve', () => {
            if (mobileMedia.matches) setMobileState('peek');
        });
    });
    open();
    syncMode();
    const setInterpreterView = (view) => {
        interpreterViewName = view || interpreterView?.getView?.() || 'list';
        const detail = interpreterViewName === 'contact' || interpreterViewName === 'detail';
        interpreterBack.hidden = !detail;
        interpreterTitle.innerHTML = detail
            ? '<span class="en" lang="en">Contact info</span><span class="es" lang="es">Información de contacto</span>'
            : '<span class="en" lang="en">Find interpreters</span><span class="es" lang="es">Buscar intérpretes</span>';
        applyLocalizedAttributes(interpreterBack);
        if (mobileMedia.matches && interpretersOpen) {
            const title = mobileHeader.querySelector('.mobile-sheet-title');
            if (title) title.innerHTML = detail
                ? '<span class="en" lang="en">Contact info</span><span class="es" lang="es">Información de contacto</span>'
                : '<span class="en" lang="en">Find interpreters</span><span class="es" lang="es">Buscar intérpretes</span>';
            mobileInterpreterBack.setAttribute('data-en-aria-label', detail ? 'Back to interpreter list' : 'Back to menu');
            mobileInterpreterBack.setAttribute('data-es-aria-label', detail ? 'Volver a la lista de intérpretes' : 'Volver al menú');
            applyLocalizedAttributes(mobileInterpreterBack);
        }
        if (interpretersOpen) requestAnimationFrame(() => (mobileMedia.matches ? mobileInterpreterBack : detail ? interpreterBack : interpreterClose).focus());
    };
    return { open, close, setContext: (context) => setContext(context), selectMapPoint, setInterpreterView };
}
