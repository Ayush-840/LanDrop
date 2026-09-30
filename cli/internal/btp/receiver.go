package btp

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"
)

// ReceiverConfig tunes the receiver.
type ReceiverConfig struct {
	Dir        string // destination directory
	RecvWindow uint16 // advertised window (packets)
	ChunkSize  int    // expected chunk size (MTU)
	Prompter   func(meta ConnectMeta, from net.Addr) bool
	Progress   func(recvd, total int64)
	Verbose    func(format string, args ...any)
	// AutoAccept is used by tests/bench; production uses Prompter.
	AutoAccept bool
}

// ReceiverStats is returned after a transfer.
type ReceiverStats struct {
	Name       string
	Size       int64
	SHA256     string
	Path       string
	Chunks     int64
	Kind       string
	Text       string
	SenderName string
}

// ListenOnce waits for one CONNECT, runs consent + receive + verify, then
// lingers 5s answering retransmitted FIN (TRD §3.6 tail loss). It returns the
// transfer stats. Call in a loop for `beam listen`.
func ListenOnce(conn net.PacketConn, cfg ReceiverConfig) (*ReceiverStats, error) {
	logf := func(string, ...any) {}
	if cfg.Verbose != nil {
		logf = cfg.Verbose
	}
	if cfg.RecvWindow == 0 {
		cfg.RecvWindow = 64
	}
	if cfg.ChunkSize <= 0 {
		cfg.ChunkSize = MaxPayload
	}
	if cfg.Dir == "" {
		cfg.Dir = "."
	}

	buf := make([]byte, MaxPacketSize)
	for {
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			return nil, err
		}
		p, err := Decode(buf[:n])
		if err != nil || p.Type != TypeConnect {
			continue // corrupt or not a new session
		}
		var meta ConnectMeta
		if err := jsonUnmarshal(p.Payload, &meta); err != nil {
			sendError(conn, from, p.Session, "bad_connect", "malformed connect")
			continue
		}
		// legacy file/msg shapes
		if meta.Kind == "" {
			if fm, err := DecodeFileMeta(p.Payload); err == nil && fm.Name != "" {
				meta = ConnectMeta{Kind: "file", Name: fm.Name, Size: fm.Size, SHA256: fm.SHA256, SenderName: fm.Sender, ChunkSize: cfg.ChunkSize}
			} else if mm, _ := DecodeMsgMeta(p.Payload); mm != nil && mm.Text != "" {
				meta = ConnectMeta{Kind: "message", Text: mm.Text, SenderName: mm.Sender}
			}
		}
		if meta.Kind == "" {
			meta.Kind = "file"
		}
		if meta.ChunkSize <= 0 {
			meta.ChunkSize = cfg.ChunkSize
		}
		if meta.ChunkSize > MaxPayload {
			meta.ChunkSize = MaxPayload
		}
		st, err := handleSession(conn, from, p.Session, p.Seq, meta, cfg, logf)
		if err != nil {
			logf("session %08x: %v", p.Session, err)
		}
		if st != nil {
			return st, nil
		}
		// REJECT path returns nil,nil → keep listening
	}
}

func handleSession(conn net.PacketConn, from net.Addr, session uint32, _ uint32, meta ConnectMeta, cfg ReceiverConfig, logf func(string, ...any)) (*ReceiverStats, error) {
	// Disk-space check before ACCEPT (TRD §3.11).
	if meta.Kind == "file" && meta.Size > 0 {
		if !diskOK(cfg.Dir, meta.Size) {
			sendReject(conn, from, session, "disk full")
			return nil, fmt.Errorf("btp: disk full, rejected %q", meta.Name)
		}
	}

	// Consent: PENDING every 2s while deciding, 60s prompt timeout → REJECT.
	decided := make(chan bool, 1)
	go func() {
		ok := cfg.AutoAccept
		if cfg.Prompter != nil {
			ok = cfg.Prompter(meta, from)
		}
		decided <- ok
	}()
	pendingTick := time.NewTicker(2 * time.Second)
	defer pendingTick.Stop()
	timeout := time.After(60 * time.Second)
	accepted := false
decide:
	for {
		select {
		case ok := <-decided:
			accepted = ok
			break decide
		case <-pendingTick.C:
			_, _ = conn.WriteTo((&Packet{Type: TypePending, Session: session}).Encode(), from)
		case <-timeout:
			sendReject(conn, from, session, "answer timeout")
			return nil, fmt.Errorf("btp: prompt timeout")
		}
	}
	if !accepted {
		sendReject(conn, from, session, "declined")
		return nil, nil // keep listening; sender reports rejected
	}
	ar := AcceptReply{RecvWindow: cfg.RecvWindow}
	_, _ = conn.WriteTo((&Packet{Type: TypeAccept, Session: session, Payload: EncodeJSON(ar)}).Encode(), from)
	logf("session %08x: accepted %q (%d bytes)", session, displayName(meta), meta.Size)

	if meta.Kind == "message" {
		return recvMessage(conn, from, session, meta, cfg, logf)
	}
	return recvFile(conn, from, session, meta, cfg, logf)
}

