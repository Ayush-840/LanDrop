# TRD: Technical Design

## 1. System Overview

```
 CLI (Go) ──UDP/BTP──▶ CLI (Go)          (data path: no TCP, no HTTP)
   │  ▲
   │  └── WebSocket (events)
   └───── HTTPS REST ─────▶ Hub (Fastify) ──▶ PostgreSQL (Prisma + raw SQL)
                                          └─▶ MongoDB   (telemetry, audit, device profiles)
```

## 2. Technology Choices

| Layer | Choice | Reason |
|---|---|---|
| CLI language | Go 1.22, stdlib only | Single static binary, `net.UDPConn`, goroutines and timers suit protocol work |
| CLI extras | `spf13/cobra` (optional) | Subcommands and help |
| Hub | Node 20 + TypeScript + Fastify | Fast, typed, schema-based validation, plugin system |
| Validation | Zod | One schema → validation + types |
| SQL DB | PostgreSQL 16 | Constraints, `CHECK`, `FILTER`, CTEs |
| ORM | Prisma | Models, relations, migrations; raw SQL via `$queryRaw` for reports |
| NoSQL | MongoDB 7 (native driver) | Semi-structured telemetry and audit data |
| Auth | argon2 (or bcrypt) + `jsonwebtoken` | Safe credential storage, tokens |
| Realtime | `@fastify/websocket` | Live events |
| Jobs | `node-cron` | Daily rollup, cleanup |
| Logging | pino | Structured logs |
| Tests | Go `testing`, Vitest + Supertest | Unit and integration |
| Deploy | Docker; Render/Railway/Fly (Hub), Neon/Supabase (Postgres), MongoDB Atlas (free tier) | Free tiers, env-based config |

If teammates prefer another backend stack (Django, Spring, Express), the design is unchanged; only libraries differ.

---

## 3. BTP: Beam Transfer Protocol (v1)

### 3.1 Design goals
Reliable, ordered, integrity-checked delivery over UDP, with explicit receiver consent and no dependence on TCP or HTTP.

