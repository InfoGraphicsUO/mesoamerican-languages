import { getLanguage, onLanguageChange } from './language.js';

const COPY = {
    none: ['No interpreters found for this selection.', 'No se encontraron intérpretes para esta selección.'],
    error: ['Interpreter information is unavailable.', 'La información de intérpretes no está disponible.'],
    type: ['Service type', 'Tipo de servicio'], relevance: ['Oregon relevance', 'Relevancia en Oregón'],
    published: ['Languages published', 'Idiomas publicados'], source: ['Source', 'Fuente'], request: ['Request', 'Solicitar'],
    phone: ['Phone', 'Teléfono'], email: ['Email', 'Correo electrónico']
};
const ENUMS = {
    type: {
        'Interpretation service': 'Servicio de interpretación',
        'Other - program/support/referral': 'Otro: programa, apoyo o referencia'
    },
    relevance: {
        'Oregon referral resource': 'Recurso de referencia de Oregón',
        'Remote option for Oregon': 'Opción remota para Oregón',
        'Direct Oregon provider': 'Proveedor directo en Oregón',
        'Remote lead for Oregon': 'Contacto remoto para Oregón',
        'Referral/remote lead for Oregon': 'Referencia o contacto remoto para Oregón',
        'National referral directory': 'Directorio nacional de referencias',
        'Direct Oregon healthcare pathway': 'Acceso directo a servicios de salud en Oregón',
        'Direct Oregon court pathway': 'Acceso directo a servicios judiciales en Oregón'
    }
};
const label = (key) => COPY[key][getLanguage() === 'es' ? 1 : 0];
const enumText = (key, value) => getLanguage() === 'es' ? ENUMS[key]?.[value] || value : value;
const usableUrl = (value) => {
    try { const url = new URL(String(value || '')); return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : ''; }
    catch { return ''; }
};
const normalize = (value) => String(value ?? '').trim();
const tier = (provider) => {
    const relevance = normalize(provider.oregonRelevance).toLowerCase();
    // remote rows also mention Oregon, so check them before the referral tier
    if (/direct/.test(relevance)) return 0;
    if (/remote|out.of.state|national/.test(relevance)) return 2;
    if (/oregon/.test(relevance)) return 1;
    return 3;
};
const sortedProviders = (providers) => [...providers].sort((a, b) => tier(a) - tier(b) || normalize(a.name).localeCompare(normalize(b.name)));

function findPath(tree, context = {}) {
    let result = null;
    const visit = (nodes, path = []) => {
        for (const node of nodes || []) {
            const next = [...path, node];
            const family = next.find((item) => item.kind === 'family')?.label;
            const group = next.find((item) => item.kind === 'group')?.label;
            // the search tree skips group headings that repeat their family name
            const scoped = (!context.family || context.family === family) &&
                (!context.group || context.group === group || (!group && context.group === family));
            if (scoped && context.kind === 'place' && node.kind === 'place' &&
                (!context.language || next.some((item) => item.kind === 'language' && item.label === context.language)) &&
                (node.label === context.place || node.featureIds?.some((id) => context.featureIds?.includes(id)))) result ||= next;
            if (scoped && context.kind !== 'place' && node.kind === context.kind && node.label === context[context.kind]) result ||= next;
            visit(node.children, next);
        }
    };
    visit(tree);
    return result;
}

