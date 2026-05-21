// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      // Drizzle's self-/forward-FK columns (e.g. teams.parentTeamId ->
      // teams, users.companyId -> companies) force packages/database
      // to compile with `strict: false` + `noImplicitAny: false` —
      // otherwise TS7022/TS7024 fire on every self-reference. That
      // intentional looseness collapses Drizzle column types to `any`
      // for consumers, which cascades through .select()/.from()/
      // .returning() and lights up every destructured row as "unsafe".
      // The SQL is fine, the runtime is fine, the types are just lossy
      // through the FK graph. Keeping the four rules below at `warn`
      // so the signal is visible but doesn't fail CI; matches the
      // pre-existing call/argument overrides above. Real unsafe-`any`
      // sites (JSON parsing, untyped third-party data) will still show
      // up in review.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-call': 'off',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // unbound-method has a well-known false-positive on jest.Mocked<T>:
    // `expect(svc.method).toHaveBeenCalledWith(...)` detaches the
    // method but jest doesn't actually invoke it, so the `this` warning
    // doesn't apply. Disabling for spec files mirrors the recommended
    // setup when paired with jest's own expect() ecosystem.
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
