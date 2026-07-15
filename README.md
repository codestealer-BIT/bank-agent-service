# Bank Letta Agent Service

A Dockerized prototype that embeds private Letta Code agents into a colorful bank workspace and floating chat widget.

## What this prototype demonstrates

- Local username/password demo login backed by PostgreSQL.
- Passwords hashed with salted `scrypt`; sessions stored server-side and referenced by an HttpOnly, SameSite cookie.
- One private Letta agent and local MemFS repository per authenticated account.
- Multiple isolated conversations per user.
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

Default local demo accounts (unless changed through `.env`):

| Account | Display name | Password |
|---|---|---|
| `usera` | 顾彦航 | `LettaDemo@2026` |
| `userb` | 林清禾 | `LettaDemo@2026` |

These map to the existing internal identities `demo-user-a` and `demo-user-b`, so their previous Agent IDs and MemFS repositories remain available.

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

Inspect only the logged-in user's memory:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/v1/memory -WebSession $bankSession
```

See [docs/architecture.md](docs/architecture.md) for security, persistence, concurrency, and production boundaries. The API contract is available at <http://localhost:8080/openapi.yaml>.
