import { CONFIG } from "../config.js";

/**
 * The camera feed as the full-bleed background: the station is a mirror first,
 * an interface second.
 *
 * The video is flipped in CSS. Perception coordinates are already flipped in
 * the detectors, so the overlay canvas needs no transform of its own and its
 * coordinates line up with what the visitor sees.
 */
export function setupMirror(video: HTMLVideoElement): void {
  video.classList.toggle("is-mirrored", CONFIG.ui.mirrored);
}

/**
 * Sizes the canvas to its CSS box in device pixels.
 * Called on resize; cheap enough to also call once per second.
 */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
