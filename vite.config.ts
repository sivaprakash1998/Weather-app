import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static output: the app ships inside a Capacitor Android build with no
			// server on-device, so everything is prerendered to plain files and
			// `fallback` serves the same shell for any path the WebView opens.
			adapter: adapter({
				fallback: 'index.html'
			})
		})
	]
});
