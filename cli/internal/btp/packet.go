// Package btp implements BTP v1, the Beam Transfer Protocol: a reliable
// transport built from scratch on raw UDP datagrams, with sequence numbers,
// selective acknowledgements, adaptive retransmission timers, a sliding
// window, a receiver reorder buffer, per-packet CRC-32 and whole-file
// SHA-256 verification.
//
// Wire spec is TRD §3 (BTP v1).
package btp

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
)

// Wire constants for BTP v1 (TRD §3.2–3.3).
const (
	Magic          uint16 = 0xBE7A
	Version               = 1
	HeaderSize            = 16
	CRCSize               = 4
	MaxPayload            = 1200 // fits one Ethernet MTU, avoids IP fragmentation
	MaxPacketSize         = HeaderSize + MaxPayload + CRCSize
	DefaultPort           = 47777
	AckBitmapSize         = 8 // TRD §3.4: 64-bit SACK bitmap for cum+1..cum+64
	AckPayloadSize        = 4 + AckBitmapSize + 2
)

// Packet types (TRD §3.4).
const (
	TypeDiscover byte = 0x01 // "Who is on the network?"
	TypeAnnounce byte = 0x02 // "I'm here" JSON{name,os,device_uid,version}
	TypeConnect  byte = 0x03 // transfer request with metadata
	TypePending  byte = 0x04 // receiver still deciding (every 2s)
	TypeAccept   byte = 0x05 // receiver agrees JSON{recv_window}
	TypeReject   byte = 0x06 // receiver declines JSON{reason}
	TypeData     byte = 0x07 // file chunk (seq = chunk index)
	TypeAck      byte = 0x08 // cum_ack(4) + sack_bitmap(8) + recv_window(2)
	TypeFin      byte = 0x09 // all data sent; 32-byte raw SHA-256
	TypeFinAck   byte = 0x0A // status(1): 0=verified 1=mismatch 2=write error
	TypeError    byte = 0x0B // abort with JSON{code,message}
)

// Packet is one BTP datagram.
//
//	0        2     3     4            8            12       14       16
//	+--------+-----+-----+------------+------------+--------+--------+
//	| magic  | ver | type| session_id |    seq     | length | flags  |
//	+--------+-----+-----+------------+------------+--------+--------+
//	|                    payload (0 - 1200 bytes)                    |
//	+----------------------------------------------------------------+
//	|               CRC-32 (IEEE) of header + payload   4B           |
//	+----------------------------------------------------------------+
type Packet struct {
	Ver     byte
	Type    byte
	Session uint32
	Seq     uint32
	Flags   uint16
	Payload []byte
}

// Encode serialises the packet with trailing CRC-32 (IEEE) over header+payload.
func (p *Packet) Encode() []byte {
	buf := make([]byte, HeaderSize+len(p.Payload)+CRCSize)
	binary.BigEndian.PutUint16(buf[0:2], Magic)
	buf[2] = Version
	buf[3] = p.Type
	binary.BigEndian.PutUint32(buf[4:8], p.Session)
	binary.BigEndian.PutUint32(buf[8:12], p.Seq)
	binary.BigEndian.PutUint16(buf[12:14], uint16(len(p.Payload)))
	binary.BigEndian.PutUint16(buf[14:16], p.Flags)
	copy(buf[HeaderSize:], p.Payload)
	sum := crc32.ChecksumIEEE(buf[:HeaderSize+len(p.Payload)])
	binary.BigEndian.PutUint32(buf[HeaderSize+len(p.Payload):], sum)
	return buf
}

// Decode parses a datagram, verifying magic, version and CRC-32. Corrupt
// packets are reported as errors so callers drop them (treated as loss).
// It never panics on malformed input (fuzz-tested).
func Decode(data []byte) (*Packet, error) {
	if len(data) < HeaderSize+CRCSize {
		return nil, errors.New("btp: packet too short")
	}
	if binary.BigEndian.Uint16(data[0:2]) != Magic {
		return nil, errors.New("btp: bad magic")
	}
	if data[2] != Version {
		return nil, fmt.Errorf("btp: bad version %d", data[2])
	}
	length := int(binary.BigEndian.Uint16(data[12:14]))
	if length < 0 || length > MaxPayload {
		return nil, fmt.Errorf("btp: bad length %d", length)
	}
	if len(data) != HeaderSize+length+CRCSize {
		return nil, fmt.Errorf("btp: size mismatch: got %d want %d", len(data), HeaderSize+length+CRCSize)
	}
	want := binary.BigEndian.Uint32(data[len(data)-CRCSize:])
	got := crc32.ChecksumIEEE(data[:len(data)-CRCSize])
	if want != got {
		return nil, fmt.Errorf("btp: crc mismatch (want %08x got %08x)", want, got)
	}
	payload := make([]byte, length)
	copy(payload, data[HeaderSize:HeaderSize+length])
	return &Packet{
		Ver:     data[2],
		Type:    data[3],
		Session: binary.BigEndian.Uint32(data[4:8]),
		Seq:     binary.BigEndian.Uint32(data[8:12]),
		Flags:   binary.BigEndian.Uint16(data[14:16]),
		Payload: payload,
	}, nil
}

// Ack is the ACK payload (TRD §3.4): cumulative point + 64-bit selective
// bitmap + receiver window. Bit i means "chunk Cum+i received"; the byte at
// Cum itself is implied once Cum advances past it.
type Ack struct {
	Cum  uint32 // all chunks < Cum are received
	Bits [AckBitmapSize]byte
	Win  uint16 // receiver window advertisement (packets)
}

// Encode returns the 14-byte ACK payload.
func (a *Ack) Encode() []byte {
	out := make([]byte, AckPayloadSize)
	binary.BigEndian.PutUint32(out[0:4], a.Cum)
	copy(out[4:12], a.Bits[:])
	binary.BigEndian.PutUint16(out[12:14], a.Win)
	return out
}

// DecodeAck parses an ACK payload (accepts legacy variable-length too).
func DecodeAck(b []byte) (*Ack, error) {
	if len(b) < 6 {
		return nil, fmt.Errorf("btp: ack payload too short: %d", len(b))
	}
	a := &Ack{
		Cum: binary.BigEndian.Uint32(b[0:4]),
	}
	if len(b) == AckPayloadSize {
		copy(a.Bits[:], b[4:12])
		a.Win = binary.BigEndian.Uint16(b[12:14])
		return a, nil
	}
	// legacy variable form: cum(4) win(2) bits(N)
	a.Win = binary.BigEndian.Uint16(b[4:6])
	copy(a.Bits[:], b[6:])
	return a, nil
}

// Has reports whether chunk idx is acknowledged.
func (a *Ack) Has(idx uint32) bool {
	if idx < a.Cum {
		return true
	}
	off := idx - a.Cum
	if off >= 64 {
		return false
	}
	return a.Bits[off/8]&(1<<(off%8)) != 0
}

// Set marks chunk idx as received.
func (a *Ack) Set(idx uint32) {
	if idx < a.Cum {
		return
	}
	off := idx - a.Cum
	if off >= 64 {
		return
	}
	a.Bits[off/8] |= 1 << (off % 8)
}

// Advance moves Cum past contiguous receipt starting at Cum.
func (a *Ack) Advance() {
	for {
		if a.Bits[0]&1 != 1 {
			return
		}
		a.Cum++
		var carry byte
		for i := AckBitmapSize - 1; i >= 0; i-- {
			c := a.Bits[i] & 1
			a.Bits[i] >>= 1
			a.Bits[i] |= carry << 7
			carry = c
		}
	}
}
