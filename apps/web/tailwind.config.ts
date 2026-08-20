import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a0a',
          subtle: '#171717',
        },
        fg: {
          DEFAULT: '#fafafa',
          muted: '#a3a3a3',
        },
        accent: '#3b82f6',
      },
    },
  },
  plugins: [],
};

export default config;
