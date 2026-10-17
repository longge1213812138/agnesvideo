# Agnes Video Studio

个人本地使用的文生视频工具，对接 [Agnes Video 2.5 Flash](https://www.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash) 的异步视频生成接口。

## 启动

双击 `start.cmd`。首次运行会自动构建（约一分钟），之后打开一个无地址栏的独立窗口。

- 需要 Node.js 18+，以及 Edge 或 Chrome（用其 `--app` 模式承载界面）
- 关闭窗口即可退出；本地服务只在 `127.0.0.1` 上监听，不对外暴露

## 配置 API Key

优先级：界面设置里的覆盖值 > `public/config.local.js` 的预置值。

```js
// public/config.local.js（已被 .gitignore 忽略）
window.AGNES_CONFIG = { apiKey: 'sk-...' }
```

首次使用若没有该文件，复制 `public/config.local.example.js` 并填入 Key，或在界面右上角「设置」里粘贴。

## 功能范围

只实现 `mode: "text"`（纯文生视频）。`keyframe` 与 `reference` 需要可被 Agnes 服务端公开访问的媒体 URL，个人本地使用没有图床，故不实现——理由见 `docs/adr/0002-text-mode-only.md`。

固定参数：模型 `agnes-video-2.5-flash`、`size` `"720P"`、`n` `1`。可调：提示词、时长 4–12 秒、六种画幅。

## 接口调用

| 动作 | 请求 |
| --- | --- |
| 创建任务 | `POST https://apihub.agnes-ai.com/v1/videos` |
| 查询任务 | `GET https://apihub.agnes-ai.com/agnesapi?video_id=…&model_name=agnes-video-2.5-flash` |

轮询间隔 1.5 秒；遇 `429`/`503` 指数退避；单次生成轮询上限 10 分钟，超时不判失败（见 `docs/adr/0003-polling-timeout-is-not-failure.md`）。

## 开发

```bash
pnpm install
pnpm dev          # 开发服务器
pnpm build        # 构建到 dist/
pnpm lint         # oxlint

# 验证（需先在另一个终端启动本地服务：node scripts/launch.mjs）
node scripts/verify-all.mjs   # 一次跑完 7 个套件
node scripts/e2e.mjs --live   # 追加真实生成（需要 Agnes 队列可用）
```

验证套件覆盖：基础界面与 401 处理、断网/503/任务失败/429 的故障注入、队列等待可取消、按真实响应样本解析、下载链路、并发上限、刷新恢复。

### 错误处理的实测补充

Agnes 实际会返回文档未记载的两类失败（见 `docs/adr/0004-auto-retry-on-queue-full.md` 与完整的调研记录 `docs/research/2026-10-17-video-queue-full.md`）：

- `503 {"code":"video_queue_full"}`：服务端视频队列达容量上限。实测等待 15/30/60/120 秒乃至跨 20 分钟都不恢复，官方文档未记载此码。程序按 30/45/68/101/152/180 秒递增退避，最多 6 次尝试或 15 分钟预算，横幅显示逐秒倒计时并可随时「取消等待」，明示不产生费用。
- `429 rate_limit_exceeded`：官方 Token Plan 文档给出免费档视频模型**实际 RPM 1**，程序据此把两次创建提交间隔强制拉到 ≥60 秒，避免自己把自己打成限流。

> 文档只说"免费用户受 RPM 限制"，具体数值在 [Token Plan 页](https://wiki.agnes-ai.com/zh-Hans/docs/tokenplan)。同类型 Key 共享配额池，多开 Key 不会叠加。

## 已知限制

- 成片由 Agnes 托管，`url` 可能过期；过期后用历史记录里的「重新查询」凭视频 ID 取回
- `internal_status` / `internal_progress` 不作判断依据，一律以 `status` / `progress` 为准
- 无头浏览器无法验证 MP4 真实落盘；下载链路的每一环（fetch → Blob → `a[download]` → 回收 objectURL）已断言，最终落盘请在双击启动的有头窗口里确认

## 文档

- `GLOSSARY.md`：领域术语（生成任务 / 视频 ID / 成片 / 成片地址）
- `docs/adr/`：架构决策记录
- `docs/agents/`：技能配置（issue tracker、triage 标签、领域文档约定）
