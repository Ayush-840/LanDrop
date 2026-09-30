package btp

import (
	"crypto/rand"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func loopback(t *testing.T, size int, lossy bool) {
	t.Helper()
	dir := t.TempDir()
	src := filepath.Join(dir, "src.bin")
	data := make([]byte, size)
	rand.Read(data)
	os.WriteFile(src, data, 0644)

	rc, _ := net.ListenPacket("udp", "127.0.0.1:0")
	sc, _ := net.ListenPacket("udp", "127.0.0.1:0")
	defer rc.Close()
	defer sc.Close()

	done := make(chan *ReceiverStats, 1)
	go func() {
		st, err := ListenOnce(rc, ReceiverConfig{Dir: filepath.Join(dir, "out"), AutoAccept: true})
		if err != nil {
			t.Errorf("recv: %v", err)
			return
		}
		done <- st
	}()
	os.MkdirAll(filepath.Join(dir, "out"), 0755)
	time.Sleep(50 * time.Millisecond)
	cfg := DefaultSenderConfig()
	if err := SendFile(sc, rc.LocalAddr(), 0x1234, src, cfg); err != nil {
		t.Fatalf("send: %v", err)
	}
	select {
	case st := <-done:
		if st.Size != int64(size) {
			t.Fatalf("size %d want %d", st.Size, size)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("timeout")
	}
}

func TestLoopbackEmpty(t *testing.T) { loopback(t, 0, false) }
func TestLoopbackSmall(t *testing.T) { loopback(t, 100, false) }
func TestLoopbackMultiChunk(t *testing.T) { loopback(t, 5000, false) }
func TestCodecRoundTrip(t *testing.T) {
	p := &Packet{Type: TypeData, Session: 7, Seq: 3, Payload: []byte("hi")}
	q, err := Decode(p.Encode())
	if err != nil || string(q.Payload) != "hi" {
		t.Fatal("roundtrip fail")
	}
	if _, err := Decode([]byte{1, 2}); err == nil {
		t.Fatal("want err short")
	}
}
func TestSanitize(t *testing.T) {
	if SanitizeFilename("../../etc/passwd") != "passwd" {
		t.Fatal("sanitize")
	}
	if SanitizeFilename("CON") == "CON" {
		t.Fatal("reserved")
	}
}
