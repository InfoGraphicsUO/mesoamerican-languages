mapboxgl.accessToken = 'pk.eyJ1IjoiaW5mb2dyYXBoaWNzIiwiYSI6ImNqaTR0eHhnODBjeTUzdmx0N3U2dWU5NW8ifQ.fVbTCmIrqILIzv5QGtVJ2Q'; // IGL access

const bounds = [
    [-120.425, -1],
    [-61, 34.009]
]

const map = new mapboxgl.Map({
    container: 'map',
    center: [-96.355, 17.800], // centered around Oaxaca
    zoom: 4.5, // to show full scale of mesoamerica
    minZoom: 4.35,
    maxBounds: bounds,
    projection: 'mercator',
})
