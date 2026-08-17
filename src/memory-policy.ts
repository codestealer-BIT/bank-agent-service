export const BANK_OPERATIONS_MEMORY_CATEGORIES = [
  "bank_operations_lesson",
  "bank_operations_policy",
] as const;

export type BankOperationsMemoryCategory =
  (typeof BANK_OPERATIONS_MEMORY_CATEGORIES)[number];

export function isBankOperationsMemoryCategory(
  value: unknown,
): value is BankOperationsMemoryCategory {
  return BANK_OPERATIONS_MEMORY_CATEGORIES.includes(
    value as BankOperationsMemoryCategory,
  );
}

export const BANK_OPERATIONS_MEMORY_SCOPE_POLICY = [
  "Only two memory categories are allowed: bank_operations_lesson for a verified, reusable lesson learned from bank infrastructure or IT operations; and bank_operations_policy for a confirmed, long-lived bank operations regulation, policy, standard, or procedure.",
  "Eligible bank operations topics include monitoring, incidents, availability, capacity, infrastructure maintenance, change management, backup, disaster recovery, production networks, systems security operations, and stable operating procedures for those areas.",
  "Never save general academic or research knowledge, papers, competition or student-project materials, investment or due-diligence analysis, product pitches, business strategy, business KPI, credit or financing analysis, customer or marketing knowledge, or other material outside bank infrastructure and IT operations, even if the material mentions banks, finance, risk, security, data, AI, or possible bank applications.",
  "A bank_operations_lesson must be supported by a real and verified bank operations situation in the provided text, attachment, transcript, or tool evidence. Do not turn a generic document, external case, model suggestion, transient tool failure, current configuration gap, or one-off status into a durable lesson.",
  "A bank_operations_policy must be explicitly presented as a confirmed and currently applicable bank operations rule or procedure and must be reasonably stable over time. Do not save drafts, proposals, plans, schedules, targets, forecasts, or temporary instructions as policy.",
  "If relevance, verification, durability, or policy status is uncertain, do not call memory_save. Do not broaden or rewrite unrelated material to make it appear relevant to bank operations.",
  "Before saving an eligible item, search memory for the same lesson or policy to avoid duplicates. If a confirmed policy version conflicts with an older version, preserve clear version and effective-date context rather than silently combining them.",
  "If and only if an item satisfies all eligibility requirements, call memory_save. Save one concise, self-contained memory; do not copy the raw transcript or entire attachment.",
  "Do not save personal preferences, identity facts, private discussions, customer data, credentials, authorization codes, secrets, or raw conversation text.",
] as const;

/**
 * System-level policy for immediate, silent formation of shared memory.
 *
 * The policy is stored once in the agent persona. It must not be copied into
 * individual user turns because doing so duplicates it throughout history.
 */
export const IMMEDIATE_SHARED_MEMORY_POLICY = [
  "Before answering each turn, consider the user's text and successfully extracted attachments only for durable knowledge that is directly and materially about bank infrastructure or bank IT operations.",
  ...BANK_OPERATIONS_MEMORY_SCOPE_POLICY,
  "Memory maintenance is completely invisible to end users. Never state or imply that memory was checked, written, updated, skipped, failed, submitted, queued, or stored. Never expose tool names, memory paths, scopes, IDs, review status, or backend bookkeeping. After any memory action, answer only the user's business request.",
] as const;
