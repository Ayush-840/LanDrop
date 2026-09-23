# DESIGN — Beam Terminal UX & Interaction Design

Companion to `PRD.md` and `TRD.md`. For a CLI, "design" means command structure, output layout, colour, feedback and error tone.

---

## 1. Design Principles

1. **Zero config, sensible defaults.** The shortest command should just work.
2. **Always show state.** Never leave the user staring at a blank cursor.
3. **Safe by default.** Nothing lands on disk without consent.
4. **Calm, plain language.** Errors say what happened and what to do next.
5. **Scriptable.** Human output on TTY; clean JSON and exit codes for pipes.

## 2. Command Grammar

```
beam <command> [arguments] [flags]
```

| Command | Purpose | Example |
|---------|---------|---------|
| `receive` | Wait for incoming files | `beam receive` |
| `send` | Send files/folders | `beam send notes.pdf photo.jpg` |
| `peers` | List receivers on the LAN | `beam peers` |
| `history` | Show past transfers | `beam history --last 10` |
| `config` | View/set configuration | `beam config set download_dir ~/Beam` |
| `version` / `help` | Meta | `beam help send` |

### Flags

| Flag | Applies to | Meaning |
|------|-----------|---------|
| `--to <name\|ip[:port]>` | send | Skip discovery |
| `--pin <code>` | send | Provide PIN non-interactively |
| `--dir <path>` | receive | Download directory |
| `--auto-accept` | receive | Accept without prompt (PIN still required) |
| `--port <n>` | both | TCP port |
| `--limit <rate>` | send | e.g. `5MB/s` |
| `--json` | all | Machine-readable output |
| `--no-color` | all | Plain output (also honours `NO_COLOR`) |
| `-q / -v` | all | Quiet / verbose |

## 3. Visual Language

### Colour palette (ANSI 16-colour, works everywhere)

| Meaning | Colour | Symbol |
|---------|--------|--------|
| Success | Green | `✔` |
| Error | Red | `✖` |
| Warning | Yellow | `!` |
| Info / peer names | Cyan | `•` |
| Secondary text | Dim grey | |
| Emphasis (PIN, filenames) | Bold | |

Fallbacks: if the terminal is not a TTY or `NO_COLOR` is set, use `[ok]`, `[err]`, `[!]` and no colour. Detect Windows legacy consoles and use ASCII bars.

### Progress bar

```
movie.mkv  ████████████████░░░░░░░░  67%  942 MB / 1.4 GB  38.2 MB/s  ETA 00:13
```

- Bar width adapts to terminal width (min 20 cols; below that show text only).
- Single line redrawn with `\r`; refresh ≤ 10 Hz.
- Multi-file: overall line plus current file line.

## 4. Screen Mockups

### 4.1 Receiver — waiting

```
$ beam receive

  Beam 1.0  ·  laptop-b  ·  192.168.1.22
  Saving to  ~/Downloads/Beam

  Pairing PIN   4 8 2 9 1 3

  Waiting for senders…   (Ctrl+C to stop)
```

### 4.2 Sender — discovery and selection

```
$ beam send movie.mkv

  Hashing movie.mkv…  ✔  ab12c9…f03e

  Nearby devices
    1)  laptop-b     192.168.1.22   linux
    2)  hostel-pc    192.168.1.41   windows

  Send to [1-2]: 1
  Enter PIN for laptop-b: ••••••
```

### 4.3 Receiver — incoming request

```
  ┌ Incoming transfer ─────────────────────────┐
  │ From   laptop-a (192.168.1.18)             │
  │ File   movie.mkv                           │
  │ Size   1.4 GB      Free space  84 GB       │
  └────────────────────────────────────────────┘
  Accept? [y/N]  y
```

### 4.4 Transfer and completion

```
  movie.mkv  ████████████████████████  100%  1.4 GB  41.0 MB/s  00:36
  ✔ Verified SHA-256 ab12c9…f03e
  ✔ Saved to ~/Downloads/Beam/movie.mkv
```

### 4.5 Resume

```
  ! Found partial download of movie.mkv (612 MB already received)
  ↻ Resuming from 612 MB…
```

