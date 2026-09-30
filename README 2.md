# Beam

**Send files and messages to any device on your network using a reliable transport protocol built from scratch on UDP, backed by an account, history and analytics service.**

Beam has two parts:

| Part | What it is | Tech |
|---|---|---|
| **Beam CLI** | Terminal app. Finds peers automatically, asks the receiver to accept, and transfers over **BTP** (Beam Transfer Protocol), a custom protocol on raw UDP that handles packet loss, reordering and corruption itself. | Go (standard library only) |
| **Beam Hub** | Backend service. Accounts, devices, transfer history, statistics, live notifications, admin tools. | TypeScript, Fastify, PostgreSQL (Prisma ORM), MongoDB, WebSocket |

The transfer itself is **peer to peer over UDP** (no TCP, no HTTP). The Hub is used only for accounts and history, and the CLI works fully offline, syncing to the Hub later.

```
 ┌──────────── Beam CLI ───────────────┐          ┌────────── Beam Hub ─────────────────┐
 │ discovery · BTP over UDP · accept   │──HTTPS──▶│ REST /api/v1 · JWT · RBAC           │
 │ SHA-256 verify · offline outbox     │◀──WS────▶│ live events · scheduled jobs        │
 └──────────────▲──────────────────────┘          └───────────┬───────────────┬─────────┘
                │ raw UDP                                      │               │
          other Beam peers                              PostgreSQL         MongoDB
                                                       (ORM + raw SQL)  (telemetry, audit)
```

## Features

**CLI**
- Automatic LAN discovery (UDP broadcast), interactive peer picker
- Send a file or a text message; **receiver must accept before any data flows**
- BTP: sequence numbers, selective ACKs, adaptive retransmission timer, fast retransmit, sliding window, congestion control, reorder buffer, per-packet CRC-32
- Whole-file **SHA-256 verification** reported on both sides
- Live progress bar and optional protocol dashboard (window, RTT, retransmits)
- Built-in **fault injector**: simulate loss, reordering and corruption
- `beam bench`: throughput vs. packet-loss table for your report
- Offline-first: history is queued locally and synced when logged in

**Hub**
- Register/login, hashed passwords, short-lived JWT access tokens and rotating refresh tokens, logout revokes
- Roles (`user`, `admin`) and ownership rules
- Versioned REST API with pagination, filtering, sorting, consistent error format
- Device registry and trusted-device list
- Transfer history and statistics (SQL joins, aggregation, subqueries)
- Per-transfer protocol telemetry and audit logs in MongoDB
- WebSocket live notifications; scheduled jobs (daily stats rollup, stale-session cleanup)
- Rate limiting, validation, central error handling, structured logs, OpenAPI docs

## Quick start

### Prerequisites
Go 1.22+, Node.js 20+, Docker (for Postgres and MongoDB locally).

### 1. Start the Hub
```bash
cd hub
cp .env.example .env
docker compose up -d db mongo
npm install
npx prisma migrate deploy
npm run seed
npm run dev          # http://localhost:8080  (docs at /docs)
```

### 2. Build the CLI
```bash
cd cli
go build -o beam ./cmd/beam
```

### 3. Transfer something
```bash
# Machine B
./beam listen

# Machine A
./beam send photo.jpg
```

### 4. Log in to sync history
```bash
./beam login --hub http://localhost:8080
./beam history --remote
./beam stats
```

## CLI reference

| Command | Description |
|---|---|
| `beam listen` | Announce this device, wait for incoming transfers |
| `beam peers` | Show discoverable devices |
| `beam send <file>...` | Send file(s) to a chosen peer |
| `beam msg "<text>"` | Send a text message to a chosen peer |
| `beam history [--remote] [--last N]` | Local or Hub history |
| `beam stats` | Totals, top peers, failure rate (from Hub) |
| `beam login` / `logout` / `whoami` | Account commands |
| `beam sync` | Push queued offline history to the Hub |
| `beam trust <peer>` / `untrust` | Mark a peer device as trusted (shown with a badge) |
| `beam bench` | Run loopback transfers at several loss rates |
| `beam watch` | Live feed of events from your other devices (WebSocket) |

Common flags: `--to <name|ip>`, `--dir <path>`, `--port <n>`, `--json`, `-v`, `--stats` (protocol dashboard), `--loss <pct>`, `--reorder <pct>`, `--corrupt <pct>`.

## Prove the protocol works

```bash
./beam listen --loss 15 --reorder 10 --corrupt 5
./beam send big.iso --loss 15 --reorder 10 --corrupt 5 --stats
```

Expected: the transfer completes and both sides print `SHA-256 verified`. With `--stats` you see retransmits rise and the congestion window shrink and recover.

## Repository layout

```
beam/
├─ cli/                Go module (Beam CLI + BTP)
│  ├─ cmd/beam/
│  └─ internal/{discovery,btp,faultnet,hubclient,outbox,ui,store}
├─ hub/                TypeScript backend
│  ├─ src/{routes,handlers,services,repositories,middleware,jobs,ws,lib}
│  ├─ prisma/          schema.prisma, migrations, seed.ts
│  └─ docker-compose.yml
├─ docs/               PRD, TRD, DESIGN, DATABASE, API, BUILD_PLAN
└─ .github/workflows/  CI (test, lint, build, release)
```

## Documentation

| Doc | Contents |
|---|---|
| [PRD](docs/PRD.md) | Problem, users, requirements, scope |
| [TRD](docs/TRD.md) | Architecture, BTP protocol spec, Hub design, deployment, testing |
| [DESIGN](docs/DESIGN.md) | CLI UX, screens, messages |
| [DATABASE](docs/DATABASE.md) | ER diagram, SQL schema, queries, ORM, MongoDB design |
| [API](docs/API.md) | REST endpoints, error format, WebSocket events |
| [BUILD_PLAN](docs/BUILD_PLAN.md) | Timeline, team split, commit plan, rubric checklist, viva prep |

## Limitations

- LAN only for transfers; no NAT traversal
- Transfers are integrity-checked but **not encrypted** in v1 (roadmap item)
- One active transfer per receiver in v1

## License
MIT
