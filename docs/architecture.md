# Architecture

```text
Bank web / mobile app
        |
        | HTTPS + bank identity token
        v
Bank API gateway / WAF
        |
        v
bank-letta-agent-service (one public API contract)
  |-- authentication adapter (demo: X-User-Id)
  |-- PostgreSQL ownership + conversation + audit records
  |-- Redis conversation locks + global model semaphore
  |-- Letta Agent SDK, backend=local
  |     `-- SDK-managed Letta Code app-server processes
  |-- /data/local-backend/memfs/<agent-id>/memory (local Git repos)
  `-- OpenAI-compatible calls to the approved LiteLLM gateway
```

## Isolation model

- One service endpoint and one assistant template do not mean one shared memory identity.
- Each authenticated `user_id` maps to exactly one long-lived Letta `agent_id`.
- Each user agent owns a separate MemFS Git repository.
- A user can have many conversations. Their message histories are separate, while their agent MemFS is shared only within that user.
- Every database lookup includes both `conversation_id` and authenticated `user_id`; guessing another UUID is insufficient.
- `lock:conversation:<id>` serializes turns in one conversation across all API replicas.
- Different conversation locks can run in parallel. A Redis semaphore caps total in-flight model turns.

## Important concurrency boundary

Letta's SDK notes that concurrent sessions sharing one agent MemFS can contend on Git state. This prototype allows different conversations to run in parallel as requested. For production, either:

1. serialize turns per user/agent for the strongest memory consistency; or
2. keep conversation-level parallelism and route memory writes through a per-user memory-writer queue with conflict retries.

Conversations belonging to different users have different agents and different MemFS repositories, so they do not share this Git contention point.

## Data location

- MemFS and local Letta state: Docker volume `letta_state`.
- Ownership, conversation metadata, and audit turns: `postgres_data`.
- Locks and concurrency leases: `redis_data`.
- No Constellation login or Letta Cloud API key is used.
- Prompts still leave the container for the configured LiteLLM gateway. For a strict bank boundary, that gateway and its model workers must also be deployed in the bank network and must disable prompt logging.

## Production changes before bank use

- Replace `X-User-Id` with mTLS plus verified bank JWT/OIDC identity. Never accept user identity from browser-controlled input.
- Store secrets in Vault/Kubernetes Secrets, not Compose `.env`.
- Encrypt database and persistent volumes, define retention/deletion policies, and audit memory reads/writes.
- Apply NetworkPolicy/egress firewall rules so the Agent can reach only LiteLLM and approved bank tools.
- Add content filtering, PII/DLP policy, prompt-injection defenses, tool authorization, observability, backups, and disaster recovery.
- Run multiple API replicas behind the bank gateway. Redis locks make conversation serialization work across replicas.
