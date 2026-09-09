import { createApplication } from './app.js';

const app = createApplication();

app.server.listen(app.config.port, '0.0.0.0', () => {
  console.log(`TaskFlow API 已启动：http://localhost:${app.config.port}`);
  console.log(`数据库：${app.config.databasePath}`);
  console.log(`AI模式：${app.config.llmMode}`);
  console.log(`录音转写模式：${app.config.transcriptionMode}`);
});

async function shutdown(signal) {
  console.log(`收到${signal}，正在安全关闭服务...`);
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
