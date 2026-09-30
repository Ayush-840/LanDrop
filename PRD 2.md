# PRD: Beam and Beam Hub

**Problem statement:** #386, terminal file transfer between devices on a LAN, with a custom reliable protocol (not TCP/HTTP).
**Capstone shape:** Terminal app (ISD) + backend (ASD) + SQL/ORM/MongoDB (DBMS), one integrated project, team of 3.

---

## 1. Problem

Moving a file between two computers in the same room is awkward:
- Cloud tools need internet and route data through a third party.
- `scp`/`netcat` need IP addresses, setup, and give no discovery, no acknowledgements and no integrity checking.
- AirDrop is Apple-only and GUI-only.

Beam makes it one command per side. Because the transport is a custom protocol on UDP, Beam also demonstrates how reliable delivery works underneath TCP.

## 2. Vision

> "Run `beam listen` on one machine, `beam send` on another. It finds the peer, the receiver approves, and the file arrives intact, even on a bad Wi-Fi link."

Beam Hub adds an account layer: history that follows you across devices, statistics, live notifications and admin tools.

## 3. Users

| User | Need |
|---|---|
| Student / developer | Move project files, logs and datasets between laptops without internet |
| Multi-device user | See history and stats across all their machines |
| Admin (course demo) | Manage users, view audit logs and system statistics |

## 4. Goals and Success Measures

| Goal | Measure |
|---|---|
| Reliable delivery on lossy links | 100 MB file completes with matching SHA-256 at 20% loss, 10% reordering, 5% corruption |
| Consent | Zero data packets sent before `ACCEPT` |
| Fast on a clean LAN | ≥ 60% of link throughput on Wi-Fi/Ethernet |
| Simple UX | First transfer in under 30 s, no IP typed |
| Works offline | All CLI transfer features work with no Hub |
| Backend quality | Meets all 10 ASD rubric areas (see BUILD_PLAN) |

## 5. Non-goals

WAN/internet transfer, NAT traversal, GUI, group broadcast, end-to-end encryption (roadmap), mobile app.

## 6. Functional Requirements

### 6.1 CLI: mandatory (problem statement)

| ID | Requirement |
|---|---|
| C1 | Discover other Beam instances on the LAN automatically |
| C2 | List discovered peers; user picks one (or `--to`) |
| C3 | Send a file or a text message to the peer |
| C4 | Receiver sees who/what/how big and must accept or reject; no data before acceptance |
| C5 | Transfer over BTP on UDP; handles loss, reordering, corruption, duplicates |
| C6 | Verify integrity with SHA-256 after transfer; report on both sides; never save a corrupted file as success |
| C7 | Progress bar with speed and ETA |
| C8 | Clear errors and exit codes (rejected, timeout, peer gone, checksum mismatch) |

### 6.2 CLI: value-adds

| ID | Requirement |
|---|---|
| C9 | Fault injector flags `--loss`, `--reorder`, `--corrupt` |
| C10 | Protocol dashboard `--stats` (window, RTT, RTO, retransmits) |
| C11 | `beam bench` prints throughput vs. loss table |
| C12 | Multiple files per command |
| C13 | Login/logout, `history --remote`, `stats`, `sync`, `trust`, `watch` |
| C14 | Offline outbox: history queued locally, synced idempotently |
| C15 | Filename sanitisation and no-overwrite policy |

### 6.3 Hub

| ID | Requirement |
|---|---|
| H1 | Register, login, refresh, logout, current user |
| H2 | Passwords hashed; access token 15 min; refresh token 7 days, rotated, revocable |
| H3 | Roles `user` / `admin`; users only access their own devices and transfers |
| H4 | Device registry (CRUD) and trusted-device relation (N:N) |
| H5 | Transfer history: create, batch sync, list (pagination, filter, sort), get, delete |
| H6 | Statistics: summary, top peers, failure rate |
| H7 | Per-transfer telemetry stored in MongoDB; audit logs in MongoDB |
| H8 | WebSocket notifications for the user's other devices |
| H9 | Scheduled jobs: daily stats rollup, stale-record cleanup |
| H10 | Admin endpoints: list/disable users, audit logs, system stats |
| H11 | Validation on all input; central error handler; consistent envelope |
| H12 | Rate limiting on auth routes; CORS allow-list; security headers |
| H13 | OpenAPI docs at `/docs`; `/health` endpoint |
| H14 | Environment-based config; deployed with HTTPS |

## 7. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Portability | CLI single binary for Linux/Windows/macOS |
| Memory | CLI < 50 MB regardless of file size |
| Reliability | CLI never crashes on malformed packets (fuzz-tested decoder) |
| Security | PBKDF2/bcrypt/argon2 hashing, JWT secrets in env, parameterised queries |
| Observability | Structured JSON logs on Hub; verbose protocol log on CLI |
| Maintainability | Layered code, tests, CI |

## 8. Key User Flows

**Send:** `beam send report.pdf` → discovery → pick peer → wait for accept → transfer → verified.
**Receive:** `beam listen` → prompt "Accept? [y/N]" → progress → verified → saved.
**Sync:** `beam login` → history queued offline is pushed → `beam stats` shows totals.
**Admin:** admin logs in via API → lists users → disables one → audit entry written.

## 9. Edge Cases

Wrong/no peers, receiver rejects, receiver never answers (sender shows waiting; receiver sends keep-alive), peer disappears mid-transfer, duplicate packets, corrupted packets, zero-byte file, file size a multiple of chunk size, file changes during send, disk full, name collision, Hub unreachable (queue offline), token expired mid-sync (auto refresh), duplicate sync (idempotent via `client_ref`).

## 10. Release Scope

**MVP (must be demo-ready first):** C1–C8, H1–H6, H11, H13.
**Full:** everything in 6.2 and 6.3.
**Stretch:** payload encryption, resume, folder transfer, email verification, web dashboard.

## 11. Assumptions and Open Questions

- Mentor approves adding the Hub to problem #386 (ask before building).
- Transfers between two devices need not both be logged in to the Hub.
- Auto-accept is **not** offered: the problem statement requires acceptance for every transfer.