### 4.6 Peers table

```
$ beam peers
  NAME        ADDRESS         OS       LAST SEEN
  laptop-b    192.168.1.22    linux    1s ago
  hostel-pc   192.168.1.41    windows  3s ago
```

### 4.7 History

```
$ beam history --last 3
  TIME              DIR   PEER        FILE         SIZE     STATUS
  2026-10-01 18:22  send  laptop-b    movie.mkv    1.4 GB   ✔ ok
  2026-10-01 17:05  recv  laptop-a    thesis.pdf   4.2 MB   ✔ ok
  2026-09-30 21:40  send  hostel-pc   data.zip     820 MB   ✖ interrupted (resumable)
```

## 5. Interaction Rules

- **Prompts** default to the safe answer (`[y/N]`). Enter with no input = No.
- **PIN entry** is masked; 3 attempts then exit.
- **Ctrl+C** during transfer: stop cleanly, keep partial file, print "Interrupted. Run the same command to resume."
- **Discovery timeout**: after 3 s with no results, print troubleshooting help rather than hanging.
- **Single result**: if only one receiver is found, ask "Send to laptop-b? [Y/n]" instead of a menu.
- **Non-interactive mode** (`--to` + `--pin` + `--json`): no prompts, only JSON events on stdout.

## 6. Message Copy (Tone Guide)

Format: **what happened → why (if known) → what to do.**

| Situation | Message |
|-----------|---------|
| No peers | `✖ No receivers found in 3s.` `Is 'beam receive' running on the other device? Some Wi-Fi networks block discovery, try: beam send FILE --to <ip>` |
| Wrong PIN | `✖ Wrong PIN. 2 attempts left.` |
| Rejected | `✖ laptop-b declined the transfer.` |
| Disk full | `✖ Not enough space on laptop-b (needs 1.4 GB, has 600 MB).` |
| Hash mismatch | `✖ File corrupted in transit (checksum mismatch). Partial file removed. Please retry.` |
| Connection lost | `! Connection lost at 67%. Re-run the same command to resume.` |
| File exists | `• movie.mkv already exists, saving as movie (1).mkv` |

## 7. JSON Output Schema (`--json`)

One JSON object per line (NDJSON):

```json
{"event":"peer_found","name":"laptop-b","addr":"192.168.1.22:47778"}
{"event":"progress","file":"movie.mkv","bytes":942000000,"total":1503238553,"bps":40100000}
{"event":"done","file":"movie.mkv","sha256":"ab12c9…","status":"ok","secs":37}
{"event":"error","code":3,"message":"wrong pin"}
```

## 8. Accessibility & Compatibility

- Never rely on colour alone; every status has a symbol or word.
- Works at 80×24; layouts degrade gracefully when narrower.
- ASCII fallback for terminals without Unicode.
- Tested on: Windows Terminal, PowerShell, cmd.exe, GNOME Terminal, macOS Terminal.

## 9. Help Text Sample

```
$ beam help send
Send files or folders to another device on your network.

Usage:
  beam send <path>... [flags]

Flags:
      --to string      device name or IP to send to (skips discovery)
      --pin string     pairing PIN shown on the receiver
      --limit string   max speed, e.g. 5MB/s
      --json           machine-readable output
  -h, --help           help for send

Examples:
  beam send report.pdf
  beam send ./photos --to laptop-b --pin 482913
```

## 10. Demo Script (3 minutes, for viva)

1. **Setup (20s):** two terminals/laptops; show `beam --help`.
2. **Discovery (30s):** `beam receive` on B, `beam peers` on A shows B appears automatically.
3. **Send + accept (40s):** send a large file, show PIN, accept prompt, live progress.
4. **Integrity (20s):** show matching SHA-256 on both sides (`sha256sum`).
5. **Resume (40s):** start a transfer, Ctrl+C at ~50%, re-run, show "Resuming from…".
6. **Security (20s):** enter wrong PIN, show rejection; decline a transfer.
7. **Wrap-up (10s):** `beam history`, mention tests and cross-platform builds.
