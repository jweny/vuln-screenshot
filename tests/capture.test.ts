import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { test } from "node:test";

import { capturePtyCommand } from "../src/command/pty-capture.js";
import { buildTerminalState } from "../src/command/terminal-state.js";
import { captureRawHttp } from "../src/http/raw-capture.js";

test("captureRawHttp sends exact request bytes", async (context) => {
  const expected = Buffer.from(
    "POST /evidence HTTP/1.1\r\nHost: exact.test\r\nX-Duplicate: a\r\nX-Duplicate: b\r\nContent-Length: 4\r\n\r\ndata",
  );
  let received = Buffer.alloc(0);
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.length >= expected.length) {
        socket.write(
          "HTTP/1.1 201 Created\r\nContent-Type: text/plain\r\nContent-Length: 7\r\n\r\ncreated",
        );
      }
    });
  });
  context.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const result = await captureRawHttp({
    target: `http://127.0.0.1:${address.port}`,
    rawRequest: expected,
    timeoutMs: 2_000,
    tlsVerify: true,
  });
  assert.deepEqual(received, expected);
  assert.equal(result.complete, true);
  assert.equal(result.parsedResponse?.statusCode, 201);
  assert.equal(result.parsedResponse?.body?.toString(), "created");
});

test("PTY capture retains ANSI output and non-zero exit", async () => {
  const capture = await capturePtyCommand({
    command: "printf '\\033[31mred\\033[0m\\n'; exit 7",
    cwd: process.cwd(),
    timeoutMs: 2_000,
  });
  assert.equal(capture.exitCode, 7);
  assert.equal(capture.timedOut, false);
  assert.match(capture.raw.toString(), /\u001b\[31mred\u001b\[0m/);
  const state = await buildTerminalState(capture.raw);
  assert.match(state.plainText, /red/);
  assert.doesNotMatch(state.serializedAnsi, /\u001b\[\d+[BD]/);
});

test("PTY timeout is recorded", async () => {
  const capture = await capturePtyCommand({
    command: "sleep 5",
    cwd: process.cwd(),
    timeoutMs: 100,
  });
  assert.equal(capture.timedOut, true);
});
