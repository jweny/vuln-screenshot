export interface RawHeader {
  name: string;
  value: string;
}

export interface ParsedRawRequest {
  method: string;
  requestTarget: string;
  version: "HTTP/1.1";
  headers: RawHeader[];
  headerEnd: number;
}

export interface ParsedRawResponse {
  version: string;
  statusCode: number;
  statusMessage: string;
  headers: RawHeader[];
  headerStart: number;
  headerEnd: number;
  bodyStart: number;
  messageEnd?: number;
  body?: Buffer;
  complete: boolean;
  closeDelimited: boolean;
  framingError?: string;
}

function indexOfCrlf(buffer: Buffer, from = 0): number {
  return buffer.indexOf("\r\n", from, "latin1");
}

function indexOfHeaderEnd(buffer: Buffer, from = 0): number {
  return buffer.indexOf("\r\n\r\n", from, "latin1");
}

function parseHeaderLines(headerText: string): RawHeader[] {
  if (!headerText) return [];
  return headerText.split("\r\n").map((line) => {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      throw new Error(`Malformed header line: ${line}`);
    }
    return {
      name: line.slice(0, colon),
      value: line.slice(colon + 1).trim(),
    };
  });
}

function hasBareLf(buffer: Buffer): boolean {
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0a && (index === 0 || buffer[index - 1] !== 0x0d)) {
      return true;
    }
  }
  return false;
}

export function parseRawRequest(buffer: Buffer): ParsedRawRequest {
  const headerEnd = indexOfHeaderEnd(buffer);
  if (headerEnd < 0) {
    throw new Error("Raw request must contain a CRLF CRLF header terminator");
  }
  const headerBytes = buffer.subarray(0, headerEnd + 4);
  if (hasBareLf(headerBytes)) {
    throw new Error("Raw request headers must use CRLF line endings");
  }
  const firstLineEnd = indexOfCrlf(buffer);
  if (firstLineEnd < 0 || firstLineEnd > headerEnd) {
    throw new Error("Raw request is missing a valid request line");
  }
  const requestLine = buffer.subarray(0, firstLineEnd).toString("latin1");
  const match = /^([^\s]+) ([^\s]+) (HTTP\/\d(?:\.\d)?)$/.exec(requestLine);
  if (!match) {
    throw new Error(`Malformed HTTP request line: ${requestLine}`);
  }
  if (match[3] !== "HTTP/1.1") {
    throw new Error(`Only HTTP/1.1 is supported, received ${match[3]}`);
  }
  const headerText = buffer
    .subarray(firstLineEnd + 2, headerEnd)
    .toString("latin1");
  return {
    method: match[1],
    requestTarget: match[2],
    version: "HTTP/1.1",
    headers: parseHeaderLines(headerText),
    headerEnd: headerEnd + 4,
  };
}

function headerValues(headers: RawHeader[], name: string): string[] {
  const expected = name.toLowerCase();
  return headers
    .filter((header) => header.name.toLowerCase() === expected)
    .map((header) => header.value);
}

interface ChunkedResult {
  complete: boolean;
  end?: number;
  body?: Buffer;
  error?: string;
}

function parseChunkedBody(buffer: Buffer, bodyStart: number): ChunkedResult {
  let cursor = bodyStart;
  const chunks: Buffer[] = [];
  while (cursor < buffer.length) {
    const sizeLineEnd = indexOfCrlf(buffer, cursor);
    if (sizeLineEnd < 0) return { complete: false };
    const sizeText = buffer
      .subarray(cursor, sizeLineEnd)
      .toString("latin1")
      .split(";", 1)[0]
      .trim();
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) {
      return { complete: false, error: `Invalid chunk size: ${sizeText}` };
    }
    const size = Number.parseInt(sizeText, 16);
    cursor = sizeLineEnd + 2;
    if (size === 0) {
      if (buffer.length < cursor + 2) return { complete: false };
      if (buffer[cursor] === 0x0d && buffer[cursor + 1] === 0x0a) {
        return {
          complete: true,
          end: cursor + 2,
          body: Buffer.concat(chunks),
        };
      }
      const trailerEnd = indexOfHeaderEnd(buffer, cursor);
      if (trailerEnd < 0) return { complete: false };
      return {
        complete: true,
        end: trailerEnd + 4,
        body: Buffer.concat(chunks),
      };
    }
    if (!Number.isSafeInteger(size)) {
      return { complete: false, error: "Chunk size exceeds safe integer range" };
    }
    if (buffer.length < cursor + size + 2) return { complete: false };
    if (buffer[cursor + size] !== 0x0d || buffer[cursor + size + 1] !== 0x0a) {
      return { complete: false, error: "Chunk data is not followed by CRLF" };
    }
    chunks.push(buffer.subarray(cursor, cursor + size));
    cursor += size + 2;
  }
  return { complete: false };
}

