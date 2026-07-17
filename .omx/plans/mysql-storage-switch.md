# MySQL / 浏览器本地存储可切换方案

状态：已实施，等待最终环境验证。

## 1. 需求摘要

- 保留现有浏览器本地存储模式，默认行为不回归。
- 新增 MySQL 持久化模式，并由部署配置文件选择存储驱动。
- MySQL 模式覆盖画布、素材、图片/视频生成记录以及图片/视频/音频二进制文件。
- MySQL 账号密码只存在服务端环境变量中，不进入 `VITE_*`、`env.js` 或浏览器代码。
- 切换驱动必须重启服务，运行期间不允许自动在 MySQL 与本地存储间降级，避免数据分叉。

## 2. 当前实现依据

- 画布项目整体保存在 Zustand + localForage：`web/src/stores/canvas/use-canvas-store.ts:36-60`、`:122-132`。
- 素材元数据整体保存在 localForage：`web/src/stores/use-asset-store.ts:38-64`、`:96-103`。
- 图片 Blob 保存在 IndexedDB `image_files`：`web/src/services/image-storage.ts:16-26`。
- 视频/音频 Blob 保存在 IndexedDB `media_files`：`web/src/services/file-storage.ts:6-16`。
- 图片生成记录直接使用 localForage：`web/src/pages/image/index.tsx:71-74`、`:248-263`。
- 视频生成记录直接使用 localForage：`web/src/pages/video/index.tsx:87-88`、`:362-376`。
- WebDAV 已经把同步数据划分成画布、素材、图片记录、视频记录四个域，可复用该领域边界：`web/src/services/app-sync.ts:10-18`、`:81-119`。
- 当前正式镜像只有 Nginx 静态前端，没有可连接 MySQL 的服务端：`Dockerfile:1-19`。

## 3. 默认假设

- 第一阶段按“单用户/单租户自托管”实现，使用固定 `STORAGE_NAMESPACE=default` 隔离数据。
- MySQL 模式下媒体文件也进入 MySQL `LONGBLOB`，确保换浏览器或换设备后数据完整。
- 主题、语言、快捷工具偏好继续保存在浏览器；AI API Key 继续由现有 env/配置机制管理，不写入 MySQL。
- 不在本阶段增加用户注册、登录和多租户权限系统；如果需要公网多人使用，必须另加认证与 owner 隔离。

## 4. 架构决策

### 推荐方案：统一存储抽象 + 同源 Storage API

1. 前端只依赖统一的文档/Blob 存储接口。
2. `browser` 驱动继续使用 localForage/IndexedDB。
3. `mysql` 驱动通过同源 `/api/storage/*` 调用服务端。
4. 新增独立 Storage Server，在 MySQL 模式下连接数据库；浏览器永不直连 MySQL。
5. 为兼容当前数据结构，第一阶段不拆分画布节点/连线为大量关系表，而是保留现有 JSON 文档结构。

### 不采用的方案

- 浏览器直接连接 MySQL：会暴露数据库凭据且浏览器协议不支持。
- 只把 JSON 写 MySQL、媒体仍留 IndexedDB：跨设备打开会丢图片和视频，不满足完整持久化。
- 直接重写为完全关系化节点/连线表：改动面和迁移风险过大，不利于保持现有行为。

## 5. 配置设计

服务端配置：

```env
DATA_STORAGE_DRIVER=browser # browser | mysql
STORAGE_NAMESPACE=default

MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=infinite_canvas
MYSQL_USER=infinite_canvas
MYSQL_PASSWORD=
MYSQL_CONNECTION_LIMIT=10
MYSQL_SSL=false

STORAGE_MAX_FILE_MB=128
STORAGE_API_PORT=3001
```

规则：

- `browser`：Storage Server 不连接 MySQL，前端沿用 localForage。
- `mysql`：启动时必须完成数据库连通性和迁移检查，失败则服务健康检查失败，不静默回退。
- MySQL 凭据不得加入 `docker/runtime-env.sh`，不得以 `VITE_*` 输出。
- 前端通过 `/api/storage/config` 获取当前驱动，不维护第二份易冲突的驱动配置。

## 6. 数据库结构

### `storage_documents`

- `namespace` VARCHAR(64)
- `domain` VARCHAR(64)：`canvas`、`assets`、`image_generation_logs`、`video_generation_logs`
- `record_key` VARCHAR(191)
- `payload` JSON
- `revision` BIGINT UNSIGNED
- `created_at` DATETIME(3)
- `updated_at` DATETIME(3)
- 主键：`namespace + domain + record_key`

用途：

- 画布：每个项目一条记录。
- 素材：每个素材一条记录。
- 生成记录：每个日志 ID 一条记录。

### `storage_blobs`

- `namespace` VARCHAR(64)
- `storage_key` VARCHAR(191)
- `mime_type` VARCHAR(127)
- `byte_size` BIGINT UNSIGNED
- `content` LONGBLOB
- `created_at` DATETIME(3)
- `updated_at` DATETIME(3)
- 主键：`namespace + storage_key`

### `schema_migrations`

- `version` VARCHAR(64) 主键
- `applied_at` DATETIME(3)

## 7. Storage API

- `GET /api/storage/health`
- `GET /api/storage/config`
- `GET /api/storage/documents/:domain`
- `GET /api/storage/documents/:domain/:key`
- `PUT /api/storage/documents/:domain/:key`
- `DELETE /api/storage/documents/:domain/:key`
- `GET /api/storage/blobs`
- `GET /api/storage/blobs/:storageKey`
- `PUT /api/storage/blobs/:storageKey`
- `DELETE /api/storage/blobs/:storageKey`

