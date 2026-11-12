import { FAMILY_LABELS, GROUP_LABELS, localized, localizedLookup, textFor } from './language.js';
import { html, languageText } from './ui.js';

// estimates which languages are most likely spoken at any point on the map
// reads one pixel of data/language-probability.tif, built by analysis/build_raster.py
// bands: 1-3 top language index, 4-6 percent, 7 km to the nearest documented site,
// 8 percent for a language nobody reported nearby, 9 confidence level (index into lookup.confidence),
// 10 effective respondents x 10, 255 = no estimate (band 7 is also set on water near a report)
// exports initLanguageEstimate

const RASTER_URL = 'data/language-probability.tif';
const LOOKUP_URL = 'data/language-probability.json';
const GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@3.0.5/+esm';
const MIN_PERCENT = 1; // shares that round below this are left off the list

const CONFIDENCE_TEXT = {
    high: localized('High confidence', 'Confianza alta'),
    medium: localized('Medium confidence', 'Confianza media'),
    low: localized('Low confidence', 'Confianza baja')
};

// why the confidence is what it is: distance to our data, how many people reported nearby, or both
// people is the raster's effective respondents, each person counted once and fading w/ walking time
const distanceText = (km) => (km < 1 ? localized('under 1 km', 'menos de 1 km') : localized(`${km} km`, `${km} km`));

// a rough range rather than a count, effective respondents fade w/ walking time so an exact number would mislead
function peopleText(people) {
    if (people < 1) return localized('a few people', 'unas pocas personas');
    if (people < 5) return localized('between 1 and 5 people', 'entre 1 y 5 personas');
    if (people < 10) return localized('between 5 and 10 people', 'entre 5 y 10 personas');
    return localized('over 10 people', 'más de 10 personas');
}

// level: index into lookup.confidence, levels: lookup.confidence
// the next better level says which rule held this one back
function confidenceDetail(km, people, level, levels) {
    const distance = distanceText(km);
    const both = (en, es) => localized(en(textFor(distance, 'en'), textFor(peopleText(people), 'en')),
        es(textFor(distance, 'es'), textFor(peopleText(people), 'es')));

    if (level === 0) {
        return both(
            (d, p) => `The nearest documented site is ${d} away, with reports from ${p} nearby.`,
            (d, p) => `El sitio documentado más cercano está a ${d}, con reportes de ${p} cerca.`
        );
    }

    // km and people are rounded in the raster, so a value just past a rule can land right on it
    // when neither rule fails here, the one sitting on its threshold is the one that held it back
    const better = levels[level - 1];
    let tooFar = km > better.max_km;
    let tooFew = people < better.min_respondents;
    if (!tooFar && !tooFew) {
        tooFar = km >= better.max_km;
        tooFew = people <= better.min_respondents;
    }
    if (tooFew && !tooFar) {
        return both(
            (d, p) => `There's a documented site ${d} away, but only ${p} reported a language near here, so another language may be spoken.`,
            (d, p) => `Hay un sitio documentado a ${d}, pero solo ${p} reportaron una lengua cerca de aquí, así que podría hablarse otra lengua.`
        );
    }
    if (tooFew) {
        return both(
            (d, p) => `The nearest documented site is ${d} away, and only ${p} reported a language near here.`,
            (d, p) => `El sitio documentado más cercano está a ${d} y solo ${p} reportaron una lengua cerca de aquí.`
        );
    }
    return both(
        (d) => `The nearest documented site is ${d} away, so this estimate comes from reports farther off.`,
        (d) => `El sitio documentado más cercano está a ${d}, así que esta estimación viene de reportes más lejanos.`
    );
}

// the share left over for languages missing from our nearby reports, bigger where few people reported
const OTHER_LANGUAGE = localized('Another language', 'Otra lengua');
const OTHER_DETAIL = localized('Not in our nearby reports', 'No está en nuestros reportes cercanos');

const NO_ESTIMATE = (maxKm) => localized(
    `Not enough nearby data to estimate. There are no documented sites within ${maxKm} km of this point.`,
    `No hay suficientes datos cercanos para estimar. No hay sitios documentados a menos de ${maxKm} km de este punto.`
);

// within reach of documented sites, but on water or land walking can't reach from them
const NO_ESTIMATE_WATER = localized(
    `No estimate here. This point is on water or can't be reached on foot from the nearby documented sites.`,
    'No hay estimación aquí. Este punto está en el agua o no se puede llegar a pie desde los sitios documentados cercanos.'
);

// "Mixtec · Otomanguean", the group is left off when it repeats the family
function classification({ family, group }) {
    const parts = [family, group !== family ? group : ''].filter(Boolean);
    if (!parts.length) return '';
    const labels = [group !== family ? localizedLookup(group, GROUP_LABELS) : '', localizedLookup(family, FAMILY_LABELS)].filter(Boolean);
    return localized(labels.map((label) => textFor(label, 'en')).join(' · '), labels.map((label) => textFor(label, 'es')).join(' · '));
}

