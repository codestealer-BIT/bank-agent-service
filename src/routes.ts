import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getOrCreateUserAgent,
  readUserMemory,
  runConversationTurn,
  streamConversationTurn,
  type TurnAttachment,
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
  streamScheduleNow,
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

const imageMediaType = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const attachmentBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    name: z.string().trim().min(1).max(240),
    media_type: imageMediaType,
    data: z.string().trim().min(1).max(6_000_000),
    size: z.number().int().min(0).max(4 * 1024 * 1024).optional(),
  }),
  z.object({
    kind: z.literal("pdf"),
    name: z.string().trim().min(1).max(240),
    media_type: z.literal("application/pdf"),
    data: z.string().trim().min(1).max(28_000_000),
    size: z.number().int().min(1).max(20 * 1024 * 1024),
  }),
  z.object({
    kind: z.literal("document"),
    name: z.string().trim().min(1).max(240),
    media_type: z.string().trim().min(1).max(160),
    data: z.string().trim().min(1).max(28_000_000),
    size: z.number().int().min(1).max(20 * 1024 * 1024),
  }),
  z.object({
    kind: z.literal("text_file"),
    name: z.string().trim().min(1).max(240),
    media_type: z.string().trim().min(1).max(120),
    text: z.string().max(100_000),
    size: z.number().int().min(0).max(512 * 1024).optional(),
  }),
  z.object({
    kind: z.literal("file"),
    name: z.string().trim().min(1).max(240),
    media_type: z.string().trim().min(1).max(120),
    size: z.number().int().min(0).max(20 * 1024 * 1024).optional(),
  }),
]);

const messageBody = z
  .object({
    message: z.string().trim().min(1).max(32_000),
    request_id: z.string().trim().min(1).max(128).optional(),
    attachments: z.array(attachmentBody).max(4).optional(),
  })
  .superRefine((value, ctx) => {
    const totalBytes = (value.attachments ?? []).reduce(
      (sum, attachment) => sum + (attachment.size ?? 0),
      0,
    );
    if (totalBytes > 20 * 1024 * 1024) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attachments"],
        message: "附件总大小不能超过 20MB",
      });
    }
  });

function toTurnAttachments(
  attachments: z.infer<typeof attachmentBody>[] | undefined,
): TurnAttachment[] {
  return (attachments ?? []).map((attachment) => {
    if (attachment.kind === "image") {
      return {
        kind: "image",
        name: attachment.name,
        mediaType: attachment.media_type,
        data: attachment.data,
        size: attachment.size,
      };
    }
    if (attachment.kind === "text_file") {
      return {
        kind: "text_file",
        name: attachment.name,
        mediaType: attachment.media_type,
        text: attachment.text,
        size: attachment.size,
      };
    }
    if (attachment.kind === "pdf") {
      return {
        kind: "pdf",
        name: attachment.name,
        mediaType: attachment.media_type,
        data: attachment.data,
        size: attachment.size,
      };
    }
    if (attachment.kind === "document") {
      return {
        kind: "document",
        name: attachment.name,
        mediaType: attachment.media_type,
        data: attachment.data,
        size: attachment.size,
      };
    }
    return {
      kind: "file",
      name: attachment.name,
      mediaType: attachment.media_type,
      size: attachment.size,
    };
  });
}

function displayMessageWithAttachments(
  message: string,
  attachments: z.infer<typeof attachmentBody>[] | undefined,
): string {
  if (!attachments?.length) return message;
  const summary = attachments
    .map((attachment) => `- ${attachment.name} (${attachment.media_type})`)
    .join("\n");
  return `${message}\n\n[附件]\n${summary}`;
}

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

const MESSAGE_JOB_TTL_SECONDS = 60 * 60;

function messageJobMetaKey(jobId: string): string {
  return `message-job:${jobId}:meta`;
}

function messageJobEventsKey(jobId: string): string {
  return `message-job:${jobId}:events`;
}

async function appendMessageJobEvent(
  jobId: string,
  event: Record<string, unknown>,
): Promise<void> {
  await redis
    .multi()
    .rpush(messageJobEventsKey(jobId), JSON.stringify(event))
    .expire(messageJobEventsKey(jobId), MESSAGE_JOB_TTL_SECONDS)
    .expire(messageJobMetaKey(jobId), MESSAGE_JOB_TTL_SECONDS)
    .exec();
}

async function updateMessageJob(
  jobId: string,
  values: Record<string, string>,
): Promise<void> {
  await redis
    .multi()
    .hset(messageJobMetaKey(jobId), values)
    .expire(messageJobMetaKey(jobId), MESSAGE_JOB_TTL_SECONDS)
    .exec();
}

