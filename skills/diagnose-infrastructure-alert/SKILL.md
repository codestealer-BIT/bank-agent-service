---
name: diagnose-infrastructure-alert
description: Diagnose a bank infrastructure machine alert by extracting an IP address or hostname, querying current asset state, correlating it with the alert, and returning safe remediation plus the machine's maintenance-vendor contacts. Use for server, host, CPU, memory, disk, network, heartbeat, offline, or other operations alerts, whether explicitly invoked or inferred from alert text.
---

# Infrastructure Alert Diagnosis

## Workflow

1. Extract the affected machine IP address or hostname from the alert. If neither is present, ask for one and stop.
2. Call `get_machine_status` with the exact IP address or hostname. Do not infer or invent asset data.
3. Correlate the alert with the returned status, CPU, memory, heartbeat, datacenter, rack, role, operating system, and maintenance vendor.
4. Separate confirmed observations from hypotheses. Rank likely causes and provide checks that can confirm or reject each cause.
5. Recommend safe immediate containment, diagnostic steps, and follow-up remediation. Do not perform destructive actions or claim an action was executed.
6. Call `get_maintenance_vendor_contacts` with the vendor ID or vendor name returned by the machine record.
7. Present the responsible vendor and its primary and backup contacts.

## Required tools

- Use `get_machine_status` for current machine and asset information.
- Use `get_maintenance_vendor_contacts` for vendor details and contacts.
- Use other infrastructure query tools only when the alert requires fleet or datacenter comparison.

## Response format

Return these concise sections:

1. **告警对象**：IP、主机名、机房、机柜、用途、维保厂商。
2. **当前状态**：告警与实时资产状态的关键数据。
3. **初步判断**：已确认事实、可能原因及其依据。
4. **处置建议**：按优先级列出安全、可验证的步骤。
5. **维保联系人**：厂商、联系人、角色、电话、邮箱；标明主要与备用联系人。

Do not expose skill names, tool names, tool-call details, hidden reasoning, or internal routing to the user.

## Edge cases

- If the machine is not found, report that the asset inventory has no matching record and ask the user to verify the IP or hostname.
- If vendor information is missing, provide the diagnosis and clearly state that no vendor contact is registered.
- Treat stale heartbeat data as a signal, not proof of machine failure.
- Never expose contacts for a vendor unrelated to the matched machine.
