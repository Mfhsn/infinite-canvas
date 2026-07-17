<p align="center">
  <img src="web/public/logo.svg" width="96" alt="infinite-canvas logo">
</p>

<h1 align="center">无限画布 (infinite-canvas)</h1>

<p align="center">
  <a href="https://linux.do/"><img src="https://img.shields.io/badge/Linux.do-Community-2b6de8?style=flat-square" alt="Linux.do"></a>
  <a href="https://render.com/deploy?repo=https://github.com/basketikun/infinite-canvas"><img src="https://img.shields.io/badge/Render-Deploy-46e3b7?style=flat-square&logo=render&logoColor=111111" alt="Deploy to Render"></a>
  <a href="https://github.com/basketikun/infinite-canvas"><img src="https://img.shields.io/github/stars/basketikun/infinite-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v0.2.0-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://reactrouter.com/"><img src="https://img.shields.io/badge/React_Router-7-ca4245?style=flat-square&logo=reactrouter&logoColor=white" alt="React Router"></a>
</p>

无限画布是一款面向图片创作的开源工作台。它把画布编排、AI 图片生成、参考图编辑、对话助手、提示词库和素材沉淀放在同一个界面里，适合用来探索视觉方案并连续迭代图片结果。

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种数据库结构和存储格式都可能直接调整，欢迎关注后续更新，当前更适合个人/本地部署，不建议直接公网多人共用。
>
> 如果你需要稳定维护自己的分支，建议自行 fork 后独立开发。二次开发与 PR 请保留原作者信息和前端页面标识。

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：浏览器前台直连你配置的 OpenAI 兼容接口，支持文生图、图生图、参考图编辑、文本问答、音频和视频生成；Seedance 2.0 可通过火山方舟 Agent Plan 接入。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 本地 Agent：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 操作当前画布；
- Codex App 插件：提供 Codex app 插件，安装后会自动注册 MCP 并尝试拉起本地 Agent。
- 提示词库：浏览器前端直连多个 GitHub 开源项目，并缓存到 IndexedDB。

完整功能说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

