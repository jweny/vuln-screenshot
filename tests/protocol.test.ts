import assert from "node:assert/strict";
import { test } from "node:test";

import {
  inspectRawResponse,
  parseRawRequest,
} from "../src/http/protocol.js";

test("parseRawRequest preserves duplicate headers and body boundary", () => {
  const raw = Buffer.from(
    "POST /submit HTTP/1.1\r\nHost: example.test\r\nX-Test: one\r\nX-Test: two\r\nContent-Length: 4\r\n\r\ndata",
    "latin1",
  );
  const parsed = parseRawRequest(raw);
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.requestTarget, "/submit");
  assert.deepEqual(
    parsed.headers.filter((header) => header.name === "X-Test"),
    [
      { name: "X-Test", value: "one" },
      { name: "X-Test", value: "two" },
    ],
  );
  assert.equal(raw.subarray(parsed.headerEnd).toString(), "data");
});

test("parseRawRequest rejects non-HTTP/1.1 input", () => {
  assert.throws(
    () => parseRawRequest(Buffer.from("GET / HTTP/2\r\nHost: example.test\r\n\r\n")),
    /Only HTTP\/1\.1/,
  );
});

test("inspectRawResponse completes Content-Length without waiting for close", () => {
  const raw = Buffer.from(
    "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nX-Test: yes\r\n\r\nhello",
  );
  const parsed = inspectRawResponse(raw, "GET");
  assert.equal(parsed?.complete, true);
  assert.equal(parsed?.statusCode, 200);
  assert.equal(parsed?.body?.toString(), "hello");
  assert.equal(parsed?.messageEnd, raw.length);
});

test("inspectRawResponse decodes chunked body and trailers", () => {
  const raw = Buffer.from(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\nX-Trailer: yes\r\n\r\n",
  );
  const parsed = inspectRawResponse(raw, "GET");
  assert.equal(parsed?.complete, true);
  assert.equal(parsed?.body?.toString(), "hello world");
  assert.equal(parsed?.messageEnd, raw.length);
});

test("inspectRawResponse treats unframed body as close-delimited", () => {
  const raw = Buffer.from("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nhello");
  assert.equal(inspectRawResponse(raw, "GET")?.complete, false);
  const ended = inspectRawResponse(raw, "GET", true);
  assert.equal(ended?.complete, true);
  assert.equal(ended?.body?.toString(), "hello");
});
