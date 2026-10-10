import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'src/lib/inspector/**', 'public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Keep the React Hooks contract enforced — the app is hook-heavy.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Legacy codebase uses explicit `any` deliberately at bridge boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // These are typed-view concerns handled by tsc; silence noisy overlap.
      '@typescript-eslint/no-require-imports': 'off',
      'no-constant-condition': 'off',
      // Legacy code intentionally swallows errors with empty catch {} blocks.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
