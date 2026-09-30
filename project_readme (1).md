# 🚀 lan-drop

> Zero-config, cross-platform CLI for lightning-fast peer-to-peer LAN file transfers powered by a custom reliable UDP transport protocol.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)

---

## Key Features

- 🔍 **Zero-Conf Automatic Discovery:** Instantly discovers peers on your local network using UDP beacons without requiring manual IP address input.
- ⚡ **Custom Reliable UDP Protocol:** Bypasses TCP overhead with a custom Sliding-Window ARQ engine featuring sequence tracking, cumulative/selective ACKs, dynamic timeouts, and checksum verification.
- 🛡️ **Explicit Authorizations:** Prevents unwanted file transfers by requiring the receiving peer to explicitly accept or decline transfer requests.
- 🔐 **Integrity Verified:** Performs full file SHA-256 verification post-transfer to guarantee byte-for-byte fidelity.
- 🖥️ **Cross-Platform TUI:** Beautiful terminal interface powered by Charm's `bubbletea`.

---

## 🛠️ Architecture Overview

```
 [ Local Peer A ]                                 [ Local Peer B ]
  +------------+                                   +------------+
  | CLI / TUI  |                                   | CLI / TUI  |
  +-----+------+                                   +-----+------+
        |                                                |
        |---- 1. UDP Discovery Broadcast (Port 9999) --->|
        |<--- 2. Peer Heartbeat Response ----------------|
        |                                                |
        |---- 3. Transfer Request (SYN) ---------------->| (Prompt User [Y/n])
        |<--- 4. Transfer Acceptance (SYN-ACK) ----------|
        |                                                |
        |== 5. Reliable Data Streaming over UDP (Chunks) =>|
        |<== 6. Selective ACKs / Sliding Window =========|
        |                                                |
        |---- 7. Complete Transmission (FIN + SHA256) --->| (Validate Hash)
```

---

## 🚀 Quickstart

### Prerequisites
- Go 1.21+ (Only required for building from source)

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/lan-drop.git
cd lan-drop

# Build binary
go build -o lan-drop ./cmd/landrop

# Move to system path
sudo mv lan-drop /usr/local/bin/
```

---

## 💻 Usage Instructions

### 1. Start receiving daemon / listening mode
To make your machine discoverable and ready to receive files:
```bash
lan-drop listen
```

### 2. Send a file
Launch the interactive peer discovery terminal:
```bash
lan-drop send /path/to/your-file.zip
```

1. Select target peer from the discovered list using arrow keys.
2. Press **Enter** to initiate the transfer handshake.
3. The receiver will be prompted to accept `[Y/n]`.
4. Monitor live progress and transfer speed directly in your terminal.

---

## 🧪 Testing Network Reliability & Packet Loss

You can test `lan-drop`'s custom ARQ protocol resiliency under degraded network conditions using standard Linux `tc` (Traffic Control) tools:

```bash
# Introduce 5% packet loss and 20ms delay on local loopback interface
sudo tc qdisc add dev lo root netem delay 20ms loss 5%

# Run transfer test
lan-drop send testfile.iso

# Reset network interface settings
sudo tc qdisc del dev lo root
```

---

## 📄 License
Distributed under the MIT License. See `LICENSE` for more information.