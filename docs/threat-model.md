# Threat model

`vuln-screenshot` is a local evidence-capture tool, not a sandbox. Its security boundary is the operating-system account that starts it.

## Trusted components

- The user who starts the CLI or MCP server.
- The local Node.js runtime, `node-pty`, Playwright, and selected Chromium binary.
- The output directory and its underlying filesystem.

## Sensitive capabilities

### Command capture

The command tool executes `$SHELL -lc <command>` with the current user's full permissions. An MCP client that can call this tool can therefore read, modify, or delete anything available to that user and can access the network.

Run the MCP server only for clients you trust. For stronger isolation, start it inside a disposable container or virtual machine with a dedicated low-privilege account and a narrowly mounted output directory.

### HTTP capture

The HTTP tool opens outbound TCP or TLS connections selected by the caller. It can reach services available from the host, including loopback and private networks. It does not enforce an allowlist.

### Stored evidence

Raw traffic and PTY output are intentionally not redacted. They may include passwords, cookies, tokens, proprietary source code, local paths, and personal data. POSIX permissions reduce accidental access but do not protect against the same user, privileged processes, backups, or deliberate sharing.

## Out of scope guarantees

- Sandboxing or command authorization.
- Secret detection or automatic redaction.
- Malware scanning.
- Evidence signing, trusted timestamps, or chain-of-custody guarantees.
- Protection from a compromised host, runtime, browser, or dependency.

## Safe operation checklist

1. Use only systems you own or are explicitly authorized to test.
2. Review the exact command and raw request before capture.
3. Keep `--insecure` disabled unless the target is intentionally using an untrusted certificate.
4. Store output outside shared or synchronized folders when it contains secrets.
5. Review screenshots and raw files before attaching them to an issue or report.
6. Delete temporary evidence according to your organization's retention policy.
