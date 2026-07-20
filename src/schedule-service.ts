import { randomUUID } from "node:crypto";
import { pool } from "./database.js";
import {
  getOrCreateUserAgent,
  runConversationTurn,
} from "./agent-service.js";
import { withDistributedLock } from "./redis-leases.js";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SCHEDULER_POLL_MS = 30_000;
const SCHEDULER_BATCH_SIZE = 12;

export type ScheduleType = "recurring" | "one_off";
export type RecurrenceKind = "daily" | "weekdays" | "weekly";

export type ScheduleRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
  icon: string;
  accent: string;
  environment_label: string;
  conversation_target: "new";
  schedule_type: ScheduleType;
  timezone: string;
  recurrence_kind: RecurrenceKind | null;
  weekday: number | null;
  hour: number;
  minute: number;
  scheduled_for: Date | null;
  recipient_email: string | null;
  next_run_at: Date;
  last_run_at: Date | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

type ScheduleInput = {
  userId: string;
  name: string;
  description: string;
  prompt: string;
  category?: string;
  icon?: string;
  accent?: string;
  scheduleType: ScheduleType;
  recurrenceKind?: RecurrenceKind | null;
  weekday?: number | null;
  hour: number;
  minute: number;
  scheduledFor?: Date | null;
  recipientEmail?: string | null;
  timezone?: string;
};

type ScheduleUpdateInput = {
  name?: string;
  description?: string;
  prompt?: string;
  category?: string;
  icon?: string;
  accent?: string;
  scheduleType?: ScheduleType;
  recurrenceKind?: RecurrenceKind | null;
  weekday?: number | null;
  hour?: number;
  minute?: number;
  scheduledFor?: Date | null;
  recipientEmail?: string | null;
  timezone?: string;
  enabled?: boolean;
};

type ScheduledExecutionContext = {
  runId: string;
  requestId: string;
  conversationId: string;
  agentId: string;
  schedule: ScheduleRow;
  firedAt: Date;
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;

function toShanghaiParts(date: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
} {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function fromShanghaiParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_MS);
}

function addShanghaiDays(base: Date, days: number): Date {
  const shifted = new Date(base.getTime() + SHANGHAI_OFFSET_MS);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return new Date(shifted.getTime() - SHANGHAI_OFFSET_MS);
}

function computeRecurringNextRun(
  recurrenceKind: RecurrenceKind,
  weekday: number | null,
  hour: number,
  minute: number,
  from = new Date(),
): Date {
  const parts = toShanghaiParts(from);
  const todayCandidate = fromShanghaiParts(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
  );

  if (recurrenceKind === "daily") {
    return todayCandidate > from ? todayCandidate : addShanghaiDays(todayCandidate, 1);
  }

  if (recurrenceKind === "weekdays") {
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = addShanghaiDays(todayCandidate, offset);
      const candidateWeekday = toShanghaiParts(candidate).weekday;
      if (candidateWeekday >= 1 && candidateWeekday <= 5 && candidate > from) {
        return candidate;
      }
    }
  }

  const targetWeekday = weekday ?? 1;
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = addShanghaiDays(todayCandidate, offset);
    if (toShanghaiParts(candidate).weekday === targetWeekday && candidate > from) {
      return candidate;
    }
  }

  return addShanghaiDays(todayCandidate, 7);
}

export function scheduleLabel(schedule: Pick<
  ScheduleRow,
  "schedule_type" | "recurrence_kind" | "weekday" | "hour" | "minute" | "scheduled_for"
>): string {
  if (schedule.schedule_type === "one_off" && schedule.scheduled_for) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(schedule.scheduled_for);
  }

  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const hour = String(schedule.hour).padStart(2, "0");
  const minute = String(schedule.minute).padStart(2, "0");
  if (schedule.recurrence_kind === "daily") return `每天 ${hour}:${minute}`;
  if (schedule.recurrence_kind === "weekdays") return `工作日 ${hour}:${minute}`;
  return `${weekdays[schedule.weekday ?? 1]} ${hour}:${minute}`;
}

function computeNextRunAt(input: {
  scheduleType: ScheduleType;
  recurrenceKind?: RecurrenceKind | null;
  weekday?: number | null;
  hour: number;
  minute: number;
  scheduledFor?: Date | null;
  from?: Date;
}): Date {
  if (input.scheduleType === "one_off") {
    if (!input.scheduledFor) throw new Error("One-off schedule requires scheduledFor");
    return input.scheduledFor;
  }
  if (!input.recurrenceKind) {
    throw new Error("Recurring schedule requires recurrenceKind");
  }
  return computeRecurringNextRun(
    input.recurrenceKind,
    input.weekday ?? null,
    input.hour,
    input.minute,
    input.from,
  );
}

