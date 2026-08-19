import { config } from "./config.js";
import { getOrCreateUserAgent, runConversationTurn } from "./agent-service.js";
import {
  advanceInfrastructureSimulation,
  findMaintenanceVendor,
  type Machine,
  type MachineTransition,
} from "./infrastructure.js";
import { sendUserEmail } from "./mail-service.js";

const MAX_EVENTS_PER_EMAIL = 3;

let telemetryTimer: NodeJS.Timeout | null = null;
let alignedStartTimer: NodeJS.Timeout | null = null;
let emailSending = false;
let lastEmailAttemptAt = 0;
const pendingTransitions: MachineTransition[] = [];

function beijingTime(value: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function statusLabel(status: Machine["status"]): string {
  return status === "warning" ? "告警" : status === "offline" ? "离线" : "正常";
}

function transitionSnapshot(transition: MachineTransition): string {
  const machine = transition.machine;
  return [
    `${machine.hostname}（${machine.ip}）刚刚转为${statusLabel(machine.status)}`,
    `发生时间（北京时间）：${beijingTime(transition.occurred_at)}`,
    `机房/机柜/用途：${machine.datacenter_name} / ${machine.rack} / ${machine.role}`,
    `CPU/内存：${machine.status === "offline" ? "无实时数据" : `${machine.cpu_percent}% / ${machine.memory_percent}%`}`,
    `最后心跳（北京时间）：${beijingTime(machine.last_heartbeat)}`,
  ].join("\n");
}

function fallbackDiagnosis(machine: Machine): string {
  if (machine.status === "offline") {
    return "可能原因包括主机断电或重启、网络链路或交换端口中断、操作系统失去响应、监控代理退出。建议先从同机房网络连通性、带外管理、电源及最近变更记录依次核查；心跳中断只是信号，不能单独证明硬件故障。";
  }
  if (machine.cpu_percent >= 80 && machine.memory_percent >= 80) {
    return "CPU 与内存同时高位，常见于突发业务流量、批处理或查询放大、进程泄漏/失控、日志或监控任务异常重试。建议先确认进程排行、负载趋势、交换/分页和近期发布，再决定限流、扩容或重启单个异常进程。";
  }
  if (machine.cpu_percent >= 80) {
    return "CPU 高位但内存相对正常，可能由计算密集任务、异常请求、慢查询或进程忙循环引起。建议核对进程 CPU、请求量、慢查询和近期发布。";
  }
  return "内存高位但 CPU 相对正常，可能由缓存增长、连接或对象未释放、批量任务占用引起。建议核对进程 RSS、缓存命中、交换空间与 OOM 记录。";
}

function vendorSection(machine: Machine): string {
  const vendor = findMaintenanceVendor(machine.maintenance_vendor_id);
  if (!vendor) return `维保厂商：${machine.maintenance_vendor_name}（通讯录暂无详情）`;
  const contacts = vendor.contacts
    .map(
      (contact) =>
        `- ${contact.name}（${contact.title}）：${contact.mobile}，${contact.email}，${contact.availability}`,
    )
    .join("\n");
  return [
    `维保厂商：${vendor.name}`,
    `服务级别：${vendor.service_level}`,
    `服务热线：${vendor.hotline}`,
    `服务邮箱：${vendor.email}`,
    contacts,
  ].join("\n");
}

function deterministicAlertBody(transitions: MachineTransition[]): string {
  const sections = transitions.map((transition, index) =>
    [
      `${index + 1}. 告警对象`,
      transitionSnapshot(transition),
    ].join("\n"),
  );
  return [
    "澄川银行运维团队：",
    "",
    `监控系统检测到 ${transitions.length} 台机器发生新的告警/离线状态跃迁。此邮件已按冷却策略合并，同一持续异常不会重复发送。`,
    "",
    sections.join("\n\n----------------------------------------\n\n"),
  ].join("\n");
}

async function generateMemoryAwareDiagnosis(
  transitions: MachineTransition[],
): Promise<string> {
  const agentId = await getOrCreateUserAgent(config.INFRA_ALERT_USER_ID);
  const facts = transitions.map(transitionSnapshot).join("\n\n");
  const result = await runConversationTurn({
    userId: config.INFRA_ALERT_USER_ID,
    agentId,
    lettaConversationId: null,
    includeEmailTool: false,
    message: [
      "这是后台基础设施告警邮件的分析任务。请结合注入的共享公有运维记忆和以下冻结快照，分析每台机器最可能的 2-4 个原因，并给出安全的核查顺序。",
      "不要调用发送邮件工具，不要虚构监控值、日志结论或厂商信息，不要声称可能性就是事实。只输出简洁的纯文本‘智能分析与建议’部分。",
      "",
      facts,
    ].join("\n"),
  });
  return result.answer.trim();
}

async function sendPendingAlertEmail(): Promise<void> {
  if (
    emailSending ||
    !pendingTransitions.length ||
    !config.SMTP_ENABLED ||
    !config.INFRA_ALERT_RECIPIENT ||
    Date.now() - lastEmailAttemptAt < config.INFRA_ALERT_EMAIL_COOLDOWN_MS
  ) {
    return;
  }

  emailSending = true;
  lastEmailAttemptAt = Date.now();
  const batch = pendingTransitions.slice(0, MAX_EVENTS_PER_EMAIL);
  try {
    let intelligentAnalysis: string;
    try {
      intelligentAnalysis = await generateMemoryAwareDiagnosis(batch);
    } catch (error) {
      console.warn(
        "[infrastructure-monitor] shared-memory diagnosis unavailable; using safe fallback",
        error instanceof Error ? error.message : "unknown error",
      );
      intelligentAnalysis = batch
        .map(
          (transition) =>
            `${transition.machine.hostname}：${fallbackDiagnosis(transition.machine)}`,
        )
        .join("\n\n");
    }

    const affectedNames = batch.map((item) => item.machine.hostname).join("、");
    const body = [
      deterministicAlertBody(batch),
      "",
      "========================================",
      "智能分析与建议（结合共享公有运维记忆）",
      intelligentAnalysis,
      "",
      "请以现场监控、日志和变更记录复核以上可能原因。",
      "",
      "========================================",
      "维保厂商信息",
      batch
        .map((transition) => vendorSection(transition.machine))
        .join("\n\n"),
    ].join("\n");
    await sendUserEmail(
      config.INFRA_ALERT_USER_ID,
      {
        subject: `【澄川银行运维告警】${affectedNames} 刚刚发生告警/离线`,
        body,
      },
      config.INFRA_ALERT_RECIPIENT,
    );
    pendingTransitions.splice(0, batch.length);
    console.info(
      `[infrastructure-monitor] sent a merged alert email for ${affectedNames}`,
    );
  } catch (error) {
    console.error(
      "[infrastructure-monitor] alert email delivery failed",
      error instanceof Error ? error.message : "unknown error",
    );
  } finally {
    emailSending = false;
  }
}

export function runInfrastructureMonitorTick(now = new Date()): MachineTransition[] {
  const transitions = advanceInfrastructureSimulation({
    now,
    incidentChancePerMinute: config.INFRA_INCIDENT_CHANCE_PER_MINUTE,
    multipleIncidentChance: config.INFRA_MULTIPLE_INCIDENT_CHANCE,
    maxActiveIncidents: config.INFRA_MAX_ACTIVE_INCIDENTS,
  });
  for (const transition of transitions) {
    if (
      !pendingTransitions.some(
        (queued) =>
          queued.machine.id === transition.machine.id &&
          queued.machine.status === transition.machine.status,
      )
    ) {
      pendingTransitions.push(transition);
    }
  }
  void sendPendingAlertEmail();
  return transitions;
}

export function startInfrastructureMonitor(): void {
  if (!config.INFRA_MONITOR_ENABLED || telemetryTimer || alignedStartTimer) return;
  runInfrastructureMonitorTick(new Date());
  const delayUntilBoundary =
    config.INFRA_MONITOR_INTERVAL_MS -
    (Date.now() % config.INFRA_MONITOR_INTERVAL_MS);
  alignedStartTimer = setTimeout(() => {
    alignedStartTimer = null;
    runInfrastructureMonitorTick(new Date());
    telemetryTimer = setInterval(
      () => runInfrastructureMonitorTick(new Date()),
      config.INFRA_MONITOR_INTERVAL_MS,
    );
    telemetryTimer.unref();
  }, delayUntilBoundary);
  alignedStartTimer.unref();
}

export function stopInfrastructureMonitor(): void {
  if (alignedStartTimer) clearTimeout(alignedStartTimer);
  if (telemetryTimer) clearInterval(telemetryTimer);
  alignedStartTimer = null;
  telemetryTimer = null;
}