async function runMessageJob(input: {
  app: FastifyInstance;
  jobId: string;
  requestId: string;
  userId: string;
  conversationId: string;
  body: z.infer<typeof messageBody>;
}): Promise<void> {
  const { app, jobId, requestId, userId, conversationId, body } = input;
  await updateMessageJob(jobId, {
    status: "running",
    updated_at: new Date().toISOString(),
  });
  await appendMessageJobEvent(jobId, {
    type: "start",
    request_id: requestId,
    conversation_id: conversationId,
  });

  try {
    await withDistributedLock(`conversation:${conversationId}`, async () => {
      const conversationResult = await pool.query<ConversationRow>(
        `SELECT * FROM conversations
         WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
      const conversation = conversationResult.rows[0];
      if (!conversation) throw new Error("Conversation not found");

      const existing = await pool.query<TurnRow>(
        `SELECT request_id, assistant_message, status, duration_ms
         FROM turns WHERE user_id = $1 AND request_id = $2`,
        [userId, requestId],
      );
      if (existing.rows[0]?.status === "completed") {
        await appendMessageJobEvent(jobId, {
          type: "final",
          request_id: requestId,
          conversation_id: conversationId,
          answer: existing.rows[0].assistant_message ?? "",
          duration_ms: existing.rows[0].duration_ms,
          idempotent_replay: true,
        });
        return;
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
          [
            randomUUID(),
            requestId,
            conversationId,
            userId,
            displayMessageWithAttachments(body.message, body.attachments),
          ],
        );
      }

      try {
        const result = await streamConversationTurn(
          {
            userId,
            agentId,
            lettaConversationId:
              conversation.agent_id === agentId
                ? conversation.letta_conversation_id
                : null,
            message: body.message,
            attachments: toTurnAttachments(body.attachments),
          },
          (delta) => appendMessageJobEvent(jobId, { type: "delta", text: delta }),
        );

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

        await appendMessageJobEvent(jobId, {
          type: "final",
          request_id: requestId,
          conversation_id: conversationId,
          answer: result.answer,
          duration_ms: result.durationMs,
          idempotent_replay: false,
        });
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

    await updateMessageJob(jobId, {
      status: "completed",
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendMessageJobEvent(jobId, {
      type: "error",
      request_id: requestId,
      conversation_id: conversationId,
      error: message,
    });
    await updateMessageJob(jobId, {
      status: "failed",
      error: message,
      updated_at: new Date().toISOString(),
    });
    app.log.error(
      { err: error, jobId, requestId, conversationId, userId },
      "background message job failed",
    );
  }
}

function writeNdjson(
  reply: import("fastify").FastifyReply,
  event: Record<string, unknown>,
): void {
  reply.raw.write(`${JSON.stringify(event)}\n`);
}

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

  app.post<{ Params: { scheduleId: string } }>(
    "/v1/schedules/:scheduleId/trigger/stream",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const scheduleId = z.string().uuid().parse(request.params.scheduleId);
      const owned = await pool.query(
        "SELECT 1 FROM schedules WHERE id = $1 AND user_id = $2",
        [scheduleId, userId],
      );
      if (!owned.rowCount) {
        return reply.code(404).send({ error: "Schedule not found" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Content-Encoding": "identity",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders();
      reply.raw.socket?.setNoDelay(true);

      const safeWrite = (event: Record<string, unknown>) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          writeNdjson(reply, event);
        }
      };

      try {
        const triggered = await streamScheduleNow(userId, scheduleId, {
          onStart: ({ conversationId, requestId }) => {
            safeWrite({
              type: "start",
              conversation_id: conversationId,
              request_id: requestId,
            });
          },
          onDelta: (delta) => safeWrite({ type: "delta", text: delta }),
        });
        const completed = triggered.requestId
          ? await pool.query<TurnRow>(
              `SELECT request_id, assistant_message, status, duration_ms
               FROM turns WHERE user_id = $1 AND request_id = $2`,
              [userId, triggered.requestId],
            )
          : null;
        safeWrite({
          type: "final",
          conversation_id: triggered.conversationId,
          request_id: triggered.requestId,
          answer: completed?.rows[0]?.assistant_message ?? "",
          duration_ms: completed?.rows[0]?.duration_ms ?? null,
        });
      } catch (error) {
        safeWrite({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
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
            [
              randomUUID(),
              requestId,
              conversationId,
              userId,
              displayMessageWithAttachments(body.message, body.attachments),
            ],
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
            attachments: toTurnAttachments(body.attachments),
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

  app.post<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/message-jobs",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const conversationId = z.string().uuid().parse(request.params.conversationId);
      const body = messageBody.parse(request.body);
      const requestId = body.request_id ?? randomUUID();
      const jobId = requestId;

      const owned = await pool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2",
        [conversationId, userId],
      );
      if (!owned.rowCount) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      const metaKey = messageJobMetaKey(jobId);
      const claimed = await redis.hsetnx(metaKey, "user_id", userId);
      if (claimed === 0) {
        const existingOwner = await redis.hget(metaKey, "user_id");
        if (existingOwner !== userId) {
          return reply.code(404).send({ error: "Message job not found" });
        }
        const existing = await redis.hgetall(metaKey);
        return reply.code(202).send({
          job_id: jobId,
          request_id: requestId,
          conversation_id: existing.conversation_id ?? conversationId,
          status: existing.status ?? "queued",
          idempotent_replay: true,
        });
      }

      await updateMessageJob(jobId, {
        request_id: requestId,
        conversation_id: conversationId,
        status: "queued",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      setImmediate(() => {
        void runMessageJob({
          app,
          jobId,
          requestId,
          userId,
          conversationId,
          body,
        });
      });

      return reply.code(202).send({
        job_id: jobId,
        request_id: requestId,
        conversation_id: conversationId,
        status: "queued",
        idempotent_replay: false,
      });
    },
  );

  app.get<{
    Params: { jobId: string };
    Querystring: { after?: string };
  }>("/v1/message-jobs/:jobId", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request);
    const jobId = z.string().trim().min(1).max(128).parse(request.params.jobId);
    const query = z
      .object({ after: z.coerce.number().int().min(0).max(100_000).default(0) })
      .parse(request.query);
    const metaKey = messageJobMetaKey(jobId);
    const meta = await redis.hgetall(metaKey);
    if (!meta.user_id || meta.user_id !== userId) {
      return reply.code(404).send({ error: "Message job not found" });
    }

    const serializedEvents = await redis.lrange(
      messageJobEventsKey(jobId),
      query.after,
      -1,
    );
    const events = serializedEvents.flatMap((serialized) => {
      try {
        return [JSON.parse(serialized) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    return {
      job_id: jobId,
      request_id: meta.request_id,
      conversation_id: meta.conversation_id,
      status: meta.status ?? "queued",
      error: meta.error || null,
      events,
      next_cursor: query.after + events.length,
    };
  });

  app.post<{ Params: { conversationId: string } }>(
    "/v1/conversations/:conversationId/messages/stream",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const conversationId = z.string().uuid().parse(request.params.conversationId);
      const body = messageBody.parse(request.body);
      const requestId = body.request_id ?? randomUUID();

      const conversationResult = await pool.query<ConversationRow>(
        `SELECT * FROM conversations
         WHERE id = $1 AND user_id = $2`,
        [conversationId, userId],
      );
      const conversation = conversationResult.rows[0];
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Content-Encoding": "identity",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders();
      reply.raw.socket?.setNoDelay(true);

      const safeWrite = (event: Record<string, unknown>) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          writeNdjson(reply, event);
        }
      };

      await withDistributedLock(`conversation:${conversationId}`, async () => {
        safeWrite({
          type: "start",
          request_id: requestId,
          conversation_id: conversationId,
        });

        const existing = await pool.query<TurnRow>(
          `SELECT request_id, assistant_message, status, duration_ms
           FROM turns WHERE user_id = $1 AND request_id = $2`,
          [userId, requestId],
        );
        if (existing.rows[0]?.status === "completed") {
          safeWrite({
            type: "final",
            request_id: requestId,
            conversation_id: conversationId,
            answer: existing.rows[0].assistant_message ?? "",
            duration_ms: existing.rows[0].duration_ms,
            idempotent_replay: true,
          });
          return;
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
            [
              randomUUID(),
              requestId,
              conversationId,
              userId,
              displayMessageWithAttachments(body.message, body.attachments),
            ],
          );
        }

        try {
          const result = await streamConversationTurn(
            {
              userId,
              agentId,
              lettaConversationId:
                conversation.agent_id === agentId
                  ? conversation.letta_conversation_id
                  : null,
              message: body.message,
              attachments: toTurnAttachments(body.attachments),
            },
            (delta) => safeWrite({ type: "delta", text: delta }),
          );

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

          safeWrite({
            type: "final",
            request_id: requestId,
            conversation_id: conversationId,
            answer: result.answer,
            duration_ms: result.durationMs,
            idempotent_replay: false,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await pool.query(
            `UPDATE turns
             SET status = 'failed', error = $1, completed_at = now()
             WHERE user_id = $2 AND request_id = $3`,
            [message, userId, requestId],
          );
          safeWrite({
            type: "error",
            request_id: requestId,
            conversation_id: conversationId,
            error: message,
          });
        }
      });

      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
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
