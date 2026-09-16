import colors from 'tailwindcss/colors';

/**
 * Semantic design tokens. Components reference roles (`surface`, `ink-muted`,
 * `warn-soft`) rather than palette steps, so this file is the only place a
 * palette decision lives. Raw literals like `bg-slate-50` or arbitrary values
 * like `bg-[#fff]` should not appear in components.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: colors.white,
          muted: colors.slate[50],
          inset: colors.slate[100],
        },
        edge: {
          DEFAULT: colors.slate[200],
          strong: colors.slate[300],
          subtle: colors.slate[100],
        },
        ink: {
          DEFAULT: colors.slate[700],
          strong: colors.slate[900],
          body: colors.slate[800],
          muted: colors.slate[500],
          faint: colors.slate[400],
          inverse: colors.white,
        },
        accent: {
          DEFAULT: colors.slate[800],
          hover: colors.slate[700],
          soft: colors.slate[100],
          ring: colors.slate[400],
        },
        ok: { DEFAULT: colors.emerald[500], soft: colors.emerald[50], ink: colors.emerald[700] },
        warn: { DEFAULT: colors.amber[500], soft: colors.amber[50], ink: colors.amber[700] },
        danger: { DEFAULT: colors.red[500], soft: colors.red[50], ink: colors.red[700] },
        info: { DEFAULT: colors.sky[500], soft: colors.sky[50], ink: colors.sky[700] },
        gate: { DEFAULT: colors.purple[500], soft: colors.purple[50], ink: colors.purple[700] },
      },
      maxWidth: { bubble: '85%' },
      minHeight: { chat: '24rem', line: '1.25rem' },
      maxHeight: { chat: '32rem', result: '10rem' },
      keyframes: {
        // Listening/speaking indicators. Paired with a text label everywhere, and
        // suppressed under prefers-reduced-motion (see index.css).
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
