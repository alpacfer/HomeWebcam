# 0001. Active debug server bypassed

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

The station server was already running on port 5173 and the user had opened HomeWebcam. The visual
verification path checked only for a controllable Chrome page on port 9222. When that endpoint was
not available, isolated headless browsers with a synthetic camera were launched without first
treating the running server and user-opened page as authoritative.

## Impact

Verification did not reuse the user's intended runtime context. It produced evidence from a
different browser and camera source, risked competing for the exclusive camera, and made the user
correct the workflow explicitly.

## Root cause

The screenshot tool used “controllable browser exists” as a proxy for “station is running.” Those
are different facts. Its implicit fallback hid the distinction instead of failing closed.

## Correction

The existing server remains the authoritative debug server. Disposable synthetic capture files
created during verification were removed; pre-existing files were preserved.

## Workflow integration

- `npm run preflight` reports server and browser-control state independently.
- `npm run screenshot` refuses implicit browser or camera fallback when the server is running but
  its page is not controllable.
- `AGENTS.md` and `docs/development-workflow.md` require reuse of an active server and make isolated
  browsers opt-in only.

## Proof

With port 5173 responding and port 9222 unavailable, `npm run preflight` reports the active debug
server and the blocked screenshot state. `npm run screenshot` exits before spawning Chrome and
explains how to restore control or explicitly request isolation.
