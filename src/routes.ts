import { createHash, randomUUID } from "node:crypto";
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
  verifyCurrentUserPassword,
} from "./auth.js";
import { pool } from "./database.js";
import { redis, withDistributedLock } from "./redis-leases.js";
import {
  datacenters,
  filterMachines,
  infrastructureSummary,
  maintenanceVendors,
} from "./infrastructure.js";
import { listSkills } from "./skill-service.js";
import {
  getUserMailStatus,
  saveUserMailAuthCode,
} from "./user-mail-service.js";
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

const loginBody = z
  .object({
    identifier: z.string().trim().min(3).max(254).optional(),
    username: z.string().trim().min(3).max(254).optional(),
    password: z.string().min(1).max(256),
  })
  .superRefine((value, ctx) => {
    if (!value.identifier && !value.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identifier"],
        message: "请输入邮箱、手机号或用户名",
      });
    }
  })
  .transform((value) => ({
    identifier: (value.identifier ?? value.username ?? "").trim(),
    password: value.password,
  }));

const stepUpBody = z.object({
  password: z.string().min(1).max(256),
  purpose: z.literal("create_daily_email_schedule"),
});

const EMAIL_SCHEDULE_STEP_UP_TTL_SECONDS = 5 * 60;

function emailScheduleStepUpKey(token: string): string {
  const digest = createHash("sha256").update(token).digest("hex");
  return `step-up:create-daily-email-schedule:${digest}`;
}

async function consumeEmailScheduleStepUpToken(
  userId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const result = await redis.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then
       redis.call('del', KEYS[1])
       return 1
     end
     return 0`,
    1,
    emailScheduleStepUpKey(token),
    userId,
  );
  return result === 1;
}

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
    display_message: z.string().trim().max(32_000).optional(),
    request_id: z.string().trim().min(1).max(128).optional(),
    attachments: z.array(attachmentBody).max(4).optional(),
    attachment_upload_ids: z.array(z.string().uuid()).max(4).optional(),
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
      if (
        attachment.media_type === "application/pdf" ||
        /\.pdf$/i.test(attachment.name)
      ) {
        return {
          kind: "pdf",
          name: attachment.name,
          mediaType: "application/pdf",
          data: attachment.data,
          size: attachment.size,
        };
      }
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

const scheduleBodyShape = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(240).default(""),
  prompt: z.string().trim().min(1).max(8_000),
  category: z.string().trim().min(1).max(60).default("custom"),
  icon: z.string().trim().min(1).max(30).default("spark"),
  accent: z.string().trim().min(1).max(30).default("violet"),
  schedule_type: z.literal("recurring"),
  recurrence_kind: z.enum(["daily", "weekdays", "weekly"]).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59),
  scheduled_for: z.string().datetime().optional().nullable(),
  recipient_email: z.string().trim().email().optional().nullable(),
  sender_auth_code: z.string().trim().min(4).max(128).optional(),
  reauth_token: z.string().uuid().optional(),
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
  schedule_type: z.literal("recurring").optional(),
  recurrence_kind: z.enum(["daily", "weekdays", "weekly"]).optional().nullable(),
  weekday: z.coerce.number().int().min(0).max(6).optional().nullable(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  minute: z.coerce.number().int().min(0).max(59).optional(),
  scheduled_for: z.string().datetime().optional().nullable(),
  recipient_email: z.string().trim().email().optional().nullable(),
  sender_auth_code: z.string().trim().min(4).max(128).optional(),
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

type IncomingAttachment = z.infer<typeof attachmentBody>;

async function loadUploadedAttachments(
  userId: string,
  uploadIds: string[] | undefined,
): Promise<IncomingAttachment[] | null> {
  if (!uploadIds?.length) return [];
  const result = await pool.query<{ id: string; payload: unknown }>(
    `SELECT id, payload FROM attachment_uploads
     WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [userId, uploadIds],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row.payload]));
  const attachments: IncomingAttachment[] = [];
  for (const uploadId of uploadIds) {
    const parsed = attachmentBody.safeParse(byId.get(uploadId));
    if (!parsed.success) return null;
    attachments.push(parsed.data);
  }
  return attachments;
}

