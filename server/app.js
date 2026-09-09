import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildConfig, projectRoot } from './config.js';
import { openDatabase, runMigrations, seedDemoData, withTransaction } from './database.js';
import {
  authenticate,
  createSession,
  getBearerToken,
  hashPassword,
  requireLeader,
  requireStudentWrite,
  requireTeamAccess,
  revokeSession,
  serializeUser,
  verifyPassword,
} from './auth.js';
import { extractTaskDrafts, PROMPT_VERSION } from './aiService.js';
import { normalizeAudioUpload, transcribeAudio, TRANSCRIPTION_FILE_FIELDS } from './transcriptionService.js';
import {
  corsHeaders,
  HttpError,
  isIsoDate,
  nowIso,
  optionalText,
  parsePositiveInteger,
  readJsonBody,
  readMultipartFormData,
  sendError,
  sendSuccess,
  requireText,
  toPublicErrorMessage,
} from './utils.js';

const PRIORITIES = new Set(['高', '中', '低', '未指定']);
const TASK_STATUSES = new Set(['待开始', '进行中', '已完成', '已取消']);
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function serveFrontend(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const distDirectory = path.join(projectRoot, 'dist');
  const indexPath = path.join(distDirectory, 'index.html');
  if (!fs.existsSync(indexPath)) return false;
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'INVALID_PATH', '请求路径不合法');
  }
  const candidate = path.resolve(distDirectory, `.${requestedPath}`);
  if (candidate !== distDirectory && !candidate.startsWith(`${distDirectory}${path.sep}`)) {
    throw new HttpError(400, 'INVALID_PATH', '请求路径不合法');
  }
  const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : indexPath;
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (request.method === 'HEAD') response.end();
  else response.end(body);
  return true;
}

function normalizeEmail(value) {
  const email = requireText(value, '邮箱', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, 'VALIDATION_ERROR', '邮箱格式不正确', { field: 'email' });
  }
  return email;
}

function makeJoinCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

function getTeamId(db, user, url) {
  if (user.systemRole !== 'teacher') {
    if (!user.teamId) throw new HttpError(403, 'NO_TEAM', '当前账号尚未加入团队');
    return Number(user.teamId);
  }

  const requestedId = url.searchParams.get('teamId');
  if (requestedId) {
    const teamId = parsePositiveInteger(requestedId, 'teamId');
    const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
    if (!team) throw new HttpError(404, 'TEAM_NOT_FOUND', '团队不存在');
    return teamId;
  }

  const firstTeam = db.prepare('SELECT id FROM teams ORDER BY id LIMIT 1').get();
  if (!firstTeam) throw new HttpError(404, 'TEAM_NOT_FOUND', '系统中暂无团队');
  return Number(firstTeam.id);
}

function addAudit(db, { teamId, userId, entityType, entityId, action, fieldName = null, oldValue = null, newValue = null }) {
  db.prepare(`
    INSERT INTO audit_logs (
      team_id, user_id, entity_type, entity_id, action, field_name,
      old_value, new_value, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    teamId,
    userId,
    entityType,
    entityId,
    action,
    fieldName,
    oldValue === null || oldValue === undefined ? null : String(oldValue),
    newValue === null || newValue === undefined ? null : String(newValue),
    nowIso(),
  );
}

function requireLeaderOrTeacher(user) {
  if (user.systemRole !== 'teacher' && user.role !== 'leader') {
    throw new HttpError(403, 'FORBIDDEN', '仅组长或教师/助教可以查看该记录');
  }
}

function getMeetingRow(db, meetingId) {
  return db.prepare(`
    SELECT m.*, u.name AS creator_name
    FROM meetings m
    JOIN users u ON u.id = m.created_by
    WHERE m.id = ? AND m.deleted_at IS NULL
  `).get(meetingId);
}

function serializeMeeting(row) {
  return {
    id: Number(row.id),
    title: row.title,
    date: row.meeting_date,
    content: row.content,
    teamId: Number(row.team_id),
    createdBy: row.creator_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getDraftRow(db, draftId) {
  return db.prepare(`
    SELECT
      d.*, m.team_id, m.title AS meeting_title, m.content AS meeting_content,
      u.name AS assignee_name
    FROM task_drafts d
    JOIN meetings m ON m.id = d.meeting_id AND m.deleted_at IS NULL
    LEFT JOIN users u ON u.id = d.assignee_id
    WHERE d.id = ?
  `).get(draftId);
}

function serializeDraft(row) {
  return {
    id: Number(row.id),
    extractionRunId: Number(row.extraction_run_id),
    meetingId: Number(row.meeting_id),
    meetingTitle: row.meeting_title,
    title: row.title,
    assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
    assignee: row.assignee_name || '待确认',
    assigneeText: row.assignee_text || '',
    deadline: row.due_date || '待确认',
    deadlineText: row.due_date_text || '',
    priority: row.priority,
    sourceText: row.source_quote,
    needsConfirmation: Boolean(row.needs_confirmation),
    ambiguityReason: row.ambiguity_reason || '',
    status: row.draft_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getTaskRow(db, taskId) {
  return db.prepare(`
    SELECT
      t.*, u.name AS assignee_name, m.title AS meeting_title
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_id
    LEFT JOIN meetings m ON m.id = t.meeting_id
    WHERE t.id = ? AND t.deleted_at IS NULL
  `).get(taskId);
}

function displayTaskStatus(row, today = new Date().toISOString().slice(0, 10)) {
  if (row.status !== '已完成' && row.status !== '已取消' && row.due_date && row.due_date < today) {
    return '已逾期';
  }
  return row.status;
}

function serializeTask(row) {
  const status = displayTaskStatus(row);
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    meetingId: row.meeting_id === null ? null : Number(row.meeting_id),
    meetingTitle: row.meeting_title || null,
    sourceDraftId: row.source_draft_id === null ? null : Number(row.source_draft_id),
    title: row.title,
    description: row.description || '',
    assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
    assignee: row.assignee_name || '待分配',
    deadline: row.due_date || '',
    priority: row.priority,
    status,
    statusCode: row.status,
    isOverdue: status === '已逾期',
    progressPercent: Number(row.progress_percent),
    sourceText: row.source_quote || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listTeamMembers(db, teamId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, tm.team_role
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ?
    ORDER BY CASE tm.team_role WHEN 'leader' THEN 0 ELSE 1 END, u.id
  `).all(teamId).map((row) => ({
    id: Number(row.id),
    name: row.name,
    email: row.email,
    role: row.team_role,
  }));
}

