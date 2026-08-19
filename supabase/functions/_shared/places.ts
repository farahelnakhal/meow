//place lookup behind a provider interface, OpenStreetMap Overpass

export type Place = {
  name: string;
  lat: number;
  lon: number;
  kind: string;
  distance_m: number;
};

const USER_AGENT = 'smac-family-app/1.0 (competition project)';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

//interest category -> OSM tag filters, only categories that map to real places
const CATEGORY_TAGS: Record<string, string[]> = {
  outdoors:   ['leisure=park', 'leisure=garden', 'leisure=playground'],
  nature:     ['leisure=nature_reserve', 'natural=wood', 'leisure=park'],
  animals:    ['tourism=zoo', 'amenity=animal_shelter', 'tourism=aquarium'],
  books:      ['amenity=library', 'shop=books'],
  community:  ['tourism=museum', 'amenity=community_centre', 'amenity=arts_centre'],
  sports:     ['leisure=pitch', 'leisure=sports_centre', 'leisure=playground'],
  science:    ['tourism=museum'],
  arts:       ['amenity=arts_centre', 'tourism=artwork', 'tourism=museum'],
  games:      ['leisure=playground'],
  cooking:    ['shop=bakery', 'marketplace=yes', 'amenity=marketplace'],
};

export function categoriesWithPlaces(): string[] {
  return Object.keys(CATEGORY_TAGS);
}

//metres between two coordinates, haversine
export function distanceMeters(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function buildOverpassQuery(
  lat: number, lon: number, radius: number, tags: string[]
): string {
  // node and way for each tag; centre gives a coordinate for ways
  const clauses = tags
    .map((t) => {
      const [k, v] = t.split('=');
      return `node["${k}"="${v}"](around:${radius},${lat},${lon});way["${k}"="${v}"](around:${radius},${lat},${lon});`;
    })
    .join('');
  return `[out:json][timeout:20];(${clauses});out center tags 60;`;
}

async function fetchOverpass(
  lat: number, lon: number, radius: number, tags: string[]
): Promise<Place[]> {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(buildOverpassQuery(lat, lon, radius, tags))}`,
  });

  if (!res.ok) {
    throw new Error(`overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json();
  const out: Place[] = [];

  for (const el of body?.elements ?? []) {
    const name = el?.tags?.name;
    if (!name) continue; // unnamed features are useless to a family

    const plat = el.lat ?? el?.center?.lat;
    const plon = el.lon ?? el?.center?.lon;
    if (typeof plat !== 'number' || typeof plon !== 'number') continue;

    const kind =
      el.tags.leisure ?? el.tags.tourism ?? el.tags.amenity ?? el.tags.shop ?? el.tags.natural ?? 'place';

    out.push({
      name: String(name).slice(0, 120),
      lat: plat,
      lon: plon,
      kind: String(kind),
      distance_m: distanceMeters(lat, lon, plat, plon),
    });
  }
  return out;
}

async function fetchGoogle(
  lat: number, lon: number, radius: number, tags: string[], key: string
): Promise<Place[]> {
  //field mask keeps this on cheapest SKU that still returns what we need
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.primaryType',
    },
    body: JSON.stringify({
      includedTypes: googleTypesFor(tags),
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lon }, radius },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`google places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = await res.json();
  return (body?.places ?? [])
    .map((p: any) => {
      const plat = p?.location?.latitude;
      const plon = p?.location?.longitude;
      const name = p?.displayName?.text;
      if (!name || typeof plat !== 'number' || typeof plon !== 'number') return null;
      return {
        name: String(name).slice(0, 120),
        lat: plat,
        lon: plon,
        kind: String(p?.primaryType ?? 'place'),
        distance_m: distanceMeters(lat, lon, plat, plon),
      } as Place;
    })
    .filter((p: Place | null): p is Place => p !== null);
}

function googleTypesFor(tags: string[]): string[] {
  const map: Record<string, string> = {
    'leisure=park': 'park',
    'leisure=garden': 'park',
    'leisure=playground': 'playground',
    'leisure=nature_reserve': 'park',
    'natural=wood': 'park',
    'tourism=zoo': 'zoo',
    'tourism=aquarium': 'aquarium',
    'amenity=animal_shelter': 'pet_store',
    'amenity=library': 'library',
    'shop=books': 'book_store',
    'tourism=museum': 'museum',
    'amenity=community_centre': 'community_center',
    'amenity=arts_centre': 'art_gallery',
    'tourism=artwork': 'art_gallery',
    'leisure=pitch': 'sports_complex',
    'leisure=sports_centre': 'sports_complex',
    'shop=bakery': 'bakery',
    'amenity=marketplace': 'market',
    'marketplace=yes': 'market',
  };
  const types = new Set<string>();
  for (const t of tags) if (map[t]) types.add(map[t]);
  return [...types];
}

//looks up places for given interest categories, hard-capped to geofence radius
export async function findPlaces(
  lat: number,
  lon: number,
  radiusMeters: number,
  categories: string[],
  limit = 3
): Promise<{ places: Place[]; provider: string }> {
  const tags = new Set<string>();
  for (const c of categories) {
    for (const t of CATEGORY_TAGS[c] ?? []) tags.add(t);
  }
  if (tags.size === 0) return { places: [], provider: 'none' };

  const googleKey = Deno.env.get('GOOGLE_PLACES_KEY');
  const provider = googleKey ? 'google' : 'overpass';

  const raw = googleKey
    ? await fetchGoogle(lat, lon, radiusMeters, [...tags], googleKey)
    : await fetchOverpass(lat, lon, radiusMeters, [...tags]);

  const withinFence = raw.filter((p) => p.distance_m <= radiusMeters);

  const seen = new Set<string>();
  const deduped: Place[] = [];
  for (const p of withinFence.sort((a, b) => a.distance_m - b.distance_m)) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
    if (deduped.length >= limit) break;
  }

  return { places: deduped, provider };
}