import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalEmail = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().email().optional(),
);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z
    .string()
    .default("postgres://bank_agent:bank_agent@postgres:5432/bank_agent"),
  REDIS_URL: z.string().default("redis://redis:6379"),
  AGENT_MODEL: z.string().default("lmstudio/MiniMax-M3"),
  AGENT_FALLBACK_MODELS: z
    .string()
    .default("Kimi-K3,GLM-5.2,Kimi-K2.7-Code")
    .transform((value) =>
      value
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  AGENT_PRIMARY_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(2),
  AGENT_FALLBACK_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(1),
  AGENT_FAILOVER_BACKOFF_BASE_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(30_000)
    .default(500),
  AGENT_FAILOVER_BACKOFF_MAX_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(120_000)
    .default(8_000),
  AGENT_REASONING_EFFORT: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
    .default("none"),
  AGENT_NAME: z.string().default("澄川智能助手"),
  SHARED_AGENT_SCOPE: z.string().default("bank-operations-demo"),
  LETTA_LOCAL_BACKEND_DIR: z.string().default("/data/letta"),
  MAX_GLOBAL_TURNS: z.coerce.number().int().positive().default(32),
  TURN_QUEUE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  TURN_LEASE_MS: z.coerce.number().int().positive().default(600_000),
  LETTA_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(600_000),
  LETTA_COMPACTION_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(700_000),
  MEMORY_REFLECTION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  MEMORY_REFLECTION_POLL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300_000),
  MEMORY_REFLECTION_BATCH_SIZE: z.coerce.number().int().positive().default(12),
  INFRA_MONITOR_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  INFRA_MONITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .default(60_000),
  INFRA_INCIDENT_CHANCE_PER_MINUTE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.04),
  INFRA_MULTIPLE_INCIDENT_CHANCE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.12),
  INFRA_MAX_ACTIVE_INCIDENTS: z.coerce.number().int().min(1).max(5).default(2),
  INFRA_ALERT_EMAIL_COOLDOWN_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(900_000),
  INFRA_ALERT_RECIPIENT: optionalEmail.default("813624374@qq.com"),
  INFRA_ALERT_USER_ID: z.string().trim().min(1).default("demo-user-a"),
  RAG_EMBEDDING_BASE_URL: z
    .string()
    .url()
    .default("http://embeddings:80"),
  RAG_EMBEDDING_API_KEY: optionalNonEmptyString,
  RAG_EMBEDDING_MODEL: z.string().trim().min(1).default("BAAI/bge-m3"),
  RAG_EMBEDDING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  RAG_CHUNK_CHARS: z.coerce.number().int().min(300).max(4_000).default(1_200),
  RAG_CHUNK_OVERLAP_CHARS: z.coerce
    .number()
    .int()
    .min(0)
    .max(800)
    .default(180),
  RAG_MIN_SIMILARITY: z.coerce.number().min(-1).max(1).default(0.42),
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
  DEMO_USER_A_PASSWORD: z.string().min(10).default("GuYanHang@2026!47"),
  DEMO_USER_A_EMAIL: optionalEmail,
  DEMO_USER_A_PHONE: z.string().trim().min(6).default("13800001001"),
  DEMO_USER_B_PASSWORD: z.string().min(10).default("LinQingHe@2026!83"),
  DEMO_USER_B_EMAIL: optionalEmail.default("2113950574@qq.com"),
  DEMO_USER_B_PHONE: z.string().trim().min(6).default("13800001002"),
  MAIL_CREDENTIAL_ENCRYPTION_KEY: optionalNonEmptyString,
  SMTP_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_HOST: z.string().trim().min(1).default("smtp.qq.com"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  SMTP_USER: optionalEmail,
  SMTP_AUTH_CODE: optionalNonEmptyString,
  SMTP_DEFAULT_TO: optionalEmail,
  SMTP_FROM_NAME: z.string().trim().min(1).default("澄川智能运维助手"),
});

export const config = envSchema.parse(process.env);

export const corsOrigins = new Set(
  config.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
