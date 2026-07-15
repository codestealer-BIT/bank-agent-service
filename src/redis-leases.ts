import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

const releaseLockScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const refreshLockScript = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const acquireSemaphoreScript = `
redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1])
if redis.call('zcard', KEYS[1]) < tonumber(ARGV[2]) then
  redis.call('zadd', KEYS[1], ARGV[3], ARGV[4])
  redis.call('pexpire', KEYS[1], ARGV[5])
  return 1
end
return 0
`;

const refreshSemaphoreScript = `
if redis.call('zscore', KEYS[1], ARGV[1]) then
  redis.call('zadd', KEYS[1], ARGV[2], ARGV[1])
  redis.call('pexpire', KEYS[1], ARGV[3])
  return 1
end
return 0
`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLock(
  key: string,
  timeoutMs: number,
  leaseMs: number,
): Promise<string> {
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await redis.set(key, token, "PX", leaseMs, "NX");
    if (result === "OK") return token;
    await delay(75 + Math.floor(Math.random() * 75));
  }
  throw new Error(`Timed out waiting for serialized work on ${key}`);
}

export async function withDistributedLock<T>(
  key: string,
  work: () => Promise<T>,
  options: { timeoutMs?: number; leaseMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? config.TURN_QUEUE_TIMEOUT_MS;
  const leaseMs = options.leaseMs ?? config.TURN_LEASE_MS;
  const token = await waitForLock(`lock:${key}`, timeoutMs, leaseMs);
  const heartbeat = setInterval(() => {
    void redis.eval(
      refreshLockScript,
      1,
      `lock:${key}`,
      token,
      String(leaseMs),
    );
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref();
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await redis.eval(releaseLockScript, 1, `lock:${key}`, token);
  }
}

async function acquireSemaphore(
  key: string,
  limit: number,
  timeoutMs: number,
  leaseMs: number,
): Promise<string> {
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = Date.now();
    const acquired = await redis.eval(
      acquireSemaphoreScript,
      1,
      key,
      String(now),
      String(limit),
      String(now + leaseMs),
      token,
      String(leaseMs * 2),
    );
    if (acquired === 1) return token;
    await delay(100 + Math.floor(Math.random() * 100));
  }
  throw new Error("The model concurrency queue is full");
}

export async function withGlobalTurnSlot<T>(
  work: () => Promise<T>,
): Promise<T> {
  const key = "semaphore:llm-turns";
  const token = await acquireSemaphore(
    key,
    config.MAX_GLOBAL_TURNS,
    config.TURN_QUEUE_TIMEOUT_MS,
    config.TURN_LEASE_MS,
  );
  const heartbeat = setInterval(() => {
    const expiresAt = Date.now() + config.TURN_LEASE_MS;
    void redis.eval(
      refreshSemaphoreScript,
      1,
      key,
      token,
      String(expiresAt),
      String(config.TURN_LEASE_MS * 2),
    );
  }, Math.max(1_000, Math.floor(config.TURN_LEASE_MS / 3)));
  heartbeat.unref();
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await redis.zrem(key, token);
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
