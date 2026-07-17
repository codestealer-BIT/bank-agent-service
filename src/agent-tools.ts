import type { AnyAgentTool } from "@letta-ai/letta-agent-sdk";
import { z } from "zod";
import { pool } from "./database.js";
import {
  datacenters,
  filterMachines,
  findMachine,
  infrastructureSummary,
} from "./infrastructure.js";
import { containsSensitiveKnowledge, normalizeTags } from "./knowledge-policy.js";

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

export const OPERATIONS_TOOL_NAMES = [
  "list_datacenters",
  "list_machines",
  "get_machine_status",
  "get_infrastructure_summary",
  "submit_shared_knowledge_candidate",
];

export function createOperationsTools(userId: string): AnyAgentTool[] {
  return [
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
        const result = await pool.query<{ id: string }>(
          `INSERT INTO knowledge_candidates(
             source_user_id, title, problem, reusable_solution, tags, status
           ) VALUES ($1, $2, $3, $4, $5, 'pending')
           RETURNING id`,
          [
            userId,
            input.title,
            input.problem,
            input.reusable_solution,
            normalizeTags(input.tags),
          ],
        );
        return jsonResult({
          accepted: true,
          candidate_id: result.rows[0].id,
          status: "pending_review",
        });
      },
    },
  ];
}
