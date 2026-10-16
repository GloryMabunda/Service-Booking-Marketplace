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
    // The security, contract and end-to-end suites (M7) look inside response
    // bodies of every shape: supertest gives those as `any` on purpose, so
    // reading them is not an error here. Application code keeps the rules.
    files: [
      'tests/security/**/*.ts',
      'tests/e2e/**/*.ts',
      'tests/api/travel.spec.ts',
      'tests/api/service-photos.spec.ts',
      'tests/api/demo.spec.ts',
      'tests/api/brand.spec.ts',
      'tests/api/service-places.spec.ts',
      'tests/contract/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
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
