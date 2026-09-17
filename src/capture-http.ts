import path from "node:path";

import {
  createEvidenceBundle,
  describeFile,
  writeArtifact,
  writeManifest,
} from "./artifacts.js";
import { responseToDisplay, rawBufferToDisplay } from "./http/display.js";
import { captureRawHttp } from "./http/raw-capture.js";
import { renderHttpScreenshots } from "./render/http.js";
import {
  HTTP_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  type CaptureResult,
  type EvidenceFile,
  type EvidenceManifest,
  type HttpCaptureInput,
} from "./types.js";

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? HTTP_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return timeout;
}

export async function captureHttpEvidence(
  input: HttpCaptureInput,
): Promise<CaptureResult> {
  const started = new Date();
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const tlsVerify = input.tlsVerify ?? true;
  const bundle = await createEvidenceBundle("http", input.outputRoot);
  const requestPath = path.join(bundle.directory, "request.raw");
  const responsePath = path.join(bundle.directory, "response.raw");
  await writeArtifact(requestPath, input.rawRequest);

  let capture: Awaited<ReturnType<typeof captureRawHttp>> | undefined;
  let captureError: string | undefined;
  try {
    capture = await captureRawHttp({
      target: input.target,
      rawRequest: input.rawRequest,
      timeoutMs,
      tlsVerify,
    });
    captureError = capture.error;
  } catch (error) {
    captureError = error instanceof Error ? error.message : String(error);
  }
  const response = capture?.response ?? Buffer.alloc(0);
  await writeArtifact(responsePath, response);

  const warnings: string[] = [];
  if (capture?.parsedResponse?.framingError) {
    warnings.push(capture.parsedResponse.framingError);
  }
  const display = responseToDisplay(response, capture?.parsedResponse);
  if (display.warning) warnings.push(display.warning);

  let screenshotPaths: string[] = [];
  let screenshotsTruncated = false;
  let renderError: string | undefined;
  try {
    const rendered = await renderHttpScreenshots({
      requestText: rawBufferToDisplay(input.rawRequest),
      responseText: display.text,
      target: input.target,
      status: capture?.parsedResponse?.statusCode,
      complete: capture?.complete ?? false,
      error: captureError,
      screenshotsDirectory: bundle.screenshotsDirectory,
    });
    screenshotPaths = rendered.paths;
    screenshotsTruncated = rendered.truncated;
  } catch (error) {
    renderError = error instanceof Error ? error.message : String(error);
    warnings.push(`Screenshot rendering failed: ${renderError}`);
  }

  const files: EvidenceFile[] = [
    await describeFile("http_request_raw", requestPath),
    await describeFile("http_response_raw", responsePath),
  ];
  for (const screenshotPath of screenshotPaths) {
    files.push(await describeFile("screenshot", screenshotPath));
  }

  const finished = new Date();
  const success = Boolean(capture?.complete) && !captureError && !renderError;
  const manifest: EvidenceManifest = {
    schema_version: 1,
    evidence_id: bundle.id,
    kind: "http",
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - started.getTime(),
    success,
    complete: capture?.complete ?? false,
    capture_truncated: capture?.truncated ?? false,
    screenshots_truncated: screenshotsTruncated,
    input: {
      target: input.target,
      request_bytes: input.rawRequest.length,
      timeout_ms: timeoutMs,
      tls_verify: tlsVerify,
    },
    result: {
      http_version: capture?.parsedResponse?.version,
      status_code: capture?.parsedResponse?.statusCode,
      status_message: capture?.parsedResponse?.statusMessage,
      response_bytes: response.length,
      timed_out: capture?.timedOut ?? false,
      error: captureError,
      render_error: renderError,
      tls: capture?.tls,
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
    kind: "http",
    success,
    complete: manifest.complete,
    capture_truncated: manifest.capture_truncated,
    screenshots_truncated: screenshotsTruncated,
    manifest_path: bundle.manifestPath,
    screenshot_paths: screenshotPaths,
    artifact_paths: { request_raw: requestPath, response_raw: responsePath },
    summary: {
      status_code: capture?.parsedResponse?.statusCode,
      response_bytes: response.length,
      timed_out: capture?.timedOut ?? false,
      error: captureError ?? renderError,
    },
    warnings,
  };
}
