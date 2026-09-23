# Beam

**Peer-to-peer file and message transfer for your local network, over a reliable protocol built from scratch on UDP.**

Beam is a command-line tool. Run it on two machines on the same network and they find each other automatically. Pick a peer, send a file or a message, the receiver approves it, and Beam moves the data using its own transport protocol (**BTP, the Beam Transfer Protocol**). No TCP, no HTTP, no cloud, no IP addresses to type.

BTP handles what TCP normally handles for you: **packet loss, reordering and corruption**. After the transfer finishes, the file is verified end to end with SHA-256.

---

## Features

| Requirement | How Beam does it |
|---|---|
| Automatic peer discovery | UDP broadcast announce/probe; live peer table with expiry |
| Pick a peer, send a file or message | Interactive selector, or `--to <name>` |
| Receiver must accept first | No data packets are sent until the receiver answers `ACCEPT` |
| Custom reliable protocol (not TCP/HTTP) | BTP over raw UDP datagrams: sequence numbers, selective acknowledgements, retransmission timers, sliding window, reorder buffer |
| Handles loss | Timeout and fast retransmit of missing packets |
| Handles reordering | Receiver reorder buffer, writes to the file by sequence number |
| Handles corruption | CRC-32 on every packet; bad packets are dropped and retransmitted |
| Integrity verification | Whole-file SHA-256 compared after the last packet |

Extras: live progress bar with speed and ETA, adaptive retransmission timeout, simple congestion control, built-in **packet-loss simulator** for testing and demos, transfer history, scriptable `--json` output.

---

## Quick Start

### Requirements
- Go 1.22 or newer
- Two machines (or two terminals) on the same LAN / Wi-Fi / hotspot
- UDP ports open on your firewall (default `47777`)

### Build
```bash
git clone <your-repo-url> beam
cd beam
go build -o beam ./cmd/beam
```

Cross-compile:
```bash
GOOS=windows GOARCH=amd64 go build -o beam.exe ./cmd/beam
GOOS=darwin  GOARCH=arm64 go build -o beam-mac ./cmd/beam
```

### Try it in 30 seconds

**Machine B (receiver):**
```bash
./beam listen
```

**Machine A (sender):**
```bash
./beam send report.pdf
```

Beam lists the peers it finds, you choose one, the receiver sees an accept prompt, and the transfer begins.

---

## Usage

```
beam <command> [arguments] [flags]
```

| Command | Description | Example |
|---|---|---|
| `listen` | Announce this device and wait for incoming transfers | `beam listen` |
| `peers` | Show devices currently discoverable on the LAN | `beam peers` |
| `send <file>` | Send a file to a chosen peer | `beam send photo.jpg` |
| `msg <text>` | Send a text message to a chosen peer | `beam msg "meeting at 5"` |
| `history` | List past transfers | `beam history --last 10` |
| `version` / `help` | Meta | `beam help send` |

### Common flags

| Flag | Applies to | Meaning |
|---|---|---|
| `--to <name\|ip>` | send, msg | Skip the selector and target a peer directly |
| `--name <name>` | listen | Device name shown to others (default: hostname) |
| `--dir <path>` | listen | Where received files are saved (default `./received`) |
| `--auto-accept` | listen | Accept without prompting (for trusted setups only) |
| `--port <n>` | all | UDP port (default `47777`) |
| `--loss <pct>` | all | **Simulate** dropping this % of packets |
| `--reorder <pct>` | all | **Simulate** reordering this % of packets |
| `--corrupt <pct>` | all | **Simulate** flipping bits in this % of packets |
| `--json` | all | Machine-readable output |
| `-v` | all | Verbose protocol log |

### Example session

```
$ beam send movie.mkv

  Nearby devices
    1) laptop-b     192.168.1.22
    2) hostel-pc    192.168.1.41

  Send to [1-2]: 1
  Waiting for laptop-b to accept…
  ✔ Accepted
  movie.mkv  ████████████░░░░░░░░░░░░  51%  512 MB / 1.0 GB  9.8 MB/s  ETA 00:52
  ✔ All packets acknowledged
  ✔ SHA-256 verified by receiver
```

Receiver side:

```
$ beam listen
  laptop-b · listening on UDP 47777

  ┌ Incoming file ─────────────────────────┐
  │ From   laptop-a (192.168.1.18)         │
  │ File   movie.mkv        Size 1.0 GB    │
  └────────────────────────────────────────┘
  Accept? [y/N] y
  ✔ Saved to ./received/movie.mkv (SHA-256 ok)
```

---

## How It Works

### 1. Discovery
Every listening instance broadcasts an `ANNOUNCE` datagram every 2 seconds. A sender broadcasts a `DISCOVER` probe and collects replies for about 3 seconds. Peers not heard from for 6 seconds are dropped from the table.

### 2. Handshake and consent
```
Sender                                   Receiver
  │── CONNECT (session id, name, kind, size, sha256) ─▶│
  │                                       user is asked │
  │◀───────────────────────────── ACCEPT / REJECT ─────│
  │── DATA seq=0,1,2,… ────────────────────────────────▶│
  │◀──────────── ACK (cumulative + selective bitmap) ───│
  │── FIN ──────────────────────────────────────────────▶│  receiver verifies SHA-256
  │◀───────────────────────────── FIN_ACK (ok/mismatch)─│
```
The sender does not send a single data packet until `ACCEPT` arrives.

### 3. Packet format (BTP v1)

All integers are big-endian. Payloads are at most 1200 bytes so packets fit in one Ethernet MTU without IP fragmentation.

