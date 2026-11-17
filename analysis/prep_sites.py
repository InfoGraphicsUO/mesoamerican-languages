"""Clean the attested sites into weighted language observations for the probability model.

Reads the hosted feature layer export (GeoJSON, EPSG:4326) and writes one row per
(respondent, location, language) with a weight:
  - survey-only rows (blank Language) are recovered from the survey iso_code
  - Spanish/English and Mexican Sign Language are dropped (not tied to a region)
  - US sites are dropped (diaspora, outside the study area)
  - a site naming k languages gives each 1/k
  - duplicate (respondent, location, language) rows collapse to one
  - each respondent's total weight is capped at RESPONDENT_CAP

usage: python3 analysis/prep_sites.py sites.geojson out.csv
"""
import csv
import json
import re
import sys
from collections import defaultdict

RESPONDENT_CAP = 3.0  # max total weight one survey response can add

# languages that only appear in survey codes, names follow the Glottolog/Ethnologue style used in the layer
EXTRA_LANGUAGES = {
    'mms': ('Southern Mam', 'mams1234', 'Mayan', 'Mayan'),
    'mvc': ('Central Mam', 'mamc1234', 'Mayan', 'Mayan'),
    'nsu': ('Sierra Negra Nahuatl', 'sier1248', 'Uto-Aztecan', 'Nahuan'),
    'mks': ('Silacayoapan Mixtec', 'sila1250', 'Otomanguean', 'Mixtec'),
    'zpt': ('San Vicente Coatlán Zapotec', 'sanv1242', 'Otomanguean', 'Zapotec'),
}
DROP_CODES = {'spa', 'eng', 'mfs'}


def survey_codes(raw, glotto_to_iso):
    # 'mam: mvj, spa' -> ['mvj'], 'kjb; mam:mms; spa; kek' -> ['kjb', 'mms', 'kek']
    out = []
    for token in re.split(r'[;,\s]+', re.sub(r'\w+:\s*', '', raw or '')):
        token = glotto_to_iso.get(token, token)  # a few rows have the glottocode in the iso column
        if token and token not in DROP_CODES and token not in out:
            out.append(token)
    return out


def main(src, dst):
    features = json.load(open(src))['features']

    # iso -> (name, glottocode, family, group) from the rows that were matched to a language
    languages = dict(EXTRA_LANGUAGES)
    for f in features:
        p = f['properties']
        if (p['Language'] or '').strip():
            languages[p['ISO_Code_1']] = (p['Language'], p['Glotto_Cod'], p['Family'], p['Group_'])
    glotto_to_iso = {v[1]: k for k, v in languages.items()}

    rows = {}
    unknown = defaultdict(int)
    for f in features:
        p = f['properties']
        if p['country'] == 'United States':
            continue
        if (p['Language'] or '').strip():
            codes = [p['ISO_Code_1']]
        else:
            codes = survey_codes(p['iso_code'], glotto_to_iso)
        codes = [c for c in codes if c not in DROP_CODES]
        for c in codes:
            if c not in languages:
                unknown[c] += 1
        codes = [c for c in codes if c in languages]
        if not codes:
            continue
        lon, lat = f['geometry']['coordinates']
        for c in codes:
            key = (p['ResponseId'], round(lon, 4), round(lat, 4), c)
            # keep the strongest share if the same respondent named it twice
            share = 1 / len(codes)
            if key not in rows or rows[key]['weight'] < share:
                rows[key] = dict(respondent=p['ResponseId'], lon=lon, lat=lat, iso=c,
                                 role=p['place_role'], place=p['final_name'], weight=share)

    by_respondent = defaultdict(list)
    for r in rows.values():
        by_respondent[r['respondent']].append(r)
    for rs in by_respondent.values():
        total = sum(r['weight'] for r in rs)
        if total > RESPONDENT_CAP:
            for r in rs:
                r['weight'] *= RESPONDENT_CAP / total

    with open(dst, 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['respondent', 'lon', 'lat', 'iso', 'language', 'glottocode', 'family', 'group', 'role', 'place', 'weight'])
        for r in rows.values():
            name, glotto, family, group = languages[r['iso']]
            w.writerow([r['respondent'], r['lon'], r['lat'], r['iso'], name, glotto, family, group,
                        r['role'], r['place'], round(r['weight'], 6)])

    print(f'{len(rows)} observations, {len(by_respondent)} respondents, '
          f'{len({r["iso"] for r in rows.values()})} languages, total weight {sum(r["weight"] for r in rows.values()):.1f}')
    if unknown:
        print('unmatched survey codes:', dict(unknown))


if __name__ == '__main__':
    main(*sys.argv[1:3])