function parseResponseHead(
  buffer: Buffer,
  start: number,
): Omit<ParsedRawResponse, "complete" | "closeDelimited"> | undefined {
  const headerEndIndex = indexOfHeaderEnd(buffer, start);
  if (headerEndIndex < 0) return undefined;
  const statusLineEnd = indexOfCrlf(buffer, start);
  if (statusLineEnd < 0 || statusLineEnd > headerEndIndex) return undefined;
  const statusLine = buffer.subarray(start, statusLineEnd).toString("latin1");
  const match = /^(HTTP\/\d\.\d) (\d{3})(?: (.*))?$/.exec(statusLine);
  if (!match) {
    return {
      version: "unknown",
      statusCode: 0,
      statusMessage: "",
      headers: [],
      headerStart: start,
      headerEnd: headerEndIndex + 4,
      bodyStart: headerEndIndex + 4,
      framingError: `Malformed HTTP status line: ${statusLine}`,
    };
  }
  let headers: RawHeader[] = [];
  let framingError: string | undefined;
  try {
    headers = parseHeaderLines(
      buffer.subarray(statusLineEnd + 2, headerEndIndex).toString("latin1"),
    );
  } catch (error) {
    framingError = error instanceof Error ? error.message : String(error);
  }
  return {
    version: match[1],
    statusCode: Number(match[2]),
    statusMessage: match[3] ?? "",
    headers,
    headerStart: start,
    headerEnd: headerEndIndex + 4,
    bodyStart: headerEndIndex + 4,
    framingError,
  };
}

export function inspectRawResponse(
  buffer: Buffer,
  requestMethod: string,
  connectionEnded = false,
): ParsedRawResponse | undefined {
  let start = 0;
  let head = parseResponseHead(buffer, start);
  while (
    head &&
    head.statusCode >= 100 &&
    head.statusCode < 200 &&
    head.statusCode !== 101
  ) {
    start = head.bodyStart;
    head = parseResponseHead(buffer, start);
  }
  if (!head) return undefined;
  if (head.framingError) {
    return { ...head, complete: connectionEnded, closeDelimited: true };
  }

  const noBody =
    requestMethod.toUpperCase() === "HEAD" ||
    head.statusCode === 204 ||
    head.statusCode === 304 ||
    (head.statusCode >= 100 && head.statusCode < 200);
  if (noBody) {
    return {
      ...head,
      complete: true,
      closeDelimited: false,
      messageEnd: head.bodyStart,
      body: Buffer.alloc(0),
    };
  }

  const transferEncoding = headerValues(head.headers, "transfer-encoding")
    .join(",")
    .toLowerCase();
  if (transferEncoding.split(",").map((part) => part.trim()).includes("chunked")) {
    const chunked = parseChunkedBody(buffer, head.bodyStart);
    return {
      ...head,
      complete: chunked.complete,
      closeDelimited: false,
      messageEnd: chunked.end,
      body: chunked.body,
      framingError: chunked.error,
    };
  }

  const contentLengths = headerValues(head.headers, "content-length");
  if (contentLengths.length > 0) {
    const normalized = new Set(contentLengths.map((value) => value.trim()));
    const contentLength = Number(contentLengths[0]);
    if (
      normalized.size !== 1 ||
      !/^\d+$/.test(contentLengths[0].trim()) ||
      !Number.isSafeInteger(contentLength)
    ) {
      return {
        ...head,
        complete: connectionEnded,
        closeDelimited: true,
        framingError: "Invalid or conflicting Content-Length headers",
      };
    }
    const messageEnd = head.bodyStart + contentLength;
    return {
      ...head,
      complete: buffer.length >= messageEnd,
      closeDelimited: false,
      messageEnd,
      body:
        buffer.length >= messageEnd
          ? buffer.subarray(head.bodyStart, messageEnd)
          : undefined,
    };
  }

  if (connectionEnded) {
    return {
      ...head,
      complete: true,
      closeDelimited: true,
      messageEnd: buffer.length,
      body: buffer.subarray(head.bodyStart),
    };
  }
  return { ...head, complete: false, closeDelimited: true };
}
