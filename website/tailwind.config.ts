import type { Config } from 'tailwindcss';

const config: Config = {
    darkMode: ['class'],
    content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
  	extend: {
  		colors: {
  			sand: {
  				DEFAULT: '#c2b280',
  				dim: '#6b6245',
  				dark: '#2a2820',
  				bright: '#e8ddb5'
  			},
  			spice: {
  				DEFAULT: '#f4a460',
  				dim: '#a67038',
  				bright: '#ffc078'
  			},
  			black: '#0a0a0a'
  		},
  		fontFamily: {
  			display: [
  				'var(--font-adhesion)',
  				'system-ui',
  				'sans-serif'
  			],
  			mono: [
  				'var(--font-geist-mono)',
  				'Geist Mono',
  				'SF Mono',
  				'Monaco',
  				'Inconsolata',
  				'monospace'
  			]
  		},
  		transitionTimingFunction: {
  			'ease-out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
  			'ease-in-out-expo': 'cubic-bezier(0.65, 0, 0.35, 1)'
  		},
  		animation: {
  			blink: 'blink 1s step-end infinite',
  			flicker: 'flicker 0.15s infinite',
  			'fade-in': 'fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
  			'fade-in-up': 'fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		},
  		keyframes: {
  			blink: {
  				'0%, 100%': {
  					opacity: '1'
  				},
  				'50%': {
  					opacity: '0'
  				}
  			},
  			flicker: {
  				'0%, 100%': {
  					opacity: '1'
  				},
  				'50%': {
  					opacity: '0.8'
  				}
  			},
  			fadeIn: {
  				'0%': {
  					opacity: '0'
  				},
  				'100%': {
  					opacity: '1'
  				}
  			},
  			fadeInUp: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(10px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		}
  	}
  },
  plugins: [],
};

export default config;
