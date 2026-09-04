/**
 * The station's command line: one tool for every question this project asks of
 * a running mirror.
 *
 *   npm run station -- state                 what the app currently thinks
 *   npm run station -- shoot out.png --crop menu --zoom 3
 *   npm run station -- watch "expr" --seconds 20 --shoot-when "expr"
 *   npm run station -- probe .countdown__ring --ring
 *   npm run station -- perf --css ".tile{backdrop-filter:none!important}"
 *   npm run station -- puppet wave | point | victory | palm | both | stop
 *   npm run station -- verify
 *   npm run station -- focus
 *
 * Everything attaches to the Chrome that ./start.sh already opened. Nothing
 * here ever launches a browser: /dev/video0 allows exactly one owner, and a
 * second one is how a debugging session turns into a broken station.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { args, attach, sleep } from "./lib/cdp.mjs";

const NAMED_REGIONS = {
  menu: { selector: "#dock", pad: 70 },
  tile: { selector: ".tile", pad: 34 },
  countdown: { selector: ".countdown__dial", pad: 60 },
  status: { selector: "#capture-status", pad: 34 },
  hud: { selector: "#hud", pad: 12 },
};

const parsed = args();
const [command = "state", ...rest] = parsed.positional;

const commands = {
  state: cmdState,
  shoot: cmdShoot,
  watch: cmdWatch,
  probe: cmdProbe,
  perf: cmdPerf,
  puppet: cmdPuppet,
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
  await armPuppet(cdp, name);
  console.log(`[puppet] playing "${name}"`);
  if (parsed.has("wait")) {
    await cdp.waitFor("window.__station.puppet.finished()", { what: "the scenario to finish" });
    console.log("[puppet] finished");
  }
  printState(await cdp.snapshot());
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
  const outDir = String(parsed.get("out", "captures/verify"));
  const before = await pictureFiles();
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
  const mine = after.filter((file) => !before.includes(file));
  for (const file of mine) await rm(join("captures", file));
  if (mine.length > 0)
    console.log(`\n[verify] removed ${mine.length} picture(s) taken by this run`);

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
      name: "a-locked-tile-never-fires",
      crop: "menu",
      async run(cdp) {
        await cdp.reload();
        const { menu } = await cdp.snapshot();
        await holdPose(cdp, [{ at: centreOf(menu.panels[1]), gesture: "Pointing_Up" }]);
        await sleep(dwellMs * 3);
        const state = await cdp.snapshot();
        return {
          ok: state.experience.mode === "home" && state.menu.panels[1].dwell === 0,
          detail: `mode=${state.experience.mode} dwell=${state.menu.panels[1].dwell}`,
        };
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
    ? await cdp.evaluate(boxExpression(named.selector, named.pad))
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

function printState(s) {
  const badge = s.perceptionSource === "puppet" ? "  ⚠ PUPPET HANDS" : "";
  console.log(
    `[state] ${s.camera.mode} · ${s.camera.fps.toFixed(0)} fps · ${s.camera.source}${badge}`,
  );
  // friction 0011 claimed this warning was here and it was not, so a whole
  // session's numbers were read without knowing the window was unfocused.
  if (throttleWarning(s) !== "") console.log(`[state]${throttleWarning(s)}`);
  if (deliveryWarning(s) !== "") console.log(`[state]${deliveryWarning(s)}`);
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
