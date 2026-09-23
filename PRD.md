# PRD — Beam: Zero-Config LAN File Transfer for the Terminal

**Problem statement:** #386 — Terminal-based "AirDrop" for LAN file transfer
**Project type:** Terminal application (CLI)
**Version:** 1.0 (college project)

---

## 1. Problem

Sending a file between two machines on the same network is harder than it should be.

- Cloud tools (email, Drive, Slack) need internet and route data through a third party, even when both devices are three feet apart.
- LAN tools (`scp`, `netcat`) need the peer's IP in advance, manual setup, and give no discovery, no resume and no integrity guarantee.
- AirDrop is Apple-only and GUI-only. Terminal users and Linux/Windows users have no equivalent.

## 2. Product Vision

`beam` is a single-binary CLI. On one machine you run `beam receive`; on another you run `beam send report.pdf`. The sender finds the receiver automatically, the receiver approves, the file moves at LAN speed, and both sides confirm it arrived intact. No IP addresses, no accounts, no internet.

## 3. Goals

| # | Goal | Success measure |
|---|------|-----------------|
| G1 | Zero-config discovery | Sender lists receivers on the LAN within 3 seconds |
| G2 | Reliable transfer | 1 GB file transfers with matching SHA-256 |
| G3 | Resumable | Interrupted transfer resumes from last good byte, not from zero |
| G4 | Safe by default | Receiver must approve; PIN pairing blocks random senders |
| G5 | Cross-platform | Same binary behaviour on Linux, Windows, macOS |
| G6 | Great terminal UX | Live progress bar with speed and ETA, clear errors |

## 4. Non-Goals

- No internet/WAN transfer, no NAT traversal, no cloud relay
- No GUI or web interface
- No user accounts or central server
- No group/multi-receiver broadcast in v1

## 5. Target Users

1. **Developers / power users** moving build artifacts, logs, dumps between machines.
2. **Students** sharing project files across laptops in a lab or hostel with no internet.
3. **Mixed-OS households/offices** where AirDrop is not an option.

## 6. User Stories

- As a sender, I run `beam send file.zip` and see nearby receivers to pick from.
- As a receiver, I run `beam receive` and am asked to accept or reject an incoming file.
- As a user on a flaky Wi-Fi, I re-run the same command after a drop and the transfer continues where it stopped.
- As a cautious user, I want to know the file was not corrupted or tampered with.
- As a scripter, I want `--json` output and exit codes so I can automate transfers.
- As a user on a network that blocks discovery, I can pass `--to 192.168.1.20` manually.

## 7. Functional Requirements

### Must have (MVP: this is what earns the marks)

| ID | Requirement |
|----|-------------|
| F1 | `beam receive` listens for transfers and announces itself on the LAN |
| F2 | `beam send <file>...` discovers receivers via UDP broadcast and lists them |
| F3 | `beam send <file> --to <name\|ip>` skips discovery |
| F4 | Receiver prompts accept / reject showing sender name, file name, size (`--auto-accept` to skip) |
| F5 | Length-prefixed binary protocol over TCP |
| F6 | Chunked streaming (never loads whole file into RAM) |
| F7 | Per-chunk CRC32 check and final SHA-256 verification |
| F8 | Resume via partial file + metadata; sender is told the offset to continue from |
| F9 | 6-digit PIN pairing: receiver shows PIN, sender enters it; authenticated with HMAC challenge-response |
| F10 | Live progress bar: percent, bytes, speed, ETA |
| F11 | Multiple files in one command |
| F12 | Filename sanitisation (block `../` path traversal), collision handling (`file (1).zip`) |
| F13 | `beam peers` lists discoverable receivers |
| F14 | `beam history` shows past transfers (JSON log) |
| F15 | Meaningful exit codes and error messages |

### Should have

| ID | Requirement |
|----|-------------|
| S1 | Directory send (streamed as tar) |
| S2 | `--json` machine-readable output |
| S3 | Config file (`~/.beam/config.json`): device name, download dir, port |
| S4 | Transfer speed limit `--limit 5MB/s` |

### Stretch (only if time remains)

| ID | Requirement |
|----|-------------|
| X1 | Encrypted stream (AES-256-GCM, key derived from PIN via HKDF) |
| X2 | Send to several receivers concurrently |
| X3 | Terminal QR code containing IP + PIN |

## 8. Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| Performance | ≥ 80% of raw link throughput on Wi-Fi/Ethernet; memory under 50 MB regardless of file size |
| Reliability | No corrupt file is ever marked complete |
| Security | No transfer without explicit accept; PIN never sent in clear; sanitised paths |
| Portability | Single static binary, no runtime install |
| Usability | First transfer possible in under 30 seconds with no docs |
| Testability | Core logic (protocol, resume, hashing) covered by unit tests |

## 9. User Flow (Happy Path)

1. Laptop B: `beam receive` → prints device name and PIN `482913`, waits.
2. Laptop A: `beam send movie.mkv` → shows "Found: laptop-b (192.168.1.22)".
3. A selects it, enters PIN.
4. B shows "laptop-a wants to send movie.mkv (1.4 GB). Accept? [y/N]" → `y`.
5. Both show a live progress bar.
6. Both print "✔ Verified SHA-256 ok".

## 10. Edge Cases to Handle

- Receiver disk full → abort with clear message before/during transfer
- Sender file changes mid-transfer → detect via size/mtime, abort
- Two senders at once → receiver queues or handles concurrently
- Wrong PIN (3 attempts, then lockout for 30s)
- Firewall blocks UDP broadcast → suggest `--to IP`
- Connection drop → partial file kept, resume offered next time
- File already exists → auto-rename, never silently overwrite
- Zero-byte file, very long filenames, unicode names

## 11. Scope & Timeline (suggested, ~4 weeks)

| Week | Deliverable |
|------|-------------|
| 1 | Protocol + plain TCP send/receive of one file with progress bar |
| 2 | UDP discovery, accept/reject prompt, PIN auth, hashing |
| 3 | Resume, multi-file, history, config, error handling, tests |
| 4 | Directory send, polish, README, demo script, report, viva prep |

## 12. Acceptance Criteria (Demo Checklist)

- [ ] Transfer a 500 MB+ file between two machines with matching hash
- [ ] Kill the connection mid-transfer, re-run, and show it resumes
- [ ] Wrong PIN is rejected
- [ ] Reject path works and sender sees "declined"
- [ ] Discovery works with no IP typed
- [ ] Unit tests pass (`go test ./...`)
- [ ] Works on two different OSes (bonus)

## 13. Why This Project Scores Well

It shows real computer-networks concepts (sockets, TCP framing, broadcast discovery), systems concepts (streaming I/O, concurrency), security basics (HMAC, hashing, path safety) and engineering discipline (tests, docs, error handling), in a tool that is genuinely useful and demoable live in two minutes.
