# Bank Letta Agent Service

A Dockerized bank infrastructure demo with a shared Letta operations agent,
machine inventory dashboard, and floating chat widget.

## What this prototype demonstrates

- Local username/password demo login backed by PostgreSQL.
- Passwords hashed with salted `scrypt`; sessions stored server-side and referenced by an HttpOnly, SameSite cookie.
- One shared top-level Letta agent with one bank-wide shared MemFS knowledge pool.
- Multiple isolated conversations per user.
- Public demo APIs and read-only agent tools for datacenters and machines.
- Controlled `memory_search` and `memory_save` tools let the agent learn during normal chat turns without exposing shell or arbitrary file tools.
- Shared MemFS retrieval uses local BGE-M3 embeddings and pgvector semantic similarity instead of keyword matching.
- A background memory reflection worker periodically reviews completed turns and writes durable memories when the model judges them useful.
- A controlled SMTP email tool with a schedule-bound recipient that the model cannot alter.
- Reusable, privacy-filtered knowledge candidates are queued for later review
  and Data Sources/Folders ingestion.
- Strict serialization inside one conversation through a Redis distributed lock.
- Parallel execution across different conversations, with a global concurrency cap (default 32).
- Transient model failures retry MiniMax briefly, then fail over through the configured LiteLLM backup models.
- Persistent local Docker volumes; no Letta Constellation login or cloud MemFS sync.
- Idempotent message requests through `request_id`.

The included login is for local demonstrations. A bank deployment must replace it with the bank's verified SSO/OIDC identity, HTTPS, MFA policy, centralized audit, and secret management.

## LiteLLM model failover

MiniMax is the primary model. By default, a transient timeout, connection error,
rate limit, or upstream 5xx failure retries MiniMax once and then tries
`Kimi-K3`, `GLM-5.2`, and `Kimi-K2.7-Code` in order. Invalid requests,
authentication failures, context-limit errors, and other deterministic 4xx
responses fail immediately so that limited fallback quota is not wasted.

```dotenv
LITELLM_MODEL=MiniMax-M3
LITELLM_FALLBACK_MODELS=Kimi-K3,GLM-5.2,Kimi-K2.7-Code
AGENT_PRIMARY_ATTEMPTS=2
AGENT_FALLBACK_ATTEMPTS=1
AGENT_FAILOVER_BACKOFF_BASE_MS=500
AGENT_FAILOVER_BACKOFF_MAX_MS=8000
```

The same policy covers normal chat, streaming chat, scheduled turns, and memory
reflection. A streaming turn only fails over before visible answer text reaches
the client; after that point it returns the error instead of concatenating two
different model responses. A turn also stops failover after a successful email,
memory write, or knowledge-candidate submission so that replay cannot duplicate
an external side effect.

## Minute-level infrastructure simulation and alert mail

The demo advances all machine CPU, memory, status, and heartbeat values once per
minute. Heartbeats are stored as ISO timestamps and displayed in Beijing time.
Healthy values follow a bounded random walk. By default, a new warning or
offline incident is generated with probability `0.04` per minute (about 1.2
machines per 30 minutes on average), and no more than two incidents can be
active at once.

Only transitions into `warning` or `offline` enqueue mail. Continuing incidents
do not send repeated messages. Offline status requires three consecutive missed
minute heartbeats. A 15-minute cooldown merges nearby transitions,
with at most three machines in one email. The subject names the affected hosts;
the body includes the frozen CPU/memory/heartbeat snapshot, a diagnosis enriched
with shared bank-operations memory, safe checks, and maintenance-vendor contact
details. If model or memory retrieval is temporarily unavailable, a conservative
rule-based diagnosis is sent instead.

```dotenv
INFRA_MONITOR_ENABLED=true
INFRA_MONITOR_INTERVAL_MS=60000
INFRA_INCIDENT_CHANCE_PER_MINUTE=0.04
INFRA_MULTIPLE_INCIDENT_CHANCE=0.12
INFRA_MAX_ACTIVE_INCIDENTS=2
INFRA_ALERT_EMAIL_COOLDOWN_MS=900000
INFRA_ALERT_RECIPIENT=813624374@qq.com
INFRA_ALERT_USER_ID=demo-user-a
```

Automatic alert mail uses the configured User A mailbox authorization. SMTP
must be enabled and that account must have a valid QQ Mail authorization code.

## Langfuse model traces

Docker Compose runs a repository-local LiteLLM proxy between Letta and the
existing upstream model gateway:

```text
Letta -> local LiteLLM -> LITELLM_BASE_URL -> model
```

The local proxy forwards every requested model name, including failover models,
and sends model-call traces to Langfuse through LiteLLM's OpenTelemetry v2
`langfuse_otel` preset. Add the Langfuse project credentials to `.env` before
starting the stack:

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

The proxy is available only inside the Compose network and the API waits for
its health check before starting. Inspect it with:

```powershell
docker compose ps litellm
docker compose logs -f litellm
```