func displayName(m ConnectMeta) string {
	if m.Kind == "message" {
		return "message"
	}
	return m.Name
}

func recvMessage(conn net.PacketConn, from net.Addr, session uint32, meta ConnectMeta, cfg ReceiverConfig, logf func(string, ...any)) (*ReceiverStats, error) {
	// Message goes through accept, ACK and verify path (TRD §3.4).
	var text []byte
	if meta.Text != "" {
		text = []byte(meta.Text) // sender embedded text in CONNECT
		ack := &Ack{Cum: 1, Win: cfg.RecvWindow}
		_, _ = conn.WriteTo((&Packet{Type: TypeAck, Session: session, Payload: ack.Encode()}).Encode(), from)
		_, _ = conn.WriteTo((&Packet{Type: TypeFinAck, Session: session, Payload: []byte{0}}).Encode(), from)
		return &ReceiverStats{Kind: "message", Text: string(text), SenderName: meta.SenderName}, nil
	}
	buf := make([]byte, MaxPacketSize)
	deadline := time.Now().Add(30 * time.Second)
	conn.SetReadDeadline(deadline)
	for {
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			return nil, fmt.Errorf("btp: msg wait: %w", err)
		}
		if addr.String() != from.String() {
			continue
		}
		p, err := Decode(buf[:n])
		if err != nil || p.Session != session {
			continue
		}
		switch p.Type {
		case TypeData:
			if p.Seq == 0 {
				text = append([]byte(nil), p.Payload...)
			}
			ack := &Ack{Cum: 1, Win: cfg.RecvWindow}
			_, _ = conn.WriteTo((&Packet{Type: TypeAck, Session: session, Payload: ack.Encode()}).Encode(), from)
		case TypeFin:
			want := parseFinHash(p.Payload)
			sum := sha256.Sum256(text)
			var status byte
			if !bytes.Equal(want, sum[:]) {
				status = 1
			}
			_, _ = conn.WriteTo((&Packet{Type: TypeFinAck, Session: session, Payload: []byte{status}}).Encode(), from)
			if status != 0 {
				return nil, fmt.Errorf("btp: message checksum mismatch")
			}
			linger(conn, from, session, []byte{0})
			return &ReceiverStats{Kind: "message", Text: string(text), SenderName: meta.SenderName}, nil
		case TypeConnect:
			// retransmitted CONNECT: re-send ACCEPT
			ar := AcceptReply{RecvWindow: cfg.RecvWindow}
			_, _ = conn.WriteTo((&Packet{Type: TypeAccept, Session: session, Payload: EncodeJSON(ar)}).Encode(), from)
		}
	}
}

// SenderNameOf extracts sender for stats compat.
func SenderNameOf(m ConnectMeta) string { return m.SenderName }

