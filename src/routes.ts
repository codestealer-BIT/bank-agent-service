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
import {
  datacenters,
  filterMachines,
  infrastructureSummary,
} from "./infrastructure.js";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  scheduleLabel,
  triggerScheduleNow,
  updateSchedule,
  type RecurrenceKind,
} from "./schedule-service.js";

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

const scheduleBodyShape = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(240).default(""),
  prompt: z.string().trim().min(1).max(8_000),
  category: z.string().trim().min(1).max(60).default("custom"),
  icon: z.string().trim().min(1).max(30).default("spark"),
  accent: z.string().trim().min(1).max(30).default("violet"),
  schedule_type: z.enum(["recurring", "one_off"]),
  recurrence_kind: z.enum(["daily", "weekdays", "weekly"]).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  scheduled_for: z.string().datetime().optional().nullable(),
  recipient_email: z.string().trim().email().optional().nullable(),
  timezone: z.string().trim().min(1).max(80).default("Asia/Shanghai"),
  enabled: z.boolean().optional(),
};

const schedulePatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(240).optional(),
  prompt: z.string().trim().min(1).max(8_000).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  icon: z.string().trim().min(1).max(30).optional(),
  accent: z.string().trim().min(1).max(30).optional(),
  schedule_type: z.enum(["recurring", "one_off"]).optional(),
  recurrence_kind: z.enum(["daily", "weekdays", "weekly"]).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  minute: z.coerce.number().int().min(0).max(59).optional(),
  scheduled_for: z.string().datetime().optional().nullable(),
  recipient_email: z.string().trim().email().optional().nullable(),
  timezone: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
});

const scheduleBody = z
  .object(scheduleBodyShape)
  .superRefine((value, ctx) => {
    if (value.schedule_type === "recurring" && !value.recurrence_kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrence_kind"],
        message: "Recurring schedule requires recurrence_kind",
      });
    }
    if (
      value.schedule_type === "recurring" &&
      value.recurrence_kind === "weekly" &&
      value.weekday == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekday"],
        message: "Weekly schedule requires weekday",
      });
    }
    if (value.schedule_type === "one_off" && !value.scheduled_for) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduled_for"],
        message: "One-off schedule requires scheduled_for",
      });
    }
    if (value.category === "daily-email-report" && !value.recipient_email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipient_email"],
        message: "Email schedule requires recipient_email",
      });
    }
  });

