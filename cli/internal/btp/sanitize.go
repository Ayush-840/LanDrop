package btp

import (
	"path/filepath"
	"runtime"
	"strings"
)

// SanitizeFilename implements TRD §3.11: filepath.Base, strip control
// characters and path separators, block reserved Windows names, cap length.
// Never returns empty.
func SanitizeFilename(name string) string {
	base := filepath.Base(name)
	base = strings.ReplaceAll(base, "/", "_")
	base = strings.ReplaceAll(base, "\\", "_")
	var b strings.Builder
	for _, r := range base {
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	base = strings.TrimSpace(b.String())
	if base == "" || base == "." || base == ".." {
		base = "beam-file"
	}
	lower := strings.ToLower(base)
	dot := strings.Index(lower, ".")
	stem := lower
	if dot >= 0 {
		stem = lower[:dot]
	}
	reserved := map[string]bool{
		"con": true, "prn": true, "aux": true, "nul": true,
		"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
		"com6": true, "com7": true, "com8": true, "com9": true,
		"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
		"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
	}
	if reserved[stem] {
		base = "_" + base
	}
	if len(base) > 255 {
		base = base[:255]
	}
	if runtime.GOOS == "windows" {
		base = strings.TrimRight(base, " .")
		if base == "" {
			base = "beam-file"
		}
	}
	return base
}

// UniquePath returns path if free, else path with " (n)" suffix before ext.
func UniquePath(dir, name string, exists func(string) bool) string {
	candidate := filepath.Join(dir, name)
	if !exists(candidate) {
		return candidate
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		c := filepath.Join(dir, stem+" ("+itoa(i)+")"+ext)
		if !exists(c) {
			return c
		}
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
