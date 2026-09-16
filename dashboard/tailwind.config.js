/**
 * Semantic design tokens. Components reference roles (`surface`, `text-muted`,
 * `warning-soft`) rather than palette steps. Values live as RGB channels in
 * `src/index.css` so this file stays a map of names, not a second palette.
 *
 * @type {import('tailwindcss').Config}
 */
const rgb = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: rgb('--color-surface'),
          muted: rgb('--color-surface-muted'),
          inset: rgb('--color-surface-inset'),
        },
        border: {
          DEFAULT: rgb('--color-border'),
          strong: rgb('--color-border-strong'),
          subtle: rgb('--color-border-subtle'),
        },
        // Alias of border — existing screens used `edge`.
        edge: {
          DEFAULT: rgb('--color-border'),
          strong: rgb('--color-border-strong'),
          subtle: rgb('--color-border-subtle'),
        },
        muted: {
          DEFAULT: rgb('--color-text-muted'),
          faint: rgb('--color-text-faint'),
        },
        ink: {
          DEFAULT: rgb('--color-text'),
          strong: rgb('--color-text-strong'),
          body: rgb('--color-text-body'),
          muted: rgb('--color-text-muted'),
          faint: rgb('--color-text-faint'),
          inverse: rgb('--color-text-inverse'),
        },
        accent: {
          DEFAULT: rgb('--color-accent'),
          hover: rgb('--color-accent-hover'),
          soft: rgb('--color-accent-soft'),
          ring: rgb('--color-accent-ring'),
        },
        success: {
          DEFAULT: rgb('--color-success'),
          soft: rgb('--color-success-soft'),
          ink: rgb('--color-success-ink'),
        },
        warning: {
          DEFAULT: rgb('--color-warning'),
          soft: rgb('--color-warning-soft'),
          ink: rgb('--color-warning-ink'),
        },
        ok: {
          DEFAULT: rgb('--color-success'),
          soft: rgb('--color-success-soft'),
          ink: rgb('--color-success-ink'),
        },
        warn: {
          DEFAULT: rgb('--color-warning'),
          soft: rgb('--color-warning-soft'),
          ink: rgb('--color-warning-ink'),
        },
        danger: {
          DEFAULT: rgb('--color-danger'),
          soft: rgb('--color-danger-soft'),
          ink: rgb('--color-danger-ink'),
        },
        info: {
          DEFAULT: rgb('--color-info'),
          soft: rgb('--color-info-soft'),
          ink: rgb('--color-info-ink'),
        },
        gate: {
          DEFAULT: rgb('--color-gate'),
          soft: rgb('--color-gate-soft'),
          ink: rgb('--color-gate-ink'),
        },
      },
      maxWidth: { bubble: '85%' },
      minHeight: { chat: '24rem', line: '1.25rem' },
      maxHeight: { chat: '32rem', result: '10rem' },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { transform: 'scale(1.35)', opacity: '0' },
        },
        'bar-bounce': {
          '0%, 100%': { transform: 'scaleY(0.4)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bar-bounce': 'bar-bounce 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
