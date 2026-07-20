# 公网多用户数据隔离、鉴权与 revision 冲突治理计划

## 1. 目标

将当前“所有公网访问者共享固定 `STORAGE_NAMESPACE=default`”的存储模型升级为：

1. 用户必须通过应用自身登录后才能访问 Storage API 和 Dream 生成代理。
2. 服务端根据已认证的 `user_id` 派生数据 namespace，浏览器不能指定或伪造 namespace。
3. 不同用户即使使用相同的项目 ID、资源 Key，也不会相互读取、覆盖或产生 revision 冲突。
4. 同一用户出现真正的并发写入时，保留乐观锁，并提供可恢复的冲突处理而不是静默覆盖。
5. 浏览器数据迁移到 MySQL 后立即同步 revision，不再要求用户靠手动刷新消除旧版本。
6. 固定 Dream API Token 只保留在服务端，不再写入 `env.js` 或由浏览器发送。

## 2. 当前实现与问题依据

- `storage-server/src/config.ts:20-49`：服务启动时从单个 `STORAGE_NAMESPACE` 读取全局 namespace，默认值为 `default`。
- `storage-server/src/routes.ts:26-55`：Storage API 当前没有登录或会话校验。
- `storage-server/src/routes.ts:61-133`：所有文档和 Blob 请求均直接使用 `ctx.config.namespace`，所以所有公网客户端共享同一数据空间。
- `storage-server/src/mysql-repository.ts:109-127,141-208`：MySQL 使用 revision 乐观锁；revision 不一致时正确拒绝覆盖。
- `web/src/lib/localforage-storage.ts:25-64`：客户端只在加载时建立 revision baseline，后续保存携带该 baseline。
- `web/src/services/storage/migrate-browser-data.ts:44-57`：浏览器迁移直接写 repository，但不会更新 `CollectionRevisionTracker`，当前页面之后可能继续使用旧 revision。
- `docker/runtime-env.sh:17-49`：`VITE_AI_API_KEY` 当前会写入浏览器可读取的 `env.js`，公网访问者可以取得固定 Token。

## 3. 范围与默认决策

### 3.1 本期范围

- 应用本地账号登录、登出、当前会话查询。
- 默认关闭公开注册；管理员创建账号。
- HttpOnly Cookie Session。
- MySQL 用户、会话表。
- Storage API 按用户隔离。
- Dream API 代理受登录保护，固定 Token 改由服务端注入。
- `default` namespace 数据安全迁移到首个管理员账号。
- revision 冲突恢复、迁移后 revision 同步。
- Docker、环境变量、SQL、测试和部署文档更新。

### 3.2 暂不包含

- OAuth、微信、GitHub 等第三方登录。
- 组织、团队、共享空间和项目协作权限。
- 同一画布的 CRDT/OT 实时多人编辑。
- 找回密码邮件服务。

### 3.3 默认身份方案

采用“服务端账号 + 随机不透明 Session Token”：

- 密码使用 Node `crypto.scrypt`，不新增认证依赖。
- 浏览器仅保存 `HttpOnly` Session Cookie。
- 数据库存储 Session Token 的 SHA-256 哈希，不保存明文 Token。
- namespace 由服务端生成：`user:<user_id>`。
- 不使用 `VITE_AI_API_KEY`、Dream JWT 中的 `user_id` 或浏览器 localStorage 作为应用身份。

## 4. 数据库设计与迁移

### 4.1 新增迁移

新增：

```text
storage-server/migrations/002_auth_and_user_namespaces.sql
```

同步更新：

```text
database/infinite_canvas.sql
```

### 4.2 新增表

`app_users`：

```sql
id              VARCHAR(36) PRIMARY KEY
username        VARCHAR(64) UNIQUE NOT NULL
password_hash   VARBINARY/TEXT NOT NULL
password_salt   VARBINARY/TEXT NOT NULL
password_params JSON NOT NULL
status          VARCHAR(16) NOT NULL DEFAULT 'active'
created_at      DATETIME(3) NOT NULL
updated_at      DATETIME(3) NOT NULL
```

