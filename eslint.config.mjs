// Stage 0 lint (`pnpm lint`, lefthook job eslint): typed rules for TypeScript, recommended rules for JavaScript.
// Out of scope: Python and prose areas, the agent workflows and the templates (linted where they are copied).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      '**/reports/',
      '**/.stryker-tmp/',
      'evals/',
      '.claude/',
      'tools/templates/',
    ],
  },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    // Numbers in template literals are unambiguous; the other restrictions of the strict set stay.
    rules: { '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }] },
  },
  {
    // Production code of the workspaces: output only through the logger (stdout) and writeConfigError
    // (stderr), both in packages/service-kit/src/logger.ts (.claude/rules/platform.md, "Logging and health").
    files: ['packages/**/*.ts', 'services/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/features/**',
      '**/src/testing/**',
      'packages/service-kit/src/logger.ts',
    ],
    rules: {
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'process', property: 'stdout', message: 'Log through createLogger.' },
        { object: 'process', property: 'stderr', message: 'Report through writeConfigError.' },
      ],
    },
  },
  {
    // Frozen tests are never edited (gate 1, .claude/frozen/25.json); rules relaxed only for these files,
    // owner decision 2026-10-28. Production code keeps the full rule set.
    files: [
      'packages/service-kit/src/health.test.ts',
      'packages/service-kit/src/logger.test.ts',
      'packages/service-kit/src/testing/probe-body.ts',
      'services/detection/features/steps/detection.steps.ts',
      'tests/api/steps/edge.steps.ts',
      'services/detection/src/main.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // Frozen contract test of #27 task 1 (.claude/frozen/27.json): it deletes fields by computed name to build
    // the "missing field" cases and asserts one literal's type; both rules off for this file only, to be
    // confirmed by the owner at gate 2 like the block above. Production code keeps the full rule set.
    files: ['packages/contracts/src/segment.test.ts'],
    rules: {
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Frozen contract tests of #29 task 1 (.claude/frozen/29.json): they delete fields by computed name to build
    // the "missing field" cases, as segment.test.ts does; the rule is off for these files only, to be confirmed by
    // the owner at gate 2 like the blocks above. Production code keeps the full rule set.
    files: [
      'packages/contracts/src/claim-event.test.ts',
      'packages/contracts/src/detection-event.test.ts',
    ],
    rules: { '@typescript-eslint/no-dynamic-delete': 'off' },
  },
  {
    // Frozen property test of #32 task 1 (.claude/frozen/32.json): it asserts the generated tag records as
    // TopicTag[], which the TagList it builds already accepts; the rule is off for this file only, to be confirmed by
    // the owner at gate 2 like the blocks above. Production code keeps the full rule set.
    files: ['services/detection/src/topic-extractor/tag-list.property.test.ts'],
    rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'off' },
  },
);
