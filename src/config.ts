import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .default("postgres://bank_agent:bank_agent@postgres:5432/bank_agent"),
  REDIS_URL: z.string().default("redis://redis:6379"),
  AGENT_MODEL: z.string().default("lmstudio/MiniMax-M3"),
  AGENT_NAME: z.string().default("澄川智能助手"),
  LETTA_LOCAL_BACKEND_DIR: z.string().default("/data/letta"),
  MAX_GLOBAL_TURNS: z.coerce.number().int().positive().default(32),
  TURN_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  TURN_LEASE_MS: z.coerce.number().int().positive().default(600_000),
  LETTA_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600_000),
  CORS_ORIGINS: z.string().default("http://localhost:8080"),
  SESSION_COOKIE_NAME: z.string().default("bank_agent_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEMO_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  DEMO_USER_PASSWORD: z.string().min(10).default("LettaDemo@2026"),
});

export const config = envSchema.parse(process.env);

export const corsOrigins = new Set(
  config.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
