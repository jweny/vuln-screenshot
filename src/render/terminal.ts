import path from "node:path";

import Convert from "ansi-to-html";

import { SCREENSHOT_PAGE_LIMIT } from "../types.js";
import { renderHtmlFiles } from "./browser.js";
import { documentHtml, escapeHtml } from "./html.js";

export interface TerminalRenderInput {
  command: string;
  cwd: string;
  shell: string;
  serializedAnsi: string;
  exitCode?: number;
  signal?: number;
  timedOut: boolean;
  error?: string;
  screenshotsDirectory: string;
}

function terminalPageHtml(
  input: TerminalRenderInput,
  ansiLines: string[],
): string {
  const converter = new Convert({
    fg: "#f2f2f2",
    bg: "#050706",
    newline: true,
    escapeXML: true,
    stream: false,
  });
  const rendered = converter.toHtml(ansiLines.join("\n"));
  return documentHtml(
    `<main class="terminal-screen mono">
      <div class="command-line">${escapeHtml(input.command)}</div>
      <pre class="terminal-output">${rendered || '<span class="empty">(no terminal output)</span>'}${input.error ? `\n<span class="terminal-error">${escapeHtml(input.error)}</span>` : ""}</pre>
    </main>`,
    `
      html, body { background: #050706; }
      .terminal-screen { width: 1440px; height: 900px; margin: 0; padding: 13px 16px; overflow: hidden; background: #050706; color: #f2f2f2; font-family: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 17px; line-height: 20px; letter-spacing: .018em; text-shadow: 0 0 1px rgba(255, 255, 255, .16); }
      .command-line { min-height: 20px; margin-bottom: 14px; color: #f7f7f7; font-weight: 700; white-space: pre-wrap; overflow-wrap: anywhere; }
      .terminal-output { margin: 0; color: #f2f2f2; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
      .terminal-error { color: #ff7373; }
      .empty { color: #929b96; font-style: italic; }
    `,
  );
}

export async function renderTerminalScreenshots(
  input: TerminalRenderInput,
): Promise<{ paths: string[]; truncated: boolean }> {
  const lines = input.serializedAnsi.replaceAll("\r\n", "\n").split("\n");
  const linesPerPage = input.error ? 40 : 41;
  const desiredPageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  const pageCount = Math.min(desiredPageCount, SCREENSHOT_PAGE_LIMIT);
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const outputPath = path.join(
      input.screenshotsDirectory,
      `${String(index + 1).padStart(3, "0")}.png`,
    );
    return {
      outputPath,
      html: terminalPageHtml(
        input,
        lines.slice(index * linesPerPage, (index + 1) * linesPerPage),
      ),
    };
  });
  return {
    paths: await renderHtmlFiles(pages),
    truncated: desiredPageCount > SCREENSHOT_PAGE_LIMIT,
  };
}
