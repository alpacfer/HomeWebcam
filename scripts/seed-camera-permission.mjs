/**
 * Grants camera and microphone access to the station origin in Chrome's own
 * profile. The microphone is for the speech model (ADR 0016); it is granted the
 * same way and for the same reason as the camera.
 *
 * The alternative was --use-fake-ui-for-media-stream, which auto-accepts every
 * capture request. Chrome lists that flag as unsupported and puts a yellow
 * "Stability and security will suffer" infobar across the top of the window
 * for as long as it runs. On a mirror whose entire interface is deliberately
 * wordless, that banner is the only text on screen.
 *
 * Because the flag bypasses the permission system, nothing is ever stored, so
 * simply dropping it turns the banner into a permission prompt. Writing the
 * content setting the prompt would have written gets both: no banner, no
 * prompt, and a real permission a person can inspect and revoke in Settings.
 *
 * Content settings are not part of Chrome's MAC-protected preference set, so
 * seeding one is durable. Chrome must not be running: it rewrites Preferences
 * from memory on exit and would drop anything added underneath it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ALLOW = 1;

/** Walks a path of nested objects, creating any that are missing. */
function descend(root, path) {
  let node = root;
  for (const key of path) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key];
  }
  return node;
}

/** Chrome timestamps are microseconds since 1601-01-01. */
function chromeNow() {
  const EPOCH_DELTA_MS = 11_644_473_600_000;
  return String((Date.now() + EPOCH_DELTA_MS) * 1000);
}

/** The content settings the station needs, in Chrome's own names. */
const DEVICES = ["media_stream_camera", "media_stream_mic"];

export async function seedCameraPermission(profileDir, origin) {
  const file = join(profileDir, "Default", "Preferences");

  let prefs = {};
  try {
    prefs = JSON.parse(await readFile(file, "utf8"));
  } catch {
    // A profile Chrome has never opened has no Preferences at all. A file
    // holding only this setting is valid; Chrome fills in every default it
    // does not find.
  }

  const pattern = `${origin},*`;
  const granted = [];
  for (const device of DEVICES) {
    const exceptions = descend(prefs, ["profile", "content_settings", "exceptions", device]);
    if (exceptions[pattern]?.setting === ALLOW) continue;
    exceptions[pattern] = { last_modified: chromeNow(), setting: ALLOW };
    granted.push(device.replace("media_stream_", ""));
  }
  if (granted.length === 0) return "camera and microphone already granted";

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(prefs));
  return `granted ${granted.join(" and ")}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [profileDir, origin] = process.argv.slice(2);
  if (profileDir === undefined || origin === undefined) {
    console.error("usage: seed-camera-permission.mjs <profile-dir> <origin>");
    process.exit(1);
  }
  try {
    console.log(`[camera-permission] ${origin}: ${await seedCameraPermission(profileDir, origin)}`);
  } catch (error) {
    // Never fatal: without this the station still works, it just asks once.
    console.warn(
      `[camera-permission] could not preset it (${error instanceof Error ? error.message : String(error)}).`,
    );
    console.warn(
      "[camera-permission] Chrome will ask for the camera and microphone once; click Allow.",
    );
  }
}
