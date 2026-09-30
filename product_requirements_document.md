# Product Requirements Document (PRD)

## 1. Product Overview
**Product Name:** `lan-drop` (CLI Network File Sharing Tool)  
**Goal:** Provide a zero-configuration, cross-platform CLI application that enables secure, fast, and resilient peer-to-peer file transfers on a Local Area Network without relying on internet connectivity, TCP, HTTP, or third-party servers.

---

## 2. Target Audience & Use Cases
- **Developers & System Administrators:** Sharing logs, scripts, binaries, or data dumps between dev machines, VMs, and home servers.
- **Power Users:** Quick file transfers across macOS, Linux, and Windows machines on home or office networks.
- **Air-Gapped / Isolated Environments:** Networks with strict firewalls blocking egress traffic to public clouds.

---

## 3. Core Features & Functional Requirements

| ID | Feature | Priority | Requirements |
|:---|:---|:---|:---|
| **FR-1** | Automatic Peer Discovery | Must Have | Discovers other instances running on the local subnet via UDP broadcasts without manual IP entry. |
| **FR-2** | Interactive Peer Selection | Must Have | Renders a terminal menu listing active peers (Hostname, IP, OS, Last Seen). |
| **FR-3** | Transfer Prompt & Authorization | Must Have | Receiver must explicitly approve/deny incoming file transfer requests (`[Y/n]`). |
| **FR-4** | Custom Transport Protocol | Must Have | Runs over UDP. Implements sequence indexing, ACKs, retransmissions, sliding window, and corruption checks. |
| **FR-5** | Verification & Integrity | Must Have | Computes pre-send SHA-256 hash and compares with receiver SHA-256 post-transfer. |
| **FR-6** | File Transfer Resume | Should Have | Ability to resume interrupted file transfers based on chunk bitmasks. |
| **FR-7** | Interactive TUI | Should Have | Displays real-time transfer progress, current speed (MB/s), ETA, and network status. |

---

## 4. Non-Functional Requirements
- **Performance:** Transfer speeds of at least 50 MB/s on Gigabit Wi-Fi/Ethernet.
- **Resource Usage:** Memory footprint under 30 MB during transfers; CPU utilization under 15%.
- **Cross-Platform Support:** Single static binary for Linux (x86_64, ARM64), macOS (Intel, Apple Silicon), and Windows (x64).
- **Zero Dependencies:** No external runtime dependencies (e.g., Python, C-libs, OpenSSL).

---

## 5. Success Metrics
- 100% data fidelity on 10GB transfers over simulated 5% packet loss networks.
- Automatic peer discovery within $< 2$ seconds of starting the daemon/CLI.
- Zero leftover temporary files on aborted/rejected transfers.