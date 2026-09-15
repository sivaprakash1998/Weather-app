<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import {
		getLocationName,
		getWeather,
		searchCity,
		type CurrentWeather,
		type Coordinates,
		type GeocodeResult
	} from '$lib/weather';

	type ForecastDay = {
		date: string;
		label: string;
		icon: string;
		high: number;
		low: number;
		rain: number | null;
	};

	// WMO weather codes. The old mapping silently fell through to "Unknown" for
	// freezing rain, snow grains and snow showers, and labelled overcast as
	// "Partly Cloudy", so this table covers the full set Open-Meteo returns.
	const WEATHER_CODES: Record<number, { label: string; icon: string; night?: string }> = {
		0: { label: 'Clear sky', icon: '☀️', night: '🌙' },
		1: { label: 'Mainly clear', icon: '🌤️', night: '🌙' },
		2: { label: 'Partly cloudy', icon: '⛅', night: '☁️' },
		3: { label: 'Overcast', icon: '☁️' },
		45: { label: 'Foggy', icon: '🌫️' },
		48: { label: 'Rime fog', icon: '🌫️' },
		51: { label: 'Light drizzle', icon: '🌦️' },
		53: { label: 'Drizzle', icon: '🌦️' },
		55: { label: 'Dense drizzle', icon: '🌧️' },
		56: { label: 'Freezing drizzle', icon: '🌧️' },
		57: { label: 'Freezing drizzle', icon: '🌧️' },
		61: { label: 'Light rain', icon: '🌦️' },
		63: { label: 'Rain', icon: '🌧️' },
		65: { label: 'Heavy rain', icon: '🌧️' },
		66: { label: 'Freezing rain', icon: '🌧️' },
		67: { label: 'Freezing rain', icon: '🌧️' },
		71: { label: 'Light snow', icon: '🌨️' },
		73: { label: 'Snow', icon: '❄️' },
		75: { label: 'Heavy snow', icon: '❄️' },
		77: { label: 'Snow grains', icon: '🌨️' },
		80: { label: 'Light showers', icon: '🌦️' },
		81: { label: 'Showers', icon: '🌧️' },
		82: { label: 'Violent showers', icon: '⛈️' },
		85: { label: 'Snow showers', icon: '🌨️' },
		86: { label: 'Heavy snow showers', icon: '🌨️' },
		95: { label: 'Thunderstorm', icon: '⛈️' },
		96: { label: 'Thunderstorm, hail', icon: '⛈️' },
		99: { label: 'Severe thunderstorm', icon: '⛈️' }
	};

	let city = $state('');
	let region = $state('');
	let current = $state<CurrentWeather | null>(null);
	let forecast = $state<ForecastDay[]>([]);
	let sunrise = $state('');
	let sunset = $state('');
	let uvIndex = $state<number | null>(null);
	let timezone = $state('');
	let lastUpdated = $state<Date | null>(null);
	// Last resolved position, used to bias place search towards the user.
	let lastCoords = $state<Coordinates | null>(null);

	let isLoadingWeather = $state(true);
	let weatherError = $state('');

	let searchQuery = $state('');
	let searchResults = $state<GeocodeResult[]>([]);
	let isSearching = $state(false);
	let searchMessage = $state('');
	let searchOpen = $state(false);
	let searchContainer = $state<HTMLElement>();

	let theme = $state<'light' | 'dark'>('light');

	// Guards against a slow earlier response overwriting a newer one.
	let weatherRequest: AbortController | null = null;
	let searchRequest: AbortController | null = null;

	const temperature = new Tween(0, { duration: 900, easing: cubicOut });

	const condition = $derived(current ? describe(current.weather_code, current.is_day).label : '');
	const conditionIcon = $derived(
		current ? describe(current.weather_code, current.is_day).icon : ''
	);

	// Shared scale so every forecast bar is comparable against the others.
	const scale = $derived.by(() => {
		if (forecast.length === 0) return { min: 0, span: 1 };

		const min = Math.min(...forecast.map((day) => day.low));
		const max = Math.max(...forecast.map((day) => day.high));

		return { min, span: max === min ? 1 : max - min };
	});

	// Fixed-length placeholder list for the forecast loading state.
	const SKELETON_ROWS = [0, 1, 2, 3, 4];

	const stats = $derived([
		{
			icon: '🌡️',
			title: 'Feels like',
			value: current ? `${Math.round(current.apparent_temperature)}°` : null,
			desc: 'Apparent temp'
		},
		{
			icon: '💧',
			title: 'Humidity',
			value: current ? `${current.relative_humidity_2m}%` : null,
			desc: 'Air moisture'
		},
		{
			icon: '💨',
			title: 'Wind',
			value: current ? `${Math.round(current.wind_speed_10m)}` : null,
			desc: 'km/h at 10m'
		},
		{
			icon: '☀️',
			title: 'UV index',
			value: uvIndex !== null ? `${Math.round(uvIndex)}` : null,
			desc: 'Max today'
		}
	]);

	function describe(code: number, isDay = 1) {
		const entry = WEATHER_CODES[code] ?? { label: 'Unknown', icon: '🌤️' };

		return { label: entry.label, icon: isDay === 0 && entry.night ? entry.night : entry.icon };
	}

	function formatClock(value: string | Date) {
		const date = typeof value === 'string' ? new Date(value) : value;

		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function isAbort(error: unknown) {
		return (error as Error)?.name === 'AbortError';
	}

	async function loadWeather(
		latitude: number,
		longitude: number,
		selectedCity?: string,
		selectedRegion?: string
	) {
		weatherRequest?.abort();

		const controller = new AbortController();
		weatherRequest = controller;

		isLoadingWeather = true;
		weatherError = '';
		lastCoords = { latitude, longitude };

		if (selectedCity) {
			city = selectedCity;
			region = selectedRegion ?? '';
		}

		try {
			const data = await getWeather(latitude, longitude, controller.signal);

			if (controller.signal.aborted) return;

			current = data.current;
			timezone = data.timezone ?? '';
			uvIndex = data.daily.uv_index_max?.[0] ?? null;
			sunrise = data.daily.sunrise?.[0] ?? '';
			sunset = data.daily.sunset?.[0] ?? '';

			forecast = data.daily.time.map((date, index) => ({
				date,
				// Parsed as local midnight, not UTC, so the weekday never slips a day.
				label: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
				icon: describe(data.daily.weather_code[index]).icon,
				high: Math.round(data.daily.temperature_2m_max[index]),
				low: Math.round(data.daily.temperature_2m_min[index]),
				rain: data.daily.precipitation_probability_max?.[index] ?? null
			}));

			temperature.set(Math.round(data.current.temperature_2m), {
				duration: prefersReducedMotion.current ? 0 : 900
			});

			lastUpdated = new Date();

			if (!selectedCity) {
				try {
					const locationData = await getLocationName(latitude, longitude, controller.signal);

					if (!controller.signal.aborted) {
						const place = locationData.results?.[0];
						city = place?.name ?? 'Unknown location';
						region = place ? [place.region, place.country].filter(Boolean).join(', ') : '';
					}
				} catch (error) {
					if (isAbort(error)) return;

					console.error('Location name lookup failed:', error);
					city = 'Unknown location';
				}
			}
		} catch (error) {
			if (isAbort(error)) return;

			console.error('Weather load failed:', error);
			weatherError = 'Unable to load weather right now. Please try again.';
		} finally {
			if (weatherRequest === controller) {
				isLoadingWeather = false;
				weatherRequest = null;
			}
		}
	}

	async function handleSearch() {
		const query = searchQuery.trim();

		if (!query) return;

		searchRequest?.abort();

		const controller = new AbortController();
		searchRequest = controller;

		isSearching = true;
		searchMessage = '';
		searchOpen = true;

		try {
			const data = await searchCity(query, lastCoords, controller.signal);

			if (controller.signal.aborted) return;

			searchResults = data.results ?? [];
			searchMessage = searchResults.length === 0 ? `No places found for ${query}.` : '';
		} catch (error) {
			if (isAbort(error)) return;

			console.error('City search failed:', error);
			searchResults = [];
			searchMessage = 'Search failed. Check your connection and try again.';
		} finally {
			if (searchRequest === controller) {
				isSearching = false;
				searchRequest = null;
			}
		}
	}

	async function selectSearchResult(result: GeocodeResult) {
		searchQuery = '';
		searchResults = [];
		searchMessage = '';
		searchOpen = false;

		const label = [result.region, result.country].filter(Boolean).join(', ');

		await loadWeather(result.latitude, result.longitude, result.name, label);
	}

	function useCurrentLocation() {
		searchOpen = false;

		if (!navigator.geolocation) {
			weatherError = 'Your browser does not support geolocation. Search for a city instead.';
			isLoadingWeather = false;
			return;
		}

		isLoadingWeather = true;
		weatherError = '';

		navigator.geolocation.getCurrentPosition(
			(position) => {
				const { latitude, longitude } = position.coords;
				loadWeather(latitude, longitude);
			},
			(error) => {
				console.error('Location error:', error);
				weatherError = 'Location access was denied. Search for a city instead.';
				isLoadingWeather = false;
			},
			{ timeout: 10000, maximumAge: 300000 }
		);
	}

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;

		try {
			localStorage.setItem('skypulse-theme', theme);
		} catch {
			// Private mode or blocked storage. The toggle still works for this visit.
		}
	}

	function handleWindowClick(event: MouseEvent) {
		if (!searchOpen || !searchContainer) return;

		if (!searchContainer.contains(event.target as Node)) {
			searchOpen = false;
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') searchOpen = false;
	}

	onMount(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		useCurrentLocation();
	});
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<svelte:head>
	<title>SkyPulse — Live Weather</title>
	<meta
		name="description"
		content="A fast, responsive weather app with current conditions, a 5 day forecast and city search."
	/>
