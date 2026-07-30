import type { AnyAgentTool } from "@letta-ai/letta-agent-sdk";
import { z } from "zod";
import { pool } from "./database.js";
import {
  datacenters,
  filterMachines,
  findMachine,
  findMaintenanceVendor,
  infrastructureSummary,
} from "./infrastructure.js";
import { containsSensitiveKnowledge, normalizeTags } from "./knowledge-policy.js";
import { sendConfiguredEmail } from "./mail-service.js";
import { saveMemory, searchMemory } from "./memory-service.js";
import { getSkill, listSkills } from "./skill-service.js";

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

const listMachinesInput = z.object({
  datacenter_ids: z.array(z.string()).optional(),
  status: z.enum(["healthy", "warning", "offline"]).optional(),
  keyword: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const machineInput = z.object({
  ip_or_hostname: z.string().min(1),
});

const vendorInput = z.object({
  vendor_id_or_name: z.string().min(1),
});

const skillInput = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
});

const summaryInput = z.object({
  datacenter_ids: z.array(z.string()).optional(),
});

const knowledgeInput = z.object({
  title: z.string().trim().min(3).max(200),
  problem: z.string().trim().min(10).max(4_000),
  reusable_solution: z.string().trim().min(10).max(8_000),
  tags: z.array(z.string()).max(8).optional(),
  contains_private_data: z.boolean(),
});

const emailInput = z.object({
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20_000),
});

const memorySearchInput = z.object({
  query: z.string().trim().min(1).max(1_000),
  limit: z.number().int().min(1).max(8).optional(),
});

const memorySaveInput = z.object({
  content: z.string().trim().min(3).max(2_000),
  category: z.string().trim().min(1).max(80).optional(),
  tags: z.array(z.string()).max(8).optional(),
});

export const OPERATIONS_TOOL_NAMES = [
  "list_datacenters",
  "list_machines",
  "get_machine_status",
  "get_maintenance_vendor_contacts",
  "get_infrastructure_summary",
  "load_skill",
  "send_email",
  "submit_shared_knowledge_candidate",
  "memory_search",
  "memory_save",
];

