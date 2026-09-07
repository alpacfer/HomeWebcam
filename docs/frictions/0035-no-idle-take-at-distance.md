# 0035. A far rule with evidence on one side: no idle take exists at two metres

- Date: 2026-09-07
- Status: contained
- Area: perception

## What happened

Asked to make the pinch threshold distance-dependent, the replay found that a
far hand's lines are lost to the tip landmarks and recovered by starting on the
nearest-pair reading: 7 of 8 at two metres, from 4. The rule was gated by hand
size because at arm's length the same reading invents two lines in a near idle
take. Whether it invents lines in a *far* idle take could not be checked. The
corpus has three takes of a hand meaning nothing, all at arm's length, and one
take at two metres, in which every pinch was meant.

## Impact

`CONFIG.paint.pinch.farBelow` shipped with its false-start side unmeasured. If a
far hand at rest, or a far pointing hand with the thumb on the index, reads as
contact on the joints, a visitor two metres back will get lines they did not
mean, and nothing in `npm run check` would say so.

## Root cause

Every task asked for so far has been a person meaning something: lines, a
held pinch, a parting. The idle takes were made close because that is where the
person was standing. Nobody asked for the negative case at the distance the
rule is for, and the corpus test can only assert what a take contains.

## Correction

The rule is gated by size, so nothing changes for any hand the corpus does
cover, and the config comment and ADR 0024 say in so many words that the far
side is unverified. A task is on the station asking for two takes at two
metres: ten seconds of moving about not meaning to paint, then a relaxed point
with the thumb resting on the index; and the eight lines again on the visitor's
1080p profile.

## Workflow integration

Distil both into the corpus when they arrive (`scripts/pinch-corpus.mjs`, which
now carries `size`), the first with `--lines 0`. `tests/pinch-takes.test.ts`
already asserts that the far rule changes no near take and would invent lines
if ungated; the idle far take belongs in the same file with the same shape of
assertion. Until then this record stays `contained`.

## Proof

Pending the takes. What exists: `npm run check`, with the two-metre take at
7 lines under the rule and 4 without; `never-meant-it` at 0 lines under the
rule and above 0 with the size gate removed.
