import { CONFIG } from "../config.js";

export type CameraMode = keyof typeof CONFIG.camera.modes;

/**
 * What the station is showing, as distinct from what the camera is doing.
 *
 * Until ADR 0021 the two were one setting: D meant the debug surface *and* the
 * 720p/60 camera profile, F the visitor's glass *and* 1080p/30. So the recorder,
 * which lives on the debug surface, could only ever record the 720p profile,
 * and the resolution visitors actually get was never once measured. They are
 * separate now: D and F still set both, R swaps the profile on its own.
 */
export type StationView = "debug" | "final";

type CameraCapabilities = MediaTrackCapabilities & {
  exposureMode?: string[];
  focusMode?: string[];
  whiteBalanceMode?: string[];
};

type CameraConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
};

export class CameraError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = "CameraError";
  }
}

/**
 * Opens the webcam and resolves once the video element is actually producing
 * frames. Awaiting `play()` alone is not enough: videoWidth can still be 0,
 * and MediaPipe throws on a zero-sized frame.
 */
export async function startCamera(video: HTMLVideoElement, mode: CameraMode): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "getUserMedia is unavailable",
      "The page needs a secure context. Use http://127.0.0.1:5173 or serve over HTTPS.",
    );
  }

  const stream = await openCamera(mode);
  try {
    await tuneTrack(stream, mode);
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await waitForFrames(video);
    return stream;
  } catch (error) {
    stopCamera(stream);
    video.srcObject = null;
    throw error;
  }
}

/**
 * Asks twice: once insisting on the frame rate, then once willing to take
 * whatever is on offer.
 *
 * The strict ask is the whole point. With `frameRate: { ideal: 60 }` alone the
 * browser sees two modes that satisfy the ideal - 1280x720 at 60 and at 30 -
 * and picks either; on the station it picked 30, silently. `min` is a mandatory
 * constraint, so every mode below the floor is discarded before the choice is
 * made and only the 60 fps mode survives.
 *
 * The lenient retry is why `min` is safe to use: a camera that genuinely cannot
 * do 60 raises OverconstrainedError here, and a 30 fps mirror still beats a
 * black screen. describeStream() reports which one we ended up on.
 */
async function openCamera(mode: CameraMode): Promise<MediaStream> {
  const attempts = modeConstraints(mode);

  let lastError: unknown;
  for (const [i, videoConstraints] of attempts.entries()) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
    } catch (cause) {
      lastError = cause;
      // Only an unsatisfiable constraint is worth retrying. A denied permission
      // or a busy device fails the same way twice, and asking again just makes
      // the real error take longer to surface.
      if (!isOverconstrained(cause) || i === attempts.length - 1) break;
      console.warn(`[camera] strict ${mode} mode unavailable; retrying with preferred constraints`);
    }
  }

  throw new CameraError(
    `Could not open the camera: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    "Check that the browser has camera permission and no other app holds the device.",
  );
}

/** Applies quality controls without disturbing the format getUserMedia chose. */
async function tuneTrack(stream: MediaStream, mode: CameraMode): Promise<void> {
  const track = stream.getVideoTracks().at(0);
  if (track === undefined) return;
  track.contentHint = mode === "final" ? "detail" : "motion";

  const advanced = continuousQualityControls(track, mode);
  if (advanced.length === 0) return;
  // Keep the negotiated format constrained while adding driver-supported
  // controls. Advanced preferences may be skipped without losing the picture.
  await track.applyConstraints({ ...track.getConstraints(), advanced });
}

function modeConstraints(mode: CameraMode): MediaTrackConstraints[] {
  const profile = CONFIG.camera.modes[mode];
  const device = CONFIG.camera.deviceId ? { deviceId: { exact: CONFIG.camera.deviceId } } : {};

  return [
    {
      width: { exact: profile.width },
      height: { exact: profile.height },
      frameRate: {
        min: profile.minFrameRate,
        ideal: profile.frameRate,
        max: profile.frameRate,
      },
      ...device,
    },
    {
      width: { ideal: profile.width },
      height: { ideal: profile.height },
      frameRate: { ideal: profile.frameRate, max: profile.frameRate },
      ...device,
    },
  ];
}

function continuousQualityControls(
  track: MediaStreamTrack,
  mode: CameraMode,
): CameraConstraintSet[] {
  if (mode !== "final") return [];
  const capabilities = track.getCapabilities() as CameraCapabilities;
  const controls: CameraConstraintSet = {};

  if (capabilities.exposureMode?.includes("continuous")) controls.exposureMode = "continuous";
  if (capabilities.focusMode?.includes("continuous")) controls.focusMode = "continuous";
  if (capabilities.whiteBalanceMode?.includes("continuous")) {
    controls.whiteBalanceMode = "continuous";
  }

  return Object.keys(controls).length === 0 ? [] : [controls];
}

function isOverconstrained(error: unknown): boolean {
  return error instanceof Error && error.name === "OverconstrainedError";
}

function waitForFrames(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const check = (): void => {
      if (video.videoWidth > 0) {
        video.removeEventListener("loadeddata", check);
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    video.addEventListener("loadeddata", check);
    requestAnimationFrame(check);
  });
}

export function stopCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * What the browser actually negotiated, which is often not what was asked for.
 * Worth showing in the HUD: a silent fall back from 60 to 10 fps (the C922 does
 * exactly that if it lands on YUYV instead of MJPG) is otherwise invisible.
 */
export function describeStream(stream: MediaStream | null, mode: CameraMode): string {
  const track = stream?.getVideoTracks()[0];
  if (track === undefined) return "no video track";
  const { width = 0, height = 0, frameRate = 0 } = track.getSettings();
  const description = `${width}x${height}@${Math.round(frameRate)}`;
  // The camera is the ceiling on everything downstream, so a shortfall here is
  // worth a word rather than a number the reader has to compare in their head.
  return frameRate < CONFIG.camera.modes[mode].minFrameRate
    ? `${description} (below target)`
    : description;
}

/** Lists cameras. Labels are only populated after permission has been granted. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}
