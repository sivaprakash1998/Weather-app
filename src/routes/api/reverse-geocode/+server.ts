import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type ReverseGeocodeResponse = {
	results: Array<{
		name: string;
	}>;
};

// Place names are effectively static, so we can cache hard.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// 3 decimals is roughly 110m. Small enough that the resolved city/town name is
// still correct near a boundary, large enough to absorb normal GPS jitter.
const COORD_PRECISION = 3;

const cache = new Map<string, { name: string; expiresAt: number }>();

function cacheKey(latitude: number, longitude: number) {
	return `${latitude.toFixed(COORD_PRECISION)},${longitude.toFixed(COORD_PRECISION)}`;
}

function readCache(key: string) {
	const hit = cache.get(key);

	if (!hit) return null;

	if (hit.expiresAt <= Date.now()) {
		cache.delete(key);
		return null;
	}

	// Re-insert so the Map's insertion order doubles as LRU recency.
	cache.delete(key);
	cache.set(key, hit);

	return hit.name;
}

function writeCache(key: string, name: string) {
	cache.delete(key);
	cache.set(key, { name, expiresAt: Date.now() + CACHE_TTL_MS });

	while (cache.size > CACHE_MAX_ENTRIES) {
		const oldest = cache.keys().next().value;

		if (oldest === undefined) break;

		cache.delete(oldest);
	}
}

function respond(name: string, cacheStatus: 'HIT' | 'MISS') {
	const result: ReverseGeocodeResponse = {
		results: [{ name }]
	};

	return json(result, {
		headers: {
			'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
			'X-Cache': cacheStatus
		}
	});
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
	const cached = readCache(key);

	if (cached !== null) {
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
		const address = payload?.address ?? {};

		const name =
			address.city ??
			address.town ??
			address.village ??
			address.county ??
			payload?.name ??
			payload?.display_name?.split(',')?.[0] ??
			'Unknown location';

		writeCache(key, name);

		return respond(name, 'MISS');
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
