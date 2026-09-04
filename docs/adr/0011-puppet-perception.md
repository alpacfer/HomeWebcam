# 0011. Interactions are verified with invented hands

## Context

Every interaction this station has is driven by a hand. Verifying one therefore
meant a person standing in the hallway waving at the camera, and an agent or a
developer watching the page until the right thing happened. One change cost
seven minutes of polling for three screenshots, and the states that need a held
gesture could not be reached at all without asking someone to hold it.

The alternative on offer was worse: assert on the physics in a unit test and
call the interaction verified, which is a claim about arithmetic dressed up as
a claim about the station.

## Decision

A scripted perception source. `src/debug/puppet.ts` produces `PerceptionFrame`s
from a scenario - poses, gestures and the milliseconds between them - and
`src/debug/hand-fixtures.ts` shapes each one into the 21 landmarks MediaPipe
would have produced. `app.ts` takes its frame from the puppet instead of the
detectors whenever one is armed. Nothing above the perception layer can tell,
which is what makes the test worth anything.

Scenario durations are derived from `CONFIG`, not written out, so a scenario
written to outlast a hold still outlasts it after the hold changes.

The whole thing lives behind `import.meta.env.DEV` and is reached through
`window.__station`, installed by `src/debug/bridge.ts`.

## Consequences

**A puppet run proves interaction, rendering and wiring. It proves nothing
about perception.** The hands are exactly as confident and as steady as we say,
so they can show that a held Victory opens Picture mode and can never show that
the model recognises a Victory. Anything claimed about detection, tracking,
confidence or frame cost needs a camera and a person.

Because a screenshot is evidence, the station wears an unmissable badge in every
mode while the puppet drives, and the snapshot reports
`perceptionSource: "puppet"`. Evidence that cannot be told apart from the real
thing is worse than no evidence.

`npm run verify` drives the full interaction set in about half a minute. It also
deletes the photographs its own shutter test takes, which is the automation
friction 0008 asked for.

## Alternatives

Recorded camera sessions were rejected: a recording of a hallway is a recording
of a person, it cannot be committed, and it goes stale the moment a threshold
moves.

Calling `ExperienceUi.update` directly from a unit test covers some of this and
is worth having - `tests/dom/experience.test.ts` does exactly that - but it runs
against a DOM with no compositor, so it cannot see a ring filling backwards, a
panel that never moved, or glass that stopped refracting.

Leaving it to a human was the status quo. It does not scale to an interface
whose whole surface is gestures, and it silently encourages the cheaper lie:
verifying the parts that are easy to reach and describing the rest.