### 3.2 Ports
UDP `47777` for both discovery and transfer (transfer sessions are distinguished by `session_id`; the receiver replies to the sender's source address/port). Configurable with `--port`.

### 3.3 Packet format
Big-endian. Payload ≤ 1200 bytes so a packet fits in one Ethernet frame (no IP fragmentation).

```
 offset  size  field
 0       2     magic       0xBE7A
 2       1     version     1
 3       1     type
 4       4     session_id  random 32-bit chosen by the sender
 8       4     seq         DATA: chunk index; other types: type-specific
 12      2     length      payload length
 14      2     flags       bit0 = retransmission (debug only)
 16      N     payload
 16+N    4     crc32       IEEE CRC over bytes [0 .. 16+N)
```

### 3.4 Packet types

| Code | Name | Direction | Payload |
|---|---|---|---|
| 0x01 | DISCOVER | broadcast | empty |
| 0x02 | ANNOUNCE | broadcast / reply | JSON `{name, os, device_uid, version}` |
| 0x03 | CONNECT | S→R | JSON `{kind: file\|message, name, size, sha256, chunk_size, total_chunks, sender_name}` (file index and count for multi-file) |
| 0x04 | PENDING | R→S | empty, sent every 2 s while the user decides |
| 0x05 | ACCEPT | R→S | JSON `{recv_window}` |
| 0x06 | REJECT | R→S | JSON `{reason}` |
| 0x07 | DATA | S→R | file bytes (or UTF-8 message text) |
| 0x08 | ACK | R→S | `cum_ack(4) ‖ sack_bitmap(8) ‖ recv_window(2)` |
| 0x09 | FIN | S→R | 32-byte SHA-256 of the whole payload |
| 0x0A | FIN_ACK | R→S | `status(1)`: 0 = verified, 1 = mismatch, 2 = write error |
| 0x0B | ERROR | either | JSON `{code, message}` |

A **message** is a transfer with `kind = message` and one DATA packet (seq 0). It goes through exactly the same accept, ACK and verify path as a file, which keeps the protocol small.

### 3.5 Handshake and consent

```
Sender                                           Receiver
  │─ CONNECT(session, meta) ─────────────────────▶│  (retransmit until answered)
  │◀───────────────────── PENDING (every 2 s) ────│  user sees prompt
  │◀───────────────────────── ACCEPT / REJECT ────│
  │─ DATA seq 0..n ──────────────────────────────▶│
  │◀────────────── ACK(cum, SACK bitmap, window) ─│
  │─ FIN(sha256) ────────────────────────────────▶│  hash file, compare
  │◀──────────────────────────── FIN_ACK(status) ─│
```
The sender sends **no DATA before ACCEPT**. The sender aborts if it hears neither PENDING nor a decision for 15 s. The receiver's prompt times out after 60 s (treated as REJECT).

### 3.6 Reliability mechanisms

| Problem | Mechanism |
|---|---|
| Corruption | CRC-32 checked on every packet; failures are dropped silently (treated as loss) |
| Loss | Per-packet retransmission timer; retransmit on timeout; **fast retransmit** when ≥ 3 later packets are SACKed but an earlier one is not |
| Reordering | Receiver stores out-of-order chunks in a bounded map, writes each chunk at offset `seq × chunk_size`, advances `cum_ack` when gaps fill |
| Duplicates | Already-received `seq` is ignored but re-ACKed |
| Efficiency | ACK carries cumulative point plus a 64-bit bitmap for `cum_ack+1 … cum_ack+64` (selective ACK), so only real gaps are resent |
| Timing | Adaptive RTO (RFC 6298 style): `SRTT = 7/8·SRTT + 1/8·R`, `RTTVAR = 3/4·RTTVAR + 1/4·|SRTT−R|`, `RTO = SRTT + 4·RTTVAR`, clamped to 50 ms–2 s (LAN-tuned); Karn's rule (no RTT samples from retransmitted packets); exponential back-off on repeated timeouts |
| Flow control | `recv_window` in every ACK |
| Congestion | Simple AIMD: `cwnd` starts at 4 packets, +1 per RTT (slow-start below `ssthresh = 32`), halved on loss; capped at 64 |
| Dead peer | 8 consecutive RTO expiries → abort with `peer unreachable` |
| Tail loss | FIN and CONNECT are retransmitted until answered; receiver lingers 5 s after FIN_ACK to answer a retransmitted FIN |
| End-to-end integrity | Receiver hashes the reassembled data; only a SHA-256 match yields FIN_ACK status 0 and a permanent file |

### 3.7 Sender state machine

```
IDLE → DISCOVERED → CONNECTING → WAIT_DECISION → SENDING → FINISHING → DONE
                        │             │              │          │
                        └─ timeout ───┴─ REJECT ─────┴─ dead ────┴─ mismatch → FAILED
```

Sender loop (per session):
1. Fill window: send chunks while `inflight < min(cwnd, recv_window)`; record `sentAt[seq]`.
2. On ACK: sample RTT for non-retransmitted packets; slide `base` to `cum_ack`; mark SACKed seqs; grow `cwnd`; trigger fast retransmit if needed.
3. On timer tick: retransmit the oldest unacked packet if `now − sentAt > RTO`; halve `cwnd`; double RTO.
4. When `base == total_chunks`: send FIN, wait for FIN_ACK.

### 3.8 Receiver state machine

```
LISTENING → PROMPTING → RECEIVING → VERIFYING → LINGER → LISTENING
                │            │           │
              REJECT       abort      mismatch (delete partial file)
```
Receiver loop: validate CRC and session → drop packets for unknown sessions → store chunk → update bitmap → send ACK (immediately on gaps, otherwise every 2 packets or 20 ms).

### 3.9 Discovery
- Every listener sends ANNOUNCE every 2 s to the subnet broadcast address of each interface and to `255.255.255.255`.
- `beam send` broadcasts DISCOVER and collects ANNOUNCE replies for 3 s.
- Peer table entries expire after 6 s without a refresh.
- Fallback: `--to <ip[:port]>`.

### 3.10 Fault injection (`internal/faultnet`)
A `net.PacketConn` wrapper that, per packet, may drop (`--loss`), hold-and-swap (`--reorder`), or flip a random bit (`--corrupt`). Because it sits below BTP, the protocol code is identical in tests and production.

### 3.11 Security notes
Consent before data; filename sanitisation (`filepath.Base`, strip control characters, block reserved Windows names); frame length and window bounded; sessions expire after 30 s of silence; disk-space check before ACCEPT. v1 traffic is not encrypted (documented limitation).

---

## 4. CLI Architecture

```
cmd/beam/main.go              command wiring
internal/discovery/           announce, probe, peer table
internal/btp/                 codec.go  sender.go  receiver.go  rto.go  cwnd.go  session.go
internal/faultnet/            lossy PacketConn wrapper
internal/hubclient/           REST client, token refresh, WebSocket client
internal/outbox/              append-only JSONL queue of unsynced history
internal/store/               config (~/.beam/config.json), tokens (0600), local history
internal/ui/                  progress bar, prompts, tables, protocol dashboard
```
Rule: `cmd → btp/discovery/hubclient → net`. UI is behind an interface so protocol tests run headless.

### Offline sync
After each transfer the CLI appends a record with a fresh `client_ref` UUID to the outbox. `beam sync` (and automatic sync at login) posts batches to `POST /transfers/batch`. The Hub upserts on `client_ref`, so retries never duplicate.

---

## 5. Hub Architecture

### 5.1 Layers

```
routes      URL + method + schema (Zod) → handler
handlers    parse request, call service, shape response (no business logic)
services    business rules (auth, ownership checks, stats, sync)
repositories  all database access (Prisma, raw SQL, Mongo collections)
middleware  auth, RBAC, rate limit, error handler, request id, logging
jobs        cron tasks
ws          WebSocket hub and event publisher
lib         config, logger, errors, hashing, tokens
```

### 5.2 Folder structure

```
hub/
├─ src/
│  ├─ app.ts  server.ts
│  ├─ routes/{auth,devices,transfers,stats,admin,health}.routes.ts
│  ├─ handlers/…
│  ├─ services/{auth,device,transfer,stats,admin,telemetry}.service.ts
│  ├─ repositories/{user,device,transfer,stats}.repo.ts  mongo/{telemetry,audit,profile}.repo.ts
│  ├─ middleware/{authenticate,authorize,rateLimit,errorHandler,requestId}.ts
│  ├─ jobs/{dailyStats,cleanup}.job.ts
│  ├─ ws/{hub,events}.ts
│  └─ lib/{config,logger,errors,password,tokens}.ts
├─ prisma/{schema.prisma,migrations/,seed.ts}
├─ tests/{unit,integration}/
├─ Dockerfile  docker-compose.yml  .env.example
```

### 5.3 Authentication
- Register: validate, hash password (argon2id), create user, write audit log.
- Login: verify, issue **access JWT (15 min)** and **refresh token** (random 256-bit, stored only as SHA-256 hash, 7 days).
- Refresh: single-use rotation; the old token is revoked; reuse of a revoked token revokes all of that user's tokens (theft detection).
- Logout: revoke the refresh token; WebSocket connections for that session closed.
- Login rate limit: 5 attempts per minute per IP+email; generic error message (no user enumeration).

### 5.4 Authorization
- `authenticate` middleware validates the JWT and loads `{userId, role}`.
- `authorize('admin')` guard for `/admin/*`.
- Ownership: repositories always scope by `userId` (`WHERE d.user_id = $1`); services return `404` (not `403`) for other users' resources.

### 5.5 Errors
One error class `AppError(code, status, message, details?)`. The central handler maps validation errors → 422, auth → 401/403, not found → 404, conflict → 409, rate limit → 429, everything else → 500 with a generic message and a logged request id. No stack traces in responses.

### 5.6 Advanced capabilities (rubric asks for two or more)
1. **Real-time (WebSocket):** `/ws` authenticated by access token; events `transfer.completed`, `device.online`, `device.offline`, `admin.announcement`. Used by `beam watch`.
2. **Scheduled/background jobs:** nightly `daily_stats` rollup (idempotent upsert), hourly cleanup of expired refresh tokens and orphaned telemetry.
3. *(Optional)* email via Nodemailer for verification/password reset.

### 5.7 Security checklist
HTTPS in deployment; `@fastify/helmet`; CORS allow-list from env; body size limits; parameterised queries only; secrets from env; password and token hashes never returned; rate limit on `/auth/*`; dependency audit in CI.

### 5.8 Configuration (`.env.example`)

```
NODE_ENV=development
PORT=8080
DATABASE_URL=postgresql://beam:beam@localhost:5432/beam
MONGO_URL=mongodb://localhost:27017/beam
JWT_SECRET=change-me
ACCESS_TTL_MIN=15
REFRESH_TTL_DAYS=7
CORS_ORIGINS=http://localhost:3000
RATE_LIMIT_LOGIN_PER_MIN=5
LOG_LEVEL=info
```

### 5.9 `docker-compose.yml` (local)

```yaml
services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: beam, POSTGRES_PASSWORD: beam, POSTGRES_DB: beam }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: [mongodata:/data/db]
volumes: { pgdata: {}, mongodata: {} }
```

---

## 6. Testing Strategy

| Level | CLI | Hub |
|---|---|---|
| Unit | codec round-trip, CRC failure, RTO estimator, cwnd rules, reorder buffer, filename sanitiser | password hashing, token service, Zod schemas, stats calculations |
| Integration | full transfer over loopback at 0/10/30% loss, heavy reorder, corruption, reject path, dead peer, empty and 1-byte files, size = multiple of chunk | Supertest against a test DB: register/login/refresh/logout, ownership isolation, RBAC, pagination/filter/sort, idempotent batch sync |
| Fuzz | `go test -fuzz` on packet decoder | schema fuzzing on auth routes (optional) |
| System | two real machines, one Windows + one Linux, phone hotspot | deployed Hub smoke test |
| Coverage goal | ≥ 70% `btp` | ≥ 70% services/repositories |

## 7. CI/CD (GitHub Actions)

- On push/PR: `go vet`, `go test -race ./...`, `npm ci`, `npm run lint`, `npm test` (with Postgres and Mongo service containers).
- On tag: cross-compile CLI (`linux/amd64`, `windows/amd64`, `darwin/arm64`) and attach to a GitHub Release.
- Hub deploys from `main` via the hosting provider's Git integration; run `prisma migrate deploy` on release.

## 8. Deployment

| Component | Where | Notes |
|---|---|---|
| Hub | Render / Railway / Fly.io (Docker) | Env vars set in dashboard; health check `/health` |
| PostgreSQL | Neon or Supabase free tier | `DATABASE_URL` |
| MongoDB | Atlas free tier | `MONGO_URL` |
| CLI | GitHub Releases | `BEAM_HUB_URL` default in config |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Campus Wi-Fi blocks broadcast | `--to <ip>`; demo on phone hotspot |
| Protocol bugs eat the schedule | Build in order: codec → stop-and-wait → window → SACK → RTO → congestion; keep a passing loopback test at each step |
| Hub free tier sleeps | Warm it before the demo; CLI works offline anyway |
| Scope creep | MVP list in PRD §10 frozen in week 2 |
| Uneven contribution | Rotate PR reviewers; weekly cross-teaching (viva requires everyone to know everything) |
