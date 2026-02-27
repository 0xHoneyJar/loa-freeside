module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.production.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/require-await': 'warn',
    '@typescript-eslint/no-floating-promises': 'warn',
    '@typescript-eslint/no-require-imports': 'warn',
    '@typescript-eslint/no-redundant-type-constituents': 'warn',
    '@typescript-eslint/only-throw-error': 'warn',
    'no-case-declarations': 'warn',
    'no-constant-condition': 'warn',
    'no-control-regex': 'warn',
    'no-useless-escape': 'warn',
    'no-useless-catch': 'warn',
    '@typescript-eslint/no-base-to-string': 'warn',
    '@typescript-eslint/no-empty-object-type': 'warn',
    '@typescript-eslint/no-unsafe-function-type': 'warn',
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/no-misused-promises': 'warn',
    '@typescript-eslint/restrict-template-expressions': 'warn',
    '@typescript-eslint/unbound-method': 'warn',
    '@typescript-eslint/no-unsafe-enum-comparison': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/await-thenable': 'warn',
    // ban-types removed in @typescript-eslint v8 — use @typescript-eslint/no-restricted-types instead
    'no-console': 'warn',
    'prefer-const': 'error',
    'no-var': 'error',
    // Import access control: restrict direct @0xhoneyjar/loa-hounfour imports
    // per SDD §2.2 (Flatline IMP-005). Most modules must use the protocol barrel.
    // Allowed modules are exempted via overrides below.
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['@0xhoneyjar/loa-hounfour', '@0xhoneyjar/loa-hounfour/**'],
        message: 'Import from the protocol barrel (packages/core/protocol) instead of directly from @0xhoneyjar/loa-hounfour. See SDD §2.2 for allowlisted exceptions.',
      }],
    }],
  },
  overrides: [
    // Allowlisted modules that may import directly from @0xhoneyjar/loa-hounfour
    // per SDD §2.2 and PRD AC-3.6 (Flatline IMP-005)
    {
      files: [
        // Protocol barrel and adapter files (canonical import layer)
        'src/packages/core/protocol/index.ts',
        'src/packages/core/protocol/arrakis-*.ts',
        'src/packages/core/protocol/jwt-boundary.ts',
        'src/packages/core/protocol/parse-boundary-micro-usd.ts',
        // Agent adapter layer (low-level JWT, pool, compatibility)
        'src/packages/adapters/agent/*.ts',
        // Discovery endpoint
        'src/api/routes/discovery.routes.ts',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    {
      // Test suites (conformance and E2E)
      files: ['tests/**/*.ts', 'tests/**/*.tsx'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    '*.cjs',
    'vitest.config.ts',
    // Match tsconfig.production.json excludes to prevent parsing errors
    // (files outside the TS project can't be type-checked by ESLint)
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    'src/test-utils/**',
    'src/ui/**',
  ],
};
