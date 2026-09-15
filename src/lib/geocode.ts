/**
 * Place search and reverse geocoding, called directly from the client.
 *
 * This used to run through two SvelteKit server routes (see git history:
 * src/routes/api/search, src/routes/api/reverse-geocode). Capacitor ships no
 * server on the device, so that logic - ranking, fallback chain, caching -
 * moved here unchanged; only the transport (browser fetch instead of a Node
 * proxy) and the cache backing (localStorage instead of server memory)
 * changed.
 *
 * Known tradeoff from dropping the proxy: browsers refuse to let JS set a
 * custom User-Agent header, so requests go out under the WebView's default
 * UA instead of an identifying one. Nominatim's usage policy asks for a
 * descriptive UA; acceptable for this app's low, personal request volume,
 * but worth knowing if usage ever grows.
 */
import { createCache } from './cache';
import type { Coordinates } from './weather';

export type GeocodeResult = {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	region: string;
	country: string;
};

export type ReverseGeocodeResult = {
	name: string;
	region: string;
	country: string;
};

const searchCache = createCache<GeocodeResult[]>({
	storageKey: 'skypulse-search-cache',
	ttlMs: 6 * 60 * 60 * 1000,
	maxEntries: 100
});

const reverseCache = createCache<ReverseGeocodeResult>({
	storageKey: 'skypulse-reverse-cache',
	ttlMs: 24 * 60 * 60 * 1000,
	maxEntries: 100
});

// 3 decimals is roughly 110m: tight enough to stay correct near a boundary,
// loose enough to absorb normal GPS jitter between calls at the same spot.
const COORD_PRECISION = 3;

function isAbort(error: unknown) {
	return (error as Error)?.name === 'AbortError';
}

// ---------- search (Photon) ----------

const MIN_QUERY = 2;
const MAX_QUERY = 120;
const UPSTREAM_LIMIT = 20;
const RESULT_LIMIT = 6;

/**
 * Photon mixes places, streets and buildings into one relevance list, and its
 * fuzzy matching can rank a *similarly* named village above an *exact* match
 * that happens to be tagged as something smaller (a bus stop, a road). Some
 * real villages are only mapped in OSM as a named amenity, with no place node
 * of their own.
 *
 * So results are sorted by three tiers, in order: (1) exact name match beats
 * fuzzy match, (2) among equal matches, a place/boundary beats a street or
 * building, (3) among equal matches and tiers, the nearest one wins when we
 * have a bias point - Photon's own relevance score favours text similarity
 * over distance, so a same-named place two districts away can otherwise
 * outrank the one the user is standing next to.
 */
const KEY_RANK: Record<string, number> = {
	place: 0,
	boundary: 1,
	amenity: 2,
	building: 3,
	landuse: 3,
	tourism: 3,
	highway: 5,
	waterway: 5,
	railway: 5
};

type PhotonFeature = {
	geometry?: { coordinates?: [number, number] };
	properties?: {
		osm_id?: number;
		osm_type?: string;
		osm_key?: string;
		name?: string;
		state?: string;
		county?: string;
		district?: string;
		city?: string;
		country?: string;
	};
};

function rankOf(key: string | undefined) {
	return KEY_RANK[key ?? ''] ?? 4;
}

/** Great-circle distance in km. Only used to order nearby candidates, so a
 * spherical approximation is more than precise enough. */
function distanceKm(a: Coordinates, b: [number, number]) {
	const [lon2, lat2] = b;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - a.latitude);
	const dLon = toRad(lon2 - a.longitude);
	const sinLat = Math.sin(dLat / 2);
	const sinLon = Math.sin(dLon / 2);
	const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
	return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function toSearchResult(feature: PhotonFeature): GeocodeResult | null {
	const props = feature.properties ?? {};
	const coords = feature.geometry?.coordinates;

	if (!props.name || !coords) return null;

	const [longitude, latitude] = coords;

	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

	// district and county overlap in Indian data; de-duplicate before joining.
	const parts = [props.district ?? props.county, props.state].filter((part): part is string =>
		Boolean(part)
	);

	return {
		id: `${props.osm_type ?? 'X'}${props.osm_id ?? `${latitude},${longitude}`}`,
		name: props.name,
		latitude,
		longitude,
		region: [...new Set(parts)].join(', '),
		country: props.country ?? ''
	};
}

/**
 * Searches places via Photon (OpenStreetMap data, built for autocomplete).
 * Open-Meteo's own geocoder is backed by GeoNames and has no record of
 * smaller villages. Passing `near` biases results towards the user, so a
 * local village outranks a distant place with the same name.
 */
