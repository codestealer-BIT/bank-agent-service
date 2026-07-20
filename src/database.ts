import pg from "pg";
import { config } from "./config.js";
import { hashPassword } from "./security.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

const migration = `
CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx
  ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_agents (
  user_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_agents
  DROP CONSTRAINT IF EXISTS user_agents_agent_id_key;

CREATE TABLE IF NOT EXISTS shared_agents (
  scope TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_agents(user_id) ON DELETE CASCADE,
  letta_conversation_id TEXT UNIQUE,
  agent_id TEXT,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id UUID PRIMARY KEY,
  request_id TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  user_message TEXT NOT NULL,
  assistant_message TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, request_id),
  FOREIGN KEY (conversation_id, user_id)
    REFERENCES conversations(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS turns_conversation_created_idx
  ON turns(conversation_id, created_at);

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflection_status TEXT
    CHECK (memory_reflection_status IN ('processing', 'completed', 'failed'));

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflected_at TIMESTAMPTZ;

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflection_error TEXT;

CREATE INDEX IF NOT EXISTS turns_memory_reflection_idx
  ON turns(user_id, completed_at)
  WHERE status = 'completed' AND memory_reflected_at IS NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS agent_id TEXT;

CREATE TABLE IF NOT EXISTS knowledge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  reusable_solution TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS knowledge_candidates_status_created_idx
  ON knowledge_candidates(status, created_at);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',
  icon TEXT NOT NULL DEFAULT 'spark',
  accent TEXT NOT NULL DEFAULT 'violet',
  environment_label TEXT NOT NULL DEFAULT 'bank-runtime',
  conversation_target TEXT NOT NULL DEFAULT 'new'
    CHECK (conversation_target IN ('new')),
  schedule_type TEXT NOT NULL
    CHECK (schedule_type IN ('recurring', 'one_off')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  recurrence_kind TEXT
    CHECK (recurrence_kind IN ('daily', 'weekdays', 'weekly')),
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  hour INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  minute INTEGER NOT NULL CHECK (minute BETWEEN 0 AND 59),
  scheduled_for TIMESTAMPTZ,
  recipient_email TEXT,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS recipient_email TEXT;

CREATE INDEX IF NOT EXISTS schedules_user_next_run_idx
  ON schedules(user_id, enabled, next_run_at);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id UUID PRIMARY KEY,
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('processing', 'completed', 'failed')),
  conversation_id UUID,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS schedule_runs_schedule_started_idx
  ON schedule_runs(schedule_id, started_at DESC);
`;

export async function migrate(): Promise<void> {
  await pool.query(migration);
  await pool.query("DELETE FROM auth_sessions WHERE expires_at <= now()");

  if (config.DEMO_AUTH_ENABLED) {
    const demoUsers = [
      { id: "demo-user-a", username: "usera", displayName: "顾彦航" },
      { id: "demo-user-b", username: "userb", displayName: "林清禾" },
    ];
    for (const user of demoUsers) {
      const exists = await pool.query(
        "SELECT 1 FROM user_accounts WHERE id = $1 OR username = $2",
        [user.id, user.username],
      );
      if (!exists.rowCount) {
        const password = await hashPassword(config.DEMO_USER_PASSWORD);
        await pool.query(
          `INSERT INTO user_accounts(
             id, username, display_name, password_hash, password_salt
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            user.id,
            user.username,
            user.displayName,
            password.hash,
            password.salt,
          ],
        );
      }
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
