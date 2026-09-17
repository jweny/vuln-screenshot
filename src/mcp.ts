import { readFile } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import { captureCommandEvidence } from "./capture-command.js";
import { captureHttpEvidence } from "./capture-http.js";
import type { CaptureResult } from "./types.js";

const timeoutSchema = z.number().int().min(1).max(300_000).optional();
const httpInputSchema = z.union([
  z.object({
    target: z
      .string()
      .describe("Connection origin, for example https://example.com:8443"),
    raw_request: z.string().describe("Raw HTTP/1.1 request as UTF-8 text"),
    raw_request_base64: z.never().optional(),
    timeout_ms: timeoutSchema,
    tls_verify: z.boolean().optional().default(true),
  }),
  z.object({
    target: z
      .string()
      .describe("Connection origin, for example https://example.com:8443"),
    raw_request: z.never().optional(),
    raw_request_base64: z
      .string()
      .describe("Base64-encoded raw request bytes for binary-safe input"),
    timeout_ms: timeoutSchema,
    tls_verify: z.boolean().optional().default(true),
  }),
]);

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodeBase64(value: string): Buffer {
  const compact = value.replaceAll(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error("raw_request_base64 is not valid base64");
  }
  return Buffer.from(compact, "base64");
}

async function toolResponse(result: CaptureResult) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: JSON.stringify(result, null, 2) }];
  const firstScreenshot = result.screenshot_paths[0];
  if (firstScreenshot) {
    content.push({
      type: "image",
      data: (await readFile(firstScreenshot)).toString("base64"),
      mimeType: "image/png",
    });
  }
  return {
    content,
    structuredContent: jsonSafe(result) as unknown as Record<string, unknown>,
    isError: !result.success,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "vuln-screenshot", version: "0.0.1" });

  server.registerTool(
    "capture_http_evidence",
    {
      title: "Capture HTTP evidence",
      description:
        "Send one raw HTTP/1.1 request over TCP or TLS, preserve the received bytes, and render paginated request/response evidence screenshots.",
      inputSchema: httpInputSchema,
    },
    async (input) => {
      const rawRequest = "raw_request_base64" in input && input.raw_request_base64
        ? decodeBase64(input.raw_request_base64)
        : Buffer.from("raw_request" in input ? (input.raw_request ?? "") : "", "utf8");
      return toolResponse(
        await captureHttpEvidence({
          target: input.target,
          rawRequest,
          timeoutMs: input.timeout_ms,
          tlsVerify: input.tls_verify,
        }),
      );
    },
  );

  server.registerTool(
    "capture_command_evidence",
    {
      title: "Capture terminal command evidence",
      description:
        "Execute a non-interactive command in a host PTY. This has the current user's full host permissions. Captures merged terminal output and paginated screenshots.",
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z.string().optional(),
        timeout_ms: timeoutSchema,
      }),
    },
    async (input) =>
      toolResponse(
        await captureCommandEvidence({
          command: input.command,
          cwd: input.cwd,
          timeoutMs: input.timeout_ms,
        }),
      ),
  );

  return server;
}

export function startMcpServer(): void {
  serveStdio(() => createMcpServer(), {
    onerror: (error) => console.error(error),
  });
  console.error("vuln-screenshot MCP server running on stdio");
}
