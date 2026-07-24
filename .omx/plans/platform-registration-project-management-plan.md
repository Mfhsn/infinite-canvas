# 平台账号与项目工作空间统一接入最终计划

> 2026-07-22 修正：主站已在同源 `localStorage` 提供 `ai-comic-external-auth-session`，因此本文中“画布自有注册/登录”部分已被 `.omx/plans/host-platform-session-bridge.md` 取代；平台项目工作空间层级仍然有效。

> 状态：已确认并进入执行  
> 版本：Integration V1.1  
> 核心原则：平台项目是顶层工作空间；一个平台项目包含多个画布、文件夹、素材和生成记录。平台项目与画布不是同一种实体，但在同一套前端导航中统一呈现。

## 1. 产品层级

```text
平台用户
└── 平台项目 / 工作空间（权限、积分、模型请求上下文）
    ├── 文件夹
    │   ├── 画布 A
    │   └── 画布 B
    ├── 画布 C
    ├── 素材
    └── 图片/视频生成记录
```

- 平台项目来自 Integration API，承载 `external_project_id`、`local_project_id`、积分、权限和模型调用 Token。
- 画布继续使用现有本地画布实体与 CRUD；“新建画布”只在当前平台项目命名空间中创建画布，不调用平台项目创建 API。
- MySQL 存储命名空间继续由 `[uid, sourceSystem, localProjectId]` 派生，所以每个用户的每个平台项目拥有独立数据集合。

## 2. 本次交付范围

1. 注册平台用户；注册成功后回到登录，不在浏览器保存密码或 Token。
2. 获取当前用户可访问的平台项目列表并显示名称、项目 ID、积分、权限与当前状态。
3. 创建平台项目；创建接口返回 `null` 时重新获取列表，以平台最终数据为准。
4. 选择/切换平台项目；后端使用服务端保存的 `external_token` 重新 exchange，浏览器永不接触 Token。
5. 切换项目后重置 Storage Runtime，重新水合该项目下的画布、文件夹和素材；切换完成前显示阻塞加载态，避免旧项目数据闪现或误写入新项目。
6. 将平台项目入口合并到现有画布/文件夹导航体验中，同时保留画布项目切换器。
7. 补齐中英文词条、后端路由测试、前端 API/store 测试与构建验证。

## 3. 上游 API 契约

### 3.1 注册

```http
POST /api/integration/external/auth/register
Content-Type: application/json

{
  "username": "string",
  "password": "string",
  "owner": null
}
```

- 本版前端不要求用户填写 `owner`；默认不发送该字段，使用平台默认归属。
- 响应无 Token，不自动登录。

### 3.2 项目列表

```http
GET /api/integration/external/projects
X-External-Token: <server-side external token>
```

规范化前端项目结构：

```ts
type PlatformProject = {
  projectId: string;
  name: string;
  points: number | null;
  permissionIds: number[];
};
```

### 3.3 创建平台项目

```http
POST /api/integration/external/projects/create
X-External-Token: <server-side external token>

{
  "name": "string",
  "content": "string | null",
  "tag": "string",
  "skill": [0],
  "skill_model": ["string"],
  "points": 0
}
```

- `name`、`tag`、至少一个 `skill` 必填。
- `content`、`skill_model` 可选；普通 UI 不暴露初始积分编辑，默认省略或使用 0。
- 成功响应可能是 `null`，创建后必须刷新项目列表。

### 3.4 选择项目

使用现有 exchange 接口，但明确传入目标项目：

```http
POST /api/integration/session/exchange

{
  "external_token": "server-side token",
  "external_project_id": "selected project id"
}
```

## 4. 后端设计

### 4.1 Integration Client

扩展 `IntegrationClient`：

- `register(input)`
- `listProjects(externalToken)`
- `createProject(externalToken, input)`
- `exchange(externalToken, externalProjectId?)`

项目 ID 一律规范化为字符串；权限只接受安全整数；积分只接受有限数字或 `null`。错误响应只保留安全的 code/message，不回传 Token、密码、上游原始 input。

