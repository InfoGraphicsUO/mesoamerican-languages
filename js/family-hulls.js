// language families that currently get a suggested area on the map
export const HULL_FAMILY_NAMES = ['Mayan', 'Otomanguean', 'Purépecha', 'Uto-Aztecan'];

// accept either a feature collection or a plain feature list
function featuresFrom(featureCollection) {
    return Array.isArray(featureCollection)
        ? featureCollection
        : Array.isArray(featureCollection?.features) ? featureCollection.features : [];
}

function validPoint(feature) {
    // return only finite longitude/latitude pairs from point features
    if (feature?.geometry?.type !== 'Point') return null;

    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

    return coordinates.slice(0, 2).every((coordinate) => Number.isFinite(coordinate))
        ? coordinates.slice(0, 2) : null;
}

function uniquePoints(points) {
    // remove duplicate coordinates before building the hull
    const seen = new Set();
    return points.filter((point) => {
        const key = `${point[0]},${point[1]}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// get usable point coordinates for one family
// keeping this separate lets us build or test hulls without involving the map
export function uniqueFamilyPoints(featureCollection, familyName) {
    const points = featuresFrom(featureCollection)
        .filter((feature) => feature?.properties?.family === familyName)
        .map(validPoint)
        .filter(Boolean);

    return uniquePoints(points);
}

function cross(origin, first, second) {
    // positive/negative result tells which side of the line the point is on
    return (first[0] - origin[0]) * (second[1] - origin[1])
        - (first[1] - origin[1]) * (second[0] - origin[0]);
}

// build the outside edge by walking sorted points from both directions
// collinear points on an edge are reduced to the edge endpoints
export function convexHull(points) {
    // ignore bad points and sort left-to-right before walking the edges
    const usablePoints = uniquePoints((Array.isArray(points) ? points : [])
        .map((point) => Array.isArray(point) && point.length >= 2
            ? point.slice(0, 2) : null)
        .filter((point) => point && point.every(Number.isFinite)))
        .sort((first, second) => first[0] - second[0] || first[1] - second[1]);

    if (usablePoints.length <= 2) return usablePoints; // not enough points for a polygon

    // walk the lower edge, removing points that turn inward
    const lower = [];
    for (const point of usablePoints) {
        while (lower.length >= 2
            && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
        lower.push(point);
    }

    // walk the upper edge in the opposite direction
    const upper = [];
    for (let index = usablePoints.length - 1; index >= 0; index -= 1) {
        const point = usablePoints[index];
        while (upper.length >= 2
            && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
        upper.push(point);
    }

    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function buildFamilyHullCollection(featureCollection, familyNames = HULL_FAMILY_NAMES) {
    const features = [];

    // build one polygon for each family with enough distinct map points
    for (const familyName of familyNames) {
        const points = uniqueFamilyPoints(featureCollection, familyName);
        if (points.length < 3) continue;

        const hull = convexHull(points);
        // three collinear points do not enclose a polygon, so leave that family out
        if (hull.length < 3) continue;

        features.push({
            type: 'Feature',
            properties: { family: familyName },
            geometry: {
                type: 'Polygon',
                coordinates: [[...hull, hull[0]]]
            }
        });
    }

    return { type: 'FeatureCollection', features }; // ready to register as a mapbox source
}
