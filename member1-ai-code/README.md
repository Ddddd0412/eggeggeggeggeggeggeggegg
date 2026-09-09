# 成员1：会议AI模块

该目录包含成员1需要提交给小组的AI代码：录音转写、会议文本转任务草稿、结构校验和后端路由。

## 接入方式

1. 安装依赖：`pip install -r requirements.txt`
2. 将 `.env.example` 复制为 `.env`，由后端启动环境加载变量。
3. 在现有 Flask 应用中注册蓝图：

```python
from meeting_ai.routes import meeting_ai_bp

app.register_blueprint(meeting_ai_bp)
```

4. 确保运行时能找到 `src` 目录，例如设置 `PYTHONPATH=src`。

接口字段约定见 `docs/api-contract.md`，标准输出结构见
`docs/output-schema.json`。

## 接口

- `POST /api/meetings/transcribe`：以 multipart/form-data 上传字段名为 `audio` 的录音。
- `POST /api/meetings/<meeting_id>/extract-tasks`：JSON 请求体为 `{"transcript": "会议文字"}`。

模型返回的是任务草稿。人工确认与数据库入库由后端业务模块实现，不能在AI提取后自动发布。

## 测试

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
```

当前 10 项测试只验证数据结构和一致性规则，不调用模型 API，
不产生 API 费用。

## 安全

不要提交 `.env` 或真实 API 密钥。前端只能调用本项目的后端接口，不能直接调用模型服务。
