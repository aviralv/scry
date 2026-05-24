import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--scry-bg-primary)',
          secondary: 'var(--scry-bg-secondary)',
          sidebar: 'var(--scry-bg-sidebar)',
          elevated: 'var(--scry-bg-elevated)',
        },
        text: {
          primary: 'var(--scry-text-primary)',
          secondary: 'var(--scry-text-secondary)',
          tertiary: 'var(--scry-text-tertiary)',
        },
        accent: {
          DEFAULT: 'var(--scry-accent)',
          dim: 'var(--scry-accent-dim)',
        },
        border: 'var(--scry-border)',
        divider: 'var(--scry-divider)',
        error: 'var(--scry-error)',
        warning: 'var(--scry-warning)',
        success: 'var(--scry-success)',
      },
      fontFamily: {
        sans: ['var(--scry-sans)'],
        mono: ['var(--scry-mono)'],
      },
      borderRadius: {
        sm: 'var(--scry-radius-sm)',
        DEFAULT: 'var(--scry-radius-md)',
        lg: 'var(--scry-radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
