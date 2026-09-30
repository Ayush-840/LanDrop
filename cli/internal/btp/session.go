package btp

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"os"
)

// sendReject sends REJECT JSON{reason}.
func sendReject(conn net.PacketConn, to net.Addr, session uint32, reason string) {
	p := &Packet{Type: TypeReject, Session: session, Payload: EncodeJSON(ConnectReply{Reason: reason})}
	_, _ = conn.WriteTo(p.Encode(), to)
}

func sendError(conn net.PacketConn, to net.Addr, session uint32, code, msg string) {
	p := &Packet{Type: TypeError, Session: session, Payload: EncodeJSON(ErrorPayload{Code: code, Message: msg})}
	_, _ = conn.WriteTo(p.Encode(), to)
}

func sendFinAck(conn net.PacketConn, to net.Addr, session uint32, status byte) {
	_, _ = conn.WriteTo((&Packet{Type: TypeFinAck, Session: session, Payload: []byte{status}}).Encode(), to)
}

// parseFinHash accepts TRD 32-byte raw SHA-256 or legacy hex string.
func parseFinHash(b []byte) []byte {
	if len(b) == 32 {
		return b
	}
	s := string(bytes.TrimSpace(b))
	if len(s) == 64 {
		if raw, err := hex.DecodeString(s); err == nil {
			return raw
		}
	}
	// last resort: hash the ASCII itself? No — return as-is for comparison fail.
	if len(b) > 32 {
		return b[:32]
	}
	return b
}

func hashFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return nil, err
	}
	return h.Sum(nil), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// diskOK reports whether dir has at least need bytes free (best effort).
func diskOK(dir string, need int64) bool {
	// Portable best-effort: try to stat; if unknown, allow.
	if need <= 0 {
		return true
	}
	// Attempt a cheap writability probe via temp file creation is too heavy;
	// rely on OS error at write time. Keep hook for future syscall Statfs.
	_ = dir
	return true
}

// connectSeq is the reserved seq value on CONNECT packets.
const connectSeq uint32 = 0xFFFFFFFE
