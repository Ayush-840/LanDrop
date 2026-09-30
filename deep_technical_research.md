# Deep Technical Research: Custom Reliable UDP File Sharing CLI

## 1. Network Discovery Mechanisms
Automatic peer discovery on a Local Area Network (LAN) without a central server requires broadcast or multicast communications.

### 1.1 mDNS / DNS-SD (Multicast DNS)
- **Mechanism:** Operates on `224.0.0.251` (IPv4) or `ff02::fb` (IPv6) on UDP port `5353`.
- **Pros:** Native support on macOS, Windows (Bonjour), and Linux (Avahi). Supports service metadata announcement (e.g., hostname, public key fingerprint, port).
- **Cons:** Higher protocol overhead; library dependencies can complicate minimal CLI deployments.

### 1.2 Custom UDP Broadcast / Multicast
- **UDP Broadcast (`255.255.255.255`):** Sent to all devices on the current subnet. Simple to implement, but restricted to the local subnet and often blocked by enterprise Wi-Fi configurations.
- **UDP Multicast (`224.0.0.0/4`):** Packets sent to a specific multicast group (e.g., `239.255.255.250`).
- **Selection for Project:** Custom **UDP Broadcast + Multicast Fallback** on a dedicated port (e.g., UDP `9999`).
  - Peer periodic heartbeats ("beaconing"): Every 2 seconds.
  - Payload format: JSON containing `Peer ID`, `Hostname`, `Control Port`, and `Public Key Digest`.

---

## 2. Reliable Transport Protocols Over UDP
Standard TCP and HTTP are prohibited by project constraints. Therefore, we must implement a **Stop-and-Wait ARQ** or **Selective Repeat / Sliding Window ARQ** directly over raw UDP sockets.

### 2.1 Sliding Window ARQ Architecture
- **Sequence Numbers:** Monotonically increasing 32-bit uint attached to every packet header.
- **Acknowledgement (ACK):**
  - **Cumulative ACK:** "I have received all bytes/packets up to $N$."
  - **Selective ACK (SACK):** Bitmask or array indicating explicit non-contiguous packets received.
- **Retransmission Timers:** Adaptive RTT estimation using Karn's Algorithm and Jacobson's Algorithm for dynamic timeout selection ($RTO = SRTT + 4 \times RTTVAR$).
- **Flow Control:** Receiver publishes a `Window Size` (number of buffer slots available) in every ACK packet to prevent receiver buffer overflow.
- **Congestion Control:** Simplified TCP Reno/Tahoe style window adjustments (Additive Increase / Multiplicative Decrease - AIMD).

### 2.2 Wire Packet Structure (Binary Protocol Header)
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Magic (0x4C4E)       |   Type (1B)   |   Flags (1B)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                     Acknowledgement Number                    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Window Size          |         Payload Length        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        CRC32 Checksum                         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|                        Payload Data                           |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

---

## 3. Cryptography & Peer Verification
To guarantee end-to-end data integrity and sender verification:
1. **Integrity:** Chunk-level CRC32 (fast error detection) + File-level **SHA-256 Digest** computed pre-and-post transfer.
2. **Transfer Handshake:** TLS-like 3-way handshake over custom UDP protocol:
   - `SYN`: Transfer Request (Filename, Total Size, File Hash, Chunk Count).
   - `SYN-ACK`: User Acceptance + Accepted Window Size.
   - `ACK`: Transfer Commences.

---

## 4. CLI Framework & TUI Selection
- **Language Choice:** Go (Golang) or Rust. Go is chosen for its superior built-in network primitives, lightweight concurrency (`goroutines`), and single binary compilation.
- **Terminal UI Library:** `charmbracelet/bubbletea` or `pterm` for interactive terminal UI (interactive selection, progress bars, real-time metrics).