`app_sessions`：

```sql
id_hash         BINARY(32) PRIMARY KEY
user_id         VARCHAR(36) NOT NULL
expires_at      DATETIME(3) NOT NULL
created_at      DATETIME(3) NOT NULL
last_seen_at    DATETIME(3) NOT NULL
user_agent_hash BINARY(32) NULL
FOREIGN KEY user_id -> app_users(id)
INDEX(user_id, expires_at)
```

可选的第二阶段 `project_edit_leases`：

```sql
user_id, project_id, client_id, expires_at
PRIMARY KEY(user_id, project_id)
```

### 4.3 现有存储表

首期保留现有主键：

```text
(namespace, domain, record_key)
(namespace, storage_key)
```

不增加 `user_id` 列，而是由服务端把已认证用户映射为 `user:<id>`。这样可以复用现有 repository，降低迁移风险。

### 4.4 数据迁移原则

1. 数据库先完整备份。
2. 首次部署创建管理员用户。
3. 将 `default` 数据先复制而不是直接移动到 `user:<admin_id>`。
4. 校验文档数量、Blob 数量和 Blob 总字节数一致。
5. 切换应用读取管理员 namespace。
6. 验收稳定后再将 `default` 标记为只读归档；至少保留一个回滚周期。
7. 如果目标 namespace 已有同 Key 数据，迁移中止并生成冲突报告，禁止 `INSERT ... ON DUPLICATE KEY UPDATE` 静默覆盖。

## 5. Storage Server 鉴权架构

### 5.1 新增模块

建议新增：

```text
storage-server/src/auth/config.ts
storage-server/src/auth/password.ts
storage-server/src/auth/session.ts
storage-server/src/auth/repository.ts
storage-server/src/auth/routes.ts
storage-server/src/auth/cookies.ts
storage-server/src/request-context.ts
```

