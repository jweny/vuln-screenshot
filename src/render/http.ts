import path from "node:path";

import { SCREENSHOT_PAGE_LIMIT } from "../types.js";
import { renderHtmlFiles } from "./browser.js";
import { documentHtml, escapeHtml } from "./html.js";

interface NumberedLine {
  number: string;
  text: string;
}

export interface HttpRenderInput {
  requestText: string;
  responseText: string;
  target: string;
  status?: number;
  complete: boolean;
  error?: string;
  screenshotsDirectory: string;
}

function paginate(lines: string[], width = 78, rowBudget = 41): NumberedLine[][] {
  const pages: NumberedLine[][] = [];
  let page: NumberedLine[] = [];
  lines.forEach((text, index) => {
    const characters = Array.from(text);
    const segments: string[] = [];
    if (characters.length === 0) segments.push("");
    for (let offset = 0; offset < characters.length; offset += width) {
      segments.push(characters.slice(offset, offset + width).join(""));
    }
    segments.forEach((segment, segmentIndex) => {
      if (page.length >= rowBudget) {
        pages.push(page);
        page = [];
      }
      page.push({
        number: segmentIndex === 0 ? String(index + 1) : "",
        text: segment,
      });
    });
  });
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

function highlightMarkupTag(tag: string): string {
  if (/^<!--|^<!doctype\b/i.test(tag)) {
    return `<span class="markup-comment">${escapeHtml(tag)}</span>`;
  }
  const match = /^<(\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?)>$/.exec(tag);
  if (!match) return escapeHtml(tag);
  const attributes = match[3];
  const attributePattern = /([A-Za-z_:][\w:.-]*)(\s*=\s*)(["'][^"']*["'])/g;
  let highlightedAttributes = "";
  let offset = 0;
  for (const attribute of attributes.matchAll(attributePattern)) {
    const index = attribute.index ?? 0;
    highlightedAttributes += escapeHtml(attributes.slice(offset, index));
    highlightedAttributes += `<span class="markup-attribute">${escapeHtml(attribute[1])}</span>${escapeHtml(attribute[2])}<span class="markup-value">${escapeHtml(attribute[3])}</span>`;
    offset = index + attribute[0].length;
  }
  highlightedAttributes += escapeHtml(attributes.slice(offset));
  return `&lt;${match[1]}<span class="tag">${escapeHtml(match[2])}</span>${highlightedAttributes}${match[4]}&gt;`;
}

function highlightMarkupLine(line: string): string | undefined {
  const pattern = /<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\/?[A-Za-z][^>]*>/gi;
  const matches = Array.from(line.matchAll(pattern));
  if (matches.length === 0) return undefined;
  let highlighted = "";
  let offset = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    highlighted += escapeHtml(line.slice(offset, index));
    highlighted += highlightMarkupTag(match[0]);
    offset = index + match[0].length;
  }
  return highlighted + escapeHtml(line.slice(offset));
}

function highlightHttpLine(line: string, first: boolean): string {
  if (first) {
    return `<span class="strong">${escapeHtml(line)}</span>`;
  }
  const header = /^([^:\s]+):(.*)$/.exec(line);
  if (header) {
    let value = escapeHtml(header[2]);
    if (/^(?:set-cookie|cookie)$/i.test(header[1])) {
      value = value.replace(
        /(^|;\s*)([^=;\s]+)(=)([^;]*)/g,
        '$1<span class="cookie-name">$2</span>$3<span class="cookie-value">$4</span>',
      );
    }
    return `<span class="header-name">${escapeHtml(header[1])}:</span>${value}`;
  }
  const jsonProperty = /^(\s*)"([^"]+)"(\s*:\s*)(.*)$/.exec(line);
  if (jsonProperty) {
    const value = escapeHtml(jsonProperty[4]).replace(
      /^(&quot;.*&quot;)([,]?)$/,
      '<span class="json-string">$1</span>$2',
    ).replace(
      /^(true|false|null|[-+]?\d+(?:\.\d+)?)([,]?)$/,
      '<span class="json-literal">$1</span>$2',
    );
    return `${escapeHtml(jsonProperty[1])}<span class="json-key">&quot;${escapeHtml(jsonProperty[2])}&quot;</span>${escapeHtml(jsonProperty[3])}${value}`;
  }
  return highlightMarkupLine(line) ?? escapeHtml(line);
}

