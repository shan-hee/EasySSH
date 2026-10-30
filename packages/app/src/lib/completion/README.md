# 终端命令补全

EasySSH 的 Web 与桌面终端共用同一套补全引擎。候选来源包括内置命令、当前会话历史、服务器 Shell 历史、已保存脚本和远端文件路径。

## 用户设置

用户只负责表达使用意图：

- 补全方式：自动显示、按 Tab 显示或关闭。
- 是否使用命令历史。
- 是否使用已保存脚本。
- 是否使用远端文件路径。

自动触发延迟、候选数量、来源配额、历史读取数量和缓存策略均由系统固定管理，不作为用户设置。

## 数据来源

- `LocalCommandProvider`：内置 Linux/Unix 命令与常见子命令。
- `SessionProvider`：当前终端会话中执行过的命令，仅保存在当前会话内存中。
- `RemoteHistoryProvider`：目标 SSH 服务器的 Bash、Zsh、Fish 或 Sh 历史文件。
- `ScriptProvider`：EasySSH 脚本库中的已保存命令。
- `PathProvider`：通过 SFTP 读取的服务器文件和目录。

服务器历史由 `shared/sshutil.FetchCompletionHistory` 统一读取，Web 服务端、桌面网关和桌面直连降级路径使用相同的 Shell 检测、解析、去重和数量限制规则。桌面本地历史不会作为服务器历史返回。

## 交互策略

- 自动模式固定在停止输入约 200ms 后触发。
- Tab 在自动模式和手动模式下都可以立即触发补全。
- 自动补全先展示本地和已加载的数据；远端路径只在 250ms 时间预算内异步合并，不阻塞首屏候选。
- 单次最多展示 10 条候选，来源配额由引擎内部固定策略控制。
- 更新远端路径候选时尽量保持当前选中项，避免键盘导航跳动。
- 当前执行的命令只进入 `SessionProvider`，不会被伪装成已经写入服务器历史文件的命令。

## 固定资源策略

- 服务器历史最多读取最近 500 行。
- Web 补全数据缓存固定为 5 分钟，容量固定为 1000 个缓存项。
- 远端路径目录缓存固定为 5 秒，相同目录的并发请求会自动合并。
- 远端路径 provider 超时为 800ms；自动模式不会等待它再显示本地候选。

客户端协议只允许声明是否需要历史和脚本，不允许控制服务端历史读取量或缓存 TTL。

## 代码结构

```text
web/src/lib/completion/
├── completion-engine.ts
├── types.ts
├── utils.ts
└── providers/
    ├── local-command-provider.ts
    ├── session-provider.ts
    ├── remote-history-provider.ts
    ├── script-provider.ts
    └── path-provider.ts

web/src/components/terminal/
├── completion-popup.tsx
├── use-terminal-completion-controller.ts
└── terminal-settings.ts

shared/sshutil/
└── completion_history.go
```

## 添加新的补全来源

新的 provider 需要实现 `CompletionProvider`，提供稳定的 `name`、优先级和 `getCompletions`。涉及网络或远端文件系统的 provider 必须设置超时，并且不能阻塞自动补全的本地首屏结果。

候选必须填写准确的 `providerName`、`source` 和描述，不能把客户端本地数据标记为服务器数据。