// view: MapView from ready in js/map.js
// returns { show(point, { marker }), hide }
export async function initLanguageEstimate(view) {
    const [lookupResponse, rasterResponse, geotiff, Graphic, GraphicsLayer] = await Promise.all([
        fetch(LOOKUP_URL),
        fetch(RASTER_URL),
        import(GEOTIFF_URL),
        $arcgis.import('@arcgis/core/Graphic.js'),
        $arcgis.import('@arcgis/core/layers/GraphicsLayer.js')
    ]);
    if (!lookupResponse.ok) throw new Error(`Language estimate lookup returned ${lookupResponse.status}`);
    const lookup = await lookupResponse.json();
    if (!rasterResponse.ok) throw new Error(`Language estimate raster returned ${rasterResponse.status}`);
    // the whole file in one request, it's small and this works on servers that ignore range requests
    const tiff = await geotiff.fromArrayBuffer(await rasterResponse.arrayBuffer());
    const image = await tiff.getImage();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const width = image.getWidth();
    const height = image.getHeight();
    const maxKm = lookup.model.max_nearest_km;

    const panel = document.getElementById('language-estimate');
    const body = document.getElementById('language-estimate-body');
    const closeButton = document.getElementById('language-estimate-close');

    const markers = new GraphicsLayer({ listMode: 'hide' });
    view.map.add(markers);

    let request = 0; // newest lookup, so a slow tile cant overwrite a later click
    let current = null; // band values for the last point

    // ten band values at a longitude/latitude, or null outside the raster
    async function sample(longitude, latitude) {
        const col = Math.floor((longitude - originX) / resX);
        const row = Math.floor((latitude - originY) / resY); // resY is negative, rows run north to south
        if (col < 0 || row < 0 || col >= width || row >= height) return null;
        const bands = await image.readRasters({ window: [col, row, col + 1, row + 1], interleave: true });
        return Array.from(bands);
    }

    // both translations go in, css shows the current one, so a language switch needs no redraw
    function render() {
        const values = current;
        const nodata = lookup.nodata;

        if (values[0] === nodata) {
            // band 7 is kept on water within reach of a report, empty everywhere else
            const message = values[6] !== undefined && values[6] !== nodata ? NO_ESTIMATE_WATER : NO_ESTIMATE(maxKm);
            body.innerHTML = String(html`<p class="language-estimate-empty">${languageText(message)}</p>`);
            return;
        }

        const km = values[6];
        const otherPercent = values[7];
        // set in the raster from distance and how many people reported nearby, so a lone report can't read as high
        const levelIndex = lookup.confidence[values[8]] ? values[8] : lookup.confidence.length - 1;
        const confidence = lookup.confidence[levelIndex];
        const people = values[9] / 10;
        const rows = [0, 1, 2]
            .filter((i) => values[i] !== nodata && values[3 + i] >= MIN_PERCENT)
            .map((i) => ({ language: lookup.languages[values[i]], percent: values[3 + i] }));

        body.innerHTML = String(html`
            <ol class="language-estimate-list">
                ${rows.map(({ language, percent }) => html`
                <li>
                    <span class="language-estimate-name">${language.name}</span>
                    <span class="language-estimate-percent">${percent}%</span>
                    <span class="language-estimate-family">${languageText(classification(language))}</span>
                    <span class="language-estimate-bar" aria-hidden="true"><span style="width: ${percent}%"></span></span>
                </li>`)}
                ${otherPercent >= MIN_PERCENT ? html`
                <li class="language-estimate-other">
                    <span class="language-estimate-name">${languageText(OTHER_LANGUAGE)}</span>
                    <span class="language-estimate-percent">${otherPercent}%</span>
                    <span class="language-estimate-family">${languageText(OTHER_DETAIL)}</span>
                    <span class="language-estimate-bar" aria-hidden="true"><span style="width: ${otherPercent}%"></span></span>
                </li>` : ''}
            </ol>
            <p class="language-estimate-confidence" data-level="${confidence.level}">
                <strong>${languageText(CONFIDENCE_TEXT[confidence.level])}</strong>
                ${languageText(confidenceDetail(km, people, levelIndex, lookup.confidence))}
            </p>`);
    }

    // point: anything w/ longitude/latitude, like a click's mapPoint or a geocoded Point
    // marker: drop a dot where the estimate is for, off when something else already marks it
    async function show(point, { marker = true } = {}) {
        const thisRequest = ++request;
        markers.removeAll();
        if (marker) {
            markers.add(new Graphic({
                geometry: point,
                symbol: {
                    type: 'simple-marker',
                    style: 'circle',
                    size: 10,
                    color: [149, 37, 209, 0.25],
                    outline: { color: [149, 37, 209, 1], width: 2 }
                }
            }));
        }
        panel.hidden = false;

        let values = null;
        try {
            values = await sample(point.longitude, point.latitude);
        } catch (error) {
            console.error('Unable to read language estimate:', error);
        }
        if (thisRequest !== request) return;
        current = values || [lookup.nodata];
        render();
    }

    function hide() {
        request += 1;
        current = null;
        markers.removeAll();
        panel.hidden = true;
    }

    closeButton.addEventListener('click', hide);

    return { show, hide, image, lookup }; // image + lookup are shared w/ js/raster-overlay.js
}
