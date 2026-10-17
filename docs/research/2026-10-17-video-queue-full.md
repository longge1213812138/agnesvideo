# 2026-10-17 `video_queue_full` 调研与生成请求方案

## 一句话结论

官方文档**没有**记载 `video_queue_full` 这个错误码；把它当"等 30 秒重试两次就能排上"是错的。实测：连续等待 15 / 30 / 60 / 120 秒、跨 20 分钟、换国际站与国内站域名，**每次都还是 503**。它本质是服务端视频生成队列的硬容量上限，与客户端参数、Key 是否合法都无关。可行的客户端对策只有三条：**把请求压到官方视频 RPM 以内（免费档 1 RPM）、把重试窗口从 2×30 秒拉长到分钟级耐心等待、以及准备多个 Key 分摊配额**。

## 一、官方怎么说

### 1. 错误码总表里没有它

[Agnes 常见错误码](https://wiki.agnes-ai.com/zh-Hans/docs/code) 只列了 400 / 401 / 402 / 403 / 404 / 405 / 408 / 409 / 413 / 415 / 422 / 429 / 431 / 499 / 500 / 502 / 503 / 504 / 520 / 522。其中 503 的官方解释是：

> 服务暂时不可用，或由于第三方工具配置问题导致请求失败。常见原因：模型名称不正确、获取模型列表失败、未选择回退模型、路由未启用……解决方案：检查模型名称是否正确……稍后重试。

即官方把 503 当成"配置错了"或"稍后重试"，**没有任何一处解释 `video_queue_full` 这个业务码**。

### 2. 视频模型文档的错误处理表也没有它

[Agnes Video 2.5](https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-25) 的 Error Handling 表只写了 400 / 404 / 429 / 500，Recommended Action 分别是"检查字段""用创建响应里的 video_id""指数退避并降低轮询频率""稍后重试"。503 队列满不在表内。

### 3. 但官方给了真正能用的数字：视频 RPM

[Token Plan 文档](https://wiki.agnes-ai.com/zh-Hans/docs/tokenplan) 的「5. 视频模型 RPM 限制」是本次调研最有价值的一手数据：

| 模型类型 | 用户类型 | 允许发起 RPM | 实际 RPM |
| --- | --- | --- | --- |
| 视频模型 | `default`（免费） | 2 | **1** |
| 视频模型 | `enterprise`（企业认证） | 2 | 2 |

并且明确：

> 视频生成成本较高，因此 RPM 通常低于文本和低分辨率图片。
> 限制按**密钥类型**共享，而不是按每个单独的密钥分别计算。创建多个相同类型的密钥，不会增加总 RPM 或总配额。

[FAQ](https://wiki.agnes-ai.com/zh-Hans/docs/faqs) 也确认免费用户只受 RPM 限制，"如果你达到限制，请稍等片刻后再发起请求"，5xx 建议"指数退避重试，例如 `1s → 2s → 4s → 8s`"。

**免费档视频实际只有 1 次/分钟**。这解释了为什么原实现"2 次重试、间隔 30 秒"几乎必然失败：两次重试都落在同一分钟的限流窗口里，而且队列满本身也不看这个窗口。

## 二、实测证据（本机，2026-10-17）

原始响应（无 `Retry-After` 头）：

```
HTTP 503
{"code":"video_queue_full","message":"video queue is full, please retry later (request id: …)","data":null}
```

对照响应（同为 429，同样无 `Retry-After`）：

```
HTTP 429
{"error":{"message":"You've reached the API rate limit for free users. Upgrade to a Token Plan …","code":"rate_limit_exceeded","type":"AgnesAI_error"}}
```

探测结果：

| 探测 | 结果 |
| --- | --- |
| 同一参数连打 6 次（间隔 2s） | 前 1 次 503，后续全部 429 |
| 等 15 / 30 / 60 / 120 秒后重试 | 全部 503，**没有任何一次恢复** |
| 跨 20 分钟分 3 轮、每轮等待 0/15/30/60/120 秒 | 每轮都是 503 与 429 交替，**零成功** |
| 换秒数（4/12）、换画幅（9:16） | 不影响，仍 503/429 |
| 换 `agnes-video-2.5`（非 Flash） | 同样 503/429 |
| 换域名 `apihub.agnes-ai.cn` | 同样 503 |
| 查询不存在的 `video_id` | 正常 404 `task not found`（查询通道未受影响） |

响应头里出现 `X-New-Api-Version: master-…`、`Server-Timing`、`cf-cache-status`，说明 Agnes 网关是基于 [new-api](https://github.com/QuantumNous/new-api) 这类聚合网关二次开发的，`video_queue_full` 是网关自定义业务码，不是 OpenAI 视频接口的标准错误。

## 三、网上能找到的解决方案

### 1. 官方仓库 issue：只承认"过载"，未给方案

[AgnesAI-Labs/AgnesAI-Models#76](https://github.com/AgnesAI-Labs/AgnesAI-Models/issues/76) 报告 "API call failed after 3 retries: HTTP 503: system memory overloaded"，复现时间集中在北京时间 10:00–10:45，官方状态为 Todo。即官方承认 503 与"系统过载"有关，但没给出客户端对策。

### 2. 社区最流行的方案：多 Key 轮换 + 本地限速桶

开源项目 [lcy362/agnes-video-generator](https://github.com/lcy362/agnes-video-generator) 的 `.env.example` 写得很直白：

> 每个 Key 的配额独立，总量 ≈ 20 × Key 数 / 分钟。
> 遇到 429 会自动轮换到下一个 Key；限速配额与并发上限随 Key 数线性放大。
> 视频提交独立桶（默认 = 1 × Key 数）；若服务端对视频提交是「全局限 1/min」而非 per-Key，显式设为 1。

它的做法可以概括为：**客户端令牌桶把视频提交压到 1 次/分钟，多 Key 时按 Key 数线性放大，429 自动切下一个 Key**。注意它自己也不确定队列满是不是 per-Key（"若服务端对视频提交是全局限 1/min 而非 per-Key"），这与我们实测"多 Key 共享配额池"的官方说明一致。

### 3. 通用工程实践：长退避 + 不完全放弃

官方 FAQ 建议 `1s → 2s → 4s → 8s`，但这只适合短时抖动。对于一个可能持续数十分钟的硬队列，正确做法是**指数退避 + 上限封顶 + 总窗口够长**，并允许用户随时取消，而不是"重试 2 次就报错"。

## 四、据此改成的请求方案

改动集中在 `src/api/agnes.ts`、新增 `src/api/throttle.ts`、`src/App.tsx`、新增 `src/components/CreateWaitBanner.tsx`。

1. **被动冷却而非无条件限速**：只有服务端真的回了队列满 / 限流，才写入冷却并等完再提交；正常连续提交两个不同视频不会被无谓卡住（免费档允许发起 RPM 是 2，无差别限制反而像卡死）。
2. **耐心重试代替 2 次即弃**：默认最多 6 次尝试（含首次），退避 30s → 45s → 68s → 101s → 152s → 180s（封顶 300s），总预算 15 分钟；`Retry-After` 头存在时优先遵守。剩余预算不够下一轮时直接如实报错，不把用户晾在原地。
3. **可取消**：等待期间横幅上有「取消等待」按钮，基于 `AbortController` 立即中止，不留失败记录、不弹错误横幅。
4. **等待期间不占用并发生成槽位**，且明确标注"任务尚未创建、不会产生费用"。
5. **错误文案改实**：不再承诺"等一分钟通常就能排上"，改为"队列何时腾出空位由服务端决定，实测可能持续数十分钟"，并给出可操作项（继续等 / 取消 / 换时间）。
6. **设置面板说明多 Key 的真相**：同类型 Key 共享配额池，多开免费 Key 不会提高限额。

**这次没有做**：多 Key 自动轮换。原因是官方文档明确"创建多个同类型密钥不会增加总 RPM 或总配额"，同一个免费 Key 池里轮换没有收益；只有在用户同时持有 Token Plan Key 或另一个账号的 Key 时才有意义，那属于另一个产品决策，需用户确认后再做。

**一个设计上的反复值得记下**：最初把节流实现成"两次提交强制间隔 60 秒"，结果并发用例立刻失败——连续生成 5 个视频时第 2~5 个被无谓卡住一分钟。这证明无条件限速是错的，节流应只作为"被拒之后的冷却"，而不是常规节奏。现在 `SubmitThrottle` 只有 `freeze` / `clearCooldown`，没有"每次提交都记账"的逻辑。

## 来源

- [Agnes 常见错误码](https://wiki.agnes-ai.com/zh-Hans/docs/code)
- [Agnes Video 2.5 文档（含 Error Handling）](https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-25)
- [Agnes Video 2.5 Flash 文档](https://wiki.agnes-ai.com/zh-Hans/docs/agnes-video-25-flash)
- [Agnes Token Plan：视频 RPM 与配额](https://wiki.agnes-ai.com/zh-Hans/docs/tokenplan)
- [Agnes FAQ](https://wiki.agnes-ai.com/zh-Hans/docs/faqs)
- [AgnesAI-Labs/AgnesAI-Models#76](https://github.com/AgnesAI-Labs/AgnesAI-Models/issues/76)
- [lcy362/agnes-video-generator .env.example](https://github.com/lcy362/agnes-video-generator/blob/master/.env.example)
- [QuantumNous/new-api](https://github.com/QuantumNous/new-api)