### 4.2 同源 API

新增：

```text
POST /api/platform/auth/register
GET  /api/platform/projects
POST /api/platform/projects
POST /api/platform/projects/:projectId/select
```

安全要求：

- 注册和所有 POST 执行 same-origin 校验。
- 项目列表、创建、选择必须同时通过 HttpOnly Cookie 会话和 `X-Canvas-Session-Binding`。
- 上游请求仅从服务端会话解密 `external_token`；不接受浏览器提供的任意 Token。
- 上游 401 时销毁本地会话并清 Cookie。
- 项目切换成功后创建新的本地会话/binding，使旧 binding 立即失效。

### 4.3 新用户没有默认项目的处理

- 注册接口不自动登录，因此不会产生半初始化画布会话。
- 登录仍需平台至少返回一个可访问项目才能完成首次 exchange。
- 若平台对新用户返回空项目列表，后端返回明确的 `platform_project_unavailable`；本版不把 external token 暴露给浏览器，也不建立无项目的弱会话。
- 若平台确认新用户不会自动拥有项目，后续版本需新增“服务端预会话/首项目创建”协议；在没有上游契约前不降低安全边界。

## 5. 前端设计

### 5.1 登录与注册

- `AuthGate` 提供登录/注册切换。
- 注册字段：用户名、密码、确认密码。
- 注册成功后切回登录并回填用户名，密码始终清空。

### 5.2 平台项目工作空间 Store

新增独立 `usePlatformProjectStore`，保存：

- 项目列表与加载状态
- 当前创建/切换状态
- `loadProjects()`
- `createProject()`
- `selectProject()`
- `clear()`

平台项目不写 localStorage/IndexedDB；每次登录或打开入口从平台获取，登出/401/跨标签会话变化时清空。

### 5.3 导航与交互

- 顶栏用户区增加当前平台项目入口。
- 弹层/抽屉顶部展示当前平台项目、积分和权限；下方展示可切换项目列表与“创建平台项目”。
- 画布页继续使用现有文件夹和画布缩略图导航；平台项目切换完成后该区域自然显示新工作空间的数据。
- “创建平台项目”与“新建画布”文案和按钮严格区分。

### 5.4 切换事务

```text
用户选择平台项目
→ 前端进入全局 initializing/切换遮罩
→ POST /api/platform/projects/:id/select
→ 后端校验项目可访问并 exchange
→ 后端轮换会话与 binding
→ 前端捕获新 binding
→ resetStorageRuntime()
→ rehydrate canvas / folders / assets
→ 更新 authenticated projectContext
→ 当前页面保持写入暂停并 reload 到画布库根目录
→ 新页面以新 session 启动并恢复写入
```

失败时保留或补偿恢复原会话和原项目数据；只有目标项目水合成功后才执行整页交接。整页交接用于终止旧工作空间尚未完成的异步任务，避免其在切换完成后误写入新项目。

## 6. 测试与验收

### 后端

1. 注册请求校验与脱敏响应。
2. 项目列表/创建/选择拒绝无会话或 binding 不匹配。
3. 上游请求仅携带服务端 `X-External-Token`。
4. 创建上游返回 `null` 后仍刷新列表。
5. 选择项目传入正确 `external_project_id`，返回新 context 和新 binding。
6. 选择不存在/不可访问项目时不破坏原会话。
7. 上游 401 销毁会话并清 Cookie。

### 前端

1. Platform API 注册、列表、创建、选择请求格式正确。
2. 项目 store 的加载、创建后刷新、选择、清空和错误恢复正确。
3. 选择成功后 Storage Runtime 被重置并重新水合。
4. 注册密码不一致不会发请求；成功后只回填用户名。
5. 中英文 key 完整。

### 完成标准

- 后端测试全部通过。
- 前端单元测试、`i18n:check`、TypeScript 与生产构建通过。
- 登录用户可在同一 UI 中选择平台工作空间，并在不同项目间看到完全隔离的画布/文件夹/素材。
- 浏览器网络响应、localStorage、IndexedDB 和日志中均不出现平台 Token。
