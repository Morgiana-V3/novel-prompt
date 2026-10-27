import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'

const styleRules = {
  curly: ['error', 'all'],
  'one-var': ['error', 'never'],
  'max-statements-per-line': ['error', { max: 1 }],
  'no-nested-ternary': 'error',
  'no-sequences': 'error',
  'no-multi-assign': 'error',
  'no-else-return': ['error', { allowElseIf: false }],
  'no-unused-expressions': 'error',
}
const typescriptRules = {
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
  '@typescript-eslint/consistent-type-imports': 'error',
}
export default [
  { ignores: ['node_modules/**', 'out/**', 'release*/**'] },
  {
    files: ['src/**/*.{ts,cjs}', 'scripts/*.{mjs,cjs}', 'tests/**/*.{cjs,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        URL: 'readonly',
        Response: 'readonly',
        Blob: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: { ...styleRules },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, extraFileExtensions: ['.vue'] },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: typescriptRules,
  },
  ...vue.configs['flat/recommended'],
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...styleRules,
      ...typescriptRules,
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': ['error', { singleline: 1 }],
    },
  },
  prettier,
  {
    files: ['src/**/*.{ts,vue,cjs}', 'scripts/*.{mjs,cjs}', 'tests/**/*.{cjs,mjs}'],
    rules: styleRules,
  },
]
