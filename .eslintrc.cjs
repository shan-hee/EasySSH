module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
    extraFileExtensions: ['.vue']
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended'
  ],
  plugins: ['vue', '@typescript-eslint'],
  rules: {
    // Vue相关规则
    'vue/multi-word-component-names': 'off',
    'vue/no-unused-vars': 'error',
    'vue/no-unused-components': 'warn',
    'vue/component-definition-name-casing': ['error', 'PascalCase'],
    'vue/component-name-in-template-casing': ['error', 'kebab-case'],
    'vue/prop-name-casing': ['error', 'camelCase'],
    'vue/attribute-hyphenation': ['error', 'always'],
    'vue/v-on-event-hyphenation': ['error', 'always'],
    
    // JavaScript规则
    // 禁止直接使用 console，统一通过日志服务输出
    'no-console': ['error', { allow: [] }],
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-unused-vars': ['off'],
    '@typescript-eslint/no-unused-vars': ['error', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'prefer-template': 'error',
    'template-curly-spacing': 'error',
    'arrow-spacing': 'error',
    'comma-dangle': ['error', 'never'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'indent': ['error', 2],
    'no-trailing-spaces': 'error',
    'eol-last': 'error',
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }]
  },
  overrides: [
    {
      files: ['**/__tests__/*.{j,t}s?(x)', '**/tests/unit/**/*.spec.{j,t}s?(x)'],
      env: {
        jest: true
      }
    },
    {
      files: ['src/views/**/*.vue', 'src/components/**/*.vue'],
      rules: {
        'vue/no-async-in-computed-properties': 'warn',
        'vue/no-side-effects-in-computed-properties': 'warn',
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'no-empty': ['warn', { allowEmptyCatch: true }]
      }
    },
    {
      files: ['src/services/log.ts'],
      rules: {
        'no-console': 'off'
      }
    }
  ],
  ignorePatterns: [
    'dist',
    'node_modules',
    'server/node_modules',
    'server/**',
    'scripts/**',
    '*.min.js',
    'public',
    'coverage'
  ]
};
