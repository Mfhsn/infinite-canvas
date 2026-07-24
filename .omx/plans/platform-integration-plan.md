# 无限画布接入外部平台 Integration 最终方案

> 状态：V1.0 已实施并完成本地自动化验证  
> 文档基线：Apifox Integration 文档，最后更新时间 2026-07-10  
> 流程图：[platform-integration-flow.drawio](./platform-integration-flow.drawio)

## 0. V1.0 实施结果（2026-07-21）

本轮已完成以下范围：

- 平台账号密码登录、外部 Token 会话交换、会话恢复和退出。
- 浏览器只持有 `HttpOnly` Cookie；`external_token`、`refresh_token`、`local_token` 均由服务端加密保存。
- 用户昵称、权限 ID、积分和当前平台项目上下文展示。
- MySQL 数据按 `source_system + uid + local_project_id` 的 canonical tuple 哈希隔离。
- Storage 与 Dream 请求同时校验 Cookie 和 `X-Canvas-Session-Binding`，阻止旧标签页/旧异步请求写入新账号空间。
- Dream/LLM/TTS API 由服务端注入当前会话的 `external_token`，不再向上游转发浏览器 Cookie 或固定 Token；Integration 返回的 `local_token` 只用于 Integration 上下文接口；媒体 CDN 不接收平台 Token。
- 本地 Vite 开发模式在 Integration 开启时统一代理到 Storage Server，关闭时保持原单机模式。
- Docker Integration 模式会过滤浏览器可见的 `VITE_AI_API_KEY` 和可能包含 Key 的渠道 JSON。

暂不包含：历史记录列表、平台项目 CRUD/切换、积分扣减闭环、Token 动态刷新、Agent function call。

自动化验证：Storage Server 20 项测试通过；Web 128 项测试、i18n、TypeScript、生产构建和浏览器 Token 扫描通过。真实平台账号及真实 MySQL 迁移仍需部署环境联调。

## 1. 目标结果

将无限画布从“固定 Token + 全局数据空间”改造为可接入现有平台的多用户应用，实现：

1. 外部平台账号登录或 SSO 会话交换。
2. 在画布端显示用户资料、权限、当前积分和当前平台项目。
3. 将画布、文件夹、素材、生成记录和媒体文件按 `用户 + 平台项目` 隔离。
4. 图像、视频、音频和 LLM 请求使用当前会话凭证，不再依赖浏览器内的全局共享 Token。
5. 积分扣减以平台返回为权威值，前端只做预估和展示。
6. 保留现有单机/Browser 存储模式作为可配置降级路径。

## 2. Apifox Integration 文档理解

### 2.0 会议结论对首版范围的澄清

根据会议总结，首版范围调整为：

1. **账号系统不在画布内重新建设**：画布接入现有平台账号，实现身份认证、用户信息、积分获取和权限控制。因此 External Register 不是 MVP 必需功能，除非平台方明确要求画布提供注册入口。
2. **历史记录必须与账号关联**：服务端需按用户保存历史，mr 提供历史列表接口，画布前端负责列表 UI、筛选、翻页和进入详情/画布。
3. **Agent function call 不进入本轮账号对接主线**：当前模型不支持工具调用，不应让该能力阻塞登录、积分和历史记录上线。在支持 function call 的模型/接口确定前，Agent 保持现有无工具模式或显式禁用工具操作。
4. **外部项目创建、编辑、申请不是 MVP 必需**：Integration 文档虽提供这些接口，但会议目标是账号、积分和历史。首版只在会话确实要求项目上下文时接入“当前项目”，完整项目管理放入后续版本。

### 2.0.1 APRD 版本优先级

