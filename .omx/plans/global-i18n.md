# Web 应用全局中英文切换能力更新计划

> 状态：已批准、已实施并完成自动化与响应式视觉验收  
> 调研日期：2026-07-14  
> 默认范围：`web/` 中所有用户可见页面、弹窗、Toast、工具栏、空/错误状态和 Agent 可见日志  
> 默认不包含：内部 AI system prompt、tool schema/protocol 文本、中文源数据解析器、文档站与 README

## 1. 目标结果

让用户在应用任意路由上切换 `zh-CN` / `en-US` 时，所有产品 UI 立即使用同一语言，不刷新、不改写用户数据、不改变 Agent/模型协议行为。通过类型和静态检查防止后续新增“只支持中文”的 UI。

## 2. 当前现状与根因

### 2.1 已有能力可复用

- 语言 store 已持久化 `zh-CN` / `en-US`，且支持切换：`web/src/stores/use-language-store.ts:12-27`。
- `useI18n()` 已使用 store 生成响应式 `t()`：`web/src/i18n/use-i18n.ts:6-16`。
- Ant Design locale 与 `<html lang>` 已跟随当前语言：`web/src/components/layout/app-providers.tsx:24-45`。
- 当前词典有 439 个中文 key 和 439 个英文 key，现有 key 覆盖率为 100%。

### 2.2 核心问题是“使用率低”，不是“没有 i18n 基础设施”

对 `web/src` 中除 `messages.ts` 以外的 TypeScript/TSX 做 AST 审计：

- 116 个 TS/TSX 文件中，仅 24 个使用 `useI18n()`。
- 共有 972 处原始中文字面量，660 个唯一文本，分布于 58 个文件。
- 最集中的文件为：
  - `web/src/components/canvas/canvas-local-agent-panel.tsx`：175 处；可见状态/消息与内部数据混合，例见 `:102-157`, `:169-198`, `:354-416`, `:632-655`。
  - `web/src/components/canvas/canvas-assistant-panel.tsx`：172 处；内部 system prompt/tool schema 位于 `:30-114`，可见 UI 和日志从 `:202` 后广泛出现，必须分界处理。
  - `web/src/components/canvas/canvas-node-hover-toolbar.tsx`：53 处，工具栏动作从 `:120-150`、节点信息从 `:237-263`。
  - `web/src/components/canvas/canvas-toolbar.tsx`：43 处，主工具栏从 `:68-184`、aria/title 从 `:259-288`。
  - `web/src/services/api/video.ts`：37 处；稳定本地错误与上游原始错误混在一起，例见 `:38-66`, `:98-181`, `:242-310`。
  - `web/src/services/api/image.ts`：36 处；校验错误、HTTP 错误与上游消息混用，例见 `:139-215`, `:593-759`。

### 2.3 存在会被语言绑死的数据

- 图片生成日志将 `status` 持久化为 `"成功" | "失败"`：`web/src/pages/image/index.tsx:41-65`。
- 视频生成日志将 `status` 持久化为 `"生成中" | "成功" | "失败"`：`web/src/pages/video/index.tsx:43-69`，并在恢复/轮询时直接按中文比较：`:282-346`。
- 图片/视频日志保存 `toLocaleString("zh-CN")` 结果：`web/src/pages/image/index.tsx:728,814`、`web/src/pages/video/index.tsx:727,823`。
- WebDAV 同步进度以中文 `stage` 传递，视图又依赖中文文本计算进度：`web/src/services/app-sync.ts:66-75,83-170`、`web/src/components/layout/app-config-modal.tsx:195-202,510-533`。

### 2.4 词典类型会掩盖未来漏译

`en` 目前被定义为 `Partial<Record<...>>`，且运行时用 `{ ...zh, ...en }` 回退：`web/src/i18n/messages.ts:452,895-899`。这会使新增中文 key 但忘记英译时仍能通过编译，然后在英文 UI 中静默显示中文。

## 3. 翻译边界

### 必须本地化

1. JSX 文字，以及 `title` / `placeholder` / `aria-label` / `alt` / Tooltip / Modal / Tag 文本。
2. Toast、校验反馈、空状态、错误状态和用户可见活动日志。
3. 全站 Agent 和画布 Agent 的面板、工具确认、连接状态、历史标题及系统产生的可见日志。
4. 本地可预期的 service 错误。它们应使用稳定 error code，在 UI 展示边界根据当前 locale 翻译。
5. 日期、数字、状态名称；格式化发生在渲染时，而不是写入存储时。

### 默认保持不变

1. `canvas-assistant-panel.tsx:30-114` 的 AI system prompt 与 tool descriptions。
2. 模型交互所依赖的工具名、JSON 字段、协议状态、解析关键词和正则表达式。
3. 用户输入、模型返回、API 上游原始消息、提示词库内容、素材/画布内容；语言切换不翻译也不改写这些数据。
4. `docs/`、README 和 `canvas-agent/` CLI/服务端文本。它们没有接入 Web 应用的 locale store，如需要应作为独立的文档国际化项目处理。