约束：

- 文档写入使用 revision/ETag，旧版本写入返回 409，避免多标签页静默覆盖。
- Blob 上传限制 MIME、大小和 key 格式。
- 视频读取支持 HTTP Range/206，避免每次播放都下载完整视频。
- 错误返回统一结构，前端区分网络错误、冲突、空间限制和数据库错误。

## 8. 实施步骤

1. **先补回归测试和存储契约测试**
   - 锁定当前画布、素材、日志、Blob 的读写/删除/恢复行为。
   - 定义 `DocumentRepository` 与 `BlobRepository` 的共享契约测试，两个驱动必须通过同一组测试。

2. **新增 Storage Server**
   - 建立服务端 TypeScript 包。
   - 提供静态前端托管、Storage API、健康检查、请求体大小限制和统一错误处理。
   - MySQL 使用连接池和参数化查询，不拼接 SQL。

3. **实现数据库迁移和 MySQL Repository**
   - 建立三张表及幂等迁移脚本。
   - 实现文档 CRUD、revision 冲突、Blob 流式响应和 Range 请求。
   - 增加数据库断线重连与健康状态。

4. **抽取前端存储驱动层**
   - 将 `localForageStorage`、图片 Blob 和媒体 Blob 包装成 browser repository。
   - 新增 mysql/http repository。
   - 由 `/api/storage/config` 在应用启动时选择驱动；获取配置失败时仅在服务明确返回 browser 模式时使用本地驱动。

5. **迁移画布和素材 Store**
   - 保留 Zustand 作为内存状态管理。
   - hydration 改为从选中的 repository 加载。
   - 创建、更新、重命名、删除使用乐观 UI + 后台持久化，失败时显示可恢复错误。
   - 保留当前 400ms 画布保存防抖，但 MySQL 按项目写入，避免覆盖全部项目。

6. **迁移生成记录**
   - 图片页、视频页不再直接创建 localForage instance。
   - 使用统一 generation-log repository，继续支持 pending 视频任务恢复轮询。

7. **迁移图片/视频/音频 Blob**
   - 保持现有 `storageKey` 格式，避免画布 JSON 迁移。
   - `uploadImage`、`uploadMediaFile`、resolve/get/set/delete/cleanup 全部委托 BlobRepository。
   - MySQL 模式返回同源媒体 URL，并处理 URL 生命周期和缓存。

8. **加入显式数据迁移流程**
   - 第一次启用 MySQL 时检测浏览器本地数据。
   - 由用户显式执行“导入本地数据到 MySQL”，先上传 Blob，再写文档。
   - 迁移使用可重复执行的 upsert，并输出项目数、素材数、日志数、文件数和失败项。
   - 不自动清空浏览器数据；回滚到 browser 模式时仍可读取原本地数据。

9. **更新 Docker 和配置样例**
   - 更新 Dockerfile，使运行容器同时提供静态页面和 Storage API。
   - Compose 增加 MySQL 服务、持久卷、健康检查和 Storage Server 配置。
   - `.env.example` 增加存储驱动与数据库变量，README 增加 browser/mysql 启动示例。

10. **验证和故障恢复**
    - 运行单元、API 集成、MySQL 集成、前端 E2E、构建和静态检查。
    - 验证数据库不可用时不会写到另一套本地数据。
    - 验证从 MySQL 切回 browser 后原本地数据未被破坏。

## 9. 验收标准

- `DATA_STORAGE_DRIVER=browser` 时，无 MySQL 也能启动，现有数据和功能不回归。
- `DATA_STORAGE_DRIVER=mysql` 时，画布、素材、生成记录和媒体在刷新、重启容器、换浏览器后仍可读取。
- 两个浏览器读取同一 namespace 时能看到相同数据；并发旧 revision 写入返回 409。
- 删除画布/素材后，只删除已无引用的 Blob。
- 50MB 视频可以上传、刷新后播放，并支持 Range 请求。
- 视频 pending 任务刷新后可以从 MySQL 日志恢复轮询。
- 客户端 bundle、`env.js` 和网络响应中不出现 MySQL 密码。
- MySQL 不可用时健康检查失败且 UI 显示存储不可用，不静默转用 IndexedDB。
- 本地到 MySQL 的迁移可重复执行且不会产生重复项目或重复 Blob。

## 10. 风险与缓解

- **大文件使数据库膨胀**：限制单文件大小、记录字节数、使用 Range；后续可增加 S3/MinIO Blob 驱动。
- **MySQL `max_allowed_packet` 不足**：Compose 和文档同步配置至少 128MB，并在健康检查中验证。
- **频繁画布保存**：保留防抖、按项目 upsert、只在内容变化时写入。
- **多标签页覆盖**：revision/ETag + 409 冲突提示。
- **无用户认证**：第一阶段仅支持可信单用户部署；公网多用户必须先增加认证和 owner_id。
- **切换驱动造成数据错觉**：驱动只在启动时决定，提供显式迁移，不做隐式双写或自动合并。

## 11. 批准前需要确认的默认前提

本计划按以下默认值执行：

1. 单用户/单租户部署，不增加登录系统。
2. MySQL 模式把媒体二进制也保存为 `LONGBLOB`。
3. 主题、语言、AI 渠道/API Key 不进入 MySQL。
4. 默认仍为 browser 模式，只有配置 `DATA_STORAGE_DRIVER=mysql` 才启用 MySQL。