export function createInterpreterView({ container, snapshot, taxonomy, onViewChange, error } = {}) {
    let context = null;
    let view = 'list';
    let selectedProvider = null;
    const languageLinks = Array.isArray(snapshot?.languageProviders) ? snapshot.languageProviders : [];
    const providerById = new Map((snapshot?.providers || []).map((provider) => [String(provider.id), provider]));
    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = String(text);
        return node;
    };
    const status = (message) => {
        const node = element('p', 'interpreter-status', message);
        node.setAttribute('role', 'status');
        return node;
    };
    const setView = (next) => { if (view !== next) { view = next; onViewChange?.(view); } };
    const matchingProviders = (language) => {
        // workbook links supply matches while the map tree owns their hierarchy
        const ids = new Set(languageLinks.filter((link) => link.language === language).map((link) => String(link.providerId)));
        return sortedProviders([...ids].map((id) => providerById.get(id)).filter(Boolean));
    };
    const indent = (node, depth) => {
        node.style.setProperty('--interpreter-indent', `${depth * 0.8}rem`);
        return node;
    };
    const providerButton = (provider, language, depth = 0) => {
        const button = element('button', 'interpreter-provider', normalize(provider.name));
        const languageNode = findPath(taxonomy, { kind: 'language', language })?.at(-1);
        if (languageNode?.familyColor) button.style.setProperty('--interpreter-family-color', languageNode.familyColor);
        button.type = 'button';
        button.addEventListener('click', () => { selectedProvider = provider; renderDetail(); });
        return indent(button, depth);
    };
    const renderProviderList = (parent, languages, depth = 0) => {
        let count = 0;
        for (const language of languages) {
            const providers = matchingProviders(language);
            if (!providers.length) continue;
            count += providers.length;
            const heading = element('h3', 'interpreter-language', language);
            const languageNode = findPath(taxonomy, { kind: 'language', language })?.at(-1);
            if (languageNode?.familyColor) heading.style.setProperty('--interpreter-family-color', languageNode.familyColor);
            parent.append(indent(heading, depth));
            for (const provider of providers) parent.append(providerButton(provider, language, depth + 1));
        }
        return count;
    };
    const renderList = () => {
        setView('list');
        container.replaceChildren();
        if (error || !snapshot) { container.append(status(label('error'))); return; }
        const path = findPath(taxonomy, context || {});
        const familyNames = context?.families?.length ? context.families : path?.filter((node) => node.kind === 'family').map((node) => node.label) || [];
        const familyNodes = (taxonomy || []).filter((node) => familyNames.includes(node.label));
        let matchCount = 0;
        if (context?.kind === 'family') {
            const ambiguous = familyNodes.length > 1;
            for (const family of familyNodes) {
                const depth = ambiguous ? 1 : 0;
                if (ambiguous) {
                    const heading = element('h2', 'interpreter-family', family.displayLabel || family.label);
                    if (family.familyColor) heading.style.setProperty('--interpreter-family-color', family.familyColor);
                    container.append(heading);
                }
                for (const child of family.children || []) {
                    if (child.kind === 'language') {
                        if (!matchingProviders(child.label).length) continue;
                        matchCount += renderProviderList(container, [child.label], depth);
                        continue;
                    }
                    if (child.kind !== 'group') continue;
                    const languages = (child.children || []).filter((node) => node.kind === 'language' && matchingProviders(node.label).length);
                    if (!languages.length) continue;
                    const heading = element('h3', 'interpreter-group', child.label);
                    if (child.familyColor) heading.style.setProperty('--interpreter-family-color', child.familyColor);
                    container.append(indent(heading, depth));
                    matchCount += renderProviderList(container, languages.map((node) => node.label), depth + 1);
                }
            }
        } else if (context?.kind === 'group') {
            const group = path?.find((node) => node.kind === 'group');
            const languages = (group?.children || []).filter((node) => node.kind === 'language' && matchingProviders(node.label).length);
            matchCount = renderProviderList(container, languages.map((node) => node.label));
        } else {
            let language = context?.kind === 'language' ? context.language : '';
            // map marker taps carry the language even when a place path is missing
            if (context?.kind === 'place') language = path?.find((node) => node.kind === 'language')?.label || context.language || '';
            if (language) {
                const providers = matchingProviders(language);
                providers.forEach((provider) => container.append(providerButton(provider, language)));
                matchCount = providers.length;
            }
        }
        if (!matchCount) container.append(status(label('none')));
    };
    const field = (parent, key, value, link) => {
        if (!normalize(value)) return;
        if (key === 'type' || key === 'relevance') value = enumText(key, value);
        const row = element('p', 'interpreter-detail-row');
        row.append(element('strong', '', `${label(key)}: `));
        const href = usableUrl(link);
        if (href) {
            const anchor = element('a', '', value);
            anchor.href = href;
            anchor.rel = 'noopener noreferrer';
            if (href.startsWith('http')) anchor.target = '_blank';
            row.append(anchor);
        } else row.append(document.createTextNode(String(value)));
        parent.append(row);
    };
    const phoneField = (parent, value) => {
        if (!normalize(value)) return;
        const row = element('p', 'interpreter-detail-row');
        row.append(element('strong', '', `${label('phone')}: `));
        String(value).split(';').forEach((part, index) => {
            if (index) row.append(document.createTextNode('; '));
            const match = /\+?\d[\d\s().-]*(?:\s*(?:ext\.?|x)\s*\d+)?/i.exec(part);
            if (!match || (match[0].match(/\d/g) || []).length < 3) {
                row.append(document.createTextNode(part.trim()));
                return;
            }
            row.append(document.createTextNode(part.slice(0, match.index)));
            const number = match[0].trim();
            const dial = number.replace(/[^\d+]/g, '');
            if (dial.replace(/\D/g, '').length >= 3) {
                const anchor = element('a', '', number);
                anchor.href = `tel:${dial}`;
                row.append(anchor);
            } else row.append(document.createTextNode(number));
            row.append(document.createTextNode(part.slice(match.index + match[0].length)));
        });
        parent.append(row);
    };
    const renderDetail = () => {
        setView('detail');
        container.replaceChildren();
        container.append(element('h2', 'interpreter-detail-name', normalize(selectedProvider?.name)));
        field(container, 'type', selectedProvider?.serviceType);
        field(container, 'relevance', selectedProvider?.oregonRelevance);
        field(container, 'published', selectedProvider?.languagesPublished);
        field(container, 'source', selectedProvider?.primarySourceUrl, selectedProvider?.primarySourceUrl);
        field(container, 'request', selectedProvider?.requestUrl, selectedProvider?.requestUrl);
        phoneField(container, selectedProvider?.phoneNumber);
        field(container, 'email', selectedProvider?.contactEmail, selectedProvider?.contactEmail ? `mailto:${selectedProvider.contactEmail}` : '');
    };
    const unsubscribe = onLanguageChange(() => view === 'detail' ? renderDetail() : renderList());
    return {
        setContext(next) { context = next || null; selectedProvider = null; renderList(); },
        showList() { selectedProvider = null; renderList(); },
        back() { if (view !== 'detail') return false; selectedProvider = null; renderList(); return true; },
        getView() { return view; },
        destroy() { unsubscribe?.(); }
    };
}
