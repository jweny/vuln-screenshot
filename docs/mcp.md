# MCP integration

Build the project and start the local stdio server:

```bash
npm ci
npm run build
node /absolute/path/to/vuln-screenshot/dist/cli.js mcp
```

Example MCP host configuration:

```json
{
  "mcpServers": {
    "vuln-screenshot": {
      "command": "node",
      "args": [
        "/absolute/path/to/vuln-screenshot/dist/cli.js",
        "mcp"
      ],
      "env": {
        "VULN_SCREENSHOT_OUTPUT_DIR": "/absolute/path/to/evidence"
      }
    }
  }
}
```

The server communicates over standard input and output. Diagnostic messages use standard error.

## `capture_http_evidence`

Provide `target` and exactly one request representation:

- `raw_request`: UTF-8 text containing a complete HTTP/1.1 request.
- `raw_request_base64`: base64-encoded bytes for binary-safe input.

Optional fields:

- `timeout_ms`: integer from 1 to 300000; default 30000.
- `tls_verify`: boolean; default `true`.

The request must include a CRLF-terminated header section. `target` selects only the network destination and does not rewrite the request target or `Host` header.

## `capture_command_evidence`

Required field:

- `command`: non-empty command string executed through `$SHELL -lc`.

Optional fields:

- `cwd`: working directory; defaults to the server process directory.
- `timeout_ms`: integer from 1 to 300000; default 60000.

The command runs on the host with the current user's permissions. See the [threat model](threat-model.md) before exposing this tool to an agent.

## Result

Both tools return structured capture metadata and include the first PNG inline when rendering succeeds. Paths to every screenshot and raw artifact are included in the result.