### 5.2 API

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
POST /api/auth/change-password
```

管理员账号创建使用独立 CLI，而不是开放公网注册：

```text
npm run user:create -- --username <name>
npm run user:disable -- --username <name>
npm run session:revoke -- --username <name>
```

密码通过交互输入或 Docker secret 文件读取，不进入 Shell 历史。

### 5.3 请求上下文

将当前固定的：

```text
ctx.config.namespace
```

改为每个请求解析：

```text
RequestContext {
  requestId,
  user,
  namespace: `user:${user.id}`
}
```

Storage repository 的 namespace 参数只能来自 `RequestContext`。请求体、Query、Header 中出现 namespace 时全部忽略或拒绝。

### 5.4 路由保护

公开路由：

```text
GET  /
GET  /assets/*
GET  /env.js
POST /api/auth/login
GET  /api/storage/health（仅返回总体可用性，不返回用户信息）
```

需要登录：

```text
/api/storage/config
/api/storage/documents/**
/api/storage/blobs/**
/__dream_api_proxy/**
/__dream_media_proxy/**
```

### 5.5 Cookie 与请求安全

- Cookie：`HttpOnly; SameSite=Lax; Path=/`。
- 生产环境必须为 HTTPS，并设置 `Secure`。
- 登录成功后旋转 Session，防止 Session Fixation。
- 登录、改密、写入请求校验 `Origin`/`Host`；必要时增加 CSRF Token。
- 登录失败统一返回同一种信息，避免枚举用户名。
- 登录接口增加 IP + 用户名双维度限流。
- Session 到期、用户禁用、密码修改后立即失效。

## 6. Dream Token 服务端化

### 6.1 当前问题

`docker/runtime-env.sh:17-49` 会把 `VITE_AI_API_KEY` 写入 `env.js`，任何公网访问者都能读取。

### 6.2 改造

1. 新增服务端变量：

```text
DREAM_API_KEY
DREAM_API_BASE_URL
DREAM_API_TLS_SERVER_NAME
DREAM_API_TLS_DISABLE_SNI
```

2. `dream-proxy.ts` 使用服务端 `DREAM_API_KEY` 覆盖客户端 Authorization。
3. 删除 `VITE_AI_API_KEY` 的运行时输出。
4. 内置 Dream 渠道在前端不再要求 apiKey；只向同源代理发送业务请求。
5. 自定义第三方渠道若未来恢复，必须单独定义安全模型，不能复用固定服务端 Token。
6. Dream 代理要求有效应用 Session，避免公网匿名消耗固定 Token。

## 7. 前端登录与会话生命周期

### 7.1 新增页面和状态

建议新增：

```text
web/src/pages/login/index.tsx
web/src/services/auth.ts
web/src/stores/use-auth-store.ts
web/src/components/layout/auth-guard.tsx
```

### 7.2 启动流程

1. 应用启动先请求 `/api/auth/session`。
2. 未登录时只显示登录页，不初始化 canvas/assets 的持久化 store。
3. 登录成功后再加载 `/api/storage/config` 和用户数据。
4. 收到 401 时停止自动保存、清除内存中的用户数据并回到登录页。
5. 登出前等待当前保存队列完成；超时则明确提示未保存数据。
6. 切换用户时销毁旧 repository revision cache、Blob URL 和 Zustand 状态，禁止跨用户内存泄漏。

## 8. Revision 冲突与迁移修复

### 8.1 服务端错误增强

将当前只返回：

```json
{"code":"revision_conflict","message":"Document revision conflict"}
```

增强为不泄露其他用户信息的结构：

```json
{
  "code": "revision_conflict",
  "domain": "canvas",
  "key": "project-id",
  "expectedRevision": 4,
  "currentRevision": 5
}
```

批处理冲突必须返回具体 Key，并保持整个事务回滚。

### 8.2 客户端自动恢复

修改：

```text
web/src/services/storage/http-repository.ts
web/src/lib/localforage-storage.ts
web/src/services/storage/persisted-collection.ts
```

处理规则：

1. 捕获 `409 revision_conflict`。
2. 重新读取冲突 Key 和 `__collection_order__` 的最新文档。
3. 如果服务器记录与本地 baseline 相同而仅 revision 变化，更新 revision 后自动重试一次。
4. 如果服务器和本地内容都已改变，不允许直接 last-write-wins。
5. 对不同项目 ID 的变化进行集合合并。
6. 对同一项目的双向修改弹出冲突对话框：保留本地副本、使用服务器版本、另存为新项目。
7. 自动重试最多一次，避免冲突风暴。

### 8.3 `__collection_order__` 合并

- 保留本地仍存在的 ID 顺序。
- 追加服务器新增而本地未知的 ID。
- 删除必须只作用于用户明确删除且 baseline 中存在的 ID。
- 禁止因本地列表暂时未加载完整而删除服务器项目。

### 8.4 浏览器数据迁移

迁移期间：

1. 暂停 canvas/assets 自动保存。
2. 读取目标用户 namespace 最新 revision。
3. 执行迁移批次。
4. 使用批次返回的文档 revision 直接重建 `CollectionRevisionTracker` 和 order baseline。
5. 重新加载 store 并恢复自动保存。
6. 迁移按钮改为幂等：重复执行只上传缺失或内容更新的记录。
7. 迁移失败时保持原浏览器数据，不清理本地副本。

## 9. 环境变量与 Docker

新增 `.env.example`：

```text
APP_AUTH_ENABLED=true
APP_COOKIE_SECURE=true
APP_SESSION_TTL_HOURS=168
APP_LOGIN_MAX_ATTEMPTS=10
APP_LOGIN_WINDOW_SECONDS=900
APP_TRUST_PROXY=true

DREAM_API_KEY=
DREAM_API_BASE_URL=
DREAM_API_TLS_SERVER_NAME=
DREAM_API_TLS_DISABLE_SNI=false
```

调整：

- `STORAGE_NAMESPACE` 仅用于 `APP_AUTH_ENABLED=false` 的兼容模式。
- `docker-compose.cn.yml` 通过 `env_file` 注入非敏感配置。
- `DREAM_API_KEY`、管理员初始密码使用 Docker secret，不写入镜像、不写入前端产物。
- 公网前增加 Nginx/Caddy HTTPS 反向代理；只有代理对外开放，Storage Server 继续监听容器内部 3000。
- 设置可信代理网段后才读取 `X-Forwarded-For`，防止伪造 IP 绕过限流。

## 10. 发布顺序

### 阶段 A：兼容代码与数据库

1. 备份 MySQL。
2. 部署 `002_auth_and_user_namespaces.sql`。
3. 部署支持 Auth 但 `APP_AUTH_ENABLED=false` 的服务器版本。
4. 验证原 `default` namespace 读写不变。

### 阶段 B：管理员与数据复制

1. 创建首个管理员账号。
2. 停止写入或进入维护模式。
3. 复制 `default` 文档和 Blob 到 `user:<admin_id>`。
4. 校验数量、大小和抽样哈希。
5. 保留 `default` 不删除。

### 阶段 C：启用鉴权

1. 部署 HTTPS。
2. 设置 `APP_AUTH_ENABLED=true` 和 Secure Cookie。
3. 移除前端 `VITE_AI_API_KEY` 输出，启用服务端 `DREAM_API_KEY`。
4. 重建前端和 Storage Server 产物。
5. 登录管理员账号，验证画布、资产、生成记录和文件。

### 阶段 D：冲突恢复与清理

1. 启用客户端 409 自动恢复和冲突对话框。
2. 验证迁移后连续编辑不再出现 stale revision。
3. 观察至少一个稳定周期后，将 `default` 设为只读归档。
4. 清理旧 Session 和过期迁移备份按独立保留策略执行。

## 11. 测试计划

### 11.1 单元测试

- scrypt 哈希与校验、错误密码、损坏哈希。
- Session Token 生成、哈希、过期、注销、密码修改后失效。
- `user_id -> namespace` 映射不可被请求覆盖。
- Cookie 属性在生产/开发模式正确。
- revision 冲突响应包含具体 Key 和 revision。
- `__collection_order__` 合并不删除未知远端项目。

### 11.2 Storage Server 集成测试

- 未登录访问 documents、blobs、Dream proxy 返回 401。
- 用户 A/B 使用相同 record key，读写结果完全隔离。
- 用户 A 无法通过 Header、Query、Payload 读取用户 B namespace。
- Session 过期、用户禁用、登出后立即失效。
- 两个 Session 同时更新同一项目时，一个成功、一个得到结构化 409。
- Batch 冲突完整回滚，无部分写入。
- Dream proxy 使用服务端 Token，客户端 Authorization 被忽略。

### 11.3 数据迁移测试

- `default` 复制到管理员 namespace 后文档数量一致。
- Blob 数量、总字节和抽样 SHA-256 一致。
- 目标 namespace 有同 Key 时迁移拒绝并输出报告。
- 迁移中断可重新执行且不产生重复数据。
- 迁移完成后当前页面继续编辑不会出现旧 revision 冲突。

### 11.4 E2E

- 未登录只能进入登录页。
- 用户 A 创建画布，用户 B 登录后不可见。
- 两个用户创建同 ID 测试数据互不影响。
- 登录、刷新、重启容器后 Session 和数据行为符合配置。
- 同一用户两个设备并发修改同画布时展示冲突处理，不静默覆盖。
- 页面源代码、`env.js`、网络请求中均不存在固定 Dream Token。

### 11.5 安全验证

- Session Fixation、Cookie 窃取面、CSRF、暴力登录、用户枚举。
- SQL 注入、非法 namespace、超长用户名和 Cookie。
- 日志不包含密码、Session Token、Dream Token 或完整数据 Payload。
- HTTPS 下禁止明文 Session Cookie。

## 12. 可观测性

记录但不泄露内容：

```text
request_id
user_id 的不可逆短哈希
route
domain
record_key 的短哈希
status
revision_conflict expected/current
duration_ms
```

建议指标：

```text
auth_login_success_total
auth_login_failure_total
active_sessions
storage_revision_conflict_total{domain}
storage_requests_total{route,status}
dream_proxy_requests_total{status}
```

告警：

- revision 冲突率持续升高。
- 401/403 或登录失败突增。
- Dream 代理 5xx 突增。
- Session 表异常增长。

## 13. 回滚方案

1. 发布前保留数据库备份和旧镜像。
2. 数据迁移首期只复制 `default`，因此可以关闭 `APP_AUTH_ENABLED` 并回到旧 namespace。
3. Auth 表是新增表，不影响旧 storage 表。
4. 前端回滚时恢复旧 `env.js` 逻辑前必须确认 Dream Token 风险；不得将已轮换的新 Token重新暴露。
5. 若用户 namespace 数据产生新写入，回滚到 `default` 前必须执行反向合并，不能直接切换造成新数据不可见。

## 14. 验收标准

1. 公网匿名请求 `/api/storage/documents/canvas` 返回 401。
2. 用户 A/B 使用相同项目 ID，数据库中落入两个不同 namespace。
3. 用户 A 无法读取或覆盖用户 B 的文档和 Blob。
4. `env.js` 和前端 bundle 中不存在固定 Dream Token。
5. 浏览器迁移完成后不刷新也可继续保存，连续 100 次自动保存无 stale revision。
6. 同用户并发冲突不会静默覆盖，用户能保留本地副本或使用服务器版本。
7. `default` 到管理员 namespace 的文档、Blob 数量和校验结果一致。
8. Storage Server 单元/集成测试、前端类型检查、生产构建和 E2E 全部通过。
9. Docker 重启、宿主机产物挂载和 MySQL 重连后登录及数据隔离仍正常。

## 15. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 错误迁移覆盖原数据 | 高 | 先复制、冲突即停止、备份与校验后再切换 |
| 登录上线后用户被锁在系统外 | 高 | 保留本地 CLI 管理员创建/重置通道和旧镜像 |
| 固定 Dream Token 仍进入前端 | 高 | 构建产物扫描 `env.js`/bundle，服务端强制注入 Token |
| Cookie 在 HTTP 下泄露 | 高 | 生产启用 HTTPS + Secure，HTTP 仅本机开发 |
| 自动合并覆盖同画布修改 | 高 | 同项目双向变化必须人工决策，不做无条件 last-write-wins |
| Session 表持续增长 | 中 | 登录/请求时清理过期记录，并安排周期清理 |
| namespace 方案未来限制团队共享 | 中 | 后续引入 workspace namespace，不改变底层 repository 接口 |

## 16. 架构决策记录（ADR）

### Decision

采用应用本地账号、HttpOnly 不透明 Session、服务端派生 `user:<id>` namespace，并保留现有 MySQL revision 乐观锁。

### Drivers

- 公网匿名访问不能共享同一个 `default` namespace。
- 客户端提供的 namespace 和 Token 都不能作为可信身份。
- 需要兼容当前 storage 表与 repository，降低迁移范围。
- 必须保留并发保护，不能用 last-write-wins 隐藏数据覆盖。

### Alternatives considered

1. **每次部署设置随机固定 namespace**：只适合单用户，不能支持多个公网用户，也不能阻止匿名访问。
2. **使用 Dream JWT 的 `user_id`**：Token 当前固定且暴露给浏览器，所有访问者仍是同一身份；身份生命周期受外部 API 控制。
3. **客户端生成 user_id 并传 namespace**：可伪造，无法阻止读取他人数据。
4. **给 storage 表直接新增 user_id 外键**：隔离更显式，但首期需要大范围 repository 和主键迁移；后续可在 workspace 模型中评估。

### Consequences

- 增加登录、Session、HTTPS和管理员运维成本。
- 数据隔离由服务端强制，安全边界清晰。
- 现有 storage repository 可继续使用 namespace 参数。
- 后续团队共享需要把 user namespace 扩展为 workspace namespace。

### Follow-ups

- 第二阶段评估项目编辑 lease。
- 第三阶段评估 workspace/团队共享和权限角色。
- 如需第三方登录，在不改变 user namespace 的前提下增加身份提供商绑定表。

