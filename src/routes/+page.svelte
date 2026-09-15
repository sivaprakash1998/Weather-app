<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocationName, getWeather, searchCity } from '$lib/weather';

	type ForecastDay = {
		day: string;
		icon: string;
		high: number;
		low: number;
	};

	type SearchResult = {
		name: string;
		latitude: number;
		longitude: number;
		country: string;
		admin1?: string;
	};

	let city = $state('Getting location...');
	let searchQuery = $state('');
	let isSearching = $state(false);
	let isLoadingWeather = $state(true);
	let weatherError = $state('');
	let searchResults = $state<SearchResult[]>([]);

	let temperature = $state(0);
	let condition = $state('Loading...');
	let humidity = $state(0);
	let windSpeed = $state(0);
	let forecast = $state<ForecastDay[]>([]);

	function getWeatherCondition(code: number) {
		if (code === 0) return 'Clear Sky';
		if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
		if ([45, 48].includes(code)) return 'Foggy';
		if ([51, 53, 55].includes(code)) return 'Drizzle';
		if ([61, 63, 65].includes(code)) return 'Rain';
		if ([71, 73, 75].includes(code)) return 'Snow';
		if ([80, 81, 82].includes(code)) return 'Rain Showers';
		if ([95, 96, 99].includes(code)) return 'Thunderstorm';

		return 'Unknown';
	}

	function getWeatherIcon(code: number) {
		if (code === 0) return '☀️';
		if ([1, 2, 3].includes(code)) return '⛅';
		if ([45, 48].includes(code)) return '🌫️';
		if ([51, 53, 55].includes(code)) return '🌦️';
		if ([61, 63, 65].includes(code)) return '🌧️';
		if ([71, 73, 75].includes(code)) return '❄️';
		if ([80, 81, 82].includes(code)) return '🌦️';
		if ([95, 96, 99].includes(code)) return '⛈️';

		return '🌤️';
	}

	async function loadWeather(latitude: number, longitude: number, selectedCity?: string) {
		isLoadingWeather = true;
		weatherError = '';

		if (selectedCity) {
			city = selectedCity;
		}

		try {
			const data = await getWeather(latitude, longitude);

			temperature = Math.round(data.current.temperature_2m);
			humidity = data.current.relative_humidity_2m;
			windSpeed = Math.round(data.current.wind_speed_10m);
			condition = getWeatherCondition(data.current.weather_code);

			forecast = data.daily.time.map((date: string, index: number) => ({
				day: new Date(date).toLocaleDateString('en-US', { weekday: 'short' }),
				icon: getWeatherIcon(data.daily.weather_code[index]),
				high: Math.round(data.daily.temperature_2m_max[index]),
				low: Math.round(data.daily.temperature_2m_min[index])
			}));

			if (!selectedCity) {
				try {
					const locationData = await getLocationName(latitude, longitude);
					city = locationData.results?.[0]?.name ?? 'Unknown location';
				} catch (error) {
					console.error('Location name lookup failed:', error);
					city = 'Unknown location';
				}
			}
		} catch (error) {
			console.error('Weather load failed:', error);
			weatherError = 'Unable to load weather details right now. Please try again.';
			condition = 'Unable to load weather';
		} finally {
			isLoadingWeather = false;
		}
	}

	async function handleSearch() {
		if (!searchQuery.trim()) return;

		isSearching = true;

		try {
			const data = await searchCity(searchQuery.trim());
			searchResults = data.results ?? [];
		} catch (error) {
			console.error('City search failed:', error);
			searchResults = [];
		} finally {
			isSearching = false;
		}
	}

	async function useCurrentLocation() {
		searchResults = [];
		if (!navigator.geolocation) {
			condition = 'Location not supported';
			city = 'Location unavailable';
			weatherError = 'Your browser does not support geolocation.';
			isLoadingWeather = false;
			return;
		}

		city = 'Getting location...';

		navigator.geolocation.getCurrentPosition(
			async (position) => {
				const { latitude, longitude } = position.coords;
				await loadWeather(latitude, longitude);
			},
			(error) => {
				console.error('Location error:', error);
				condition = 'Unable to get location';
				city = 'Location unavailable';
				weatherError = 'Location access was denied or unavailable.';
				isLoadingWeather = false;
			}
		);
	}

	async function selectSearchResult(result: SearchResult) {
		searchQuery = '';
		searchResults = [];
		await loadWeather(result.latitude, result.longitude, result.name);
	}

	onMount(async () => {
		await useCurrentLocation();
	});