| 版本 | 优先级 | 范围 | 外部依赖 | 发布门禁 |
| --- | --- | --- | --- | --- |
| V1.0 账号接入 | P0 | SSO/登录、会话恢复、用户信息、积分展示、登出、存储用户隔离 | 起跑线账号接口契约与权限矩阵 | 多用户数据隔离、Token 不泄漏、过期/登出闭环通过 |
| V1.1 历史记录 | P0/P1 | 历史列表、筛选、翻页、缩略图、打开画布/结果、空状态与错误重试 | mr 提供历史列表接口和数据字典 | 只能查到当前账号数据，页面和筛选结果稳定 |
| V1.2 权限与平台项目 | P1 | 权限粒度、项目上下文/切换，必要时接入项目列表 | permission ID 映射、项目切换契约 | 前后端权限一致，切换时无数据串项目 |
| V1.3 积分闭环 | P1 | 生成前预估、提交/完成后刷新、不足提示、幂等重试 | 积分扣减/退还和不足错误契约 | 不重复扣分，前端不伪造权威余额 |
| V2.0 Agent 工具调用 | P2/阻塞 | function call、工具权限、审批、执行结果和审计 | 支持 function call 的模型与稳定接口 | 模型支持、工具 Schema 稳定、高风险操作有用户确认 |

### 2.0.2 会议后仍需确认的历史记录契约

会议已明确“mr 提供列表接口”，但尚未明确“历史”的完整定义。在 UI 实施前需确认：

1. 历史范围是画布文档、AI 生成任务/结果，还是两者都包含。
2. 接口路径、鉴权方式、页码/cursor 翻页、默认排序和单页上限。
3. 是否支持类型、状态、关键词、创建时间、更新时间和项目筛选。
4. 每项至少需要：`id`、`type`、`title`、`status`、`thumbnail_url`、`created_at`、`updated_at`、`canvas_id`、`task_id`、`result_id`。不适用字段可为 `null`。
5. 历史项的打开、恢复、删除、重试、收藏/永久保存权限与接口。
6. 媒体 URL 的有效期、是否为签名 URL，以及过期后的重新获取方式。
7. 列表接口必须在服务端使用当前账号身份筛选，不允许前端传任意 `user_id` 查询他人数据。

### 2.1 接口矩阵

| 能力 | 方法与路径 | 凭证 | 关键输入/输出 | 计划中的用途 |
| --- | --- | --- | --- | --- |
| 会话交换 | `POST /api/integration/session/exchange` | **文档未明确** | 返回 `local_token`、`expires_at`、用户、权限、积分、内外项目 ID | SSO 入口与本地会话建立 |
| 外部注册 | `POST /api/integration/external/auth/register` | 无 | `username/password/owner` | 独立登录模式的可选注册 |
| 外部登录 | `POST /api/integration/external/auth/login` | 无 | 返回 `external_token`、`refresh_token`、`profile` | 独立登录或 SSO 失败后的备用路径 |
| 外部登出 | `POST /api/integration/external/auth/logout` | `X-External-Token` | 响应示例为 `null` | 同时注销外部和画布本地会话 |
| 用户资料 | `GET /api/integration/external/profile` | `X-External-Token` | `id/username/nickname/owner/points` | 登录后资料初始化与手动刷新 |
| 外部项目列表 | `GET /api/integration/external/projects` | `X-External-Token` | `project_id/name/points/permission[]` | 平台项目选择器 |
| 外部项目详情 | `GET /api/integration/external/projects/{project_id}` | `X-External-Token` | 文档响应模型未展开 | 切换前校验与详情展示 |
| 创建外部项目 | `POST /api/integration/external/projects/create` | `X-External-Token` | `name/content/tag/skill/skill_model/points` | 第二阶段项目管理 |
| 编辑外部项目 | `POST /api/integration/external/projects/edit` | `X-External-Token` | `project_id` 及项目字段 | 第二阶段项目管理 |
| 申请加入项目 | `POST /api/integration/external/projects/apply` | `X-External-Token` | `project_id` | 无权限项目的申请流程 |
| 当前上下文 | `GET /api/integration/context/current` | `Authorization: Bearer <local_token>` | 用户、内外项目 ID、权限和当前积分 | 会话恢复、权限与积分刷新 |

### 2.2 文档已确认的业务语义

- 外部登录产生 `external_token`，会话交换产生用于当前本地上下文的 `local_token`。
- 会话上下文同时绑定用户与项目：`uid + source_system + external_project_id + local_project_id`。
- 用户级积分与项目级积分在不同响应中出现，不能由前端假定它们是同一账本。
- `permission_ids` / `permission[]` 只提供数字 ID，文档没有权限 ID 与操作的对照表。
- 项目创建、编辑、申请和详情的成功响应模型在公开文档中不完整，客户端必须做宽容解析。

