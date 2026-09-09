import crypto from 'node:crypto';
import { HttpError, nowIso } from './utils.js';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(db, userId, ttlHours = 24) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), userId, expiresAt, nowIso());
  return { token, expiresAt };
}

export function revokeSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
}

export function getBearerToken(request) {
  const authorization = request.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return null;
  return authorization.slice(7).trim() || null;
}

export function authenticate(db, request) {
  const token = getBearerToken(request);
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', '请先登录');

  const row = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.system_role,
      tm.team_id, tm.team_role, t.name AS team_name,
      s.expires_at
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN team_members tm ON tm.user_id = u.id
    LEFT JOIN teams t ON t.id = tm.team_id
    WHERE s.token_hash = ?
    ORDER BY tm.id
    LIMIT 1
  `).get(hashToken(token));

  if (!row) throw new HttpError(401, 'UNAUTHORIZED', '登录状态无效，请重新登录');
  if (Date.parse(row.expires_at) <= Date.now()) {
    revokeSession(db, token);
    throw new HttpError(401, 'TOKEN_EXPIRED', '登录已过期，请重新登录');
  }

  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    systemRole: row.system_role,
    teamId: row.team_id === null ? null : Number(row.team_id),
    teamName: row.team_name || null,
    role: row.system_role === 'teacher' ? 'teacher' : row.team_role,
    token,
  };
}

export function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    systemRole: user.systemRole,
    teamId: user.teamId,
    teamName: user.teamName,
    role: user.role,
  };
}

export function requireTeamAccess(user, teamId) {
  if (user.systemRole === 'teacher') return;
  if (!user.teamId || Number(user.teamId) !== Number(teamId)) {
    throw new HttpError(403, 'FORBIDDEN', '你没有访问该团队数据的权限');
  }
}

export function requireLeader(user) {
  if (user.systemRole === 'teacher' || user.role !== 'leader') {
    throw new HttpError(403, 'FORBIDDEN', '仅组长可以执行此操作');
  }
}

export function requireStudentWrite(user) {
  if (user.systemRole === 'teacher') {
    throw new HttpError(403, 'READ_ONLY_ROLE', '教师/助教账号为只读权限');
  }
}

