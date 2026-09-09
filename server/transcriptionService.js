import path from 'node:path';
import { HttpError } from './utils.js';

const MAX_TRANSCRIPT_CHARACTERS = 100000;
const SUPPORTED_EXTENSIONS = new Set(['.flac', '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.ogg', '.wav', '.webm']);
const SUPPORTED_MIME_TYPES = new Set([
  'audio/flac',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-flac',
  'audio/x-m4a',
  'audio/x-wav',
  'application/ogg',
  'video/mp4',
  'video/webm',
]);

const MIME_BY_EXTENSION = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

function safeFilename(value) {
  const basename = path.basename(String(value || 'recording.webm'));
  const cleaned = basename.replace(/[^\p{L}\p{N}._()\- ]/gu, '_').slice(0, 180);
  return cleaned || 'recording.webm';
}

function normalizedMime(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

export function normalizeAudioUpload(file, maxBytes) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HttpError(422, 'AUDIO_REQUIRED', '请选择或录制音频后再上传');
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new HttpError(500, 'INVALID_SERVER_CONFIG', '服务端音频大小配置不正确');
  }
  if (file.size <= 0) throw new HttpError(422, 'EMPTY_AUDIO', '音频文件为空');
  if (file.size > maxBytes) {
    throw new HttpError(413, 'AUDIO_TOO_LARGE', `音频不能超过${Math.floor(maxBytes / 1024 / 1024)}MB`);
  }

  const filename = safeFilename(file.name);
  const extension = path.extname(filename).toLowerCase();
  const mimeType = normalizedMime(file.type);
  const hasSupportedExtension = SUPPORTED_EXTENSIONS.has(extension);
  const hasSupportedMime = SUPPORTED_MIME_TYPES.has(mimeType);
  if (mimeType && mimeType !== 'application/octet-stream' && !hasSupportedMime) {
    throw new HttpError(415, 'UNSUPPORTED_AUDIO_FORMAT', '不支持该音频格式，请上传mp3、wav、m4a、ogg、flac、mp4或webm');
  }
  if (!hasSupportedMime && !hasSupportedExtension) {
    throw new HttpError(415, 'UNSUPPORTED_AUDIO_FORMAT', '不支持该音频格式，请上传mp3、wav、m4a、ogg、flac、mp4或webm');
  }

  return {
    file,
    filename,
    mimeType: hasSupportedMime ? mimeType : MIME_BY_EXTENSION[extension],
    sizeBytes: Number(file.size),
  };
}

function normalizeTranscript(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(502, 'TRANSCRIPTION_EMPTY', '转写服务未返回有效文本');
  }
  const text = value.trim();
  if (text.length > MAX_TRANSCRIPT_CHARACTERS) {
    throw new HttpError(502, 'TRANSCRIPTION_TOO_LONG', '转写结果异常，请缩短录音后重试');
  }
  return text;
}

function parseMode(config) {
  const mode = String(config.transcriptionMode || 'mock').toLowerCase();
  if (!['mock', 'api'].includes(mode)) {
    throw new HttpError(500, 'INVALID_SERVER_CONFIG', 'TRANSCRIPTION_MODE只能为mock或api');
  }
  return mode;
}

async function transcribeWithApi(upload, language, config) {
  if (!config.transcriptionApiKey) {
    throw new HttpError(503, 'TRANSCRIPTION_NOT_CONFIGURED', '尚未配置转写服务密钥');
  }
  let endpoint;
  try {
    endpoint = new URL(config.transcriptionApiUrl);
  } catch {
    throw new HttpError(500, 'INVALID_SERVER_CONFIG', '转写服务地址配置不正确');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new HttpError(500, 'INVALID_SERVER_CONFIG', '转写服务地址必须使用HTTP或HTTPS');
  }

  const formData = new FormData();
  const bytes = await upload.file.arrayBuffer();
  formData.append('file', new Blob([bytes], { type: upload.mimeType }), upload.filename);
  formData.append('model', config.transcriptionModel);
  if (language && language !== 'auto') formData.append('language', language);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.transcriptionApiKey}` },
      body: formData,
      signal: AbortSignal.timeout(config.transcriptionTimeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new HttpError(504, 'TRANSCRIPTION_TIMEOUT', '转写服务响应超时，请稍后重试');
    }
    throw new HttpError(502, 'TRANSCRIPTION_UNAVAILABLE', '暂时无法连接转写服务');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, 'INVALID_TRANSCRIPTION_RESPONSE', '转写服务返回了无法解析的响应');
  }
  if (!response.ok) {
    throw new HttpError(
      502,
      'TRANSCRIPTION_UPSTREAM_ERROR',
      `上游转写请求失败（HTTP ${response.status}），请检查服务配置或稍后重试`,
    );
  }

  return {
    text: normalizeTranscript(payload.text ?? payload.transcript),
    provider: 'openai-compatible',
    model: config.transcriptionModel,
  };
}

export async function transcribeAudio(upload, language, config) {
  const mode = parseMode(config);
  if (mode === 'mock') {
    return {
      text: normalizeTranscript(config.transcriptionMockText),
      provider: 'local-mock',
      model: 'deterministic-transcription-v1',
    };
  }
  return transcribeWithApi(upload, language, config);
}

export const TRANSCRIPTION_FILE_FIELDS = ['audio', 'file', 'audioFile'];
