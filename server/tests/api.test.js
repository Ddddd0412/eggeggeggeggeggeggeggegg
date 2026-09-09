import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../app.js';
import { resolveDueDate } from '../aiService.js';
import { isIsoDate } from '../utils.js';

async function startTestApplication(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-api-test-'));
  const app = createApplication({
    databasePath: path.join(directory, 'test.sqlite'),
    autoSeedDemo: true,
    llmMode: 'mock',
    transcriptionMode: 'mock',
    frontendOrigin: 'http://localhost:5173',
    ...overrides,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return {
    app,
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function api(baseUrl, pathname, { method = 'GET', token, body, formData, origin } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body && !formData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(formData ? { body: formData } : body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { response, payload };
}

async function login(baseUrl, email) {
  const result = await api(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: { email, password: '123456' },
  });
  assert.equal(result.response.status, 200);
  return result.payload.data;
}

test('中文相对日期以会议日期为基准解析，无法判断时不猜测', () => {
  assert.equal(resolveDueDate('下周三前', '2026-09-08'), '2026-09-16');
  assert.equal(resolveDueDate('周五', '2026-09-08'), '2026-09-11');
  assert.equal(resolveDueDate('明天', '2026-09-08'), '2026-09-09');
  assert.equal(resolveDueDate('月底前', '2026-09-08'), null);
  assert.equal(isIsoDate('2026-02-31'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
});

test('完整后端流程、角色权限、团队隔离与审计记录', async (t) => {
  const runtime = await startTestApplication();
  t.after(async () => {
    await runtime.app.close();
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  });

  const health = await api(runtime.baseUrl, '/api/health', { origin: 'http://localhost:5173' });
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.data.database, 'sqlite');
  assert.equal(health.response.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const noAuth = await api(runtime.baseUrl, '/api/tasks');
  assert.equal(noAuth.response.status, 401);
  assert.equal(noAuth.payload.error.code, 'UNAUTHORIZED');

  const leader = await login(runtime.baseUrl, 'zhangsan@example.com');
  const member = await login(runtime.baseUrl, 'lisi@example.com');
  const teacher = await login(runtime.baseUrl, 'teacher@example.com');
  assert.equal(leader.user.role, 'leader');
  assert.equal(member.user.role, 'member');
  assert.equal(teacher.user.role, 'teacher');
  assert.equal('password' in leader.user, false);

  const passwordRow = runtime.app.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('zhangsan@example.com');
  assert.notEqual(passwordRow.password_hash, '123456');
  assert.match(passwordRow.password_hash, /^scrypt\$/);

  const meetingResult = await api(runtime.baseUrl, '/api/meetings', {
    method: 'POST',
    token: leader.token,
    body: {
      title: '后端接口联调会',
      date: '2026-09-08',
      content: '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。',
    },
  });
  assert.equal(meetingResult.response.status, 201);
  const meetingId = meetingResult.payload.data.id;

  const extraction = await api(runtime.baseUrl, '/api/ai/extract', {
    method: 'POST', token: leader.token, body: { meetingId },
  });
  assert.equal(extraction.response.status, 201);
  assert.equal(extraction.payload.data.provider, 'local-mock');
  assert.equal(extraction.payload.data.drafts.length, 3);
  const [wangDraft, liDraft, groupDraft] = extraction.payload.data.drafts;
  assert.equal(wangDraft.assignee, '小王');
  assert.equal(wangDraft.deadline, '2026-09-16');
  assert.equal(liDraft.assignee, '小李');
  assert.equal(groupDraft.assignee, '待确认');
  assert.equal(groupDraft.deadline, '2026-09-11');
  assert.equal(groupDraft.needsConfirmation, true);
  assert.match(groupDraft.ambiguityReason, /负责人|全体成员/);

  const memberCannotConfirm = await api(runtime.baseUrl, '/api/tasks/confirm', {
    method: 'POST', token: member.token, body: { draftId: wangDraft.id },
  });
  assert.equal(memberCannotConfirm.response.status, 403);

  const incompleteConfirm = await api(runtime.baseUrl, '/api/tasks/confirm', {
    method: 'POST', token: leader.token, body: { draftId: groupDraft.id },
  });
  assert.equal(incompleteConfirm.response.status, 422);
  assert.equal(incompleteConfirm.payload.error.code, 'DRAFT_INCOMPLETE');

  const corrected = await api(runtime.baseUrl, `/api/ai/drafts/${groupDraft.id}`, {
    method: 'PATCH',
    token: leader.token,
    body: { title: '组织测试结果讨论', assignee: '张三', deadline: '2026-09-11', priority: '中' },
  });
  assert.equal(corrected.response.status, 200);
  assert.equal(corrected.payload.data.needsConfirmation, false);

  const confirmed = await api(runtime.baseUrl, '/api/tasks/confirm', {
    method: 'POST', token: leader.token, body: { draftId: groupDraft.id },
  });
  assert.equal(confirmed.response.status, 201);
  assert.equal(confirmed.payload.data.title, '组织测试结果讨论');
  assert.equal(confirmed.payload.data.statusCode, '待开始');
  const newTaskId = confirmed.payload.data.id;

  const memberCannotEditOthers = await api(runtime.baseUrl, `/api/tasks/${newTaskId}`, {
    method: 'PATCH', token: member.token, body: { status: '已完成' },
  });
  assert.equal(memberCannotEditOthers.response.status, 403);

  const tasksForMember = await api(runtime.baseUrl, '/api/tasks', { token: member.token });
  const ownTask = tasksForMember.payload.data.find((task) => task.assigneeId === member.user.id);
  assert.ok(ownTask);
  const memberUpdate = await api(runtime.baseUrl, `/api/tasks/${ownTask.id}`, {
    method: 'PATCH', token: member.token, body: { status: '已完成' },
  });
  assert.equal(memberUpdate.response.status, 200);
  assert.equal(memberUpdate.payload.data.progressPercent, 100);

  const forbiddenField = await api(runtime.baseUrl, `/api/tasks/${ownTask.id}`, {
    method: 'PATCH', token: member.token, body: { title: '越权修改' },
  });
  assert.equal(forbiddenField.response.status, 403);
  assert.equal(forbiddenField.payload.error.code, 'FORBIDDEN_FIELDS');

  const fakeOverdue = await api(runtime.baseUrl, `/api/tasks/${newTaskId}`, {
    method: 'PATCH', token: leader.token, body: { status: '已逾期' },
  });
  assert.equal(fakeOverdue.response.status, 422);
  assert.equal(fakeOverdue.payload.error.code, 'DERIVED_STATUS');

  const teacherCanRead = await api(runtime.baseUrl, '/api/statistics', { token: teacher.token });
  assert.equal(teacherCanRead.response.status, 200);
  assert.ok(teacherCanRead.payload.data.total >= 1);
  const teacherCannotWrite = await api(runtime.baseUrl, '/api/meetings', {
    method: 'POST', token: teacher.token,
    body: { title: '不应创建', date: '2026-09-08', content: '只读账号不能创建。' },
  });
  assert.equal(teacherCannotWrite.response.status, 403);
  assert.equal(teacherCannotWrite.payload.error.code, 'READ_ONLY_ROLE');

  const audit = await api(runtime.baseUrl, '/api/audit-logs', { token: leader.token });
  assert.equal(audit.response.status, 200);
  assert.ok(audit.payload.data.some((log) => log.entityType === 'task_draft' && log.action === 'updated'));
  assert.ok(audit.payload.data.some((log) => log.entityType === 'task' && log.action === 'created'));

  const registration = await api(runtime.baseUrl, '/api/auth/register', {
    method: 'POST',
    body: {
      username: '隔离组长', email: 'isolated@example.com', password: '654321',
      teamName: '独立测试团队', role: 'leader',
    },
  });
  assert.equal(registration.response.status, 201);
  const isolatedLogin = await api(runtime.baseUrl, '/api/auth/login', {
    method: 'POST', body: { email: 'isolated@example.com', password: '654321' },
  });
  const isolatedTasks = await api(runtime.baseUrl, '/api/tasks', { token: isolatedLogin.payload.data.token });
  assert.equal(isolatedTasks.response.status, 200);
  assert.deepEqual(isolatedTasks.payload.data, []);
});

test('录音上传经过鉴权与格式校验，模拟转写写入运行和审计记录', async (t) => {
  const runtime = await startTestApplication({
    transcriptionMockText: '这是自动化测试生成的会议转写文本。',
  });
  t.after(async () => {
    await runtime.app.close();
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  });

  const leader = await login(runtime.baseUrl, 'zhangsan@example.com');
  const teacher = await login(runtime.baseUrl, 'teacher@example.com');
  const upload = new FormData();
  upload.append('audio', new Blob(['mock-webm-audio'], { type: 'audio/webm' }), '课程周会.webm');
  upload.append('language', 'zh');
  const result = await api(runtime.baseUrl, '/api/meetings/transcribe', {
    method: 'POST', token: leader.token, formData: upload,
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.text, '这是自动化测试生成的会议转写文本。');
  assert.equal(result.payload.data.transcript, result.payload.data.text);
  assert.equal(result.payload.data.provider, 'local-mock');
  assert.equal(result.payload.data.file.name, '课程周会.webm');

  const run = runtime.app.db.prepare('SELECT * FROM transcription_runs WHERE id = ?')
    .get(result.payload.data.runId);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.transcript_text, result.payload.data.text);
  assert.equal(run.mime_type, 'audio/webm');
  assert.ok(run.size_bytes > 0);
  const audit = runtime.app.db.prepare(`
    SELECT * FROM audit_logs WHERE entity_type = 'transcription_run' AND entity_id = ?
  `).get(run.id);
  assert.equal(audit.action, 'completed');

  const invalidUpload = new FormData();
  invalidUpload.append('audio', new Blob(['not audio'], { type: 'text/plain' }), 'notes.txt');
  const invalid = await api(runtime.baseUrl, '/api/meetings/transcribe', {
    method: 'POST', token: leader.token, formData: invalidUpload,
  });
  assert.equal(invalid.response.status, 415);
  assert.equal(invalid.payload.error.code, 'UNSUPPORTED_AUDIO_FORMAT');

  const teacherUpload = new FormData();
  teacherUpload.append('audio', new Blob(['mock'], { type: 'audio/wav' }), 'readonly.wav');
  const denied = await api(runtime.baseUrl, '/api/meetings/transcribe', {
    method: 'POST', token: teacher.token, formData: teacherUpload,
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.payload.error.code, 'READ_ONLY_ROLE');
});

test('真实转写适配器使用服务端密钥并按multipart协议转发音频', async (t) => {
  let received = null;
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const webRequest = new Request('http://localhost/audio/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': request.headers['content-type'] },
      body: Buffer.concat(chunks),
    });
    const formData = await webRequest.formData();
    const file = formData.get('file');
    received = {
      authorization: request.headers.authorization,
      model: formData.get('model'),
      language: formData.get('language'),
      filename: file?.name,
      mimeType: file?.type,
      size: file?.size,
    };
    const body = JSON.stringify({ text: '真实适配器联调成功。' });
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    response.end(body);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  t.after(() => new Promise((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve()))));

  const runtime = await startTestApplication({
    transcriptionMode: 'api',
    transcriptionApiUrl: `http://127.0.0.1:${upstreamAddress.port}/v1/audio/transcriptions`,
    transcriptionApiKey: 'server-side-test-key',
    transcriptionModel: 'gpt-4o-mini-transcribe',
  });
  t.after(async () => {
    await runtime.app.close();
    fs.rmSync(runtime.directory, { recursive: true, force: true });
  });

  const leader = await login(runtime.baseUrl, 'zhangsan@example.com');
  const upload = new FormData();
  upload.append('file', new Blob(['fake-mp3-bytes'], { type: 'audio/mpeg' }), 'weekly-meeting.mp3');
  upload.append('language', 'zh');
  const result = await api(runtime.baseUrl, '/api/meetings/transcribe', {
    method: 'POST', token: leader.token, formData: upload,
  });

  assert.equal(result.response.status, 201);
  assert.equal(result.payload.data.text, '真实适配器联调成功。');
  assert.equal(result.payload.data.provider, 'openai-compatible');
  assert.deepEqual(received, {
    authorization: 'Bearer server-side-test-key',
    model: 'gpt-4o-mini-transcribe',
    language: 'zh',
    filename: 'weekly-meeting.mp3',
    mimeType: 'audio/mpeg',
    size: 14,
  });
});
