import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['dist/', 'node_modules/', '.local/']},
  js.configs.recommended,
  {
    languageOptions: {ecmaVersion: 2024, sourceType: 'module'},
    rules: {
      'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none', ignoreRestSiblings: true}],
      // Input validation intentionally rejects control characters.
      'no-control-regex': 'off',
      'no-console': ['error', {allow: ['error', 'warn']}],
    },
  },
  {files: ['public/**/*.js'], languageOptions: {globals: globals.browser}},
  {files: ['server/**/*.js'], languageOptions: {globals: {...globals.node, ...globals.serviceworker}}},
  // build.mjs prepends STATIC_ASSETS to the Worker bundle.
  {files: ['server/worker.js'], languageOptions: {globals: {STATIC_ASSETS: 'readonly'}}},
  {
    // Entrypoints that print startup or build status to the terminal.
    files: ['server/local.js', 'build.mjs', 'tests/**'],
    languageOptions: {globals: globals.node},
    rules: {'no-console': 'off'},
  },
  // Tests also run code in the browser through Playwright page.evaluate callbacks.
  {files: ['tests/**'], languageOptions: {globals: {...globals.node, ...globals.browser}}},
];