## 4. 实施计划

### 阶段 0：先锁定现有行为与翻译边界

1. 为现有 locale store、`translate()` 参数插值、语言切换及 Ant Design locale 行为增加回归测试，覆盖 `web/src/i18n/use-i18n.ts:6-16`、`web/src/stores/use-language-store.ts:12-27`、`web/src/components/layout/app-providers.tsx:24-45`。
2. 对内部 AI prompt/tool schema 建立显式 allowlist 或内容快照，保证 UI 本地化不意外改写 `canvas-assistant-panel.tsx:30-114`及其他协议文本。

### 阶段 1：加固词典和静态检查

1. 在 `web/src/i18n/messages.ts` 中将英文词典改为精确 `Record<I18nKey, string>`，删除 `{ ...zh, ...en }` 对漏译的静默回退。
2. 增加可在 React 之外使用的纯函数翻译/格式化边界，但不在 service 中读取 React hook；保持 `useI18n()` 为组件入口。
3. 新增无依赖脚本 `web/scripts/check-i18n.mjs`，并在 `web/package.json` 加入 `i18n:check`：
   - 校验 zh/en key 完全一致；
   - 扫描 JSX 文字与常见用户可见属性中的 Han 字符；
   - 对 prompt/parser/protocol/测试数据使用小型、带原因的 reviewed allowlist，禁止以全文件跳过来掩盖 UI 漏译。

### 阶段 2：先收口全局布局和通用交互

1. 转换顶部导航、移动端导航、配置弹窗、版本更新、根节点初始化 Toast 和全站 Agent 容器，主要文件：
   - `web/src/components/layout/app-top-nav.tsx`、`mobile-nav-drawer.tsx`、`app-config-modal.tsx`、`version-release-modal.tsx:7-70`、`client-root-init.tsx:44`；
   - `web/src/components/agent/agent-panel.tsx:62-78`；
   - `web/src/constant/navigation-tools.ts:3-34`。
2. 消除常量中“同时存 label 和 labelKey”的双重真相；UI 只通过 key 渲染，内部 slug/enum 继续保持语言无关。

### 阶段 3：按从小到大的批次覆盖 Canvas UI

1. **工具栏和辅助控件**：`canvas-toolbar.tsx:68-184,259-288`、`canvas-zoom-controls.tsx:27-67`、`canvas-node-hover-toolbar.tsx:120-150,237-263`、`canvas-image-toolbar-tools.tsx`。
2. **节点面板和状态**：`canvas-node.tsx`、`canvas-config-node-panel.tsx`、`canvas-node-prompt-panel.tsx`、`canvas-node-generation.ts`、`canvas-connections.tsx`、`canvas-mini-map.tsx`。
3. **弹窗/操作流**：`asset-picker-modal.tsx:19-125`、节点裁剪/遮罩/分割/放大/角度弹窗、`canvas-image-toolbar-settings-modal.tsx`、`canvas-delete-projects-dialog.tsx`、`canvas-context-menu.tsx`。
4. **项目页边界**：处理 `web/src/pages/canvas/project.tsx` 的可见菜单/错误，保留该文件中的生成 prompt 和内部协议文本。
5. 每个批次完成后单独运行 `i18n:check` + TypeScript，避免把 972 处差异累积为一个难以审查的大批次。

### 阶段 4：本地化 Agent 可见面，但隔离模型协议

1. 为 `canvas-agent-chat-ui.tsx` 中工具确认、附件、状态、aria 文本接入 `t()`，例见 `:41-115,182-247,300-304`。
2. 将 `canvas-local-agent-panel.tsx` 中可见活动状态从中文字符串改为稳定 code + 渲染时 label；连接、会话、删除和复制反馈要随 locale 更新，例见 `:102-157,169-198,354-416,632-655`。
3. 将 `canvas-assistant-panel.tsx` 分成两个明确边界：
   - protocol/system/tool descriptions 保留原文；
   - tabs、日志标题、确认状态、错误 fallback、历史和空状态通过 `t()` 渲染，例见 `:202-443,477-555`。
4. `web/src/lib/agent/agent-site-tools.ts:32-41,97-237` 的工具名称和交互返回值要分类：用户可见 label 使用 i18n key，模型协议中的稳定字段和工具名不改。

### 阶段 5：将持久化数据改为语言无关

1. 将图片/视频日志 status 统一为 `pending | success | failed`，渲染时使用 `image.status.*` / `video.status.*`。
2. 在 `normalizeLog()` 增加一次性兼容层：读取旧 `生成中/成功/失败` 值时转换成稳定 code；新写入不再保存任何 locale 文本。不删除现有 localforage/WebDAV 日志。
3. 日志时间使用 `createdAt` + `Intl.DateTimeFormat(language)` 在渲染时生成；旧 `time` 只作兼容输入，不再作新数据的本地化真相。
4. 将 `AppSyncProgressEvent.stage` 改为稳定 `stageCode` + 参数，将 `domainLabel()` 改为语言无关 key；修改 `app-config-modal.tsx:195-202,510-533` 使进度数值依赖 code 而非中文。
5. 为新旧日志、WebDAV 同步数据与切换语言后的重新渲染增加回归测试。

