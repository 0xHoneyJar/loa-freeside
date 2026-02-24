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
    project: './tsconfig.json',
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
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/require-await': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
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
  ignorePatterns: ['dist', 'node_modules', '*.cjs', 'vitest.config.ts'],
};