export async function searchCity(
	cityName: string,
	near?: Coordinates | null,
	signal?: AbortSignal
): Promise<{ results: GeocodeResult[] }> {
	const query = cityName.trim();

	if (query.length < MIN_QUERY || query.length > MAX_QUERY) {
		return { results: [] };
	}

	const cacheKey = near
		? `${query.toLowerCase()}|${near.latitude.toFixed(1)},${near.longitude.toFixed(1)}`
		: query.toLowerCase();

	const cached = searchCache.get(cacheKey);
	if (cached) return { results: cached };

	const endpoint = new URL('https://photon.komoot.io/api/');
	endpoint.searchParams.set('q', query);
	endpoint.searchParams.set('limit', String(UPSTREAM_LIMIT));
	endpoint.searchParams.set('lang', 'en');

	if (near) {
		endpoint.searchParams.set('lat', near.latitude.toFixed(4));
		endpoint.searchParams.set('lon', near.longitude.toFixed(4));
	}

	try {
		const response = await fetch(endpoint, { signal });

		if (!response.ok) {
			console.error('[geocode] Place search failed', {
				url: endpoint.toString(),
				query,
				status: response.status,
				statusText: response.statusText
			});

			throw new Error('Failed to search places');
		}

		const payload = await response.json();
		const features: PhotonFeature[] = Array.isArray(payload?.features) ? payload.features : [];
		const normalizedQuery = query.toLowerCase();

		const seen = new Set<string>();
		const results = features
			.map((feature) => {
				const coords = feature.geometry?.coordinates;
				const name = feature.properties?.name?.toLowerCase();
				return {
					feature,
					isExactMatch: name === normalizedQuery,
					rank: rankOf(feature.properties?.osm_key),
					distance: near && coords ? distanceKm(near, coords) : null
				};
			})
			.sort((a, b) => {
				if (a.isExactMatch !== b.isExactMatch) return a.isExactMatch ? -1 : 1;
				if (a.rank !== b.rank) return a.rank - b.rank;
				if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
				return 0; // no bias: keep Photon's own relevance order within the tier
			})
			.map(({ feature }) => toSearchResult(feature))
			.filter((result): result is GeocodeResult => result !== null)
			.filter((result) => {
				const fingerprint = `${result.name}|${result.region}|${result.country}`;
				if (seen.has(fingerprint)) return false;
				seen.add(fingerprint);
				return true;
			})
			.slice(0, RESULT_LIMIT);

		searchCache.set(cacheKey, results);

		return { results };
	} catch (error) {
		if (isAbort(error)) throw error;

		console.error('[geocode] Place search crashed', { url: endpoint.toString(), query, error });
		throw error;
	}
}

// ---------- reverse geocode (Nominatim) ----------

/**
 * Most local name first. Nominatim returns whichever of these OSM admin levels
 * exist at the point, and the broad ones are almost always present - so asking
 * for `city` first meant a village like Avinashipalayam could lose to its
 * district. Settlement names (village/hamlet/town) win, then sub-city areas,
 * then the city itself.
 */
const NAME_KEYS = [
	'village',
	'hamlet',
	'town',
	'suburb',
	'neighbourhood',
	'city_district',
	'city',
	'municipality',
	'county'
] as const;

const REGION_KEYS = ['state_district', 'state'] as const;

type NominatimAddress = Record<string, string | undefined>;

function reverseCacheKey(latitude: number, longitude: number) {
	return `${latitude.toFixed(COORD_PRECISION)},${longitude.toFixed(COORD_PRECISION)}`;
}

export async function getLocationName(
	latitude: number,
	longitude: number,
	signal?: AbortSignal
): Promise<{ results: ReverseGeocodeResult[] }> {
	const key = reverseCacheKey(latitude, longitude);
	const cached = reverseCache.get(key);

	if (cached) return { results: [cached] };

	const [roundedLatitude, roundedLongitude] = key.split(',');

	const endpoint = new URL('https://nominatim.openstreetmap.org/reverse');
	endpoint.searchParams.set('lat', roundedLatitude);
	endpoint.searchParams.set('lon', roundedLongitude);
	endpoint.searchParams.set('format', 'jsonv2');
	endpoint.searchParams.set('accept-language', 'en');

	try {
		const response = await fetch(endpoint, { signal });

		if (!response.ok) {
			console.error('[geocode] Reverse geocode failed', {
				url: endpoint.toString(),
				latitude,
				longitude,
				status: response.status,
				statusText: response.statusText
			});

			throw new Error('Failed to fetch location name');
		}

		const payload = await response.json();
		const address: NominatimAddress = payload?.address ?? {};

		const name =
			NAME_KEYS.map((nameKey) => address[nameKey]).find(Boolean) ??
			(payload?.name || undefined) ??
			payload?.display_name?.split(',')?.[0] ??
			'Unknown location';

		const regionParts = REGION_KEYS.map((regionKey) => address[regionKey]).filter(
			(part): part is string => Boolean(part) && part !== name
		);

		const result: ReverseGeocodeResult = {
			name,
			region: [...new Set(regionParts)].join(', '),
			country: address.country ?? ''
		};

		reverseCache.set(key, result);

		return { results: [result] };
	} catch (error) {
		if (isAbort(error)) throw error;

		console.error('[geocode] Reverse geocode crashed', {
			url: endpoint.toString(),
			latitude,
			longitude,
			error
		});

		throw error;
	}
}
