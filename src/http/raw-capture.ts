import net from "node:net";
import tls from "node:tls";

import { CAPTURE_LIMIT_BYTES } from "../types.js";
import {
  inspectRawResponse,
  parseRawRequest,
  type ParsedRawRequest,
  type ParsedRawResponse,
} from "./protocol.js";

export interface TlsMetadata {
  authorized: boolean;
  authorizationError?: string;
  protocol?: string | null;
  cipher?: string;
  peerCertificate?: {
    subject?: string;
    issuer?: string;
    validFrom?: string;
    validTo?: string;
    fingerprint256?: string;
  };
}

export interface RawHttpCapture {
  request: ParsedRawRequest;
  response: Buffer;
  parsedResponse?: ParsedRawResponse;
  complete: boolean;
  truncated: boolean;
  timedOut: boolean;
  error?: string;
  tls?: TlsMetadata;
}

export function validateTarget(target: string): URL {
  const url = new URL(target);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Target scheme must be http or https");
  }
  if (!url.hostname || url.username || url.password) {
    throw new Error("Target must contain only a host and optional port");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Target must not contain a path, query, or fragment");
  }
  return url;
}

function certificateName(value: tls.PeerCertificate["subject"]): string | undefined {
  if (!value || Object.keys(value).length === 0) return undefined;
  return Object.entries(value)
    .map(([key, item]) => `${key}=${item}`)
    .join(", ");
}

export async function captureRawHttp(options: {
  target: string;
  rawRequest: Buffer;
  timeoutMs: number;
  tlsVerify: boolean;
}): Promise<RawHttpCapture> {
  if (options.rawRequest.length > CAPTURE_LIMIT_BYTES) {
    throw new Error(`Raw request exceeds ${CAPTURE_LIMIT_BYTES} bytes`);
  }
  const request = parseRawRequest(options.rawRequest);
  const target = validateTarget(options.target);
  const secure = target.protocol === "https:";
  const port = target.port ? Number(target.port) : secure ? 443 : 80;

  return await new Promise<RawHttpCapture>((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let truncated = false;
    let timedOut = false;
    let tlsMetadata: TlsMetadata | undefined;

    const socket: net.Socket | tls.TLSSocket = secure
      ? tls.connect({
          host: target.hostname,
          port,
          servername: net.isIP(target.hostname) ? undefined : target.hostname,
          rejectUnauthorized: options.tlsVerify,
          ALPNProtocols: ["http/1.1"],
        })
      : net.connect({ host: target.hostname, port });

    const currentBuffer = (): Buffer => Buffer.concat(chunks, bytes);

    const finish = (fields: {
      ended?: boolean;
      error?: string;
    } = {}): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const response = currentBuffer();
      const parsedResponse = inspectRawResponse(
        response,
        request.method,
        fields.ended ?? false,
      );
      resolve({
        request,
        response,
        parsedResponse,
        complete: Boolean(parsedResponse?.complete) && !truncated && !fields.error,
        truncated,
        timedOut,
        error: fields.error,
        tls: tlsMetadata,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      socket.destroy();
      finish({ error: `HTTP capture timed out after ${options.timeoutMs} ms` });
    }, options.timeoutMs);

    const sendRequest = (): void => {
      if (secure) {
        const tlsSocket = socket as tls.TLSSocket;
        const certificate = tlsSocket.getPeerCertificate();
        const cipher = tlsSocket.getCipher();
        tlsMetadata = {
          authorized: tlsSocket.authorized,
          authorizationError: tlsSocket.authorizationError?.message,
          protocol: tlsSocket.getProtocol(),
          cipher: cipher?.name,
          peerCertificate:
            certificate && Object.keys(certificate).length > 0
              ? {
                  subject: certificateName(certificate.subject),
                  issuer: certificateName(certificate.issuer),
                  validFrom: certificate.valid_from,
                  validTo: certificate.valid_to,
                  fingerprint256: certificate.fingerprint256,
                }
              : undefined,
        };
      }
      socket.write(options.rawRequest);
    };

    socket.on("data", (data: Buffer) => {
      const remaining = CAPTURE_LIMIT_BYTES - bytes;
      if (data.length > remaining) {
        if (remaining > 0) chunks.push(data.subarray(0, remaining));
        bytes += Math.max(remaining, 0);
        truncated = true;
        socket.destroy();
        finish({ error: `HTTP response exceeded ${CAPTURE_LIMIT_BYTES} bytes` });
        return;
      }
      chunks.push(data);
      bytes += data.length;
      const parsed = inspectRawResponse(currentBuffer(), request.method, false);
      if (parsed?.complete) {
        socket.destroy();
        finish();
      }
    });
    socket.on("end", () => finish({ ended: true }));
    socket.on("close", () => finish({ ended: true }));
    socket.on("error", (error) => finish({ error: error.message }));
    if (secure) socket.once("secureConnect", sendRequest);
    else socket.once("connect", sendRequest);
  });
}
