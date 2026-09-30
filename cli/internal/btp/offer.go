package btp

import (
	"encoding/json"
	"fmt"
)

// ConnectMeta is the CONNECT payload (TRD §3.4).
// kind is "file" or "message". For multi-file sends FileIndex/FileCount
// are set; v1 sends each file as its own session back-to-back.
type ConnectMeta struct {
	Kind        string `json:"kind"`
	Name        string `json:"name,omitempty"`
	Size        int64  `json:"size,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	ChunkSize   int    `json:"chunk_size,omitempty"`
	TotalChunks int64  `json:"total_chunks,omitempty"`
	SenderName  string `json:"sender_name,omitempty"`
	Text        string `json:"text,omitempty"`
	FileIndex   int    `json:"file_index,omitempty"`
	FileCount   int    `json:"file_count,omitempty"`
}

// FileMeta is the legacy CONNECT payload for a file transfer request.
type FileMeta struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	Sender string `json:"sender"`
}

// MsgMeta is the legacy CONNECT payload for a text message.
type MsgMeta struct {
	Text   string `json:"text"`
	Sender string `json:"sender"`
}

// AcceptReply is the ACCEPT payload (TRD §3.4).
type AcceptReply struct {
	RecvWindow uint16 `json:"recv_window"`
}

// ConnectReply is the REJECT payload.
type ConnectReply struct {
	OK       bool   `json:"ok"`
	Reason   string `json:"reason,omitempty"`
	ResumeAt int64  `json:"resume_at"`
}

// ErrorPayload is the ERROR packet payload.
type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// EncodeJSON helper.
func EncodeJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// DecodeFileMeta parses a CONNECT payload for a file.
func DecodeFileMeta(b []byte) (*FileMeta, error) {
	var m FileMeta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("btp: decode connect: %w", err)
	}
	if m.Name == "" || m.Size < 0 {
		return nil, fmt.Errorf("btp: bad connect metadata (name=%q size=%d)", m.Name, m.Size)
	}
	return &m, nil
}

// DecodeMsgMeta parses a CONNECT payload for a message.
func DecodeMsgMeta(b []byte) (*MsgMeta, error) {
	var m MsgMeta
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}