### 2.3 实施前必须确认的契约

1. `session/exchange` 的外部令牌究竟通过 `Authorization`、`X-External-Token`、Cookie 还是请求 Body 传入。当前公开示例仅为 `{}`。
2. 从现有平台跳转/嵌入画布时，外部凭证的交付方式：一次性 ticket、顶层页面 `postMessage`、后端回调或直接 Token。推荐一次性 ticket，不推荐 URL 明文 Token。
3. `local_token` 到期后的刷新方式；外部登录返回的 `refresh_token` 是否适用于通用 `/api/v1/token/refresh`。
4. 切换外部项目时如何让 `session/exchange` 选中指定 `project_id`。
5. 积分扣减时机、不足错误码、任务失败退还策略，以及用户积分与项目积分的优先级。
6. `permission_ids` 的权限矩阵，以及项目 create/edit/apply 成功响应的完整 Schema。
7. 注册默认归属“奇想宇宙”时的 `owner` 精确值和是否允许画布端对外开放注册。

## 3. 当前项目差距

| 当前实现 | 证据 | 差距 |
| --- | --- | --- |
| 用户 Store 只有内存中的 `LocalUser | null` 和 `clearSession` | `web/src/stores/use-user-store.ts:3-18` | 没有会话恢复、Token 过期、积分、权限和项目上下文 |
| 顶部操作区只有文档、配置、语言、主题和快捷键 | `web/src/components/layout/user-status-actions.tsx:19-67` | 没有登录入口、用户菜单、积分与平台项目选择 |
| 存储配置返回固定 `namespace` | `storage-server/src/routes.ts:24-29`; `storage-server/src/config.ts:28` | 所有用户可能共用同一数据空间 |
| `/api/storage/documents` 和 `/api/storage/blobs` 无身份验证 | `storage-server/src/routes.ts:21-107` | 公网环境下可能越权读写全部画布与媒体 |
| MySQL 主键已包含 `namespace` | `storage-server/migrations/001_init.sql` | 底层已具备租户分区能力，但请求层尚未动态派生 namespace |
| 前端 HTTP 存储请求不携带显式身份 | `web/src/services/storage/http-repository.ts:9-119` | 需通过同源 HttpOnly Cookie 自动带上会话 |
| 项目已有 Dream 同源代理 | `storage-server/src/dream-proxy.ts:6-43`; `storage-server/src/server.ts` | 可复用为 AI 请求 BFF，但现在仍依赖浏览器传入 Bearer Token |
| Docker 运行时将 `VITE_*` 写入浏览器 `env.js` | `docker/runtime-env.sh` | 敏感平台 Token/会话密钥不能使用 `VITE_*` 暴露给浏览器 |

## 4. 推荐架构

### 4.1 决策

采用 **Canvas 同源 BFF（`storage-server`）管理平台凭证**：

- 浏览器只持有 `HttpOnly + Secure + SameSite=Lax/Strict` 的 Canvas 会话 Cookie。
- `external_token`、`refresh_token` 和 `local_token` 仅在服务器端使用，必要持久化时使用 AES-GCM 加密。
- BFF 代理 Integration 和 AI 请求，注入当前用户的 `local_token`。
- 每个存储请求从服务器会话派生：

```text
namespace = sha256(source_system + ":" + uid + ":" + local_project_id)
```

- 平台“项目”与画布内的“画布项目”是两个层级：平台项目是数据租户/工作区，其下可以有多个 CanvasProject。

### 4.2 不选择浏览器直连的原因

- 外部和本地 Token 会进入 localStorage/内存，XSS 后可直接被窃取。
- 无法为 `/api/storage` 建立可信的服务端身份与 namespace。
- 外部平台的 CORS、TLS SNI 和地址变化会泄漏到前端。
- 无法中央化做日志脱敏、重试、限流和会话刷新。

## 5. 数据模型

### 5.1 新增表

1. `integration_sessions`
   - `session_id_hash`（主键，不存明文 Cookie）
   - `uid`、`username`、`nickname`、`source_system`
   - `external_project_id`、`local_project_id`
   - `permission_ids JSON`、`current_points`
   - `external_token_ciphertext`、`refresh_token_ciphertext`、`local_token_ciphertext`
   - `local_token_expires_at`、`session_expires_at`、`created_at`、`updated_at`