type ConversationRow = {
  id: string;
  user_id: string;
  letta_conversation_id: string | null;
  agent_id: string | null;
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

  app.get("/v1/schedules/templates", async () => ({
    templates: [
      {
        key: "daily-overview",
        category: "常规巡检",
        icon: "heart",
        accent: "coral",
        name: "每日健康巡检",
        description: "每天自动总结基础设施整体健康状况。",
        prompt:
          "请汇总当前所有机房的机器数量、正常/告警/离线分布，并指出最值得关注的异常资产。",
        schedule_type: "recurring",
        recurrence_kind: "daily",
        weekday: null,
        hour: 9,
        minute: 0,
      },
      {
        key: "weekly-risk",
        category: "周报摘要",
        icon: "spark",
        accent: "mint",
        name: "周风险摘要",
        description: "每周一早上汇总上周高风险资产与异常趋势。",
        prompt:
          "请总结上周所有告警与离线机器，按机房分组，突出高 CPU、高内存与多次离线的重点机器。",
        schedule_type: "recurring",
        recurrence_kind: "weekly",
        weekday: 1,
        hour: 9,
        minute: 0,
      },
      {
        key: "weekday-brief",
        category: "交接简报",
        icon: "calendar",
        accent: "gold",
        name: "工作日收盘简报",
        description: "每个工作日收盘前生成运维简报。",
        prompt:
          "请生成今日运维简报：包含异常机器、重点机房、需要明天继续跟进的事项。",
        schedule_type: "recurring",
        recurrence_kind: "weekdays",
        weekday: null,
        hour: 18,
        minute: 0,
      },
      {
        key: "daily-email-report",
        category: "邮件报告",
        icon: "mail",
        accent: "blue",
        name: "每日运维邮件",
        description: "每天汇总基础设施运行情况并发送到预设邮箱。",
        prompt:
          "请先调用基础设施查询工具汇总全部机房的机器数量、正常/告警/离线分布与重点异常。确认内容不包含密码、密钥、客户数据或其他敏感信息后，调用 send_email 工具发送一封纯文本邮件。邮件主题为“澄川银行每日运维简报”，正文应简洁列出总体状态、重点异常和建议跟进事项。每次执行只能发送一封邮件。",
        schedule_type: "recurring",
        recurrence_kind: "daily",
        weekday: null,
        hour: 18,
        minute: 0,
      },
    ],
  }));

  app.get("/v1/infrastructure/datacenters", async () => ({
    datacenters,
  }));

  app.get<{
    Querystring: {
      datacenter_ids?: string;
      status?: string;
      keyword?: string;
      limit?: string;
    };
  }>("/v1/infrastructure/machines", async (request) => {
    const query = z
      .object({
        datacenter_ids: z.string().optional(),
        status: z.enum(["healthy", "warning", "offline"]).optional(),
        keyword: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(request.query);
    const datacenterIds = query.datacenter_ids
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      machines: filterMachines({
        datacenterIds,
        status: query.status,
        keyword: query.keyword,
        limit: query.limit,
      }),
    };
  });

  app.get<{
    Querystring: { datacenter_ids?: string };
  }>("/v1/infrastructure/summary", async (request) => {
    const query = z
      .object({ datacenter_ids: z.string().optional() })
      .parse(request.query);
    const datacenterIds =
      query.datacenter_ids
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) ?? [];
    return infrastructureSummary(datacenterIds);
  });

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

  app.get("/v1/schedules", async (request) => {
    const userId = await getAuthenticatedUserId(request);
    const schedules = await listSchedules(userId);
    return {
      schedules: schedules.map((schedule) => ({
        ...schedule,
        schedule_label: scheduleLabel(schedule),
      })),
    };
  });

  app.post("/v1/schedules", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request);
    const body = scheduleBody.parse(request.body ?? {});
    const schedule = await createSchedule({
      userId,
      name: body.name,
      description: body.description,
      prompt: body.prompt,
      category: body.category,
      icon: body.icon,
      accent: body.accent,
      scheduleType: body.schedule_type,
      recurrenceKind: body.recurrence_kind as RecurrenceKind | null | undefined,
      weekday: body.weekday,
      hour: body.hour,
      minute: body.minute,
      scheduledFor: body.scheduled_for ? new Date(body.scheduled_for) : null,
      recipientEmail: body.recipient_email,
      timezone: body.timezone,
    });
    return reply.code(201).send({
      ...schedule,
      schedule_label: scheduleLabel(schedule),
    });
  });

  app.patch<{ Params: { scheduleId: string } }>(
    "/v1/schedules/:scheduleId",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const scheduleId = z.string().uuid().parse(request.params.scheduleId);
      const body = schedulePatchBody.parse(request.body ?? {});
      const schedule = await updateSchedule(userId, scheduleId, {
        name: body.name,
        description: body.description,
        prompt: body.prompt,
        category: body.category,
        icon: body.icon,
        accent: body.accent,
        scheduleType: body.schedule_type,
        recurrenceKind: body.recurrence_kind as RecurrenceKind | null | undefined,
        weekday: body.weekday,
        hour: body.hour,
        minute: body.minute,
        scheduledFor:
          typeof body.scheduled_for === "string"
            ? new Date(body.scheduled_for)
            : body.scheduled_for,
        recipientEmail: body.recipient_email,
        timezone: body.timezone,
        enabled: body.enabled,
      });
      if (!schedule) {
        return reply.code(404).send({ error: "Schedule not found" });
      }
      return {
        ...schedule,
        schedule_label: scheduleLabel(schedule),
      };
    },
  );

  app.delete<{ Params: { scheduleId: string } }>(
    "/v1/schedules/:scheduleId",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const scheduleId = z.string().uuid().parse(request.params.scheduleId);
      const deleted = await deleteSchedule(userId, scheduleId);
      if (!deleted) {
        return reply.code(404).send({ error: "Schedule not found" });
      }
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { scheduleId: string } }>(
    "/v1/schedules/:scheduleId/trigger",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const scheduleId = z.string().uuid().parse(request.params.scheduleId);
      const triggered = await triggerScheduleNow(userId, scheduleId);
      if (!triggered.found) {
        return reply.code(404).send({ error: "Schedule not found" });
      }
      return reply.code(202).send({
        accepted: true,
        conversation_id: triggered.conversationId,
      });
    },
  );

  app.post("/v1/auth/logout", async (request, reply) => {
    await destroyAuthenticatedSession(request, reply);
    return reply.code(204).send();
  });

  app.post("/v1/conversations", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request);
    const body = createConversationBody.parse(request.body ?? {});
    const agentId = await getOrCreateUserAgent(userId);
    const id = randomUUID();
    const result = await pool.query<ConversationRow>(
      `INSERT INTO conversations(id, user_id, agent_id, title)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, userId, agentId, body.title ?? null],
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
            lettaConversationId:
              conversation.agent_id === agentId
                ? conversation.letta_conversation_id
                : null,
            message: body.message,
          });

          const databaseClient = await pool.connect();
          try {
            await databaseClient.query("BEGIN");
            await databaseClient.query(
              `UPDATE conversations
               SET letta_conversation_id = $1,
                   agent_id = $2,
                   updated_at = now()
               WHERE id = $3 AND user_id = $4`,
              [result.lettaConversationId, agentId, conversationId, userId],
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
      return { agent_id: agentId, files: await readUserMemory(agentId, userId) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { agent_id: agentId, files: [] };
      }
      throw error;
    }
  });
}