function getMemberByName(db, teamId, name) {
  if (!name || name === '待确认' || name === '待分配') return null;
  return db.prepare(`
    SELECT u.id, u.name
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ? AND u.name = ?
  `).get(teamId, name);
}

function validatePriority(value) {
  const priority = value || '未指定';
  if (!PRIORITIES.has(priority)) {
    throw new HttpError(422, 'VALIDATION_ERROR', '优先级只能为高、中、低或未指定');
  }
  return priority;
}

function validateStatus(value) {
  if (value === '已逾期') {
    throw new HttpError(422, 'DERIVED_STATUS', '“已逾期”由系统根据截止日期自动计算，不能手动设置');
  }
  if (!TASK_STATUSES.has(value)) {
    throw new HttpError(422, 'VALIDATION_ERROR', '任务状态不合法');
  }
  return value;
}

function validateDueDate(value, fieldName = '截止日期') {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === '待确认') return null;
  if (!isIsoDate(value)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${fieldName}必须是YYYY-MM-DD格式`);
  }
  return value;
}

function normalizeSqliteError(error) {
  if (error instanceof HttpError) return error;
  const message = String(error?.message || '');
  if (message.includes('users.email')) return new HttpError(409, 'EMAIL_EXISTS', '该邮箱已被注册');
  if (message.includes('teams.name')) return new HttpError(409, 'TEAM_EXISTS', '该团队名称已存在');
  if (message.includes('teams.join_code')) return new HttpError(409, 'JOIN_CODE_EXISTS', '团队邀请码冲突，请重试');
  return error;
}

async function handleRegister(db, request, response) {
  const body = await readJsonBody(request);
  const name = requireText(body.username ?? body.name, '用户名', 50);
  const email = normalizeEmail(body.email);
  const password = requireText(body.password, '密码', 128);
  const teamName = requireText(body.teamName, '团队名称', 100);
  const role = body.role;
  if (password.length < 6) throw new HttpError(422, 'WEAK_PASSWORD', '密码至少需要6个字符');
  if (!['leader', 'member'].includes(role)) throw new HttpError(422, 'VALIDATION_ERROR', '角色只能为组长或组员');

  const created = withTransaction(db, () => {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'EMAIL_EXISTS', '该邮箱已被注册');
    }
    const now = nowIso();
    const userResult = db.prepare(`
      INSERT INTO users (name, email, password_hash, system_role, created_at, updated_at)
      VALUES (?, ?, ?, 'student', ?, ?)
    `).run(name, email, hashPassword(password), now, now);
    const userId = Number(userResult.lastInsertRowid);

    let teamId;
    let resolvedTeamName;
    if (role === 'leader') {
      if (db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName)) {
        throw new HttpError(409, 'TEAM_EXISTS', '该团队名称已存在，组长请更换名称');
      }
      const teamResult = db.prepare(`
        INSERT INTO teams (name, description, join_code, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(teamName, null, makeJoinCode(), userId, now, now);
      teamId = Number(teamResult.lastInsertRowid);
      resolvedTeamName = teamName;
    } else {
      const team = db.prepare('SELECT id, name FROM teams WHERE name = ?').get(teamName);
      if (!team) throw new HttpError(404, 'TEAM_NOT_FOUND', '未找到该团队，请核对团队名称');
      teamId = Number(team.id);
      resolvedTeamName = team.name;
      const duplicateName = db.prepare(`
        SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ? AND u.name = ?
      `).get(teamId, name);
      if (duplicateName) {
        throw new HttpError(409, 'MEMBER_NAME_EXISTS', '团队内已存在同名成员，请使用可区分的姓名');
      }
    }

    db.prepare(`
      INSERT INTO team_members (team_id, user_id, team_role, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(teamId, userId, role, now);
    addAudit(db, {
      teamId, userId, entityType: 'team_member', entityId: userId,
      action: 'joined', newValue: role,
    });
    return {
      id: userId, name, email, systemRole: 'student', teamId,
      teamName: resolvedTeamName, role,
    };
  });

  sendSuccess(response, { user: serializeUser(created) }, '注册成功', 201);
}

async function handleLogin(db, config, request, response) {
  const body = await readJsonBody(request);
  const email = normalizeEmail(body.email);
  const password = requireText(body.password, '密码', 128);
  const userRow = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.password_hash, u.system_role,
      tm.team_id, tm.team_role, t.name AS team_name
    FROM users u
    LEFT JOIN team_members tm ON tm.user_id = u.id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE u.email = ?
    ORDER BY tm.id
    LIMIT 1
  `).get(email);
  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
  }

  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowIso());
  const session = createSession(db, Number(userRow.id), config.tokenTtlHours);
  const user = {
    id: Number(userRow.id),
    name: userRow.name,
    email: userRow.email,
    systemRole: userRow.system_role,
    teamId: userRow.team_id === null ? null : Number(userRow.team_id),
    teamName: userRow.team_name || null,
    role: userRow.system_role === 'teacher' ? 'teacher' : userRow.team_role,
  };
  sendSuccess(response, { token: session.token, expiresAt: session.expiresAt, user: serializeUser(user) }, '登录成功');
}

