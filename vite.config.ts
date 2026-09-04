/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
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
