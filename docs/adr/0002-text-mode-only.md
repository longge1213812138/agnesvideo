# 只实现 text 模式

`mode` 在文档中有 `text`、`keyframe`、`reference` 三个取值。本项目只实现 `text`，其余两个模式的界面与参数完全不做。原因是 `keyframe` 要求 `first_frame`/`last_frame`，`reference` 要求 `images`/`audios`，四者都只接受**可被 Agnes 服务端公开访问的 URL**——个人本地自用没有图床，用户手上的本地图片必须先上传到公网才能用，这条链路的存在感远超它带来的价值。请求体构造层保留 `mode` 字段并默认 `"text"`，所以将来接入另外两个模式时不需要重构传输层。

**Considered Options**

- 三模式全做：完整覆盖文档，但要额外做 URL 输入、`<Picture N>` 占位符提示、≤5 图 / ≤3 音频的本地校验，而这些在无图床时是死代码。
- 做 `text` + `keyframe`：`keyframe` 同样受制于公网 URL 前提。

**Consequences**

- 所有 `reference` / `keyframe` 相关的 400 错误码（`images length must not exceed 5`、`audios length must not exceed 3`、`videos is not supported`、`size must be 720P`）在正常流程中不可能出现；但错误映射表仍然保留它们，因为这是对外部接口的防御，不是死代码。
