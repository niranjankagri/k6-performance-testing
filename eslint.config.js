// ESLint flat config: Node rules for the demo app, k6 globals for the test scripts.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'reports/'] },
  js.configs.recommended,
  {
    files: ['app/**/*.js', 'eslint.config.js', '.github/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // k6 runs scripts in its own JavaScript runtime (not Node): these are its globals
    files: ['k6/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        open: 'readonly',
        console: 'readonly',
      },
    },
  },
];
