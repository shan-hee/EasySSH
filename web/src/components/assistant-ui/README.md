# assistant-ui 组件

本目录以 assistant-ui 官方 Radix / new-york registry 源码为基础，获取日期：2026-09-07。
组件通过 `web/components.json` 中的 `@assistant-ui` registry 配置维护。

上游入口：

- https://r.assistant-ui.com/styles/new-york/elements-composer.json
- https://r.assistant-ui.com/styles/new-york/elements-surfaces.json
- https://r.assistant-ui.com/styles/new-york/elements-empty-state.json
- https://r.assistant-ui.com/styles/new-york/model-selector.json
- https://r.assistant-ui.com/styles/new-york/elements-model-selector.json
- https://r.assistant-ui.com/styles/new-york/composer-trigger-popover.json
- https://r.assistant-ui.com/styles/new-york/thread.json
- https://r.assistant-ui.com/styles/new-york/tool-fallback.json
- https://r.assistant-ui.com/styles/new-york/reasoning.json
- https://r.assistant-ui.com/styles/new-york/elements-reasoning.json
- https://r.assistant-ui.com/styles/new-york/attachment.json
- https://r.assistant-ui.com/styles/new-york/image.json
- https://r.assistant-ui.com/styles/new-york/file.json
- https://r.assistant-ui.com/styles/new-york/sources.json
- https://r.assistant-ui.com/styles/new-york/tooltip-icon-button.json
- https://r.assistant-ui.com/styles/new-york/use-attachment-src.json
- https://r.assistant-ui.com/styles/new-york/use-copy-to-clipboard.json
- https://r.assistant-ui.com/styles/new-york/elements-thread-list.json
- https://r.assistant-ui.com/styles/new-york/thread-list.json
- https://r.assistant-ui.com/styles/new-york/elements-settings-panel.json
- https://r.assistant-ui.com/styles/new-york/elements-error-state.json
- https://r.assistant-ui.com/styles/new-york/elements-thinking-indicator.json
- https://r.assistant-ui.com/styles/new-york/message-timing.json
- https://r.assistant-ui.com/styles/new-york/elements-tool-timeline.json
- https://r.assistant-ui.com/styles/new-york/elements-tool-call.json
- https://r.assistant-ui.com/styles/new-york/elements-timeline.json
- https://r.assistant-ui.com/styles/new-york/elements-stopped-run.json
- https://r.assistant-ui.com/styles/new-york/elements-message-pair.json
- https://r.assistant-ui.com/styles/new-york/elements-streaming-text.json

Markdown 使用官方 `@assistant-ui/react-streamdown` 的 `StreamdownTextPrimitive`，保留中文、代码、数学公式和 Mermaid 插件。

项目调整：

