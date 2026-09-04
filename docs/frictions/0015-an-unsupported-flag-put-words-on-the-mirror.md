# 0015. An unsupported flag put words on the mirror

- Date: 2026-09-04
- Status: integrated
- Area: UI

## What happened

After the station browser was relaunched, Chrome drew a banner across the top of
the window: "You are using an unsupported command-line flag:
--use-fake-ui-for-media-stream. Stability and security will suffer." It pushed
the interface down and was reported by the user, not noticed by the tooling.

`start.sh` had always passed that flag. It auto-accepts every capture request,
which is how the station avoided a camera prompt on startup.

## Impact

The one interface in this project designed to contain no words had a sentence
of browser chrome pinned to the top of it, in the hallway, for visitors. It also
stole vertical space from a layout measured in screen heights.

`npm run verify` has a `no-visible-text` check precisely to keep the interface
wordless, and it passed throughout: it reads DOM text, and this was browser
chrome. The guard could not see the violation it exists to prevent.

## Root cause

The flag was the cheapest way to skip a permission prompt, and its cost was
invisible from the command line. Dropping it naively is not a fix either:
because it bypasses the permission system, Chrome never stores a decision, so
removing it turns the banner into a prompt.

## Correction

`scripts/seed-camera-permission.mjs` writes the camera content setting for the
station origin into the Chrome profile - the same record the permission prompt
would have written. `start.sh` calls it before launching and no longer passes
`--use-fake-ui-for-media-stream`. Failure to seed is non-fatal: the station
then asks once and remembers the answer itself.

`start.sh` also passes `--start-fullscreen`, so the window fills the screen
deterministically instead of inheriting whatever bounds the profile last
remembered.

`scripts/screenshot.mjs` keeps the flag: its `--new-browser` path is an
explicitly isolated browser, where auto-accept is the point and no visitor sees
the window.

## Workflow integration

Chrome is launched from exactly one place, and that place now grants the camera
the way a person would. A visible-text regression in browser chrome still
cannot be caught by `verify`; the check's limit is recorded here so the next
person does not read its pass as proof the screen is wordless.

## Proof

The launched process carries no `fake-ui` flag
(`tr '\0' '\n' < /proc/$PID/cmdline | grep -c fake-ui` returns 0), the camera
starts with no prompt, and `innerHeight` equals `outerHeight` equals 1080 -
inner matching outer at full screen height means there is no infobar and no
window chrome at all.
