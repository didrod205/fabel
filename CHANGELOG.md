# Changelog

All notable changes to actually-finishes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06-15

### Added

- First public release.
- The `planner ↔ executor ↔ reflector` loop over a single serializable
  `RunContext`, checkpointed after every step.
- `run(goal, config)`, `resume(runId, config)`, and `runWith(ctx, config)` —
  crash recovery by construction.
- Planner with **accumulating** replan (completed steps preserved; only remaining
  work regenerated) and JSON-schema prompting with self-repair.
- Reflector with a heuristic + model hybrid (forced `blocked` after
  `maxStepAttempts` without a model call), four verdicts including early
  `goal_met`, and a conservative parse fallback.
- Executor with a provider-agnostic tool mini-loop; thrown tools become
  observations, not crashes.
- ContextManager that folds old turns into digests (and meta-compacts digests),
  never touching the plan.
- `FileStore` (atomic write-then-rename) and `MemoryStore`.
- Budget guards: `maxSteps`, `maxTokens`, `maxWallClockMs`, `maxStepAttempts`,
  `maxReplans` — clean `halted` with all work preserved.
- `Provider` abstraction with `AnthropicProvider` (via `fetch`, no SDK) and a
  `ScriptedProvider` that makes agents **deterministically testable**.
- Observable via an `onEvent` stream.
- Zero runtime dependencies. 20 tests covering crash-resume, replan accumulation,
  self-correction, budgets, tools, and JSON defense.

[0.1.0]: https://github.com/didrod205/actually-finishes/releases/tag/v0.1.0
