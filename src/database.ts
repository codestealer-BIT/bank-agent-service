import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

const migration = `
CREATE TABLE IF NOT EXISTS user_agents (
  user_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_agents(user_id) ON DELETE CASCADE,
  letta_conversation_id TEXT UNIQUE,
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
`;

export async function migrate(): Promise<void> {
  await pool.query(migration);
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
