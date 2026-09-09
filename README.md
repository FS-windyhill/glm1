# Render 私人 GLM-5 中转

链路：PWA → 现有 Cloudflare Worker → Render → Z.AI。
真实 Z.AI Key 仅配置在 Render；前端 API Key 填中转密码。只允许 glm-5，固定请求 Z.AI 通用 API。

## 1. 创建 Render 服务

将本目录随工程提交并推送到自己的 GitHub 仓库。Render 控制台选择 New → Web Service，连接这个仓库。

| 字段 | 填写 |
| --- | --- |
| Name | 自己取名，例如 telewindy-glm-relay |
| Language | Node |
| Root Directory | backend/zai-relay |
| Build Command | npm install --omit=dev |
| Start Command | npm start |
| Instance Type | Free，先验证连通性 |
| Health Check Path | /healthz |

在 Environment Variables 添加：

| Key | Value |
| --- | --- |
| ZAI_API_KEY | 你的真实 Z.AI API Key |
| RELAY_TOKEN | 自己生成的至少 32 字符随机中转密码，与真实 Key 不同 |
| ALLOWED_ORIGINS | https://795799.xyz,https://www.795799.xyz |

ALLOWED_ORIGINS 用于浏览器直连。Worker 请求不携带 Origin，仍需中转密码。
可用密码管理器生成随机密码，或在自己电脑的 PowerShell 执行以下命令，把结果仅填入 Render 和自己的前端预设：

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

点击 Deploy Web Service，等待出现 zai_relay_ready。记录 Render 给出的 https://你的服务名.onrender.com 地址。

## 2. 测试与前端配置

先在浏览器打开 https://你的服务名.onrender.com/healthz，等到显示 {"ok":true}。
这只验证服务启动，不代表 Z.AI 已连通；免费实例冷启动可能需要约一分钟。

在 TeleWindy 新建一个 API 预设，保留原有预设：

| 字段 | 填写 |
| --- | --- |
| API URL | https://你的服务名.onrender.com/v1/chat/completions |
| API Key | RELAY_TOKEN 的值（不是 ZAI_API_KEY） |
| 模型 | glm-5 |
| 附加请求体 | 初次测试留空 |

先在空会话中发送 Hello，关闭后台回复接收可单独验证 PWA → Render → Z.AI。
然后启用原来的后台回复接收，后台 URL 与 APP_TOKEN 保持现有值，后台调用模式选“跟随前端 API Key”。
这个模式会让现有 Worker 使用 Render URL 和中转密码；无需修改 Worker 代码或部署新的 Worker。
最后再测试 OC 的完整上下文及长回复。

## 3. 查看结果

- /healthz 成功：仅说明 Render 服务在线。
- relay_unauthorized：前端 API Key 与 Render RELAY_TOKEN 不一致。
- origin_not_allowed：把实际网页 Origin 加入 ALLOWED_ORIGINS，用逗号分隔。
- Render 日志 zai_response 的 status 为 200，聊天实际返回正文：上游调用通过。
- 日志仍为 405：Render 出口也未解决问题，不要据此购买付费实例。
- relay_timeout_or_disconnected：请求超时或下游断开；中转上限 180 秒，现有 Worker 上限 200 秒。

免费实例闲置 15 分钟会休眠，先访问 /healthz 唤醒再发送长请求，避免冷启动占用 Worker 超时预算。
免费服务可能重启或受额度限制；验证稳定后再决定是否需要付费常驻。这里没有配置定时保活。
聊天内容不落盘、不打印；仅在转发期间存在于内存。中转仅允许固定 Z.AI 地址，不能作为通用代理。

部署文档：https://render.com/docs/deploy-node-express-app
环境变量：https://render.com/docs/configure-environment-variables
免费限制：https://render.com/docs/free
