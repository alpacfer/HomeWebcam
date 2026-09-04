# Project documentation

Documentation has three different jobs here. Keeping them separate makes it clear what can be
edited and what history must be preserved.

- [Development workflow](development-workflow.md) is the mandatory sequence for changing and
  verifying the station.
- [Architecture](architecture.md) explains the current system and its boundaries.
- [Hardware](hardware.md) records measured station capabilities.
- [ADRs](adr/README.md) are append-only records of choices and tradeoffs.
- [Frictions](frictions/README.md) are append-only records of anything that interrupts the expected
  workflow, plus the fix integrated back into the project.
- [Roadmap](roadmap.md) describes planned product work, not current behavior.

`AGENTS.md` is the concise operational contract. These documents provide the detail behind it. If
they disagree, stop and reconcile them in the same change rather than choosing the convenient one.
