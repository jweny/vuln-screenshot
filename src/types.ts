export const CAPTURE_LIMIT_BYTES = 10 * 1024 * 1024;
export const SCREENSHOT_PAGE_LIMIT = 100;
export const HTTP_TIMEOUT_MS = 30_000;
export const COMMAND_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;

export type EvidenceKind = "http" | "command";

export interface EvidenceBundle {
  id: string;
  kind: EvidenceKind;
  directory: string;
  screenshotsDirectory: string;
  manifestPath: string;
}

export interface EvidenceFile {
  role: string;
  path: string;
  bytes: number;
}

export interface EvidenceManifest {
  schema_version: 1;
  evidence_id: string;
  kind: EvidenceKind;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  success: boolean;
  complete: boolean;
  capture_truncated: boolean;
  screenshots_truncated: boolean;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  environment: Record<string, unknown>;
  warnings: string[];
  files: EvidenceFile[];
}

export interface CaptureResult {
  evidence_id: string;
  kind: EvidenceKind;
  success: boolean;
  complete: boolean;
  capture_truncated: boolean;
  screenshots_truncated: boolean;
  manifest_path: string;
  screenshot_paths: string[];
  artifact_paths: Record<string, string>;
  summary: Record<string, unknown>;
  warnings: string[];
}

export interface HttpCaptureInput {
  target: string;
  rawRequest: Buffer;
  timeoutMs?: number;
  tlsVerify?: boolean;
  outputRoot?: string;
}

export interface CommandCaptureInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  outputRoot?: string;
}
