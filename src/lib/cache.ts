/**
 * Small localStorage-backed LRU with a TTL. This is the client-side twin of
 * the server cache used when the app ran with a Node backend - ported here
 * because the Capacitor build ships no server at all, so caching has to live
 * on the device.
 *
 * localStorage can throw (private/incognito mode, blocked site data, storage
 * quota) or simply be unavailable, so every access is wrapped in try/catch
 * and falls back to acting like an empty, no-op cache.
 */
type Entry<T> = { value: T; expiresAt: number };

export type Cache<T> = {
	get(key: string): T | null;
	set(key: string, value: T): void;
};

function readStore<T>(storageKey: string): Record<string, Entry<T>> {
	try {
		const raw = localStorage.getItem(storageKey);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function writeStore<T>(storageKey: string, store: Record<string, Entry<T>>) {
	try {
		localStorage.setItem(storageKey, JSON.stringify(store));
	} catch {
		// Quota exceeded or storage blocked. The cache just won't persist this write.
	}
}

export function createCache<T>({
	storageKey,
	ttlMs,
	maxEntries
}: {
	storageKey: string;
	ttlMs: number;
	maxEntries: number;
}): Cache<T> {
	return {
		get(key) {
			const store = readStore<T>(storageKey);
			const hit = store[key];

			if (!hit) return null;

			if (hit.expiresAt <= Date.now()) {
				delete store[key];
				writeStore(storageKey, store);
				return null;
			}

			return hit.value;
		},

		set(key, value) {
			const store = readStore<T>(storageKey);
			store[key] = { value, expiresAt: Date.now() + ttlMs };

			const keys = Object.keys(store);

			if (keys.length > maxEntries) {
				// Insertion order in a plain object follows string-key insertion,
				// which is close enough to LRU for a cache this small.
				const overflow = keys.length - maxEntries;
				for (const staleKey of keys.slice(0, overflow)) delete store[staleKey];
			}

			writeStore(storageKey, store);
		}
	};
}
