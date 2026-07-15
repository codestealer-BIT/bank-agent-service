# Verification results

Verified on 2026-07-15 against the configured team LiteLLM endpoint and `MiniMax-M3`.

| Check | Observed result |
|---|---|
| Container health | API, PostgreSQL, and Redis all healthy |
| Real Letta turn | Successful through Letta Agent SDK local backend |
| Login session | Correct password created an HttpOnly, SameSite=Strict server-side session |
| Invalid login | Wrong password returned HTTP 401; repeated attempts are Redis-rate-limited |
| Session revocation | `/v1/auth/me` returned HTTP 401 immediately after logout |
| Browser-controlled identity | Removed; the browser no longer supplies `X-User-Id` |
| Account isolation | User B reading a User A conversation returned HTTP 404 |
| Post-login model turn | Authenticated turn returned `CONNECTED` in 3.193s |
| MemFS persistence | `reference/integration-tests.md` remained after API container replacement |
| Cross-conversation recall | User A returned `blue-redwood-4827` from a new conversation |
| Cross-user isolation | User B returned `UNKNOWN` |
| Same conversation serialization | Two simultaneous turns: 6.533s + 3.980s model time, 13.839s wall time |
| Different conversation parallelism | Same user, two conversations: 7.552s + 6.273s model time, 9.943s wall time |
| Dependency audit | `npm audit --omit=dev`: 0 vulnerabilities |

The integration identities and facts are synthetic test data. These numbers are functional evidence, not a production capacity benchmark.
