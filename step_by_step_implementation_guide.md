# Step-by-Step Implementation Guide

Follow this structured guide to implement `lan-drop` from scratch using Go.

---

## Step 1: Project Initialization & Directory Setup

Initialize a new Go module and establish the clean architecture directory structure:

```bash
mkdir lan-drop && cd lan-drop
go mod init lan-drop
mkdir -p cmd/landrop pkg/discovery pkg/protocol pkg/tui pkg/utils
```

Dependencies required:
```bash
go get github.com/charmbracelet/bubbletea
go get github.com/charmbracelet/lipgloss
go get github.com/charmbracelet/bubbles
```

---

## Step 2: Implement Packet Serialization Protocol (`pkg/protocol/packet.go`)

Create the core packet header parsing and encoding logic:

```go
package protocol

import (
	"encoding/binary"
	"errors"
	"hash/crc32"
)

const (
	MagicHeader uint16 = 0x4C4E
	HeaderSize  int    = 20 // bytes

	TypeSyn      byte = 0x01
	TypeSynAck   byte = 0x02
	TypeData     byte = 0x03
	TypeAck      byte = 0x04
	TypeFin      byte = 0x05
	TypeNack     byte = 0x06
)

type Packet struct {
	Magic      uint16
	Type       byte
	Flags      byte
	SeqNum     uint32
	AckNum     uint32
	Window     uint16
	PayloadLen uint16
	Checksum   uint32
	Payload    []byte
}

func (p *Packet) Serialize() []byte {
	buf := make([]byte, HeaderSize+len(p.Payload))
	binary.BigEndian.PutUint16(buf[0:2], p.Magic)
	buf[2] = p.Type
	buf[3] = p.Flags
	binary.BigEndian.PutUint32(buf[4:8], p.SeqNum)
	binary.BigEndian.PutUint32(buf[8:12], p.AckNum)
	binary.BigEndian.PutUint16(buf[12:14], p.Window)
	binary.BigEndian.PutUint16(buf[14:16], uint16(len(p.Payload)))
	
	copy(buf[HeaderSize:], p.Payload)
	
	// Compute checksum over header (excluding checksum field) and payload
	checksum := crc32.ChecksumIEEE(buf[0:16])
	checksum = crc32.Update(checksum, crc32.IEEETable, p.Payload)
	p.Checksum = checksum
	binary.BigEndian.PutUint32(buf[16:20], p.Checksum)

	return buf
}

func Deserialize(data []byte) (*Packet, error) {
	if len(data) < HeaderSize {
		return nil, errors.New("packet too short")
	}

	magic := binary.BigEndian.Uint16(data[0:2])
	if magic != MagicHeader {
		return nil, errors.New("invalid magic header")
	}

	checksum := binary.BigEndian.Uint32(data[16:20])
	
	// Verify Checksum
	calc := crc32.ChecksumIEEE(data[0:16])
	calc = crc32.Update(calc, crc32.IEEETable, data[HeaderSize:])
	if calc != checksum {
		return nil, errors.New("checksum verification failed: corrupted packet")
	}

	return &Packet{
		Magic:      magic,
		Type:       data[2],
		Flags:      data[3],
		SeqNum:     binary.BigEndian.Uint32(data[4:8]),
		AckNum:     binary.BigEndian.Uint32(data[8:12]),
		Window:     binary.BigEndian.Uint16(data[12:14]),
		PayloadLen: binary.BigEndian.Uint16(data[14:16]),
		Checksum:   checksum,
		Payload:    data[HeaderSize:],
	}, nil
}
```

---

## Step 3: Implement Discovery Daemon (`pkg/discovery/beacon.go`)

Build the UDP background beacon and discovery registry:

```go
package discovery

import (
	"encoding/json"
	"net"
	"sync"
	"time"
)

type Peer struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	LastSeen time.Time
}

type Service struct {
	LocalPeer Peer
	Peers     map[string]Peer
	mu        sync.RWMutex
	conn      *net.UDPConn
}

func NewService(peerID, hostname string, port int) (*Service, error) {
	return &Service{
		LocalPeer: Peer{
			ID:       peerID,
			Hostname: hostname,
			Port:     port,
		},
		Peers: make(map[string]Peer),
	}, nil
}

func (s *Service) StartBroadcasting(broadcastPort int) error {
	addr, err := net.ResolveUDPAddr("udp4", "255.255.255.255:"+string(rune(broadcastPort)))
	if err != nil {
		return err
	}

	conn, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		return err
	}

	go func() {
		for {
			data, _ := json.Marshal(s.LocalPeer)
			conn.Write(data)
			time.Sleep(2 * time.Second)
		}
	}()
	return nil
}
```

---

## Step 4: Implement Transfer Engine (`pkg/protocol/engine.go`)

Implement chunking, sliding window transmission, retransmissions, and hash validation routines:

1. Read input file in chunks of **64KB**.
2. Sequence chunks from index `1` to `N`.
3. Dispatch chunks using sliding window.
4. Block until all cumulative ACKs arrive.
5. Send `TypeFin` with final SHA-256.
6. Verify local file hash on Receiver end.

---

## Step 5: Build Bubbletea Terminal UI (`pkg/tui/ui.go`)

Construct an interactive TUI model featuring:
- Live peer discovery table.
- Interactive keyboard selection (`↑` / `↓` / `Enter`).
- Real-time progress bar for active transfers.