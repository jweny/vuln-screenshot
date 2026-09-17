import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";

import { chromium, type Browser } from "playwright";

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true });
  } catch (defaultError) {
    const candidates = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const executablePath of candidates) {
      if (!existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ headless: true, executablePath });
      } catch {
        // Try the next explicitly installed Chromium-compatible browser.
      }
    }
    throw defaultError;
  }
}

export async function renderHtmlFiles(
  pages: Array<{ html: string; outputPath: string }>,
): Promise<string[]> {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => route.abort());
    for (const item of pages) {
      await page.setContent(item.html, { waitUntil: "load" });
      await page.screenshot({
        path: item.outputPath,
        type: "png",
        animations: "disabled",
      });
      if (process.platform !== "win32") await chmod(item.outputPath, 0o600);
    }
    return pages.map((item) => item.outputPath);
  } finally {
    await browser.close();
  }
}
