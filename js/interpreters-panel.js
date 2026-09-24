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
const sortedProviders = (providers) => [...providers].sort((a, b) => normalize(a.name).localeCompare(normalize(b.name)));

function findPath(tree, context = {}) {
    let result = null;
    const visit = (nodes, path = []) => {
        for (const node of nodes || []) {
            const next = [...path, node];
            const family = next.find((item) => item.kind === 'family')?.label;
            const group = next.find((item) => item.kind === 'group')?.label;
            // Search results omit group headings when they repeat their family name.
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
    const providerById = new Map((snapshot?.providers || []).map((provider) => [String(provider.id), provider]));
    const languageLinks = Array.isArray(snapshot?.languageProviders) ? snapshot.languageProviders : [];
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
        const ids = new Set(languageLinks.filter((link) => link.language === language).map((link) => String(link.providerId)));
        return [...ids].map((id) => providerById.get(id)).filter(Boolean);
    };
    const languagesIn = (nodes) => (nodes || []).flatMap((node) => node.kind === 'language'
        ? [node.label]
        : languagesIn(node.children));
    const providerButton = (provider) => {
        const button = element('button', 'interpreter-provider');
        button.type = 'button';
        const name = element('span', 'interpreter-provider-name', normalize(provider.name));
        const relevance = normalize(provider.oregonRelevance);
        button.append(name);
        if (relevance) button.append(element('span', 'interpreter-provider-relevance', enumText('relevance', relevance)));
        button.addEventListener('click', () => { selectedProvider = provider; renderDetail(); });
        return button;
    };
    const renderList = () => {
        setView('list');
        container.replaceChildren();
        if (error || !snapshot) { container.append(status(label('error'))); return; }
        const path = findPath(taxonomy, context || {});
        let languages = [];
        if (context?.kind === 'family') {
            const familyNames = context.families?.length
                ? context.families
                : path?.filter((node) => node.kind === 'family').map((node) => node.label) || [];
            languages = (taxonomy || []).filter((node) => familyNames.includes(node.label)).flatMap((node) => languagesIn(node.children));
        } else if (context?.kind === 'group') {
            languages = languagesIn([path?.find((node) => node.kind === 'group')].filter(Boolean));
        } else if (context?.kind === 'language') {
            languages = [context.language || context[context.kind]].filter(Boolean);
        } else if (context?.kind === 'place') {
            // Marker selections carry their language even if no place node matches the tree.
            languages = [path?.find((node) => node.kind === 'language')?.label || context.language || ''].filter(Boolean);
        }

        // The old hierarchy repeated providers across language headings; union scoped matches into one flat list.
        const ids = new Set(languages.flatMap((language) => matchingProviders(language).map((provider) => String(provider.id))));
        const providers = sortedProviders([...ids].map((id) => providerById.get(id)).filter(Boolean));
        if (providers.length) providers.forEach((provider) => container.append(providerButton(provider)));
        else container.append(status(label('none')));
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
