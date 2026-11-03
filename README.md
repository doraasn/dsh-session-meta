# 会话概览（dsh-session-meta）

鼠标悬停左侧会话列表里的任意会话，在该会话的悬浮卡里补一段统计：

```
创建   10-19 10:38
结束   11-02 18:01
模型   3 个 · deepseek-v4.1-flash、kimi-k3、GLM-5.2
Token  1.23M
```

- **创建 / 结束**：会话头里的 `createdAt` 与日志里最后一条事件的时间。
- **模型**：会话里出现过的模型（`assistant/message` 的 provider/model），括号里的调用次数在悬浮提示里。
- **Token**：所有模型调用 `usage` 的累计值；悬浮提示给出输入 / 输出 / 缓存命中的精确数字。

## 数据来源与口径

统计数据全部由 Host 从会话日志推导（`ctx.sessionQuery.readSession`），不写任何新事件、不改会话文件。

- 只统计模型调用（`assistant/message`）上记录的 `usage`，工具调用、标题生成等没有 usage 的事件不计。
- 单次调用的 token 取 `totalTokens`；上游没给时退回 `inputTokens + outputTokens`。
- 一个模型被多个供应商调用时，按 `供应商/模型` 分开计数；「N 个」按模型名去重。
- 子代理会话是独立会话，各自有自己的悬浮卡，不汇总到父会话。

## 性能

每个会话第一次 hover 要读一遍完整日志（大归档会话可能需要一两秒，卡片先显示「统计中…」），
之后走进程内缓存；该会话有新事件写入时缓存自动失效。缓存最多保留 300 个会话。

## 安装

```powershell
dsh plugin --profile <profile> add "file:C:/Projects/work/dsh-plugins/dsh-session-meta"
```

或从插件市场索引安装（发布后）：

```powershell
dsh plugin --profile <profile> add https://github.com/doraasn/dsh-session-meta
```

## 语言

跟随界面语言（中文 / English），文案写死在 Client 模块里，无额外配置。

## 限制

- 只在本机 Host 内统计，不跨机器。
- 历史会话的统计以日志里保存的 `usage` 为准；日志里没记 usage 的旧调用（例如被压缩掉的段）不计入。
- 未在运行中的归档会话首次统计较慢，见「性能」。

## License

MIT
