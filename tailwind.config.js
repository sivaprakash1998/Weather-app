import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
const config = {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			boxShadow: {
				glow: '0 0 80px rgba(99, 102, 241, 0.35)'
			}
		}
	},
	daisyui: {
		themes: [
			{
				light: {
					primary: '#5b6cff',
					secondary: '#36d399',
					accent: '#f59e0b',
					neutral: '#1f2937',
					'base-100': '#f8fafc',
					info: '#38bdf8',
					success: '#22c55e',
					warning: '#f59e0b',
					error: '#ef4444'
				}
			},
			'dark',
			'cupcake'
		]
	},
	plugins: [daisyui]
};

export default config;
