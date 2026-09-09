CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  system_role TEXT NOT NULL DEFAULT 'student' CHECK (system_role IN ('student', 'teacher')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  join_code TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_role TEXT NOT NULL CHECK (team_role IN ('leader', 'member')),
  joined_at TEXT NOT NULL,
  UNIQUE(team_id, user_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS extraction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  model_name TEXT,
  prompt_version TEXT NOT NULL,
  input_text_snapshot TEXT NOT NULL,
  raw_response_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extraction_run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_text TEXT,
  assignee_id INTEGER REFERENCES users(id),
  due_date_text TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT '未指定' CHECK (priority IN ('高', '中', '低', '未指定')),
  source_quote TEXT NOT NULL,
  needs_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (needs_confirmation IN (0, 1)),
  ambiguity_reason TEXT,
  draft_status TEXT NOT NULL DEFAULT '待确认' CHECK (draft_status IN ('待确认', '已确认', '已拒绝')),
  original_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES meetings(id),
  source_draft_id INTEGER UNIQUE REFERENCES task_drafts(id),
  title TEXT NOT NULL,
  description TEXT,
  assignee_id INTEGER REFERENCES users(id),
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT '未指定' CHECK (priority IN ('高', '中', '低', '未指定')),
  status TEXT NOT NULL DEFAULT '待开始' CHECK (status IN ('待开始', '进行中', '已完成', '已取消')),
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  source_quote TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_members_user_id
ON team_members(user_id);

CREATE INDEX IF NOT EXISTS idx_meetings_team_date
ON meetings(team_id, meeting_date DESC);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_meeting
ON extraction_runs(meeting_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_drafts_meeting_status
ON task_drafts(meeting_id, draft_status);

CREATE INDEX IF NOT EXISTS idx_tasks_team_status
ON tasks(team_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
ON tasks(assignee_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_team_due_date
ON tasks(team_id, due_date);

CREATE INDEX IF NOT EXISTS idx_audit_logs_team_entity
ON audit_logs(team_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
ON auth_sessions(expires_at);

