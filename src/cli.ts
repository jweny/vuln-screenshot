#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { captureCommandEvidence } from "./capture-command.js";
import { captureHttpEvidence } from "./capture-http.js";
import { startMcpServer } from "./mcp.js";

const HELP = `vuln-screenshot

Usage:
  vuln-screenshot mcp
  vuln-screenshot http --target ORIGIN --request FILE [--timeout MS] [--insecure]
  vuln-screenshot command [--cwd DIR] [--timeout MS] -- 'COMMAND'

Environment:
  VULN_SCREENSHOT_OUTPUT_DIR  Evidence output root (default: ./artifacts)
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function numberOption(args: string[], name: string): number | undefined {
  const value = option(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const [, , subcommand, ...args] = process.argv;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (subcommand === "mcp") {
    startMcpServer();
    return;
  }
  if (subcommand === "http") {
    const target = option(args, "--target");
    const requestFile = option(args, "--request");
    if (!target || !requestFile) {
      throw new Error("http requires --target and --request");
    }
    const rawRequest = requestFile === "-" ? await readStdin() : await readFile(requestFile);
    const result = await captureHttpEvidence({
      target,
      rawRequest,
      timeoutMs: numberOption(args, "--timeout"),
      tlsVerify: !args.includes("--insecure"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.success ? 0 : 1;
    return;
  }
  if (subcommand === "command") {
    const separator = args.indexOf("--");
    if (separator < 0 || separator === args.length - 1) {
      throw new Error("command requires -- followed by a quoted command string");
    }
    const command = args.slice(separator + 1).join(" ");
    const flags = args.slice(0, separator);
    const result = await captureCommandEvidence({
      command,
      cwd: option(flags, "--cwd"),
      timeoutMs: numberOption(flags, "--timeout"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.success ? 0 : 1;
    return;
  }
  throw new Error(`Unknown subcommand: ${subcommand}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