```
 0        2     3     4            8            12       14       16
 +--------+-----+-----+------------+------------+--------+--------+
 | magic  | ver | type| session_id |    seq     | length | flags  |
 | 0xBE7A | 1B  | 1B  |    4B      |    4B      |   2B   |   2B   |
 +--------+-----+-----+------------+------------+--------+--------+
 |                    payload (0 – 1200 bytes)                    |
 +----------------------------------------------------------------+
 |               CRC-32 (IEEE) of header + payload   4B           |
 +----------------------------------------------------------------+
```

| Type | Name | Purpose |
|---|---|---|
| 0x01 | DISCOVER | "Who is on the network?" |
| 0x02 | ANNOUNCE | "I'm here" (name, port, id) |
| 0x03 | CONNECT | Transfer request with metadata |
| 0x04 | ACCEPT | Receiver agrees |
| 0x05 | REJECT | Receiver declines |
| 0x06 | DATA | File chunk (seq = chunk index) |
| 0x07 | ACK | Cumulative ACK + 64-bit selective bitmap + window |
| 0x08 | MSG | Short text message (reliable, single packet, retried until ACK) |
| 0x09 | FIN | All data sent; carries SHA-256 |
| 0x0A | FIN_ACK | Verification result |
| 0x0B | ERROR | Abort with reason |

### 4. Reliability mechanisms

| Problem | Mechanism |
|---|---|
| **Corruption** | Every packet carries a CRC-32. Failing packets are silently dropped, so they look like loss and get retransmitted. |
| **Loss** | The sender keeps every unacknowledged packet with a timer. On timeout it retransmits. Three duplicate/gap ACKs trigger **fast retransmit**. |
| **Reordering** | The receiver stores out-of-order chunks by sequence number (bounded reorder buffer) and advances the cumulative ACK once gaps fill. |
| **Duplicates** | Already-received sequence numbers are re-ACKed and ignored. |
| **Efficiency** | **Selective ACK**: the ACK bitmap tells the sender exactly which packets past the cumulative point have arrived, so only true gaps are resent. |
| **Timing** | Retransmission timeout (RTO) is adaptive: smoothed RTT and RTT variance (RFC 6298 style), with exponential back-off. |
| **Flow control** | The receiver advertises a window size in each ACK. |
| **Congestion** | Simple AIMD: window grows steadily, halves on loss, so Beam does not flood a busy Wi-Fi network. |
| **Dead peer** | Abort after N consecutive timeouts and print a clear error. |
| **End-to-end integrity** | Per-packet CRC catches transit damage; the final **SHA-256** of the reassembled file catches anything else (logic bugs, disk errors). |

### 5. Integrity verification
The sender computes the file's SHA-256 before the transfer and includes it in `CONNECT`. When the last chunk arrives, the receiver hashes the file it wrote and compares. The result is returned in `FIN_ACK` and shown on both sides. A mismatch deletes the file and reports failure; a corrupted file is never reported as success.

---

## Testing the Protocol

Beam ships with a **fault-injection layer** that wraps the UDP socket and can drop, delay/reorder and corrupt packets on purpose. Use it to prove the protocol works:

```bash
# Receiver
./beam listen --loss 10 --reorder 10 --corrupt 5

# Sender
./beam send bigfile.bin --loss 10 --reorder 10 --corrupt 5
```

Even with these settings the transfer should finish and the SHA-256 should match. Try increasing the values to see throughput drop and retransmissions rise (`-v` prints retransmit counts).

Automated tests:
```bash
go test ./...            # unit + integration
go test -race ./...      # race detector
go test -fuzz=FuzzDecode ./internal/btp   # fuzz the packet decoder
```

Suggested test cases:
- packet encode/decode round-trip; CRC failure detection
- transfer over loopback with 0%, 10%, 30% loss
- heavy reordering; duplicate packets; single-bit corruption
- receiver rejects → sender gets clear message and sends no data
- empty file, 1-byte file, file size exactly a multiple of the chunk size
- peer disappears mid-transfer → sender aborts cleanly

---

## Project Structure

```
beam/
├─ cmd/beam/               main.go, CLI wiring
├─ internal/
│  ├─ discovery/           broadcast announce/probe, peer table
│  ├─ btp/                 packet encode/decode, CRC, session state machine
│  │   ├─ sender.go        window, timers, retransmit, congestion
│  │   ├─ receiver.go      reorder buffer, ACK generation, reassembly
│  │   └─ rto.go           RTT / RTO estimator
│  ├─ faultnet/            lossy UDP wrapper (loss, reorder, corrupt)
│  ├─ ui/                  prompts, progress bar, tables, colours
│  └─ store/               config and history
├─ docs/                   PRD.md, TRD.md, DESIGN.md
├─ Makefile
└─ README.md
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No peers found" | Make sure `beam listen` is running on the other device, both are on the same subnet, and UDP `47777` is allowed in the firewall. |
| Works on hotspot but not on campus Wi-Fi | Many campus networks isolate clients and block broadcast. Use a phone hotspot or `--to <ip>`. |
| Windows firewall prompt | Allow Beam on private networks. |
| Slow transfer | Check `-v` output for high retransmit counts; you may be on a congested or lossy Wi-Fi link. |

---

## Limitations

- LAN only: no NAT traversal or internet transfer.
- Transfers are **not encrypted** in v1. Anyone on the network can observe packets.
- One active transfer per receiver at a time (v1).
- Messages are plain text, single packet (max ~1200 bytes).

## Roadmap

- Encrypted payloads (key agreement + AES-GCM)
- Resume interrupted transfers
- Folder transfer
- Multiple concurrent sessions
- Trusted-device list and PIN pairing

---

## Tech Notes

- Language: Go, standard library only (`net`, `hash/crc32`, `crypto/sha256`, `encoding/binary`)
- Transport: raw UDP datagrams; **no TCP, no HTTP** anywhere in the data path
- Protocol: BTP v1, described above

## License

MIT
