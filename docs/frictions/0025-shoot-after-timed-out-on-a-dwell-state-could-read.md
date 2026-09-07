# 0025. `shoot --after` timed out on a dwell that `state` could read

- Date: 2026-09-07
- Status: integrated
- Area: tooling

## What happened

Two handoff captures were meant to show a chip's dwell ring half full: hold a
scripted open hand on the bin, then `npm run station -- shoot ... --crop tray
--after "+window.__station.snapshot().paint.tray.find((c) => c.id ===
'clear').dwell > 0.4"`. Both waits timed out after 15 s. Run by hand a moment
later, `puppet hold --chip clear` followed by `state` read `hovered clear dwell
0.67`, so the hold worked and the snapshot carried the number the expression
asked for. The station window was closed before the pair could be repeated.

## Impact

Two of the paint-mode screenshots for the handoff (a colour chip's dwell ring
and the bin's slower ring, both mid-fill) are missing. Nothing about the
feature is in doubt: `npm run verify` reads the same dwell to pass
`the-bin-needs-a-long-hold`, and pins it with a hard wait rather than a shell
expression.

## Root cause

The shell, confirmed by running the same two commands separately. The pair had
been chained in one `bash -c` string, and an `--after` expression carrying `>`
and an arrow function does not survive two layers of quoting: the wait was
handed something other than what was written. The expression itself was always
sound, which is why the same shape passes inside `verify`, where it is a
JavaScript string and never meets a shell.

Nothing was wrong with `shoot`, `--after`, the snapshot or the dwell.

## Correction

Run one station command per shell invocation. The reproduction, as two calls:

```bash
npm run station -- puppet hold --chip clear
```

```bash
npm run station -- shoot captures/paint/bin-ring-midfill.png --crop tray --zoom 2 \
  --after "+window.__station.snapshot().paint.tray.find((c) => c.id === 'clear').dwell > 0.4"
```

## Workflow integration

A gotcha in AGENTS.md against chaining a station command carrying an `--after`
expression behind another command in the same shell string. It cannot be
automated away: the mangling happens before any of this project's code runs, and
the value that arrives is legal JavaScript that simply is not what was typed.

The durable piece that also landed: `puppet hold --at x,y | --chip id | --tile
id [--pinch p] [--gesture g]` exists on the station CLI, so a held pose no
longer needs a throwaway script.

## Proof

The two commands above, run as two calls against the live station, produced
`captures/paint/bin-ring-midfill.png` and - with `color-2` and its own dwell -
`captures/paint/colour-ring-midfill.png`, both showing the arc part-filled
clockwise from twelve o'clock. The wait returned in under a second where the
chained form had timed out at fifteen.
