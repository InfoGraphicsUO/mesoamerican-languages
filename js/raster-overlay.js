// hidden view of the language estimate raster, pressing 1 2 3 4 quickly turns it on and off
// each pixel takes its most likely language's color, shaded within its family like the qgis project,
// and fades w/ the panel's confidence levels so thin data reads as thin
// exports initRasterOverlay

const SEQUENCE = ['1', '2', '3', '4'];
const SEQUENCE_TIME = 1200; // ms from the first key to the last

// base color per family, Otomanguean uses its group colors like the markers do
const FAMILY_COLORS = {
    Mayan: '#4ec340',
    Otomanguean: '#2eacc9',
    'Purépecha': '#a36b27',
    'Uto-Aztecan': '#d34261',
    'Sign Language': '#3935c6'
};
const GROUP_COLORS = { Chinantec: '#07556e', Mixtec: '#1781ba', Triqui: '#25b5d3', Zapotec: '#234aa0' };
const FALLBACK_COLOR = '#777a80';

// opacity per confidence level, out of 255
const ALPHA = { high: 200, medium: 140, low: 80 };

// web mercator y from latitude, the image gets resampled into mercator rows so it lines up w/ the basemap
const R = 6378137;
const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latFromMercY = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
const mercX = (lon) => R * lon * Math.PI / 180;

function hexToHsl(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
    const hue = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

// one rgb per language, languages sharing a base color spread from dark to light so neighbours stay apart
function languageColors(languages) {
    const byBase = new Map();
    languages.forEach((language, index) => {
        const base = GROUP_COLORS[language.group] || FAMILY_COLORS[language.family] || FALLBACK_COLOR;
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(index);
    });
    const colors = [];
    for (const [base, indexes] of byBase) {
        const [h, s] = hexToHsl(base);
        indexes.forEach((index, i) => {
            const t = indexes.length === 1 ? 0.5 : i / (indexes.length - 1);
            colors[index] = hslToRgb([h, Math.min(1, s * 1.05), 0.28 + 0.45 * t]);
        });
    }
    return colors;
}

// paint the top language band into a web mercator canvas
async function buildCanvas(image, lookup) {
    const [top, level] = await image.readRasters({ samples: [0, 8] });
    const width = image.getWidth();
    const height = image.getHeight();
    const [west, south, east, north] = image.getBoundingBox();
    const colors = languageColors(lookup.languages);
    const nodata = lookup.nodata;
    const alphas = lookup.confidence.map(({ level: name }) => ALPHA[name]);

    const top_y = mercY(north);
    const bottom_y = mercY(south);
    const rows = height; // same row count, spaced evenly in mercator
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = rows;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(width, rows);
    const out = pixels.data;

    for (let row = 0; row < rows; row += 1) {
        const lat = latFromMercY(top_y + (bottom_y - top_y) * (row + 0.5) / rows);
        const sourceRow = Math.min(height - 1, Math.max(0, Math.floor((north - lat) / (north - south) * height)));
        for (let col = 0; col < width; col += 1) {
            const source = sourceRow * width + col;
            const language = top[source];
            if (language === nodata) continue;
            const [r, g, b] = colors[language];
            const at = (row * width + col) * 4;
            out[at] = r;
            out[at + 1] = g;
            out[at + 2] = b;
            out[at + 3] = alphas[level[source]] ?? ALPHA.low;
        }
    }
    context.putImageData(pixels, 0, 0);
    return { canvas, extent: { xmin: mercX(west), ymin: bottom_y, xmax: mercX(east), ymax: top_y } };
}

// keys typed into the search box or any other field dont count
function isTyping(target) {
    return target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// view: MapView from ready in js/map.js
// estimate: from initLanguageEstimate, its geotiff image and lookup get reused
export function initRasterOverlay(view, { image, lookup }) {
    let layer = null;
    let loading = null;
    let recent = [];

    async function load() {
        const [MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent] = await Promise.all([
            $arcgis.import('@arcgis/core/layers/MediaLayer.js'),
            $arcgis.import('@arcgis/core/layers/support/ImageElement.js'),
            $arcgis.import('@arcgis/core/layers/support/ExtentAndRotationGeoreference.js'),
            $arcgis.import('@arcgis/core/geometry/Extent.js')
        ]);
        const { canvas, extent } = await buildCanvas(image, lookup);
        const element = new ImageElement({
            image: canvas,
            georeference: new ExtentAndRotationGeoreference({
                extent: new Extent({ ...extent, spatialReference: { wkid: 3857 } })
            })
        });
        layer = new MediaLayer({ source: [element], title: 'Language estimate raster', listMode: 'hide', visible: false });
        view.map.add(layer, 0); // under the site markers
    }

    async function toggle() {
        loading ||= load();
        try {
            await loading;
        } catch (error) {
            console.error('Unable to load the estimate raster:', error);
            loading = null;
            return;
        }
        layer.visible = !layer.visible;
    }

    window.addEventListener('keydown', (event) => {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
        const now = performance.now();
        recent = [...recent, { key: event.key, time: now }].slice(-SEQUENCE.length);
        const matched = recent.length === SEQUENCE.length
            && recent.every(({ key }, i) => key === SEQUENCE[i])
            && now - recent[0].time <= SEQUENCE_TIME;
        if (!matched) return;
        recent = [];
        toggle();
    });
}
