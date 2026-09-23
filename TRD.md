# TRD — Beam: Technical Requirements Document

Companion to `PRD.md`. Describes how Beam is built.

---

## 1. Technology Choices

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | **Go 1.22+** | Single static binary, cross-compiles to Linux/Windows/macOS, goroutines make concurrent I/O simple, strong `net` and `crypto` stdlib |
| CLI parsing | `spf13/cobra` (or stdlib `flag`) | Subcommands, help text, completion |
| Discovery | UDP broadcast (own implementation, stdlib `net`) | Zero deps, shows networking skill |
| Transport | TCP (stdlib) | Ordered, reliable |
| Hashing | `crypto/sha256`, `hash/crc32` | Stdlib |
| Auth | `crypto/hmac` + `crypto/rand` | Stdlib |
| Terminal UI | Hand-written ANSI (`\r`, `\033[K`) | No dependency, full control |
| Tests | `testing` + `net.Pipe()` / loopback | Stdlib |
| Stretch crypto | `crypto/cipher` AES-GCM, `golang.org/x/crypto/hkdf` | Optional |

> Alternative if you prefer Node.js: same design works with `net`, `dgram`, `crypto`, `readline` (all built-in). Go is recommended for the single-binary demo.

## 2. Architecture

```
┌────────────────────────────── beam binary ──────────────────────────────┐
│                                                                         │
│  cmd/            CLI layer (cobra commands: send, receive, peers, ...)  │
│    │                                                                    │
│  internal/                                                              │
│    ├─ discovery/   UDP announce + listen, peer table                    │
│    ├─ protocol/    frame encode/decode, message types                   │
│    ├─ transfer/    sender, receiver, resume, chunk pipeline             │
│    ├─ auth/        PIN generation, HMAC challenge-response              │
│    ├─ ui/          progress bar, prompts, colours, tables               │
│    ├─ store/       config + history (JSON files)                        │
│    └─ util/        filename sanitising, size/speed formatting           │
└─────────────────────────────────────────────────────────────────────────┘
```

Layering rule: `cmd → transfer → protocol/auth → net`. `ui` is called via an interface so `transfer` is testable without a terminal.

## 3. Network Design

### 3.1 Ports

| Purpose | Protocol | Default port |
|---------|----------|--------------|
| Discovery | UDP broadcast | 47777 |
| Transfer | TCP | 47778 (configurable) |

### 3.2 Discovery

