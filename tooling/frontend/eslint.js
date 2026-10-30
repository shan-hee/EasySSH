import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import tseslint from "typescript-eslint"

/** 前端各包共用的 ESLint 规则；各包只追加自身的忽略目录。 */
export function createEslintConfig({ ignores = [] } = {}) {
  return tseslint.config(
    {
      ignores: [
        "node_modules/**",
        "dist/**",
        "build/**",
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: ["**/*.{ts,tsx}"],
      plugins: {
        "react-hooks": reactHooks,
        "react-refresh": reactRefresh,
      },
      languageOptions: {
        parserOptions: {
          ecmaFeatures: {
            jsx: true,
          },
        },
      },
      rules: {
        ...reactHooks.configs.recommended.rules,
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "react-hooks/set-state-in-effect": "off",
        "react-hooks/static-components": "off",
        "react-hooks/refs": "off",
        "react-hooks/preserve-manual-memoization": "off",
        "react-hooks/rules-of-hooks": "warn",
        "react-hooks/purity": "off",
        "react-hooks/immutability": "off",
        "react-refresh/only-export-components": "off",
      },
    },
  )
}
