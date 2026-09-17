# Evidence format

Each capture is stored in `artifacts/<UTC timestamp>-<UUID>/`. The root can be changed with `VULN_SCREENSHOT_OUTPUT_DIR` or the library input.

## HTTP bundle

| File | Purpose |
| --- | --- |
| `request.raw` | Exact request bytes supplied by the caller |
| `response.raw` | Bytes received from the TCP or TLS connection |
| `screenshots/NNN.png` | Paginated 1440×900 request/response views |
| `manifest.json` | Capture metadata, status, limits, warnings, and file list |

## Command bundle

| File | Purpose |
| --- | --- |
| `command.txt` | Command requested by the caller |
| `terminal.raw` | PTY stream, including ANSI control sequences |
| `terminal.txt` | Plain-text terminal state used for review and search |
| `screenshots/NNN.png` | Paginated 1440×900 command/response views |
| `manifest.json` | Capture metadata, status, limits, warnings, and file list |

## Manifest schema version 1

| Field | Meaning |
| --- | --- |
| `schema_version` | Manifest contract version; currently `1` |
| `evidence_id` | Timestamp and UUID used as the bundle directory name |
| `kind` | `http` or `command` |
| `started_at`, `finished_at` | UTC ISO-8601 timestamps |
| `duration_ms` | Total capture and render duration |
| `success` | Capture completed and screenshots rendered |
| `complete` | Raw capture ended without timeout, truncation, or capture error |
| `capture_truncated` | Raw response or PTY output reached the 10 MiB limit |
| `screenshots_truncated` | More than 100 screenshot pages were required |
| `input` | Operation inputs and effective options |
| `result` | Protocol, process, transport, and render outcome |
| `environment` | Node.js, platform, and architecture metadata |
| `warnings` | Non-fatal framing, decoding, truncation, or rendering notes |
| `files` | Artifact roles, paths, and byte sizes |

`success` and a command's `exit_code` intentionally have different meanings. A command returning exit code `7` can still be captured successfully.

## Integrity boundary

Version 1 manifests list file sizes but do not contain hashes, signatures, or trusted timestamps. They support review and reproducibility but must not be described as tamper-proof evidence.
