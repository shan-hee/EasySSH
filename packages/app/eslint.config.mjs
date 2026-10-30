import { createEslintConfig } from "@easyssh/frontend-tooling/eslint"

export default createEslintConfig({ ignores: ["src/lib/proto/**"] })
