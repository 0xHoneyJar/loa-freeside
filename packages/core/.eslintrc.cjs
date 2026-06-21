// Dependency-rule mirror — Sprint-1 T3 · FR-7 (editor ergonomics).
//
// This encodes the SAME invariant as tools/lint/dep-rule.sh: packages/core is
// the platform's Contract plane (ports + domain) and must not import outward
// into `adapters`, `services`, or `themes` (ADR-008 §D-1). Editors with the
// ESLint extension surface the violation inline as you type.
//
// AUTHORITATIVE ENFORCEMENT is tools/lint/dep-rule.sh, wired required in
// .github/workflows/pr-validation.yml. This config does not run in CI (core
// builds with tsc only; adding an eslint toolchain would desync the lockfile).
// It activates for any developer whose workspace ESLint resolves a TS parser.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [
              '**/adapters', '**/adapters/**',
              '**/services', '**/services/**',
              '**/themes', '**/themes/**',
              '@freeside/adapters', '@freeside/adapters/**',
            ],
            message:
              'packages/core (Contract plane) must not import adapters|services|themes. ' +
              'Core talks to ports/schemas, never outward (ADR-008 §D-1). ' +
              'Enforced by tools/lint/dep-rule.sh.',
          },
        ],
      },
    ],
  },
};
