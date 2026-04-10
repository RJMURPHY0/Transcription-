import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Page / surface backgrounds — warm charcoal tones from FTC dark (#4e4e4c)
        surface: {
          DEFAULT: '#0e0e0d',  // page bg
          card:    '#181817',  // card
          raised:  '#222221',  // elevated card
          border:  '#2e2e2c',  // border
          muted:   '#3a3a38',  // subtle border / inactive
          dark:    '#4e4e4c',  // FTC dark grey
        },
        // FTC primary orange
        brand: {
          light:   '#f5a830',
          DEFAULT: '#f39200',
          dark:    '#d97f00',
        },
        // FTC neutral greys
        ftc: {
          gray:    '#dadada',  // FTC light grey — primary text on dark bg
          mid:     '#a0a09e',  // muted text
          dark:    '#4e4e4c',  // FTC dark charcoal
        },
      },
      boxShadow: {
        brand:        '0 4px 20px rgba(243,146,0,0.28)',
        'brand-lg':   '0 4px 36px rgba(243,146,0,0.45)',
        'record-on':  '0 0 36px rgba(239,68,68,0.38), 0 8px 28px rgba(239,68,68,0.25)',
        'record-off': '0 0 36px rgba(243,146,0,0.38), 0 8px 28px rgba(243,146,0,0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
