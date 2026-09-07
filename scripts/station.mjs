/**
 * The station's command line: one tool for every question this project asks of
 * a running mirror.
 *
 *   npm run station -- state                 what the app currently thinks
 *   npm run station -- shoot out.png --crop menu --zoom 3
 *   npm run station -- watch "expr" --seconds 20 --shoot-when "expr"
 *   npm run station -- probe .countdown__ring --ring
 *   npm run station -- perf --css ".tile{backdrop-filter:none!important}"
 *   npm run station -- puppet wave | point | victory | palm | both | stroke | sweep | fist | dive | stop
 *   npm run station -- puppet hold --at 0.5,0.5 [--pinch 1] [--gesture Open_Palm] [--scale 0.12]
 *   npm run station -- puppet hold --chip color-2 | --tile paint  [--pinch 1]
 *   npm run station -- record 6 [--name "hand lost when backlit" --note "..."]
 *   npm run station -- record save --name "..." | record discard
 *   npm run station -- record 6 --task latest --step next --note "what happened"
 *   npm run station -- verify
 *   npm run station -- say "stop"
 *   npm run station -- focus
 *
 * Everything attaches to the Chrome that ./start.sh already opened. Nothing
 * here ever launches a browser: /dev/video0 allows exactly one owner, and a
 * second one is how a debugging session turns into a broken station.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { args, attach, sleep } from "./lib/cdp.mjs";

const NAMED_REGIONS = {
  menu: { selector: "#dock", pad: 70 },
  tile: { selector: ".tile", pad: 34 },
  countdown: { selector: ".countdown__dial", pad: 60 },
  status: { selector: "#capture-status", pad: 34 },
  hud: { selector: "#hud", pad: 12 },
  recorder: { selector: "#recorder", pad: 16 },
  tasks: { selector: "#tasks", pad: 16 },
  dialog: { selector: "#recorder-dialog", pad: 16 },
  tray: { selector: "#paint-tray", pad: 40 },
  /** Where the built-in paint scenarios draw: the middle of the mirror. */
  stroke: {
    expression:
      "({ x: innerWidth * 0.2, y: innerHeight * 0.34, width: innerWidth * 0.6, height: innerHeight * 0.34 })",
  },
};

/**
 * Module constants live up here, above the top-level await that runs the
 * command. Function declarations below it are hoisted; a `const` below it is
 * still in its temporal dead zone when the command runs, and reading one throws
 * "cannot access before initialization" from inside whichever check touched it.
 */

/** The name `verify` gives its own take, so the cleanup can recognise it. */
const VERIFY_RECORDING_NAME = "verify debug recorder";

/** The task `verify` writes for itself, and removes again. */
const VERIFY_TASK = {
  id: "verify-task-flow",
  title: "verify task flow",
  description: "Written and removed by npm run verify.",
  createdAt: new Date().toISOString(),
  status: "open",
  steps: [{ id: "s1", instruction: "Hold a hand up for a second.", runs: [] }],
};

/** What the browser computed for the recorder, not what the app believes. */
const RECORDER_DISPLAY = "getComputedStyle(document.getElementById('recorder')).display";

const parsed = args();
const [command = "state", ...rest] = parsed.positional;

const commands = {
  state: cmdState,
  camera: cmdCamera,
  view: cmdView,
  shoot: cmdShoot,
  watch: cmdWatch,
  probe: cmdProbe,
  perf: cmdPerf,
  puppet: cmdPuppet,
  record: cmdRecord,
  say: cmdSay,
  verify: cmdVerify,
  focus: cmdFocus,
};

