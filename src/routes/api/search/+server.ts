import { json } from '@sveltejs/kit';
import { createCache } from '$lib/server/cache';
import type { RequestHandler } from './$types';

export type SearchResult = {
	id: string;
	name: string;
	latitude: number;
	longitude: number;
	region: string;
	country: string;
};

// Place names barely change, but bias-dependent ordering does, so this is
// shorter-lived than the reverse-geocode cache.
const cache = createCache<SearchResult[]>({ ttlMs: 6 * 60 * 60 * 1000, maxEntries: 300 });

const MIN_QUERY = 2;
const MAX_QUERY = 120;

// Ask for more than we return so ranking has something to work with.
const UPSTREAM_LIMIT = 20;
const RESULT_LIMIT = 6;

/**
 * Photon mixes places, streets and buildings into one relevance list, and its
 * fuzzy matching can rank a *similarly* named village above an *exact* match
 * that happens to be tagged as something smaller (a bus stop, a road). Some
 * real villages - Kokkampalayam among them - are only mapped in OSM as a named
 * amenity, with no place node of their own.
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
function distanceKm(a: { latitude: number; longitude: number }, b: [number, number]) {
	const [lon2, lat2] = b;
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(lat2 - a.latitude);
	const dLon = toRad(lon2 - a.longitude);
	const sinLat = Math.sin(dLat / 2);
	const sinLon = Math.sin(dLon / 2);
	const h = sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
	return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function toResult(feature: PhotonFeature): SearchResult | null {
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

function failure(message: string, status: number) {
	return json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';

	if (query.length < MIN_QUERY) {
		return failure(`Query must be at least ${MIN_QUERY} characters`, 400);
	}

	if (query.length > MAX_QUERY) {
		return failure('Query is too long', 400);
	}

	// Optional bias towards where the user already is, so nearby villages
	// outrank identically named places on the other side of the world.
	const latitude = Number(url.searchParams.get('lat'));
	const longitude = Number(url.searchParams.get('lon'));
	const hasBias =
		Number.isFinite(latitude) &&
		Number.isFinite(longitude) &&
		latitude >= -90 &&
		latitude <= 90 &&
		longitude >= -180 &&
		longitude <= 180;

	// One decimal (~11km) is plenty for a bias and keeps the cache useful.
	const key = hasBias
		? `${query.toLowerCase()}|${latitude.toFixed(1)},${longitude.toFixed(1)}`
		: query.toLowerCase();

	const cached = cache.get(key);

	if (cached) {
		return json(
			{ results: cached },
			{ headers: { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' } }
		);
	}

	const endpoint = new URL('https://photon.komoot.io/api/');
	endpoint.searchParams.set('q', query);
	endpoint.searchParams.set('limit', String(UPSTREAM_LIMIT));
	endpoint.searchParams.set('lang', 'en');

	if (hasBias) {
		endpoint.searchParams.set('lat', latitude.toFixed(4));
		endpoint.searchParams.set('lon', longitude.toFixed(4));
	}

	try {
		const response = await fetch(endpoint, {
			headers: { 'User-Agent': 'Weather-app/1.0 (SvelteKit geocoding proxy)' }
		});

		if (!response.ok) {
			console.error('[search] Provider request failed', {
				url: endpoint.toString(),
				query,
				status: response.status,
				statusText: response.statusText
			});

			return failure('Place search is unavailable right now', 502);
		}

		const payload = await response.json();
		const features: PhotonFeature[] = Array.isArray(payload?.features) ? payload.features : [];

		const bias = hasBias ? { latitude, longitude } : null;
		const normalizedQuery = query.trim().toLowerCase();

		const seen = new Set<string>();
		const results = features
			.map((feature) => {
				const coords = feature.geometry?.coordinates;
				const name = feature.properties?.name?.toLowerCase();
				return {
					feature,
					isExactMatch: name === normalizedQuery,
					rank: rankOf(feature.properties?.osm_key),
					distance: bias && coords ? distanceKm(bias, coords) : null
				};
			})
			.sort((a, b) => {
				if (a.isExactMatch !== b.isExactMatch) return a.isExactMatch ? -1 : 1;
				if (a.rank !== b.rank) return a.rank - b.rank;
				if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
				return 0; // no bias: keep Photon's own relevance order within the tier
			})
			.map(({ feature }) => toResult(feature))
			.filter((result): result is SearchResult => result !== null)
			.filter((result) => {
				const fingerprint = `${result.name}|${result.region}|${result.country}`;

				if (seen.has(fingerprint)) return false;

				seen.add(fingerprint);
				return true;
			})
			.slice(0, RESULT_LIMIT);

		cache.set(key, results);

		return json(
			{ results },
			{ headers: { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' } }
		);
	} catch (error) {
		console.error('[search] Request crashed', { url: endpoint.toString(), query, error });

		return failure('Place search failed unexpectedly', 500);
	}
};
