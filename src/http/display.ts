import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

import iconv from "iconv-lite";

import type { ParsedRawResponse, RawHeader } from "./protocol.js";

function headerValue(headers: RawHeader[], name: string): string | undefined {
  const expected = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === expected)?.value;
}

function decodeContent(body: Buffer, encoding: string | undefined): Buffer {
  if (!encoding || encoding.toLowerCase() === "identity") return body;
  const normalized = encoding.toLowerCase().trim();
  if (normalized === "gzip" || normalized === "x-gzip") return gunzipSync(body);
  if (normalized === "br") return brotliDecompressSync(body);
  if (normalized === "deflate") return inflateSync(body);
  throw new Error(`Unsupported Content-Encoding: ${encoding}`);
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let controls = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controls += 1;
  }
  return controls / sample.length > 0.05;
}

function hexPreview(buffer: Buffer): string {
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  const lines: string[] = [];
  for (let offset = 0; offset < sample.length; offset += 16) {
    const row = sample.subarray(offset, offset + 16);
    const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(47);
    const ascii = Array.from(row, (byte) =>
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".",
    ).join("");
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  if (sample.length < buffer.length) lines.push(`… ${buffer.length - sample.length} more bytes`);
  return lines.join("\n");
}

function charsetFromContentType(contentType: string | undefined): string {
  const match = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType ?? "");
  return match?.[1] ?? "utf-8";
}

function prettyText(text: string, contentType: string | undefined): string {
  if (/\bjson\b/i.test(contentType ?? "")) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  if (/\b(?:html|xml)\b/i.test(contentType ?? "")) {
    const voidTags = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);
    const tokens = text.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) ?? [text];
    const lines: string[] = [];
    let indent = 0;
    for (const token of tokens) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const closing = /^<\//.test(trimmed);
      if (closing) indent = Math.max(0, indent - 1);
      lines.push(`${"  ".repeat(indent)}${trimmed}`);
      const opening = /^<([A-Za-z][\w:-]*)\b/.exec(trimmed);
      if (
        opening &&
        !closing &&
        !trimmed.endsWith("/>") &&
        !voidTags.has(opening[1].toLowerCase())
      ) {
        indent += 1;
      }
    }
    return lines.join("\n");
  }
  return text;
}

export function rawBufferToDisplay(buffer: Buffer): string {
  if (buffer.length === 0) return "(empty)";
  return buffer.toString("utf8");
}

export function responseToDisplay(
  raw: Buffer,
  parsed: ParsedRawResponse | undefined,
): { text: string; warning?: string } {
  if (!parsed) return { text: raw.length ? raw.toString("latin1") : "(no response bytes)" };
  const head = raw.subarray(parsed.headerStart, parsed.headerEnd).toString("latin1").trimEnd();
  if (!parsed.body) return { text: `${head}\n\n(partial response body)` };
  try {
    const decoded = decodeContent(
      parsed.body,
      headerValue(parsed.headers, "content-encoding"),
    );
    if (looksBinary(decoded)) {
      return {
        text: `${head}\n\n[binary body: ${decoded.length} bytes]\n${hexPreview(decoded)}`,
      };
    }
    const contentType = headerValue(parsed.headers, "content-type");
    const charset = charsetFromContentType(contentType);
    const bodyText = iconv.decode(decoded, iconv.encodingExists(charset) ? charset : "utf-8");
    return { text: `${head}\n\n${prettyText(bodyText, contentType)}` };
  } catch (error) {
    return {
      text: `${head}\n\n[body decode failed: ${parsed.body.length} raw bytes]\n${hexPreview(parsed.body)}`,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}
