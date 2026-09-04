import { App } from "./app.js";
import "./ui/styles.css";

const app = new App();
await app.start().catch((error: unknown) => {
  console.error("[HomeWebcam] failed to start", error);
});

window.addEventListener("pagehide", () => app.stop());
