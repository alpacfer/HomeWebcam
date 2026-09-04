/**
 * Captures a screenshot of the running app from a real Chrome, over CDP.
 *
 * The point is that UI changes can be verified without a human at the station:
 *   npm run dev            # in one terminal
 *   npm run screenshot     # writes captures/app.png
 *
 * Chrome is launched headless with camera permission pre-granted, so it opens
 * the real /dev/video device and the perception pipeline runs for real. Pass
 * --fake-camera for a deterministic synthetic feed with nobody in front of it.
 *
 * Usage:
 *   node scripts/screenshot.mjs [--out FILE] [--url URL] [--fake-camera]
 *                              [--width N] [--height N] [--settle MS]
 *                              [--wait-for "JS expression"] [--keys "d,d"]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const opts = {
  url: flag("url", "http://127.0.0.1:5173/"),
  out: resolve(root, flag("out", "captures/app.png")),
  width: Number(flag("width", 1280)),
  height: Number(flag("height", 720)),
  settle: Number(flag("settle", 6000)),
  waitFor: flag("wait-for", "document.body.classList.contains('is-live')"),
  keys: flag("keys", "").split(",").filter(Boolean),
  fakeCamera: has("fake-camera"),
  port: 9222 + Math.floor(Math.random() * 200),
};

const CHROME = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

const chrome = spawn(
  CHROME.find(Boolean),
  [
    "--headless=new",
    `--remote-debugging-port=${opts.port}`,
    `--window-size=${opts.width},${opts.height}`,
    // Grants getUserMedia without a prompt. Safe here: this profile is
    // throwaway and only ever loads our own localhost origin.
    "--use-fake-ui-for-media-stream",
    ...(opts.fakeCamera ? ["--use-fake-device-for-media-stream"] : []),
    "--autoplay-policy=no-user-gesture-required",
    // MediaPipe's GPU delegate needs WebGL, which headless serves via SwiftShader.
    "--enable-unsafe-swiftshader",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(root, "captures/.chrome-profile")}`,
    "about:blank",
  ],
  // detached puts Chrome in its own process group. Chrome forks a media
  // process that holds /dev/video open, and killing only the parent leaks
  // it - the next run then fails with "Could not start video source".
  { stdio: ["ignore", "ignore", "pipe"], detached: true },
);

const stderr = [];
chrome.stderr.on("data", (chunk) => stderr.push(String(chunk)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`Chrome never opened a debugger port.\n${stderr.join("")}`);
}

class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    cdp.#ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const waiter = cdp.#pending.get(msg.id);
      if (waiter === undefined) return;
      cdp.#pending.delete(msg.id);
      msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
    });
    await new Promise((res, rej) => {
      cdp.#ws.addEventListener("open", res, { once: true });
      cdp.#ws.addEventListener("error", () => rej(new Error("CDP socket failed")), { once: true });
    });
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const { result } = await this.send("Runtime.evaluate", { expression, awaitPromise: true });
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

let cdp;
try {
  cdp = await Cdp.connect(await debuggerUrl());
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send("Page.navigate", { url: opts.url });

  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(opts.waitFor).catch(() => false)) {
      ready = true;
      break;
    }
    await sleep(250);
  }
  if (!ready) {
    const hud = await cdp.evaluate("document.getElementById('hud')?.textContent ?? ''");
    throw new Error(`Timed out waiting for \`${opts.waitFor}\`.\nHUD said: ${hud || "(empty)"}`);
  }

  // Let the detectors warm up and the fade-in finish before capturing.
  await sleep(opts.settle);

  for (const key of opts.keys) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key });
    await sleep(500);
  }

  const hud = await cdp.evaluate("document.getElementById('hud')?.textContent ?? ''");
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, Buffer.from(data, "base64"));

  console.log(`[screenshot] ${opts.out}`);
  console.log(`[screenshot] HUD:\n${hud.replace(/^/gm, "  ")}`);
} finally {
  cdp?.close();
  try {
    process.kill(-chrome.pid, "SIGKILL");
  } catch {
    chrome.kill("SIGKILL");
  }
}
