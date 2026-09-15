# SkyPulse

A weather app built with SvelteKit 5, Tailwind CSS v4 and daisyUI. Current
conditions, a 5-day forecast, geolocation, and city search that actually finds
small villages — not just the cities a typical geocoder knows about.

Ships two ways from one codebase: as a website, and as a self-contained
Android app via Capacitor, with no backend server in either case.

## Data sources

Everything is called directly from the browser/device — there is no API key
and no server component:

| Purpose                                      | Provider                                                          |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Current weather + 5-day forecast             | [Open-Meteo](https://open-meteo.com/)                             |
| Place search                                 | [Photon](https://photon.komoot.io/) (OpenStreetMap data)          |
| Reverse geocoding (coordinates → place name) | [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap) |

Open-Meteo's own geocoder is backed by GeoNames and only knows notable towns.
Search instead goes through Photon, with an exact-match-first ranking layer
(see [src/lib/geocode.ts](src/lib/geocode.ts)) so a real village outranks a
similarly-named place two districts away, and reverse geocoding prefers the
most local admin level (village/hamlet/town) over a broader district name.

Both search results and reverse-geocoded names are cached in the browser's
`localStorage` (see [src/lib/cache.ts](src/lib/cache.ts)) to stay well within
each provider's fair-use limits.

## Developing

Install dependencies once:

```sh
npm install
```

Start the dev server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

Other useful scripts:

```sh
npm run check    # type-check the whole project (svelte-check)
npm run lint     # prettier --check + eslint
npm run format   # prettier --write
```

## Building for the web

```sh
npm run build
```

This produces a fully static site in `build/` (via `@sveltejs/adapter-static`
— there is no server to deploy). Preview it locally with:

```sh
npm run preview
```

Deploy the contents of `build/` to any static host (Netlify, Vercel, GitHub
Pages, Cloudflare Pages, etc.).

## Building the Android app

The Android project lives in `android/` and is managed by
[Capacitor](https://capacitorjs.com/). It wraps the same static build from
`npm run build` in a WebView — there's no separate app codebase to maintain.

Requires the Android SDK and a JDK (Android Studio's bundled JBR works well)
on `PATH`, plus `ANDROID_HOME`/`ANDROID_SDK_ROOT` pointing at the SDK.

```sh
npm run build            # build the static web app into build/
npx cap sync android      # copy it into the Android project

cd android
./gradlew assembleDebug   # produces app/build/outputs/apk/debug/app-debug.apk
```

Install the APK on a connected device or emulator:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

App icons and splash screens are generated from
[src/lib/assets/favicon.svg](src/lib/assets/favicon.svg) via
`npx capacitor-assets generate --android`, using the source image in
`resources/icon.png`. Re-run that command after changing the icon.

The app requests `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` (declared
in `android/app/src/main/AndroidManifest.xml`) for the "My location" feature;
Capacitor's WebView bridge handles the native permission prompt for the
standard `navigator.geolocation` API, no extra plugin needed.

## Project structure

```
src/
  lib/
    weather.ts   # Open-Meteo forecast fetch
    geocode.ts   # Photon search + Nominatim reverse geocoding, ranking logic
    cache.ts     # localStorage-backed cache with TTL, used by geocode.ts
  routes/
    +page.svelte     # the entire app UI
    +layout.svelte
android/          # native Capacitor project (checked in; build output is gitignored)
resources/        # source icon for capacitor-assets
capacitor.config.ts
```
