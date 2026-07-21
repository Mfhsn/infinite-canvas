# 画布库项目管理升级：最终实施方案

> 状态：规划完成，Architect 与 Critic 均已 APPROVE，等待用户批准后执行。  
> 执行门禁：用户批准最终 `.omx/plans/` 计划前，不修改业务代码。  
> 已吸收反馈：B+ 独立同步域、tombstone 权威删除、显式 store 状态、generation-aware retry、ETag 条件写、remove-wins、版本化封面、运行时 archive/manifest 解析、ZIP 安全限制、URL allowlist、幂等 normalize 与真实验证命令。

## 1. 目标与完成定义

在保留现有 `AppTopNav`、Ant Design + Tailwind + lucide-react、浏览器/MySQL 双存储和通用 JSON/blob 表的前提下，把 `/canvas` 从扁平列表升级为画布资源库：

- URL 支持 `/canvas?folder=&q=&type=`，其中 `type=all|canvas|folder`。
- 支持实用任意层级的嵌套文件夹；所有树遍历设置安全节点上限，防止脏数据造成无限循环或阻塞。
- 支持新建文件夹、面包屑导航、画布/文件夹移动、文件夹删除但不删除画布。
- 支持画布缩略图、非互斥 `isDefault` 标签、更多菜单和响应式卡片。
- 文件夹本地持久化使用独立 `canvas_folders` 域；WebDAV 使用独立 `canvas-folders` manifest，不把 folders 混入 canvas manifest。
- ZIP 写 v4、读 v3/v4；旧项目、旧浏览器 envelope、MySQL 分文档、旧 WebDAV canvas manifest 均保持可读。
- 不新增 SQL 表、对象存储、组件库或运行时依赖。

### 完成标准

1. 用户已选边界全部映射到实现文件、验收项和自动化测试。
2. 浏览器与 MySQL 驱动均完成创建、移动、删除、刷新、导入导出和同步冒烟。
3. WebDAV canvas 与 canvas-folders 两个 manifest 的正常、缺失、损坏、并发删除场景有覆盖。
4. ZIP v3/v4、导入 staging 失败和补偿失败有测试；补偿不完整时必须明确报告“部分导入”、受影响资源数量和后续清理建议，不承诺完全隐藏所有半导入写入。
5. 桌面、移动、暗色和键盘路径完成截图/交互验证。
6. 以真实 scripts 为准执行：
   - `cd web && bun test tests`
   - `cd web && npm run i18n:check`
   - `cd web && npm run build`（该 script 已包含 `tsc --noEmit`）
   - `cd storage-server && npm test`
   - `cd storage-server && npm run typecheck`
   - `git diff --check`
7. `web` 的 `format:check` 是全仓检查；若被历史未格式化文件阻塞，必须同时报告全仓结果，并对本任务实际变更文件运行限定范围的 `npx prettier --check <changed-files...>`，不得把历史失败误报为本功能失败或虚构新的 package script。

## 2. 固定范围与语义

### 本期包含

- 资源类型筛选严格为 `all | canvas | folder`，不从节点推断业务类型。
- 文件夹使用 `parentId` 邻接表；根目录为 `null`。
- 默认标签为画布级非互斥 `isDefault`，不定义启动默认画布。
- 搜索名称大小写不敏感；对当前目录的画布标题和文件夹名称生效。
- 排序确定性：文件夹优先；同类按 `updatedAt` 降序，再按规范化名称和 `id` 兜底。
- 删除文件夹不删除画布；UI 立即按“最近活动祖先”显示被提升后的资源，后台 reconcile 可重试地固化引用。
- 删除确认显示直接子文件夹数、直接画布数和子树总资源数。
- 封面优先最近成功图片，其次成功视频 poster/安全首帧；无媒体时只渲染轻量占位，不做全 DOM 截图。
- WebDAV：canvas manifest 继续负责 projects/covers；新 `canvas-folders` manifest 只负责 folders/tombstones。
- ZIP v4 可选 `folders`，继续接受 v3。

### 本期不包含

- 启动默认画布、默认唯一性、默认文件夹。
- 业务类型推断、拖拽排序、自定义排序、共享权限、回收站和全文搜索。
- 新关系表、materialized path、服务端封面渲染、全 DOM 截图。
- 重做 `AppTopNav`、首页最近项目卡或其他资源库。
- 将既有画布硬删除协议整体改造成 tombstone；本期只为新增 folder 领域建立 remove-wins 删除语义。

## 3. RALPLAN-DR

### Principles

1. **兼容且幂等**：项目和文件夹分别通过独立 normalize 函数归一化；重复 hydration/merge 不产生继续变更。
2. **失败可见、写入可确认**：store 明确暴露 hydration/write 状态、flush 和 retry；不以“set 已调用”冒充持久化成功。
3. **删除优先保数据**：folder tombstone 是权威提交；提升是派生视图与可重试 reconcile，不声明跨 store 事务或 durable 顺序。
4. **同步域隔离**：本地 `canvas_folders` 与 WebDAV `canvas-folders` 独立于 canvas project manifest，降低协议耦合。
5. **渐进增强**：封面和引用修复失败不能阻塞打开或编辑画布；UI 和数据层均有安全回退。

### Top 3 Decision Drivers

1. 浏览器/MySQL/WebDAV/ZIP 四条数据路径必须可独立失败、重试并保持向后兼容。
2. 文件夹删除与并发同步不得误删画布或复活已删除文件夹。
3. 封面和导入不能产生不可追踪 orphan blob、半导入资源或巨型 JSON。

### Options

#### 方案 A：folders 并入 canvas store 和 canvas WebDAV manifest

- 优点：单次 hydration，协议表面较少。
- 缺点：项目和文件夹故障域耦合；删除与 manifest 演进复杂；不符合独立 `canvas_folders` 边界。
- 结论：不采用。

#### 方案 B：独立本地域，但 folders 仍嵌入 canvas WebDAV manifest

- 优点：本地边界清晰，远端文件数量较少。
- 缺点：本地和远端领域边界不一致；canvas 项目同步失败会阻塞文件夹；旧/新 manifest 校验更复杂。
- 结论：作为过渡可行，但不推荐。

#### 方案 B+：独立本地域 + 独立 WebDAV canvas-folders manifest（推荐）

