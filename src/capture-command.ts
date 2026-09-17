import { stat } from "node:fs/promises";
import path from "node:path";

import {
  createEvidenceBundle,
  describeFile,
  writeArtifact,
  writeManifest,
} from "./artifacts.js";
import { capturePtyCommand } from "./command/pty-capture.js";
import { buildTerminalState } from "./command/terminal-state.js";
import { renderTerminalScreenshots } from "./render/terminal.js";
import {
  COMMAND_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type CaptureResult,
  type CommandCaptureInput,
  type EvidenceFile,
  type EvidenceManifest,
} from "./types.js";

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? COMMAND_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return timeout;
}

export async function captureCommandEvidence(
  input: CommandCaptureInput,
): Promise<CaptureResult> {
  if (!input.command.trim()) throw new Error("command must not be empty");
  const started = new Date();
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const cwdStat = await stat(cwd);
  if (!cwdStat.isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);

  const bundle = await createEvidenceBundle("command", input.outputRoot);
  const commandPath = path.join(bundle.directory, "command.txt");
  const rawPath = path.join(bundle.directory, "terminal.raw");
  const textPath = path.join(bundle.directory, "terminal.txt");
  await writeArtifact(commandPath, `${input.command}\n`);

  const capture = await capturePtyCommand({ command: input.command, cwd, timeoutMs });
  await writeArtifact(rawPath, capture.raw);
  const terminalState = await buildTerminalState(capture.raw);
  await writeArtifact(textPath, `${terminalState.plainText}\n`);

  const warnings: string[] = [];
  if (capture.truncated) warnings.push("Terminal output reached the 10 MiB capture limit");
  let screenshotPaths: string[] = [];
  let screenshotsTruncated = false;
  let renderError: string | undefined;
  try {
    const rendered = await renderTerminalScreenshots({
      command: input.command,
      cwd,
      shell: capture.shell,
      serializedAnsi: terminalState.serializedAnsi,
      exitCode: capture.exitCode,
      signal: capture.signal,
      timedOut: capture.timedOut,
      error: capture.error,
      screenshotsDirectory: bundle.screenshotsDirectory,
    });
    screenshotPaths = rendered.paths;
    screenshotsTruncated = rendered.truncated;
  } catch (error) {
    renderError = error instanceof Error ? error.message : String(error);
    warnings.push(`Screenshot rendering failed: ${renderError}`);
  }

  const files: EvidenceFile[] = [
    await describeFile("command", commandPath),
    await describeFile("terminal_raw", rawPath),
    await describeFile("terminal_text", textPath),
  ];
  for (const screenshotPath of screenshotPaths) {
    files.push(await describeFile("screenshot", screenshotPath));
  }

  const finished = new Date();
  const complete = !capture.timedOut && !capture.truncated && !capture.error;
  const success = complete && !renderError;
  const manifest: EvidenceManifest = {
    schema_version: 1,
    evidence_id: bundle.id,
    kind: "command",
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    success,
    complete,
    capture_truncated: capture.truncated,
    screenshots_truncated: screenshotsTruncated,
    input: {
      command: input.command,
      cwd,
      timeout_ms: timeoutMs,
    },
    result: {
      shell: capture.shell,
      terminal: "xterm-256color",
      columns: 120,
      rows: 40,
      output_bytes: capture.raw.length,
      exit_code: capture.exitCode,
      signal: capture.signal,
      timed_out: capture.timedOut,
      error: capture.error,
      render_error: renderError,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    warnings,
    files,
  };
  await writeManifest(bundle, manifest);

  return {
    evidence_id: bundle.id,
    kind: "command",
    success,
    complete,
    capture_truncated: capture.truncated,
    screenshots_truncated: screenshotsTruncated,
    manifest_path: bundle.manifestPath,
    screenshot_paths: screenshotPaths,
    artifact_paths: {
      command: commandPath,
      terminal_raw: rawPath,
      terminal_text: textPath,
    },
    summary: {
      exit_code: capture.exitCode,
      signal: capture.signal,
      timed_out: capture.timedOut,
      output_bytes: capture.raw.length,
      error: capture.error ?? renderError,
    },
    warnings,
  };
}
