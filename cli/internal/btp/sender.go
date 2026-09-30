package btp

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"time"
)

// SenderConfig tunes the sliding-window sender.
type SenderConfig struct {
	Window     int                                  // initial congestion window in packets (AIMD grows it)
	MTU        int                                  // max payload per DATA packet
	RetryLimit int                                  // consecutive timeouts on one segment before abort
	Progress   func(sent, total int64, bps float64) // optional progress callback
	StatsHook  func(SenderStats)                    // optional --stats dashboard hook
	Verbose    func(format string, args ...any)     // optional -v protocol log
}

// SenderStats is the live protocol dashboard data (--stats).
type SenderStats struct {
	Window     int
	InFlight   int
	RTO        time.Duration
	SRTT       time.Duration
	FastRtx    int
	TimeoutRtx int
	BytesAcked int64
	Total      int64
	Done       bool
}

// DefaultSenderConfig returns sane LAN values (TRD §3.6: cwnd 4, cap 64).
func DefaultSenderConfig() SenderConfig {
	return SenderConfig{
		Window:     4,
		MTU:        MaxPayload,
		RetryLimit: 8,
	}
}

// pending is one unacknowledged DATA packet.
type pending struct {
	seq      uint32
	chunk    []byte
	sentAt   time.Time
	tries    int
	timedOut bool // retransmitted at least once (Karn's: no RTT sample)
}

// ErrRejected is returned when the receiver declines the transfer.
var ErrRejected = errors.New("btp: transfer rejected by receiver")

// ErrNoAnswer is returned when the receiver never answers.
var ErrNoAnswer = errors.New("btp: peer did not answer")

// SendFile performs a complete file transfer to dstAddr over conn:
// CONNECT → wait ACCEPT → DATA with sliding window → FIN → FIN_ACK.
func SendFile(conn net.PacketConn, dst net.Addr, session uint32, path string, cfg SenderConfig) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("btp: open %s: %w", path, err)
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return fmt.Errorf("btp: stat %s: %w", path, err)
	}

	logf := func(string, ...any) {}
	if cfg.Verbose != nil {
		logf = cfg.Verbose
	}

	logf("connect: hashing %s (%d bytes)", path, fi.Size())
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("btp: hash %s: %w", path, err)
	}
	rawSum := h.Sum(nil)
	sha := hex.EncodeToString(rawSum)
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("btp: rewind %s: %w", path, err)
	}

	if cfg.MTU <= 0 {
		cfg.MTU = MaxPayload
	}
	total := (fi.Size() + int64(cfg.MTU) - 1) / int64(cfg.MTU)
	meta := ConnectMeta{
		Kind: "file", Name: Base(path), Size: fi.Size(), SHA256: sha,
		ChunkSize: cfg.MTU, TotalChunks: total, SenderName: LocalName(),
	}

	logf("connect: offering %s (%d chunks) to %s", meta.Name, total, dst)
	if err := handshakeFile(conn, dst, session, meta); err != nil {
		return err
	}

	logf("data: window=%d mtu=%d", cfg.Window, cfg.MTU)
	return sendData(conn, dst, session, f, fi.Size(), rawSum, total, cfg, logf)
}

// SendMsg sends a short text message reliably through the same
// accept → DATA → FIN verify path as a file (TRD §3.4).
func SendMsg(conn net.PacketConn, dst net.Addr, session uint32, text string, cfg SenderConfig) error {
	logf := func(string, ...any) {}
	if cfg.Verbose != nil {
		logf = cfg.Verbose
	}
	sum := sha256.Sum256([]byte(text))
	meta := ConnectMeta{Kind: "message", Text: text, SenderName: LocalName(), ChunkSize: MaxPayload, TotalChunks: 1, Size: int64(len(text))}
	if err := handshakeAny(conn, dst, session, EncodeJSON(meta)); err != nil {
		return err
	}
	logf("msg: accepted, sending %d bytes", len(text))
	return sendBuffer(conn, dst, session, []byte(text), sum[:], cfg, logf)
}

func handshakeFile(conn net.PacketConn, dst net.Addr, session uint32, meta ConnectMeta) error {
	return handshakeAny(conn, dst, session, EncodeJSON(meta))
}

func handshakeAny(conn net.PacketConn, dst net.Addr, session uint32, payload []byte) error {
	// seq 0xFFFFFFFE marks CONNECT packets so a receiver that sees CONNECT
	// retransmits can distinguish a new session from a repeat.
	pkt := &Packet{Type: TypeConnect, Session: session, Seq: connectSeq, Payload: payload}
	raw := pkt.Encode()
	deadline := time.Now().Add(45 * time.Second)
	lastProgress := time.Now()
	for {
		if _, err := conn.WriteTo(raw, dst); err != nil {
			return fmt.Errorf("btp: connect: %w", err)
		}
		p, err := recvSession(conn, session, 3*time.Second)
		if err != nil {
			if time.Now().After(deadline) {
				return ErrNoAnswer
			}
			// TRD §3.5: abort if neither PENDING nor decision for 15s.
			if time.Since(lastProgress) > 15*time.Second {
				return ErrNoAnswer
			}
			continue
		}
		lastProgress = time.Now()
		switch p.Type {
		case TypePending:
			continue // receiver still asking the user
		case TypeAccept:
			return nil
		case TypeReject:
			r := ConnectReply{}
			_ = jsonUnmarshal(p.Payload, &r)
			if r.Reason != "" {
				return fmt.Errorf("%w: %s", ErrRejected, r.Reason)
			}
			return ErrRejected
		case TypeError:
			return fmt.Errorf("btp: receiver error: %s", string(p.Payload))
		default:
			continue // not for us (e.g. discovery traffic on shared port)
		}
	}
}

