package btp

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"time"
)

// jsonUnmarshal is a thin indirection so tests can hook decode failures.
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

// Base returns the final path element (filename only, no directories).
func Base(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[i+1:]
		}
	}
	return path
}

// LocalName returns the device name shown to peers (hostname).
func LocalName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "unknown"
	}
	return h
}

// errTimeout is returned by recv helpers when the deadline passes.
var errTimeout = errors.New("btp: receive timeout")

// recvSession reads packets until one matches session (or timeout).
// Non-matching datagrams (discovery, other sessions) are skipped.
func recvSession(conn net.PacketConn, session uint32, timeout time.Duration) (*Packet, error) {
	buf := make([]byte, MaxPacketSize)
	deadline := time.Now().Add(timeout)
	for {
		remain := time.Until(deadline)
		if remain <= 0 {
			return nil, errTimeout
		}
		conn.SetReadDeadline(time.Now().Add(remain))
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			return nil, err
		}
		p, err := Decode(buf[:n])
		if err != nil || p.Session != session {
			continue
		}
		return p, nil
	}
}

// recvFor is recvSession but also requires a packet type.
func recvFor(conn net.PacketConn, session uint32, timeout time.Duration, want byte) (*Packet, error) {
	deadline := time.Now().Add(timeout)
	for {
		p, err := recvSession(conn, session, time.Until(deadline))
		if err != nil {
			return nil, err
		}
		if p.Type == want {
			return p, nil
		}
	}
}
