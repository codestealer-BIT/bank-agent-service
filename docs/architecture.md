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
  |-- authentication adapter (demo: server-side sessions; production: bank SSO/OIDC)
  |-- PostgreSQL users + conversations + audit + knowledge candidates
  |-- Redis conversation locks + global model semaphore
  |-- Letta Agent SDK, backend=local
  |     `-- SDK-managed Letta Code app-server processes
  |-- one shared /data/local-backend/memfs/<agent-id>/memory Git repo
  |-- public demo infrastructure API + read-only agent tools
  `-- OpenAI-compatible calls to the approved LiteLLM gateway
```

## Isolation model

- One service endpoint and one assistant template do not mean one shared memory identity.
- All authenticated users map to one long-lived shared Letta `agent_id`.
- A user can have many conversations and each Letta conversation remains separate.
- Normal chat turns cannot write MemFS directly. The agent may submit a
  privacy-filtered reusable knowledge candidate into PostgreSQL for later
  review and ingestion into Letta Data Sources/Folders.
- The browser cannot choose its own `user_id`; an HttpOnly session maps the login to an immutable internal identity.
- Every database lookup includes both `conversation_id` and authenticated `user_id`; guessing another UUID is insufficient.
- `lock:conversation:<id>` serializes turns in one conversation across all API replicas.
- Different conversation locks can run in parallel even though they use the
  same agent. A Redis semaphore caps total in-flight model turns.

## Important concurrency boundary

Letta's SDK notes that concurrent sessions sharing one agent MemFS can contend
on Git state. This prototype keeps conversation turns parallel by denying
direct MemFS writes during normal chat. Shared knowledge is submitted to a
separate candidate queue, which can later be reviewed and ingested serially.

## Data location

- MemFS and local Letta state: Docker volume `letta_state`.
- Ownership, conversation metadata, and audit turns: `postgres_data`.
- Locks and concurrency leases: `redis_data`.
- No Constellation login or Letta Cloud API key is used.
- Prompts still leave the container for the configured LiteLLM gateway. For a strict bank boundary, that gateway and its model workers must also be deployed in the bank network and must disable prompt logging.

## Production changes before bank use

- Replace the local demo accounts with mTLS plus verified bank JWT/OIDC identity.
- Store secrets in Vault/Kubernetes Secrets, not Compose `.env`.
- Encrypt database and persistent volumes, define retention/deletion policies, and audit memory reads/writes.
- Apply NetworkPolicy/egress firewall rules so the Agent can reach only LiteLLM and approved bank tools.
- Add content filtering, PII/DLP policy, prompt-injection defenses, tool authorization, observability, backups, and disaster recovery.
- Run multiple API replicas behind the bank gateway. Redis locks make conversation serialization work across replicas.
