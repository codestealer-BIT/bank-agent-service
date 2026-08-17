import pg from "pg";
import { config } from "./config.js";
import {
  encryptMailAuthCode,
  hasMailCredentialEncryptionKey,
} from "./credential-crypto.js";
import { normalizeEmailForLookup, normalizePhoneForLookup } from "./identity.js";
import { hashPassword } from "./security.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

const migration = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS email_normalized TEXT;

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_email_normalized_idx
  ON user_accounts(email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_accounts_phone_idx
  ON user_accounts(phone)
  WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_mail_credentials (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  encrypted_auth_code TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS turn_attachments (
  id UUID PRIMARY KEY,
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'document', 'text_file', 'file')),
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER,
  data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (turn_id, position)
);

CREATE INDEX IF NOT EXISTS turn_attachments_turn_idx
  ON turn_attachments(turn_id, position);

CREATE INDEX IF NOT EXISTS turn_attachments_user_idx
  ON turn_attachments(user_id, id);

CREATE TABLE IF NOT EXISTS attachment_uploads (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachment_uploads_user_created_idx
  ON attachment_uploads(user_id, created_at);

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflection_status TEXT
    CHECK (memory_reflection_status IN ('processing', 'completed', 'failed'));

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflected_at TIMESTAMPTZ;

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS memory_reflection_error TEXT;

ALTER TABLE turns
  ADD COLUMN IF NOT EXISTS attachment_context JSONB NOT NULL DEFAULT '[]'::jsonb;

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

CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, path, chunk_index)
);

CREATE INDEX IF NOT EXISTS memory_chunks_agent_model_idx
  ON memory_chunks(agent_id, embedding_model);

CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx
  ON memory_chunks USING hnsw (embedding vector_cosine_ops);

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
      {
        id: "demo-user-a",
        username: "usera",
        displayName: "顾彦航",
        email: config.DEMO_USER_A_EMAIL ?? config.SMTP_USER ?? null,
        phone: config.DEMO_USER_A_PHONE,
        password: config.DEMO_USER_A_PASSWORD,
      },
      {
        id: "demo-user-b",
        username: "userb",
        displayName: "林清和",
        email: config.DEMO_USER_B_EMAIL ?? null,
        phone: config.DEMO_USER_B_PHONE,
        password: config.DEMO_USER_B_PASSWORD,
      },
    ];
    for (const user of demoUsers) {
      const password = await hashPassword(user.password);
      const emailNormalized = user.email
        ? normalizeEmailForLookup(user.email)
        : null;
      await pool.query(
        `INSERT INTO user_accounts(
           id, username, display_name, email, email_normalized, phone,
           password_hash, password_salt
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           email_normalized = EXCLUDED.email_normalized,
           phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           enabled = true`,
        [
          user.id,
          user.username,
          user.displayName,
          user.email,
          emailNormalized,
          normalizePhoneForLookup(user.phone),
          password.hash,
          password.salt,
        ],
      );
    }

    if (
      config.SMTP_USER &&
      config.SMTP_AUTH_CODE &&
      hasMailCredentialEncryptionKey()
    ) {
      const encryptedAuthCode = encryptMailAuthCode(
        config.SMTP_AUTH_CODE,
        "demo-user-a",
        config.DEMO_USER_A_EMAIL ?? config.SMTP_USER,
      );
      await pool.query(
        `INSERT INTO user_mail_credentials(user_id, encrypted_auth_code)
         VALUES ('demo-user-a', $1)
         ON CONFLICT (user_id) DO NOTHING`,
        [encryptedAuthCode],
      );
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
