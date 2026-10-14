// @ts-check
import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'docs/', '.github/', 'eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Migrations are frozen in time, so they take Kysely<any> (see the first migration).
    files: ['src/database/migrations/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The public website's plain browser JavaScript (#23): no TypeScript
    // project, browser globals instead of Node's.
    files: ['public/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      sourceType: 'module',
      // bootstrap and FullCalendar are the globals from the scripts the pages
      // load.
      globals: {
        ...globals.browser,
        bootstrap: 'readonly',
        FullCalendar: 'readonly',
      },
    },
  },
  // Turns off formatting rules that would fight with Prettier; keep this last.
  eslintConfigPrettier,
);
