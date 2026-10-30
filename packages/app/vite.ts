import { fileURLToPath } from "node:url"
import type { Alias } from "vite"

const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url))

/**
 * 消费方编译本包源码所需的解析规则。`@/` 只表示 @easyssh/app 的 src，
 * Web 与桌面自身代码通过包导出引用，由导入边界检查约束。
 */
export const appSourceAliases: Alias[] = [
  {
    find: /^@protobufjs\/inquire$/,
    replacement: fileURLToPath(new URL("./src/lib/proto/browser-inquire.cjs", import.meta.url)),
  },
  { find: /^@\//, replacement: sourceRoot },
]

/** 共享上下文的运行时依赖必须只有一份实例，消费方需直接声明这些依赖。 */
export const appSingletonDependencies = ["react", "react-dom", "i18next", "react-i18next", "react-router-dom"]
