import { chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
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
    if (error?.code !== "ENOENT") throw error;
  }
}
