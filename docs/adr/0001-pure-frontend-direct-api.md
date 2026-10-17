# 纯前端直连 Agnes API，不引入本地后端

Agnes API 的 `POST /v1/videos` 与 `GET /agnesapi` 两个端点的 CORS 预检均返回 `204` 且带 `access-control-allow-origin: *`、`access-control-allow-headers: *`（2026-10-17 实测），因此浏览器可以直接调用，无需 Node/Express 代理层。代价是 API Key 必须存在于浏览器侧——文档建议"不要在客户端代码中暴露 API Key"，本项目**有意违反**该建议：这是个人本地自用工具，Key 由用户自己持有，写在没有后端的本地工具里不构成额外风险，而引入代理层会带来进程管理、端口冲突和跨域配置的额外故障面。若将来需要分享给他人使用，这个决定必须被推翻（`superseded`），改由一个服务端持有 Key。

**Considered Options**

- 本地 Node 代理：能守住 Key，但需要额外进程、端口协商、打包时还要处理子进程生命周期。
- Electron / Tauri 主进程代发请求：同样能守住 Key，但当前机器缺少 MSVC 与 MinGW，Tauri 链不出可执行文件。

**Consequences**

- `docs/agents/issue-tracker.md` 所示的本地静态服务只做文件托管，不参与任何 API 调用。
- 任何"把 Key 挪到服务端"的改造都属于推翻本 ADR，需要新写一篇而非就地修改。
