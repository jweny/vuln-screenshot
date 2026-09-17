export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const BASE_STYLES = `
  :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  html, body { width: 1440px; height: 900px; margin: 0; overflow: hidden; }
  body { background: #eef1f5; color: #172033; }
  .frame { width: 1440px; height: 900px; padding: 18px; }
  .card { width: 100%; height: 100%; background: #fff; border: 1px solid #ccd3dd; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 18px rgba(20, 31, 48, .08); }
  .muted { color: #667085; }
  .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; }
`;

export function documentHtml(body: string, extraStyles = ""): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>${BASE_STYLES}${extraStyles}</style></head><body>${body}</body></html>`;
}
