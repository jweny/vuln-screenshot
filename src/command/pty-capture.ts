import { chmod } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import * as pty from "node-pty";

import { CAPTURE_LIMIT_BYTES } from "../types.js";

export interface PtyCapture {
  raw: Buffer;
  shell: string;
  cwd: string;
  exitCode?: number;
  signal?: number;
  timedOut: boolean;
  truncated: boolean;
  error?: string;
}

async function ensurePtyHelperExecutable(): Promise<void> {
  if (process.platform === "win32") return;
  const nodePtyEntry = fileURLToPath(import.meta.resolve("node-pty"));
  const helper = path.resolve(
    path.dirname(nodePtyEntry),
    "..",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  try {
    await chmod(helper, 0o755);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function terminateProcessTree(child: pty.IPty): void {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }
}

function forceKillProcessTree(child: pty.IPty): void {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }
}

export async function capturePtyCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
}): Promise<PtyCapture> {
  const shell = process.env.SHELL || "/bin/sh";
  const cwd = path.resolve(options.cwd);
  let child: pty.IPty;
  try {
    await ensurePtyHelperExecutable();
    child = pty.spawn(shell, ["-lc", options.command], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
      encoding: "utf8",
    });
  } catch (error) {
    return {
      raw: Buffer.alloc(0),
      shell,
      cwd,
      timedOut: false,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return await new Promise<PtyCapture>((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let timedOut = false;
    let truncated = false;
    let terminationFallback: NodeJS.Timeout | undefined;

    const finish = (fields: {
      exitCode?: number;
      signal?: number;
      error?: string;
    }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationFallback) clearTimeout(terminationFallback);
      resolve({
        raw: Buffer.concat(chunks, bytes),
        shell,
        cwd,
        exitCode: fields.exitCode,
        signal: fields.signal,
        timedOut,
        truncated,
        error: fields.error,
      });
    };

    const stop = (): void => {
      terminateProcessTree(child);
      terminationFallback = setTimeout(() => {
        forceKillProcessTree(child);
        finish({ error: "Command did not exit after termination" });
      }, 2_000);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);

    child.onData((data) => {
      const encoded = Buffer.from(data, "utf8");
      const remaining = CAPTURE_LIMIT_BYTES - bytes;
      if (encoded.length > remaining) {
        if (remaining > 0) chunks.push(encoded.subarray(0, remaining));
        bytes += Math.max(remaining, 0);
        truncated = true;
        stop();
        return;
      }
      chunks.push(encoded);
      bytes += encoded.length;
    });
    child.onExit(({ exitCode, signal }) => finish({ exitCode, signal }));
  });
}
