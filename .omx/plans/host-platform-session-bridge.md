# 同源主站会话接管方案

> 状态：已实施  
> 修正：画布不再单独注册/登录，而是复用同源主站的登录态。

## 浏览器键

```text
ai-comic-external-auth-session  -> external_token / refresh_token / profile
ai-comic-current-project-id     -> 当前平台项目 ID
```

`localStorage` 受同源策略约束，主站与画布必须使用完全相同的协议、域名和端口。

## 初始化流程

```text
进入画布
→ 读取 ai-comic-external-auth-session
→ 读取 ai-comic-current-project-id
→ POST /api/platform/session/bootstrap
→ Storage Server 调用 /api/integration/session/exchange
→ 服务端加密保存 external/local token
→ 返回脱敏用户/项目上下文、HttpOnly Cookie 和 session binding
→ 水合当前项目的画布、文件夹、素材和生成记录
```

## 安全边界

- Token 因主站既有契约本就存在同源 `localStorage`；画布仅将其 POST 到同源 Storage Server。
- Storage Server 的响应、日志和画布持久化数据均不返回/保存明文 Token。
- `bootstrap` 使用 same-origin 校验；服务端会话使用 HttpOnly Cookie、加密 Token 和 `X-Canvas-Session-Binding`。
- 重复初始化且 Token/项目未变时直接复用现有服务端会话，避免每次刷新都轮换 Cookie。
- 画布内切换平台项目时，同步更新 `ai-comic-current-project-id`。

## 部署约束

`https://example.com` 与 `http://example.com:3000` 不同源，后者无法读取前者的 localStorage。生产环境应通过主站 HTTPS 反向代理暴露画布，而不是让用户直接访问 Docker 的 `:3000` 端口。
