#!/usr/bin/env node
/**
 * Replays the pinch gate over one take on both rulers - the 2D ratio the app
 * runs on and the metric gap off the world landmarks - and says where each
 * sat while the other called the fingers closed.
 *
 * The world landmarks come either from the take itself (recorded since
 * ADR 0021) or from scripts/recover-world.py for a take made before it. A
 * recovered file is aligned to the trace by cross-correlating the 2D ratio,
 * since the video runs at the camera's rate and the trace at the loop's.
 *
 *   node scripts/pinch-rulers.mjs recordings/<take>.json [recordings/world/<take>.json] --lines N
 *
 * This is the tool behind ADR 0021's finding that the metric gap loses: it is
 * kept so the question can be asked again of a take on the 1080p profile.
 */
import { readFileSync } from "node:fs";

const HAND = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8, MIDDLE_MCP: 9, PINKY_MCP: 17 };
/** The gate as shipped; mirrors CONFIG.paint.pinch and src/interaction/pinch.ts. */
const RATIO_GATE = { closeBelow: 0.18, openAbove: 0.32, deepBelow: 0.12 };
const METRES_GATE = { closeBelow: 0.03, openAbove: 0.05, deepBelow: 0.02 };
const TIMING = { closeMs: 180, openMs: 150, deepMs: 80, lostGraceMs: 200, looseMs: 400 };

const distance2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distance3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The same measurement src/interaction/pinch.ts makes. */
function pinchRatio(landmarks, aspect) {
  const p = (i) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const size = Math.max(
    distance2(p(HAND.MIDDLE_MCP), p(HAND.WRIST)),
    distance2(p(HAND.PINKY_MCP), p(HAND.INDEX_MCP)),
  );
  return size < 1e-6 ? null : distance2(p(HAND.INDEX_TIP), p(HAND.THUMB_TIP)) / size;
}

function metresOf(world) {
  if (!Array.isArray(world) || world.length <= HAND.INDEX_TIP) return null;
  const thumb = world[HAND.THUMB_TIP];
  const index = world[HAND.INDEX_TIP];
  // Recovered files store [x, y, z]; the trace stores {x, y, z}.
  const asArray = (p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]);
  return distance3(asArray(thumb), asArray(index));
}

/** One row per trace frame, with the metric gap from the take or the recovered file. */
function rows(take, recovered) {
  const aspect = take.viewport.width / take.viewport.height;
  const trace = take.trace.map((frame) => {
    const hand = frame.hands?.[0];
    return {
      ms: frame.ms,
      ratio: hand === undefined ? null : pinchRatio(hand.landmarks, aspect),
      fist: hand?.gesture === "Closed_Fist" && hand.confidence >= 0.7,
      metres: hand === undefined ? null : metresOf(hand.world),
    };
  });
  if (recovered === null) return { rows: trace, offsetMs: 0 };

  const video = recovered.frames.map((frame) => ({
    ms: frame.ms,
    ratio:
      frame.hand === null
        ? null
        : pinchRatio(
            frame.hand.landmarks.map(([x, y]) => ({ x, y })),
            aspect,
          ),
    metres: frame.hand === null ? null : metresOf(frame.hand.world),
  }));
  const nearest = (ms) => {
    let best = null;
    for (const frame of video) {
      if (best === null || Math.abs(frame.ms - ms) < Math.abs(best.ms - ms)) best = frame;
    }
    return best !== null && Math.abs(best.ms - ms) <= 20 ? best : null;
  };
  // The recorder and MediaRecorder start a few frames apart. The ratio series
  // is the same measurement on both sides, so the offset that makes them agree
  // is the alignment.
  let offsetMs = 0;
  let bestError = Number.POSITIVE_INFINITY;
  for (let offset = -400; offset <= 400; offset += 8) {
    let error = 0;
    let count = 0;
    for (let i = 0; i < trace.length; i += 3) {
      const row = trace[i];
      const frame = row.ratio === null ? null : nearest(row.ms + offset);
      if (frame === null || frame.ratio === null) continue;
      error += Math.abs(frame.ratio - row.ratio);
      count++;
    }
    if (count > 20 && error / count < bestError) {
      bestError = error / count;
      offsetMs = offset;
    }
  }
  return {
    offsetMs,
    rows: trace.map((row) => ({ ...row, metres: nearest(row.ms + offsetMs)?.metres ?? null })),
  };
}

