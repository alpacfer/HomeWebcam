/**
 * Reports the station state before development or verification work begins.
 * This command is deliberately read-only: it never starts a server or browser.
 */

const appUrl = process.env.HOMEWEBCAM_URL ?? "http://127.0.0.1:5173/";
const controlPort = Number(process.env.HOMEWEBCAM_DEBUG_PORT ?? 9222);

async function urlIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function controlledPage(url, port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    const targets = await response.json();
    const expected = new URL(url).href;
    return targets.find(
      (target) => target.type === "page" && new URL(target.url).href === expected,
    );
  } catch {
    return undefined;
  }
}

const serverRunning = await urlIsReady(appUrl);
const page = await controlledPage(appUrl, controlPort);

console.log(`[preflight] debug server  ${serverRunning ? `RUNNING · ${appUrl}` : "NOT RUNNING"}`);
console.log(
  `[preflight] browser control ${page === undefined ? `UNAVAILABLE · port ${controlPort}` : `READY · port ${controlPort}`}`,
);

if (serverRunning && page !== undefined) {
  console.log(
    "[preflight] action        reuse this server and browser; npm run screenshot will attach",
  );
} else if (serverRunning) {
  console.log(
    "[preflight] action        reuse this server; do not start another server or browser",
  );
  console.log("[preflight] screenshot    blocked until the existing page exposes browser control");
} else {
  console.log(
    "[preflight] action        start the station with ./start.sh before runtime verification",
  );
}
