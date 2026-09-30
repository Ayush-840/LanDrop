package btp

import (
	"sync"
	"time"
)

// RTOEstimator tracks smoothed RTT and variance RFC 6298-style and derives
// the retransmission timeout: RTO = SRTT + 4*RTTVAR, clamped to 50ms–2s
// (LAN-tuned per TRD §3.6); Karn's rule (no RTT samples from retransmitted
// packets); exponential back-off on repeated timeouts.
type RTOEstimator struct {
	mu      sync.Mutex
	srtt    time.Duration
	rttvar  time.Duration
	rto     time.Duration
	backoff int
	started bool
}

// MinRTO / MaxRTO bound the estimator on a LAN link (TRD §3.6).
const (
	MinRTO = 50 * time.Millisecond
	MaxRTO = 2 * time.Second
	// MaxBackoff caps exponential back-off at 4 doublings (16x).
	MaxBackoff = 4
)

// NewRTOEstimator returns an estimator with a conservative initial RTO.
func NewRTOEstimator() *RTOEstimator {
	return &RTOEstimator{rto: 500 * time.Millisecond}
}

// RTO returns the current retransmission timeout (already backed off if the
// same segment timed out repeatedly).
func (e *RTOEstimator) RTO() time.Duration {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.rto * (1 << uint(e.backoff))
}

// SRTT returns the current smoothed RTT estimate (0 before first sample).
func (e *RTOEstimator) SRTT() time.Duration {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.srtt
}

// Update records one RTT sample (Karn's algorithm: caller must not feed
// retransmitted segments).
func (e *RTOEstimator) Update(rtt time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.started {
		e.started = true
		e.srtt = rtt
		e.rttvar = rtt / 2
	} else {
		e.rttvar = 3*e.rttvar/4 + abs(rtt-e.srtt)/4
		e.srtt = 7*e.srtt/8 + rtt/8
	}
	e.backoff = 0
	e.recalc()
}

// TimedOut records that a segment timed out: RTO doubles (capped).
func (e *RTOEstimator) TimedOut() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.backoff < MaxBackoff {
		e.backoff++
	}
}

func (e *RTOEstimator) recalc() {
	r := e.srtt + 4*e.rttvar
	if r < MinRTO {
		r = MinRTO
	}
	if r > MaxRTO {
		r = MaxRTO
	}
	// Strip the back-off applied on top before storing the base value.
	e.rto = r
}

func abs(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}