/** The shipped gate on whichever scalar `key` names. Returns the closed state per frame. */
function replay(frames, key, marks) {
  let closed = false;
  let pendingSince = null;
  let deepSince = null;
  let lostSince = null;
  let looseSince = null;
  const states = [];
  let lines = 0;
  for (const frame of frames) {
    const was = closed;
    const reading = frame[key];
    if (reading === null) {
      lostSince ??= frame.ms;
      if (frame.ms - lostSince >= TIMING.lostGraceMs) closed = false;
      pendingSince = null;
      deepSince = null;
    } else if (
      closed &&
      reading >= marks.closeBelow &&
      looseSince !== null &&
      frame.ms - looseSince >= TIMING.looseMs
    ) {
      // The band between the marks has a clock. See ADR 0023.
      closed = false;
      pendingSince = null;
      looseSince = null;
    } else {
      lostSince = null;
      if (closed && reading >= marks.closeBelow) looseSince ??= frame.ms;
      else looseSince = null;
      const wanted =
        frame.fist && !closed
          ? false
          : closed
            ? reading < marks.openAbove
            : reading < marks.closeBelow;
      if (!frame.fist && reading < marks.deepBelow) deepSince ??= frame.ms;
      else deepSince = null;
      if (wanted === closed) pendingSince = null;
      else {
        pendingSince ??= frame.ms;
        const deepEnough = wanted && deepSince !== null && frame.ms - deepSince >= TIMING.deepMs;
        const confirmMs = wanted ? TIMING.closeMs : TIMING.openMs;
        if (deepEnough || frame.ms - pendingSince >= confirmMs) {
          closed = wanted;
          pendingSince = null;
        }
      }
    }
    if (closed && !was) lines++;
    states.push(closed);
  }
  return { lines, states };
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const linesIndex = args.indexOf("--lines");
const expected = linesIndex === -1 ? null : Number(args[linesIndex + 1]);
if (files.length === 0) {
  console.error("usage: pinch-rulers.mjs <recording.json> [recovered-world.json] [--lines N]");
  process.exit(1);
}
const take = JSON.parse(readFileSync(files[0], "utf8"));
const recovered = files[1] === undefined ? null : JSON.parse(readFileSync(files[1], "utf8"));
const aligned = rows(take, recovered);
const withMetres = aligned.rows.filter((row) => row.metres !== null).length;
if (withMetres === 0) {
  console.error("no world landmarks: record the take again, or pass a recover-world.py file");
  process.exit(1);
}
if (recovered !== null)
  console.log(`aligned recovered video to the trace at ${aligned.offsetMs} ms`);

const byRatio = replay(aligned.rows, "ratio", RATIO_GATE);
const byMetres = replay(aligned.rows, "metres", METRES_GATE);
const want = expected === null ? "" : ` (meant ${expected})`;
console.log(`lines: ratio gate ${byRatio.lines}, metric gate ${byMetres.lines}${want}`);

// Where the metric gap sat while the ratio gate held a pinch, and while it did
// not. Two touching fingertips should read one number; the spread here is the
// finding.
const closedMm = [];
const openMm = [];
aligned.rows.forEach((row, i) => {
  if (row.metres === null || row.ratio === null) return;
  (byRatio.states[i] ? closedMm : openMm).push(row.metres * 1000);
});
const spread = (mm) =>
  mm.length === 0
    ? "no frames"
    : `p10 ${percentile(mm, 0.1).toFixed(0)} · p50 ${percentile(mm, 0.5).toFixed(0)} · p90 ${percentile(mm, 0.9).toFixed(0)} mm over ${mm.length} frames`;
console.log(`metric gap while the ratio gate was closed: ${spread(closedMm)}`);
console.log(`metric gap while it was open:               ${spread(openMm)}`);
