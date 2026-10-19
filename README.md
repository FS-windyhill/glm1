# Render 多模型私人中转

支持的请求模型 ID：glm-5、glm-5.1、glm-5.2、kimi-k3、kimi-k2.6、kimi-k2.5。
GLM 固定转发到 https://api.z.ai/api/paas/v4/chat/completions 。
Kimi 固定转发到 https://api.moonshot.ai/v1/chat/completions 。
模型 ID 按上述名单原样发送；不替换或降级模型。账户需要具备相应模型权限和余额。
/v1/models 是本地配置列表，不代表厂商已验证模型可用，仅显示配置了 Key 的平台。

## 更新已有 Render 服务

1. 把包里的 server.mjs、server.test.mjs、package.json、README.md 和 .gitignore 放入仓库原中转目录。package.json 必须使用此文件名，不要使用 package(1).json。
2. Render → 现有服务 → Environment，设置：

| 变量 | 值 |
| --- | --- |
| ZAI_API_KEY | 真实 Z.AI Key |
| MOONSHOT_API_KEY | 与 api.moonshot.ai 匹配的真实 Kimi Key |
| RELAY_TOKEN | 保留原来至少 32 字符的随机中转密码 |
| ALLOWED_ORIGINS | https://795799.xyz,https://www.795799.xyz，或你的实际前端 Origin |

两个厂商 Key 都配置后会列出六个模型。也支持只配置一个平台。
不要把真实厂商 Key 放到前端、仓库或聊天里。
3. 推送代码并部署最新提交；修改变量后保存并部署。
4. 沿用原 Root Directory（README 原示例为 backend/zai-relay，须与仓库实际目录一致）、Build Command `npm install --omit=dev`、Start Command `npm start`、Health Check Path `/healthz`。
5. 日志出现 multi_model_relay_ready 表示启动成功。

## 前端设置

API URL：https://你的服务名.onrender.com/v1/chat/completions
API Key：RELAY_TOKEN 的值。
模型：从上方六个完整 ID 中选择，注意 GLM 名称包含连字符，例如 glm-5.1。
六个预设可以共用同一个 URL 和中转密码。模型列表接口为 GET /v1/models，需 Bearer 中转密码。
现有 Worker 如果原先支持传递 URL、Key、model，可继续沿用；本包不包含 Worker，未验证其实现。

先逐个模型发送简单消息验证账户权限和连通性。本地测试使用假上游，不调用真实模型。
/healthz 只表示进程在线。厂商返回的模型不存在、余额不足、权限等错误会原样转发。

## 保护与排错

保留原有 CORS、鉴权、20 MiB 请求上限、最多四个并发、180 秒超时、流式转发和重定向拦截。
固定上游白名单，不接受调用者提供任意上游地址。日志不记录正文或 Key。
unsupported_model：模型 ID 不在名单中。
provider_not_configured：对应平台未配置 Key。
relay_unauthorized：中转密码不一致。
origin_not_allowed：实际网页 Origin 未列入 ALLOWED_ORIGINS。
upstream_response：日志包含平台、模型、状态码和请求编号。

本地验证：在本目录执行 npm test（Node 22）。
