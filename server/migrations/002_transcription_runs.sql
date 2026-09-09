CREATE TABLE IF NOT EXISTS transcription_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  model_name TEXT,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  language TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  transcript_text TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transcription_runs_team_created
ON transcription_runs(team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcription_runs_meeting
ON transcription_runs(meeting_id, created_at DESC);
