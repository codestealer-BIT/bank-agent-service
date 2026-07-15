import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getOrCreateUserAgent,
  readUserMemory,
  runConversationTurn,
} from "./agent-service.js";
import {
  authenticateCredentials,
  createAuthenticatedSession,
  destroyAuthenticatedSession,
  getAuthenticatedUser,
  getAuthenticatedUserId,
} from "./auth.js";
import { pool } from "./database.js";
import { redis, withDistributedLock } from "./redis-leases.js";

const loginBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  password: z.string().min(1).max(256),
});

const createConversationBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const messageBody = z.object({
  message: z.string().trim().min(1).max(32_000),
  request_id: z.string().trim().min(1).max(128).optional(),
});

type ConversationRow = {
  id: string;
  user_id: string;
  letta_conversation_id: string | null;
  title: string | null;
  created_at: Date;
  updated_at: Date;
};

type TurnRow = {
  request_id: string;
  assistant_message: string | null;
  status: "processing" | "completed" | "failed";
  duration_ms: number | null;
};

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.post("/v1/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    const throttleKey = `login-attempt:${request.ip}:${body.username}`;
    const attempts = Number((await redis.get(throttleKey)) ?? "0");
    if (attempts >= 8) {
      return reply.code(429).send({
        error: "登录尝试过多，请在 15 分钟后重试",
      });
    }

    const user = await authenticateCredentials(body.username, body.password);
    if (!user) {
      const count = await redis.incr(throttleKey);
      if (count === 1) await redis.expire(throttleKey, 15 * 60);
      return reply.code(401).send({ error: "账号或密码不正确" });
    }

    await redis.del(throttleKey);
    await createAuthenticatedSession(user.id, reply);
    return { user };
  });

  app.get("/v1/auth/me", async (request) => ({
    user: await getAuthenticatedUser(request),
  }));

  app.post("/v1/auth/logout", async (request, reply) => {
    await destroyAuthenticatedSession(request, reply);
    return reply.code(204).send();
  });

  app.post("/v1/conversations", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request);
    const body = createConversationBody.parse(request.body ?? {});
    await getOrCreateUserAgent(userId);
    const id = randomUUID();
    const result = await pool.query<ConversationRow>(
      `INSERT INTO conversations(id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, userId, body.title ?? null],
    );
    return reply.code(201).send(result.rows[0]);
  });

  app.get("/v1/conversations", async (request) => {
    const userId = await getAuthenticatedUserId(request);
    const result = await pool.query<ConversationRow>(
      `SELECT * FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId],
    );
    return { conversations: result.rows };
  });

  app.get<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const conversationId = z.string().uuid().parse(request.params.conversationId);
      const owned = await pool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2",
        [conversationId, userId],
      );
      if (!owned.rowCount) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const turns = await pool.query(
        `SELECT request_id, user_message, assistant_message, status, error,
                duration_ms, created_at, completed_at
         FROM turns
         WHERE conversation_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [conversationId, userId],
      );
      return { messages: turns.rows };
    },
  );

  app.post<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const conversationId = z.string().uuid().parse(request.params.conversationId);
      const body = messageBody.parse(request.body);
      const requestId = body.request_id ?? randomUUID();

      return withDistributedLock(`conversation:${conversationId}`, async () => {
        const conversationResult = await pool.query<ConversationRow>(
          `SELECT * FROM conversations
           WHERE id = $1 AND user_id = $2`,
          [conversationId, userId],
        );
        const conversation = conversationResult.rows[0];
        if (!conversation) {
          return reply.code(404).send({ error: "Conversation not found" });
        }

        const existing = await pool.query<TurnRow>(
          `SELECT request_id, assistant_message, status, duration_ms
           FROM turns WHERE user_id = $1 AND request_id = $2`,
          [userId, requestId],
        );
        if (existing.rows[0]?.status === "completed") {
          return {
            request_id: requestId,
            conversation_id: conversationId,
            answer: existing.rows[0].assistant_message ?? "",
            duration_ms: existing.rows[0].duration_ms,
            idempotent_replay: true,
          };
        }

        const agentId = await getOrCreateUserAgent(userId);
        if (existing.rowCount) {
          await pool.query(
            `UPDATE turns SET status = 'processing', error = NULL
             WHERE user_id = $1 AND request_id = $2`,
            [userId, requestId],
          );
        } else {
          await pool.query(
            `INSERT INTO turns(
               id, request_id, conversation_id, user_id, user_message, status
             ) VALUES ($1, $2, $3, $4, $5, 'processing')`,
            [randomUUID(), requestId, conversationId, userId, body.message],
          );
        }

        try {
          const result = await runConversationTurn({
            userId,
            agentId,
            lettaConversationId: conversation.letta_conversation_id,
            message: body.message,
          });

          const databaseClient = await pool.connect();
          try {
            await databaseClient.query("BEGIN");
            await databaseClient.query(
              `UPDATE conversations
               SET letta_conversation_id = COALESCE(letta_conversation_id, $1),
                   updated_at = now()
               WHERE id = $2 AND user_id = $3`,
              [result.lettaConversationId, conversationId, userId],
            );
            await databaseClient.query(
              `UPDATE turns
               SET assistant_message = $1, status = 'completed', error = NULL,
                   duration_ms = $2, completed_at = now()
               WHERE user_id = $3 AND request_id = $4`,
              [result.answer, result.durationMs, userId, requestId],
            );
            await databaseClient.query("COMMIT");
          } catch (error) {
            await databaseClient.query("ROLLBACK");
            throw error;
          } finally {
            databaseClient.release();
          }

          return {
            request_id: requestId,
            conversation_id: conversationId,
            answer: result.answer,
            duration_ms: result.durationMs,
            idempotent_replay: false,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await pool.query(
            `UPDATE turns
             SET status = 'failed', error = $1, completed_at = now()
             WHERE user_id = $2 AND request_id = $3`,
            [message, userId, requestId],
          );
          throw error;
        }
      });
    },
  );

  app.get("/v1/memory", async (request) => {
    const userId = await getAuthenticatedUserId(request);
    const agentId = await getOrCreateUserAgent(userId);
    try {
      return { agent_id: agentId, files: await readUserMemory(agentId) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { agent_id: agentId, files: [] };
      }
      throw error;
    }
  });
}