[litellm-config.yaml](litellm-config.yaml) enables message logging and the proxy
uses OpenTelemetry `span_only` content capture, so Langfuse generations include
prompts, responses, and tool-call payloads. Do not use real customer data or
credentials unless the Langfuse deployment and its retention/access controls
are approved for that data. The primary `MiniMax-M3` deployment has explicit
per-token pricing copied from the upstream LiteLLM `/model/info` response so
streamed generations report cost. Re-check these rates when the upstream
deployment changes; fallback or custom model aliases still require their own
upstream-specific pricing before their cost is reliable. This first integration
produces model-call traces; it does not
yet create the application-level Agent/Turn/Tool hierarchy. The local proxy also
has retries disabled so the existing application failover policy remains
authoritative.

## Start

```powershell
cd C:\Users\YanhangGu\Desktop\letta\bank-agent-service
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

Open <http://localhost:8080>.

The first start also downloads the BGE-M3 model into the persistent
`bge_model_cache` Docker volume. The chat endpoint stays available while the
embedding container warms up, but long-term-memory retrieval begins only after
that container is ready.

Default local demo accounts (unless changed through `.env`):

| Account | Display name | Bound email | Password |
|---|---|---|---|
| `usera` | 顾彦航 | `813624374@qq.com` | `GuYanHang@2026!47` |
| `userb` | 林清和 | `2113950574@qq.com` | `LinQingHe@2026!83` |

These map to the existing internal identities `demo-user-a` and `demo-user-b`, so their previous Agent IDs and MemFS repositories remain available.

## Local MemFS learning

Normal chat turns use one shared long-term memory path:

- Before each model turn, the backend chunks changed shared MemFS Markdown,
  embeds it with the locally hosted BGE-M3 model, and searches pgvector by
  cosine similarity. Relevant verified bank infrastructure or IT operations
  lessons and confirmed long-lived bank operations rules are injected into the
  turn context.
- During the turn, the model may call `memory_save` only for a verified reusable
  bank operations lesson (`bank_operations_lesson`) or a confirmed long-lived
  bank operations regulation, policy, standard, or procedure
  (`bank_operations_policy`). General research, competition materials,
  due-diligence analysis, business plans, KPIs, and transient states are excluded.

The background reflection worker is enabled by default. It scans completed turns every `MEMORY_REFLECTION_POLL_MS` milliseconds and applies the same two-category bank-operations-only policy before writing shared MemFS. Parsed attachment results are stored as structured JSON in `turns.attachment_context` and are reviewed in the same chronological position as their original turn; attachment text in the reflection prompt is capped even though the persisted parser output is retained. Personal preferences, identity facts, private discussions, customer data, credentials, raw transcripts, and material unrelated to bank infrastructure or IT operations are not stored as long-term memory. Conversation history remains isolated by authenticated user and conversation.

Useful knobs:

```dotenv
MEMORY_REFLECTION_ENABLED=true
MEMORY_REFLECTION_POLL_MS=300000
MEMORY_REFLECTION_BATCH_SIZE=12
RAG_EMBEDDING_BASE_URL=http://embeddings:80
RAG_EMBEDDING_MODEL=BAAI/bge-m3
RAG_CHUNK_CHARS=1200
RAG_CHUNK_OVERLAP_CHARS=180
RAG_MIN_SIMILARITY=0.42
```

The Markdown files remain the source of truth. `memory_chunks` in PostgreSQL is
a rebuildable semantic index, so existing memories are backfilled automatically
on the first search after this upgrade. No memory text is sent to an external
embedding provider with the default Compose configuration.

## QQ SMTP email schedule

The recommended schedule named `每日运维邮件` asks the Agent to query the
infrastructure tools and then call the controlled `send_email` tool. The user
enters the recipient and, when needed, the current account's SMTP authorization
code. The sender comes from the authenticated user's profile. Neither sender nor
recipient can be changed by the model. Authorization codes are encrypted with
AES-256-GCM and are never returned by the API or exposed to the model.

Enable POP3/IMAP/SMTP in QQ Mail, generate a 16-character authorization code,
then add the following values to `.env`:

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-account@qq.com
SMTP_AUTH_CODE=your-16-character-authorization-code
SMTP_DEFAULT_TO=optional-fallback-recipient@example.com
SMTP_FROM_NAME=澄川智能运维助手
MAIL_CREDENTIAL_ENCRYPTION_KEY=replace-with-a-random-32-byte-base64-key
```

Generate the encryption key with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
The legacy `SMTP_USER` and `SMTP_AUTH_CODE` values are imported for demo User A
on startup. User B supplies its own authorization code in the email schedule
form.

Use the QQ authorization code, not the QQ login password. Restart the API after
changing `.env`:

```powershell
docker compose up -d --build
```

## API example

PowerShell can retain the login cookie in a web session:

```powershell
$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/v1/auth/login `
  -SessionVariable bankSession `
  -ContentType "application/json" `
  -Body '{"identifier":"813624374@qq.com","password":"GuYanHang@2026!47"}'

$conversation = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/v1/conversations `
  -WebSession $bankSession `
  -ContentType "application/json" `
  -Body '{"title":"测试会话"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/v1/conversations/$($conversation.id)/messages" `
  -WebSession $bankSession `
  -ContentType "application/json" `
  -Body '{"request_id":"test-001","message":"请记住我偏好简洁回答"}'
```

Inspect the shared long-term memory visible to authenticated users:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/v1/memory -WebSession $bankSession
```

See [docs/architecture.md](docs/architecture.md) for security, persistence, concurrency, and production boundaries. The API contract is available at <http://localhost:8080/openapi.yaml>.