const run = commands[command];
if (run === undefined) {
  console.error(`Unknown command "${command}". Try: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

const cdp = await attach();
try {
  await run(cdp, rest);
} finally {
  cdp.close();
}

// ---------------------------------------------------------------- commands --

async function cmdState(cdp) {
  if (parsed.has("reload")) await cdp.reload();
  const snapshot = await cdp.snapshot();
  if (parsed.has("json")) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }
  printState(snapshot);
}

/**
 * Switches the camera profile and nothing else. `camera final` from the debug
 * view is how the recorder gets to see the 1080p/30 the visitor gets, which
 * before ADR 0021 it could not: D chose the profile and the view together, so
 * every take ever recorded was 720p. Prints what the camera then negotiated,
 * because that is the number a take will be judged by.
 */
async function cmdCamera(cdp, [mode]) {
  if (mode !== "debug" && mode !== "final") {
    console.error("usage: station camera <debug|final>   (debug is 720p/60, final 1080p/30)");
    process.exit(1);
  }
  await cdp.evaluate(`window.__station.camera.use(${JSON.stringify(mode)})`);
  await cdp.waitFor(`document.body.dataset.cameraMode === ${JSON.stringify(mode)}`, {
    timeoutMs: 20_000,
    what: `the camera to reopen on the ${mode} profile`,
  });
  await cdp.waitFor("document.body.classList.contains('is-live')", { timeoutMs: 20_000 });
  await sleep(300);
  const s = await cdp.snapshot();
  console.log(
    `[camera] ${s.camera.mode} profile · negotiated ${s.camera.source} · view ${s.camera.view}`,
  );
  if (s.camera.error != null) console.log(`[camera]  ⚠ ${s.camera.error}`);
}

/** Puts the instruments on the glass or takes them off, leaving the camera as it is. */
async function cmdView(cdp, [view]) {
  if (view !== "debug" && view !== "final") {
    console.error("usage: station view <debug|final>");
    process.exit(1);
  }
  await cdp.evaluate(`window.__station.view.set(${JSON.stringify(view)})`);
  await cdp.waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, {
    timeoutMs: 5000,
    what: `the ${view} view`,
  });
  const s = await cdp.snapshot();
  console.log(`[view] ${s.camera.view} view · camera ${s.camera.mode} ${s.camera.source}`);
}

async function cmdShoot(cdp, [out = "captures/station.png"]) {
  if (parsed.has("reload")) await cdp.reload();
  const puppet = parsed.get("puppet", null);
  if (typeof puppet === "string") await armPuppet(cdp, puppet);

  const keys = String(parsed.get("keys", "")).split(",").filter(Boolean);
  if (keys.length > 0) await cdp.keys(keys);

  const after = parsed.get("after", null);
  if (typeof after === "string") await cdp.waitFor(after);
  await sleep(parsed.number("settle", 0));

  const clip = await resolveClip(cdp, parsed.get("crop", null), parsed.number("zoom", 1));
  const file = await capture(cdp, out, clip);
  console.log(
    `[station] ${file}${clip === null ? "" : ` (crop ${parsed.get("crop")} x${clip.scale})`}`,
  );
  printState(await cdp.snapshot());
}

async function cmdWatch(cdp, [raw]) {
  if (raw === undefined) throw new Error("watch needs an expression");
  const expression = pageExpression(raw);
  const seconds = parsed.number("seconds", 20);
  const shootWhen = parsed.get("shoot-when", null);
  const out = parsed.get("out", "captures/watch.png");
  const deadline = Date.now() + seconds * 1000;
  const samples = [];
  let shot = false;

  while (Date.now() < deadline) {
    const value = await cdp.evaluate(expression);
    if (typeof value === "number") samples.push(value);
    if (!shot && typeof shootWhen === "string" && (await cdp.evaluate(pageExpression(shootWhen)))) {
      await capture(
        cdp,
        out,
        await resolveClip(cdp, parsed.get("crop", null), parsed.number("zoom", 1)),
      );
      shot = true;
      console.log(`[watch] fired at ${JSON.stringify(value)} -> ${out}`);
    }
    await sleep(parsed.number("every", 60));
  }

  if (samples.length > 0) {
    const sorted = [...samples].sort((a, b) => a - b);
    console.log(
      `[watch] n=${samples.length} min=${fmt(sorted[0])} median=${fmt(sorted[Math.floor(sorted.length / 2)])} max=${fmt(sorted.at(-1))}`,
    );
  }
  if (typeof shootWhen === "string" && !shot) console.log("[watch] the trigger never fired");
}

/**
 * Samples the rendered pixels of an element. Reading the CSS back would only
 * repeat whatever misunderstanding produced it; this looks at what Chrome drew.
 * See docs/frictions/0004.
 */
async function cmdProbe(cdp, [selector = ".tile"]) {
  const box = await cdp.evaluate(boxExpression(selector, 0));
  if (box === null) throw new Error(`no element matches ${selector}`);
  console.log(
    `[probe] ${selector}  ${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}`,
  );

  const styles = String(parsed.get("style", "")).split(",").filter(Boolean);
  if (styles.length > 0) {
    const values = await cdp.evaluate(
      `(() => { const s = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
        return ${JSON.stringify(styles)}.map((p) => [p, s.getPropertyValue(p)]); })()`,
    );
    for (const [property, value] of values) console.log(`[probe]   ${property}: ${value}`);
  }

  if (parsed.has("ring")) {
    const samples = await sampleRing(cdp, box, parsed.number("points", 72));
    console.log(`[probe] ${describeArc(samples)}`);
  }
}

async function cmdPerf(cdp) {
  const seconds = parsed.number("seconds", 8);
  const cases = [["as-is", ""]];
  const css = parsed.get("css", null);
  if (typeof css === "string") cases.push(["override", css]);
  if (parsed.has("glass")) {
    cases.push(
      ["plain blur, no lens", ".tile,.glass{backdrop-filter:blur(9px) saturate(1.8)!important}"],
      ["no backdrop-filter", ".glass,.tile__hint{backdrop-filter:none!important}"],
      ["menu hidden", "#experience{display:none!important}"],
    );
  }

  // Try to fix the throttle rather than only reporting it.
  await cdp.send("Page.bringToFront");
  await sleep(600);
  const first = await cdp.snapshot();
  if (throttleWarning(first) !== "") {
    console.log(
      `[perf] ${throttleWarning(first).trim()}\n` +
        "[perf] Bring the station window to the front before believing any of this.",
    );
  }

  for (const [label, override] of cases) {
    await cdp.evaluate(styleOverride(override));
    await sleep(2000); // let the compositor settle before believing anything
    const samples = [];
    for (let i = 0; i < seconds * 4; i++) {
      const { camera } = await cdp.snapshot();
      if (camera.fps > 0) samples.push(camera.fps);
      await sleep(250);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `[perf] ${label.padEnd(22)} median ${fmt(samples[Math.floor(samples.length / 2)])} fps  (min ${fmt(samples[0])}, max ${fmt(samples.at(-1))}, n=${samples.length})`,
    );
  }
  await cdp.evaluate(styleOverride(""));
}

/**
 * Brings the station window to the front and reports whether it worked.
 *
 * Chrome throttles a page nobody is looking at, so every frame rate measured
 * on an unfocused window is a measurement of the throttle. There was no way to
 * fix that from the command line, and the machine has neither xdotool nor
 * wmctrl, so the fix was an ad-hoc CDP script every time. See friction 0012.
 */
async function cmdFocus(cdp) {
  await cdp.send("Page.bringToFront");
  await sleep(600);
  const s = await cdp.snapshot();
  const ok = s.visibility.state === "visible" && s.visibility.focused;
  console.log(
    `[focus] window ${s.visibility.state}, ${s.visibility.focused ? "focused" : "UNFOCUSED"}` +
      `${ok ? " - frame rates are now worth reading" : " - frame rates are still throttled"}`,
  );
  if (!ok) {
    console.log("[focus] bringToFront did not take. Click the station window before measuring.");
  }
  printState(s);
}

async function cmdPuppet(cdp, [name = "stop"]) {
  if (name === "stop") {
    await cdp.evaluate("window.__station.puppet.stop()");
    console.log("[puppet] stopped; the detectors have the frame loop back");
    return;
  }
  if (name === "hold") {
    // One hand, parked. Aimed at a chip or a tile by name, so a capture of a
    // ring mid-fill does not start with somebody reading rectangles off a
    // snapshot; or at a point, for the brush cursor over open mirror.
    const hand = { at: await holdTarget(cdp) };
    if (parsed.has("pinch")) {
      hand.pinch = parsed.number("pinch", 1);
      hand.anchor = "pinch";
    } else if (parsed.has("chip")) {
      hand.anchor = "pinch";
    }
    if (parsed.has("gesture")) hand.gesture = String(parsed.get("gesture"));
    // The fixture's default scale is a hand at arm's length; 0.12 is one about
    // two metres back, small enough for the gate's far rule. See ADR 0024.
    if (parsed.has("scale")) hand.scale = parsed.number("scale", 0.22);
    await holdPose(cdp, [hand]);
    console.log(`[puppet] holding ${JSON.stringify(hand)}`);
    printState(await cdp.snapshot());
    return;
  }
  await armPuppet(cdp, name);
  console.log(`[puppet] playing "${name}"`);
  if (parsed.has("wait")) {
    await cdp.waitFor("window.__station.puppet.finished()", { what: "the scenario to finish" });
    console.log("[puppet] finished");
  }
  printState(await cdp.snapshot());
}

/**
 * Puts words in the station's ear without a microphone.
 *
 * They arrive marked `injected`, in the snapshot and in any recording's trace,
 * because a check that passes this way says the wiring works and says nothing
 * whatever about whether the speech model can hear. Same rule as the puppet's.
 * See ADR 0011 and ADR 0016.
 */
async function cmdSay(cdp, words) {
  const text = words.join(" ");
  if (text === "") throw new Error('say needs something to say: station say "stop"');
  // As JSON data, never interpolated as code. See docs/frictions/0010.
  await cdp.evaluate(`window.__station.say(${JSON.stringify(text)})`);
  console.log(`[say] "${text}" (injected, not heard)`);
  await sleep(200);
  printState(await cdp.snapshot());
}

/**
 * Records a debug video without a mouse, which the corner control otherwise
 * needs. The recorder lives in debug camera mode, so this switches the station
 * there if it has to and puts it back afterwards: a mirror in a hallway should
 * not be left showing the developer view because somebody took a recording.
 *
 * With --name it saves the take itself. Without one it stops and leaves the
 * dialog standing, so the person who saw the bug is the one who describes it.
 *
 * The take is real camera footage of whoever was in front of the station. It is
 * written to the gitignored recordings/ directory and nothing here deletes it.
 */
async function cmdRecord(cdp, [first, ...rest]) {
  if (first === "save" || first === "discard") return cmdRecordFinish(cdp, first);
  const rawSeconds = first ?? rest[0];
  const config = await cdp.config();
  const capMs = config.recording.maxMs;
  const seconds = Math.min(Number(rawSeconds ?? parsed.number("seconds", 5)), capMs / 1000);
  const name = parsed.get("name", null);
  const note = parsed.get("note", null);
  const wantedTask = parsed.get("task", null);

  const before = await cdp.snapshot();
  // The view, not the camera profile. A take is recorded on whichever profile
  // the camera is on, so `station camera final` first gives a 1080p take; the
  // old way here pressed D, which also dropped the camera to 720p. ADR 0021.
  const restore = before.camera.view;
  if (restore !== "debug") {
    await cdp.evaluate('window.__station.view.set("debug")');
    await cdp.waitFor("document.body.dataset.view === 'debug'", {
      timeoutMs: 5000,
      what: "the station to show the debug view",
    });
    console.log("[record] switched the station to the debug view; it will go back afterwards");
  }
  console.log(`[record] camera ${before.camera.mode} profile · ${before.camera.source}`);

  if (typeof wantedTask === "string") {
    // Through the panel, not around it: the step's own button is what a person
    // presses, so it is what this presses.
    await cdp.evaluate("window.__station.tasks.refresh()");
    const step = await pickStep(cdp, wantedTask, parsed.get("step", "next"));
    await cdp.evaluate(
      `window.__station.tasks.record(${JSON.stringify(step.taskId)}, ${JSON.stringify(step.stepId)})`,
    );
    console.log(`[record] answering ${step.taskId} ${step.stepId}`);
  } else {
    await cdp.evaluate("window.__station.recorder.start()");
  }
  await cdp.waitFor("window.__station.snapshot().recording.phase === 'recording'", {
    timeoutMs: 5000,
    what: "the recorder to start",
  });
  console.log(`[record] recording ${seconds} s of what the models are being given`);
  await sleep(seconds * 1000);

  await cdp.evaluate("window.__station.recorder.stop()");
  await cdp.waitFor("window.__station.snapshot().recording.phase === 'naming'", {
    timeoutMs: 15_000,
    what: "the take to finish encoding",
  });
  const shot = await cdp.snapshot();
  console.log(
    `[record] ${shot.recording.samples} perception frames · ` +
      `camera ${shot.camera.source} · ${shot.perceptionSource} hands`,
  );

  // A take answering a step already has its name; only the note is left to say.
  // Without the words it needs, the dialog is left standing for whoever is at
  // the station, which is the normal way round when a person did the step.
  const words = typeof wantedTask === "string" ? note : name;
  if (typeof words !== "string") {
    const missing = typeof wantedTask === "string" ? "--note" : "--name";
    console.log(`[record] the dialog at the station is waiting; pass ${missing} to save from here`);
    return; // Leaving the mode alone: the dialog is on the debug view.
  }

  // As JSON data, never interpolated as code. See docs/frictions/0010.
  const filename = await cdp.evaluate(
    `window.__station.recorder.save(${JSON.stringify(name ?? "")}, ${JSON.stringify(note ?? "")})`,
  );
  console.log(`[record] recordings/${filename}`);
  console.log(`[record] recordings/${String(filename).replace(/\.webm$/, ".json")}`);
  if (typeof wantedTask === "string") {
    console.log("[record] filed against the step; read it with npm run task -- show");
  }

  if (restore !== "debug") await returnTo(cdp, restore);
}

async function returnTo(cdp, view) {
  await cdp.evaluate(`window.__station.view.set(${JSON.stringify(view)})`);
  await cdp.waitFor(`document.body.dataset.view === ${JSON.stringify(view)}`, {
    timeoutMs: 5000,
    what: "the station to go back to the view it was in",
  });
}

/** Resolves `--task latest|<fragment>` and `--step next|<id>` off the snapshot. */
async function pickStep(cdp, wanted, wantedStep) {
  const { tasks } = await cdp.snapshot();
  const open = tasks.showing.filter((task) => task.status !== "dismissed");
  if (open.length === 0) throw new Error("the station is showing no tasks");
  const task =
    wanted === "latest" || wanted === true
      ? open.at(-1)
      : open.find((candidate) => candidate.id.includes(String(wanted)));
  if (task === undefined) throw new Error(`no task on the mirror matches "${wanted}"`);

  const step =
    wantedStep === "next" || wantedStep === true
      ? (task.steps.find((candidate) => !candidate.answered) ?? task.steps[0])
      : task.steps.find((candidate) => candidate.id === wantedStep);
  if (step === undefined) throw new Error(`task ${task.id} has no step "${wantedStep}"`);
  return { taskId: task.id, stepId: step.id };
}

/**
 * Names or bins the take that is already waiting at the station, for whoever
 * stopped the recording at the glass and would rather type at a keyboard than
 * into a dialog on a wall.
 */
async function cmdRecordFinish(cdp, action) {
  const state = (await cdp.snapshot()).recording;
  if (state.phase !== "naming") {
    throw new Error(`nothing is waiting to be saved; the recorder is ${state.phase}`);
  }
  if (action === "discard") {
    await cdp.evaluate("window.__station.recorder.discard()");
    console.log("[record] discarded");
    return;
  }
  // A take that answers a step is named after the step, so only the note is
  // missing; an untasked one still needs a name from somewhere.
  const name = parsed.get("name", null);
  if (state.task === null && typeof name !== "string") {
    throw new Error("record save needs --name");
  }
  const note = String(parsed.get("note", ""));
  // As JSON data, never interpolated as code. See docs/frictions/0010.
  const filename = await cdp.evaluate(
    `window.__station.recorder.save(${JSON.stringify(name ?? "")}, ${JSON.stringify(note)})`,
  );
  console.log(`[record] recordings/${filename}`);
  console.log(`[record] recordings/${String(filename).replace(/\.webm$/, ".json")}`);
  if (state.task !== null) {
    console.log(`[record] filed against ${state.task.taskId} ${state.task.stepId}`);
  }
}

// ------------------------------------------------------------- the harness --

/**
 * Drives every interaction the station has and checks what came out, in about
 * half a minute, with no human in front of the camera.
 *
 * What it proves: the interaction logic, the renderer and the wiring between
 * them. What it cannot prove: that MediaPipe recognises a Victory sign, because
 * the hands are ours. Camera claims need a camera. See ADR 0011.
 */
async function cmdVerify(cdp) {
  // A covered window processes no frames, so every check below would fail for a
  // reason that has nothing to do with the code. Say so once instead of
  // nineteen times. See friction 0022.
  await cdp.send("Page.bringToFront");
  await sleep(600);
  const before = await cdp.snapshot();
  if (stalledWarning(before) !== "") {
    console.error(
      `[verify] ${stalledWarning(before)
        .trim()
        .replace(/\[state\]\s*/g, "\n  ")}`,
    );
    console.error("[verify] refusing to run: nothing here would mean anything.");
    process.exitCode = 1;
    return;
  }

  const outDir = String(parsed.get("out", "captures/verify"));
  const picturesBefore = await pictureFiles();
  const recordingsBefore = await recordingFiles();
  const config = await cdp.config();
  const results = [];

  for (const check of checks(config)) {
    const started = Date.now();
    let result;
    try {
      result = (await check.run(cdp)) ?? { ok: true };
    } catch (error) {
      result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (!parsed.has("no-shots")) {
      await capture(
        cdp,
        join(outDir, `${check.name}.png`),
        await resolveClip(cdp, check.crop ?? null, 2),
      );
    }
    results.push({ ...result, name: check.name, ms: Date.now() - started });
    console.log(
      `${result.ok ? "  ok  " : " FAIL "} ${check.name.padEnd(26)} ${String(Date.now() - started).padStart(5)} ms  ${result.detail ?? ""}`,
    );
  }

  await cdp.evaluate("window.__station.puppet.stop()");

  // Exercising the shutter writes real photographs. These ones are ours: the
  // puppet held the frame loop for the whole run and nothing else fired the
  // shutter. Removing exactly the delta is what friction 0008 asked for.
  const after = await pictureFiles();
  const mine = after.filter((file) => !picturesBefore.includes(file));
  for (const file of mine) await rm(join("captures", file));
  if (mine.length > 0)
    console.log(`\n[verify] removed ${mine.length} picture(s) taken by this run`);

  // Same rule for the recorder check, and it matters more: a debug recording is
  // seconds of video of whoever was standing there. See docs/frictions/0008.
  const myPrefixes = [slugify(VERIFY_RECORDING_NAME), slugify(VERIFY_TASK.title)];
  const myRecordings = (await recordingFiles()).filter(
    (f) => !recordingsBefore.includes(f) && myPrefixes.some((prefix) => f.startsWith(prefix)),
  );
  for (const file of myRecordings) await rm(join("recordings", file));
  if (myRecordings.length > 0)
    console.log(`[verify] removed ${myRecordings.length} recording file(s) taken by this run`);

  // The task it wrote for itself goes too. A task nobody asked for, left on the
  // mirror, is the debug view lying about what is outstanding.
  await rm(join("tasks", `${VERIFY_TASK.id}.json`), { force: true });
  await cdp.evaluate("window.__station.tasks.refresh()").catch(() => undefined);

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n[verify] ${results.length - failed.length}/${results.length} passed` +
      (parsed.has("no-shots") ? "" : `, screenshots in ${outDir}/`),
  );
  if (failed.length > 0) process.exitCode = 1;
}

