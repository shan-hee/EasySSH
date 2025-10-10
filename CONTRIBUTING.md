# 贡献指南

感谢你对 EasySSH 的关注与贡献！为了让协作更顺畅，请遵循以下约定：

## 环境要求
- Node.js >= 20.0.0（与仓库 engineStrict 一致）
- 包管理器：推荐使用 pnpm（已配置 pnpm-workspace）

## 快速开始
```bash
pnpm install
pnpm run dev

# 后端（另一个终端）
cd server && pnpm install && pnpm run dev
```

## 代码规范
- 统一使用 ESLint + Prettier（提交前建议执行 `pnpm run lint:fix` 和 `pnpm run format`）
- 前端使用 TypeScript（`pnpm run typecheck` 验证类型）
- 后端为 TypeScript（`server/typecheck` / `server/build`）

## 分支与提交
- 分支命名：`feat/xxx`、`fix/xxx`、`docs/xxx`、`chore/xxx`
- 提交信息：遵循约定式提交（如：`feat: 新增监控缓存桥接`）

## 提交 PR
- 请描述变更动机、范围与影响面
- 若改动影响文档，请同步更新相关文档
- 尽量保持改动聚焦，避免引入无关变更

## 交流与问题
- 问题反馈与建议请至 Issues：`https://github.com/shan-hee/easyssh/issues`

再次感谢你的参与！