func recvFile(conn net.PacketConn, from net.Addr, session uint32, meta ConnectMeta, cfg ReceiverConfig, logf func(string, ...any)) (*ReceiverStats, error) {
	chunkSize := meta.ChunkSize
	if chunkSize <= 0 {
		chunkSize = MaxPayload
	}
	total := meta.TotalChunks
	if total <= 0 && meta.Size >= 0 {
		total = (meta.Size + int64(chunkSize) - 1) / int64(chunkSize)
	}
	safe := SanitizeFilename(meta.Name)
	if safe == "" {
		safe = "beam-file"
	}
	// no-overwrite: pick unique name; write temp then rename on verify.
	dest := UniquePath(cfg.Dir, safe, func(p string) bool {
		_, err := os.Stat(p)
		return err == nil
	})
	tmp := dest + ".beam-part"
	f, err := os.Create(tmp)
	if err != nil {
		sendFinAck(conn, from, session, 2)
		return nil, err
	}
	defer func() {
		f.Close()
		if _, err := os.Stat(dest); err != nil {
			os.Remove(tmp)
		}
	}()
	if meta.Size > 0 {
		_ = f.Truncate(meta.Size)
	}

	got := make(map[uint32]bool)
	var bitmap Ack
	bitmap.Cum = 0
	bitmap.Win = cfg.RecvWindow
	var received int64
	sinceAck := 0
	lastAck := time.Now()
	lastSeen := time.Now()
	ackNow := func() {
		a := bitmap
		a.Win = cfg.RecvWindow
		_, _ = conn.WriteTo((&Packet{Type: TypeAck, Session: session, Payload: a.Encode()}).Encode(), from)
		sinceAck = 0
		lastAck = time.Now()
	}

	buf := make([]byte, MaxPacketSize)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		n, addr, err := conn.ReadFrom(buf)
		if err != nil {
			if time.Since(lastSeen) > 30*time.Second {
				return nil, fmt.Errorf("btp: session expired (30s silence)")
			}
			continue
		}
		p, err := Decode(buf[:n])
		if err != nil {
			continue // corruption → treated as loss
		}
		if p.Session != session {
			continue
		}
		if addr.String() != from.String() {
			continue
		}
		lastSeen = time.Now()
		switch p.Type {
		case TypeConnect:
			ar := AcceptReply{RecvWindow: cfg.RecvWindow}
			_, _ = conn.WriteTo((&Packet{Type: TypeAccept, Session: session, Payload: EncodeJSON(ar)}).Encode(), from)
		case TypeData:
			seq := p.Seq
			if int64(seq) >= total && total > 0 {
				ackNow()
				continue
			}
			if !got[seq] {
				off := int64(seq) * int64(chunkSize)
				if _, err := f.WriteAt(p.Payload, off); err != nil {
					sendFinAck(conn, from, session, 2)
					return nil, err
				}
				got[seq] = true
				received += int64(len(p.Payload))
				bitmap.Set(seq)
				bitmap.Advance()
				if cfg.Progress != nil {
					cfg.Progress(received, meta.Size)
				}
			}
			// ACK immediately on gaps, else every 2 packets or 20ms.
			gap := int64(bitmap.Cum) < int64(len(got))
			sinceAck++
			if gap || sinceAck >= 2 || time.Since(lastAck) > 20*time.Millisecond {
				ackNow()
			}
		case TypeFin:
			ackNow()
			want := parseFinHash(p.Payload)
			if err := f.Sync(); err != nil {
				sendFinAck(conn, from, session, 2)
				return nil, err
			}
			f.Close()
			gotHash, err := hashFile(tmp)
			if err != nil {
				sendFinAck(conn, from, session, 2)
				return nil, err
			}
			if !bytes.Equal(want, gotHash) {
				os.Remove(tmp)
				sendFinAck(conn, from, session, 1)
				return nil, fmt.Errorf("btp: SHA-256 mismatch (got %s)", hex.EncodeToString(gotHash))
			}
			if err := os.Rename(tmp, dest); err != nil {
				// fallback copy
				if err2 := copyFile(tmp, dest); err2 != nil {
					sendFinAck(conn, from, session, 2)
					return nil, err2
				}
				os.Remove(tmp)
			}
			sendFinAck(conn, from, session, 0)
			logf("session %08x: verified %s sha256=%s", session, dest, hex.EncodeToString(gotHash))
			linger(conn, from, session, []byte{0})
			_ = filepath.Base(dest)
			return &ReceiverStats{Name: safe, Size: meta.Size, SHA256: hex.EncodeToString(gotHash), Path: dest, Chunks: total, Kind: "file"}, nil
		case TypeError:
			return nil, fmt.Errorf("btp: sender aborted: %s", string(p.Payload))
		}
	}
}

func linger(conn net.PacketConn, from net.Addr, session uint32, finAck []byte) {
	// Answer retransmitted FIN for 5s (TRD §3.6).
	deadline := time.Now().Add(5 * time.Second)
	_ = conn.SetReadDeadline(deadline)
	raw := (&Packet{Type: TypeFinAck, Session: session, Payload: finAck}).Encode()
	buf := make([]byte, MaxPacketSize)
	for time.Now().Before(deadline) {
		n, _, err := conn.ReadFrom(buf)
		if err != nil {
			continue
		}
		p, err := Decode(buf[:n])
		if err != nil || p.Session != session {
			continue
		}
		if p.Type == TypeFin {
			_, _ = conn.WriteTo(raw, from)
		}
	}
}
