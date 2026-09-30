// Package faultnet provides a lossy UDP wrapper that can drop, duplicate,
// corrupt and delay packets by percentage — the built-in fault injector used
// by `--loss`, `--reorder` and `--corrupt` flags to prove BTP works on bad
// links without external tools like tc/netem.
package faultnet

import (
	"math/rand"
	"net"
	"sync"
	"time"
)

// Conn wraps a PacketConn and injects faults on inbound datagrams.
type Conn struct {
	net.PacketConn

	mu         sync.Mutex
	rng        *rand.Rand
	pending    []delayed
	LossPct    int // drop this % of datagrams
	DupPct     int // duplicate this % of datagrams
	CorruptPct int // flip one bit in this % of datagrams
	ReorderPct int // delay this % of datagrams 1-8 ms so later ones overtake

	Dropped   uint64
	Corrupted uint64
	Delayed   uint64
	Dups      uint64
}

type delayed struct {
	data []byte
	addr net.Addr
	due  time.Time
}

// New wraps pc. A non-zero seed makes fault injection deterministic, which
// keeps tests reproducible.
func New(pc net.PacketConn, seed int64) *Conn {
	var src rand.Source
	if seed == 0 {
		src = rand.NewSource(time.Now().UnixNano())
	} else {
		src = rand.NewSource(seed)
	}
	return &Conn{PacketConn: pc, rng: rand.New(src)}
}

func (f *Conn) pct(n int) bool { return n > 0 && f.rng.Intn(100) < n }

// ReadFrom applies inbound fault injection before returning a datagram.
func (f *Conn) ReadFrom(p []byte) (int, net.Addr, error) {
	for {
		// Deliver any due delayed datagram first.
		f.mu.Lock()
		if i := f.findDue(time.Now()); i >= 0 {
			d := f.pending[i]
			f.pending = append(f.pending[:i], f.pending[i+1:]...)
			f.mu.Unlock()
			n := copy(p, d.data)
			return n, d.addr, nil
		}
		f.mu.Unlock()

		n, addr, err := f.PacketConn.ReadFrom(p)
		if err != nil {
			return n, addr, err
		}

		f.mu.Lock()
		if f.pct(f.LossPct) {
			f.Dropped++
			f.mu.Unlock()
			continue // datagram "never arrives": read the next one
		}
		if n > 0 && f.pct(f.CorruptPct) {
			p[f.rng.Intn(n)] ^= 1 << uint(f.rng.Intn(8))
			f.Corrupted++
		}
		if f.pct(f.ReorderPct) {
			f.Delayed++
			f.scheduleLocked(append([]byte(nil), p[:n]...), addr, time.Duration(1+f.rng.Intn(8))*time.Millisecond)
			f.mu.Unlock()
			continue // the original is held back; keep reading
		}
		if f.pct(f.DupPct) {
			f.Dups++
			f.scheduleLocked(append([]byte(nil), p[:n]...), addr, time.Millisecond)
		}
		f.mu.Unlock()
		return n, addr, nil
	}
}

func (f *Conn) findDue(now time.Time) int {
	for i, d := range f.pending {
		if !d.due.After(now) {
			return i
		}
	}
	return -1
}

func (f *Conn) scheduleLocked(data []byte, addr net.Addr, d time.Duration) {
	f.pending = append(f.pending, delayed{data: data, addr: addr, due: time.Now().Add(d)})
}

// Close also cancels any pending delayed datagrams.
func (f *Conn) Close() error {
	f.mu.Lock()
	f.pending = nil
	f.mu.Unlock()
	return f.PacketConn.Close()
}
