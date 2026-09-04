/**
 * The one CDP client. Everything that talks to the station goes through it.
 *
 * Written after nine single-use scripts in one afternoon each reimplemented the
 * same WebSocket plumbing, and each scraped the page with its own regex. The
 * plumbing belongs here; what to ask the page belongs in src/debug/bridge.ts,
 * where it sits next to the code that produces the answer.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const STATION_URL = "http://127.0.0.1:5173/";
export const STATION_PORT = 9222;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function serverIsReady(url = STATION_URL) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export async function pageTarget(port = STATION_PORT, url = STATION_URL) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return (
      targets.find((t) => t.type === "page" && t.url === url) ??
      targets.find((t) => t.type === "page" && t.url.startsWith(url)) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * Refuses to work around a station that is running but not controllable, for
 * the same reason the screenshot tool does: the alternative is a second browser
 * fighting for /dev/video0. See docs/frictions/0001.
 */
export async function attach({ port = STATION_PORT, url = STATION_URL } = {}) {
  if (!(await serverIsReady(url))) {
    throw new Error(`No HomeWebcam debug server at ${url}. Run ./start.sh first.`);
  }
  const target = await pageTarget(port, url);
  if (target === null) {
    throw new Error(
      `The station at ${url} is not controllable on port ${port}. Reopen it through ./start.sh.\n` +
        `Never start a competing browser: /dev/video0 allows one owner.`,
    );
  }
  return Cdp.connect(target.webSocketDebuggerUrl);
}

export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    cdp.#ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = cdp.#pending.get(message.id);
      if (waiter === undefined) return;
      cdp.#pending.delete(message.id);
      message.error
        ? waiter.reject(new Error(message.error.message))
        : waiter.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener("open", resolve, { once: true });
      cdp.#ws.addEventListener("error", () => reject(new Error("CDP socket failed")), {
        once: true,
      });
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return cdp;
  }

  send(method, params = {}) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluates an expression in the page and returns its value by value. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails !== undefined) {
      throw new Error(`page threw: ${exceptionDetails.exception?.description ?? "unknown"}`);
    }
    return result.value;
  }

  /** The typed debug surface from src/debug/bridge.ts. */
  async snapshot() {
    const snapshot = await this.evaluate("window.__station?.snapshot() ?? null");
    if (snapshot === null) {
      throw new Error(
        "window.__station is missing. The bridge is dev-only: is this a production build,\n" +
          "or did the page fail to start? Check the console and reload.",
      );
    }
    return snapshot;
  }

  async config() {
    return this.evaluate("window.__station?.config ?? null");
  }

  async keys(list) {
    for (const key of list) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", key });
      await sleep(120);
    }
  }

  async reload({ settleMs = 1000 } = {}) {
    await this.send("Page.reload");
    // is-live is only set once the camera is streaming again, but the outgoing
    // document keeps answering for a moment, so do not start asking yet.
    await sleep(settleMs);
    await this.waitFor("document.body.classList.contains('is-live')", { timeoutMs: 30_000 });
  }

  /** Polls an expression until it is truthy. Throws with context on timeout. */
  async waitFor(expression, { timeoutMs = 15_000, everyMs = 80, what = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression).catch(() => false)) return true;
      await sleep(everyMs);
    }
    const hud = await this.evaluate("document.getElementById('hud')?.textContent ?? ''").catch(
      () => "",
    );
    throw new Error(
      `Timed out after ${timeoutMs} ms waiting for ${what}.\nHUD said: ${hud || "(empty)"}`,
    );
  }

  async screenshot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  }

  close() {
    this.#ws.close();
  }
}

/** Minimal flag parsing, shared so every tool spells its flags the same way. */
export function args(argv = process.argv.slice(2)) {
  const positional = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      i++;
    }
  }
  return {
    positional,
    has: (name) => flags.has(name),
    get: (name, fallback) => (flags.has(name) ? flags.get(name) : fallback),
    number: (name, fallback) => (flags.has(name) ? Number(flags.get(name)) : fallback),
  };
}
