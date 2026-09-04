/// <reference types="vitest/config" />
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Connect, defineConfig, type Plugin } from "vite";

const CAPTURES_DIR = fileURLToPath(new URL("./captures/", import.meta.url));
/** A noisy lossless 1080p frame stays below this; it only rejects malformed local requests. */
const MAX_CAPTURE_BYTES = 20 * 1024 * 1024;

function localCapturePlugin(): Plugin {
  const middleware = captureMiddleware();
  return {
    name: "homewebcam-local-captures",
    configureServer(server) {
      server.middlewares.use("/api/captures", middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/captures", middleware);
    },
  };
}

function captureMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    if (!request.headers["content-type"]?.startsWith("image/png")) {
      sendJson(response, 415, { error: "Expected an image/png body" });
      return;
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    let rejected = false;
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_CAPTURE_BYTES) {
        if (!rejected) sendJson(response, 413, { error: "Capture is too large" });
        rejected = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      const png = Buffer.concat(chunks, bytes);
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      if (
        png.length < signature.length ||
        !signature.every((byte, index) => png.at(index) === byte)
      ) {
        sendJson(response, 400, { error: "Capture is not a PNG" });
        return;
      }

      const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
      const filename = `picture-${timestamp}-${randomUUID().slice(0, 8)}.png`;
      void mkdir(CAPTURES_DIR, { recursive: true })
        .then(() => writeFile(resolve(CAPTURES_DIR, filename), png, { flag: "wx" }))
        .then(() => sendJson(response, 201, { filename }))
        .catch((error: unknown) => {
          console.error("[HomeWebcam] failed to save capture", error);
          sendJson(response, 500, { error: "Capture could not be saved" });
        });
    });
    request.on("error", (error) => {
      console.error("[HomeWebcam] capture request failed", error);
      if (!response.headersSent) sendJson(response, 400, { error: "Capture upload failed" });
    });
  };
}

function sendJson(response: ServerResponse, status: number, body: Record<string, string>): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

export default defineConfig({
  plugins: [localCapturePlugin()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // getUserMedia needs a secure context. 127.0.0.1 and localhost count as
    // secure, so no TLS is needed locally. Serving the kiosk to another machine
    // does need HTTPS - see docs/architecture.md.
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    // Node, not jsdom: only framework-free logic is unit tested. Anything that
    // touches the camera or MediaPipe is verified by running the app.
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