function checks(config) {
  const idle = config.ui.menu.idle.amplitude;
  const dwellMs = config.cursor.dwellMs;
  const holdMs = config.interaction.gestureHoldMs;

  return [
    {
      name: "starts-at-home",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        const state = await cdp.snapshot();
        return {
          ok: state.experience.mode === "home" && state.menu.panels.length === 2,
          detail: `mode=${state.experience.mode} panels=${state.menu.panels.length}`,
        };
      },
    },
    {
      name: "no-visible-text",
      crop: "menu",
      async run(cdp) {
        const { visibleText } = await cdp.snapshot();
        return {
          ok: visibleText.length === 0,
          detail: visibleText.length === 0 ? "none" : `found ${JSON.stringify(visibleText)}`,
        };
      },
    },
    {
      name: "every-mode-has-an-icon",
      crop: "menu",
      async run(cdp) {
        const icons = await cdp.evaluate(
          `[...document.querySelectorAll('.tile')].map((t) => ({
             mode: t.dataset.mode,
             icon: t.querySelector('.tile__icon svg') !== null,
             label: t.getAttribute('aria-label') ?? '',
           }))`,
        );
        const bad = icons.filter((i) => !i.icon || i.label === "");
        return { ok: bad.length === 0, detail: JSON.stringify(icons.map((i) => i.mode)) };
      },
    },
    {
      name: "a-wave-moves-the-menu",
      crop: "menu",
      async run(cdp) {
        await armPuppet(cdp, "wave");
        let peak = 0;
        for (let i = 0; i < 40; i++) {
          const { menu } = await cdp.snapshot();
          for (const panel of menu.panels)
            peak = Math.max(peak, Math.hypot(panel.offset.x, panel.offset.y));
          await sleep(40);
        }
        const idlePx = idle * (await cdp.evaluate("window.innerHeight"));
        return {
          ok: peak > idlePx * 3,
          detail: `peak ${peak.toFixed(1)} px vs ${idlePx.toFixed(1)} px of idle drift`,
        };
      },
    },
    {
      name: "the-menu-settles-back",
      crop: "menu",
      async run(cdp) {
        await armPuppet(cdp, "empty");
        await sleep(1400);
        const { menu } = await cdp.snapshot();
        const idlePx = idle * (await cdp.evaluate("window.innerHeight"));
        const worst = Math.max(...menu.panels.map((p) => Math.hypot(p.offset.x, p.offset.y)));
        return { ok: worst <= idlePx * 1.6, detail: `${worst.toFixed(1)} px from rest` };
      },
    },
    {
      name: "the-light-follows-the-hand",
      crop: "menu",
      async run(cdp) {
        const { menu } = await cdp.snapshot();
        const target = centreOf(menu.panels[0]);
        await holdPose(cdp, [{ at: target, gesture: "Pointing_Up" }]);
        await sleep(700);
        const lit = await cdp.snapshot();
        const [near, far] = lit.menu.panels;
        return {
          ok: near.glow > 0.5 && near.glow > far.glow,
          detail: `near ${near.glow.toFixed(2)} · far ${far.glow.toFixed(2)}`,
        };
      },
    },
    {
      name: "dwell-selects-a-tile",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        const { menu } = await cdp.snapshot();
        await holdPose(cdp, [{ at: centreOf(menu.panels[0]), gesture: "Pointing_Up" }]);
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'picture'", {
          timeoutMs: dwellMs * 4,
          what: "a dwell to open Picture mode",
        });
        return { ok: true, detail: `within ${dwellMs * 4} ms` };
      },
    },
    {
      name: "victory-opens-picture",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        await armPuppet(cdp, "victory");
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'picture'", {
          timeoutMs: holdMs * 4,
          what: "a held Victory to open Picture mode",
        });
        return { ok: true, detail: `within ${holdMs * 4} ms` };
      },
    },
    {
      name: "the-badge-teaches-the-gesture",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        const before = await badgePath(cdp);
        await cdp.keys(["p"]);
        await sleep(200);
        const after = await badgePath(cdp);
        return { ok: before !== after && before !== "" && after !== "", detail: "peace -> palm" };
      },
    },
    {
      name: "palm-fires-the-shutter",
      crop: "countdown",
      async run(cdp) {
        await armPuppet(cdp, "palm");
        await cdp.waitFor("document.body.dataset.picturePhase === 'countdown'", {
          timeoutMs: holdMs * 4,
          what: "a held palm to start the countdown",
        });
        await cdp.waitFor("+window.__station.snapshot().picture.countdown > 0.4", {
          timeoutMs: 4000,
          what: "the countdown ring to fill",
        });
        return { ok: true };
      },
    },
    {
      name: "the-ring-fills-clockwise",
      crop: "countdown",
      async run(cdp) {
        // Measured mid-fill on purpose: an arc at 3% or 97% starts and ends in
        // the same place whichever way it runs, which is how three backwards
        // rings shipped in the first place. See docs/frictions/0004.
        await cdp.waitFor(
          "(() => { const p = window.__station.snapshot().picture.countdown; return p > 0.3 && p < 0.8; })()",
          { timeoutMs: 8000, what: "the countdown to be somewhere in the middle" },
        );
        const box = await cdp.evaluate(boxExpression(".countdown__ring", 0));
        const samples = await sampleRing(cdp, box, 72);
        const arc = arcOf(samples);
        return {
          ok: arc !== null && arc.startDeg <= 12 && arc.sweepDeg > 60 && arc.sweepDeg < 300,
          detail: arc === null ? "no filled arc found" : describeArc(samples),
        };
      },
    },
    {
      name: "the-picture-is-saved",
      crop: "status",
      async run(cdp) {
        await cdp.waitFor("window.__station.snapshot().picture.statusVisible", {
          timeoutMs: 12_000,
          what: "the saved confirmation",
        });
        const state = await cdp.snapshot();
        return {
          ok: state.experience.phase === "saved",
          detail: `phase=${state.experience.phase}`,
        };
      },
    },
    {
      name: "dwell-opens-paint",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        const { menu } = await cdp.snapshot();
        const paintTile = menu.panels.find((p) => p.id === "paint");
        await holdPose(cdp, [{ at: centreOf(paintTile), gesture: "Pointing_Up" }]);
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'paint'", {
          timeoutMs: dwellMs * 4,
          what: "a dwell to open Paint mode",
        });
        // Computed style for both, not the flag the app set. See friction 0019.
        const state = await cdp.snapshot();
        const tray = await cdp.evaluate(
          "getComputedStyle(document.getElementById('paint-tray-anchor')).display",
        );
        const { width, height } = state.paint.canvas;
        return {
          ok:
            state.paint.visible &&
            width > 0 &&
            height > 0 &&
            tray !== "none" &&
            state.paint.tray.length === 11,
          detail: `canvas ${state.paint.visible ? "shown" : "hidden"} ${width}x${height} · tray display ${tray} · ${state.paint.tray.length} chips`,
        };
      },
    },
    {
      name: "a-pinch-paints-a-line",
      crop: "stroke",
      async run(cdp) {
        const before = await cdp.evaluate("window.__station.paint.painted()");
        await armPuppet(cdp, "stroke");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const state = await cdp.snapshot();
        const painted = await cdp.evaluate("window.__station.paint.painted()");
        // A pixel on the path, read off the canvas: the stroke is there and it
        // is the colour that was current.
        const pixel = await samplePaint(cdp, await midpointOfStroke(cdp));
        const wanted = hexToRgb(config.paint.colors[config.paint.defaultColor]);
        return {
          ok:
            state.paint.status?.strokes === 1 &&
            painted > before &&
            pixel[3] > 200 &&
            colourClose(pixel, wanted),
          detail: `${state.paint.status?.strokes} stroke(s) · ${painted - before} px painted · pixel ${JSON.stringify(pixel)} wanted ${JSON.stringify(wanted)}`,
        };
      },
    },
    {
      name: "an-open-hand-paints-nothing",
      crop: "stroke",
      async run(cdp) {
        const before = await cdp.evaluate("window.__station.paint.painted()");
        const strokes = (await cdp.snapshot()).paint.status?.strokes;
        await armPuppet(cdp, "sweep");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const after = await cdp.evaluate("window.__station.paint.painted()");
        const state = await cdp.snapshot();
        return {
          ok: after === before && state.paint.status?.strokes === strokes,
          detail: `${after - before} px changed · strokes ${strokes} -> ${state.paint.status?.strokes}`,
        };
      },
    },
    {
      name: "a-fist-paints-nothing",
      crop: "stroke",
      async run(cdp) {
        // The fixture's fist has its tips together, so the ratio alone would
        // call it a pinch; the label is what says it is not.
        const before = await cdp.evaluate("window.__station.paint.painted()");
        const strokes = (await cdp.snapshot()).paint.status?.strokes;
        await armPuppet(cdp, "fist");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const after = await cdp.evaluate("window.__station.paint.painted()");
        const state = await cdp.snapshot();
        return {
          ok: after === before && state.paint.status?.strokes === strokes,
          detail: `${after - before} px changed · strokes ${strokes} -> ${state.paint.status?.strokes} · pinch read ${state.paint.status?.pinch?.toFixed(2)}`,
        };
      },
    },
    {
      name: "a-dwell-picks-a-colour",
      crop: "tray",
      async run(cdp) {
        const chip = await chipCentre(cdp, "color-2");
        await holdPose(cdp, [{ at: chip, anchor: "pinch", pinch: 0 }]);
        const wanted = config.paint.colors[2];
        await cdp.waitFor(
          `window.__station.snapshot().paint.status?.tool.color === ${JSON.stringify(wanted)}`,
          { timeoutMs: dwellMs * 4, what: "a dwell on a colour chip to pick it" },
        );
        // And the ink agrees: a new line along the same path comes out in it.
        await armPuppet(cdp, "stroke");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const pixel = await samplePaint(cdp, await midpointOfStroke(cdp));
        const selected = await cdp.evaluate(
          "document.querySelector('[data-chip=\"color-2\"]').classList.contains('chip--selected')",
        );
        return {
          ok: colourClose(pixel, hexToRgb(wanted)) && selected === true,
          detail: `pixel ${JSON.stringify(pixel)} wanted ${wanted} · chip ${selected ? "shown selected" : "NOT shown selected"}`,
        };
      },
    },
    {
      name: "a-pinch-picks-a-chip-at-once",
      crop: "tray",
      async run(cdp) {
        const chip = await chipCentre(cdp, "size-2");
        // Hover open first, so the chip is the one under the hand when the
        // fingers close; then close them and time how long the pick takes.
        await holdPose(cdp, [{ at: chip, anchor: "pinch", pinch: 0 }]);
        await sleep(250);
        const started = Date.now();
        await holdPose(cdp, [{ at: chip, anchor: "pinch", pinch: 1 }]);
        await cdp.waitFor(
          `Math.abs(window.__station.snapshot().paint.status?.tool.width - ${config.paint.sizes[2]}) < 1e-9`,
          { timeoutMs: dwellMs, what: "a pinch on a width chip to pick it before a dwell could" },
        );
        const took = Date.now() - started;
        // Holding on, pinched, must not pick it a second time by dwell - for
        // the eraser that would be a toggle undoing itself. Check on the eraser.
        const erase = await chipCentre(cdp, "erase");
        await holdPose(cdp, [{ at: erase, anchor: "pinch", pinch: 0 }]);
        await sleep(250);
        await holdPose(cdp, [{ at: erase, anchor: "pinch", pinch: 1 }]);
        await cdp.waitFor("window.__station.snapshot().paint.status?.tool.kind === 'erase'", {
          timeoutMs: dwellMs,
          what: "a pinch on the eraser",
        });
        await sleep(dwellMs * 1.5);
        const state = await cdp.snapshot();
        return {
          ok: took < dwellMs && state.paint.status?.tool.kind === "erase",
          detail: `width picked in ${took} ms (dwell is ${dwellMs}) · still ${state.paint.status?.tool.kind} after holding`,
        };
      },
    },
    {
      name: "the-eraser-cuts-a-hole",
      crop: "stroke",
      async run(cdp) {
        const before = await samplePaint(cdp, await midpointOfStroke(cdp));
        await armPuppet(cdp, "stroke");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const after = await samplePaint(cdp, await midpointOfStroke(cdp));
        return {
          ok: before[3] > 200 && after[3] === 0,
          detail: `alpha ${before[3]} -> ${after[3]} on the path`,
        };
      },
    },
    {
      name: "painting-through-the-tray-picks-nothing",
      crop: "tray",
      async run(cdp) {
        const chip = await chipCentre(cdp, "color-0");
        const toolBefore = (await cdp.snapshot()).paint.status?.tool;
        const start = (await strokePath(cdp)).from;
        // Close on the mirror, drag onto a colour chip and sit there, pinched,
        // for longer than any dwell; then let go.
        await cdp.evaluate(
          `window.__station.puppet.play(${JSON.stringify({
            name: "through-the-tray",
            from: { hands: [{ at: start, anchor: "pinch", pinch: 0 }] },
            steps: [
              { to: { hands: [{ at: start, anchor: "pinch", pinch: 1 }] }, ms: 200 },
              { to: { hands: [{ at: chip, anchor: "pinch", pinch: 1 }] }, ms: 600 },
              { to: { hands: [{ at: chip, anchor: "pinch", pinch: 1 }] }, ms: dwellMs * 1.5 },
              { to: { hands: [{ at: chip, anchor: "pinch", pinch: 0 }] }, ms: 200 },
              { to: { hands: [{ at: chip, anchor: "pinch", pinch: 0 }] }, ms: 200 },
            ],
          })})`,
        );
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 8000 });
        const state = await cdp.snapshot();
        const toolAfter = state.paint.status?.tool;
        return {
          ok: JSON.stringify(toolAfter) === JSON.stringify(toolBefore),
          detail: `tool ${toolBefore?.kind} ${toolBefore?.color} -> ${toolAfter?.kind} ${toolAfter?.color}`,
        };
      },
    },
    {
      name: "the-bin-needs-a-long-hold",
      crop: "tray",
      async run(cdp) {
        const clearMs = config.paint.clearDwellMs;
        const strokesBefore = (await cdp.snapshot()).paint.status?.strokes ?? 0;
        const chip = await chipCentre(cdp, "clear");
        await holdPose(cdp, [{ at: chip, anchor: "pinch", pinch: 0 }]);
        await sleep(dwellMs + 150);
        const early = await cdp.snapshot();
        await cdp.waitFor("window.__station.snapshot().paint.status?.strokes === 0", {
          timeoutMs: clearMs * 2,
          what: "the long hold on the bin to clear the painting",
        });
        const painted = await cdp.evaluate("window.__station.paint.painted()");
        return {
          ok: strokesBefore > 0 && early.paint.status?.strokes === strokesBefore && painted === 0,
          detail: `${strokesBefore} strokes · still ${early.paint.status?.strokes} after ${dwellMs + 150} ms · ${painted} px left after the long hold`,
        };
      },
    },
    {
      name: "a-released-pinch-leaves-no-tail",
      crop: "stroke",
      async run(cdp) {
        // The gate waits openMs before it will believe a release, and it paints
        // for all of it. `overshoot` keeps the hand travelling through that
        // wait, so the ink between the end of the line and where the hand ended
        // up is exactly what the trim has to take back. Read off the canvas,
        // because the stroke's own point count is a number the app wrote.
        // See ADR 0018.
        await cdp.keys(["x"]);
        await cdp.waitFor("window.__station.paint.painted() === 0", {
          timeoutMs: 4000,
          what: "an empty canvas to start from",
        });
        await armPuppet(cdp, "overshoot");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 8000 });

        // The same points src/debug/puppet.ts drives the scenario through.
        const from = { x: 0.3, y: 0.5 };
        const to = { x: 0.7, y: 0.56 };
        const overshoot = { x: 0.86, y: 0.62 };
        const along = (k) => ({
          x: to.x + (overshoot.x - to.x) * k,
          y: to.y + (overshoot.y - to.y) * k,
        });
        const drawn = await samplePaint(cdp, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
        const past = await samplePaint(cdp, along(0.8));
        const end = await samplePaint(cdp, overshoot);
        return {
          ok: drawn[3] > 200 && past[3] === 0 && end[3] === 0,
          detail: `line alpha ${drawn[3]} · 80% past its end ${past[3]} · where the hand stopped ${end[3]}`,
        };
      },
    },
    {
      name: "a-parted-pinch-ends-the-line",
      crop: "stroke",
      async run(cdp) {
        // The complaint behind ADR 0023: fingertips parted a centimetre read
        // between the two marks, and a gate with no clock on that band drew for
        // as long as they stayed there. `part` draws a line, parts the fingers
        // to a reading of about 0.22 and keeps travelling, and never opens them
        // wide. The line has to end on its own while the fingers are still
        // parted, and nothing may be inked past the parting. Read off the canvas.
        await cdp.keys(["x"]);
        await cdp.waitFor("window.__station.paint.painted() === 0", {
          timeoutMs: 4000,
          what: "an empty canvas to start from",
        });
        const scenario = await cdp.evaluate("window.__station.scenarios().part");
        const at = (i) => scenario.steps[i].to.hands[0].at;
        const from = scenario.from.hands[0].at;
        const to = at(2);
        const parted = at(3);
        const end = at(4);
        await armPuppet(cdp, "part");
        await cdp.waitFor("window.__station.snapshot().paint.status?.pinched === true", {
          timeoutMs: 4000,
          what: "the pinch to close",
        });
        await cdp.waitFor("window.__station.snapshot().paint.status?.pinched === false", {
          timeoutMs: 6000,
          what: "the parted pinch to end its line",
        });
        // Ended while the hand was still parted, not because the scenario ran out.
        const stillParted = !(await cdp.evaluate("window.__station.puppet.finished()"));
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 8000 });
        const drawn = await samplePaint(cdp, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
        const past = await samplePaint(cdp, {
          x: (parted.x + end.x) / 2,
          y: (parted.y + end.y) / 2,
        });
        const stopped = await samplePaint(cdp, end);
        return {
          ok: stillParted && drawn[3] > 200 && past[3] === 0 && stopped[3] === 0,
          detail:
            `ended ${stillParted ? "while still parted" : "only when the scenario ran out"}` +
            ` · line alpha ${drawn[3]} · past the parting ${past[3]} · where the hand stopped ${stopped[3]}`,
        };
      },
    },
    {
      name: "a-line-starts-where-the-fingers-met",
      crop: "stroke",
      async run(cdp) {
        // The mirror of the check above. A gate cannot confirm a pinch until it
        // has held, so `dive` closes the fingers while the hand is already
        // travelling and the head of the line is drawn during the wait. Read
        // off the canvas: the ink has to reach up to where the fingers met, not
        // begin wherever the hand had got to. See ADR 0020.
        await cdp.keys(["x"]);
        await cdp.waitFor("window.__station.paint.painted() === 0", {
          timeoutMs: 4000,
          what: "an empty canvas to start from",
        });
        await armPuppet(cdp, "dive");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 8000 });

        // The same points src/debug/puppet.ts drives the scenario through.
        const met = { x: 0.42, y: 0.38 };
        const to = { x: 0.45, y: 0.82 };
        const above = { x: 0.42, y: 0.28 };
        const head = await samplePaint(cdp, met);
        const body = await samplePaint(cdp, { x: (met.x + to.x) / 2, y: (met.y + to.y) / 2 });
        // Not all the way back to where the hand was before it began closing.
        const early = await samplePaint(cdp, above);
        return {
          ok: head[3] > 200 && body[3] > 200 && early[3] === 0,
          detail: `where the fingers met ${head[3]} · mid-line ${body[3]} · before they closed ${early[3]}`,
        };
      },
    },
    {
      name: "leaving-paint-keeps-the-painting",
      crop: "menu",
      async run(cdp) {
        await armPuppet(cdp, "stroke");
        await cdp.waitFor("window.__station.puppet.finished()", { timeoutMs: 6000 });
        const painted = await cdp.evaluate("window.__station.paint.painted()");
        const { menu } = await cdp.snapshot();
        const picture = menu.panels.find((p) => p.id === "picture");
        await holdPose(cdp, [{ at: centreOf(picture), anchor: "pinch", pinch: 0 }]);
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'picture'", {
          timeoutMs: dwellMs * 4,
          what: "a dwell on the Picture tile from Paint mode",
        });
        const away = await cdp.snapshot();
        const paintTile = menu.panels.find((p) => p.id === "paint");
        await holdPose(cdp, [{ at: centreOf(paintTile), gesture: "Pointing_Up" }]);
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'paint'", {
          timeoutMs: dwellMs * 4,
          what: "a dwell back into Paint mode",
        });
        const back = await cdp.snapshot();
        const restored = await cdp.evaluate("window.__station.paint.painted()");
        return {
          ok: painted > 0 && !away.paint.visible && back.paint.visible && restored === painted,
          detail: `${painted} px · hidden in picture: ${!away.paint.visible} · ${restored} px back in paint`,
        };
      },
    },
    {
      name: "the-recorder-is-debug-only",
      crop: "menu",
      async run(cdp) {
        await cdp.evaluate("window.__station.puppet.stop()");
        await cdp.reload();
        const hidden = await cdp.snapshot();
        await cdp.keys(["d"]);
        await cdp.waitFor("document.body.dataset.cameraMode === 'debug'", {
          timeoutMs: 20_000,
          what: "debug mode",
        });
        await cdp.waitFor("document.body.classList.contains('is-live')", { timeoutMs: 20_000 });
        const shown = await cdp.snapshot();
        const debugDisplay = await cdp.evaluate(RECORDER_DISPLAY);
        // The pointer comes with it: the control is the only thing on this
        // station that has to be pressed rather than pointed at.
        const cursor = await cdp.evaluate("getComputedStyle(document.body).cursor");
        await cdp.keys(["f"]);
        await cdp.waitFor("document.body.dataset.cameraMode === 'final'", { timeoutMs: 20_000 });
        // Computed style, not the flag that claims it: the class that hides
        // this lost the cascade to an id selector once, and the snapshot went
        // on saying "hidden" while the control sat on the visitor's mirror.
        const finalDisplay = await cdp.evaluate(RECORDER_DISPLAY);
        await cdp.keys(["d"]);
        await cdp.waitFor("document.body.dataset.cameraMode === 'debug'", { timeoutMs: 20_000 });
        return {
          ok:
            !hidden.recording.visible &&
            shown.recording.visible &&
            finalDisplay === "none" &&
            debugDisplay !== "none" &&
            cursor !== "none",
          detail: `final display ${finalDisplay} · debug display ${debugDisplay} · cursor ${cursor}`,
        };
      },
    },
    {
      name: "a-task-reaches-the-mirror",
      crop: "tasks",
      async run(cdp) {
        await mkdir("tasks", { recursive: true });
        await writeFile(
          join("tasks", `${VERIFY_TASK.id}.json`),
          `${JSON.stringify(VERIFY_TASK, null, 2)}\n`,
        );
        await cdp.evaluate("window.__station.tasks.refresh()");
        await cdp.waitFor(
          `window.__station.snapshot().tasks.showing.some((t) => t.id === ${JSON.stringify(VERIFY_TASK.id)})`,
          { timeoutMs: 5000, what: "the task to appear on the mirror" },
        );
        const shown = await cdp.evaluate(
          `document.querySelector('[data-task=${JSON.stringify(VERIFY_TASK.id)}] .task__instruction')?.textContent ?? ''`,
        );
        return {
          ok: shown === VERIFY_TASK.steps[0].instruction,
          detail: `step reads ${JSON.stringify(shown)}`,
        };
      },
    },
    {
      name: "the-tray-clears-the-task-list",
      crop: "tasks",
      async run(cdp) {
        // Debug view, a task on the list, Paint mode on: the three things a
        // person doing a task has on screen at once. The tray was under the
        // list the first time. See friction 0024.
        await cdp.keys(["b"]);
        await cdp.waitFor("window.__station.snapshot().experience.mode === 'paint'", {
          timeoutMs: 3000,
          what: "the B key to open Paint mode",
        });
        const boxes = await cdp.evaluate(
          `(() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
             const tray = r('#paint-tray'); const tasks = r('#tasks');
             return { trayLeft: tray.left, trayRight: tray.right, tasksLeft: tasks.left,
                      tasksRight: tasks.right, tasksBottom: tasks.bottom, height: innerHeight }; })()`,
        );
        // Which one is on the left is not this check's business - only that
        // they do not share any of it. Asserting an order pinned the fix in
        // place and failed the moment the better fix moved the other one.
        const clear = boxes.tasksRight <= boxes.trayLeft || boxes.trayRight <= boxes.tasksLeft;
        // The floor is reported, not asserted: how many tasks are open is the
        // operator's business, not the code's. ADR 0015 makes it a ceiling on
        // purpose, and this is where somebody finds out they have hit it.
        const floor =
          boxes.tasksBottom > boxes.height
            ? ` · ⚠ list runs ${(boxes.tasksBottom - boxes.height).toFixed(0)} px past the floor - too many tasks open`
            : "";
        return {
          ok: clear,
          detail: `tray ${boxes.trayLeft.toFixed(0)}-${boxes.trayRight.toFixed(0)} px · list ${boxes.tasksLeft.toFixed(0)}-${boxes.tasksRight.toFixed(0)}${floor}`,
        };
      },
    },
    {
      name: "a-chip-hovers-where-it-is-drawn",
      crop: "tray",
      async run(cdp) {
        // Two rectangles have to agree: the one the browser draws the chip in,
        // and the one the physics tests a hand against, which is cached from a
        // measurement taken when the tray last changed size. A rule keyed on
        // the camera mode moved the tray without resizing it, so in the debug
        // view they were 200 px apart and every tool was dead. Both modes, both
        // times, or this says nothing. See friction 0026.
        const missed = [];
        for (const mode of ["final", "debug"]) {
          await cdp.keys([mode === "debug" ? "d" : "f"]);
          await cdp.waitFor(`document.body.dataset.cameraMode === '${mode}'`, {
            timeoutMs: 20_000,
            what: `${mode} camera mode`,
          });
          await cdp.waitFor("document.body.classList.contains('is-live')", { timeoutMs: 20_000 });
          const chip = await chipCentre(cdp, "color-4");
          await holdPose(cdp, [{ at: chip, anchor: "pinch", pinch: 0 }]);
          await sleep(500);
          const state = await cdp.snapshot();
          const hovered =
            state.paint.tray.find((c) => c.classes.includes("chip--hovered"))?.id ?? null;
          if (hovered !== "color-4") {
            missed.push(
              `${mode}: drawn at ${chip.x.toFixed(3)} and hovered ${hovered ?? "nothing"}`,
            );
          }
        }
        // Put the hands back the way this check found them, so the recorder
        // check further down still records a camera take rather than ours.
        await cdp.evaluate("window.__station.puppet.stop()");
        return {
          ok: missed.length === 0,
          detail: missed.length === 0 ? "the same chip in final and debug" : missed.join(" · "),
        };
      },
    },
    {
      name: "a-step-records-and-files-itself",
      crop: "tasks",
      async run(cdp) {
        // Through the step's own button, which is what a finger presses.
        await cdp.evaluate(
          `window.__station.tasks.record(${JSON.stringify(VERIFY_TASK.id)}, "s1")`,
        );
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'recording'", {
          timeoutMs: 5000,
          what: "the step to start recording",
        });
        const running = await cdp.snapshot();
        await sleep(1200);
        await cdp.evaluate("window.__station.recorder.stop()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'naming'", {
          timeoutMs: 15_000,
          what: "the take to finish encoding",
        });
        await cdp.evaluate('window.__station.recorder.save("", "Written by npm run verify.")');
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'saved'", {
          timeoutMs: 15_000,
          what: "the take to be filed",
        });

        const task = JSON.parse(await readFile(join("tasks", `${VERIFY_TASK.id}.json`), "utf8"));
        const run = task.steps[0].runs[0];
        // The puppet is stopped by the check before this one, so this take is a
        // camera take - and the run has to say which it was either way.
        return {
          ok:
            run !== undefined &&
            task.status === "done" &&
            typeof run.recording === "string" &&
            run.note === "Written by npm run verify." &&
            ["camera", "puppet"].includes(run.perceptionSource) &&
            run.digest?.frames > 0,
          detail:
            run === undefined
              ? `nothing was filed (task is ${task.status})`
              : `${run.perceptionSource} · ${run.digest?.frames} frames · task ${task.status} · ` +
                `answering ${running.recording.task?.stepId}`,
        };
      },
    },
    {
      name: "a-word-stops-a-recording",
      crop: "recorder",
      async run(cdp) {
        await cdp.evaluate("window.__station.recorder.start()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'recording'", {
          timeoutMs: 5000,
          what: "the recorder to start",
        });
        await sleep(600);
        // Injected, not spoken: this proves the wiring from an utterance to the
        // recorder and says nothing at all about the speech model. See ADR 0016.
        await cdp.evaluate('window.__station.say("stop")');
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'naming'", {
          timeoutMs: 8000,
          what: "a spoken stop to end the take",
        });
        const state = await cdp.snapshot();
        return {
          ok: state.voice.lastSource === "injected",
          detail: `stopped by an injected word · ear ${state.voice.listening ? "open" : "closed"}`,
        };
      },
    },
    {
      name: "a-description-is-dictated",
      crop: "dialog",
      async run(cdp) {
        const spoken = "It lost my hand when I turned toward the window.";
        await cdp.evaluate(`window.__station.say(${JSON.stringify(spoken)})`);
        await cdp.waitFor(
          `document.getElementById("recorder-description").value.includes("turned toward")`,
          { timeoutMs: 8000, what: "the words to reach the description" },
        );
        const written = await cdp.evaluate('document.getElementById("recorder-description").value');
        // Straight into the description, never the name: the dialog focuses the
        // name for typing, and a spoken sentence is not a filename.
        const name = await cdp.evaluate('document.getElementById("recorder-name").value');
        await cdp.evaluate("window.__station.recorder.discard()");
        return {
          ok: written === spoken && name === "",
          detail: `${JSON.stringify(String(written).slice(0, 40))} · name left ${JSON.stringify(name)}`,
        };
      },
    },
    {
      name: "a-recording-is-saved-with-a-name",
      crop: "recorder",
      async run(cdp) {
        await cdp.evaluate("window.__station.recorder.start()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'recording'", {
          timeoutMs: 5000,
          what: "the recorder to start",
        });
        await sleep(1200);
        const running = await cdp.snapshot();
        await cdp.evaluate("window.__station.recorder.stop()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'naming'", {
          timeoutMs: 15_000,
          what: "the take to finish encoding",
        });

        const filename = await cdp.evaluate(
          `window.__station.recorder.save(${JSON.stringify(VERIFY_RECORDING_NAME)},` +
            ` "Written and removed by npm run verify.")`,
        );
        const files = await recordingFiles();
        const stem = String(filename).replace(/\.webm$/, "");
        // Back to what a visitor sees, whatever happens next.
        await cdp.keys(["f"]);
        return {
          ok:
            running.recording.samples > 0 &&
            files.includes(`${stem}.webm`) &&
            files.includes(`${stem}.json`),
          detail: `${filename} · ${running.recording.samples} perception frames while recording`,
        };
      },
    },
    {
      name: "a-take-can-be-recorded-on-the-visitor-camera",
      crop: "hud",
      async run(cdp) {
        // Until ADR 0021 the recorder lived on the debug *camera profile*, so
        // every take ever made was 720p and the 1080p a visitor gets was never
        // once recorded. The view and the profile are two settings now: from the
        // debug view, put the camera on the visitor's profile, record, and the
        // manifest has to say so. Restores the camera it found.
        const before = await cdp.snapshot();
        await cdp.evaluate('window.__station.view.set("debug")');
        await cdp.waitFor("document.body.dataset.view === 'debug'", { timeoutMs: 5000 });
        await cdp.evaluate('window.__station.camera.use("final")');
        await cdp.waitFor("document.body.dataset.cameraMode === 'final'", {
          timeoutMs: 20_000,
          what: "the camera to reopen on the final profile",
        });
        await cdp.waitFor("document.body.classList.contains('is-live')", { timeoutMs: 20_000 });
        const onFinal = await cdp.snapshot();
        const display = await cdp.evaluate(RECORDER_DISPLAY);

        await cdp.evaluate("window.__station.recorder.start()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'recording'", {
          timeoutMs: 5000,
          what: "the recorder to start on the final profile",
        });
        await sleep(1200);
        await cdp.evaluate("window.__station.recorder.stop()");
        await cdp.waitFor("window.__station.snapshot().recording.phase === 'naming'", {
          timeoutMs: 15_000,
          what: "the take to finish encoding",
        });
        const filename = await cdp.evaluate(
          `window.__station.recorder.save(${JSON.stringify(VERIFY_RECORDING_NAME)},` +
            ` "Written and removed by npm run verify: the visitor's camera profile.")`,
        );
        const stem = String(filename).replace(/\.webm$/, "");
        const manifest = JSON.parse(await readFile(join("recordings", `${stem}.json`), "utf8"));

        await cdp.evaluate(`window.__station.camera.use(${JSON.stringify(before.camera.mode)})`);
        await cdp.waitFor(
          `document.body.dataset.cameraMode === ${JSON.stringify(before.camera.mode)}`,
          { timeoutMs: 20_000, what: "the camera to go back to the profile it was on" },
        );
        await cdp.evaluate(`window.__station.view.set(${JSON.stringify(before.camera.view)})`);
        const source = String(manifest.camera?.source ?? "");
        return {
          ok:
            onFinal.camera.mode === "final" &&
            onFinal.camera.view === "debug" &&
            display !== "none" &&
            manifest.camera?.mode === "final" &&
            manifest.camera?.view === "debug" &&
            source.startsWith("1920x1080") &&
            manifest.video?.width === 1920,
          detail:
            `camera ${onFinal.camera.mode} ${onFinal.camera.source} under the ${onFinal.camera.view} view` +
            ` · recorder display ${display} · manifest ${manifest.camera?.mode}/${manifest.camera?.view}` +
            ` ${source}, video ${manifest.video?.width}x${manifest.video?.height}`,
        };
      },
    },
  ];
}

