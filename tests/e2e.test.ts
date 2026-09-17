import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";

import { captureCommandEvidence } from "../src/capture-command.js";
import { captureHttpEvidence } from "../src/capture-http.js";
import { renderHttpScreenshots } from "../src/render/http.js";

function assertPngDimensions(buffer: Buffer, width: number, height: number): void {
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buffer.readUInt32BE(16), width);
  assert.equal(buffer.readUInt32BE(20), height);
}

test("command evidence creates manifest, raw text, and 1440x900 PNG", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vuln-screenshot-command-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const result = await captureCommandEvidence({
    command: "printf '\\033[32mevidence-ok\\033[0m\\n'",
    cwd: process.cwd(),
    timeoutMs: 2_000,
    outputRoot,
  });
  assert.equal(result.success, true);
  assert.equal(result.screenshot_paths.length, 1);
  assert.match(await readFile(result.artifact_paths.terminal_text, "utf8"), /evidence-ok/);
  const manifest = JSON.parse(await readFile(result.manifest_path, "utf8"));
  assert.equal(manifest.kind, "command");
  assert.equal(manifest.result.exit_code, 0);
  assertPngDimensions(await readFile(result.screenshot_paths[0]), 1440, 900);
  if (process.platform !== "win32") {
    assert.equal((await stat(result.screenshot_paths[0])).mode & 0o777, 0o600);
  }
});

test("non-zero command exit remains a successful evidence capture", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vuln-screenshot-nonzero-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const result = await captureCommandEvidence({
    command: "printf 'proof-before-exit\\n'; exit 7",
    cwd: process.cwd(),
    timeoutMs: 2_000,
    outputRoot,
  });
  assert.equal(result.success, true);
  assert.equal(result.complete, true);
  assert.equal(result.summary.exit_code, 7);
  const manifest = JSON.parse(await readFile(result.manifest_path, "utf8"));
  assert.equal(manifest.success, true);
  assert.equal(manifest.result.exit_code, 7);
});

test("HTTP evidence captures a live response and renders it", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vuln-screenshot-http-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      const body = JSON.stringify({ proof: "真实响应" });
      socket.write(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
    });
  });
  context.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = Buffer.from("GET /proof HTTP/1.1\r\nHost: local.test\r\n\r\n");

  const result = await captureHttpEvidence({
    target: `http://127.0.0.1:${address.port}`,
    rawRequest: request,
    timeoutMs: 2_000,
    outputRoot,
  });
  assert.equal(result.success, true);
  assert.equal(result.summary.status_code, 200);
  assert.deepEqual(await readFile(result.artifact_paths.request_raw), request);
  assert.match(
    (await readFile(result.artifact_paths.response_raw)).toString("utf8"),
    /真实响应/,
  );
  assertPngDimensions(await readFile(result.screenshot_paths[0]), 1440, 900);
});

test("a single long HTTP line is continued across screenshot pages", async (context) => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "vuln-screenshot-long-line-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const screenshotsDirectory = path.join(outputRoot, "screenshots");
  await mkdir(screenshotsDirectory);
  const rendered = await renderHttpScreenshots({
    requestText: `GET / HTTP/1.1\r\nHost: local.test\r\nX-Long: ${"a".repeat(4_000)}\r\n\r\n`,
    responseText: "HTTP/1.1 204 No Content\r\n\r\n",
    target: "http://local.test",
    status: 204,
    complete: true,
    screenshotsDirectory,
  });
  assert.ok(rendered.paths.length >= 2);
  for (const screenshot of rendered.paths) {
    assertPngDimensions(await readFile(screenshot), 1440, 900);
  }
});
