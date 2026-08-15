// ESLint flat config — GOLF EMPIRE.
// Report-only posture: rules are eslint:recommended, untuned. Do not add
// autofix to any pipeline until the violation breakdown has been reviewed.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'vendor/**',
      'Assets/**',
      'assets/**',
      'asset_sources/**',
      'Designs/**',
      'dist/**',
      'out/**',
    ],
  },
  js.configs.recommended,
  {
    // Renderer code: ES modules in the Electron renderer (browser globals).
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    // Electron main/preload helpers are CommonJS with node globals.
    files: ['src/**/*.cjs', 'main.cjs', 'preload.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Tests and tooling run under node.
    files: ['tests/**/*.js', 'tests/**/*.mjs', 'tools/**/*.js', 'tools/**/*.mjs', 'tools/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
