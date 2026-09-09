import path from 'node:path';
import { HttpError } from './utils.js';

const ALLOWED_EXTENSIONS = new Set(['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm']);

function safeFilename(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(value || 'recording.webm'));
  } catch {
    throw new HttpError(400, 'INVALID_AUDIO_FILENAME', '录音文件名不合法');
  }
  const filename = path.basename(decoded).slice(0, 200);
  const extension = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new HttpError(415, 'UNSUPPORTED_AUDIO_FORMAT', `不支持的录音格式：${extension || '无扩展名'}`);
  }
  return filename;
}

export async function transcribeAudio({ audio, filename, contentType, config }) {
  const normalizedFilename = safeFilename(filename);
  if (!config.transcriptionApiUrl || !config.transcriptionApiKey || !config.transcriptionModel) {
    throw new HttpError(503, 'TRANSCRIPTION_NOT_CONFIGURED', '语音转写服务尚未配置 API 地址、密钥或模型');
  }

  const form = new FormData();
  form.append('model', config.transcriptionModel);
  form.append('language', 'zh');
  form.append('prompt', '课程小组项目会议，可能包含前端、后端、数据库、API、JSON、GitHub、Vibe Coding 等术语。');
  form.append('file', new Blob([audio], { type: contentType || 'application/octet-stream' }), normalizedFilename);

  let response;
  try {
    response = await fetch(config.transcriptionApiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.transcriptionApiKey}` },
      body: form,
      signal: AbortSignal.timeout(config.transcriptionTimeoutMs),
    });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '语音转写请求超时' : '无法连接语音转写服务';
    throw new HttpError(502, 'TRANSCRIPTION_REQUEST_FAILED', message);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new HttpError(502, 'TRANSCRIPTION_REQUEST_FAILED', `语音转写失败（HTTP ${response.status}）`);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'INVALID_TRANSCRIPTION_RESPONSE', '语音转写服务返回了无法解析的响应');
  }
  const transcript = String(payload?.text || payload?.transcript || '').trim();
  if (!transcript) throw new HttpError(502, 'EMPTY_TRANSCRIPTION', '语音转写结果为空');
  return { transcript, model: config.transcriptionModel };
}