- 文案接入 `aiAssistant` 中英文资源；折叠动画使用项目 Radix 的 `data-state` 属性。
- Thread 保留官方消息、编辑器、操作栏、分组和滚动组件；布局支持工作区与终端侧栏、历史分批显示和外置 Composer。
- 消息编辑、删除和发送接入 EasySSH 后端及上下文处理，避免默认前端分支操作绕过后端持久化。
- ToolFallback 保留官方耗时、错误、参数／结果复制和审批交互，外层使用 Elements ToolCall；分组使用 Elements ToolTimeline。删除未使用的旧 ToolGroup 包装组件。
- AttachmentTile 为官方附件展示部分增加受控属性，供 EasySSH 文件解析器复用；消息附件仍从官方 Runtime 读取。
- 附件弹窗复用 ImagePreview 的加载、缓存命中和失败状态，支持 Esc 关闭；本地图片预览使用 Blob URL，服务端默认 CSP 的 img-src 必须允许 blob:。
- 消息复制使用官方 `useActionBarCopy`，写入剪贴板的函数补充桌面 WebView 支持。
- Composer 使用官方 Elements 的表面、工具栏、附件、语音和发送/停止按钮，配合官方 ComposerPrimitive；空会话居中，消息出现后停靠底部。
- Composer.Input 的受控文本直接订阅同一 Runtime 草稿，避免 Provider 状态转换期间回写旧值、打断中文输入法组词；不复制本地文本状态，不另写键盘或补全逻辑。页面只在发送、恢复和模板选择时写草稿，发送按钮自行订阅文本是否为空，避免每次输入重绘工作区和重新发布侧栏。Web、桌面和终端面板共用此实现。
- EmptyState 的欢迎语和提示按钮展示 EasySSH 运维模板；点击仅填入草稿，不自动执行命令。
- ModelSelector 接收真实配置模型，选择同步到现有业务状态及官方 ModelContext；不声明后端尚未提供的推理强度选项。
- 服务器提及使用官方 TriggerPopover，业务适配器提供服务器搜索和 `@显示名称` 插入格式。补全框限制宽高并在内部滚动，展示匹配数量和键盘提示；沿用官方高亮与选择状态，仅滚动结果列表以保持当前选项可见，不再截断为前 8 台服务器。颜色与圆角使用主题令牌。
- 语音输入使用官方 WebSpeechDictationAdapter，只在浏览器支持时显示入口，点击后才启动；听写结束前暂不提交消息。
- 未引入未使用的演示菜单、模拟语音波形、上下文用量和旧 ReasoningGroup API。
- 顶部新建、历史、设置，以及终端关闭、上下文添加和移除按钮复用 TooltipIconButton。新建按钮调用 EasySSH 的创建流程，保留运行中确认、服务器范围和桌面适配器。
- 新建会话在共享 useAgentSession 中复用同一范围内的空闲空会话；历史查询独立于菜单搜索和分页，复用前校验完整消息与工具记录。操作成功后才清空草稿和附件，确认与请求期间防止重复点击。
- 历史列表使用官方 Elements 的受控 ThreadList，搜索控件提取自官方 thread-list registry；不额外创建一个只服务于列表的 Runtime。EasySSH 提供服务端搜索、当前会话 ID、重命名和删除回调，避免默认本地新建操作绕过后端。
- ThreadList 以持久化 ID 为键；日期按实际更新时间分组并国际化。将上游演示中的重命名、删除图标接成实际按钮，编辑框支持中文输入法、保存、取消和忙碌状态。操作失败保留列表与草稿。
- SettingsPanel 提取官方设置面板实际用到的表面和开关，增加 children、禁用状态和辅助描述；连接配置作为业务字段插入。未引入后端没有接收的系统提示词、温度或能力设置。
- ErrorState 复用官方错误布局，以 action 插槽提供关闭操作；不显示没有实际恢复流程的重试按钮。ThinkingIndicator 替代手写状态圆点，状态文字由业务提供。
- 等待响应采用单行 `> thinking` 样式（中文为“思考中”），使用等宽字和主题令牌。消息创建前由线程显示，运行中的消息出现后交给官方 GroupedParts 的 indicator，避免同时出现圆点和额外等待提示。
- 删除旧 AgentNoticeCard、ThreadStatus 和废弃的服务器标签分支；附件业务列表仅组合官方 AttachmentTile 和 AttachmentRemoveButton。
- AssistantActionBar 补齐官方赞、踩、朗读／停止朗读、重新生成和 MessageTiming。反馈按会话和消息保存在当前设备，不上传服务端；朗读使用 WebSpeechSynthesisAdapter，不支持的环境禁用入口。耗时采用 Runtime 采集值，无记录的历史消息不显示虚构统计。
- 重新生成阻止官方默认的本地分支操作，连接 EasySSH 的 Web / 桌面 RegenerateAfterUserMessage 流程，携带当前模型、权限和服务器上下文；如果会移除后续用户对话，先显示确认。用户消息的编辑、复制、删除操作统一在消息下方横排。
- 工具分组次数继承正常字号；历史分组、消息数量和时间使用 muted-foreground；附件根建立层叠上下文，移除按钮置于缩略图上层。
- AI 表面、错误、状态、来源、弹窗、代码高亮和圆角读取项目主题令牌。Shiki 使用 CSS 变量主题，Mermaid 的节点、文本和连线使用令牌；不通过重新挂载消息来更新配色。主题模式同步写入根节点，配色更新与重置复用 applyThemeChange 暂停颜色过渡。

业务扩展位于 `components/ai-agent/`：工具的服务器、工作目录和风险信息，服务器选择与提及，终端上下文，附件解析，会话管理。不要在业务目录重新实现已有的 assistant-ui 通用组件。

上游 MIT 许可证见本目录 `LICENSE`。更新 registry 源码时需保留上述业务接入点。

## 2026-09-07 组件复查

检查范围：完整 AI 工作区、终端 AI 侧栏、消息与工具渲染、输入区、会话历史、AI 配置及上下文组件。官方 Elements 是可复制并修改的源码；本目录记录来源和实际业务调整，不代表所有文件均为上游原样源码。

