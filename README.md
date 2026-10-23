# Render 多模型私人中转

支持的请求模型 ID：glm-5、glm-5.1、glm-5.2、glm-5.3-flash、kimi-k3、kimi-k2.7-code、kimi-k2.6。
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

两个厂商 Key 都配置后会列出七个模型。也支持只配置一个平台。
不要把真实厂商 Key 放到前端、仓库或聊天里。
3. 推送代码并部署最新提交；修改变量后保存并部署。
4. 沿用原 Root Directory（README 原示例为 backend/zai-relay，须与仓库实际目录一致）、Build Command `npm install --omit=dev`、Start Command `npm start`、Health Check Path `/healthz`。
5. 日志出现 `multi_model_relay_ready` 且 `version` 是这次的新版本名，才说明新代码真的上线了。

## 部署后怎么确认（一条命令，不用带密码）

```
GET https://你的服务名.onrender.com/healthz
→ {"ok":true,"version":"1.1.0"}
```

`version` 和这次改的 `RELAY_VERSION` 一致，就说明部署成功、跑的是新代码；还是旧号就是还没部署完（Automation 没开就手动 Manual Deploy → Deploy latest commit），点 Restart 不管用。
启动日志里同样有一行：`{"event":"multi_model_relay_ready","version":"1.1.0","models":[...]}`，还能顺带看到这份名单。`/healthz` 不校验 Origin，也不需要 Bearer，只回版本，不消耗模型额度。

## 前端设置

API URL：https://你的服务名.onrender.com/v1/chat/completions
API Key：RELAY_TOKEN 的值。
模型：从上方七个完整 ID 中选择，注意 GLM 名称包含连字符，例如 glm-5.3-flash。
七个预设可以共用同一个 URL 和中转密码。模型列表接口为 GET /v1/models，需 Bearer 中转密码。
现有 Worker 如果原先支持传递 URL、Key、model，可继续沿用；本包不包含 Worker，未验证其实现。

先逐个模型发送简单消息验证账户权限和连通性。本地测试使用假上游，不调用真实模型。
/healthz 只表示进程在线。厂商返回的模型不存在、余额不足、权限等错误会原样转发。

## 新增或更换模型

模型名单写死在 server.mjs 的 `PROVIDERS` 里，不受环境变量控制，所以加模型等于改代码再部署。

1. 先查厂商文档里的 Model Code，必须逐字符一致（连字符、版本号、后缀都算），不要自己拼 `GLM5.3flash` 这种写法。
2. 在 server.mjs 把 Code 追加到对应平台的 `models` 数组：GLM 放 `zai`，Kimi 放 `moonshot`。`url` 不要动。
3. 顺手把 server.mjs 顶部的 `RELAY_VERSION` 换成新号（例如 1.1.0 → 1.2.0），否则部署后日志里还是旧号，你会分不清到底上没上线。
4. server.test.mjs 的两处名单（`/v1/models` 断言和逐模型循环）同步加上，README 的名单也同步。
5. `npm test` 通过后提交推送，Render 按原配置自动部署；`curl /healthz` 看到新版本号，再对新模型发一条简单消息实测。
6. 账户必须已开通该模型权限，否则请求照旧会被厂商拒绝，中转只负责原样透传错误。
7. 厂商停用的模型要从名单里删掉，否则它会一直躺在 /v1/models 里、点一次错一次。例如 Kimi 已于 2026-08-31 停用 kimi-k2.5，本版已移除。

## 保护与排错

保留原有 CORS、鉴权、20 MiB 请求上限、最多四个并发、180 秒超时、流式转发和重定向拦截。
固定上游白名单，不接受调用者提供任意上游地址。日志不记录正文或 Key。
unsupported_model：模型 ID 不在名单中。
provider_not_configured：对应平台未配置 Key。
relay_unauthorized：中转密码不一致。
origin_not_allowed：实际网页 Origin 未列入 ALLOWED_ORIGINS。
upstream_response：日志包含平台、模型、状态码和请求编号。

本地验证：在本目录执行 npm test（Node 22）。
