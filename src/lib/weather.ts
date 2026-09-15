export async function getWeather(latitude: number, longitude: number) {
	const url = new URL('https://api.open-meteo.com/v1/forecast');

	url.searchParams.set('latitude', latitude.toString());
	url.searchParams.set('longitude', longitude.toString());
	url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code');
	url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
	url.searchParams.set('forecast_days', '5');
	url.searchParams.set('timezone', 'auto');

	try {
		const response = await fetch(url);

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

		return response.json();
	} catch (error) {
		console.error('[weather] Weather API call crashed', {
			url: url.toString(),
			latitude,
			longitude,
			error
		});

		throw error;
	}
}

export async function getLocationName(latitude: number, longitude: number) {
	const url = new URLSearchParams({
		latitude: latitude.toString(),
		longitude: longitude.toString()
	});

	const requestUrl = `/api/reverse-geocode?${url.toString()}`;

	try {
		const response = await fetch(requestUrl);

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

		return response.json();
	} catch (error) {
		console.error('[weather] Reverse geocoding API call crashed', {
			url: requestUrl,
			latitude,
			longitude,
			error
		});

		throw error;
	}
}

export async function searchCity(cityName: string) {
	const url = new URL(
		'https://geocoding-api.open-meteo.com/v1/search'
	);

	url.searchParams.set('name', cityName);
	url.searchParams.set('count', '5');
	url.searchParams.set('language', 'en');
	url.searchParams.set('format', 'json');

	const response = await fetch(url);

	if (!response.ok) {
		throw new Error('Failed to search city');
	}

	return response.json();
}