| 界面功能 | 采用的官方组件 / 保留原因 |
| --- | --- |
| 消息、Markdown、代码、推理、来源、附件、工具与审批 | Thread / MessagePair / StreamingText / StreamdownTextPrimitive / Reasoning / Sources / Attachment / ToolCall / ToolFallback 审批 / ToolTimeline |
| 输入、发送、停止、语音、提及、模型选择、欢迎与快捷提示 | Composer / ComposerPrimitive / TriggerPopover / ModelSelector / EmptyState |
| 新建、历史、设置及辅助图标操作 | TooltipIconButton / 受控 ThreadList / ThreadListSearch / SettingsPanel |
| 错误、加载与执行状态 | ErrorState / ThinkingIndicator |
| API Key、提供方、地址、模型探测和配置中的模型多选 | 官方 SettingsPanel 不管理连接凭据；ModelSelector 是选择当前模型，不提供探测、手动添加及配置多个模型的流程，因此保留业务表单。 |
| 执行权限模式 | 是后端执行策略，使用项目 Select；官方 PermissionGrant 是工具请求中的授权门，不等同于执行策略选择。实际工具审批已使用官方组件。 |
| 终端上下文选取与预览 | 读取 xterm 选区、输出、工作目录、监控快照。官方 ComposerContext 展示 token 用量，不提供这些采集功能；入口和移除按钮已统一。 |
| 终端容器、宽度记忆、移动端覆盖及返回终端 | 应用布局；官方 AssistantSidebar 是包住整个主内容的双栏 ResizablePanelGroup，并非此侧栏的直接替代。其内部 AI 内容已复用官方组件。 |

项目 Button、Input、Select、Popover、Dialog 等基础控件也被 assistant-ui 官方源码使用；保留它们不等于另写了一套聊天组件。重新生成遵循后端的线性会话语义；未启用归档和独立前端分支等后端尚未提供的功能。

## 2026-09-08 七项 Elements 接入

| 组件 | 数据与行为 |
| --- | --- |
| Tool timeline | 真实连续工具调用分组，显示调用数量、执行状态和各工具目标，支持折叠；等待审批时自动展开。没有真实文件行数统计时不生成演示中的增删行数字。 |
| Tool call | 官方折叠布局显示真实请求、结果、错误与取消状态；保留复制、耗时和真实审批响应。 |
| Timestamps | 官方源码对应 Timeline；工具的创建和最后更新时间直接来自 TaskView，消息时间来自持久化 createdAt 元数据，不使用 Runtime 恢复历史时新建的 Date 作为消息时间。 |
| Stopped run | Web 与桌面保存 stopped_at 和部分回复，通过 data-stopped-run part 呈现。Continue 追加继续请求，保留已有回复及范围；Discard 删除本轮回复与工具记录、保留用户问题。旧轮次的停止操作禁用，避免误删后续对话。 |
| Message pair | 按用户问题与后续助手消息分组，使用官方 MessageByIndex 上下文；保留消息编辑、复制、反馈、语音、重新生成和附件。历史分批加载保持一轮消息完整。 |
| Streaming text | 官方渐显和新文字强调效果由 Streamdown 实际增量驱动；保留 Markdown、代码、数学公式、Mermaid、中文和减少动态效果设置，不使用演示词数或定时模拟回复。 |
| Thinking indicator | 单处 `> 思考中` 状态行，等待阶段显示实际经过秒数；退出状态后停止计时。 |

新增源码保留官方组件布局，演示数据接口按运行时组件插槽调整。状态、时间及停止记录来自会话；颜色、边框、圆角与阴影均使用项目主题令牌。

## 2026-09-08 AI 工作区侧边栏

- Dashboard 进入 AI 助手路由后，左侧导航内容切换为 AI 会话面板，保留原 Logo、折叠按钮及底部用户入口，并提供返回主菜单入口。
- 顶部搜索使用官方 ThreadListSearch，接入服务端会话搜索；新建会话与配置按钮放在同一行，历史列表常驻下方。AI 工作区不再显示右侧的新建／历史／配置工具栏。
- 历史面板与终端历史弹窗复用同一个 ThreadList 业务适配器，支持日期分组、当前会话高亮、重命名、删除、分页与失败重试。窄侧栏将行操作收进更多菜单，避免挤压标题。
- AISidebarHost 接收工作区注册的侧栏内容，沿用同一个 Runtime 和会话控制器。主菜单与 AI 面板在同一条轨道上整幅推移；路由离开后保留正在滑出的面板，到动画结束再释放，避免空白或先切换再晃动。配置面板从侧栏向右展开，手机上成功新建或切换会话后收起抽屉。
- 独立桌面 AI 视图接入 AISidebarHost，复用会话侧栏、搜索、分页和配置入口。顶部依次放置返回终端按钮、侧栏折叠按钮和页面标题；侧栏不显示 Logo 与品牌栏，从会话搜索开始排列。侧栏沿用已保存的展开状态，窄窗口使用抽屉。
- 桌面 AI 页面隐藏时卸载侧栏并关闭抽屉、配置与历史弹窗，暂停侧栏快捷键、历史列表加载和自动恢复；会话控制器继续保留。再次进入时刷新会话历史和服务器提及列表。
- 终端 AI 侧栏继续使用历史弹窗，与独立 AI 工作区共享会话列表、配置及持久化操作。
