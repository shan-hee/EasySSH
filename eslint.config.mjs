// ESLint 9 Flat Config - 根（前端 Vue + TS）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';

export default tseslint.config(
  // JS 推荐规则
  js.configs.recommended,

  // TypeScript 推荐（无类型检查，轻量）
  ...tseslint.configs.recommended,

  // Vue 推荐（Flat）
  vue.configs['flat/recommended'],

  // 项目定制
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      }
    },
    rules: {
      // 可按需微调
      'no-unused-vars': 'off'
    }
  },

  // 忽略文件
  {
    ignores: [
      'dist',
      'node_modules',
      'server/dist'
    ]
  }
);

