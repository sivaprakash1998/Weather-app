import { json } from '@sveltejs/kit';
import { createCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export type ReverseGeocodeResult = {
	name: string;
	region: string;
	country: string;
};

// Place names are effectively static, so we can cache hard.
const cache = createCache<ReverseGeocodeResult>({
	ttlMs: 24 * 60 * 60 * 1000,
	maxEntries: 500
});

// 3 decimals is roughly 110m. Small enough that the resolved name is still
// correct near a boundary, large enough to absorb normal GPS jitter.
const COORD_PRECISION = 3;

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

function cacheKey(latitude: number, longitude: number) {
	return `${latitude.toFixed(COORD_PRECISION)},${longitude.toFixed(COORD_PRECISION)}`;
}

function respond(result: ReverseGeocodeResult, cacheStatus: 'HIT' | 'MISS') {
	return json(
		{ results: [result] },
		{
			headers: {
				'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
				'X-Cache': cacheStatus
			}
		}
	);
}

function failure(message: string, status: number) {
	// Never let an error response get cached in place of a real answer.
	return json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const latitudeParam = url.searchParams.get('latitude');
	const longitudeParam = url.searchParams.get('longitude');

	if (!latitudeParam || !longitudeParam) {
		return failure('Missing latitude or longitude query params', 400);
	}

	const latitude = Number(latitudeParam);
	const longitude = Number(longitudeParam);

	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
		return failure('Latitude and longitude must be numbers', 400);
	}

	if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
		return failure('Latitude or longitude out of range', 400);
	}

	const key = cacheKey(latitude, longitude);
	const cached = cache.get(key);

	if (cached) {
		return respond(cached, 'HIT');
	}

	// Query the rounded coordinates so the upstream answer matches the cache key.
	const [roundedLatitude, roundedLongitude] = key.split(',');

	const endpoint = new URL('https://nominatim.openstreetmap.org/reverse');
	endpoint.searchParams.set('lat', roundedLatitude);
	endpoint.searchParams.set('lon', roundedLongitude);
	endpoint.searchParams.set('format', 'jsonv2');
	endpoint.searchParams.set('accept-language', 'en');

	try {
		const response = await fetch(endpoint, {
			headers: {
				'User-Agent': 'Weather-app/1.0 (SvelteKit reverse geocoding proxy)'
			}
		});

		if (!response.ok) {
			console.error('[reverse-geocode] Provider request failed', {
				url: endpoint.toString(),
				latitude,
				longitude,
				status: response.status,
				statusText: response.statusText
			});

			return failure('Failed to resolve location', 502);
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

		cache.set(key, result);

		return respond(result, 'MISS');
	} catch (error) {
		console.error('[reverse-geocode] Request crashed', {
			url: endpoint.toString(),
			latitude,
			longitude,
			error
		});

		return failure('Reverse geocoding failed unexpectedly', 500);
	}
};
