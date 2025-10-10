module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  plugins: ['@typescript-eslint'],
  rules: {
    // 后端允许使用 console 输出日志（winston 等之外的临时日志也不阻止）
    'no-console': 'off',
    'no-var': 'error',
    'prefer-const': 'error',
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'comma-dangle': ['error', 'never']
  },
  ignorePatterns: [
    'dist',
    'node_modules'
  ]
};

