#!/usr/bin/env node
/**
 * Distils a debug recording into a pinch take: the numbers the gate reads, and
 * nothing else.
 *
 * A recording is personal data - it is video of whoever was standing there - so
 * it never leaves the machine. What CONFIG.paint.pinch is tuned from is not the
 * video though: it is one scalar per frame, the thumb-to-index gap over the
 * hand's own size, plus the gesture label. That carries no image, no position,
 * no face and no identity, so it can be committed, and once it is committed the
 * gate can be replayed against a real hand in a unit test instead of retuned by
 * guess. See docs/adr/0019-pinch-takes-as-a-corpus.md.
 *
 *   node scripts/pinch-corpus.mjs <recording.json> --lines 3 --means "..."
 *   node scripts/pinch-corpus.mjs --list
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const CORPUS = join("tests", "fixtures", "pinch-takes");
const RECORDINGS = "recordings";

const HAND = {
  WRIST: 0,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  PINKY_MCP: 17,
};

/**
 * The same measurement src/interaction/pinch.ts makes, in the same isotropic
 * units. Kept here rather than imported because this is a plain node script and
 * the source is TypeScript; the test that consumes the corpus imports the real
 * one, so a divergence would show up there rather than hide.
 */
function pinchRatio(landmarks, aspect) {
  const p = (i) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = Math.max(
    d(p(HAND.MIDDLE_MCP), p(HAND.WRIST)),
    d(p(HAND.PINKY_MCP), p(HAND.INDEX_MCP)),
  );
  if (size < 1e-6) return null;
  return d(p(HAND.INDEX_TIP), p(HAND.THUMB_TIP)) / size;
}

/**
 * The hand's size, as a fraction of the frame height: the larger of palm length
 * and palm width, in the isotropic units the ratio is divided by. It is the
 * gate's distance ruler - under CONFIG.paint.pinch.farBelow a line may start on
 * the nearest-pair reading - so a take has to carry it for the replay to apply
 * the same rule. See ADR 0024.
 */
function handSize(landmarks, aspect) {
  const p = (i) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return Math.max(d(p(HAND.MIDDLE_MCP), p(HAND.WRIST)), d(p(HAND.PINKY_MCP), p(HAND.INDEX_MCP)));
}

/**
 * The metric gap, in metres, off the world landmarks a take has carried since
 * ADR 0021. Null on older takes. Four places is a tenth of a millimetre.
 */
function pinchGapMetres(world) {
  if (!Array.isArray(world) || world.length <= HAND.INDEX_TIP) return null;
  const a = world[HAND.THUMB_TIP];
  const b = world[HAND.INDEX_TIP];
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * What a line is held on: the nearest of three thumb-to-index pairs over the
 * hand's size. Mirrors pinchHoldRatio in src/interaction/pinch.ts. See ADR 0022.
 */
function pinchHoldRatio(landmarks, aspect) {
  const p = (i) => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const size = Math.max(
    d(p(HAND.MIDDLE_MCP), p(HAND.WRIST)),
    d(p(HAND.PINKY_MCP), p(HAND.INDEX_MCP)),
  );
  if (size < 1e-6) return null;
  return (
    Math.min(
      d(p(HAND.THUMB_TIP), p(HAND.INDEX_TIP)),
      d(p(HAND.THUMB_TIP), p(HAND.INDEX_DIP)),
      d(p(HAND.THUMB_IP), p(HAND.INDEX_TIP)),
    ) / size
  );
}

function distil(file, meta) {
  const take = JSON.parse(readFileSync(file, "utf8"));
  const aspect = take.viewport.width / take.viewport.height;
  const frames = take.trace.map((f) => {
    const hand = f.hands?.[0];
    if (hand === undefined) return { t: round(f.ms, 1), ratio: null };
    const ratio = pinchRatio(hand.landmarks, aspect);
    const frame = { t: round(f.ms, 1), ratio: ratio === null ? null : round(ratio, 4) };
    const hold = pinchHoldRatio(hand.landmarks, aspect);
    if (hold !== null) frame.hold = round(hold, 4);
    frame.size = round(handSize(hand.landmarks, aspect), 4);
    const metres = pinchGapMetres(hand.world);
    if (metres !== null) frame.metres = round(metres, 4);
    if (hand.gesture !== "None") {
      frame.gesture = hand.gesture;
      // Four places, the same as the trace itself. Two is not enough: a
      // confidence of 0.6997 rounds to 0.70 and crosses
      // CONFIG.interaction.minGestureConfidence, which turned one frame of
      // "not a fist" into a fist and cost a line in the replay. A fixture that
      // rounds through a threshold is a fixture that lies. See friction 0030.
      frame.confidence = round(hand.confidence, 4);
    }
    return frame;
  });
  return {
    name: meta.name,
    means: meta.means,
    lines: meta.lines,
    source: basename(file, ".json"),
    camera: take.camera?.source ?? "unknown",
    // "debug" until ADR 0021 split the view from the profile; a take on the
    // visitor's 1080p profile says "final" here and is the one that counts.
    profile: take.camera?.mode ?? "unknown",
    frames,
  };
}

const round = (n, places) => Number(n.toFixed(places));

/** One frame per line: a few thousand of them, and a diff that reads. */
function serialise(take) {
  const { frames, ...head } = take;
  const lines = frames.map((f) => `  ${JSON.stringify(f)}`).join(",\n");
  return `${JSON.stringify(head, null, 1).replace(/\n}$/, ",")}\n "frames": [\n${lines}\n ]\n}\n`;
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const f of readdirSync(RECORDINGS).filter((f) => f.endsWith(".json"))) {
    const take = JSON.parse(readFileSync(join(RECORDINGS, f), "utf8"));
    console.log(`${f}\n   ${take.trace.length} frames · ${take.task?.note ?? "(no note)"}`);
  }
  process.exit(0);
}

const [file] = args;
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
if (file === undefined || flag("lines") === undefined || flag("means") === undefined) {
  console.error("usage: pinch-corpus.mjs <recording.json> --lines N --means '...' [--name x]");
  process.exit(1);
}
const name = flag("name") ?? basename(file, ".json").replace(/-20\d\d-.*$/, "");
const out = join(CORPUS, `${name}.json`);
writeFileSync(
  out,
  serialise(distil(file, { name, means: flag("means"), lines: Number(flag("lines")) })),
);
console.log(`wrote ${out}`);
