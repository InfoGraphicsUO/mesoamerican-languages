// keep map marker and browser result colors together
export const FAMILY_COLORS = {
    Mayan: '#4ec340',
    Otomanguean: '#2eacc9',
    'Purépecha': '#a36b27',
    'Sign Language': '#3935c6',
    'Uto-Aztecan': '#d34261',
    Unclassified: '#777a80'
};

// Otomanguean uses a different blue for each group in the mapped data
export const OTOMANGUEAN_GROUPS = [
    { name: 'Chinantec', slug: 'chinantec', color: '#07556e' },
    { name: 'Mixtec', slug: 'mixtec', color: '#1781ba' },
    { name: 'Triqui', slug: 'triqui', color: '#25b5d3' },
    { name: 'Zapotec', slug: 'zapotec', color: '#234aa0' }
];

export function siteColor(family, group) {
    if (family === 'Otomanguean') {
        const groupColor = OTOMANGUEAN_GROUPS.find((item) => item.name === group)?.color;
        if (groupColor) return groupColor;
    }
    return FAMILY_COLORS[family] || '';
}