export async function listSchedules(userId: string): Promise<ScheduleRow[]> {
  const result = await pool.query<ScheduleRow>(
    `SELECT * FROM schedules
     WHERE user_id = $1
     ORDER BY enabled DESC, next_run_at ASC, created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function createSchedule(input: ScheduleInput): Promise<ScheduleRow> {
  const nextRunAt = computeNextRunAt({
    scheduleType: input.scheduleType,
    recurrenceKind: input.recurrenceKind,
    weekday: input.weekday,
    hour: input.hour,
    minute: input.minute,
    scheduledFor: input.scheduledFor,
  });

  const result = await pool.query<ScheduleRow>(
    `INSERT INTO schedules(
       id, user_id, name, description, prompt, category, icon, accent,
       environment_label, conversation_target, schedule_type, timezone,
       recurrence_kind, weekday, hour, minute, scheduled_for, recipient_email, next_run_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       'bank-runtime', 'new', $9, $10,
       $11, $12, $13, $14, $15, $16, $17
     )
     RETURNING *`,
    [
      randomUUID(),
      input.userId,
      input.name,
      input.description,
      input.prompt,
      input.category ?? "custom",
      input.icon ?? "spark",
      input.accent ?? "violet",
      input.scheduleType,
      input.timezone ?? "Asia/Shanghai",
      input.recurrenceKind ?? null,
      input.weekday ?? null,
      input.hour,
      input.minute,
      input.scheduledFor ?? null,
      input.recipientEmail ?? null,
      nextRunAt,
    ],
  );
  return result.rows[0];
}

export async function updateSchedule(
  userId: string,
  scheduleId: string,
  patch: ScheduleUpdateInput,
): Promise<ScheduleRow | null> {
  const existing = await pool.query<ScheduleRow>(
    "SELECT * FROM schedules WHERE id = $1 AND user_id = $2",
    [scheduleId, userId],
  );
  const current = existing.rows[0];
  if (!current) return null;

  const merged = {
    ...current,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    prompt: patch.prompt ?? current.prompt,
    category: patch.category ?? current.category,
    icon: patch.icon ?? current.icon,
    accent: patch.accent ?? current.accent,
    schedule_type: patch.scheduleType ?? current.schedule_type,
    recurrence_kind: patch.recurrenceKind ?? current.recurrence_kind,
    weekday: patch.weekday ?? current.weekday,
    hour: patch.hour ?? current.hour,
    minute: patch.minute ?? current.minute,
    scheduled_for: patch.scheduledFor ?? current.scheduled_for,
    recipient_email: patch.recipientEmail ?? current.recipient_email,
    timezone: patch.timezone ?? current.timezone,
    enabled: patch.enabled ?? current.enabled,
  };

  const nextRunAt =
    merged.enabled
      ? computeNextRunAt({
          scheduleType: merged.schedule_type,
          recurrenceKind: merged.recurrence_kind,
          weekday: merged.weekday,
          hour: merged.hour,
          minute: merged.minute,
          scheduledFor: merged.scheduled_for,
          from: new Date(),
        })
      : current.next_run_at;

  const result = await pool.query<ScheduleRow>(
    `UPDATE schedules
     SET name = $3,
         description = $4,
         prompt = $5,
         category = $6,
         icon = $7,
         accent = $8,
         schedule_type = $9,
         recurrence_kind = $10,
         weekday = $11,
         hour = $12,
         minute = $13,
         scheduled_for = $14,
         recipient_email = $15,
         timezone = $16,
         enabled = $17,
         next_run_at = $18,
         updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      scheduleId,
      userId,
      merged.name,
      merged.description,
      merged.prompt,
      merged.category,
      merged.icon,
      merged.accent,
      merged.schedule_type,
      merged.recurrence_kind,
      merged.weekday,
      merged.hour,
      merged.minute,
      merged.scheduled_for,
      merged.recipient_email,
      merged.timezone,
      merged.enabled,
      nextRunAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function deleteSchedule(
  userId: string,
  scheduleId: string,
): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM schedules WHERE id = $1 AND user_id = $2",
    [scheduleId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function prepareScheduleExecution(
  schedule: ScheduleRow,
  firedAt: Date,
): Promise<ScheduledExecutionContext> {
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO schedule_runs(id, schedule_id, user_id, status)
     VALUES ($1, $2, $3, 'processing')`,
    [runId, schedule.id, schedule.user_id],
  );

  const agentId = await getOrCreateUserAgent(schedule.user_id);
  const conversationId = randomUUID();
  const requestId = randomUUID();

  await pool.query(
    `INSERT INTO conversations(id, user_id, agent_id, title)
     VALUES ($1, $2, $3, $4)`,
    [conversationId, schedule.user_id, agentId, `[安排] ${schedule.name}`],
  );

  await pool.query(
    `INSERT INTO turns(
       id, request_id, conversation_id, user_id, user_message, status
     ) VALUES ($1, $2, $3, $4, $5, 'processing')`,
    [
      randomUUID(),
      requestId,
      conversationId,
      schedule.user_id,
      schedule.prompt,
    ],
  );

  return {
    runId,
    requestId,
    conversationId,
    agentId,
    schedule,
    firedAt,
  };
}

async function executePreparedScheduleTask(
  context: ScheduledExecutionContext,
): Promise<string> {
  const { runId, requestId, conversationId, agentId, schedule, firedAt } = context;

  try {
    const result = await runConversationTurn({
      userId: schedule.user_id,
      agentId,
      lettaConversationId: null,
      message: schedule.prompt,
      emailRecipient: schedule.recipient_email,
    });

    const nextRunAt =
      schedule.schedule_type === "one_off"
        ? null
        : computeNextRunAt({
            scheduleType: schedule.schedule_type,
            recurrenceKind: schedule.recurrence_kind,
            weekday: schedule.weekday,
            hour: schedule.hour,
            minute: schedule.minute,
            scheduledFor: schedule.scheduled_for,
            from: new Date(firedAt.getTime() + 60_000),
          });

    const databaseClient = await pool.connect();
    try {
      await databaseClient.query("BEGIN");
      await databaseClient.query(
        `UPDATE conversations
         SET letta_conversation_id = $1,
             agent_id = $2,
             updated_at = now()
         WHERE id = $3`,
        [result.lettaConversationId, agentId, conversationId],
      );
      await databaseClient.query(
        `UPDATE turns
         SET assistant_message = $1,
             status = 'completed',
             duration_ms = $2,
             completed_at = now()
         WHERE request_id = $3 AND user_id = $4`,
        [result.answer, result.durationMs, requestId, schedule.user_id],
      );
      await databaseClient.query(
        `UPDATE schedules
         SET last_run_at = $2,
             next_run_at = COALESCE($3, next_run_at),
             enabled = CASE WHEN $3 IS NULL THEN false ELSE enabled END,
             updated_at = now()
         WHERE id = $1`,
        [schedule.id, firedAt, nextRunAt],
      );
      await databaseClient.query(
        `UPDATE schedule_runs
         SET status = 'completed',
             conversation_id = $2,
             finished_at = now()
         WHERE id = $1`,
        [runId, conversationId],
      );
      await databaseClient.query("COMMIT");
    } catch (error) {
      await databaseClient.query("ROLLBACK");
      throw error;
    } finally {
      databaseClient.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE turns
       SET status = 'failed', error = $1, completed_at = now()
       WHERE request_id = $2 AND user_id = $3`,
      [message, requestId, schedule.user_id],
    );
    await pool.query(
      `UPDATE schedule_runs
       SET status = 'failed', error = $2, finished_at = now()
       WHERE id = $1`,
      [runId, message],
    );
    throw error;
  }

  return conversationId;
}

async function executeScheduleTask(
  schedule: ScheduleRow,
  firedAt: Date,
): Promise<string> {
  const context = await prepareScheduleExecution(schedule, firedAt);
  return executePreparedScheduleTask(context);
}

async function runDueSchedule(scheduleId: string): Promise<void> {
  await withDistributedLock(
    `schedule:${scheduleId}`,
    async () => {
      const result = await pool.query<ScheduleRow>(
        "SELECT * FROM schedules WHERE id = $1",
        [scheduleId],
      );
      const schedule = result.rows[0];
      if (!schedule || !schedule.enabled) return;

      const now = new Date();
      if (schedule.next_run_at.getTime() > now.getTime()) return;
      await executeScheduleTask(schedule, now);
    },
    { timeoutMs: 2_000, leaseMs: 600_000 },
  );
}

async function pollDueSchedules(): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const result = await pool.query<{ id: string }>(
      `SELECT id
       FROM schedules
       WHERE enabled = true AND next_run_at <= now()
       ORDER BY next_run_at ASC
       LIMIT $1`,
      [SCHEDULER_BATCH_SIZE],
    );
    for (const row of result.rows) {
      try {
        await runDueSchedule(row.id);
      } catch (error) {
        console.error("[scheduler] failed to execute schedule", row.id, error);
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startScheduleWorker(): void {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void pollDueSchedules();
  }, SCHEDULER_POLL_MS);
  schedulerTimer.unref();
  void pollDueSchedules();
}

export function stopScheduleWorker(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export async function triggerScheduleNow(
  userId: string,
  scheduleId: string,
): Promise<{ found: boolean; conversationId?: string }> {
  const result = await pool.query<ScheduleRow>(
    "SELECT * FROM schedules WHERE id = $1 AND user_id = $2",
    [scheduleId, userId],
  );
  const schedule = result.rows[0];
  if (!schedule) return { found: false };
  const output = await withDistributedLock(
    `schedule:${scheduleId}:manual`,
    async () => {
      const context = await prepareScheduleExecution(schedule, new Date());
      void executePreparedScheduleTask(context).catch((error) => {
        console.error("[scheduler] manual trigger failed", scheduleId, error);
      });
      return { found: true as const, conversationId: context.conversationId };
    },
    { timeoutMs: 5_000, leaseMs: 600_000 },
  );
  return output;
}