// ----------------------------------------------------------------- helpers --

async function armPuppet(cdp, name) {
  await cdp.evaluate(`window.__station.puppet.play(${JSON.stringify(name)})`);
}

async function holdPose(cdp, hands) {
  await cdp.evaluate(`window.__station.puppet.hold(${JSON.stringify({ hands })})`);
}

function centreOf(panel) {
  return { x: panel.rect.x + panel.rect.width / 2, y: panel.rect.y + panel.rect.height / 2 };
}

/** `--chip <id>`, `--tile <mode>` or `--at x,y`: where a held hand goes. */
async function holdTarget(cdp) {
  if (parsed.has("chip")) return chipCentre(cdp, String(parsed.get("chip")));
  if (parsed.has("tile")) {
    const { menu } = await cdp.snapshot();
    const tile = menu.panels.find((p) => p.id === String(parsed.get("tile")));
    if (tile === undefined) throw new Error(`no tile "${parsed.get("tile")}"`);
    return centreOf(tile);
  }
  const at = String(parsed.get("at", "0.5,0.5")).split(",").map(Number);
  if (at.length !== 2 || at.some(Number.isNaN)) throw new Error("--at wants x,y");
  return { x: at[0], y: at[1] };
}

/** Where a tray chip is right now, off the snapshot, normalized. */
async function chipCentre(cdp, id) {
  const { paint } = await cdp.snapshot();
  const chip = paint.tray.find((c) => c.id === id);
  if (chip === undefined) throw new Error(`no chip "${id}" in the tray`);
  return centreOf(chip);
}