function renderRows(lines: NumberedLine[]): string {
  return lines
    .map(
      (line) => `<div class="code-row${line.number === "1" ? " current-line" : ""}"><span class="line-number">${line.number}</span><code>${highlightHttpLine(line.text, line.number === "1")}</code></div>`,
    )
    .join("");
}

function pageHtml(
  input: HttpRenderInput,
  requestLines: NumberedLine[],
  responseLines: NumberedLine[],
): string {
  const detail = input.error
    ? `<div class="notice">${escapeHtml(input.error)}</div>`
    : "";
  return documentHtml(
    `<main class="frame"><section class="card http-workbench">
      <div class="panes">
        <section class="pane request-pane"><header class="pane-header"><h1>Request</h1><nav class="tabs"><span class="tab active">Pretty</span><span class="tab">Raw</span><span class="tab">Hex</span></nav></header><div class="code mono">${renderRows(requestLines)}</div></section>
        <div class="splitter" aria-hidden="true"></div>
        <section class="pane response-pane"><header class="pane-header"><h1>Response</h1><nav class="tabs"><span class="tab active">Pretty</span><span class="tab">Raw</span><span class="tab">Hex</span><span class="tab">Render</span></nav></header><div class="code mono">${detail}${renderRows(responseLines)}</div></section>
      </div>
    </section></main>`,
    `
      body { background: #fff; color: #202124; }
      .frame { padding: 0; }
      .http-workbench { border: 0; border-radius: 0; box-shadow: none; }
      .panes { display: grid; grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr); height: 100%; background: #fff; }
      .pane { min-width: 0; display: grid; grid-template-rows: 98px minmax(0, 1fr); overflow: hidden; background: #fff; }
      .pane-header { background: #fff; border-bottom: 1px solid #d9d9d9; }
      .pane-header h1 { height: 50px; margin: 0; padding: 14px 18px 8px; color: #111; font-size: 18px; line-height: 28px; font-weight: 720; letter-spacing: -.015em; }
      .tabs { height: 48px; display: flex; align-items: stretch; }
      .tab { position: relative; min-width: 74px; padding: 12px 18px 10px; color: #292929; font-size: 15px; line-height: 25px; text-align: center; }
      .tab.active::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 3px; background: #e66a35; content: ""; }
      .splitter { background: #d7d7d7; }
      .code { padding: 4px 0; overflow: hidden; background: #fff; font-family: "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 15px; line-height: 19px; letter-spacing: .01em; }
      .code-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); min-height: 19px; }
      .code-row.current-line code { background: #eeeeee; }
      .line-number { color: #777; text-align: right; padding-right: 7px; border-right: 1px solid #e7e7e7; user-select: none; }
      code { display: block; padding: 0 7px; white-space: pre-wrap; overflow-wrap: anywhere; color: #202124; }
      .notice { margin: -4px 0 4px; padding: 7px 11px; background: #fdeaea; border-bottom: 1px solid #e7b7b7; color: #a51d1d; font: 13px/20px "SFMono-Regular", Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .strong { color: #202124; font-weight: 700; }
      .header-name, .cookie-name { color: #000080; }
      .cookie-value { color: #b51f24; }
      .tag, .json-key { color: #a000a0; }
      .markup-attribute { color: #001db8; }
      .markup-value, .json-string { color: #b51f24; }
      .markup-comment { color: #147214; }
      .json-literal { color: #001db8; }
    `,
  );
}

export async function renderHttpScreenshots(input: HttpRenderInput): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const rowBudget = input.error ? 39 : 41;
  const requestPages = paginate(input.requestText.split(/\r?\n/), 78, rowBudget);
  const responsePages = paginate(input.responseText.split(/\r?\n/), 78, rowBudget);
  const desiredPageCount = Math.max(requestPages.length, responsePages.length);
  const pageCount = Math.min(desiredPageCount, SCREENSHOT_PAGE_LIMIT);
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const outputPath = path.join(
      input.screenshotsDirectory,
      `${String(index + 1).padStart(3, "0")}.png`,
    );
    return {
      outputPath,
      html: pageHtml(
        input,
        requestPages[index] ?? [],
        responsePages[index] ?? [],
      ),
    };
  });
  return {
    paths: await renderHtmlFiles(pages),
    truncated: desiredPageCount > SCREENSHOT_PAGE_LIMIT,
  };
}
