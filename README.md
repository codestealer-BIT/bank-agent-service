# Bank Letta Agent Service

A Dockerized prototype that embeds a private Letta Code agent into a bank website through a floating chat widget.

## What this prototype guarantees

- One stable REST API for the bank application.
- One private Letta agent and local MemFS repository per authenticated user.
- Multiple isolated conversations per user.
- Strict serialization inside one conversation through a Redis distributed lock.
- Parallel execution across different conversations, with a global concurrency cap (default 32).
- Persistent local Docker volumes; no Letta Constellation login or cloud MemFS sync.
- Idempotent message requests through `request_id`.

## Start

The existing team LiteLLM settings use the same variable names as this service. From PowerShell:

```powershell
cd C:\Users\YanhangGu\Desktop\letta\bank-agent-service
Copy-Item C:\Users\YanhangGu\Desktop\Onyx\.env .\.env
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

Open <http://localhost:8080>. The sample bank page embeds `widget.js` and shows the round chat button in the lower-right corner.

## API example

The `X-User-Id` header is only a demo authentication adapter.

```powershell
$headers = @{ "X-User-Id" = "demo-user-a" }
$conversation = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/v1/conversations `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"title":"测试会话"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/v1/conversations/$($conversation.id)/messages" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"request_id":"test-001","message":"请记住我偏好简洁回答"}'
```

Inspect only that user's memory:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/v1/memory -Headers $headers
```

See [docs/architecture.md](docs/architecture.md) for security, persistence, concurrency, and production boundaries.

The API contract is available at <http://localhost:8080/openapi.yaml>. See
[docs/verification.md](docs/verification.md) for the executed integration checks.