// sendData streams the file with a sliding window, selective-repeat
// retransmission, fast retransmit on duplicate ACKs, adaptive RTO and AIMD
// congestion window, then FIN/FIN_ACK for SHA-256 verification.
func sendData(conn net.PacketConn, dst net.Addr, session uint32, f *os.File, size int64, sha []byte, total int64, cfg SenderConfig, logf func(string, ...any)) error {
	window := cfg.Window
	if window < 2 {
		window = 2
	}
	if cfg.MTU <= 0 {
		cfg.MTU = MaxPayload
	}
	rto := NewRTOEstimator()
	stats := SenderStats{Total: size}
	start := time.Now()

	var mu sync.Mutex // guards window, stats, inflight, base, sendPos, dupAcks

	buf := make([]byte, cfg.MTU)
	chunkAt := func(seq uint32) ([]byte, error) {
		n, err := f.ReadAt(buf, int64(seq)*int64(cfg.MTU))
		if err != nil && err != io.EOF {
			return nil, err
		}
		out := make([]byte, n)
		copy(out, buf[:n])
		return out, nil
	}

	inflight := make(map[uint32]*pending)
	var sendPos uint32 // next chunk index to put in flight
	base := uint32(0)  // lowest unacked chunk
	dupAcks := 0

	acks := make(chan *Packet, 256)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		rbuf := make([]byte, MaxPacketSize)
		for {
			n, addr, err := conn.ReadFrom(rbuf)
			if err != nil {
				return
			}
			if addr.String() != dst.String() {
				continue // not our peer
			}
			p, err := Decode(rbuf[:n])
			if err != nil || p.Session != session {
				continue // corrupt or stale
			}
			switch p.Type {
			case TypeAck, TypeFinAck, TypeError:
				select {
				case acks <- p:
				case <-readerDone:
					return
				}
			}
		}
	}()

	// control loop: RTO retransmits, FIN retransmits, stats emission.
	stopCtl := make(chan struct{})
	defer close(stopCtl)
	fatal := make(chan error, 1)
	go func() {
		finSentAt := time.Time{}
		finTries := 0
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopCtl:
				return
			case <-ticker.C:
			}
			mu.Lock()
			now := time.Now()
			for _, q := range inflight {
				if now.Sub(q.sentAt) > rto.RTO() {
					logf("rtx: timeout seq=%d tries=%d rto=%v", q.seq, q.tries+1, rto.RTO())
					raw := (&Packet{Type: TypeData, Session: session, Seq: q.seq, Payload: q.chunk}).Encode()
					_, _ = conn.WriteTo(raw, dst)
					q.sentAt = now
					q.tries++
					q.timedOut = true
					stats.TimeoutRtx++
					rto.TimedOut()
					window /= 2 // AIMD multiplicative decrease
					if window < 2 {
						window = 2
					}
					if q.tries >= cfg.RetryLimit {
						mu.Unlock()
						select {
						case fatal <- fmt.Errorf("btp: peer stopped responding (chunk %d)", q.seq):
						case <-stopCtl:
						}
						return
					}
				}
			}
			if !finSentAt.IsZero() && time.Since(finSentAt) > rto.RTO() {
				if finTries >= cfg.RetryLimit {
					mu.Unlock()
					select {
					case fatal <- ErrNoAnswer:
					case <-stopCtl:
					}
					return
				}
				logf("fin: retransmit (try %d)", finTries+1)
				fin := (&Packet{Type: TypeFin, Session: session, Seq: uint32(total), Payload: append([]byte(nil), sha...)}).Encode()
				_, _ = conn.WriteTo(fin, dst)
				finSentAt = time.Now()
				finTries++
			}
			if cfg.StatsHook != nil {
				s := stats
				s.Window = window
				s.InFlight = len(inflight)
				s.RTO = rto.RTO()
				s.SRTT = rto.SRTT()
				cfg.StatsHook(s)
			}
			mu.Unlock()
		}
	}()

	finPhase := false
	for {
		// fatal error from control loop?
		select {
		case err := <-fatal:
			return err
		default:
		}

		// enter FIN phase once every chunk is acked
		if !finPhase && (total == 0 || (int64(base) >= total && len(inflight) == 0)) {
			finPhase = true
			mu.Lock()
			fin := (&Packet{Type: TypeFin, Session: session, Seq: uint32(total), Payload: append([]byte(nil), sha...)}).Encode()
			_, _ = conn.WriteTo(fin, dst)
			logf("fin: all %d chunks acked, sent FIN", total)
			mu.Unlock()
		}

		// refill window (not in FIN phase)
		if !finPhase {
			mu.Lock()
			for int(len(inflight)) < window && int64(sendPos) < total {
				chunk, err := chunkAt(sendPos)
				if err != nil {
					mu.Unlock()
					return fmt.Errorf("btp: read chunk %d: %w", sendPos, err)
				}
				pkt := &Packet{Type: TypeData, Session: session, Seq: sendPos, Payload: chunk}
				if _, err := conn.WriteTo(pkt.Encode(), dst); err != nil {
					mu.Unlock()
					return fmt.Errorf("btp: send data: %w", err)
				}
				inflight[sendPos] = &pending{seq: sendPos, chunk: chunk, sentAt: time.Now()}
				sendPos++
			}
			mu.Unlock()
		}

		var p *Packet
		select {
		case p = <-acks:
		case <-time.After(50 * time.Millisecond):
			continue
		case err := <-fatal:
			return err
		}

		mu.Lock()
		switch p.Type {
		case TypeError:
			mu.Unlock()
			return fmt.Errorf("btp: receiver aborted: %s", string(p.Payload))

		case TypeAck:
			a, err := DecodeAck(p.Payload)
			if err != nil {
				mu.Unlock()
				continue
			}
			if a.Cum > base {
				// cumulative progress
				for s := base; s < a.Cum; s++ {
					if q, ok := inflight[s]; ok && !q.timedOut && q.tries == 0 {
						rto.Update(time.Since(q.sentAt))
					}
					delete(inflight, s)
				}
				base = a.Cum
				dupAcks = 0
				window++ // AIMD additive increase
				if window > 1024 {
					window = 1024
				}
				if cfg.Progress != nil {
					sent := min64(int64(base)*int64(cfg.MTU), size)
					bps := float64(sent) / elapsed(start)
					cfg.Progress(sent, size, bps)
				}
			} else if !finPhase {
				dupAcks++ // gap info: selective below decides what to resend
			}

			// selective-repeat: ack or fast-retransmit everything in flight
			fastRtx := 0
			for seq, q := range inflight {
				if seq < a.Cum {
					delete(inflight, seq)
					continue
				}
				if a.Has(seq) {
					if !q.timedOut && q.tries == 0 {
						rto.Update(time.Since(q.sentAt))
					}
					delete(inflight, seq)
					continue
				}
				// not acked: retransmit on duplicate ACK (fast retransmit)
				if dupAcks >= 2 {
					raw := (&Packet{Type: TypeData, Session: session, Seq: seq, Payload: q.chunk}).Encode()
					_, _ = conn.WriteTo(raw, dst)
					q.sentAt = time.Now()
					q.tries++
					q.timedOut = true
					fastRtx++
				}
			}
			if fastRtx > 0 {
				stats.FastRtx += fastRtx
				dupAcks = 0
				logf("rtx: fast %d packet(s)", fastRtx)
			}

		case TypeFinAck:
			ok2, reason := decodeFinAck(p.Payload)
			stats.Done = true
			if cfg.StatsHook != nil {
				s := stats
				s.Window = window
				s.InFlight = len(inflight)
				s.RTO = rto.RTO()
				s.SRTT = rto.SRTT()
				cfg.StatsHook(s)
			}
			mu.Unlock()
			if !ok2 {
				return fmt.Errorf("btp: SHA-256 mismatch reported by receiver: %s", reason)
			}
			logf("fin: sha256 verified ok (%d fast rtx, %d timeout rtx, %v)", stats.FastRtx, stats.TimeoutRtx, time.Since(start).Round(time.Millisecond))
			return nil
		}
		mu.Unlock()
	}
}

