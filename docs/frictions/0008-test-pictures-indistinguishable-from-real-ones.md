# 0008. Test pictures could not be told apart from a visitor's own

- Date: 2026-09-04
- Status: integrated
- Area: privacy

## What happened

Verifying the picture flow means pressing `c`, which runs the real capture path and writes a real
photograph of whoever is standing at the station into `captures/`. Twelve of them accumulated during
this change. The workflow requires the disposable test artifact to be removed afterwards, and by
then two of the twelve predated the first scripted keypress, one landed during a window in which
someone completed a genuine Open Palm hold, and the rest were mine. Filename and timestamp are all
there is to go on.

## Impact

The cleanup step could not be completed safely. Deleting the wrong file destroys a photograph of a
person in their own home, and nothing in the capture makes it recoverable or identifiable as a test.

## Root cause

The keyboard capture path is deliberately identical to the gesture path - that is what makes it a
useful test hook - so its output is identical too. The workflow assumed a test artifact is
distinguishable from user data, which holds for a scratch file and does not hold for a photograph
taken by a camera pointed at a person.

## Correction

*(2026-09-04, addendum: superseded by the automation described below.)*

Nothing was deleted. The files created during the verification window are named in the handoff with
the exact command to remove them, so the decision belongs to the person in the photographs.

## Workflow integration

`docs/development-workflow.md` requires listing `captures/picture-*.png` **before** exercising the
picture flow, so the delta afterwards is unambiguous and can be removed without judgement calls.
Where verification produces personal data that cannot be distinguished from real data, the default is
to leave it and hand the decision over, never to guess.

The judgement call was then removed entirely. `npm run verify` (friction 0009) lists the directory
before it starts, holds the frame loop with the puppet for the whole run so nothing else can fire the
shutter, and deletes exactly the delta afterwards, reporting the count. A verification run therefore
leaves no photographs behind, and no photograph it did not take is ever a candidate for deletion.

## Proof

No capture was deleted by hand in this change. `npm run verify` reports
`[verify] removed 1 picture(s) taken by this run` and `captures/` is unchanged apart from that.
The dated addendum above supersedes the follow-up this record originally left open.