/**
 * Where the built-in stroke scenario draws, read from the scenario itself so
 * this cannot drift from src/debug/puppet.ts: the pinch closes at `from` and
 * opens at `to`.
 */
async function strokePath(cdp) {
  const scenario = await cdp.evaluate("window.__station.scenarios().stroke");
  const from = scenario.from.hands[0].at;
  const to = scenario.steps.at(-1).to.hands[0].at;
  return { from, to };
}

/** Halfway along the path the built-in stroke scenario draws. */
async function midpointOfStroke(cdp) {
  const { from, to } = await strokePath(cdp);
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

async function samplePaint(cdp, point) {
  return cdp.evaluate(`window.__station.paint.sample(${point.x}, ${point.y})`);
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Within a few counts per channel: the canvas is not colour-managed identically everywhere. */
function colourClose(pixel, rgb) {
  return rgb.every((channel, i) => Math.abs(pixel[i] - channel) <= 8);
}

async function badgePath(cdp) {
  return cdp.evaluate(
    `document.querySelector('.tile__hint svg path')?.getAttribute('d')?.slice(0, 40) ?? ''`,
  );
}

function boxExpression(selector, pad) {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x - ${pad}, y: r.y - ${pad}, width: r.width + ${2 * pad}, height: r.height + ${2 * pad} };
  })()`;
}

async function resolveClip(cdp, crop, zoom) {
  if (crop === null || crop === true) return null;
  const named = NAMED_REGIONS[crop];
  const box = named
    ? await cdp.evaluate(named.expression ?? boxExpression(named.selector, named.pad))
    : parseBox(String(crop));
  if (box === null) throw new Error(`crop "${crop}" matched nothing`);
  return { ...box, scale: zoom };
}

function parseBox(text) {
  const parts = text.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/** One call instead of capture-then-crop-then-look: Chrome clips and scales it. */
async function capture(cdp, out, clip) {
  if (clip === null) return cdp.screenshot(out);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip });
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(data, "base64"));
  return out;
}

/**
 * Which way, and how far, a progress arc is actually filled - read off the
 * composited pixels, not off the CSS. Reading the declaration back would only
 * repeat whatever misunderstanding produced it, which is how three rings
 * shipped running backwards. See docs/frictions/0004.
 *
 * Every accent-coloured pixel in the element's box is sorted into an angle
 * bucket, so the shape of the ring does not matter: circle, squircle or
 * anything else. The one requirement is that nothing else inside that box is
 * accent-coloured - a selected tile, for instance, has an accent border of its
 * own, and for that one the dwell value in `station state` is the better tool.
 */
async function sampleRing(cdp, box, points) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { ...box, scale: 1 },
  });
  // Parse the accent here and pass numbers in. Page code built by string
  // interpolation crosses three layers of escaping before Chrome sees it, and a
  // regex that survives two of them silently matches the wrong thing.
  const accent = await cdp.evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue("--accent")`,
  );
  const rgb = (String(accent).match(/[\d.]+/g) ?? ["255", "255", "255"]).slice(0, 3).map(Number);

  return cdp.evaluate(`(async () => {
    const image = new Image();
    image.src = "data:image/png;base64,${data}";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, image.width, image.height);

    const accent = ${JSON.stringify(rgb)};
    // Match the accent by its hue signature rather than by RGB distance: the
    // ring is drawn over a live camera picture and comes out blended, but the
    // direction it pulls the channels survives the blend. A pale wall does not.
    const greenBias = (accent[1] - accent[0]) * 0.5;
    const blueBias = (accent[2] - accent[0]) * 0.4;

    const cx = image.width / 2;
    const cy = image.height / 2;
    const buckets = new Array(${points}).fill(0);
    // Only the outer band counts. The crop is the ring's own bounding box, so
    // everything inside it is the live camera picture seen through the middle of
    // the ring - and a bluish highlight in the scene is accent-coloured enough
    // to register as a filled bucket. That reported an arc starting 15 degrees
    // early off a pair of glasses. See docs/frictions/0016.
    //
    // The band follows the box edge along each ray rather than a fixed radius,
    // because the dial is a rounded square: its corners sit much further from
    // the centre than its edge midpoints do.
    const OUTER_BAND = 0.75;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const o = (y * image.width + x) * 4;
        const r = px[o];
        const g = px[o + 1];
        const b = px[o + 2];
        if (g - r <= greenBias || b - r <= blueBias || (r + g + b) / 3 < 90) continue;
        const ux = x - cx;
        const uy = cy - y;
        const radius = Math.hypot(ux, uy);
        if (radius === 0) continue;
        const toEdge = Math.min(
          Math.abs(cx / (ux / radius)) || Number.POSITIVE_INFINITY,
          Math.abs(cy / (uy / radius)) || Number.POSITIVE_INFINITY,
        );
        if (radius < toEdge * OUTER_BAND) continue;
        const deg = (Math.atan2(ux, uy) * 180) / Math.PI;
        buckets[Math.floor((((deg % 360) + 360) % 360) / (360 / ${points}))] += 1;
      }
    }
    const step = 360 / ${points};
    return buckets.map((count, i) => ({ deg: i * step, count, hit: count > 2 }));
  })()`);
}