- 本地：projects 使用 `canvas`，folders 使用 `canvas_folders`。
- 远端：projects/covers 使用 `canvas/manifest.json`，folders/tombstones 使用 `canvas-folders/manifest.json`。
- 删除：先把 folder tombstone 作为唯一权威意图提交并 flush；UI 根据 tombstone 计算最近活动祖先；reconcile 独立重试。首版永久保留 tombstone，不提供 compact/GC。
- 优点：故障域、校验、重试和回滚边界清晰；remove-wins 易于单独证明；不改 SQL。
- 代价：同步阶段和状态更多；必须处理两 store 部分 hydration、两 manifest 部分成功和 reconcile backlog。
- 取舍：采用显式状态机和运行时 parser，不用隐含调用顺序掩盖部分失败。

#### 方案 C：新增关系表/树路径

- 优点：服务端事务和复杂查询能力强。
- 缺点：破坏双驱动同构，需 SQL/部署迁移，首版过度设计。
- 结论：不采用。

### Decision

采用 B+。文件夹本地/远端均独立成域；folder tombstone remove-wins；项目对删除文件夹的提升先由派生视图体现，再由可重试 reconcile 固化；封面使用版本化 blob key；导入先完整解析和 staging，再提交。

## 4. ADR

### Decision

- `CanvasProject` 增加 `folderId`、`isDefault`、`coverStorageKey`、`coverUpdatedAt`。
- `CanvasFolder` 使用邻接表和 `deletedAt` tombstone。
- 本地 folders 域为 `canvas_folders`；WebDAV folders 域为 `canvas-folders`。
- folder merge 对同 id 使用 remove-wins：任一有效 tombstone 都压过活动版本；同为 tombstone 时保留较新的删除元数据。
- 删除 folder 不立即假定跨 store 引用重写已 durable；UI 使用最近活动祖先，reconcile 后台固化。首版不 compact、不 GC folder tombstone。
- cover key 为 `canvas-cover:<projectId>:<revision-or-id>`，禁止稳定 key 覆盖写。
- ZIP 导入由独立编排器执行 parse → stage → commit → compensate，不留在页面组件中。

### Drivers

- SQL 表结构必须不变。
- 删除与同步需对部分失败和并发删除有明确语义。
- 旧 envelope、MySQL 分文档、v3 archive 和旧 canvas manifest 必须可读。

### Alternatives considered

- 单 store/单 manifest：故障域过大。
- 跨 store 固定写顺序：不能提供事务保证，容易产生虚假 durable 声明。
- folder 硬删除：会被远端活动记录复活。
- 稳定 cover key 覆盖：项目 metadata 持久化失败时无法判断旧/新 blob 所属版本。
- 页面内直接导入：难以做完整 runtime 校验、staging 和失败补偿。
- 新 SQL 表/对象存储/组件库：超出边界。

### Why chosen

B+ 将项目、文件夹、封面和导入失败域分开，并通过显式状态、remove-wins、版本化 key 与 staging 把“可恢复”变成可测试协议，而不是依赖调用顺序。

### Consequences

- 画布库只有在 project/folder 两个 store 均 `hydrationStatus=success` 后才允许运行 reconcile 或持久化修复。
- 部分 hydration 时可显示明确错误/重试状态，不得自动把 folderId 修复到根。
- folder tombstone 在首版永久保留；在未来建立跨设备同步水位/确认协议前，不实现本地或远端 compact/GC。
- cover 会短期或长期存在旧版本/失败写入 orphan blob；首版不自动 GC，只有项目删除 flush 成功后才删除 metadata 当前引用的单个 cover。
- WebDAV 需要两个独立进度项、parser 和重试入口。

## 5. 数据模型、状态与不变量

### CanvasProject 增量字段

```ts
folderId: string | null;
isDefault: boolean;
coverStorageKey?: string; // canvas-cover:<projectId>:<revision-or-id>
coverUpdatedAt?: string;
```

### CanvasFolder