2. `integration_project_bindings`
   - `source_system + external_project_id` 唯一
   - `local_project_id`、`project_name`、`status`、`last_synced_at`
3. `integration_audit_logs`
   - `uid`、`local_project_id`、`action`、`request_id`、`result`、`created_at`
   - 禁止记录 Token、密码和完整生成输入。

### 5.2 现有存储表

`storage_documents` 与 `storage_blobs` 不需重建，继续使用现有 `namespace` 主键分区。请求处理时不再直接使用全局 `STORAGE_NAMESPACE`，而是使用会话派生值。

## 6. 分阶段实施计划

### 阶段 0：契约联调与可执行基线

1. 为 11 个 Integration 接口建立非生产环境的 `curl`/自动化契约测试，保存脱敏请求与实际响应 Schema。
2. 逐项关闭第 2.3 节的 7 个契约缺口，特别是 exchange 凭证位置、刷新、项目切换和积分账本。
3. 确定平台跳转到画布的入口契约，推荐一次性 `integration_ticket`，消费后立即失效。

**验收：** 所有请求字段、认证头、成功/失败响应、积分规则和权限矩阵都有可固定为测试的样本。

### 阶段 1：后端 Integration Client 与 BFF 路由

1. 新建 `storage-server/src/integration/client.ts`，封装 11 个接口，统一超时、错误映射、request-id 和响应宽容解析。
2. 新建 `storage-server/src/integration/routes.ts`，向浏览器提供同源 `/api/platform/*` 路由，不暴露外部 Token。
3. 在 `storage-server/src/config.ts` 增加仅服务器可见的 `INTEGRATION_*` 配置，不写入 `docker/runtime-env.sh` 的浏览器 env.js。
4. 复用 `dream-proxy.ts` 已有的 HTTPS/SNI 连接能力，抽取服务端 upstream transport，不新增依赖。

**验收：** 契约测试可以在 mock upstream 下覆盖 200、401/403、422、429、5xx、超时和非 JSON 响应。

### 阶段 2：安全会话与数据库迁移

1. 新建 `002_integration.sql`，增加会话、项目映射和审计表。
2. 将 `mysql-repository.ts` 的迁移执行器从硬编码 `001_init.sql` 改为按版本顺序、幂等执行全部未应用迁移。
3. 实现会话 Cookie、服务端 Token 加密、过期、滑动/绝对超时、登出清理和日志脱敏。
4. 对所有变更类 `/api/platform/*` 和 `/api/storage/*` 请求校验 `Origin` 或 CSRF Token。

**验收：** Cookie 不能被 JavaScript 读取；数据库和日志中无明文 Token；过期会话返回统一 401；迁移可重复启动而不报错。

### 阶段 3：存储身份化与多租户隔离

1. 在 `storage-server/src/routes.ts` 引入 `RequestAuthContext`，先验证 Canvas 会话，再访问 documents/blobs。
2. 从会话派生 `namespace`，禁止客户端传入或覆盖。
3. 保留 `DATA_STORAGE_DRIVER=browser` 的本地模式；当 `INTEGRATION_ENABLED=true` 且使用 MySQL 时强制鉴权。
4. 制定旧 `namespace=default` 数据的归属策略：管理员显式指定导入某用户/项目，不自动广播给所有用户。

**验收：** 用户 A/项目 1、用户 A/项目 2、用户 B/项目 1 三组数据互不可见；未登录用户不能访问 MySQL 存储 API。

### 阶段 4：前端登录、启动恢复与用户 UI

1. 新建 `web/src/services/api/platform-integration.ts`，只调用同源 `/api/platform/*`。
2. 扩展 `use-user-store.ts`：`status`、`profile`、`permissions`、`points`、`currentPlatformProject`、`expiresAt`，不保存 Token。
3. 在 `client-root-init.tsx` 启动时调用 `/api/platform/context`，完成 loading/authenticated/anonymous/expired 状态机。
4. 增加 SSO ticket 消费页和独立登录弹窗；注册 UI 受服务端功能开关控制。
5. 改造 `user-status-actions.tsx`：未登录显示登录；已登录显示头像/昵称、积分、项目与登出菜单。
6. 补齐中英文 i18n 与 401/403/422/429/超时等可操作错误提示。

