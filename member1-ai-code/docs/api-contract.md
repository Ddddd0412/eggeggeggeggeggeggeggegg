# AI 模块接口契约

## 录音转写

`POST /api/meetings/transcribe`

- Content-Type: `multipart/form-data`
- 文件字段：`audio`
- 成功响应：`{"transcript": "会议转写文字"}`
- 参数错误：HTTP 400
- 上游模型不可用：HTTP 502

## 提取任务草稿

`POST /api/meetings/{meeting_id}/extract-tasks`

请求体：

```json
{"transcript": "小王下周三前整理实验数据。"}
```

成功响应：

```json
{
  "meeting_id": 1,
  "tasks": [
    {
      "title": "整理实验数据",
      "description": "整理实验数据。",
      "assignee": "小王",
      "deadline": "下周三前",
      "priority": null,
      "source_text": "小王下周三前整理实验数据",
      "confidence": "高",
      "needs_confirmation": false,
      "confirmation_reasons": []
    }
  ],
  "pending_items": []
}
```

AI 输出始终是草稿。管理员确认、权限校验和正式任务入库由后端业务层负责。
