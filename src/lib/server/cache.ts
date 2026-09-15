/**
 * Small in-memory LRU with a TTL, shared by the geocoding proxies so we stay
 * well inside the upstream providers' rate limits.
 *
 * This lives per server instance: on a serverless platform each cold start
 * begins empty, which is why the routes also send Cache-Control headers.
 */
export type Cache<T> = {
	get(key: string): T | null;
	set(key: string, value: T): void;
	readonly size: number;
};

export function createCache<T>({
	ttlMs,
	maxEntries
}: {
	ttlMs: number;
	maxEntries: number;
}): Cache<T> {
	const store = new Map<string, { value: T; expiresAt: number }>();

	return {
		get(key) {
			const hit = store.get(key);

			if (!hit) return null;

			if (hit.expiresAt <= Date.now()) {
				store.delete(key);
				return null;
			}

			// Re-insert so the Map's insertion order doubles as LRU recency.
			store.delete(key);
			store.set(key, hit);

			return hit.value;
		},

		set(key, value) {
			store.delete(key);
			store.set(key, { value, expiresAt: Date.now() + ttlMs });

			while (store.size > maxEntries) {
				const oldest = store.keys().next().value;

				if (oldest === undefined) break;

				store.delete(oldest);
			}
		},

		get size() {
			return store.size;
		}
	};
}
