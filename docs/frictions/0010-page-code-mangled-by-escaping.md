# 0010. Page code was mangled by three layers of escaping

- Date: 2026-09-04
- Status: integrated
- Area: tooling

## What happened

A pixel probe built its page-side JavaScript as a template literal inside a
script that was itself written through a shell heredoc and a Python string. The
regex `/[\d.]+/g`, meant to pull the numbers out of `rgb(151, 238, 218)`, lost a
backslash on the way and arrived in Chrome as `/[d.]+/g`. That matches the
letter `d`, which the string does not contain, so it returned null and the probe
threw.

## Impact

A verification tool reported a failure that had nothing to do with the thing
being verified, and the first two attempts to fix it changed the wrong code.

## Root cause

Code was being generated, not written: shell heredoc, then Python string
literal, then JavaScript template literal, then the page. Each layer has its own
escape rules, and a regex that survives two of them is still wrong without
looking wrong.

## Correction

The regex moved out of the page and into the tool, where it is ordinary source.
The colour it parses is passed in as `JSON.stringify`d numbers.

## Workflow integration

`scripts/station.mjs` now keeps page-side snippets to the minimum that must run
in the page, and passes everything else across as JSON data. The rule is written
into the comment at the probe: values cross the boundary as data, never as
interpolated code. Anything longer than a few lines belongs in `src/debug/`,
where TypeScript checks it and `npm run check` sees it.

## Proof

`npm run station -- probe .countdown__ring --ring` reports the filled arc and
its direction, and the same code path is the `the-ring-fills-clockwise` check in
`npm run verify`.