**验收：** 刷新页面会恢复会话；登出后受保护数据立即不可访问；浏览器 localStorage/sessionStorage/URL 中不出现外部或本地 Token。

### 阶段 5：平台项目与权限

1. 在用户菜单内增加“平台项目”选择器，与画布内的 CanvasProject 切换器区分命名。
2. 项目切换先通过后端建立新项目会话，成功后再重置前端 Store 并重新 hydrate 存储域。
3. 将 `permission_ids` 转换为服务端能力集，前端只用于隐藏/禁用 UI，后端仍必须做最终授权。
4. 第二迭代再开放外部项目创建、编辑和申请，首版只做列表、查看和切换。

**验收：** 项目切换不会短暂展示上一项目的画布；无权操作前后端都拒绝；切换失败保留原项目上下文。

### 阶段 6：AI 生成、积分与任务状态

1. 将 Dream/LLM/TTS 同源代理从“转发浏览器 Authorization”改为“从服务器会话注入 `external_token`”；`local_token` 仅用于 Integration 上下文查询。
2. 保留 `VITE_AI_API_KEY` 仅用于管理员单用户/兼容模式；Integration 模式下禁止浏览器覆盖平台凭证。
3. 任务提交前展示本地预估成本；任务提交后、完成后和积分不足后调用 context/current 刷新权威积分。
4. 每次任务提交生成 request-id/idempotency-key；若上游支持，将其传入以防止超时重试重复扣费。
5. 积分显示标记数据时间，不通过前端简单减法伪造最终余额。

**验收：** 两个不同用户的 AI 请求使用各自会话；积分不足有明确引导；超时重试不会在已确认任务创建后再次提交。

### 阶段 7：历史记录、运维与上线

1. 画布列表仍使用现有 Canvas Store/Storage API，但由会话 namespace 自动关联到用户和平台项目。
2. 生成任务历史优先调用现有 Task API；画布内的本地生成节点保留上游 task_id/result_id 作为关联键。
3. 增加身份失败率、exchange 耗时、upstream 401/429/5xx、会话数、存储越权拒绝数和积分刷新失败的结构化日志/指标。
4. 使用功能开关分阶段发布：内部账号 → 指定项目 → 全量；保留固定 Token 快速回退。

**验收：** 可以根据 request-id 追踪一次登录、项目切换、任务生成和积分刷新；回滚不破坏新老 namespace 数据。

## 7. 环境配置计划

以下变量仅供服务器读取，不得使用 `VITE_` 前缀：

```dotenv
INTEGRATION_ENABLED=false
INTEGRATION_AUTH_MODE=sso
INTEGRATION_BASE_URL=https://106.75.147.147
INTEGRATION_TLS_SERVER_NAME=prod-cn.just4fun.sg
INTEGRATION_TLS_DISABLE_SNI=true
INTEGRATION_SOURCE_SYSTEM=
INTEGRATION_DEFAULT_OWNER=
INTEGRATION_SESSION_SECRET=
INTEGRATION_COOKIE_NAME=infinite_canvas_session
INTEGRATION_SESSION_TTL_SECONDS=86400
INTEGRATION_CONNECT_TIMEOUT_MS=30000
INTEGRATION_REQUEST_TIMEOUT_MS=180000
```

`INTEGRATION_SESSION_SECRET` 必须由 Docker secret/密钥管理服务注入，不复制进镜像，不写入 `env.js`。

## 8. 测试与验证

### 8.1 单元测试

- Integration 请求/响应解析、错误映射、Token 脱敏。
- namespace 派生稳定且不可逆。
- 会话过期、权限能力映射和积分时间戳。
- MySQL 迁移顺序、幂等性和失败回滚。

### 8.2 集成测试

- 登录 → exchange → context → storage 读写 → logout 闭环。
- 外部项目切换后前端 Store 重置和不同 namespace 数据隔离。
- AI 代理使用会话 Token，401 刷新/失效处理和积分刷新。
- CSRF、会话固定、篡改 Cookie、越权访问和重放测试。

### 8.3 E2E 测试

