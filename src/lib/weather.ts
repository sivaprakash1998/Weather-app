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

export type Coordinates = { latitude: number; longitude: number };

// Place search and reverse geocoding call Photon/Nominatim directly - see
// geocode.ts for why, and for the ranking and fallback logic.
export {
	searchCity,
	getLocationName,
	type GeocodeResult,
	type ReverseGeocodeResult
} from './geocode';

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
