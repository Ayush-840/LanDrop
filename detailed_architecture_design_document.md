# Detailed Architecture & System Design Document

## 1. High-Level System Architecture

```
+-----------------------------------------------------------------------+
|                             LAN-DROP CLI                              |
+-----------------------------------------------------------------------+
|  +---------------------+  +--------------------+  +-----------------+ |
|  | Discovery Module    |  | Interactive TUI    |  | File Handler    | |
|  | (UDP Beacon/Listen) |  | (Bubbletea Engine) |  | (Chunker/Hash)  | |
|  +----------+----------+  +---------+----------+  +--------+--------+ |
|             |                       |                      |          |
|             +-------------------+   |   +------------------+          |
|                                 v   v   v                             |
|                  +----------------------------------+                 |
|                  | Custom Reliable Protocol Engine  |                 |
|                  | (Sliding Window ARQ Over UDP)    |                 |
|                  +----------------+-----------------+                 |
+-----------------------------------|-----------------------------------+
                                    |
                                    v
                     +------------------------------+
                     |    OS Network Stack (UDP)    |
                     +------------------------------+
```

---

## 2. Component Specifications

### 2.1 Discovery Engine
- **Beaconing:** Broadcasts a UDP packet every 2000ms to `255.255.255.255:9999`.
- **Peer Directory:** Thread-safe map `map[string]Peer` keyed by Peer ID. Evicts peers if no heartbeat is received within 6 seconds.

```json
{
  "peer_id": "a1b2c3d4",
  "hostname": "macbook-pro.local",
  "ip": "192.168.1.45",
  "port": 9998,
  "os": "darwin",
  "protocol_version": 1
}
```

### 2.2 Protocol Control Finite State Machine (FSM)

```
        SENDER STATE MACHINE                     RECEIVER STATE MACHINE
      +---------------------+                  +---------------------+
      |        IDLE         |                  |        IDLE         |
      +----------+----------+                  +----------+----------+
                 | Send Req                               | Recv SYN
                 v                                        v
      +---------------------+                  +---------------------+
      |   WAIT_ACCEPTANCE   |                  |    PROMPT_ACCEPT    |
      +----------+----------+                  +----------+----------+
                 | Recv SYN-ACK                           | User Accepts
                 v                                        v
      +---------------------+                  +---------------------+
      |  TRANSFER_STREAMING |                  |  RECEIVING_STREAM   |
      +----------+----------+                  +----------+----------+
                 | All Chunks ACKed                       | Last Chunk Recv
                 v                                        v
      +---------------------+                  +---------------------+
      |    VERIFY_HASH      |                  |    VERIFY_HASH      |
      +----------+----------+                  +----------+----------+
                 | Valid SHA-256                          | Valid SHA-256
                 v                                        v
      +---------------------+                  +---------------------+
      |      COMPLETE       |                  |      COMPLETE       |
      +---------------------+                  +---------------------+
```

### 2.3 Reliability Layer (ARQ Implementation Details)
- **Chunk Size:** 64 KB (65,536 bytes) per UDP payload to optimize LAN throughput while mitigating IP fragmentation.
- **Sliding Window Size:** $W = 64$ frames (~4 MB in-flight buffer).
- **Out-of-Order Buffer:** Receiver maintains a bounded array buffer. Packets arriving out-of-order within the window are written to their dynamic offsets without advancing the ACK index.

---

## 3. Error Handling & Packet Recovery Matrix

| Scenario | Detection Mechanism | Recovery Strategy |
|:---|:---|:---|
| Packet Dropped (Data) | Retransmission Timeout (RTO) expires on Sender | Sender re-transmits unACKed packets starting from lower edge of window. |
| Packet Dropped (ACK) | Duplicate ACK received by Sender | Sender treats cumulative ACK as baseline; ignored if redundant. |
| Packet Corruption | CRC32 mismatch on Receiver | Receiver silently drops packet; Sender times out and retransmits. |
| Receiver Decline | Receiver sends `NACK` frame during handshake | Sender aborts transaction, prints "Rejected by peer", returns to main menu. |
| Unexpected Peer Disconnect | Keep-alive timeout (3 failed handshake re-tries) | Abort transfer, clear partial buffer, notify user via TUI. |