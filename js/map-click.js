import { featureAt } from './popup.js';
import { sitePopup } from './map-layers.js';
import { localized } from './language.js';
import { html, languageText } from './ui.js';

// clicking the map asks before showing the languages near the spot, so a search in progress isnt replaced by accident
// a click on a site marker shows the site above the question, and yes treats it like picking that documented place
// exports initMapClick

const TEXT = {
    question: localized('View languages near this location?', '¿Ver las lenguas cerca de este lugar?'),
    yes: localized('Yes', 'Sí'),
    no: localized('No', 'No')
};

// site: the clicked marker's popup markup, or null on empty map
const prompt = (site) => html`
    ${site || ''}
    <div class="map-prompt">
        <p class="map-prompt-question">${languageText(TEXT.question)}</p>
        <div class="map-prompt-actions">
            <button class="map-prompt-button map-prompt-yes" type="button" data-answer="yes">${languageText(TEXT.yes)}</button>
            <button class="map-prompt-button" type="button" data-answer="no">${languageText(TEXT.no)}</button>
        </div>
    </div>`;

// sites, pickedPopup, hover: from addMapLayers in js/map-layers.js
// onConfirm({ point, objectId }): yes was picked, objectId is the clicked site's or undefined on empty map
export function initMapClick(view, { sites, pickedPopup, hover }, { onConfirm = () => {} } = {}) {
    let click = 0; // newest click, so a slow hit test cant open the prompt somewhere older
    let pending = null; // the spot the prompt is asking about

    // the picked popup also shows searched sites, only a popup w/ the question in it is the prompt
    const isAsking = () => pickedPopup.isOpen() && Boolean(pickedPopup.element.querySelector('.map-prompt'));

    view.on('click', async (event) => {
        const current = ++click;
        const feature = await featureAt(view, sites, event).catch(() => null);
        if (current !== click) return;

        pending = { point: feature?.geometry || event.mapPoint, objectId: feature?.getObjectId() };
        hover.hide(); // the prompt repeats the site, and would sit under the hover box
        // the tip clears a marker, or touches the clicked spot on empty map
        pickedPopup.show(pending.point, prompt(feature && sitePopup(feature)), { gap: feature ? undefined : 0 });
    });

    // a double click zooms the map, it isnt asking about a spot
    view.on('double-click', () => {
        click += 1;
        if (isAsking()) close();
    });

    function close() {
        pending = null;
        pickedPopup.hide();
    }

    pickedPopup.element.addEventListener('click', (event) => {
        const button = event.target.closest('[data-answer]');
        if (!button || !pending) return;
        const spot = pending;
        close();
        if (button.dataset.answer === 'yes') onConfirm(spot);
    });

    pickedPopup.element.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isAsking()) close();
    });
}