- SSO 跳转、独立登录、刷新恢复、过期重登录、登出。
- 两用户、两平台项目、多画布的隔离和切换。
- 积分足/不足、生成成功/失败/超时/重试。
- 手机端顶导航的用户菜单、积分和项目选择。

### 8.4 安全审计

- 浏览器存储、URL、前端 bundle、日志和错误响应中都不得出现凭证。
- 所有用户/项目级资源执行 IDOR 测试。
- Cookie 属性、CORS、CSP、Origin/CSRF 校验和上游 TLS 校验符合生产要求。

## 9. 主要风险与缓解

| 风险 | 结果 | 缓解 |
| --- | --- | --- |
| exchange 契约不完整 | 无法稳定建立会话 | 阶段 0 必须完成真实环境契约测试，未关闭不开发会话主链路 |
| 旧存储 API 无鉴权 | 严重越权/数据泄漏 | Integration+MySQL 模式下强制会话，namespace 只由服务器派生 |
| 项目切换时 Store 残留 | 短暂展示其他项目数据 | 先确认新会话，再原子性清空/re-hydrate，切换期间显示阻断层 |
| Token 刷新契约不明 | 长会话突然中断 | 明确 refresh 后再设计自动刷新；首版可在过期前主动提示重新交换 |
| 超时重试重复扣分 | 用户资产损失 | 强制 request-id/idempotency，重试前先查询任务是否已创建 |
| 上游 106.75.147.147 HTTPS/SNI 特殊 | 生产环境握手失败 | 复用现有 TLS server-name transport，禁止为解决问题而关闭证书校验 |

## 10. Pre-mortem

1. **上线后用户看到他人画布**  
   根因：某些 Storage API 仍使用全局 `default` namespace。  
   预防：路由层单一 `requireAuthContext()` 入口，测试覆盖所有 documents/blobs 方法，Integration 模式下禁止 fallback。
2. **用户生成一次却扣两次积分**  
   根因：前端超时后重新提交，但首次任务已在上游创建。  
   预防：幂等键、本地任务提交记录、超时后先查询再决定是否重试。
3. **会话 Token 在日志或前端中泄漏**  
   根因：沿用当前 `VITE_AI_API_KEY` 或记录完整 upstream 请求头。  
   预防：Token 只存 BFF，日志层黑名单脱敏，CI 扫描 bundle/源码/日志样本。

## 11. 可测试验收标准

- [ ] 用户可通过 SSO 或开启后的独立登录进入画布，刷新后会话恢复。
- [ ] 顶部显示当前用户、平台项目、权限可用性和带时间戳的积分。
- [ ] 不同用户/平台项目的画布、文件夹、素材、生成记录和 blob 无法互相读写。
- [ ] 未登录或过期会话访问 Integration+MySQL 存储 API 统一返回 401。
- [ ] 生成请求使用当前用户会话凭证，前端不持有上游 Token。
- [ ] 任务状态变化后会刷新权威积分，超时重试不重复创建已存在任务。
- [ ] 登出使 Canvas 会话和外部平台令牌失效，并清空前端受保护 Store。
- [ ] 敏感 Token 不出现在 URL、Web Storage、前端 bundle、应用日志或错误响应中。
- [ ] Browser 存储模式仍可在不开启 Integration 时独立运行。

## 12. 实施顺序与停止条件

推荐顺序：`0 契约 → 1 BFF → 2 会话 → 3 数据隔离 → 4 登录 UI → 5 项目 → 6 AI/积分 → 7 上线`。

任一以下条件未满足时不进入生产发布：

- exchange 和 Token 刷新契约未确认。
- 权限 ID 与操作映射未确认。
- 多用户/多项目隔离 E2E 未通过。
- 凭证泄漏审计未通过。
- 积分超时重试/幂等性策略未通过联调。

## 13. 文档来源

- [Exchange Session](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955790e0)
- [External Register](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955791e0)
- [External Login](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955792e0)
- [External Logout](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955793e0)
- [External Profile](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955794e0)
- [External Projects](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955795e0)
- [External Project Detail](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955796e0)
- [External Create Project](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955797e0)
- [External Update Project](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955798e0)
- [External Apply Project](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955799e0)
- [Get Current Context](https://s.apifox.cn/ac4a0053-9e00-4028-a517-f4f343a7c43a/484955800e0)