/** The filled arc, as degrees clockwise from twelve o'clock. */
function arcOf(samples) {
  const filled = samples.map((s) => s.hit);
  if (filled.every(Boolean) || !filled.some(Boolean)) return null;

  // Rotate to the first filled sample that follows an empty one: the start.
  const start = filled.findIndex((on, i) => on && !filled[(i - 1 + filled.length) % filled.length]);
  let length = 0;
  while (filled[(start + length) % filled.length] && length < filled.length) length++;
  const step = 360 / samples.length;
  return { startDeg: start * step, sweepDeg: length * step };
}

function describeArc(samples) {
  const arc = arcOf(samples);
  const hits = samples.filter((s) => s.hit).length;
  if (arc === null) {
    return hits === 0 ? "no accent anywhere on it" : "filled all the way round";
  }
  const end = (arc.startDeg + arc.sweepDeg) % 360;
  return `filled ${arc.startDeg.toFixed(0)} -> ${end.toFixed(0)} degrees clockwise from 12 o'clock (${((arc.sweepDeg / 360) * 100).toFixed(0)}%)`;
}

/**
 * An expression starting with a dot is a path into the debug snapshot, so the
 * common case reads `station watch ".menu.panels[0].glow"` instead of a regex
 * over an inline style. Anything else is evaluated as written.
 */