func decodeFinAck(b []byte) (bool, string) {
	if len(b) == 0 {
		return false, "empty fin_ack"
	}
	// TRD 3.4: 0=verified 1=mismatch 2=write error
	if b[0] == 0 {
		return true, ""
	}
	if len(b) > 1 {
		return false, string(b[1:])
	}
	if b[0] == 1 {
		return false, "sha256 mismatch"
	}
	return false, "receiver write error"
}

// sendBuffer streams an in-memory buffer (messages, bench) with the same
// sliding-window engine as files.
func sendBuffer(conn net.PacketConn, dst net.Addr, session uint32, data []byte, sha []byte, cfg SenderConfig, logf func(string, ...any)) error {
	if cfg.MTU <= 0 {
		cfg.MTU = MaxPayload
	}
	total := int64((len(data) + cfg.MTU - 1) / cfg.MTU)
	if len(data) == 0 {
		total = 0
	}
	tmp, err := os.CreateTemp("", "beam-msg-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	tmp.Close()
	f, err := os.Open(name)
	if err != nil {
		os.Remove(name)
		return err
	}
	defer func() { f.Close(); os.Remove(name) }()
	return sendData(conn, dst, session, f, int64(len(data)), sha, total, cfg, logf)
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func elapsed(start time.Time) float64 {
	d := time.Since(start)
	if d <= 0 {
		d = time.Millisecond
	}
	return d.Seconds()
}