async function handleCreateMeeting(db, user, teamId, request, response) {
  requireStudentWrite(user);
  const body = await readJsonBody(request);
  const title = requireText(body.title, '会议标题', 200);
  const meetingDate = requireText(body.date ?? body.meetingDate, '会议日期', 10);
  const content = requireText(body.content, '会议纪要', 20000);
  if (!isIsoDate(meetingDate)) throw new HttpError(422, 'VALIDATION_ERROR', '会议日期必须是YYYY-MM-DD格式');
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO meetings (team_id, title, meeting_date, content, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(teamId, title, meetingDate, content, user.id, now, now);
  const meetingId = Number(result.lastInsertRowid);
  addAudit(db, { teamId, userId: user.id, entityType: 'meeting', entityId: meetingId, action: 'created', newValue: title });
  sendSuccess(response, serializeMeeting(getMeetingRow(db, meetingId)), '会议纪要已保存', 201);
}

async function handleTranscribeMeeting(db, config, user, teamId, request, response) {
  requireStudentWrite(user);
  const formData = await readMultipartFormData(request, config.transcriptionMaxBytes);
  const file = TRANSCRIPTION_FILE_FIELDS
    .map((field) => formData.get(field))
    .find((value) => value && typeof value.arrayBuffer === 'function');
  const upload = normalizeAudioUpload(file, config.transcriptionMaxBytes);
  const languageValue = formData.get('language');
  const language = typeof languageValue === 'string' && languageValue.trim()
    ? languageValue.trim().toLowerCase()
    : config.transcriptionLanguage;
  if (!/^(auto|[a-z]{2,3}(?:-[a-z]{2})?)$/i.test(language)) {
    throw new HttpError(422, 'INVALID_LANGUAGE', '语言代码格式不正确');
  }

  const meetingValue = formData.get('meetingId');
  let meetingId = null;
  if (typeof meetingValue === 'string' && meetingValue.trim()) {
    meetingId = parsePositiveInteger(meetingValue, 'meetingId');
    const meeting = getMeetingRow(db, meetingId);
    if (!meeting || Number(meeting.team_id) !== teamId) {
      throw new HttpError(404, 'MEETING_NOT_FOUND', '会议记录不存在');
    }
  }

  const requestedProvider = String(config.transcriptionMode).toLowerCase() === 'api'
    ? 'openai-compatible'
    : 'local-mock';
  const requestedModel = requestedProvider === 'local-mock'
    ? 'deterministic-transcription-v1'
    : config.transcriptionModel;
  const run = db.prepare(`
    INSERT INTO transcription_runs (
      team_id, meeting_id, requested_by, provider, model_name, original_filename,
      mime_type, size_bytes, language, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    teamId, meetingId, user.id, requestedProvider, requestedModel, upload.filename,
    upload.mimeType, upload.sizeBytes, language, nowIso(),
  );
  const runId = Number(run.lastInsertRowid);

  try {
    const result = await transcribeAudio(upload, language, config);
    const completedAt = nowIso();
    withTransaction(db, () => {
      db.prepare(`
        UPDATE transcription_runs
        SET provider = ?, model_name = ?, transcript_text = ?, status = 'succeeded', completed_at = ?
        WHERE id = ?
      `).run(result.provider, result.model, result.text, completedAt, runId);
      addAudit(db, {
        teamId,
        userId: user.id,
        entityType: 'transcription_run',
        entityId: runId,
        action: 'completed',
        newValue: `${upload.filename}（${upload.sizeBytes}字节）`,
      });
    });
    sendSuccess(response, {
      runId,
      text: result.text,
      transcript: result.text,
      provider: result.provider,
      model: result.model,
      language,
      file: {
        name: upload.filename,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
      },
    }, '录音转写完成', 201);
  } catch (error) {
    const publicMessage = toPublicErrorMessage(error);
    withTransaction(db, () => {
      db.prepare(`
        UPDATE transcription_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
      `).run(publicMessage, nowIso(), runId);
      addAudit(db, {
        teamId,
        userId: user.id,
        entityType: 'transcription_run',
        entityId: runId,
        action: 'failed',
        newValue: publicMessage,
      });
    });
    throw error;
  }
}

async function handleUpdateMeeting(db, user, teamId, meetingId, request, response) {
  requireStudentWrite(user);
  const current = getMeetingRow(db, meetingId);
  if (!current) throw new HttpError(404, 'MEETING_NOT_FOUND', '会议记录不存在');
  requireTeamAccess(user, current.team_id);
  if (user.role !== 'leader' && Number(current.created_by) !== user.id) {
    throw new HttpError(403, 'FORBIDDEN', '普通组员只能编辑自己录入的会议纪要');
  }
  const body = await readJsonBody(request);
  const changes = {};
  if (body.title !== undefined) changes.title = requireText(body.title, '会议标题', 200);
  if (body.content !== undefined) changes.content = requireText(body.content, '会议纪要', 20000);
  if (body.date !== undefined || body.meetingDate !== undefined) {
    changes.meeting_date = requireText(body.date ?? body.meetingDate, '会议日期', 10);
    if (!isIsoDate(changes.meeting_date)) throw new HttpError(422, 'VALIDATION_ERROR', '会议日期必须是YYYY-MM-DD格式');
  }
  if (!Object.keys(changes).length) throw new HttpError(422, 'VALIDATION_ERROR', '没有可更新的会议字段');

  withTransaction(db, () => {
    for (const [field, value] of Object.entries(changes)) {
      if (String(current[field]) === String(value)) continue;
      db.prepare(`UPDATE meetings SET ${field} = ?, updated_at = ? WHERE id = ?`).run(value, nowIso(), meetingId);
      addAudit(db, { teamId, userId: user.id, entityType: 'meeting', entityId: meetingId, action: 'updated', fieldName: field, oldValue: current[field], newValue: value });
    }
  });
  sendSuccess(response, serializeMeeting(getMeetingRow(db, meetingId)), '会议纪要已更新');
}

async function handleDeleteMeeting(db, user, teamId, meetingId, response) {
  requireStudentWrite(user);
  const current = getMeetingRow(db, meetingId);
  if (!current) throw new HttpError(404, 'MEETING_NOT_FOUND', '会议记录不存在');
  requireTeamAccess(user, current.team_id);
  if (user.role !== 'leader' && Number(current.created_by) !== user.id) {
    throw new HttpError(403, 'FORBIDDEN', '普通组员只能删除自己录入的会议纪要');
  }
  const now = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE meetings SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, meetingId);
    addAudit(db, { teamId, userId: user.id, entityType: 'meeting', entityId: meetingId, action: 'deleted', oldValue: current.title });
  });
  sendSuccess(response, { id: meetingId }, '会议记录已删除');
}

async function handleExtract(db, config, user, teamId, request, response) {
  requireStudentWrite(user);
  const body = await readJsonBody(request);
  const meetingId = parsePositiveInteger(body.meetingId, 'meetingId');
  const meeting = getMeetingRow(db, meetingId);
  if (!meeting) throw new HttpError(404, 'MEETING_NOT_FOUND', '会议记录不存在');
  requireTeamAccess(user, meeting.team_id);

  const requestedProvider = String(config.llmMode).toLowerCase() === 'api' ? 'openai-compatible' : 'local-mock';
  const runResult = db.prepare(`
    INSERT INTO extraction_runs (
      meeting_id, requested_by, provider, model_name, prompt_version,
      input_text_snapshot, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(meetingId, user.id, requestedProvider, config.llmModel || null, PROMPT_VERSION, meeting.content, nowIso());
  const runId = Number(runResult.lastInsertRowid);

  try {
    const extraction = await extractTaskDrafts({
      meetingDate: meeting.meeting_date,
      content: meeting.content,
      members: listTeamMembers(db, teamId),
    }, config);
    const now = nowIso();
    withTransaction(db, () => {
      db.prepare(`
        UPDATE extraction_runs
        SET provider = ?, model_name = ?, raw_response_json = ?, status = 'succeeded', completed_at = ?
        WHERE id = ?
      `).run(extraction.provider, extraction.model, JSON.stringify(extraction.rawResponse), now, runId);
      db.prepare(`
        UPDATE task_drafts SET draft_status = '已拒绝', updated_at = ?
        WHERE meeting_id = ? AND draft_status = '待确认'
      `).run(now, meetingId);

      const insert = db.prepare(`
        INSERT INTO task_drafts (
          extraction_run_id, meeting_id, title, assignee_text, assignee_id,
          due_date_text, due_date, priority, source_quote, needs_confirmation,
          ambiguity_reason, draft_status, original_payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待确认', ?, ?, ?)
      `);
      for (const task of extraction.tasks) {
        insert.run(
          runId, meetingId, task.title, task.assigneeText, task.assigneeId,
          task.dueDateText, task.dueDate, task.priority, task.sourceQuote,
          task.needsConfirmation ? 1 : 0, task.ambiguityReason,
          JSON.stringify(task.originalPayload), now, now,
        );
      }
      addAudit(db, {
        teamId, userId: user.id, entityType: 'extraction_run', entityId: runId,
        action: 'completed', newValue: `${extraction.tasks.length}个任务草稿`,
      });
    });

    const drafts = db.prepare(`
      SELECT d.*, m.team_id, m.title AS meeting_title, m.content AS meeting_content,
             u.name AS assignee_name
      FROM task_drafts d
      JOIN meetings m ON m.id = d.meeting_id
      LEFT JOIN users u ON u.id = d.assignee_id
      WHERE d.extraction_run_id = ?
      ORDER BY d.id
    `).all(runId).map(serializeDraft);
    sendSuccess(response, {
      extractionRunId: runId,
      provider: extraction.provider,
      model: extraction.model,
      promptVersion: extraction.promptVersion,
      drafts,
    }, `已生成${drafts.length}个任务草稿`, 201);
  } catch (error) {
    db.prepare(`
      UPDATE extraction_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?
    `).run(toPublicErrorMessage(error), nowIso(), runId);
    throw error;
  }
}

async function handleUpdateDraft(db, user, teamId, draftId, request, response) {
  requireLeader(user);
  const current = getDraftRow(db, draftId);
  if (!current) throw new HttpError(404, 'DRAFT_NOT_FOUND', 'AI任务草稿不存在');
  requireTeamAccess(user, current.team_id);
  if (current.draft_status !== '待确认') throw new HttpError(409, 'DRAFT_LOCKED', '该草稿已经处理，不能继续修改');
  const body = await readJsonBody(request);
  const next = {
    title: body.title === undefined ? current.title : requireText(body.title, '任务名称', 200),
    assignee_id: current.assignee_id,
    assignee_text: current.assignee_text,
    due_date: body.deadline === undefined && body.dueDate === undefined
      ? current.due_date
      : validateDueDate(body.deadline ?? body.dueDate),
    priority: body.priority === undefined ? current.priority : validatePriority(body.priority),
    source_quote: body.sourceText === undefined
      ? current.source_quote
      : requireText(body.sourceText, '会议原文依据', 1000),
  };
  if (body.assignee !== undefined || body.assigneeId !== undefined) {
    let member = null;
    if (body.assignee !== undefined) {
      member = getMemberByName(db, teamId, body.assignee);
    } else if (body.assigneeId !== undefined && body.assigneeId !== null && body.assigneeId !== '') {
      const id = parsePositiveInteger(body.assigneeId, 'assigneeId');
      member = db.prepare(`
        SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id = tm.user_id
        WHERE tm.team_id = ? AND u.id = ?
      `).get(teamId, id);
    }
    if (!member && body.assignee && !['待确认', '待分配'].includes(body.assignee)) {
      throw new HttpError(422, 'ASSIGNEE_NOT_IN_TEAM', '负责人必须是当前团队成员');
    }
    next.assignee_id = member ? Number(member.id) : null;
    next.assignee_text = member?.name || optionalText(body.assignee, 50);
  }
  const reasons = [];
  if (!next.assignee_id) reasons.push('负责人不明确');
  if (!next.due_date) reasons.push('截止时间不明确');
  if (!current.meeting_content.includes(next.source_quote)) reasons.push('原文依据无法在会议纪要中定位');

  const tracked = {
    title: [current.title, next.title],
    assignee_id: [current.assignee_id, next.assignee_id],
    due_date: [current.due_date, next.due_date],
    priority: [current.priority, next.priority],
    source_quote: [current.source_quote, next.source_quote],
  };
  withTransaction(db, () => {
    db.prepare(`
      UPDATE task_drafts
      SET title = ?, assignee_id = ?, assignee_text = ?, due_date = ?, priority = ?, source_quote = ?,
          needs_confirmation = ?, ambiguity_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.title, next.assignee_id, next.assignee_text, next.due_date, next.priority, next.source_quote,
      reasons.length ? 1 : 0, reasons.join('；') || null, nowIso(), draftId,
    );
    for (const [field, [oldValue, newValue]] of Object.entries(tracked)) {
      if (String(oldValue ?? '') === String(newValue ?? '')) continue;
      addAudit(db, { teamId, userId: user.id, entityType: 'task_draft', entityId: draftId, action: 'updated', fieldName: field, oldValue, newValue });
    }
  });
  sendSuccess(response, serializeDraft(getDraftRow(db, draftId)), '草稿已保存');
}

async function handleRejectDraft(db, user, teamId, draftId, response) {
  requireLeader(user);
  const current = getDraftRow(db, draftId);
  if (!current) throw new HttpError(404, 'DRAFT_NOT_FOUND', 'AI任务草稿不存在');
  requireTeamAccess(user, current.team_id);
  if (current.draft_status !== '待确认') throw new HttpError(409, 'DRAFT_LOCKED', '该草稿已经处理');
  withTransaction(db, () => {
    db.prepare(`UPDATE task_drafts SET draft_status = '已拒绝', updated_at = ? WHERE id = ?`).run(nowIso(), draftId);
    addAudit(db, { teamId, userId: user.id, entityType: 'task_draft', entityId: draftId, action: 'rejected', oldValue: '待确认', newValue: '已拒绝' });
  });
  sendSuccess(response, { id: draftId }, '草稿已删除');
}

async function handleConfirmDraft(db, user, teamId, request, response) {
  requireLeader(user);
  const body = await readJsonBody(request);
  const draftId = parsePositiveInteger(body.draftId, 'draftId');
  const current = getDraftRow(db, draftId);
  if (!current) throw new HttpError(404, 'DRAFT_NOT_FOUND', 'AI任务草稿不存在');
  requireTeamAccess(user, current.team_id);
  if (current.draft_status !== '待确认') throw new HttpError(409, 'DRAFT_ALREADY_PROCESSED', '该草稿已经确认或拒绝');
  if (!current.assignee_id || !current.due_date) {
    throw new HttpError(422, 'DRAFT_INCOMPLETE', '负责人或截止时间仍待确认，请先人工补充');
  }
  if (!current.meeting_content.includes(current.source_quote)) {
    throw new HttpError(422, 'SOURCE_QUOTE_INVALID', '原文依据无法在会议纪要中定位，不能确认');
  }

  const taskId = withTransaction(db, () => {
    const now = nowIso();
    const result = db.prepare(`
      INSERT INTO tasks (
        team_id, meeting_id, source_draft_id, title, assignee_id, due_date,
        priority, status, progress_percent, source_quote, created_by,
        confirmed_by, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '待开始', 0, ?, ?, ?, ?, ?, ?)
    `).run(
      teamId, current.meeting_id, draftId, current.title, current.assignee_id,
      current.due_date, current.priority, current.source_quote,
      user.id, user.id, now, now, now,
    );
    const createdTaskId = Number(result.lastInsertRowid);
    db.prepare(`
      UPDATE task_drafts
      SET draft_status = '已确认', needs_confirmation = 0, ambiguity_reason = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, draftId);
    addAudit(db, { teamId, userId: user.id, entityType: 'task_draft', entityId: draftId, action: 'confirmed', oldValue: '待确认', newValue: '已确认' });
    addAudit(db, { teamId, userId: user.id, entityType: 'task', entityId: createdTaskId, action: 'created', newValue: current.title });
    return createdTaskId;
  });
  sendSuccess(response, serializeTask(getTaskRow(db, taskId)), '任务已确认并加入看板', 201);
}

async function handleCreateTask(db, user, teamId, request, response) {
  requireLeader(user);
  const body = await readJsonBody(request);
  const title = requireText(body.title, '任务名称', 200);
  const member = body.assigneeId
    ? db.prepare(`SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.id = ?`).get(teamId, parsePositiveInteger(body.assigneeId, 'assigneeId'))
    : getMemberByName(db, teamId, body.assignee);
  if (!member) throw new HttpError(422, 'ASSIGNEE_NOT_IN_TEAM', '请选择当前团队中的负责人');
  const dueDate = validateDueDate(body.deadline ?? body.dueDate);
  if (!dueDate) throw new HttpError(422, 'VALIDATION_ERROR', '手工创建任务时必须填写截止日期');
  const priority = validatePriority(body.priority);
  const status = body.status ? validateStatus(body.status) : '待开始';
  let progress = body.progressPercent === undefined ? (status === '已完成' ? 100 : 0) : Number(body.progressPercent);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new HttpError(422, 'VALIDATION_ERROR', '任务进度必须是0到100之间的整数');
  if (status === '已完成') progress = 100;
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO tasks (
      team_id, title, description, assignee_id, due_date, priority, status,
      progress_percent, source_quote, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(teamId, title, optionalText(body.description, 2000), member.id, dueDate, priority, status, progress, optionalText(body.sourceText, 1000), user.id, now, now);
  const taskId = Number(result.lastInsertRowid);
  addAudit(db, { teamId, userId: user.id, entityType: 'task', entityId: taskId, action: 'created', newValue: title });
  sendSuccess(response, serializeTask(getTaskRow(db, taskId)), '任务已创建', 201);
}

async function handleUpdateTask(db, user, teamId, taskId, request, response) {
  requireStudentWrite(user);
  const current = getTaskRow(db, taskId);
  if (!current) throw new HttpError(404, 'TASK_NOT_FOUND', '任务不存在');
  requireTeamAccess(user, current.team_id);
  const isLeader = user.role === 'leader';
  const isAssignee = Number(current.assignee_id) === user.id;
  if (!isLeader && !isAssignee) throw new HttpError(403, 'FORBIDDEN', '普通组员只能更新自己负责的任务');

  const body = await readJsonBody(request);
  if (!isLeader) {
    const forbidden = Object.keys(body).filter((key) => !['status', 'progressPercent'].includes(key));
    if (forbidden.length) throw new HttpError(403, 'FORBIDDEN_FIELDS', '普通组员只能修改任务状态和进度', { fields: forbidden });
  }

  const changes = {};
  if (body.status !== undefined) changes.status = validateStatus(body.status);
  if (body.progressPercent !== undefined) {
    const value = Number(body.progressPercent);
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new HttpError(422, 'VALIDATION_ERROR', '任务进度必须是0到100之间的整数');
    }
    changes.progress_percent = value;
  }
  if (isLeader) {
    if (body.title !== undefined) changes.title = requireText(body.title, '任务名称', 200);
    if (body.description !== undefined) changes.description = optionalText(body.description, 2000);
    if (body.deadline !== undefined || body.dueDate !== undefined) changes.due_date = validateDueDate(body.deadline ?? body.dueDate);
    if (body.priority !== undefined) changes.priority = validatePriority(body.priority);
    if (body.assignee !== undefined || body.assigneeId !== undefined) {
      let member;
      if (body.assigneeId !== undefined && body.assigneeId !== null && body.assigneeId !== '') {
        member = db.prepare(`SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ? AND u.id = ?`).get(teamId, parsePositiveInteger(body.assigneeId, 'assigneeId'));
      } else {
        member = getMemberByName(db, teamId, body.assignee);
      }
      if (!member) throw new HttpError(422, 'ASSIGNEE_NOT_IN_TEAM', '负责人必须是当前团队成员');
      changes.assignee_id = Number(member.id);
    }
  }
  if (!Object.keys(changes).length) throw new HttpError(422, 'VALIDATION_ERROR', '没有可更新的任务字段');

  const nextStatus = changes.status ?? current.status;
  const nextProgress = changes.progress_percent ?? Number(current.progress_percent);
  if (nextStatus === '已完成') changes.progress_percent = 100;
  else if (nextProgress === 100 && body.status === undefined) changes.status = '已完成';
  else if (nextStatus === '待开始' && nextProgress > 0) changes.status = '进行中';

  withTransaction(db, () => {
    for (const [field, value] of Object.entries(changes)) {
      if (String(current[field] ?? '') === String(value ?? '')) continue;
      db.prepare(`UPDATE tasks SET ${field} = ?, updated_at = ? WHERE id = ?`).run(value, nowIso(), taskId);
      addAudit(db, { teamId, userId: user.id, entityType: 'task', entityId: taskId, action: 'updated', fieldName: field, oldValue: current[field], newValue: value });
    }
  });
  sendSuccess(response, serializeTask(getTaskRow(db, taskId)), '任务已更新');
}

async function handleDeleteTask(db, user, teamId, taskId, response) {
  requireLeader(user);
  const current = getTaskRow(db, taskId);
  if (!current) throw new HttpError(404, 'TASK_NOT_FOUND', '任务不存在');
  requireTeamAccess(user, current.team_id);
  const now = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, taskId);
    addAudit(db, { teamId, userId: user.id, entityType: 'task', entityId: taskId, action: 'deleted', oldValue: current.title });
  });
  sendSuccess(response, { id: taskId }, '任务已删除');
}

