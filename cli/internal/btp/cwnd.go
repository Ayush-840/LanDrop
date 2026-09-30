package btp

// Congestion implements TRD §3.6 AIMD: cwnd starts at 4 packets, +1 per RTT
// (slow-start below ssthresh=32 doubles effectively via per-ACK growth),
// halved on loss, capped at 64.
type Congestion struct {
	Cwnd     int
	Ssthresh int
	Acked    int
}

func NewCongestion() *Congestion { return &Congestion{Cwnd: 4, Ssthresh: 32} }

func (c *Congestion) OnAck() {
	if c.Cwnd < c.Ssthresh {
		c.Cwnd += 1 // slow-start-ish: +1 per ACK below threshold grows fast
		if c.Cwnd > c.Ssthresh {
			c.Cwnd = c.Ssthresh
		}
	} else {
		// congestion avoidance: +1 per window ≈ +1/cwnd per ACK
		// approximated with counter-free +1 per RTT by caller; here +1 per ACK
		// would be too fast, so grow slowly.
		c.Acked++
		if c.Acked >= c.Cwnd {
			c.Acked = 0
			c.Cwnd++
		}
	}
	if c.Cwnd > 64 {
		c.Cwnd = 64
	}
	if c.Cwnd < 2 {
		c.Cwnd = 2
	}
}

func (c *Congestion) OnLoss() {
	c.Ssthresh = c.Cwnd / 2
	if c.Ssthresh < 2 {
		c.Ssthresh = 2
	}
	c.Cwnd /= 2
	if c.Cwnd < 2 {
		c.Cwnd = 2
	}
	c.Acked = 0
}

// ResetAcked clears avoidance counter.
func (c *Congestion) ResetAcked() { c.Acked = 0 }
