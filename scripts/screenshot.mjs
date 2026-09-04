/**
 * Captures a screenshot of the running app from a real Chrome, over CDP.
 *
 * The point is that UI changes can be verified without a human at the station:
 *   ./start.sh              # the station, with its controllable Chrome
 *   npm run screenshot      # writes captures/app.png
 *
 * When a debug server is already running, its page and camera owner are
 * authoritative. The default path attaches to its Chrome on port 9222 and
 * refuses to launch a competing browser if that control endpoint is missing.
 * Pass --new-browser or --fake-camera only when isolation is explicitly wanted.
 *
 * For anything richer than a picture - app state, driving hands, probing what
 * was actually drawn - use `npm run station`. This tool stays deliberately
 * simple, and is the only one allowed to start a browser of its own.
 *
 * Usage:
 *   node scripts/screenshot.mjs [--out FILE] [--url URL] [--fake-camera]
 *                              [--width N] [--height N] [--settle MS]
 *                              [--wait-for "JS expression"] [--keys "d,d"]
 *                              [--attach] [--new-browser] [--port N] [--reload]
 *                              [--after "JS expression"]
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  args,
  Cdp,
  pageTarget,
  STATION_PORT,
  STATION_URL,
  serverIsReady,
  sleep,
} from "./lib/cdp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = args();

const requestedUrl = String(flags.get("url", STATION_URL));
const stationPort = flags.number("port", STATION_PORT);
const forceAttach = flags.has("attach");
const forceNewBrowser = flags.has("new-browser") || flags.has("fake-camera");

const stationIsRunning = (await pageTarget(stationPort, requestedUrl)) !== null;
if (!(await serverIsReady(requestedUrl))) {
  throw new Error(`No HomeWebcam debug server found at ${requestedUrl}. Run ./start.sh first.`);
}
if (forceAttach && !stationIsRunning) {
  throw new Error(
    `No controllable station Chrome found on port ${stationPort}. Run ./start.sh first.`,
  );
}
if (!forceNewBrowser && !stationIsRunning) {
  throw new Error(
    `HomeWebcam is already running at ${requestedUrl}, but its browser is not controllable on port ${stationPort}. Refusing to launch a competing browser or camera. Reopen the station through ./start.sh, or explicitly request --new-browser/--fake-camera for an isolated run.`,
  );
}
const attach = !forceNewBrowser;

const opts = {
  url: requestedUrl,
  out: resolve(root, String(flags.get("out", "captures/app.png"))),
  width: flags.number("width", 1280),
  height: flags.number("height", 720),
  settle: flags.number("settle", 6000),
  waitFor: String(flags.get("wait-for", "document.body.classList.contains('is-live')")),
  keys: String(flags.get("keys", "")).split(",").filter(Boolean),
  // An attached station keeps whatever state a visitor left it in. Capturing
  // the first thing someone sees means putting the page back to its start.
  reload: flags.has("reload"),
  // Sleeping a fixed time after a keystroke captures whatever the app happens
  // to be doing. --after waits for the state you actually came for, and reads
  // progress just as well as flags: "+el.style.getPropertyValue('--p') > 0.45".
  after: flags.get("after", ""),
  fakeCamera: flags.has("fake-camera"),
  attach,
  port: attach ? stationPort : 10_000 + Math.floor(Math.random() * 1000),
};

const CHROME = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];

const chrome = opts.attach
  ? null
  : spawn(
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
chrome?.stderr.on("data", (chunk) => stderr.push(String(chunk)));

async function debuggerUrl() {
  for (let i = 0; i < 60; i++) {
    const target = await pageTarget(opts.port, opts.url);
    if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    try {
      const targets = await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json();
      const any = targets.find((t) => t.type === "page");
      if (any?.webSocketDebuggerUrl) return any.webSocketDebuggerUrl;
    } catch {
      // Chrome not listening yet.
    }
    await sleep(250);
  }
  throw new Error(`Chrome never opened a debugger port.\n${stderr.join("")}`);
}

let cdp;
try {
  cdp = await Cdp.connect(await debuggerUrl());
  if (!opts.attach) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: opts.url });
  } else if (opts.reload) {
    await cdp.reload();
  }

  await cdp.waitFor(opts.waitFor, { timeoutMs: 30_000, everyMs: 250 });

  // Let the detectors warm up and the fade-in finish before capturing.
  await sleep(opts.settle);

  for (const key of opts.keys) {
    await cdp.keys([key]);
    const cameraMode = { d: "debug", f: "final" }[key.toLowerCase()];
    if (cameraMode === undefined) {
      await sleep(380);
      continue;
    }
    await cdp.waitFor(`document.body.dataset.cameraMode === ${JSON.stringify(cameraMode)}`, {
      timeoutMs: 15_000,
      everyMs: 100,
      what: `the camera to enter ${cameraMode} mode`,
    });
  }

  if (opts.after !== "") await cdp.waitFor(String(opts.after), { timeoutMs: 20_000 });

  const hud = await cdp.evaluate("document.getElementById('hud')?.textContent ?? ''");
  await cdp.screenshot(opts.out);

  console.log(`[screenshot] ${opts.out}`);
  console.log(`[screenshot] HUD:\n${String(hud).replace(/^/gm, "  ")}`);
} finally {
  cdp?.close();
  if (chrome !== null) {
    try {
      process.kill(-chrome.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}