- Receiver sends an announce packet every 2 s to `255.255.255.255:47777` (and to each interface's subnet broadcast address) and also listens on it.
- Sender broadcasts a `WHO_IS_THERE` probe and collects announces for 2–3 s.
- Announce payload (JSON, < 512 bytes):

```json
{ "v": 1, "name": "laptop-b", "os": "linux", "port": 47778, "id": "b7f3..." }
```

- Peers expire from the table if not seen for 6 s.
- Fallback: `--to <ip[:port]>` bypasses discovery.

### 3.3 Transfer Protocol (over TCP)

Every message is a **frame**:

```
+--------+--------+----------------+------------------+
| 1 byte | 4 byte | N bytes        |                  |
| type   | length | payload        |  (big-endian len)|
+--------+--------+----------------+------------------+
```

Max control payload 64 KB; DATA payload up to chunk size + 8 bytes.

| Type | Name | Direction | Payload |
|------|------|-----------|---------|
| 0x01 | HELLO | S→R | `{v, name, id}` |
| 0x02 | CHALLENGE | R→S | 16-byte random nonce |
| 0x03 | AUTH | S→R | HMAC-SHA256(PIN, nonce ‖ sender_id) |
| 0x04 | AUTH_OK / AUTH_FAIL | R→S | status |
| 0x05 | OFFER | S→R | `{name, size, sha256, mtime, chunk_size, index, total}` |
| 0x06 | ACCEPT | R→S | `{resume_offset}` |
| 0x07 | REJECT | R→S | `{reason}` |
| 0x08 | DATA | S→R | `crc32(4) ‖ bytes` |
| 0x09 | DONE | S→R | (end of file) |
| 0x0A | VERIFY | R→S | `{ok, sha256}` |
| 0x0B | ERROR | either | `{code, message}` |

### 3.4 Sequence

```
Sender                                   Receiver
  │── HELLO ─────────────────────────────▶│
  │◀────────────────────────── CHALLENGE ─│
  │── AUTH (HMAC of nonce with PIN) ─────▶│
  │◀──────────────────────────── AUTH_OK ─│
  │── OFFER (name,size,sha256) ──────────▶│  user prompt: accept?
  │◀──────────────── ACCEPT(resume_offset)│
  │── DATA (chunk 1..n, crc32 each) ─────▶│  progress on both sides
  │── DONE ──────────────────────────────▶│  receiver hashes file
  │◀──────────────────── VERIFY(ok,sha256)│
  │  (repeat OFFER..VERIFY per file)      │
```

## 4. Key Algorithms

### 4.1 Streaming with bounded memory
- Read file in **256 KB chunks** using `io.Reader` with a reusable buffer.
- Sender goroutine reads + hashes into a buffered channel (depth 4); writer goroutine frames and sends. Overlaps disk and network.
- Receiver reads frame, verifies CRC32, writes to `<name>.beampart`, updates hasher.

### 4.2 Resume
- Receiver stores `<name>.beampart` and `<name>.beammeta` (`{sha256, size, bytes_written}`).
- On OFFER, if a meta file matches `sha256+size`, ACCEPT returns `resume_offset = bytes_written` (rounded down to chunk boundary, then partial file truncated to that offset).
- Sender `Seek`s to the offset and continues. The final SHA-256 is computed over the whole file (receiver re-reads the already-written prefix into the hasher on resume).
- On success, `.beampart` is atomically renamed to the final name.

### 4.3 Sender pre-hash
- Sender hashes the whole file before OFFER (shows a spinner). Needed so the receiver can match resume state and verify at the end.

### 4.4 PIN pairing
- Receiver generates a 6-digit PIN from `crypto/rand` at startup (rotated every session).
- The PIN never crosses the wire. Sender proves knowledge via `HMAC(PIN, nonce ‖ sender_id)`.
- 3 failed attempts per IP → 30 s lockout.
- Trusted-device shortcut (stretch): remember sender `id` after first successful pairing.

### 4.5 Filename safety
- Take only `filepath.Base`, strip control chars and reserved Windows names, reject empty result.
- Collision: append ` (1)`, ` (2)` etc.
- Never write outside the download directory.

### 4.6 Progress and speed
- Exponential moving average of throughput; ETA = remaining / EMA.
- UI refresh limited to ~10 Hz.

## 5. Data & Storage

`~/.beam/config.json`
```json
{ "device_name": "laptop-a", "download_dir": "~/Downloads/Beam", "port": 47778, "auto_accept": false }
```

`~/.beam/history.jsonl` (one JSON object per line)
```json
{ "time":"2026-10-01T18:22:04Z","dir":"send","peer":"laptop-b","file":"movie.mkv","size":1503238553,"sha256":"ab12..","status":"ok","secs":38 }
```

## 6. Error Handling

| Situation | Behaviour | Exit code |
|-----------|-----------|-----------|
| No receivers found | Suggest `--to` and firewall check | 2 |
| Auth failed | "Wrong PIN" | 3 |
| Receiver rejected | "Declined by laptop-b" | 4 |
| Network drop | Keep partial, print resume hint | 5 |
| Hash mismatch | Delete partial, report corruption | 6 |
| Disk full / permission | Abort cleanly | 7 |
| Success | | 0 |

All errors are wrapped with context (`fmt.Errorf("send %s: %w", ...)`). Timeouts: 10 s connect, 30 s idle read deadline.

## 7. Security Considerations

- Explicit user consent for every incoming transfer.
- Authentication via PIN + HMAC; constant-time comparison (`hmac.Equal`).
- Path traversal blocked; size limit and disk-space check before ACCEPT.
- Frame length capped to prevent memory exhaustion by malformed peers.
- Known limitation (document in report): v1 data stream is integrity-checked but not encrypted. Stretch X1 adds AES-GCM keyed from PIN.

## 8. Testing Strategy

| Level | What | How |
|-------|------|-----|
| Unit | frame encode/decode, filename sanitiser, PIN/HMAC, EMA/ETA, resume-offset logic | table-driven `go test` |
| Integration | full send/receive over loopback; wrong PIN; reject; corrupted chunk; resume after killing the connection at 40% | `net.Listen("127.0.0.1:0")` in tests |
| Property/fuzz | `go test -fuzz` on frame decoder | stdlib fuzzing |
| Manual | two real machines, Wi-Fi, 1 GB file, cross-OS | demo checklist in PRD §12 |

Target: ≥ 70% coverage on `protocol`, `transfer`, `auth`.

## 9. Build & Distribution

```bash
go build -o beam ./cmd/beam
GOOS=windows GOARCH=amd64 go build -o beam.exe ./cmd/beam
GOOS=darwin  GOARCH=arm64 go build -o beam-mac ./cmd/beam
```
- `Makefile` targets: `build`, `test`, `lint`, `release`.
- GitHub Actions: run `go vet`, `go test`, cross-compile, attach binaries to a release.

## 10. Repository Layout

```
beam/
├─ cmd/beam/main.go
├─ internal/
│  ├─ discovery/   discovery.go, discovery_test.go
│  ├─ protocol/    frame.go, messages.go, frame_test.go
│  ├─ transfer/    sender.go, receiver.go, resume.go, transfer_test.go
│  ├─ auth/        pin.go, hmac.go
│  ├─ ui/          progress.go, prompt.go, table.go, color.go
│  ├─ store/       config.go, history.go
│  └─ util/        fsname.go, format.go
├─ docs/           PRD.md, TRD.md, DESIGN.md, demo-script.md
├─ Makefile
├─ go.mod
└─ README.md
```

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Campus/hostel Wi-Fi blocks broadcast (client isolation) | `--to IP` fallback; demo on a phone hotspot |
| Windows firewall prompt on first run | Document; README troubleshooting |
| Resume logic bugs | Build it after basic transfer works; integration test that kills the connection |
| Scope creep | Freeze MVP (PRD F1–F15) before touching stretch items |

## 12. Definition of Done

All MVP requirements implemented, tests green, README with GIF/asciinema demo, cross-compiled binaries, and a rehearsed 3-minute live demo.