</svelte:head>

<div class="min-h-dvh px-4 py-5 sm:px-6 lg:py-8">
	<div class="mx-auto flex max-w-6xl flex-col gap-5">
		<header class="navbar rise glass min-h-0 rounded-3xl px-3 py-2 shadow-lg">
			<div class="navbar-start gap-2.5">
				<span class="float-gentle text-3xl" aria-hidden="true">🌤️</span>
				<div>
					<p class="text-[0.6rem] font-bold tracking-[0.22em] opacity-55">LIVE WEATHER</p>
					<h1 class="text-xl leading-none font-black">SkyPulse</h1>
				</div>
			</div>

			<div class="navbar-end gap-1">
				<button
					class="btn btn-circle btn-ghost"
					onclick={useCurrentLocation}
					disabled={isLoadingWeather}
					aria-label="Refresh using my current location"
				>
					{#if isLoadingWeather}
						<span class="loading loading-spinner loading-sm"></span>
					{:else}
						<span class="text-lg" aria-hidden="true">🔄</span>
					{/if}
				</button>

				<label class="btn btn-circle btn-ghost swap swap-rotate">
					<input
						type="checkbox"
						checked={theme === 'dark'}
						onchange={toggleTheme}
						aria-label="Toggle dark mode"
					/>
					<span class="swap-off text-lg" aria-hidden="true">🌞</span>
					<span class="swap-on text-lg" aria-hidden="true">🌚</span>
				</label>
			</div>
		</header>

		<div class="rise relative z-20" style="--d:70ms" bind:this={searchContainer}>
			<div class="flex flex-col gap-2 sm:flex-row">
				<div class="join flex-1 shadow-lg">
					<input
						class="input join-item w-full"
						type="search"
						autocomplete="off"
						placeholder="Search any city…"
						aria-label="Search for a city"
						bind:value={searchQuery}
						onfocus={() => {
							if (searchResults.length > 0 || searchMessage) searchOpen = true;
						}}
						onkeydown={(event) => {
							if (event.key === 'Enter') handleSearch();
						}}
					/>
					<button
						class="btn join-item btn-primary"
						onclick={handleSearch}
						disabled={isSearching || !searchQuery.trim()}
					>
						{#if isSearching}
							<span class="loading loading-spinner loading-xs"></span>
							Searching
						{:else}
							Search
						{/if}
					</button>
				</div>

				<button class="btn btn-soft btn-secondary shadow-lg" onclick={useCurrentLocation}>
					<span aria-hidden="true">📍</span>
					My location
				</button>
			</div>

			{#if searchOpen && (searchResults.length > 0 || searchMessage)}
				<div
					class="bg-base-100 border-base-content/10 absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-2xl border shadow-2xl"
				>
					{#if searchResults.length > 0}
						<ul class="menu w-full p-2">
							{#each searchResults as result (result.id)}
								<li>
									<button
										class="flex flex-col items-start gap-0"
										onclick={() => selectSearchResult(result)}
									>
										<span class="font-semibold">{result.name}</span>
										<span class="text-xs opacity-65">
											{[result.region, result.country].filter(Boolean).join(', ')}
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="px-4 py-3 text-sm opacity-70">{searchMessage}</p>
					{/if}
				</div>
			{/if}
		</div>

		{#if weatherError}
			<div role="alert" class="alert alert-error rise shadow-lg">
				<span aria-hidden="true">⚠️</span>
				<span>{weatherError}</span>
				<button class="btn btn-sm btn-ghost" onclick={useCurrentLocation}>Retry</button>
			</div>
		{/if}

		<div class="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
			<section
				class="card hero-sky rise overflow-hidden text-white shadow-2xl {isLoadingWeather
					? 'sweep'
					: ''}"
				style="--d:120ms"
				aria-busy={isLoadingWeather}
			>
				<div class="card-body justify-between gap-5">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							{#if city}
								<h2 class="truncate text-2xl font-bold">{city}</h2>
								{#if region}
									<p class="truncate text-sm opacity-80">{region}</p>
								{/if}
							{:else}
								<div class="skeleton h-7 w-40 bg-white/25"></div>
							{/if}
						</div>

						{#if isLoadingWeather}
							<span class="badge badge-sm gap-1.5 border-0 bg-white/25 text-white">
								<span class="loading loading-spinner loading-xs"></span>
								Updating
							</span>
						{:else if lastUpdated}
							<span class="badge badge-sm border-0 bg-white/20 text-white">
								{formatClock(lastUpdated)}
							</span>
						{/if}
					</div>

					<div class="flex items-center justify-center gap-4 py-3">
						{#if current}
							<div class="relative grid place-items-center">
								<span class="halo absolute h-20 w-20 rounded-full bg-white/30 blur-2xl"></span>
								<span class="float-gentle relative text-6xl sm:text-7xl" aria-hidden="true">
									{conditionIcon}
								</span>
							</div>
							<p class="text-7xl leading-none font-black tracking-tight tabular-nums sm:text-8xl">
								{Math.round(temperature.current)}°
							</p>
						{:else}
							<div class="skeleton h-20 w-20 rounded-full bg-white/25"></div>
							<div class="skeleton h-20 w-36 bg-white/25"></div>
						{/if}
					</div>

					<div class="text-center">
						{#if current}
							<p class="text-lg font-semibold">{condition}</p>
							{#if forecast[0]}
								<p class="text-sm opacity-80">
									High {forecast[0].high}° · Low {forecast[0].low}°
								</p>
							{/if}
						{:else}
							<div class="skeleton mx-auto h-5 w-32 bg-white/25"></div>
						{/if}
					</div>

					{#if sunrise && sunset}
						<div class="mt-1 flex justify-center gap-6 border-t border-white/20 pt-3 text-sm">
							<span class="flex items-center gap-1.5">
								<span aria-hidden="true">🌅</span> Sunrise {formatClock(sunrise)}
							</span>
							<span class="flex items-center gap-1.5">
								<span aria-hidden="true">🌇</span> Sunset {formatClock(sunset)}
							</span>
						</div>
					{/if}
				</div>
			</section>

			<div class="flex flex-col gap-5">
				<div class="grid grid-cols-2 gap-3 sm:gap-4">
					{#each stats as stat, index (stat.title)}
						<div class="stats rise glass rounded-2xl shadow-lg" style="--d:{160 + index * 60}ms">
							<div class="stat gap-0.5 px-4 py-3">
								<div class="stat-figure text-xl opacity-80" aria-hidden="true">{stat.icon}</div>
								<div class="stat-title text-xs">{stat.title}</div>
								{#if stat.value !== null}
									<div class="stat-value text-2xl tabular-nums">{stat.value}</div>
								{:else}
									<div class="skeleton my-1 h-7 w-16"></div>
								{/if}
								<div class="stat-desc text-[0.7rem]">{stat.desc}</div>
							</div>
						</div>
					{/each}
				</div>

				<section class="card rise glass rounded-3xl shadow-lg" style="--d:400ms">
					<div class="card-body gap-3 p-4 sm:p-5">
						<div class="flex items-center justify-between gap-2">
							<h3 class="card-title text-lg">5-Day Forecast</h3>
							{#if timezone}
								<span class="badge badge-ghost badge-sm">{timezone.replace('_', ' ')}</span>
							{/if}
						</div>

						{#if forecast.length === 0}
							<div class="flex flex-col gap-2.5" aria-hidden="true">
								{#each SKELETON_ROWS as row (row)}
									<div class="skeleton h-11 w-full rounded-xl"></div>
								{/each}
							</div>
						{:else}
							<ul class="flex flex-col gap-1">
								{#each forecast as day, index (day.date)}
									<li
										class="hover:bg-base-content/5 flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors sm:gap-3"
									>
										<span class="w-9 text-sm font-semibold opacity-80">{day.label}</span>
										<span class="text-xl" aria-hidden="true">{day.icon}</span>
										<span class="text-info w-9 text-[0.7rem] font-medium tabular-nums">
											{day.rain !== null && day.rain > 15 ? `${day.rain}%` : ''}
										</span>
										<span class="w-8 text-right text-sm tabular-nums opacity-60">{day.low}°</span>
										<div class="bg-base-content/10 relative h-1.5 flex-1 rounded-full">
											<div
												class="bar-fill from-secondary to-accent absolute h-full rounded-full bg-gradient-to-r"
												style="left:{((day.low - scale.min) / scale.span) * 100}%; width:{Math.max(
													((day.high - day.low) / scale.span) * 100,
													6
												)}%; --d:{450 + index * 80}ms"
											></div>
										</div>
										<span class="w-8 text-sm font-bold tabular-nums">{day.high}°</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</section>
			</div>
		</div>

		<footer class="rise pb-2 text-center text-xs opacity-55" style="--d:520ms">
			Weather by Open-Meteo · Places by OpenStreetMap Nominatim
		</footer>
	</div>
</div>

<style>
	/* Fixed gradient rather than theme tokens: these stops sit in the 48-56%
	   lightness band, which keeps white text readable in both themes. */
	.hero-sky {
		background-image: linear-gradient(
			140deg,
			oklch(48% 0.2 275) 0%,
			oklch(52% 0.15 232) 55%,
			oklch(56% 0.13 196) 100%
		);
	}
</style>