function getStatistics(db, teamId) {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = '已完成' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status NOT IN ('已完成', '已取消') AND due_date IS NOT NULL AND due_date < date('now') THEN 1 ELSE 0 END) AS overdue
    FROM tasks
    WHERE team_id = ? AND deleted_at IS NULL AND status != '已取消'
  `).get(teamId);
  const total = Number(totals.total || 0);
  const completed = Number(totals.completed || 0);
  const overdue = Number(totals.overdue || 0);
  const statusCounts = [
    ['待开始', db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE team_id = ? AND deleted_at IS NULL AND status = '待开始' AND (due_date IS NULL OR due_date >= date('now'))`).get(teamId).count],
    ['进行中', db.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE team_id = ? AND deleted_at IS NULL AND status = '进行中' AND (due_date IS NULL OR due_date >= date('now'))`).get(teamId).count],
    ['已完成', completed],
    ['已逾期', overdue],
  ].map(([status, count]) => ({ status, count: Number(count) }));
  const memberStats = db.prepare(`
    SELECT
      u.id, u.name,
      COUNT(t.id) AS total,
      SUM(CASE WHEN t.status = '已完成' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.status NOT IN ('已完成', '已取消') AND t.due_date IS NOT NULL AND t.due_date < date('now') THEN 1 ELSE 0 END) AS overdue
    FROM team_members tm
    JOIN users u ON u.id = tm.user_id
    LEFT JOIN tasks t ON t.assignee_id = u.id AND t.team_id = tm.team_id
      AND t.deleted_at IS NULL AND t.status != '已取消'
    WHERE tm.team_id = ?
    GROUP BY u.id, u.name
    ORDER BY tm.id
  `).all(teamId).map((row) => ({
    id: Number(row.id),
    name: row.name,
    total: Number(row.total || 0),
    completed: Number(row.completed || 0),
    overdue: Number(row.overdue || 0),
  }));
  return {
    total,
    completed,
    unfinished: total - completed,
    overdue,
    completionRate: total ? Math.round((completed / total) * 100) : 0,
    statusCounts,
    memberStats,
    generatedAt: nowIso(),
  };
}

async function routeRequest(db, config, request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const method = request.method || 'GET';

  if (method === 'GET' && url.pathname === '/api/health') {
    sendSuccess(response, {
      status: 'ok',
      database: 'sqlite',
      aiMode: config.llmMode,
      transcriptionMode: config.transcriptionMode,
      timestamp: nowIso(),
    });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/register') return handleRegister(db, request, response);
  if (method === 'POST' && url.pathname === '/api/auth/login') return handleLogin(db, config, request, response);

  const user = authenticate(db, request);
  if (method === 'GET' && url.pathname === '/api/auth/me') {
    sendSuccess(response, serializeUser(user));
    return;
  }
  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    revokeSession(db, getBearerToken(request));
    sendSuccess(response, null, '已退出登录');
    return;
  }

  const teamId = getTeamId(db, user, url);
  if (method === 'GET' && url.pathname === '/api/team/members') {
    sendSuccess(response, listTeamMembers(db, teamId));
    return;
  }

  if (method === 'GET' && url.pathname === '/api/meetings') {
    const rows = db.prepare(`
      SELECT m.*, u.name AS creator_name
      FROM meetings m JOIN users u ON u.id = m.created_by
      WHERE m.team_id = ? AND m.deleted_at IS NULL
      ORDER BY m.meeting_date DESC, m.id DESC
    `).all(teamId);
    sendSuccess(response, rows.map(serializeMeeting));
    return;
  }
  if (method === 'POST' && url.pathname === '/api/meetings') return handleCreateMeeting(db, user, teamId, request, response);
  if (method === 'POST' && url.pathname === '/api/meetings/transcribe') {
    return handleTranscribeMeeting(db, config, user, teamId, request, response);
  }
  const meetingMatch = url.pathname.match(/^\/api\/meetings\/(\d+)$/);
  if (meetingMatch && method === 'GET') {
    const row = getMeetingRow(db, parsePositiveInteger(meetingMatch[1]));
    if (!row || Number(row.team_id) !== teamId) throw new HttpError(404, 'MEETING_NOT_FOUND', '会议记录不存在');
    sendSuccess(response, serializeMeeting(row));
    return;
  }
  if (meetingMatch && ['PUT', 'PATCH'].includes(method)) return handleUpdateMeeting(db, user, teamId, parsePositiveInteger(meetingMatch[1]), request, response);
  if (meetingMatch && method === 'DELETE') return handleDeleteMeeting(db, user, teamId, parsePositiveInteger(meetingMatch[1]), response);

  if (method === 'POST' && url.pathname === '/api/ai/extract') return handleExtract(db, config, user, teamId, request, response);
  if (method === 'GET' && url.pathname === '/api/ai/drafts') {
    const requestedMeetingId = url.searchParams.get('meetingId');
    let run;
    if (requestedMeetingId) {
      const meetingId = parsePositiveInteger(requestedMeetingId, 'meetingId');
      run = db.prepare(`
        SELECT r.id FROM extraction_runs r JOIN meetings m ON m.id = r.meeting_id
        WHERE m.team_id = ? AND m.id = ? AND r.status = 'succeeded'
        ORDER BY r.id DESC LIMIT 1
      `).get(teamId, meetingId);
    } else {
      run = db.prepare(`
        SELECT r.id FROM extraction_runs r JOIN meetings m ON m.id = r.meeting_id
        WHERE m.team_id = ? AND r.status = 'succeeded' AND m.deleted_at IS NULL
        ORDER BY r.id DESC LIMIT 1
      `).get(teamId);
    }
    if (!run) {
      sendSuccess(response, []);
      return;
    }
    const rows = db.prepare(`
      SELECT d.*, m.team_id, m.title AS meeting_title, m.content AS meeting_content,
             u.name AS assignee_name
      FROM task_drafts d JOIN meetings m ON m.id = d.meeting_id
      LEFT JOIN users u ON u.id = d.assignee_id
      WHERE d.extraction_run_id = ? AND d.draft_status != '已拒绝'
      ORDER BY d.id
    `).all(run.id);
    sendSuccess(response, rows.map(serializeDraft));
    return;
  }
  if (method === 'GET' && url.pathname === '/api/ai/extractions') {
    requireLeaderOrTeacher(user);
    const rows = db.prepare(`
      SELECT r.id, r.meeting_id, m.title AS meeting_title, r.provider, r.model_name,
             r.prompt_version, r.status, r.error_message, r.created_at, r.completed_at,
             COUNT(d.id) AS draft_count
      FROM extraction_runs r JOIN meetings m ON m.id = r.meeting_id
      LEFT JOIN task_drafts d ON d.extraction_run_id = r.id
      WHERE m.team_id = ?
      GROUP BY r.id ORDER BY r.id DESC LIMIT 100
    `).all(teamId).map((row) => ({
      id: Number(row.id), meetingId: Number(row.meeting_id), meetingTitle: row.meeting_title,
      provider: row.provider, model: row.model_name, promptVersion: row.prompt_version,
      status: row.status, errorMessage: row.error_message, draftCount: Number(row.draft_count),
      createdAt: row.created_at, completedAt: row.completed_at,
    }));
    sendSuccess(response, rows);
    return;
  }
  const draftMatch = url.pathname.match(/^\/api\/ai\/drafts\/(\d+)$/);
  if (draftMatch && ['PUT', 'PATCH'].includes(method)) return handleUpdateDraft(db, user, teamId, parsePositiveInteger(draftMatch[1]), request, response);
  if (draftMatch && method === 'DELETE') return handleRejectDraft(db, user, teamId, parsePositiveInteger(draftMatch[1]), response);

  if (method === 'POST' && url.pathname === '/api/tasks/confirm') return handleConfirmDraft(db, user, teamId, request, response);
  if (method === 'GET' && url.pathname === '/api/tasks') {
    const rows = db.prepare(`
      SELECT t.*, u.name AS assignee_name, m.title AS meeting_title
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN meetings m ON m.id = t.meeting_id
      WHERE t.team_id = ? AND t.deleted_at IS NULL AND t.status != '已取消'
      ORDER BY COALESCE(t.due_date, '9999-12-31'), t.id DESC
    `).all(teamId);
    sendSuccess(response, rows.map(serializeTask));
    return;
  }
  if (method === 'POST' && url.pathname === '/api/tasks') return handleCreateTask(db, user, teamId, request, response);
  const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch && method === 'GET') {
    const row = getTaskRow(db, parsePositiveInteger(taskMatch[1]));
    if (!row || Number(row.team_id) !== teamId) throw new HttpError(404, 'TASK_NOT_FOUND', '任务不存在');
    sendSuccess(response, serializeTask(row));
    return;
  }
  if (taskMatch && ['PUT', 'PATCH'].includes(method)) return handleUpdateTask(db, user, teamId, parsePositiveInteger(taskMatch[1]), request, response);
  if (taskMatch && method === 'DELETE') return handleDeleteTask(db, user, teamId, parsePositiveInteger(taskMatch[1]), response);

  if (method === 'GET' && url.pathname === '/api/statistics') {
    sendSuccess(response, getStatistics(db, teamId));
    return;
  }
  if (method === 'GET' && url.pathname === '/api/audit-logs') {
    requireLeaderOrTeacher(user);
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    const rows = db.prepare(`
      SELECT a.*, u.name AS user_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.team_id = ? ORDER BY a.id DESC LIMIT ?
    `).all(teamId, Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 100).map((row) => ({
      id: Number(row.id), userId: row.user_id === null ? null : Number(row.user_id),
      userName: row.user_name || '系统', entityType: row.entity_type,
      entityId: Number(row.entity_id), action: row.action, fieldName: row.field_name,
      oldValue: row.old_value, newValue: row.new_value, createdAt: row.created_at,
    }));
    sendSuccess(response, rows);
    return;
  }

  throw new HttpError(404, 'NOT_FOUND', '接口不存在');
}

export function createApplication(overrides = {}) {
  const config = buildConfig(overrides);
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  if (config.autoSeedDemo) seedDemoData(db);

  const server = http.createServer(async (request, response) => {
    const headers = corsHeaders(request, config.frontendOrigin);
    for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    try {
      if (!request.url.startsWith('/api/') && serveFrontend(request, response)) return;
      await routeRequest(db, config, request, response);
    } catch (rawError) {
      const error = normalizeSqliteError(rawError);
      if (!(error instanceof HttpError)) console.error(error);
      sendError(response, error, headers);
      return;
    }
  });

  return {
    config,
    db,
    server,
    close() {
      return new Promise((resolve, reject) => {
        const closeDatabase = () => {
          try {
            db.close();
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        if (server.listening) server.close((error) => (error ? reject(error) : closeDatabase()));
        else closeDatabase();
      });
    },
  };
}
