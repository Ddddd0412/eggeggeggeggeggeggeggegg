# REST API 接口文档

## 基本约定

- 开发地址：`http://localhost:3001`
- 前缀：`/api`
- 请求/响应：`application/json`
- 认证：`Authorization: Bearer <token>`
- 日期：`YYYY-MM-DD`
- 时间戳：ISO 8601 UTC

成功响应：

```json
{
  "success": true,
  "data": {},
  "message": ""
}
```

失败响应：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "会议标题不能为空",
    "details": { "field": "会议标题" }
  }
}
```

常见状态码：`200` 成功、`201` 创建成功、`400/422` 参数错误、`401` 未登录、`403` 无权限、`404` 不存在、`409` 状态冲突、`500/502/503` 服务端或模型错误。

## 认证

### `POST /api/auth/register`

请求：

```json
{
  "username": "王同学",
  "email": "wang@example.com",
  "password": "123456",
  "teamName": "AI课程项目组",
  "role": "member"
}
```

`role=leader` 时创建一个名称未被使用的新团队；`role=member` 时加入已有的同名团队。团队内不允许无法区分的同名成员。

### `POST /api/auth/login`

请求：

```json
{ "email": "zhangsan@example.com", "password": "123456" }
```

响应数据：

```json
{
  "token": "随机会话令牌",
  "expiresAt": "2026-09-09T12:00:00.000Z",
  "user": {
    "id": 1,
    "name": "张三",
    "email": "zhangsan@example.com",
    "systemRole": "student",
    "teamId": 1,
    "teamName": "AI课程项目组",
    "role": "leader"
  }
}
```

### `GET /api/auth/me`

返回当前登录用户的公开资料。

### `POST /api/auth/logout`

删除当前会话，使 token 立即失效。

## 团队

### `GET /api/team/members`

返回当前团队成员：

```json
[
  { "id": 1, "name": "张三", "email": "zhangsan@example.com", "role": "leader" },
  { "id": 2, "name": "李四", "email": "lisi@example.com", "role": "member" }
]
```

教师/助教可使用 `?teamId=1` 选择查看团队；学生传入该参数不会越过自己的团队范围。

## 会议纪要

| 方法和路径 | 权限 | 说明 |
|---|---|---|
| `GET /api/meetings` | 三类角色 | 查询当前团队会议 |
| `GET /api/meetings/:id` | 三类角色 | 查询一条会议 |
| `POST /api/meetings` | 组长、组员 | 新增会议 |
| `PATCH /api/meetings/:id` | 组长；原录入组员 | 修改会议 |
| `DELETE /api/meetings/:id` | 组长；原录入组员 | 软删除会议 |

### `POST /api/meetings/transcribe`

权限：组长、组员。请求体直接传输录音二进制数据，并设置：

```http
Content-Type: audio/mp4
X-Audio-Filename: %E4%BC%9A%E8%AE%AE%E5%BD%95%E9%9F%B3.m4a
Authorization: Bearer <token>
```

支持 FLAC、MP3、MP4、M4A、OGG、WAV 和 WebM，最大 25MB。后端使用 `TRANSCRIPTION_*` 环境变量调用转写服务，前端不会获得 API 密钥。

```json
{
  "success": true,
  "data": {
    "transcript": "小王周五前完成接口联调。",
    "model": "gpt-4o-mini-transcribe"
  },
  "message": "录音转写完成"
}
```

新增/修改请求：

```json
{
  "title": "第4次项目周会",
  "date": "2026-09-08",
  "content": "下周三前，小王整理实验数据。"
}
```

## AI 提取与草稿

### `POST /api/ai/extract`

权限：组长、组员。请求只提交已保存会议的 ID：

```json
{ "meetingId": 3 }
```

响应数据：

```json
{
  "extractionRunId": 1,
  "provider": "local-mock",
  "model": "deterministic-rule-v1",
  "promptVersion": "task-extraction-v2",
  "drafts": [
    {
      "id": 1,
      "meetingId": 3,
      "title": "整理实验数据",
      "assigneeId": 3,
      "assignee": "小王",
      "deadline": "2026-09-16",
      "priority": "未指定",
      "sourceText": "小王整理实验数据",
      "needsConfirmation": false,
      "ambiguityReason": "",
      "status": "待确认"
    }
  ]
}
```

### `GET /api/ai/drafts`

返回当前团队最近一次成功提取且未拒绝的草稿。可加 `?meetingId=3` 查询指定会议的最近一次结果。

### `PATCH /api/ai/drafts/:id`

权限：仅组长。允许字段：

```json
{
  "title": "整理并核对实验数据",
  "assignee": "小王",
  "deadline": "2026-09-16",
  "priority": "高",
  "sourceText": "小王整理实验数据"
}
```

后端会重新校验团队成员、日期和原文依据，并把字段变化写入 `audit_logs`。

### `DELETE /api/ai/drafts/:id`

权限：仅组长。业务含义为“拒绝草稿”，数据库保留记录用于分析 AI 错误。

### `GET /api/ai/extractions`

权限：组长、教师/助教。返回最近 100 次提取的提供方、模型、提示词版本、状态、错误和草稿数。

## 正式任务

### `POST /api/tasks/confirm`

权限：仅组长。

```json
{ "draftId": 1 }
```

确认要求：草稿仍为待确认、负责人属于当前团队、截止日期明确、原文依据有效且未重复确认。成功后创建状态为“待开始”的正式任务。

### `GET /api/tasks`

权限：三类角色。返回当前团队未删除、未取消的正式任务。关键字段：

```json
{
  "id": 10,
  "title": "整理并核对实验数据",
  "assigneeId": 3,
  "assignee": "小王",
  "deadline": "2026-09-16",
  "priority": "高",
  "status": "已逾期",
  "statusCode": "进行中",
  "isOverdue": true,
  "progressPercent": 50,
  "sourceText": "小王整理实验数据"
}
```

`status` 是页面展示状态；`statusCode` 是数据库基础状态。若任务逾期，更新时仍提交 `statusCode`，不能提交“已逾期”。

### `POST /api/tasks`

权限：仅组长。用于手工创建正式任务：

```json
{
  "title": "补充接口时序图",
  "assignee": "张三",
  "deadline": "2026-09-20",
  "priority": "中",
  "status": "待开始",
  "progressPercent": 0,
  "description": "补充到接口文档"
}
```

### `PATCH /api/tasks/:id`

组长可提交：`title`、`description`、`assignee/assigneeId`、`deadline`、`priority`、`status`、`progressPercent`。

组员仅可对自己负责的任务提交：

```json
{ "status": "进行中", "progressPercent": 40 }
```

状态为“已完成”时，后端自动把进度设为 100；进度为 100 且没有显式状态时，后端自动设为“已完成”。

### `GET /api/tasks/:id`

返回单个任务。

### `DELETE /api/tasks/:id`

权限：仅组长。执行软删除并写审计日志。

## 统计与审计

### `GET /api/statistics`

返回：

```json
{
  "total": 10,
  "completed": 3,
  "unfinished": 7,
  "overdue": 2,
  "completionRate": 30,
  "statusCounts": [
    { "status": "待开始", "count": 3 },
    { "status": "进行中", "count": 2 },
    { "status": "已完成", "count": 3 },
    { "status": "已逾期", "count": 2 }
  ],
  "memberStats": [
    { "id": 1, "name": "张三", "total": 3, "completed": 1, "overdue": 0 }
  ],
  "generatedAt": "2026-09-08T12:00:00.000Z"
}
```

统计实时查询数据库，不使用前端缓存。

### `GET /api/audit-logs?limit=100`

权限：组长、教师/助教。`limit` 最大 500。返回实体、动作、字段、修改前后值、操作人和时间。

## 健康检查

### `GET /api/health`

无需登录，返回服务、数据库和 AI 模式状态。可用于部署健康检查，但不会暴露密钥。
