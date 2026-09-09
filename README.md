# 基于大语言模型的课程小组会议纪要任务提取与协同管理系统

这是一个可直接用于课程演示的 React + Node.js + SQLite 全栈项目。会议纪要先由 AI 转换为任务草稿，只有组长人工核对并确认后，任务才会进入团队看板。

## 已实现功能

- 注册、登录、退出和基于随机令牌的会话认证
- 团队创建/加入及组长、组员、教师/助教三类权限
- 会议纪要新增、查询、修改和软删除
- 浏览器录音、音频试听、文件上传和服务端语音转写
- AI 任务草稿提取、原文依据校验和相对日期解析
- 草稿人工修改、拒绝、确认及正式任务创建
- 团队任务看板、个人任务、状态/进度更新和软删除
- 完成率、逾期数、成员负载和状态分布统计
- AI 提取运行记录与人工修改审计日志
- SQLite 迁移、演示数据脚本和后端自动化测试

## 技术栈

- 前端：React 18、Vite 5、React Router、Chart.js
- 后端：Node.js 原生 HTTP 服务（无后端第三方依赖）
- 数据库：Node.js 原生 `node:sqlite` + SQLite
- 认证：`scrypt` 密码哈希、服务端哈希保存的随机 Bearer Token
- AI：任务提取与语音转写均提供离线演示模式，也可分别切换到 OpenAI-compatible API

## 环境要求

- Node.js 22.5 或更高版本（项目使用原生 `node:sqlite`）
- npm

## 第一次运行

```bash
cp .env.example .env
npm install
npm run db:setup
```

开发时打开两个终端：

```bash
# 终端1：后端，默认 http://localhost:3001
npm run server
```

```bash
# 终端2：前端，默认 http://localhost:5173
npm run dev
```

浏览器访问 `http://localhost:5173`。Vite 会把 `/api` 请求代理到 3001 端口。

> `npm run server` 默认也会自动执行数据库迁移并补充演示数据，所以忘记运行 `db:setup` 也不会阻塞首次启动。

## 演示账号

| 身份 | 邮箱 | 密码 | 主要权限 |
|---|---|---|---|
| 组长 | `zhangsan@example.com` | `123456` | 编辑/确认草稿、管理全部任务 |
| 组员 | `lisi@example.com` | `123456` | 查看团队数据、更新自己的任务 |
| 教师/助教 | `teacher@example.com` | `123456` | 只读查看会议、任务、统计和记录 |

演示团队为“AI课程项目组”。另有小王、小李演示成员，密码同为 `123456`。

## AI 模式

默认配置 `LLM_MODE=mock`，无需密钥即可稳定演示完整流程。该模式只用于本地开发和答辩兜底，也会经过与真实模型结果相同的后端校验。

接入真实模型时修改 `.env`：

```dotenv
LLM_MODE=api
LLM_API_URL=https://你的服务地址/v1/chat/completions
LLM_API_KEY=只保存在后端的密钥
LLM_MODEL=你的模型名
```

密钥不会发送给浏览器，也不会写入数据库或日志。系统只在用户点击“AI提取任务”时调用一次模型，并把输入快照、模型响应和结构化草稿保存在数据库中。

## 录音转写

会议纪要页支持直接使用浏览器麦克风录音，也支持选择 `mp3/wav/m4a/ogg/flac/mp4/webm` 文件。音频上传到 `POST /api/meetings/transcribe` 后，由后端鉴权、校验并调用转写服务，转写文字会自动填入会议纪要供人工核对。

默认 `TRANSCRIPTION_MODE=mock`，无需网络和密钥即可演示完整交互。启用真实转写时修改 `.env`：

```dotenv
TRANSCRIPTION_MODE=api
TRANSCRIPTION_API_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIPTION_API_KEY=只保存在后端的密钥
TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
TRANSCRIPTION_LANGUAGE=zh
TRANSCRIPTION_TIMEOUT_MS=60000
TRANSCRIPTION_MAX_BYTES=26214400
```

如果 `TRANSCRIPTION_API_KEY` 留空，后端会复用 `LLM_API_KEY`。原始音频只在内存中转发，不写入数据库；数据库仅记录文件元数据、运行状态、转写文本和审计日志。真实密钥不得放入任何 `VITE_*` 配置。

## 测试与生产运行

```bash
# 后端自动化测试
npm run test:backend

# 构建前端
npm run build

# 生产模式：先构建，再启动后端；后端会同时托管 dist
npm run server
```

## 目录说明

```text
meeting-task-system/
├── server/
│   ├── migrations/          # SQLite 建表迁移
│   ├── scripts/             # 迁移和演示数据命令
│   ├── tests/               # API 自动化测试
│   ├── aiService.js         # 提示词、模型调用、结果校验
│   ├── transcriptionService.js # 音频校验和转写服务适配
│   ├── app.js               # REST API 和业务权限
│   ├── auth.js              # 密码与会话认证
│   └── database.js          # 数据库初始化和演示数据
├── src/                     # React 前端
├── docs/                    # 成员3的全部课程交付文档
├── .env.example             # 配置模板，不含真实密钥
└── package.json
```

## 成员3文档入口

- [录音转写优化说明（从这里开始）](docs/录音转写优化说明.md)
- [成员3一步一步实施指南](docs/成员3一步一步实施指南.md)
- [数据库设计](docs/数据库设计.md)
- [REST API 接口文档](docs/API接口文档.md)
- [可直接执行的接口联调示例](docs/接口联调示例.http)
- [权限设计](docs/权限设计.md)
- [AI 接口与输出校验](docs/AI接口与校验规则.md)
- [测试报告](docs/测试报告.md)
- [部署说明](docs/部署说明.md)
- [Vibe Coding 开发记录](docs/Vibe-Coding开发记录.md)
- [成员3答辩讲解提纲](docs/成员3答辩讲解提纲.md)