### 阶段 6：统一 service 错误的展示边界

1. 新增一个小型、无依赖的 `AppError`/error descriptor，保存 `code`、插值参数和可选上游 raw message；不把 locale 注入 API 层。
2. 先转换本地可预期错误：
   - 图片尺寸、请求取消、鉴权/限流、未返回图片：`web/src/services/api/image.ts:139-215,593-759`；
   - 视频超时、参考素材约束、缺失配置：`web/src/services/api/video.ts:38-66,98-181,242-310`；
   - 音频、WebDAV、版本检查、存储等同类本地 fallback：`web/src/services/api/audio.ts:45-79`、`web/src/services/webdav-sync.ts:10-109`、`web/src/hooks/use-version-check.ts:52-62`。
3. UI catch 边界使用当前 `t()` 解析 `AppError`；上游 API/模型返回的原始错误保留原文，不进行猜测式机器翻译。
4. 避免“传入 `t()` 给每个 service”：这会让业务层被当前 locale 污染，也可能将已翻译文本写入日志。

### 阶段 7：全路由验收与文档收尾

1. 覆盖路由清单：`/`、`/image`、`/video`、`/assets`、`/prompts`、`/canvas`、`/canvas/:id`、`*` / 404，来自 `web/src/router.tsx:13-30`。
2. 验收页面本体、移动端菜单、配置弹窗、确认框、Toast、空状态、失败状态、Agent 对话/日志、aria 标签，并在浅色/深色和桌面/移动尺寸下检查英文溢出。
3. 运行 `npm run i18n:check`、`npm run format:check`、`npm run build`及全部 `web/tests` 测试。
4. 更新 `docs/content/docs/progress/pending-test.mdx` 和 `CHANGELOG.md`，记录覆盖范围、旧数据兼容策略与明确排除项。

## 5. 验收标准

1. 在 `/`、`/image`、`/video`、`/assets`、`/prompts`、`/canvas`、`/canvas/:id` 和 404 页任意位置切换语言，所有系统 UI 不刷新即更新。
2. 英文模式下，静态 UI、Tooltip、aria-label、Modal、Toast、空/错误状态和系统生成的 Agent 日志不出现未审批的中文；用户数据、模型/API 原始内容除外。
3. zh/en key 集合 100% 对等，英文 key 漏失会在 TypeScript 或 `i18n:check` 中失败，不得在运行时静默回退到中文。
4. 新持久化的图片/视频日志和同步进度只使用稳定 code/时间戳；切换 locale 不改写用户数据。
5. 已存在的 `生成中/成功/失败` 日志仍能读取、恢复 pending 任务并在两种语言下正确显示。
6. 语言切换不改变内部 AI prompt、tool name/schema、画布 JSON、用户 prompt、素材内容或模型返回文本。
7. 英文文本在 390px 宽度和常见桌面宽度下不遮挡核心操作，不出现水平页面溢出。
8. `npm run i18n:check`、`npm run format:check`、`npm run build` 和全部 Web 测试通过。

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 把 system prompt/tool schema 当成 UI 翻译，造成 Agent 行为回归 | 先锁定 prompt 边界；静态检查使用有理由的精确 allowlist，不使用整文件排除 |
| 修改已持久化的中文 status 后旧日志无法恢复 | 在 `normalizeLog()` 读边界做双向兼容测试，新写入只用稳定 code |
| 把 API/模型返回的原始错误误当成本地 key | 只翻译本地可预期 error code；raw upstream message 保留并明确标识 |
| 为消除 Han 扫描结果而过度 allowlist | CI 报告文件+行+上下文；allowlist 每项必须有原因并限制到小范围 |
| 972 处一次性修改导致审查和回归困难 | 按全局 UI → Canvas 工具栏 → 节点/弹窗 → Agent → 数据/service 分批，每批独立验证 |
| 英文更长导致布局溢出 | 验收 390px + 桌面宽度，重点检查工具栏、标签页、弹窗按钮和 Agent 面板 |

## 7. 执行约束与停止条件

- 不新增第三方依赖。
- 复用现有 `messages.ts` / `useI18n()` / locale store，不引入第二套 i18n 框架。
- 保留当前工作树中的既有修改，实施前重读目标文件，不回退非本任务改动。
- 如发现某个中文字面量既可能是 UI，又可能被模型/解析器依赖，先停在该小边界并保留原文，不做猜测式替换。
- 只在上述验收标准全部满足后报告完成。

## 8. 批准时需确认的范围

推荐批准本计划的默认范围：**Web 应用所有用户可见 UI + Agent 可见系统日志，保持 AI system prompt/tool schema/protocol 原文不变**。

如果要同时本地化 AI system prompt/tool descriptions，将扩大为“模型行为国际化”，需要另外的中英文 Agent 行为对等测试，不建议和 UI 收口混在同一批次。
