import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import importPlugin from 'eslint-plugin-import'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'esm/**/*',
      'dist/**/*',
      '*.js',
      '*.mjs',
      'src/wasm/*',
      'crate/*',
      'scripts/*',
      'example/*',
      'htscodecs-wasm/*',
      'esm_*',
      'benchmarks/*',
      'src/htscodecs',
      'src/seek-bzip',
      'coverage',
      'vite.config.ts',
      'vitest.config.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  importPlugin.flatConfigs.recommended,
  eslintPluginUnicorn.configs.recommended,
  {
    rules: {
      'no-console': [
        'warn',
        {
          allow: ['error', 'warn'],
        },
      ],

      'no-underscore-dangle': 'off',
      curly: 'error',
      eqeqeq: 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      semi: ['error', 'never'],
      'spaced-comment': [
        'error',
        'always',
        {
          markers: ['/'],
        },
      ],

      'unicorn/number-literal-case': 'off',
      'unicorn/no-new-array': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/consistent-destructuring': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/prefer-optional-catch-binding': 'off',
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/numeric-separators-style': 'off',
      'unicorn/prefer-code-point': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/prefer-switch': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/prefer-math-trunc': 'off',
      'unicorn/text-encoding-identifier-case': 'off',
      'unicorn/prefer-spread': 'off',
      'unicorn/catch-error-name': 'off',
      'unicorn/explicit-length-check': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/escape-case': 'off',

      '@typescript-eslint/no-deprecated': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          caughtErrors: 'none',
        },
      ],

      'import/no-unresolved': 'off',
      'import/extensions': ['error', 'ignorePackages'],
      'import/order': [
        'error',
        {
          named: true,
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
          groups: [
            'builtin',
            ['external', 'internal'],
            ['parent', 'sibling', 'index', 'object'],
            'type',
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*'],
    rules: {
      'no-console': 'off',
      'unicorn/no-process-exit': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      'unicorn/prefer-top-level-await': 'off',
    },
  },
)
