import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../app.js';
import { extractTaskDrafts, PROMPT_VERSION, resolveDueDate } from '../aiService.js';
import { isIsoDate } from '../utils.js';

async function startTestApplication() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-api-test-'));
  const app = createApplication({
    databasePath: path.join(directory, 'test.sqlite'),
    autoSeedDemo: true,
    llmMode: 'mock',
    frontendOrigin: 'http://localhost:5173',
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return {
    app,
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function api(baseUrl, pathname, { method = 'GET', token, body, origin } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

test('AI mock 与成员1规则一致：过滤待定、笼统、否定和已完成事项', async () => {
  const extraction = await extractTaskDrafts({
    meetingDate: '2026-09-08',
    members: [{ id: 1, name: '小张' }],
    content: [
      '下次可能增加数据分析模块，具体谁做之后再商量。',
      '大家尽快完善系统。',
      '小张不用再修改PPT。',
      '小张已经完成接口文档。',
      '小张周五检查登录页面。',
    ].join(''),
  }, { llmMode: 'mock' });

  assert.equal(PROMPT_VERSION, 'task-extraction-v2');
  assert.equal(extraction.tasks.length, 1);
  assert.match(extraction.tasks[0].title, /检查登录页面/);
  assert.equal(extraction.tasks[0].assigneeText, '小张');
  assert.equal(extraction.tasks[0].dueDate, '2026-09-11');
});

test('“尽快”不会被推断为高优先级', async () => {
  const extraction = await extractTaskDrafts({
    meetingDate: '2026-09-08',
    members: [{ id: 1, name: '小张' }],
    content: '小张尽快整理测试数据。',
  }, { llmMode: 'mock' });

  assert.equal(extraction.tasks.length, 1);
  assert.equal(extraction.tasks[0].priority, '未指定');
  assert.equal(extraction.tasks[0].needsConfirmation, true);
  assert.match(extraction.tasks[0].ambiguityReason, /截止时间/);
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
