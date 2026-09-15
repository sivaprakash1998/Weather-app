export type CurrentWeather = {
	temperature_2m: number;
	apparent_temperature: number;
	relative_humidity_2m: number;
	wind_speed_10m: number;
	weather_code: number;
	is_day: number;
};

export type DailyWeather = {
	time: string[];
	weather_code: number[];
	temperature_2m_max: number[];
	temperature_2m_min: number[];
	precipitation_probability_max: Array<number | null>;
	uv_index_max: Array<number | null>;
	sunrise: string[];
	sunset: string[];
};

export type WeatherResponse = {
	timezone: string;
	current: CurrentWeather;
	daily: DailyWeather;
};

/** A place from /api/search, which proxies Photon (OpenStreetMap data). */
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

export type Coordinates = { latitude: number; longitude: number };

function isAbort(error: unknown) {
	return (error as Error)?.name === 'AbortError';
}

export async function getWeather(
	latitude: number,
	longitude: number,
	signal?: AbortSignal
): Promise<WeatherResponse> {
	const url = new URL('https://api.open-meteo.com/v1/forecast');

	url.searchParams.set('latitude', latitude.toString());
	url.searchParams.set('longitude', longitude.toString());
	url.searchParams.set(
		'current',
		'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day'
	);
	url.searchParams.set(
		'daily',
		'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max,sunrise,sunset'
	);
	url.searchParams.set('forecast_days', '5');
	url.searchParams.set('timezone', 'auto');

	try {
		const response = await fetch(url, { signal });

		if (!response.ok) {
			console.error('[weather] Failed to fetch weather', {
				url: url.toString(),
				latitude,
				longitude,
				status: response.status,
				statusText: response.statusText
			});

			throw new Error('Failed to fetch weather');
		}

		return (await response.json()) as WeatherResponse;
	} catch (error) {
		if (isAbort(error)) throw error;

		console.error('[weather] Weather API call crashed', {
			url: url.toString(),
			latitude,
			longitude,
			error
		});

		throw error;
	}
}

export async function getLocationName(
	latitude: number,
	longitude: number,
	signal?: AbortSignal
): Promise<{ results: ReverseGeocodeResult[] }> {
	const url = new URLSearchParams({
		latitude: latitude.toString(),
		longitude: longitude.toString()
	});

	const requestUrl = `/api/reverse-geocode?${url.toString()}`;

	try {
		const response = await fetch(requestUrl, { signal });

		if (!response.ok) {
			console.error('[weather] Failed to fetch location name', {
				url: requestUrl,
				latitude,
				longitude,
				status: response.status,
				statusText: response.statusText
			});

			throw new Error('Failed to fetch location name');
		}

		return await response.json();
	} catch (error) {
		if (isAbort(error)) throw error;

		console.error('[weather] Reverse geocoding API call crashed', {
			url: requestUrl,
			latitude,
			longitude,
			error
		});

		throw error;
	}
}

/**
 * Searches places via our own proxy rather than Open-Meteo's geocoder, which is
 * backed by GeoNames and has no record of smaller villages. Passing `near`
 * biases results towards the user, so a local village outranks a distant place
 * with the same name.
 */
export async function searchCity(
	cityName: string,
	near?: Coordinates | null,
	signal?: AbortSignal
): Promise<{ results?: GeocodeResult[] }> {
	const params = new URLSearchParams({ q: cityName });

	if (near) {
		params.set('lat', near.latitude.toString());
		params.set('lon', near.longitude.toString());
	}

	const requestUrl = `/api/search?${params.toString()}`;

	try {
		const response = await fetch(requestUrl, { signal });

		if (!response.ok) {
			console.error('[weather] Failed to search places', {
				url: requestUrl,
				cityName,
				status: response.status,
				statusText: response.statusText
			});

			throw new Error('Failed to search places');
		}

		return await response.json();
	} catch (error) {
		if (isAbort(error)) throw error;

		console.error('[weather] Place search crashed', { url: requestUrl, cityName, error });

		throw error;
	}
}
