export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendJson(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(body);
}

export function sendSuccess(response, data, message = '', status = 200, headers = {}) {
  sendJson(response, status, { success: true, data, message }, headers);
}

export function sendError(response, error, headers = {}) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof HttpError ? error.message : '服务器处理请求时发生错误';
  const details = error instanceof HttpError ? error.details : undefined;
  sendJson(response, status, {
    success: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  }, headers);
}

export async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体必须是合法JSON');
  }
}

export async function readMultipartFormData(request, maxBytes = 25 * 1024 * 1024) {
  const contentType = String(request.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用multipart/form-data上传音频');
  }

  const contentLength = Number(request.headers['content-length']);
  const envelopeAllowance = 512 * 1024;
  if (Number.isFinite(contentLength) && contentLength > maxBytes + envelopeAllowance) {
    throw new HttpError(413, 'AUDIO_TOO_LARGE', '音频文件过大');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes + envelopeAllowance) {
      throw new HttpError(413, 'AUDIO_TOO_LARGE', '音频文件过大');
    }
    chunks.push(chunk);
  }

  try {
    const webRequest = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: Buffer.concat(chunks),
    });
    return await webRequest.formData();
  } catch {
    throw new HttpError(400, 'INVALID_MULTIPART', '无法解析上传内容，请重新选择音频');
  }
}

export function requireText(value, fieldName, maxLength = 255) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${fieldName}不能为空`, { field: fieldName });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${fieldName}不能超过${maxLength}个字符`, { field: fieldName });
  }
  return normalized;
}

export function optionalText(value, maxLength = 255) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(422, 'VALIDATION_ERROR', '字段类型不正确');
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new HttpError(422, 'VALIDATION_ERROR', `字段不能超过${maxLength}个字符`);
  return normalized || null;
}

export function parsePositiveInteger(value, fieldName = 'id') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'INVALID_ID', `${fieldName}必须是正整数`);
  }
  return parsed;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function corsHeaders(request, allowedOrigin) {
  const origin = request.headers.origin;
  const allowOrigin = origin && [allowedOrigin, 'http://127.0.0.1:5173'].includes(origin)
    ? origin
    : allowedOrigin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  };
}

export function toPublicErrorMessage(error) {
  if (error instanceof HttpError) return error.message;
  return '未知错误';
}
