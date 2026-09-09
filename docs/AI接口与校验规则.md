# AI 接口与输出校验规则

AI 的职责是把会议原文转换为“可供人确认的建议”，而不是替团队作决定。实现文件为 `server/aiService.js`，提示词版本为 `task-extraction-v1`。

## 调用时机

只有以下两个用户动作允许调用模型：

1. 首次点击“AI提取任务”；
2. 明确点击重新提取。

查看页面、刷新页面或确认任务都读取已保存结果，不重复调用模型。每次调用先创建 `extraction_runs`，成功和失败都可追踪。

## 输入上下文

后端向模型提供：

- 会议日期：解析“下周三”等相对时间的唯一基准；
- 当前团队成员精确姓名列表：限制负责人候选；
- 数据库中保存的会议原文：不能信任浏览器临时传入的文本；
- JSON 结构、禁止编造和原文引用规则。

## 目标 JSON

```json
{
  "tasks": [
    {
      "title": "整理实验数据",
      "assignee": "小王",
      "due_date_text": "下周三前",
      "due_date": "2026-09-16",
      "priority": "未指定",
      "source_quote": "小王整理实验数据",
      "needs_confirmation": false,
      "ambiguity_reason": ""
    }
  ]
}
```

## 提示词核心规则

```text
你是课程小组任务抽取助手。只提取会议中明确要求执行的行动项，不作任何业务决定。
负责人只能使用成员名单中的精确姓名；不得补写原文没有的信息；
日期以会议日期为基准；不明确则留空并标记 needs_confirmation；
source_quote 必须逐字来自原文；只返回指定 JSON。
```

完整动态提示词由 `buildPrompt` 生成，不在前端暴露。`temperature=0` 用于减少同一纪要多次提取的随机差异。

## 服务端二次校验

模型返回 JSON 后不能直接写正式任务，后端逐条执行：

| 字段 | 校验规则 | 失败处理 |
|---|---|---|
| `title` | 非空，最长 200 字符 | 丢弃空任务或截断异常超长内容 |
| `assignee` | 必须精确匹配当前团队成员 | `assignee_id=null`，标记待确认 |
| `due_date` | 必须为真实存在的 `YYYY-MM-DD` | 尝试解析 `due_date_text`，仍失败则待确认 |
| `priority` | 只允许高/中/低/未指定 | 归一化为受控枚举 |
| `source_quote` | 必须为会议原文的连续子串 | 标记待确认，确认接口继续阻止无依据任务 |
| JSON 外层 | 必须包含 `tasks` 数组 | 本次运行失败，返回 502，不创建半成品 |

人工修正后会重复校验，并写入审计日志。只有负责人、截止日期和原文依据都有效，组长才能确认。

## 相对日期解析

系统支持明确表达：

- 今天、明天、后天；
- 本周一至周日、下周一至周日；
- 无前缀的“周五”（取会议日之后最近的周五）；
- `YYYY-MM-DD`、`YYYY年M月D日`、`M月D日`。

如“月底前”“尽快”“过几天”等没有唯一日期的表达，系统返回空日期并要求人工确认，不自行猜测。

## “大家”为什么不能自动分配

输入“大家周五讨论测试结果”时，系统可以提取“讨论测试结果”和“周五”，但“大家”不是单一负责人。输出会保存原始表达“全体成员”，正式负责人保持待确认，并给出“需由组长拆分或指定负责人”的原因。

## Mock 与真实 API

| 模式 | 配置 | 用途 |
|---|---|---|
| 本地规则 | `LLM_MODE=mock` | 无密钥稳定演示、离线开发、自动化测试 |
| 真实模型 | `LLM_MODE=api` | 调用 OpenAI-compatible Chat Completions 接口 |

两种模式共享相同的输出校验和数据库流程。Mock 不是前端假数据，而是运行在后端、输入真实数据库会议并生成真实草稿记录的确定性提取器。

真实模式配置：

```dotenv
LLM_MODE=api
LLM_API_URL=https://服务地址/v1/chat/completions
LLM_API_KEY=your-secret-key
LLM_MODEL=your-model-name
LLM_TIMEOUT_MS=30000
```

不要把真实密钥提交到 Git，不要写入 `vite.config.js` 或任何 `VITE_*` 变量；Vite 变量会被打包到浏览器。

## 质量复盘指标

可以把 `task_drafts.original_payload_json` 与 `audit_logs` 结合，统计：

- 任务遗漏率：人工补建但 AI 未提取的任务数；
- 负责人修正率；
- 截止日期修正率；
- 虚构原文比例；
- 直接确认率；
- 不同提示词版本的修正次数。

这些数据正是项目“复盘 AI 容易出错的内容”的证据。

## 录音转写接口

语音转写与任务提取是两个独立步骤：先把音频转换成可编辑文字，由用户核对会议纪要；保存后再执行结构化任务提取。这样不会让语音识别误差直接变成正式任务。

`POST /api/meetings/transcribe` 的服务端流程：

1. 先校验登录状态、团队和只读角色；
2. 解析 multipart 上传，并限制为支持格式和最多 25 MiB；
3. 创建 `transcription_runs` 的 `pending` 记录；
4. `mock` 模式返回确定性示例文字，`api` 模式由后端转发给转写服务；
5. 成功后保存转写文本并记录 `completed` 审计，失败则保存安全错误和 `failed` 审计；
6. 原始音频始终不落库，API Key 始终不返回前端。

真实模式配置：

```dotenv
TRANSCRIPTION_MODE=api
TRANSCRIPTION_API_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIPTION_API_KEY=your-server-side-key
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
TRANSCRIPTION_LANGUAGE=zh
```

前端不自行设置 multipart 的 `Content-Type`；由浏览器根据 `FormData` 生成包含 boundary 的请求头。后端响应同时返回 `text` 和 `transcript`，兼容不同前端分支的字段命名。
