// Drives the preinstalled Chromium (playwright-core, no browser download).
// PLAYWRIGHT_BROWSERS_PATH points at it in the development container; on
// CI runners the system Chrome is used instead.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright-core";

function executablePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dir = readdirSync(root).find((name) => /^chromium-\d+$/.test(name));
    if (dir) {
      const candidate = path.join(root, dir, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const candidate of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"])
    if (existsSync(candidate)) return candidate;
  return undefined;
}

export async function launchBrowser(): Promise<Browser> {
  const executable = executablePath();
  if (!executable) throw new Error("No Chromium or Chrome found for the browser tests.");
  return chromium.launch({ executablePath: executable, headless: true });
}