```ts
type CanvasFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

### Store 状态契约

projects 与 folders store 均提供：

```ts
hydrationStatus: "idle" | "loading" | "success" | "error";
writeStatus: "idle" | "pending" | "success" | "error";
generation: number;
lastError?: string;
flush(): Promise<void>;
retryHydration(): Promise<void>;
retryWrite(): Promise<void>;
```

- 每次会改变持久化完整状态的 mutation 都使 `generation` 单调递增；排队写入和失败快照必须携带对应 generation。
- `flush()` 必须主动结算尚未触发的 400ms debounce timer，完成当前状态序列化、repository `batch`、其前序/当前写队列后才 resolve；任一环节失败都 reject，并设置 `writeStatus=error`，不得吞异常。
- `retryWrite()` 保存“最后一次失败写入快照 + 失败 generation + 原错误上下文”。若当前 generation 等于失败 generation，可重放该失败快照；若当前 generation 更高，禁止重放旧快照，必须 `flush()` 当前最新完整状态，避免覆盖失败后继续编辑的内容。
- retry 成功后只清除已被最新成功 generation 覆盖的错误；旧 generation 的迟到回调不得把新状态标为成功或失败。
- 页面操作可先乐观显示，但“已保存/可清理旧 blob”必须等待 flush 成功。
- 两 store 未同时 hydration success 时，不运行 orphan 修复、reconcile 或隐式根目录回写。

### Normalize 契约

- `normalizeCanvasProject(input)` 与 `normalizeCanvasFolder(input)` 独立、纯函数、幂等。
- 缺失项目字段归一化为 `folderId:null`、`isDefault:false`；非法 cover key 清空。
- 缺失/非法 folder parent 暂不在单记录 normalize 中修复；必须等两个完整集合成功 hydration 后由 tree reconcile 判断。
- Zustand `migrate` 仅处理浏览器持久化 envelope 版本，不承担 MySQL 分文档 normalize。
- MySQL list/get、WebDAV parser、ZIP parser、import source 均显式调用同一 normalize 函数。
- 重复 MySQL hydration 不应再次写文档、改变 timestamps 或产生 write queue。

### 树与删除不变量

- 支持实用任意层级，但所有祖先/后代/面包屑遍历使用 visited set 和 `MAX_FOLDER_TRAVERSAL` 安全上限。
- 禁止把文件夹移动到自身或后代；UI 禁用和 store/领域函数双重校验。
- folder tombstone 是删除唯一权威状态，不直接删除记录。
- “最近活动祖先”：沿原 parent 链向上跳过 tombstone/无效节点，直到活动 folder 或 root；遍历超限则回 root 并报告诊断。
- UI 使用最近活动祖先计算资源的有效位置，因此 tombstone 提交成功后即可表现为“提升”，无需声称 projects store 已 durable 改写。
- reconcile 可重试地把直接/间接指向 tombstone 或无效 folder 的 `folderId/parentId` 固化为最近活动祖先。
- 首版永久保留所有 folder tombstone；不提供手动或自动 compact/GC。未来只有在存在设备同步水位/所有已知设备确认协议后，才能另立方案清理。
- folders 不保存 `__collection_order__`；展示顺序完全由确定性排序函数计算。

## 6. 实施步骤与具体文件清单

### 阶段 0：回归测试与协议 fixtures

新增：

- `web/tests/canvas-library-model.test.ts`
- `web/tests/canvas-library-store.test.ts`
- `web/tests/canvas-library-routing.test.ts`
- `web/tests/canvas-library-export.test.ts`
- `web/tests/canvas-library-sync.test.ts`
- `web/tests/canvas-library-import.test.ts`
- `web/tests/canvas-cover.test.ts`
- `web/tests/fixtures/canvas-v3.zip` 或等价内存 fixture builder
- `web/tests/fixtures/canvas-v4-invalid.json`

修改：

- `web/tests/storage-persisted-collection.test.ts`
- `web/tests/storage-http-repository.test.ts`
- `storage-server/test/routes.test.mjs`

先锁定 normalize 幂等、MySQL 重复 hydration、remove-wins、staging 失败和 flush 状态，再实施业务能力。

### 阶段 1：独立 normalize、树算法与状态基础设施

新增：

- `web/src/types/canvas-library.ts`
- `web/src/lib/canvas/normalize-canvas-project.ts`
- `web/src/lib/canvas/normalize-canvas-folder.ts`
- `web/src/lib/canvas/canvas-library.ts`
  - 确定性筛选排序、breadcrumbs、descendants、cycle guard、最近活动祖先和 reconcile plan。

修改：

- `web/src/stores/canvas/use-canvas-store.ts`
  - 新字段与不可变 actions。
  - 暴露 hydration/write/flush/retry 契约。
  - persist migrate 仅迁移浏览器 envelope；读取集合后逐项目调用 normalize。
- `web/src/lib/localforage-storage.ts`
  - write queue 不再吞掉错误。
  - adapter 的 `flush()` 覆盖 400ms debounce timer、序列化、repository batch 与完整写队列。
  - 保存最后失败写入快照、generation 和错误；retry 时比较当前 generation，旧快照过期则 flush 最新完整状态。
- `web/src/services/storage/persisted-collection.ts`
  - 支持解析 folders envelope，但 folder collection 不生成/读取 order document。

验收：normalize 连续执行两次结果相同；partial hydration 不触发修复；覆盖“写失败 → 用户继续编辑使 generation 增长 → retry → 最终 repository 为最新完整状态且旧快照未覆盖新编辑”。

### 阶段 2：独立 canvas_folders store 与双驱动持久化

新增：

- `web/src/stores/canvas/use-canvas-folder-store.ts`
- `web/src/lib/canvas/canvas-folder-reconcile.ts`
  - tombstone commit、派生有效父级、reconcile queue 与 retry；不得描述为跨 store transaction。

修改：

- `web/src/services/storage/types.ts`：增加 `canvas_folders`。
- `web/src/services/storage/browser-repository.ts`：独立 localforage `canvas_folders` store/state key。
- `web/src/services/storage/migrate-browser-data.ts`
  - 加入 `canvas_folders`。
  - folders 按 id 文档迁移，不写 `__collection_order__`。
- `storage-server/src/types.ts`：`allowedDomains` 增加 `canvas_folders`。
- `storage-server/src/validation.ts`：验证白名单自动接受新域。

不修改：

- `database/infinite_canvas.sql`
- `storage-server/migrations/001_init.sql`

验收：browser/memory/MySQL CRUD 和 batch 通过；重复 MySQL hydration 不产生二次写；folders 无 order 文档。

### 阶段 3：删除与 reconcile 协议

新增/修改：

- `web/src/lib/canvas/canvas-folder-reconcile.ts`
  1. 校验目标和影响数量。
  2. 写 folder tombstone 并等待 folder store `flush`。
  3. flush 成功后 UI 通过最近活动祖先立即派生提升结果。
  4. 将 project/folder 引用修复加入可重试 reconcile queue。
  5. 分别 flush；失败保留 backlog 和错误状态，不撤销权威 tombstone。
  6. folder tombstone 永久保留；首版无 compact/GC 路径。
- `web/src/components/canvas/canvas-delete-folder-dialog.tsx`
  - 展示影响数量、提交/持久化/reconcile 状态和重试入口。
- `web/src/pages/canvas/index.tsx`
  - 只在双 store hydration success 后启动 reconcile；错误状态显示重试，不自动修复。

测试故障注入：folder tombstone 写失败、tombstone 成功但 project reconcile 失败、folder child reconcile 失败、刷新后恢复 backlog，以及任何代码路径均不得删除已提交 tombstone。

### 阶段 4：URL allowlist、搜索草稿与目录导航

新增：

- `web/src/lib/canvas/canvas-library-route.ts`
  - `LIBRARY_VIEW_QUERY_ALLOWLIST = ["folder", "q", "type"]`
  - `PROJECT_HANDOFF_QUERY_ALLOWLIST = ["mode", "agentUrl", "agentToken"]`
  - `mode` value allowlist：`new | recent | choose`
  - 只有 `mode` 命中合法 Agent mode 时，才允许同时转发非空 `agentUrl`/`agentToken`；mode 缺失或非法时三个交接参数全部丢弃。
  - `folder/q/type` 属于库视图参数，任何情况下都不得带入 `/canvas/:id`；其他未知参数同样丢弃。
- `web/src/components/canvas/canvas-library-toolbar.tsx`
- `web/src/components/canvas/canvas-folder-breadcrumbs.tsx`
- `web/src/components/canvas/canvas-folder-card.tsx`

修改：

- `web/src/pages/canvas/index.tsx`
  - URL 保存已提交的 `folder/q/type`。
  - 搜索输入保留本地 `draftQ`，输入时立即用 draft 过滤；短防抖后以 `replace` 提交 URL `q`。
  - 外部 URL/前进后退变化时同步 draft；失焦/Enter 立即提交。
  - 非法 folder 只有在双 store hydration success 后才可判定并规范化。
- `web/src/components/canvas/canvas-project-card.tsx`：由页面传入 allowlist 后的 open URL。
- `web/src/pages/canvas/project.tsx`：只读取项目交接 allowlist；`agentUrl`/`agentToken` 仅在合法 Agent mode 下使用。

验收：可分享 URL 保存已提交状态；本地输入无延迟；前进后退不被旧 debounce 覆盖；项目页仅在合法 mode 下保留 `mode/agentUrl/agentToken`，绝不携带 `folder/q/type`。

### 阶段 5：资源卡片、移动和默认标签

新增：

- `web/src/components/canvas/canvas-move-dialog.tsx`
- `web/src/components/canvas/canvas-resource-menu.tsx`

修改：

- `web/src/components/canvas/canvas-project-card.tsx`
  - 缩略图、标题、更新时间、非互斥默认徽标、更多菜单。
  - 菜单：重命名、移动、设为/取消默认、导出、删除。
- `web/src/components/canvas/canvas-folder-card.tsx`
  - 重命名、移动、删除；循环目标 UI 禁用且领域层再次拒绝。
- `web/src/stores/canvas/use-canvas-ui-store.ts`
  - 仅瞬时 draft/dialog/selection；目录变化清理不可见画布选择。
- `web/src/pages/canvas/index.tsx`
  - 当前目录直接资源；`type=all|canvas|folder`；文件夹优先确定性排序。
  - 新画布进入当前有效 folder。

批量选择仍仅针对画布，不扩展递归文件夹批量导出/删除。

### 阶段 6：版本化封面生命周期

新增：

- `web/src/lib/canvas/canvas-cover.ts`
  - `createCanvasCoverKey(projectId, revisionOrId)`。
  - 固定候选契约：成功图片优先；没有成功图片时才使用成功视频 poster/安全首帧；idle/loading/error 节点永不作为封面。
  - 固定编码契约：640×360；优先 `canvas.toBlob("image/webp", 0.82)`，WebP 编码失败或返回空 Blob 时回退 PNG。
- `web/src/components/canvas/canvas-project-cover.tsx`
- `web/src/services/canvas-cover-storage.ts`
  - put/get/deleteCurrent；首版不提供自动 GC 或安全期限清理。

修改：

- `web/src/components/canvas/canvas-node-generation.ts`
- `web/src/pages/canvas/project.tsx`
  1. 自动生成只发生在两类触发点：成功图片/视频生成事件；旧项目打开后首次正常保存时的单次懒回填。
  2. 不在库 hydration、卡片渲染、普通筛选或每次项目保存时扫描/重建封面。
  3. 先生成版本化 blob `canvas-cover:<projectId>:<revision-or-id>`。
  4. 更新 project metadata 并等待 project store `flush`；失败则保留旧 metadata 和新孤儿 blob，不做自动清理。
- `web/src/components/canvas/canvas-delete-projects-dialog.tsx`
  - 项目删除只有在 project store 删除状态 `flush` 成功后，才删除删除前 metadata 指向的“当前 cover”单个 key。
  - 不按 project 前缀批量删除历史版本；未引用孤儿永久保留到未来具备可靠引用元数据/同步水位后再设计 GC。

首版明确不做自动 cover GC、不设置安全期限、不扫描删除历史版本。该取舍优先避免并发设备、失败写入或导入补偿场景下误删仍可能被引用的 blob。

### 阶段 7：独立 WebDAV canvas-folders manifest

两类 manifest 正式共享以下提交标识契约：

```ts
type ManifestCommitFields = {
  commitId?: string;
};
```

- `canvas/manifest.json` 与 `canvas-folders/manifest.json` 的 legacy 版本允许缺失 `commitId`，读取时保持兼容。
- 所有新写 manifest 必须生成 trim 后非空、每次提交唯一的 `commitId`；推荐使用 `crypto.randomUUID()`，不得复用上一次提交值。
- runtime parser 在字段存在时要求其为字符串、trim 后非空且长度不超过 128 个字符；空字符串、纯空白、非字符串或超长值均判为非法 manifest。
- `commitId` 只标识一次远端提交，不参与 project LWW、folder remove-wins、文件列表或任何业务 merge；412 重读合并后再次 PUT 必须生成新的 commitId。
- “规范化内容”指排除 `commitId` 以及纯序列化差异后，对 parser 输出的 `app/version/domain/data/files` 做确定性规范化；commitId 不属于业务内容。

新增：

- `web/src/services/canvas-folder-sync.ts`
  - 独立读取/合并/上传 `canvas-folders/manifest.json`。
  - 新写 canvas-folders manifest 必须携带新的非空唯一 commitId；读取 legacy 缺失值正常；commitId 不进入 remove-wins merge。
- `web/src/services/sync-manifest-parser.ts` 或领域专用 parser
  - 运行时校验 app、version、domain、data shape、folders 字段、每个 folder，以及可选 commitId 的类型、非空和 128 字符上限。

修改：

- `web/src/services/app-sync.ts`
  - canvas manifest 保持 projects 与其显式 cover files。
  - 新写 canvas manifest 必须携带新的非空唯一 commitId；读取 legacy 缺失值正常；commitId 不进入 project merge。
  - 新增 canvas-folders 同步阶段/统计/错误，不把 folders 嵌入 canvas data。
  - 两 manifest 可分别失败和 retry；不得因一个成功就标记整体完全成功。
  - canvas 文件收集显式加入 `project.coverStorageKey`，不能只依赖递归正则偶然发现。
- `web/src/services/webdav-sync.ts`
  - 下载 manifest 时同时返回 Blob 与响应 `ETag`；上传接口接受条件写参数。
  - 已存在 manifest 使用 `If-Match: <etag>`，首次创建使用 `If-None-Match: *`。
  - 收到 `412 Precondition Failed` 时重新读取远端、运行项目 LWW/folder remove-wins 合并，再条件 PUT；每个 manifest 最多重试 3 次，耗尽后保留本地状态并标记该域失败。
  - 若服务端 GET/HEAD 不返回 ETag，降级为普通 PUT 后立即重读 manifest：先由 runtime parser 校验，再要求远端 commitId 与本次提交完全一致，并比较排除 commitId 后的规范化业务内容；任一不匹配即判该域写后校验失败。该模式仍无法排除“校验后又被并发覆盖”，保证弱于 ETag 条件写。
  - 保留现有超时、认证和本地化错误映射，并新增 412/弱一致性诊断信息。
- `web/src/components/layout/app-config-modal.tsx`
  - `webdavDomainKeys` 增加独立 `canvas-folders`。
  - canvas 与 canvas-folders 分别展示读取、合并、条件上传、412 重试、弱 ETag 降级、成功/失败状态。
  - 总体结果支持“部分成功”；只对失败域提供重试，不重复上传已成功域。
- `web/src/i18n/messages.ts`：增加 canvas-folders 域、冲突重试、无 ETag 弱保证、部分成功和按域重试文案，中英文严格对等。

Folder merge：

- parser 先 normalize，每个 id 最多产生一个结果。
- 任一侧为 tombstone，则结果为 tombstone（remove-wins）；活动更新不得复活相同 id。
- 两侧 tombstone 取较新的 `deletedAt/updatedAt`；活动/活动才按 `updatedAt` LWW。
- merge 后只生成 reconcile plan；只有双 store hydration success 且目标写入 flush 成功才固化引用修复。

兼容：远端不存在 `canvas-folders/manifest.json` 视为空 folders；现有 canvas manifest 继续按旧 projects 结构读取；无 ETag 服务可用但 UI 必须提示较弱并发保证。

### 阶段 8：ZIP v4 runtime parser、staging 与导入编排

新增：

- `web/src/lib/canvas/parse-canvas-archive.ts`
  - `parseCanvasArchive(zip)` 运行时校验 app/version/projects/folders/files/path/mime/bytes/storageKey。
  - 接受 v3/v4；未知版本和结构损坏在任何持久写之前拒绝。
- `web/src/lib/canvas/canvas-import.ts`
  - 独立导入编排，不放在 `pages/canvas/index.tsx`。
  - 建立 folder/project/cover old→new id/key 映射。
  - stage JSON、目标 ids、blob 内容和补偿清单；校验循环、路径重复、缺失文件和超限资源。
  - 首版不新增 durable import journal；stage/成功写清单只存在于当前导入调用内存中。
  - commit 时记录当前调用内每个成功写；失败执行 best-effort compensation。
  - 若补偿不完整，返回“部分导入”结果，包含已写入、已补偿、未补偿的 folder/project/blob 数量与受影响 ids（可安全展示时），由 UI 明确提示用户，不承诺完全不可见半导入。
- `web/src/lib/canvas/canvas-export.ts`
  - 写 v4；显式收集每个 project 的 `coverStorageKey`，不能只依赖通用递归 collector。
  - folders 只包含被导出项目引用的活动 folder 与祖先链。
- `web/src/types/canvas-export.ts`：v3/v4 runtime parser 对应类型。

修改：

- `web/src/lib/zip.ts`
  - 在读取前拒绝压缩文件 Blob 大于 512MB。
  - 条目枚举上限 10,000；单项实际解压输出上限 256MB；累计实际解压输出上限 1GB。
  - 路径校验拒绝绝对路径、任何 `..` 段、反斜杠、NUL；按正斜杠规范化后拒绝重复路径。
  - 当前实现使用 `unzipSync` 一次性解压，无法在输出分配前可靠执行逐项/累计限制；实施时改为可枚举/流式回调的读取路径，边枚举边计数，并在实际输出 chunk/read 阶段中止。
  - 若底层 ZIP API 无法在解压前准确提供压缩比或可信 uncompressed size，计划只承诺在“条目枚举 + 实际读取”阶段逐步计量和尽早中止，不声称完全预防所有 zip bomb 内存风险。
- `web/src/pages/canvas/index.tsx`：只负责选择文件、调用 import orchestrator、呈现 staged/committed/compensated 结果。

失败/恶意输入测试：第 N 个 blob put 失败、folder flush 失败、project flush 失败、compensation delete 失败、重复 archive id、cover key 冲突、v4 无 folders、v3 正常导入、压缩文件超 512MB、条目超 10,000、单项/累计解压超限、绝对路径、`..`、反斜杠、NUL、规范化重复路径和高压缩比 zip bomb fixture。

### 阶段 9：响应式 UI、i18n 与可访问性

修改：

- `web/src/pages/canvas/index.tsx`
- `web/src/components/canvas/canvas-project-card.tsx`
- `web/src/components/canvas/canvas-folder-card.tsx`
- `web/src/components/canvas/canvas-library-toolbar.tsx`
- `web/src/i18n/messages.ts`

要求：

- 保留现有 `AppTopNav`，不复制截图顶栏。
- 桌面高密度缩略图网格；360/390px 移动端单列横向卡片。
- 桌面操作可 hover/focus 出现，移动/触屏菜单始终可达。
- 分别展示 hydration error、write error、reconcile pending、sync partial failure 和 retry。
- i18n 中英文严格对等。

## 7. 数据迁移与部署顺序

1. **后端先行**：`allowedDomains` 增加 `canvas_folders`；SQL schema 不变。
2. **兼容前端**：先上线 normalize/parser/store 状态能力，再开放文件夹 UI。
3. 浏览器 envelope：Zustand migrate 只调整 envelope 版本；每条项目/文件夹仍经过独立 normalize。
4. MySQL：直接 list 分文档并 normalize；重复 hydration 不应写回或改变时间戳。
5. 浏览器→MySQL：folders 按 id 迁移，不创建 `__collection_order__`；covers 由通用 blob 迁移包含。
6. WebDAV：canvas manifest 保持兼容；首次同步单独创建 `canvas-folders/manifest.json`。
7. ZIP：新版本写 v4，读 v3/v4；parse/stage 全部成功后才 commit。
8. 功能开关/发布顺序不得让旧前端必须理解 folders；旧前端忽略 `canvas_folders` 本地/服务端域，不会改 SQL 数据。

## 8. 验收标准

### Store、normalize 与故障状态

- project/folder normalize 各自幂等。
- 浏览器 envelope migrate 与 MySQL normalize 路径独立。
- MySQL 连续 hydration 两次不产生重复写或 timestamp 漂移。
- 任一 store hydration error 时不运行修复；UI 提供 retry。
- `flush()` 会结算 debounce、序列化、repository batch 和写队列；任一失败 reject 且不吞异常。
- `retryWrite()` 使用最后失败快照和错误上下文重放，成功/失败均可观测。
- 写失败后继续编辑会提升 generation；此时 retry 必须 flush 最新完整状态，最终 repository 包含后续编辑且旧失败快照未回放覆盖。

### URL、搜索和筛选

- 库视图只允许 `folder/q/type`；项目交接 allowlist 为 `mode/agentUrl/agentToken`，且后两者只在合法 Agent mode 下保留。
- `type=all/canvas/folder` 行为准确，非法 type 回退 all。
- 搜索 draft 即时过滤，URL q 防抖提交；Enter/失焦立即提交；前进后退同步 draft。
- 进入项目不携带 folder/q/type 或未知参数。

### 文件夹、删除与同步

- 可创建至少 4 层用于验证；实现不设置业务层级上限，但遍历有安全上限。
- 循环移动被 UI 和领域层拒绝。
- tombstone flush 成功后 UI 立即按最近活动祖先显示提升结果，画布数量不变。
- reconcile 失败可刷新后重试；不得复活 folder 或删除画布。
- remove-wins 保证远端活动版本不能复活同 id tombstone。
- 首版不存在 folder tombstone compact/GC；删除记录永久保留，直到未来设备同步水位协议获批。
- folders 不存在 `__collection_order__` 文档，排序仍稳定。
- WebDAV 有 ETag 时使用 If-Match/If-None-Match；412 会重读、合并并有限重试。无 ETag 时写后重读校验且 UI 标注较弱保证。
- 两类 legacy manifest 缺失 commitId 可读取；所有新写 manifest 均有非空唯一 commitId；存在但非法/超 128 字符的值被 parser 拒绝。
- 无 ETag 写后重读同时比较 commitId 与排除 commitId 后的规范化业务内容；commitId 或内容任一不匹配即判该域失败。
- canvas 与 canvas-folders 的进度、部分成功和失败域重试彼此独立。

### 默认标签与 UI

- 多个画布可同时 `isDefault=true`，互不影响。
- 桌面高密度网格、移动端横向卡片、无横向滚动、AppTopNav 仅一次。
- 鼠标、键盘和触屏都能访问更多菜单、移动、删除和重试。

### 封面

- key 形如 `canvas-cover:<projectId>:<revision-or-id>`。
- 封面候选严格为成功图片优先、成功视频其次；只由成功生成事件或项目打开后首次保存懒回填触发。
- 输出固定 640×360 WebP quality 0.82，编码失败回退 PNG。
- 新 cover blob 写入后，metadata flush 成功前不删除任何 blob。
- 项目删除 flush 成功后只删除 metadata 当前引用 cover；首版无自动 cover GC，其他孤儿保留。
- ZIP 和 WebDAV 显式携带当前引用 cover；无媒体显示占位。

### ZIP 与兼容

- `parseCanvasArchive` 在写入前拒绝未知版本/损坏结构。
- ZIP 文件/条目/单项/累计限制分别为 512MB、10,000、256MB、1GB；路径穿越、反斜杠、NUL 和规范化重复路径被拒绝。
- 对无法预先获知压缩比的 archive，在条目枚举和实际读取阶段逐步计量中止；验收不声称对所有 zip bomb 做到解压前完全预防。
- v3 正常导入到根；v4 正确重映射 folder/project/cover ids。
- commit 失败执行 best-effort compensation；补偿不完整时展示“部分导入”错误及已写入/已补偿/未补偿数量，不保证所有半导入资源完全不可见。
- 旧 CanvasProject、旧 canvas WebDAV manifest 和无 canvas-folders manifest 均可读取。
- SQL schema diff 为空；仅前后端 allowedDomains 扩展。

## 9. 测试与验证计划

### 单元测试

- project/folder normalize 幂等与非法字段。
- traversal 安全上限、cycle guard、最近活动祖先和 reconcile plan；验证不存在 tombstone compact/GC 路径。
- remove-wins merge 与 manifest runtime parser。
- generation 写序列：失败 → 继续编辑 → retry → repository 为最新状态。
- WebDAV ETag 条件 PUT、412 重读合并/重试上限、无 ETag 写后重读弱保证。
- commitId 测试：legacy 缺失可读、存在时空白/非字符串/超长拒绝、新写 canvas 与 canvas-folders 必填且每次唯一、commitId 不参与业务 merge、写后重读 commitId 不匹配或规范化内容不匹配均失败。
- URL 两类 allowlist、draft/committed q 状态机。
- 版本化 cover key、固定候选/触发/尺寸/编码契约，以及首版无自动 cover GC。
- archive v3/v4 parser、显式 cover 收集、id/key remap。
- ZIP 限额、zip bomb 渐进中止、路径穿越和规范化重复路径。

### 集成测试

- browser envelope migrate；folder store 无 order document。
- MySQL 分文档重复 hydration 无二次写。
- hydration/write/flush/retry 状态变化。
- 失败 generation 过期时 retry flush 最新完整状态。
- tombstone 成功 + reconcile 失败/恢复。
- canvas 与 canvas-folders 两 manifest 独立成功、独立失败、部分重试、ETag 412、无 ETag 降级，以及写后 commitId/规范化内容不匹配。
- import staging/commit/compensation 故障注入。
- storage-server 新 domain CRUD/batch/revision conflict。
- i18n 对等。

### 人工/执行环境浏览器验证协议（非仓库 E2E 命令）

仓库当前没有 E2E runner/script。本节不是可执行的仓库命令：优先使用执行环境提供的浏览器自动化；不可用时由验证者按同一协议人工执行并保存截图、网络和控制台证据，不得虚构 `npm run e2e` 等命令。

1. 浏览器驱动：创建 A/A1/A2、三张画布、搜索、筛选、移动、多个默认、删除 A1、刷新、reconcile retry。
2. URL：深链、非法参数、搜索 draft、前进后退、合法/非法 mode，以及 `agentUrl/agentToken` 条件转发；确认不转发 folder/q/type。
3. 封面：图片优先、视频次级、占位、固定尺寸/MIME、metadata flush 失败、删除 flush 失败、确认不存在自动 GC。
4. ZIP：v4 导出导入、v3 fixture、blob put 失败、部分导入提示、路径恶意输入和限额中止。
5. MySQL：重复 hydration、generation retry、folder CRUD、删除/retry、两个 WebDAV manifest、ETag/无 ETag 模式。
6. 键盘/触屏：菜单、对话框、焦点返回、retry 状态。

### 可视化验证

- 1440×900：根/嵌套/搜索、默认标签、hover/focus 菜单、暗色、partial sync error。
- 390×844：横向卡片、工具栏换行、移动/删除/重试对话框。
- 空库、空目录、无结果、占位封面、hydration/write error。

## 10. 需求 → 文件 → 验收 → 测试追踪矩阵

| 需求 | 主要文件 | 验收 | 测试/验证 |
|---|---|---|---|
| 名称搜索与 URL 状态 | `canvas-library-route.ts`、`canvas-library-toolbar.tsx`、`pages/canvas/index.tsx` | draft 即时过滤，q 防抖提交，导航同步 | routing unit + 浏览器前进后退协议 |
| `type=all/canvas/folder` | `canvas-library.ts`、`pages/canvas/index.tsx` | 三种类型准确，非法值回退 | model/filter unit + 浏览器验证 |
| 嵌套文件夹/导航 | `use-canvas-folder-store.ts`、`canvas-library.ts`、breadcrumbs/card | 实用任意层级，遍历有上限 | cycle/traversal unit + 4 层浏览器协议 |
| 移动画布/文件夹 | `canvas-move-dialog.tsx`、`canvas-folder-reconcile.ts` | 根/文件夹间移动，循环双重拒绝 | move unit/integration + 键盘验证 |
| 删除不删画布 | `canvas-delete-folder-dialog.tsx`、`canvas-folder-reconcile.ts` | tombstone 后派生提升，reconcile 可重试 | 故障注入 + 刷新恢复协议 |
| 非互斥默认标签 | `use-canvas-store.ts`、`canvas-project-card.tsx` | 多个 `isDefault=true` 互不影响 | store unit + UI 验证 |
| 缩略图固定契约 | `canvas-cover.ts`、`canvas-cover-storage.ts`、project/card | 图片优先、视频其次、640×360 WebP .82/PNG fallback | cover unit + 浏览器媒体矩阵 |
| 更多菜单/响应式 | project/folder card、resource menu、index | 桌面网格、移动横卡、操作可达 | 视觉截图 + 键盘/触屏协议 |
| 双 store 持久化 | 两 canvas stores、`localforage-storage.ts` | generation/flush/retry 正确，双 hydration gate | 失败→编辑→retry integration |
| WebDAV B+ | `app-sync.ts`、`canvas-folder-sync.ts`、`webdav-sync.ts`、`app-config-modal.tsx` | 两 manifest 独立进度；ETag 412 重试；无 ETag 弱保证 | parser/merge/HTTP mock + 浏览器进度验证 |
| ZIP v3/v4 与安全限制 | `zip.ts`、`parse-canvas-archive.ts`、`canvas-import.ts`、`canvas-export.ts` | v3/v4、限额、路径拒绝、部分导入报告 | archive unit + zip bomb/故障注入 |
| 不改 SQL/技术栈/i18n | storage domains、`messages.ts`、现有 SQL 文件 | schema diff 为空、无新依赖、双语对等 | storage-server tests、i18n check、diff review |

## 11. 外部证据引用

以下依据用于约束交互和工程方案；实施前由 Architect/Researcher 对链接可用性和最新表述做一次轻量复核：

- Figma 文件搜索：<https://help.figma.com/hc/en-us/articles/360040328653-Search-for-files-teams-and-projects>
- Figma 移动文件/项目：<https://help.figma.com/hc/en-us/articles/360038511413-Move-files-and-projects>
- Figma 删除与恢复：<https://help.figma.com/hc/en-us/articles/360040028114-Delete-and-restore-files>
- Figma 文件缩略图：<https://help.figma.com/hc/en-us/articles/360038511533-Set-custom-thumbnails-for-files>
- Notion 子页面层级：<https://www.notion.com/help/guides/creating-a-subpage>
- Google Drive 文件夹组织：<https://support.google.com/drive/answer/2375091>
- React 不可变状态更新：<https://react.dev/learn/updating-objects-in-state>
- Zustand persist/migration：<https://zustand.docs.pmnd.rs/integrations/persisting-store-data>
- MDN `HTMLCanvasElement.toBlob`：<https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob>
- MySQL JSON 类型：<https://dev.mysql.com/doc/refman/8.4/en/json.html>。本项目已有通用 `storage_documents` JSON 与 `storage_blobs`，因此本方案明确不新增关系表或 SQL DDL。

## 12. Deliberate pre-mortem 与可观测性

### Pre-mortem 1：删除在一台设备成功，另一台设备把 folder 复活

- 失败链：无条件 PUT 覆盖 tombstone，或无 ETag 服务发生并发覆盖。
- 预防：独立 canvas-folders manifest、remove-wins、ETag/If-Match、412 重读合并、有限重试；无 ETag 显示弱保证。
- 检测：folder sync phase 记录 read/merge/conditional-put/retry/verify；UI 单独标记 canvas-folders 失败或弱一致模式。

### Pre-mortem 2：本地写失败后继续编辑，retry 把旧状态覆盖回来

- 失败链：retry 无 generation 判定，重放旧失败快照。
- 预防：每次 mutation generation 单调递增；失败快照携带 generation；过期 retry flush 最新完整状态。
- 检测：通过现有 `STORAGE_ERROR_EVENT`/`storage-error` 通道记录 domain、operation、failedGeneration、currentGeneration；测试最终 repository 内容。

### Pre-mortem 3：恶意/损坏 ZIP 导致资源耗尽或部分导入难以理解

- 失败链：`unzipSync` 一次性分配、高压缩比输出、路径重复；commit 后补偿不完整。
- 预防：文件/条目/单项/累计限额，路径规范化，枚举/读取阶段渐进计量，内存 staging 和 best-effort compensation。
- 检测：import 结果记录 parsed/staged/written/compensated/uncompensated 的 folder/project/blob 数量；UI 以本地化“部分导入”错误展示受影响数量。

### Observability 最低契约

- **storage-error**：domain、operation、generation、writeStatus、错误码；不得记录 `agentToken`、WebDAV 密码或 blob 内容。
- **folder sync phase**：canvas 与 canvas-folders 独立 domain、阶段、ETag availability、412 retry count、fallback verification result、最终状态。
- **import partial counts**：parsed/staged/written/compensated/uncompensated，按 folder/project/blob 分类。
- **cover failures**：projectId、trigger（generation/lazy-backfill）、candidate type、encode format、failure stage；不得记录媒体内容或敏感 URL/token。
- 首版使用现有 UI 状态、AppError/storage-error 事件和控制台诊断，不新增遥测依赖或远端上报。

## 13. 风险与回滚点

| 风险 | 缓解 | 回滚点 |
|---|---|---|
| tombstone 成功而 reconcile 失败 | UI 依赖最近活动祖先；保存 backlog；flush/retry 显式 | 关闭 reconcile 自动运行，保留 tombstone 与派生 UI，不删除画布 |
| 双 store 部分 hydration 被误当完整数据 | success gate；错误状态禁止修复 | 只读显示错误并重试，不写根目录修复 |
| 远端并发覆盖 manifest | 优先 ETag 条件 PUT；412 重读合并并最多重试 3 次；无 ETag 写后重读校验并标注弱保证 | 暂停失败域上传，保留本地状态和独立重试入口 |
| manifest 损坏导致部分应用 | runtime parser 在 apply 前完整校验 | 拒绝该 manifest，保留本地数据并报告 retry |
| 新 cover blob 已写但 metadata flush 失败 | 版本化 key；旧引用不变；首版不自动 GC | 禁用自动封面生成，不删除任何未确认 blob |
| 项目删除后过早清理 cover | 等 project flush；只删除 metadata 当前引用 key | 停用即时清理，保留孤儿等待未来可靠 GC 协议 |
| ZIP commit 中途失败 | 进程内 staging、成功写清单、best-effort compensation、失败注入测试 | 补偿不完整时明确报告“部分导入”和受影响数量，不承诺完全回滚 |
| ZIP bomb/路径穿越消耗资源或覆盖条目 | 文件/条目/单项/累计限额；路径规范化；枚举与实际读取阶段渐进中止 | 中止导入，不提交 staged 业务数据；明确无法保证所有压缩比攻击都在解压前拦截 |
| retry 重放旧失败快照覆盖后续编辑 | generation 单调递增；过期失败 generation 改为 flush 最新状态 | 禁用自动 retry，保留错误并要求显式 flush 最新状态 |
| folder tombstone 持续增长 | 首版明确接受存储增长，等待未来设备同步水位协议 | 永久保留，不提供 compact/GC，避免多设备误复活或误删 |
| 全仓 format:check 受历史文件影响 | 同时报全仓和 changed-files 限定结果 | 不格式化无关文件，不把历史失败纳入本功能 diff |

### 发布回滚原则

- 不执行 SQL DDL，不删除 `canvas_folders` 文档或 `canvas-cover:` blobs 作为回滚。
- 回滚 UI 后新增域暂时不可见，但原 projects 仍可读取。
- 回滚 folder sync 时保留独立远端 manifest，待前滚恢复。
- 新增项目字段均可缺省，旧前端可忽略。

## 14. Architect/Critic 审核结论与交接

### 审核结论

- Architect：`APPROVE`。B+、generation-aware retry、ETag 条件写、封面和 ZIP 安全边界达到实现就绪程度。
- Critic：`APPROVE`。原则、方案、需求追踪、风险、测试与回滚满足计划门禁。
- 实施提示：集中实现两类 WebDAV manifest 的 `commitId` 生成与规范化，避免协议漂移。

### Architect 复审重点

- B+ 本地/远端领域隔离和两个 manifest 的部分失败语义。
- tombstone → 派生提升 → reconcile 是否完全避免事务化表述，并确认首版无 tombstone compact/GC。
- generation-aware flush/retry 与双 hydration success gate 是否可实现、可测试。
- ETag/If-Match、412 merge retry 和无 ETag 弱保证是否表述准确。
- 固定 cover 契约、无自动 GC，以及 ZIP 渐进限额/部分导入语义是否边界清晰。

### Critic 必审

- 12 项用户边界是否均保留。
- remove-wins、generation 写序列、runtime parser、ZIP 恶意输入和失败注入是否足够具体。
- URL draft/committed 状态是否避免导航竞争。
- 需求追踪矩阵、外部证据、pre-mortem、observability 和人工浏览器验证协议是否可执行且不虚构命令。

### 批准后建议执行路径

- 默认 `$ultragoal` 建立持久目标台账。
- 并行时 `$ultragoal` + `$team`：
  1. normalize/store/status/domain；
  2. tombstone/reconcile/WebDAV；
  3. ZIP/cover lifecycle；
  4. URL/UI/i18n/visual；
  5. verifier 汇总双驱动与失败注入证据。
- 共享文件必须单一 owner；`$ralph` 仅作为用户明确选择的单所有者 fallback。

### Team 启动提示

```bash
# 用户批准后，如需并行实施
omx team 4:executor "按 .omx/plans/canvas-library-management-upgrade-final.md 分阶段实现并验证"
```

Team 关闭前必须提供：模型/存储测试、WebDAV/ZIP 兼容与失败注入证据、桌面/移动视觉截图、浏览器/MySQL 双驱动冒烟结果。`$ultragoal` 负责将这些证据写入持久完成台账。

### Goal-Mode Follow-up Suggestions

- `$ultragoal`：默认执行路径，按阶段持久跟踪实现与验证。
- `$team` + `$ultragoal`：适合本方案的多条独立实现 lane；Team 并行交付，Ultragoal 保留完成台账。
- `$ralph`：仅在用户明确选择单所有者持续修复/验证时作为 fallback。

## 15. 审核改进记录

- 将独立 folder store 方案升级为 B+，本地与 WebDAV 都使用独立领域。
- 将跨 store 删除从伪事务顺序改为 tombstone 权威、派生提升和可重试 reconcile。
- 增加完整 hydration/write/flush/retry 状态和 generation 失效规则。
- 增加 ETag/If-Match、412 重读合并、无 ETag 的 commitId 写后校验。
- 将封面改为版本化 key，首版取消不安全的自动 GC。
- 增加 ZIP 运行时 parser、渐进资源限制、路径校验和部分导入语义。
- 增加需求追踪矩阵、外部证据、pre-mortem、observability 和人工浏览器验证协议。

### 停止规则

- 用户明确批准本文件前，不修改业务代码。
- 执行完成后，只有自动化检查、双驱动冒烟和视觉证据全部收集完成才可声明完成。
