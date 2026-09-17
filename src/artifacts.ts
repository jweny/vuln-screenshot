import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EvidenceBundle,
  EvidenceFile,
  EvidenceKind,
  EvidenceManifest,
} from "./types.js";

function timestampForPath(date: Date): string {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "");
}

export async function createEvidenceBundle(
  kind: EvidenceKind,
  outputRoot?: string,
): Promise<EvidenceBundle> {
  const root = path.resolve(
    outputRoot ?? process.env.VULN_SCREENSHOT_OUTPUT_DIR ?? "artifacts",
  );
  const id = `${timestampForPath(new Date())}-${randomUUID()}`;
  const directory = path.join(root, id);
  const screenshotsDirectory = path.join(directory, "screenshots");
  await mkdir(screenshotsDirectory, { recursive: true, mode: 0o700 });
  await chmodBestEffort(directory, 0o700);
  await chmodBestEffort(screenshotsDirectory, 0o700);
  return {
    id,
    kind,
    directory,
    screenshotsDirectory,
    manifestPath: path.join(directory, "manifest.json"),
  };
}

async function chmodBestEffort(filePath: string, mode: number): Promise<void> {
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(filePath, mode);
  } catch {
    // Windows and unusual filesystems may not support POSIX modes.
  }
}

export async function writeArtifact(
  filePath: string,
  data: string | Buffer,
): Promise<void> {
  await writeFile(filePath, data, { mode: 0o600 });
  await chmodBestEffort(filePath, 0o600);
}

export async function describeFile(
  role: string,
  filePath: string,
): Promise<EvidenceFile> {
  const info = await stat(filePath);
  return { role, path: filePath, bytes: info.size };
}

export async function writeManifest(
  bundle: EvidenceBundle,
  manifest: EvidenceManifest,
): Promise<void> {
  await writeArtifact(bundle.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
