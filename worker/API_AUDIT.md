# AI 大舞台 API 核查与官方接口迁移

## 核查依据

- GitHub：`giacomoyuan-cloud/AIARENA-website`，原前端提交 `bee3f7dd58a409786b69510f2ff2505d0276a44f`。
- Cloudflare：生产 Worker `ai`，自定义域 `api.pickandcase.com`，核查时活动版本 `18d9561c`。
- 完整 Worker 源码已备份；原文件 SHA-256：`f1762841ca384bc8caf463daf7c223498caad54c65277038bf42f828860d663f`。
- 生产环境保存了 10 个加密密钥绑定，其中 **8 个是模型服务密钥**，另两个 `ADMIN_KEY`、`PASSWORD` 是网站自己的认证密钥。
- 核查没有读取或展示完整密钥值；官方认证检查只读取模型列表，没有发起付费生成。

## 迁移前的 8 个模型服务密钥

| 密钥变量 | 对应服务/域名 | 是否官方直连 | 迁移前业务使用情况 |
| --- | --- | --- | --- |
| `QUICK` | QuickRouter，`api.quickrouter.ai` | 第三方中转 | 当前 7 个聊天模型、3 个图片模型和 MJ 生成均使用它 |
| `ANTHROPIC_API_KEY` | Anthropic，`api.anthropic.com` | 代码直连官方域名；预览检查未确认可用 | 记忆整理分支使用；主聊天的两个 Claude 选项仍走 QuickRouter |
| `OPENAI_API_KEY` | OpenAI，`api.openai.com` | 代码直连官方域名；预览检查未确认可用 | 已保存；原官方聊天分支被当前模型白名单挡住 |
| `GROK_API_KEY` | xAI，`api.x.ai` | 官方模型列表认证已通过 | 已保存；原官方分支未被当前聊天/图片选项调用 |
| `GEMINI_API_KEY` | Google，`generativelanguage.googleapis.com` | 代码直连官方域名；预览检查未确认可用 | 已保存；原官方分支未被当前选项调用 |
| `JIEKOU_API_KEY` | Jiekou.ai，`api.jiekou.ai` | 第三方中转 | 遗留 Codex/Kling 分支；被当前白名单挡住 |
| `HAJIMI_API_KEY` | `vip.aipro.love` | 第三方中转 | 遗留 Claude/Gemini 分支；被当前白名单挡住 |
| `MJ_API_KEY` | `proxy.pickandcase.com` 的 MJ 路由 | 第三方中转；不能因自有域名认定为官方 | 遗留 MJ 分支；当前 MJ 使用 `QUICK` |

“已保存 8 个”与“当前业务路由会引用 2 个”是两个口径。不能根据变量名或页面显示的“官方”二字认定认证成功。

## 官方端点只读检查

2026-10-26 23:43（北京时间），在未发布的 Cloudflare 编辑器预览中读取四家官方模型列表：

| 服务 | HTTP | 结果 |
| --- | --- | --- |
| xAI | 200 | 返回 `grok-4.6`、`grok-imagine-image-2.0`，官方认证与这两个模型的列表可见性通过 |
| Anthropic | 403 | `Request not allowed`；不能认定密钥失效，也没有证明官方调用可用 |
| OpenAI | 403 | `Country, region, or territory not supported` |
| Google | 400 | `User location is not supported for the API use.` |

这组结果来自当前默认就近运行的预览环境，不能替代对实际生产环境的复核，也不能据此认定生产环境必须更换运行地区。地区拒绝也不能证明密钥值无效。

临时认证检查脚本没有部署为生产版本。

## 已准备的迁移

- 七个聊天模型与三个图片模型保持原模型 ID，改为分别调用 xAI、Anthropic、OpenAI、Google 官方域名和各自密钥。
- 删除 Worker 中所有中转域名与四个中转密钥的引用。缺少官方密钥、认证失败或模型不可用时，直接显示错误，不退回中转。
- 保留现有网站认证、聊天、记忆、KV 和价格设置。新官方用量记录使用 `official~` 前缀，历史记录不被改写。
- 前端按四家官方服务显示预算与状态。Midjourney 没有通用公开官方 API，入口停用并说明原因；遗留 Kling 路由也不再发送中转请求。
- 不预设或要求修改 Cloudflare 运行地区。应先核对实际生产环境的官方接口响应，再决定是否需要地区调整；地区标签不能代替提供商对账号和地区的要求。

## 验证范围和待完成项

- 19 项本地离线测试通过：覆盖路由与密钥对应、流式解析、图片 JSON/多部分上传格式、拒绝中转回退、错误脱敏、记忆与历史用量保留。
- 两个前端内联脚本通过语法检查。
- **尚未据此证明三个受阻的官方账号可正常生成，也没有证明图片生成和编辑的真实效果。**
- 生产切换前仍需：从实际生产环境重做官方认证检查，再做必要的真实调用验收。预览中的地区拒绝不能直接视为生产环境必须改区的证据。

详细接口文档和部署顺序见 [README](README.md)。
