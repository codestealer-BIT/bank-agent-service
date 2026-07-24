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
- Persistent local Docker volumes; no Letta Constellation login or cloud MemFS sync.
- Idempotent message requests through `request_id`.

The included login is for local demonstrations. A bank deployment must replace it with the bank's verified SSO/OIDC identity, HTTPS, MFA policy, centralized audit, and secret management.

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

| Account | Display name | Password |
|---|---|---|
| `usera` | 顾彦航 | `LettaDemo@2026` |
| `userb` | 林清禾 | `LettaDemo@2026` |

These map to the existing internal identities `demo-user-a` and `demo-user-b`, so their previous Agent IDs and MemFS repositories remain available.

## Local MemFS learning

Normal chat turns use one shared long-term memory path:

- Before each model turn, the backend chunks changed shared MemFS Markdown,
  embeds it with the locally hosted BGE-M3 model, and searches pgvector by
  cosine similarity. Relevant organization-wide facts, plans, policies,
  procedures, and operations knowledge are injected into the turn context.
- During the turn, the model may call `memory_save` when it identifies a durable bank-wide fact, confirmed plan, policy, procedure, or verified reusable operations lesson.

The background reflection worker is enabled by default. It scans completed turns every `MEMORY_REFLECTION_POLL_MS` milliseconds and asks the same agent to decide whether anything should be written to shared MemFS. Parsed attachment results are stored as structured JSON in `turns.attachment_context` and are reviewed in the same chronological position as their original turn; attachment text in the reflection prompt is capped even though the persisted parser output is retained. Personal preferences, identity facts, private discussions, customer data, credentials, and raw transcripts are not stored as long-term memory. Conversation history remains isolated by authenticated user and conversation.

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
enters the recipient in the schedule form; the backend binds it to that schedule.
The model can set only the subject and plain-text body and cannot change the
recipient. Sender credentials remain in the backend environment and are never
exposed to the model.

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
```

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
  -Body '{"username":"usera","password":"LettaDemo@2026"}'

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