async function createProcessingTurn(input: {
  requestId: string;
  conversationId: string;
  userId: string;
  userMessage: string;
  attachments?: IncomingAttachment[];
}): Promise<boolean> {
  const databaseClient = await pool.connect();
  try {
    await databaseClient.query("BEGIN");
    const turnId = randomUUID();
    const inserted = await databaseClient.query<{ id: string }>(
      `INSERT INTO turns(
         id, request_id, conversation_id, user_id, user_message, status
       ) VALUES ($1, $2, $3, $4, $5, 'processing')
       ON CONFLICT (user_id, request_id) DO NOTHING
       RETURNING id`,
      [
        turnId,
        input.requestId,
        input.conversationId,
        input.userId,
        input.userMessage,
      ],
    );
    if (!inserted.rowCount) {
      await databaseClient.query("COMMIT");
      return false;
    }
    for (const [position, attachment] of (input.attachments ?? []).entries()) {
      const data =
        attachment.kind === "image"
          ? Buffer.from(attachment.data, "base64")
          : null;
      await databaseClient.query(
        `INSERT INTO turn_attachments(
           id, turn_id, user_id, position, kind, name, media_type, size, data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          turnId,
          input.userId,
          position,
          attachment.kind,
          attachment.name,
          attachment.media_type,
          attachment.size ?? data?.length ?? null,
          data,
        ],
      );
    }
    await databaseClient.query("COMMIT");
    return true;
  } catch (error) {
    await databaseClient.query("ROLLBACK");
    throw error;
  } finally {
    databaseClient.release();
  }
}

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
  uploadedAttachmentIds?: string[];
}): Promise<void> {
  const {
    app,
    jobId,
    requestId,
    userId,
    conversationId,
    body,
    uploadedAttachmentIds,
  } = input;
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
        await createProcessingTurn({
          requestId,
          conversationId,
          userId,
          userMessage: body.display_message ?? body.message,
          attachments: body.attachments,
        });
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
                 duration_ms = $2, attachment_context = $3::jsonb,
                 completed_at = now()
             WHERE user_id = $4 AND request_id = $5`,
            [
              result.answer,
              result.durationMs,
              JSON.stringify(result.attachmentContext),
              userId,
              requestId,
            ],
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
  } finally {
    if (uploadedAttachmentIds?.length) {
      await pool.query(
        `DELETE FROM attachment_uploads
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, uploadedAttachmentIds],
      );
    }
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

  app.get("/v1/infrastructure/vendors", async () => ({
    vendors: maintenanceVendors,
  }));

  app.get("/v1/skills", async () => ({
    skills: listSkills(),
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
    const identifierHash = createHash("sha256")
      .update(body.identifier.toLowerCase())
      .digest("hex");
    const throttleKey = `login-attempt:${request.ip}:${identifierHash}`;
    const attempts = Number((await redis.get(throttleKey)) ?? "0");
    if (attempts >= 8) {
      return reply.code(429).send({
        error: "登录尝试过多，请在 15 分钟后重试",
      });
    }

    const user = await authenticateCredentials(body.identifier, body.password);
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

  app.post("/v1/auth/step-up", async (request, reply) => {
    const user = await getAuthenticatedUser(request);
    const body = stepUpBody.parse(request.body ?? {});
    const throttleKey = `step-up-attempt:${request.ip}:${user.id}`;
    const attempts = Number((await redis.get(throttleKey)) ?? "0");
    if (attempts >= 5) {
      return reply.code(429).send({
        error: "密码复核尝试过多，请在 15 分钟后重试",
      });
    }

    const verified = await verifyCurrentUserPassword(user.id, body.password);
    if (!verified) {
      const count = await redis.incr(throttleKey);
      if (count === 1) await redis.expire(throttleKey, 15 * 60);
      return reply.code(401).send({ error: "登录密码不正确" });
    }

    await redis.del(throttleKey);
    const token = randomUUID();
    await redis.set(
      emailScheduleStepUpKey(token),
      user.id,
      "EX",
      EMAIL_SCHEDULE_STEP_UP_TTL_SECONDS,
    );
    return {
      token,
      purpose: body.purpose,
      expires_in: EMAIL_SCHEDULE_STEP_UP_TTL_SECONDS,
    };
  });

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
    if (body.category === "daily-email-report") {
      const mailStatus = await getUserMailStatus(userId);
      if (!mailStatus.email) {
        return reply.code(400).send({ error: "当前账号尚未绑定发件邮箱" });
      }
      if (!mailStatus.authCodeConfigured && !body.sender_auth_code) {
        return reply.code(400).send({
          error: "请先填写当前账号绑定邮箱的授权码",
        });
      }
      const authorized = await consumeEmailScheduleStepUpToken(
        userId,
        body.reauth_token,
      );
      if (!authorized) {
        return reply.code(403).send({
          error: "密码复核已失效，请重新验证后再创建每日运维邮件",
        });
      }
    }
    if (body.sender_auth_code) {
      await saveUserMailAuthCode(userId, body.sender_auth_code);
    }
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
      if (body.sender_auth_code) {
        await saveUserMailAuthCode(userId, body.sender_auth_code);
      }
      if (body.category === "daily-email-report") {
        const mailStatus = await getUserMailStatus(userId);
        if (!mailStatus.email || !mailStatus.authCodeConfigured) {
          return reply.code(400).send({
            error: "请先填写当前账号绑定邮箱的授权码",
          });
        }
      }
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
        `SELECT id, request_id, user_message, assistant_message, status, error,
                duration_ms, created_at, completed_at
         FROM turns
         WHERE conversation_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [conversationId, userId],
      );
      const turnIds = turns.rows.map((turn) => turn.id as string);
      const attachments = turnIds.length
        ? await pool.query<{
            id: string;
            turn_id: string;
            kind: IncomingAttachment["kind"];
            name: string;
            media_type: string;
            size: number | null;
            has_data: boolean;
          }>(
            `SELECT id, turn_id, kind, name, media_type, size,
                    data IS NOT NULL AS has_data
             FROM turn_attachments
             WHERE user_id = $1 AND turn_id = ANY($2::uuid[])
             ORDER BY turn_id, position`,
            [userId, turnIds],
          )
        : { rows: [] };
      const attachmentsByTurn = new Map<string, unknown[]>();
      for (const attachment of attachments.rows) {
        const turnAttachments = attachmentsByTurn.get(attachment.turn_id) ?? [];
        turnAttachments.push({
          id: attachment.id,
          kind: attachment.kind,
          name: attachment.name,
          media_type: attachment.media_type,
          size: attachment.size,
          url: attachment.has_data
            ? `/v1/turn-attachments/${attachment.id}`
            : null,
        });
        attachmentsByTurn.set(attachment.turn_id, turnAttachments);
      }
      return {
        messages: turns.rows.map(({ id, ...turn }) => ({
          ...turn,
          attachments: attachmentsByTurn.get(id as string) ?? [],
        })),
      };
    },
  );

  app.get<{ Params: { attachmentId: string } }>(
    "/v1/turn-attachments/:attachmentId",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const attachmentId = z.string().uuid().parse(request.params.attachmentId);
      const result = await pool.query<{
        name: string;
        media_type: string;
        data: Buffer | null;
      }>(
        `SELECT name, media_type, data
         FROM turn_attachments
         WHERE id = $1 AND user_id = $2`,
        [attachmentId, userId],
      );
      const attachment = result.rows[0];
      if (!attachment?.data) {
        return reply.code(404).send({ error: "Attachment not found" });
      }
      const encodedName = encodeURIComponent(attachment.name);
      reply
        .header("Content-Type", attachment.media_type)
        .header("Content-Length", attachment.data.length)
        .header("Content-Disposition", `inline; filename*=UTF-8''${encodedName}`)
        .header("Cache-Control", "private, no-store, max-age=0")
        .header("X-Content-Type-Options", "nosniff");
      return reply.send(attachment.data);
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
          await createProcessingTurn({
            requestId,
            conversationId,
            userId,
            userMessage: body.display_message ?? body.message,
            attachments: body.attachments,
          });
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
                   duration_ms = $2, attachment_context = $3::jsonb,
                   completed_at = now()
               WHERE user_id = $4 AND request_id = $5`,
              [
                result.answer,
                result.durationMs,
                JSON.stringify(result.attachmentContext),
                userId,
                requestId,
              ],
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

  app.post("/v1/attachment-uploads", async (request, reply) => {
    const userId = await getAuthenticatedUserId(request);
    const attachment = attachmentBody.parse(request.body);
    const uploadId = randomUUID();
    await pool.query(
      `INSERT INTO attachment_uploads(id, user_id, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [uploadId, userId, JSON.stringify(attachment)],
    );
    await pool.query(
      `DELETE FROM attachment_uploads
       WHERE user_id = $1 AND created_at < now() - interval '24 hours'`,
      [userId],
    );
    return reply.code(201).send({ upload_id: uploadId });
  });

  app.delete<{ Params: { uploadId: string } }>(
    "/v1/attachment-uploads/:uploadId",
    async (request, reply) => {
      const userId = await getAuthenticatedUserId(request);
      const uploadId = z.string().uuid().parse(request.params.uploadId);
      await pool.query(
        "DELETE FROM attachment_uploads WHERE id = $1 AND user_id = $2",
        [uploadId, userId],
      );
      return reply.code(204).send();
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

      const uploadedAttachments = await loadUploadedAttachments(
        userId,
        body.attachment_upload_ids,
      );
      if (!uploadedAttachments) {
        return reply.code(400).send({ error: "One or more attachments were not uploaded" });
      }
      const resolvedAttachments = [
        ...(body.attachments ?? []),
        ...uploadedAttachments,
      ];
      if (resolvedAttachments.length > 4) {
        return reply.code(400).send({ error: "A message can include at most 4 attachments" });
      }
      const resolvedAttachmentBytes = resolvedAttachments.reduce(
        (sum, attachment) => sum + (attachment.size ?? 0),
        0,
      );
      if (resolvedAttachmentBytes > 20 * 1024 * 1024) {
        return reply.code(400).send({ error: "Attachments cannot exceed 20MB in total" });
      }
      const resolvedBody = {
        ...body,
        attachments: resolvedAttachments,
      };

      const turnCreated = await createProcessingTurn({
        requestId,
        conversationId,
        userId,
        userMessage: resolvedBody.display_message ?? resolvedBody.message,
        attachments: resolvedBody.attachments,
      });
      if (!turnCreated) {
        const existingTurn = await pool.query<{ conversation_id: string }>(
          `SELECT conversation_id FROM turns
           WHERE user_id = $1 AND request_id = $2`,
          [userId, requestId],
        );
        if (existingTurn.rows[0]?.conversation_id !== conversationId) {
          return reply.code(409).send({ error: "Request ID belongs to another conversation" });
        }
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
          body: resolvedBody,
          uploadedAttachmentIds: body.attachment_upload_ids,
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
      const turnResult = await pool.query<{
        request_id: string;
        conversation_id: string;
        assistant_message: string | null;
        status: "processing" | "completed" | "failed";
        error: string | null;
        duration_ms: number | null;
      }>(
        `SELECT request_id, conversation_id, assistant_message, status, error, duration_ms
         FROM turns WHERE user_id = $1 AND request_id = $2`,
        [userId, jobId],
      );
      const turn = turnResult.rows[0];
      if (!turn) {
        return reply.code(404).send({ error: "Message job not found" });
      }

      const events =
        turn.status === "completed"
          ? [
              {
                type: "final",
                request_id: turn.request_id,
                conversation_id: turn.conversation_id,
                answer: turn.assistant_message ?? "",
                duration_ms: turn.duration_ms,
                recovered_from_database: true,
              },
            ]
          : turn.status === "failed"
            ? [
                {
                  type: "error",
                  request_id: turn.request_id,
                  conversation_id: turn.conversation_id,
                  error: turn.error ?? "Agent job failed",
                  recovered_from_database: true,
                },
              ]
            : [];
      return {
        job_id: jobId,
        request_id: turn.request_id,
        conversation_id: turn.conversation_id,
        status: turn.status === "processing" ? "running" : turn.status,
        error: turn.error,
        events,
        next_cursor: query.after,
        recovered_from_database: true,
      };
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
          await createProcessingTurn({
            requestId,
            conversationId,
            userId,
            userMessage: body.display_message ?? body.message,
            attachments: body.attachments,
          });
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
                   duration_ms = $2, attachment_context = $3::jsonb,
                   completed_at = now()
               WHERE user_id = $4 AND request_id = $5`,
              [
                result.answer,
                result.durationMs,
                JSON.stringify(result.attachmentContext),
                userId,
                requestId,
              ],
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
