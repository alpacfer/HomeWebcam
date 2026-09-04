import manifest from "../../models.json" with { type: "json" };

/**
 * Model and WASM URLs, served from our own origin so the station works offline.
 * Files land in public/ via `npm run models` and the postinstall sync-wasm step.
 */
const base = `/${manifest.destDir.replace(/^public\//, "")}`;

export const MODEL_URL = {
  gestureRecognizer: `${base}/${manifest.models.gestureRecognizer.file}`,
  faceDetector: `${base}/${manifest.models.faceDetector.file}`,
  faceLandmarker: `${base}/${manifest.models.faceLandmarker.file}`,
  poseLandmarker: `${base}/${manifest.models.poseLandmarker.file}`,
} as const;

export const WASM_PATH = "/mediapipe/wasm";

/** Turns the inevitable "file not found" into a message that names the fix. */
export async function assertModelsPresent(): Promise<void> {
  const missing: string[] = [];
  await Promise.all(
    Object.values(MODEL_URL).map(async (url) => {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) missing.push(url);
    }),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing model files: ${missing.join(", ")}. Run \`npm run models\` and reload.`,
    );
  }
}
