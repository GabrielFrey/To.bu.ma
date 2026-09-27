const expoConfig = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');

module.exports = [
  ...expoConfig,
  prettier,
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'ios/**',
      'android/**',
      'coverage/**',
      '.expo/**',
      'supabase/functions/**',
      'targets/**',
    ],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'import/order': [
        'warn',
        {
          // Parent imports are kept in their own block so a file reads outwards-in:
          // packages, then app-wide modules, then the sibling it belongs to.
          groups: [['builtin', 'external'], 'internal', 'parent', ['sibling', 'index']],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // i18next's default export legitimately carries the same members as its named
      // exports; the warning fires on every `i18n.changeLanguage` call.
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    // Maintenance scripts are command line tools: printing their findings is the point.
    files: ['scripts/**/*.{js,mjs,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
];