function pageExpression(text) {
  return text.startsWith(".") ? `window.__station.snapshot()${text}` : text;
}

function styleOverride(css) {
  return `(() => {
    let el = document.getElementById('__station_override');
    if (el === null) { el = document.createElement('style'); el.id = '__station_override'; document.head.append(el); }
    el.textContent = ${JSON.stringify(css)};
    return el.textContent.length;
  })()`;
}

async function pictureFiles() {
  try {
    return (await readdir("captures")).filter((f) => f.startsWith("picture-"));
  } catch {
    return [];
  }
}

/** The server slugifies a recording's name the same way. See vite.config.ts. */
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

async function recordingFiles() {
  try {
    return await readdir("recordings");
  } catch {
    return [];
  }
}

function printState(s) {
  const badge = s.perceptionSource === "puppet" ? "  ⚠ PUPPET HANDS" : "";
  console.log(
    `[state] ${s.camera.view} view · camera ${s.camera.mode} ${s.camera.source} · ${s.camera.fps.toFixed(0)} fps${badge}`,
  );
  // friction 0011 claimed this warning was here and it was not, so a whole
  // session's numbers were read without knowing the window was unfocused.
  if (throttleWarning(s) !== "") console.log(`[state]${throttleWarning(s)}`);
  if (stalledWarning(s) !== "") console.log(`[state]${stalledWarning(s)}`);
  if (deliveryWarning(s) !== "") console.log(`[state]${deliveryWarning(s)}`);
  if (s.camera.error != null) console.log(`[state]  ⚠ last mode change failed - ${s.camera.error}`);
  if (s.crash != null) console.log(`[state]  ⚠ something threw - ${s.crash}`);
  console.log(
    `[state] hands ${s.hands.length}${s.hands.length > 0 ? ` (${s.hands.map((h) => `${h.side}:${h.gesture}@${h.confidence.toFixed(2)}`).join(", ")})` : ""} · faces ${s.faces} · detectors hands ${s.camera.timings.hands.toFixed(1)}ms faces ${s.camera.timings.faces.toFixed(1)}ms`,
  );
  console.log(`[state] mode ${s.experience.mode} · phase ${s.experience.phase}`);
  if (s.cursor?.position != null) {
    console.log(
      `[state] cursor ${s.cursor.position.x.toFixed(3)}, ${s.cursor.position.y.toFixed(3)} · dwell ${(s.cursor.dwell * 100).toFixed(0)}%`,
    );
  }
  for (const panel of s.menu.panels) {
    console.log(
      `[state]   ${panel.id.padEnd(8)} offset ${panel.offset.x.toFixed(1)},${panel.offset.y.toFixed(1)} px · lean ${panel.leanDeg.y.toFixed(1)}° · glow ${panel.glow.toFixed(2)} · dwell ${panel.dwell.toFixed(2)}${panel.hold === null ? "" : ` · hold ${panel.hold.toFixed(2)}`}`,
    );
  }
  if (s.paint.visible || s.paint.status !== null) {
    const p = s.paint;
    const status = p.status;
    const selected = p.tray.filter((c) => c.classes.includes("chip--selected")).map((c) => c.id);
    const hovered = p.tray.find((c) => c.classes.includes("chip--hovered"));
    if (p.visible && (p.canvas.width === 0 || p.canvas.height === 0)) {
      console.log(
        "[state]  ⚠ the paint canvas is 0x0 - it is on the glass and every stroke lands in no pixels. See friction 0023.",
      );
    }
    console.log(
      `[state] paint ${p.visible ? `on the glass, ${p.canvas.width}x${p.canvas.height}` : "⚠ HIDDEN while in paint mode"}` +
        (status === null
          ? ""
          : ` · pinch ${status.pinch === null ? "no hand" : status.pinch.toFixed(2)}` +
            (status.pinchMetres == null ? "" : ` (${(status.pinchMetres * 1000).toFixed(0)} mm)`) +
            ` · ${status.painting ? (status.touching === false ? "loose" : "painting") : status.pinched ? "pinched" : "open"}` +
            ` · ${status.tool.kind === "erase" ? "eraser" : status.tool.color} ${status.tool.width.toFixed(3)}` +
            ` · ${status.strokes} strokes, ${status.points} points`),
    );
    console.log(
      `[state]   tray ${p.tray.length} chips · selected ${selected.join(", ") || "none"}` +
        (hovered === undefined ? "" : ` · hovered ${hovered.id} dwell ${hovered.dwell.toFixed(2)}`),
    );
  }
  if (s.recording.visible || s.recording.phase !== "idle") {
    const r = s.recording;
    console.log(
      `[state] recorder ${r.phase}` +
        (r.phase === "recording"
          ? ` · ${(r.elapsedMs / 1000).toFixed(1)} s · ${r.samples} frames`
          : "") +
        (r.lastSaved === null ? "" : ` · saved ${r.lastSaved}`) +
        (r.error === null ? "" : ` · ⚠ ${r.error}`),
    );
  }
  if (s.voice.listening || s.voice.error !== null) {
    const v = s.voice;
    console.log(
      `[state] ear ${v.error !== null ? `⚠ ${v.error}` : v.ready ? "ready" : "loading the model"}` +
        ` · ${v.device} · level ${(v.level * 100).toFixed(0)}%` +
        (v.speaking ? " · hearing someone" : "") +
        (v.pending > 0 ? ` · ${v.pending} to transcribe` : "") +
        (v.lastText === ""
          ? ""
          : ` · ${v.lastSource === "injected" ? "⚠ INJECTED" : "heard"} "${v.lastText.trim()}"` +
            (v.lastSource === "injected" ? "" : ` in ${v.lastTookMs} ms`)),
    );
  }
  if (s.tasks.visible || s.tasks.showing.length > 0) {
    const t = s.tasks;
    console.log(
      `[state] tasks ${t.showing.length} on the mirror, ${t.open} open` +
        (t.recordingFor === null
          ? ""
          : ` · recording ${t.recordingFor.taskId} ${t.recordingFor.stepId}`) +
        (t.error === null ? "" : ` · ⚠ ${t.error}`),
    );
    for (const task of t.showing) {
      const steps = task.steps.map((step) => `${step.id}${step.answered ? "✓" : ""}`).join(" ");
      console.log(`[state]   ${task.status.padEnd(9)} ${task.title} · ${steps}`);
    }
  }
  if (s.picture.countdownVisible || s.picture.statusVisible) {
    console.log(
      `[state] countdown ${(s.picture.countdown * 100).toFixed(0)}%${s.picture.statusVisible ? " · status showing" : ""}`,
    );
  }
  if (s.visibleText.length > 0)
    console.log(`[state] visible text: ${JSON.stringify(s.visibleText)}`);
}

