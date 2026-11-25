import js from '@eslint/js'
import tseslint from 'typescript-eslint'
export default tseslint.config(
  { ignores: ['.orca/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'max-lines': ['error', { max: 360, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/core/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['node:*', 'orca', 'orca/*', '../worker/*'] }] },
  },
)