</script>

<svelte:head>
	<title>Weather | DaisyUI Edition</title>
	<meta
		name="description"
		content="Responsive weather experience with DaisyUI components and real-time city search"
	/>
</svelte:head>

<main class="weather-page">
	<div class="weather-shell weather-grid">
		<section class="glass-panel panel hero-panel">
			<div class="hero-head">
				<div>
					<p class="eyebrow">LIVE WEATHER</p>
					<h1>SkyPulse</h1>
				</div>
				<button class="location-btn" onclick={useCurrentLocation} aria-label="Use current location"
					>📍</button
				>
			</div>

			<div class="search-row">
				<input
					class="search-input"
					bind:value={searchQuery}
					placeholder="Search city..."
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							handleSearch();
						}
					}}
				/>
				<button class="search-btn" onclick={handleSearch} aria-label="Search city">
					{#if isSearching}
						<span class="loader-dot" aria-hidden="true"></span>
						Searching
					{:else}
						Search
					{/if}
				</button>
			</div>

			{#if searchResults.length > 0}
				<div class="results-panel glass-panel">
					{#each searchResults as result (result.name + '-' + result.latitude + '-' + result.longitude)}
						<button class="result-item" onclick={() => selectSearchResult(result)}>
							<strong>{result.name}</strong>
							<small>{result.admin1 ? `${result.admin1}, ` : ''}{result.country}</small>
						</button>
					{/each}
				</div>
			{/if}

			{#if weatherError}
				<div class="error-banner">{weatherError}</div>
			{/if}

			<div class="current-card {isLoadingWeather ? 'loading-shimmer' : ''}">
				<div class="city-row">
					<p>📍 {city}</p>
					{#if isLoadingWeather}
						<span class="pulse-pill">Updating…</span>
					{/if}
				</div>
				<div class="temp-wrap">
					<span class="float-gentle weather-emoji">{forecast[0]?.icon ?? '🌤️'}</span>
					<h2>{temperature}°</h2>
				</div>
				<p class="condition-tag">{condition}</p>
			</div>
		</section>

		<section class="metrics-column">
			<div class="glass-panel panel stat-grid">
				<div class="stat-card">
					<span>Humidity</span>
					<strong>{humidity}%</strong>
					<small>Air moisture</small>
				</div>
				<div class="stat-card">
					<span>Wind</span>
					<strong>{windSpeed} km/h</strong>
					<small>Current speed</small>
				</div>
				<div class="stat-card">
					<span>Status</span>
					<strong>{isLoadingWeather ? 'Updating...' : 'Ready'}</strong>
					<small>Live sync</small>
				</div>
			</div>

			<div class="glass-panel panel">
				<div class="forecast-head">
					<h3>5 Day Forecast</h3>
					<span>Next days</span>
				</div>

				<div class="forecast-list">
					{#if forecast.length === 0 && isLoadingWeather}
						<div class="forecast-skeleton loading-shimmer"></div>
						<div class="forecast-skeleton loading-shimmer"></div>
						<div class="forecast-skeleton loading-shimmer"></div>
						<div class="forecast-skeleton loading-shimmer"></div>
					{:else}
						{#each forecast as day (day.day)}
							<div class="forecast-item">
								<div>
									<span class="icon">{day.icon}</span>
									<strong>{day.day}</strong>
								</div>
								<p>{day.high}° / {day.low}°</p>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</section>
	</div>
</main>

<style>
	.weather-page {
		min-height: 100vh;
		padding: clamp(1rem, 2vw, 2rem);
	}

	.weather-grid {
		max-width: 1080px;
		margin: 0 auto;
		display: grid;
		gap: 1.25rem;
		grid-template-columns: 1fr;
	}

	.panel {
		border: 1px solid rgba(79, 70, 229, 0.18);
		border-radius: 1.4rem;
		padding: 1.2rem;
		box-shadow: 0 16px 45px rgba(15, 23, 42, 0.13);
	}

	.hero-panel {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.hero-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.eyebrow {
		letter-spacing: 0.15em;
		font-size: 0.78rem;
		font-weight: 800;
		margin: 0;
	}

	h1 {
		font-size: clamp(2rem, 4vw, 2.8rem);
		margin: 0.2rem 0 0;
		line-height: 1;
	}

	.location-btn {
		border: 0;
		background: linear-gradient(135deg, #5b6cff, #22d3ee);
		color: white;
		width: 2.8rem;
		height: 2.8rem;
		border-radius: 999px;
		cursor: pointer;
		font-size: 1.1rem;
		box-shadow: 0 10px 25px rgba(91, 108, 255, 0.35);
	}

	.search-row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.7rem;
	}

	.search-input {
		width: 100%;
		border: 1px solid rgba(148, 163, 184, 0.4);
		border-radius: 0.9rem;
		padding: 0.82rem 0.95rem;
		font-size: 1rem;
		outline: none;
		background: rgba(255, 255, 255, 0.9);
	}

	.search-input:focus {
		border-color: rgba(91, 108, 255, 0.7);
		box-shadow: 0 0 0 3px rgba(91, 108, 255, 0.16);
	}

	.search-btn {
		border: 0;
		border-radius: 0.9rem;
		padding: 0.82rem 1rem;
		font-weight: 700;
		cursor: pointer;
		background: linear-gradient(135deg, #4338ca, #5b6cff);
		color: #fff;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
	}

	.loader-dot {
		width: 0.9rem;
		height: 0.9rem;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 999px;
		animation: spin 0.8s linear infinite;
	}

	.results-panel {
		border-radius: 1rem;
		overflow: hidden;
		border: 1px solid rgba(148, 163, 184, 0.25);
	}

	.result-item {
		width: 100%;
		border: 0;
		background: transparent;
		padding: 0.8rem 0.9rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		cursor: pointer;
	}

	.result-item:hover {
		background: rgba(91, 108, 255, 0.08);
	}

	.result-item small {
		opacity: 0.75;
	}

	.error-banner {
		border-radius: 0.9rem;
		padding: 0.75rem 0.9rem;
		background: rgba(239, 68, 68, 0.14);
		color: #b91c1c;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.current-card {
		border-radius: 1.2rem;
		padding: 1.1rem;
		background: linear-gradient(145deg, #4f46e5 0%, #0ea5e9 55%, #14b8a6 100%);
		color: white;
	}

	.city-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.8rem;
	}

	.city-row p {
		margin: 0;
		font-weight: 600;
	}

	.pulse-pill {
		font-size: 0.75rem;
		font-weight: 700;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.22);
		animation: pulse 1.6s infinite;
	}

	.temp-wrap {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		margin: 0.7rem 0;
	}

	.weather-emoji {
		font-size: 2rem;
	}

	.temp-wrap h2 {
		font-size: clamp(3rem, 8vw, 4.6rem);
		line-height: 1;
		margin: 0;
	}

	.condition-tag {
		margin: 0;
		text-align: center;
		font-weight: 600;
		opacity: 0.92;
	}

	.metrics-column {
		display: grid;
		gap: 1.25rem;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.7rem;
	}

	.stat-card {
		border-radius: 1rem;
		padding: 0.9rem;
		background: rgba(255, 255, 255, 0.74);
		display: grid;
		gap: 0.2rem;
	}

	.stat-card span {
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.stat-card strong {
		font-size: 1.35rem;
	}

	.stat-card small {
		opacity: 0.7;
	}

	.forecast-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.8rem;
	}

	.forecast-head h3 {
		margin: 0;
		font-size: 1.55rem;
	}

	.forecast-head span {
		font-size: 0.9rem;
		opacity: 0.7;
	}

	.forecast-list {
		display: grid;
		gap: 0.65rem;
	}

	.forecast-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.85rem 0.95rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.22);
		background: rgba(255, 255, 255, 0.85);
		transition:
			transform 0.25s ease,
			box-shadow 0.25s ease;
	}

	.forecast-item:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 24px rgba(15, 23, 42, 0.1);
	}

	.forecast-item .icon {
		margin-right: 0.6rem;
		font-size: 1.25rem;
	}

	.forecast-item p {
		margin: 0;
		font-weight: 700;
	}

	.forecast-skeleton {
		height: 4rem;
		border-radius: 1rem;
		background: rgba(226, 232, 240, 0.68);
	}

	@media (max-width: 680px) {
		.stat-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (min-width: 960px) {
		.weather-grid {
			grid-template-columns: 1.08fr 0.92fr;
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.65;
		}
		50% {
			opacity: 1;
		}
	}
</style>