如果你在为担心没有合适的生图API来发愁，可以查看该免费生图项目：[chatgpt2api](https://github.com/basketikun/chatgpt2api)

## 技术栈

- 前端：Vite、React、React Router、TypeScript、Tailwind CSS、Ant Design、Zustand、TanStack Query。
- 前端：提示词库、WebDAV 和 AI 接口都由浏览器前端直连。
- 部署：静态站点托管或 Docker。

## 快速开始

AI API Key、Base URL、画布、素材和生成记录默认保存在浏览器本地。

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
cd web
  bun install
  bun run dev
```

Docker 运行：

```bash
docker build -t infinite-canvas .
docker run --rm -p 3000:3000 infinite-canvas
```

运行后默认端口3000，可访问 `http://localhost:3000`。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。

## New API 自动配置

如果使用 New API，可在 `系统设置 -> 聊天方式 -> 添加聊天设置` 中填入：

```text
https://canvas.best?apiKey={key}&baseUrl={address}
```

跳转后会自动打开配置弹窗并填入 API Key 和 Base URL。
如果自己部署了，可以把 `https://canvas.best` 替换成你部署的地址。

## 环境文件配置

### 数据存储切换

默认使用浏览器 localForage/IndexedDB 保存数据。需要让画布、素材、图片/视频生成记录以及图片、视频、音频在设备间共享时，在根目录 `.env` 中切换为 MySQL：

```env
DATA_STORAGE_DRIVER=mysql
STORAGE_NAMESPACE=default
STORAGE_MAX_FILE_MB=128
STORAGE_MAX_DOCUMENT_MB=16

MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=infinite_canvas
MYSQL_USER=infinite_canvas
MYSQL_PASSWORD=请设置独立密码
MYSQL_ROOT_PASSWORD=请设置独立Root密码
MYSQL_CONNECTION_LIMIT=10
MYSQL_CONNECT_ATTEMPTS=30
MYSQL_CONNECT_RETRY_MS=2000
MYSQL_SSL=false
```

然后通过 Compose 启动应用和 MySQL：

```bash
docker compose up -d
```

切换回 `DATA_STORAGE_DRIVER=browser` 并重启后，应用重新读取当前浏览器原有数据。两种驱动不会隐式双写，也不会在 MySQL 故障时自动降级，避免产生互相覆盖的两份数据。

首次启用 MySQL 后，可在“配置 -> 数据存储”中执行“导入到 MySQL”。导入会先上传媒体文件，再导入画布、素材和生成记录；可以重复执行，且不会删除浏览器中的原数据。

`MYSQL_*`、`DATA_STORAGE_DRIVER` 等变量只由服务端读取，不要增加 `VITE_` 前缀。所有 `VITE_*` 变量都会进入浏览器。MySQL 模式应同时把服务端 `STORAGE_MAX_FILE_MB` 和 MySQL `max_allowed_packet` 设置得大于最大媒体文件；Compose 默认将后者设置为 256MB。

当前 MySQL 模式按单用户自托管设计，`STORAGE_NAMESPACE` 用于部署级数据隔离，但 Storage API 本身不提供账号登录。不要在没有额外认证和访问控制的情况下把它作为多人公网服务。

本地开发 MySQL 模式需要先启动 `storage-server`，再启动 Vite：

```bash
cd storage-server
npm install
DATA_STORAGE_DRIVER=mysql MYSQL_HOST=127.0.0.1 npm start

# 另一个终端
cd web
DATA_STORAGE_DRIVER=mysql STORAGE_API_URL=http://127.0.0.1:3001 npm run dev
```

存储驱动只在启动时读取，修改 `.env` 后必须重启服务。

### AI 渠道配置

项目默认只内置“API接口示例”渠道，并严格提供以下模型：

- 图片：`doubao-seedream-4.5`（默认）、`doubao-seedream-5-0-260128`
- 视频：`doubao-seedance-1-5-pro-251215`（默认）、`doubao-seedance-2-0-260128`
- 音频：`tts-synthesize`（TTS 端点标识）

复制根目录 `.env.example` 为 `.env` 后即可同时供 Docker Compose 和本地 Vite 开发读取；`VITE_AI_BASE_URL` 配置接口前缀，`VITE_AI_API_KEY` 配置固定 Bearer Token，`VITE_AI_PLATFORM_ID` 配置 Dream 请求中的 `platform_id`（当前文档要求使用 `6`）。`VITE_AI_MODELS` 留空时使用上述内置模型；如需接入其他模型，可通过环境变量定义自有渠道及其模型列表，不会扩充内置渠道。

图片请求支持提示词、参考图、宽高、生成数量和 `platform_id`。选择分辨率和比例后，前端会将配置转换为明确的 `width`、`height` 数字；4K 的宽高分别为对应 2K 尺寸的 2 倍：

| 比例 | 2K        | 4K        |
| ---- | --------- | --------- |
| 1:1  | 2048×2048 | 4096×4096 |
| 4:3  | 2304×1728 | 4608×3456 |
| 3:4  | 1728×2304 | 3456×4608 |
| 3:2  | 2496×1664 | 4992×3328 |
| 2:3  | 1664×2496 | 3328×4992 |
| 16:9 | 2560×1440 | 5120×2880 |
| 9:16 | 1440×2560 | 2880×5120 |
| 21:9 | 3024×1296 | 6048×2592 |
| 9:21 | 1296×3024 | 2592×6048 |

参考图会先以 `multipart/form-data` 上传到 `/api/v1/upload/upload/image`，再把响应中的素材 `id` 放入生成请求的 `image_asset_ids`，不会把浏览器本地 URL 直接作为素材 ID。内置视频生成的提示词必填：`doubao-seedance-1-5-pro-251215` 仅支持首尾帧，必须上传首帧和尾帧各一张，时长为 5 或 10 秒，并支持 Seed；`doubao-seedance-2-0-260128` 支持首尾帧和全能参考，时长为 4-15 秒。全能参考固定使用 `subject2video`，最多接收 9 张图片、3 个视频和 3 个音频；音频直接上传到 `/api/v1/upload/upload/audio`，视频先通过 `/api/v1/upload/upload/chunk` 分片上传，再由 `/api/v1/upload/upload/video` 合并，最终分别传入 `audio_ids` 和 `video_ids`。

当前实现不会调用登录或 Refresh Token 接口。更新 Token 时直接修改 `.env` 中的 `VITE_AI_API_KEY`，然后重启 Docker 容器或本地开发服务器。建议保持 `VITE_AI_CONFIG_OVERRIDE=true`，确保 `.env` 中的 URL、Token、platform_id 和默认模型覆盖浏览器本地保存的旧配置。

如果 API 的 HTTP 地址会跳转到证书不包含该 IP 的 HTTPS 地址，可在 `.env` 设置 `VITE_AI_TLS_SERVER_NAME`。当前内置服务在 TLS ClientHello 携带 SNI 时会重置连接，因此 IP 配置还需设置 `VITE_AI_TLS_DISABLE_SNI=true`；本地 Vite 会通过同源 `/__dream_api_proxy` 连接固定的 `VITE_AI_BASE_URL` 主机，不发送 SNI，但仍使用 `VITE_AI_TLS_SERVER_NAME` 校验证书，代理目标不能由浏览器请求修改。若连接恢复后返回 `401 令牌无效或已过期`，说明网络与 TLS 已正常，应替换 `.env` 中的固定 Token 并重启开发服务器。

图片、视频、局部重绘和智能扩图接口返回 `task_id` 后，前端会先查询 `/api/v1/task/{task_id}/status`：`done=true` 时再读取 `/api/v1/task/{task_id}/results`，`failed=true` 时读取 `/api/v1/task/{task_id}` 的 `error_message`。图片结果兼容 `file_url`、`image_url`、`file_path`、`url`，以及当前任务接口实际用于返回 JPEG 的 `video_url`，仅在没有完整资源字段时使用 `thumbnail_url`；视频读取 `video_url`；TTS 直接读取同步响应中的 `audio_url`。`/storage/...` 等相对地址会自动拼接 `VITE_AI_BASE_URL`，同源媒体下载会继续携带固定 Bearer Token。

本地 Vite 开发时，项目会把缺少 CORS 响应头的火山 TOS 结果改写到同源 `/__dream_media_proxy`，再保存到浏览器本地存储。该代理仅允许 HTTPS `*.volces.com`，拒绝内网或任意外部地址；如使用其他静态部署方式，仍应由部署层或上游存储配置等价的受限媒体代理/CORS。

注意：前端直连模式下，环境变量会下发到浏览器，不适合在公网多人环境中放私密 API Key。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/jkWsF8q1/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/XrnfXHx7/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 文档

- [快速开始](docs/content/docs/overview/quick-start.mdx)
- [功能介绍](docs/content/docs/overview/features.mdx)
- [Render 部署](docs/content/docs/overview/render.mdx)
- [Docker 部署](docs/content/docs/overview/docker.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.mdx)
- [贡献者协议](CLA.md)
- [漏洞提交](SECURITY.md)
- [待办事项](docs/content/docs/progress/todo.mdx)
- [本地 Canvas Agent](canvas-agent/README.md)
- [Codex app 插件](plugins/infinite-canvas)

## 赞助支持

<div align="center">

如果这个项目对你有帮助，欢迎通过爱发电赞助支持，你的每一份鼓励都是持续更新的动力！

<br>

<a href="https://ifdian.net/a/basketikun">
  <img src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-%E8%B5%9E%E5%8A%A9%E4%BD%9C%E8%80%85-946ce6?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik0xMiAyMS4zNWwtMS40NS0xLjMyQzUuNCAxNS4zNiAyIDEyLjI4IDIgOC41IDIgNS40MiA0LjQyIDMgNy41IDNjMS43NCAwIDMuNDEuODEgNC41IDIuMDlDMTMuMDkgMy44MSAxNC43NiAzIDE2LjUgMyAxOS41OCAzIDIyIDUuNDIgMjIgOC41YzAgMy43OC0zLjQgNi44Ni04LjU1IDExLjU0TDEyIDIxLjM1eiIvPjwvc3ZnPg==&logoColor=white" alt="爱发电赞助" />
</a>

<br>
<br>

</div>

## 社区支持

学 AI，上 L 站：[LinuxDO](https://linux.do/)

点击链接加入群聊【AI开源交流】：https://qm.qq.com/q/DFnKzZ807u

## 开源协议

本项目使用 GNU Affero General Public License v3.0，见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=basketikun%2Finfinite-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
 </picture>
</a>
