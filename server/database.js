import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';
import { nowIso } from './utils.js';

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );

  const files = fs.readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const fileName of files) {
    if (applied.has(fileName)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, fileName), 'utf8');
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(fileName, nowIso());
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  db.exec('PRAGMA optimize;');
}

export function withTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = operation();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

function insertDemoUser(db, { name, email, password, systemRole = 'student' }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return Number(existing.id);
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, system_role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, email.toLowerCase(), hashPassword(password), systemRole, now, now);
  return Number(result.lastInsertRowid);
}

export function seedDemoData(db) {
  return withTransaction(db, () => {
    const leaderId = insertDemoUser(db, {
      name: '张三', email: 'zhangsan@example.com', password: '123456',
    });
    const lisiId = insertDemoUser(db, {
      name: '李四', email: 'lisi@example.com', password: '123456',
    });
    const wangId = insertDemoUser(db, {
      name: '小王', email: 'xiaowang@example.com', password: '123456',
    });
    const liId = insertDemoUser(db, {
      name: '小李', email: 'xiaoli@example.com', password: '123456',
    });
    insertDemoUser(db, {
      name: '课程助教', email: 'teacher@example.com', password: '123456', systemRole: 'teacher',
    });

    let team = db.prepare('SELECT id FROM teams WHERE name = ?').get('AI课程项目组');
    if (!team) {
      const now = nowIso();
      const result = db.prepare(`
        INSERT INTO teams (name, description, join_code, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('AI课程项目组', '课程小组会议纪要任务系统演示团队', 'AI2026', leaderId, now, now);
      team = { id: result.lastInsertRowid };
    }
    const teamId = Number(team.id);

    const addMember = db.prepare(`
      INSERT OR IGNORE INTO team_members (team_id, user_id, team_role, joined_at)
      VALUES (?, ?, ?, ?)
    `);
    addMember.run(teamId, leaderId, 'leader', nowIso());
    addMember.run(teamId, lisiId, 'member', nowIso());
    addMember.run(teamId, wangId, 'member', nowIso());
    addMember.run(teamId, liId, 'member', nowIso());

    const existingMeeting = db.prepare('SELECT id FROM meetings WHERE team_id = ? LIMIT 1').get(teamId);
    if (!existingMeeting) {
      const now = nowIso();
      const meetingOne = db.prepare(`
        INSERT INTO meetings (team_id, title, meeting_date, content, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        teamId,
        '第3次项目周会',
        '2026-09-08',
        '下周三前，小王整理实验数据，小李完成展示PPT，大家周五讨论测试结果。',
        leaderId,
        now,
        now,
      );
      db.prepare(`
        INSERT INTO meetings (team_id, title, meeting_date, content, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        teamId,
        '需求分析会议',
        '2026-09-05',
        '李四负责整理用户需求，张三确认系统功能范围。',
        leaderId,
        now,
        now,
      );

      const insertTask = db.prepare(`
        INSERT INTO tasks (
          team_id, meeting_id, title, assignee_id, due_date, priority, status,
          progress_percent, source_quote, created_by, confirmed_by, confirmed_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const meetingId = Number(meetingOne.lastInsertRowid);
      const tasks = [
        ['整理实验数据', wangId, '2026-09-16', '高', '待开始', 0, '小王整理实验数据'],
        ['完成展示PPT', liId, '2026-09-16', '中', '进行中', 45, '小李完成展示PPT'],
        ['整理用户需求', lisiId, '2026-09-12', '高', '进行中', 60, '李四负责整理用户需求'],
        ['确认系统功能范围', leaderId, '2026-09-10', '中', '已完成', 100, '张三确认系统功能范围'],
        ['绘制前端页面原型', lisiId, '2026-09-14', '中', '待开始', 0, '李四先完成页面原型'],
        ['设计数据库表结构', wangId, '2026-09-07', '高', '进行中', 30, '小王负责数据库设计'],
        ['编写接口文档', leaderId, '2026-09-18', '低', '待开始', 0, '张三整理接口文档'],
        ['完成系统测试', liId, '2026-09-06', '高', '进行中', 75, '小李负责基础功能测试'],
        ['准备项目演示稿', lisiId, '2026-09-20', '低', '已完成', 100, '李四准备项目演示稿'],
      ];
      for (const task of tasks) {
        insertTask.run(
          teamId, meetingId, task[0], task[1], task[2], task[3], task[4], task[5], task[6],
          leaderId, leaderId, now, now, now,
        );
      }
    }

    return { teamId };
  });
}