export function createOperationsTools(
  userId: string,
  agentId: string,
  options: { emailRecipient?: string | null } = {},
): AnyAgentTool[] {
  return [
    {
      label: "Memory search",
      name: "memory_search",
      description:
        "Search the shared MemFS used by all authenticated bank employees. Use this before answering when the question may relate to remembered organization-wide facts, plans, policies, procedures, or reusable operations knowledge.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = memorySearchInput.parse(args);
        try {
          return jsonResult(
            await searchMemory({
              agentId,
              query: input.query,
              limit: input.limit,
            }),
          );
        } catch (error) {
          console.warn("Semantic memory tool is temporarily unavailable", error);
          return jsonResult({
            available: false,
            memories: [],
            reason: "Semantic memory retrieval is temporarily unavailable.",
          });
        }
      },
    },
    {
      label: "Memory save",
      name: "memory_save",
      description:
        "Silently write a concise item to the bank-wide shared MemFS before answering when the current text or extracted attachment establishes a durable organization-wide fact, institutional strategy, KPI, confirmed plan, policy, procedure, implementation schedule, or verified reusable operations lesson. The user does not need to ask you to remember it. Never reveal that this tool was called or whether it succeeded. Do not save drafts, hypotheticals, personal information, private discussions, passwords, keys, tokens, authorization codes, customer data, or raw conversation transcripts.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          category: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["content"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = memorySaveInput.parse(args);
        return jsonResult(
          await saveMemory({
            agentId,
            content: input.content,
            category: input.category,
            tags: input.tags,
          }),
        );
      },
    },
    {
      label: "机房列表",
      name: "list_datacenters",
      description: "列出所有可查询的虚构机房及其基本信息。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return jsonResult(datacenters);
      },
    },
    {
      label: "机器查询",
      name: "list_machines",
      description:
        "按机房、运行状态或关键词查询机器。可用于回答某机房有多少机器、哪些机器告警等问题。",
      parameters: {
        type: "object",
        properties: {
          datacenter_ids: {
            type: "array",
            items: { type: "string" },
          },
          status: {
            type: "string",
            enum: ["healthy", "warning", "offline"],
          },
          keyword: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = listMachinesInput.parse(args);
        return jsonResult(
          filterMachines({
            datacenterIds: input.datacenter_ids,
            status: input.status,
            keyword: input.keyword,
            limit: input.limit,
          }),
        );
      },
    },
    {
      label: "机器状态",
      name: "get_machine_status",
      description: "根据 IP 地址或主机名查询一台机器的完整运行状态。",
      parameters: {
        type: "object",
        properties: {
          ip_or_hostname: { type: "string" },
        },
        required: ["ip_or_hostname"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = machineInput.parse(args);
        return jsonResult(
          findMachine(input.ip_or_hostname) ?? {
            error: "Machine not found",
          },
        );
      },
    },
    {
      label: "维保厂商联系人",
      name: "get_maintenance_vendor_contacts",
      description:
        "根据维保厂商编号或名称查询厂商联系人、手机号、邮箱、服务范围和响应级别。通常先查询机器状态，再使用机器记录中的维保厂商调用本工具。",
      parameters: {
        type: "object",
        properties: {
          vendor_id_or_name: { type: "string" },
        },
        required: ["vendor_id_or_name"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = vendorInput.parse(args);
        const vendor = findMaintenanceVendor(input.vendor_id_or_name);
        return jsonResult(
          vendor
            ? { found: true, vendor }
            : {
                found: false,
                error: "Maintenance vendor not found",
                query: input.vendor_id_or_name,
              },
        );
      },
    },
    {
      label: "加载技能",
      name: "load_skill",
      description:
        "按技能名加载完整的标准操作说明。用户使用 /技能名 显式调用时必须加载；普通对话与某个技能的名称或描述明显匹配时也应主动加载。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", pattern: "^[a-z0-9-]+$" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = skillInput.parse(args);
        const skill = getSkill(input.name);
        return jsonResult(
          skill
            ? {
                found: true,
                name: skill.name,
                description: skill.description,
                instructions: skill.instructions,
              }
            : {
                found: false,
                error: "Skill not found",
                available_skills: listSkills(),
              },
        );
      },
    },
    {
      label: "运行概览",
      name: "get_infrastructure_summary",
      description:
        "统计全部或指定机房的机器总数、正常数、告警数、离线数和平均资源利用率。",
      parameters: {
        type: "object",
        properties: {
          datacenter_ids: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = summaryInput.parse(args);
        return jsonResult(infrastructureSummary(input.datacenter_ids));
      },
    },
    {
      label: "发送运维邮件",
      name: "send_email",
      description:
        "向当前日常安排绑定的收件邮箱发送纯文本邮件；普通对话则使用管理员预设的默认收件人。仅在用户明确要求发信或日常安排明确要求发送报告时调用；不得发送密码、密钥、客户数据或其他敏感信息。收件人由后端注入，模型无法修改。",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", minLength: 1, maxLength: 160 },
          body: { type: "string", minLength: 1, maxLength: 20_000 },
        },
        required: ["subject", "body"],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = emailInput.parse(args);
        try {
          const result = await sendConfiguredEmail(input, options.emailRecipient);
          return jsonResult({
            sent: true,
            message_id: result.messageId,
            recipient_policy: "fixed_by_server",
          });
        } catch (error) {
          return jsonResult({
            sent: false,
            error:
              error instanceof Error
                ? error.message
                : "邮件发送失败，请稍后重试。",
          });
        }
      },
    },
    {
      label: "提交公共知识候选",
      name: "submit_shared_knowledge_candidate",
      description:
        "仅当本次问题形成了可复用、已验证且不含用户隐私或凭据的解决经验时调用。提交内容进入审核队列，不会直接写入共享记忆。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          problem: { type: "string" },
          reusable_solution: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          contains_private_data: { type: "boolean" },
        },
        required: [
          "title",
          "problem",
          "reusable_solution",
          "contains_private_data",
        ],
        additionalProperties: false,
      },
      async execute(_toolCallId, args) {
        const input = knowledgeInput.parse(args);
        const combined = `${input.title}\n${input.problem}\n${input.reusable_solution}`;
        if (input.contains_private_data || containsSensitiveKnowledge(combined)) {
          return jsonResult({
            accepted: false,
            reason: "Candidate contains private or sensitive information.",
          });
        }
        await pool.query(
          `INSERT INTO knowledge_candidates(
             source_user_id, title, problem, reusable_solution, tags, status
           ) VALUES ($1, $2, $3, $4, $5, 'pending')
          `,
          [
            userId,
            input.title,
            input.problem,
            input.reusable_solution,
            normalizeTags(input.tags),
          ],
        );
        // Candidate identifiers and review state are backend audit metadata.
        // The model only needs to know whether the silent submission succeeded;
        // exposing internal IDs encourages it to repeat implementation details
        // in the user-facing answer.
        return jsonResult({
          accepted: true,
          user_notification_required: false,
        });
      },
    },
  ];
}
