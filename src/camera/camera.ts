import { CONFIG } from "../config.js";

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
export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(
      "getUserMedia is unavailable",
      "The page needs a secure context. Use http://127.0.0.1:5173 or serve over HTTPS.",
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      width: { ideal: CONFIG.camera.width },
      height: { ideal: CONFIG.camera.height },
      // `ideal` on frameRate, not `exact`: an exact 60 fails outright on a
      // camera or driver that cannot deliver it, and a working 30 fps mirror
      // beats a black screen. describeStream() reports what was negotiated.
      frameRate: { ideal: CONFIG.camera.frameRate },
      ...(CONFIG.camera.deviceId ? { deviceId: { exact: CONFIG.camera.deviceId } } : {}),
    },
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (cause) {
    throw new CameraError(
      `Could not open the camera: ${cause instanceof Error ? cause.message : String(cause)}`,
      "Check that the browser has camera permission and no other app holds the device.",
    );
  }

  video.srcObject = stream;
  video.muted = true;
  await video.play();
  await waitForFrames(video);
  return stream;
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
export function describeStream(stream: MediaStream | null): string {
  const track = stream?.getVideoTracks()[0];
  if (track === undefined) return "no video track";
  const { width = 0, height = 0, frameRate = 0 } = track.getSettings();
  return `${width}x${height}@${Math.round(frameRate)}`;
}

/** Lists cameras. Labels are only populated after permission has been granted. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}