/** Chrome throttles a page nobody is looking at, and every fps below is then a
 * measurement of the throttle rather than of the app. */
function throttleWarning(snapshot) {
  if (snapshot.visibility.state === "visible" && snapshot.visibility.focused) return "";
  return `  ⚠ window ${snapshot.visibility.state}${snapshot.visibility.focused ? "" : ", unfocused"} - frame rate is throttled`;
}

/**
 * A loop that is not being handed frames at all.
 *
 * Chrome stops compositing a window it considers covered, and
 * requestVideoFrameCallback stops with it - while the video element keeps
 * playing, `visibilityState` stays "visible" and `hasFocus()` stays true, so
 * nothing else in this readout notices. Every rate then holds the value it had
 * when the last frame arrived, which reads as a slow station rather than a
 * stopped one. See friction 0022.
 */
function stalledWarning(snapshot) {
  const since = snapshot.camera.sinceLastFrameMs;
  if (since === undefined || !snapshot.live) return "";
  const how =
    since < 0
      ? "has not processed a single frame"
      : `has processed nothing for ${(since / 1000).toFixed(1)} s`;
  if (since >= 0 && since < 1000) return "";
  return (
    `  ⚠ the loop ${how} - every rate below is stale.\n` +
    "[state]    Uncover the station window: Chrome stops painting one it thinks is hidden,\n" +
    "[state]    and requestVideoFrameCallback stops with it while the video keeps playing."
  );
}

/** The camera reports the rate it negotiated, not the rate it sends. */
function deliveryWarning(snapshot) {
  const { capturedFps, source, fps } = snapshot.camera;
  const claimed = Number(/@(\d+)/.exec(source)?.[1] ?? 0);
  if (claimed === 0 || capturedFps === undefined || capturedFps === 0) return "";
  if (capturedFps >= claimed * 0.8) return "";
  return (
    `  ⚠ camera delivering ${capturedFps.toFixed(1)} fps of the ${claimed} it claims` +
    ` (loop processes ${fps.toFixed(1)}) - see docs/hardware.md`
  );
}

function fmt(value) {
  return value === undefined ? "-" : Number(value).toFixed(1);
}
