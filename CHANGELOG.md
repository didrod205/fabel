# Changelog

All notable changes to oh-my-fable are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-06-22

### Added

- **CLI providers are now first-class, not text-only.** `claudeCode()` /
  `--provider claude` gains:
  - `--output-format json` parsing → **real cost (`costUsd`), token usage, and a
    `session_id`** on the result, instead of a `length / 4` estimate.
  - **Tool execution on your subscription** — `{ tools: true }` / `--cli-tools`
    lets Claude run its own Read/Write/Edit/Bash during a step, with
    `permissionMode` (`acceptEdits` default) and a custom `--allow` allowlist. A
    durable, tool-using agent with **no API key**; oh-my-fable stays the
    planner/reflector around it.
  - `--model` / `model` passthrough, `--append-system-prompt` for clean prompts,
    opt-in `--json-schema` (`jsonSchema`) for validated structured output, and a
    `resumeSessionId` to continue a prior `claude` session.
  - `codexCli()` gains `model`, `--sandbox`, and `--ask-for-approval` (`tools: true`
    → workspace-write, unattended).
  - New exported helpers `parseClaudeJson`, `claudeRequestArgs`,
    `DEFAULT_CLAUDE_TOOLS`; `CompletionResult` gains optional `sessionId` / `costUsd`.
- **`oh-my-fable show <runId>`** — print a saved run's plan, per-step results, and
  budget as a timeline, straight from its serialized `RunContext`.

### Fixed

- **`AnthropicProvider` now works with the flagship models.** It no longer sends
  `temperature` to models that reject it (Opus 4.7/4.8, Fable 5, Mythos 5) — those
  requests previously failed with **HTTP 400**. `temperature` is still sent to
  models that accept it (e.g. Sonnet 4.6).

### Changed

- **`AnthropicProvider` prompt-caches the system + tools prefix by default**
  (`cache_control: ephemeral`), so a long durable run pays ~10× less on the prefix
  it replays every step. `tokensIn` now includes cache-read + cache-write tokens
  (true context size). Disable with `{ cache: false }`.
- Opt-in `{ thinking: "adaptive", effort }` on `AnthropicProvider` for harder
  planning/reflection on 4.7+/Fable.

## [0.1.2] — 2026-06-16

### Added

- **`CliProvider`** (+ `claudeCode()` / `codexCli()`) — drives an agentic CLI
  (Claude Code, Codex) in non-interactive mode by shelling out to it, so people who
  use those tools via a **subscription login can run agents with no separate API
  key** — it rides whatever auth the CLI already has. CLI: `--provider claude` /
  `--provider codex`. (Text-only: pure-reasoning, no `--tools`.)
- **`OpenAICompatProvider`** (+ an `ollama()` helper) — talks the OpenAI
  chat-completions format, so it works with **local models (Ollama, LM Studio) with
  no API key at all**, plus OpenAI, OpenRouter, Groq, Together, llama.cpp, and more.
  The CLI selects it via `--provider ollama|openai` or `--base-url <url>`, so you no
  longer need an Anthropic key to use it from the terminal.

## [0.1.1] — 2026-06-16

### Added

- A zero-dependency **CLI** (`oh-my-fable` / `omf`) so you can drive an agent from
  the terminal without writing code: `run "<goal>"`, `resume <runId>`, `list`, and
  a no-API-key `demo` — with a live event stream of the plan and per-step
  reflections.
- An opt-in, sandboxed **`fs` toolset** (`--tools fs` / `fsTools()`):
  `read_file` / `write_file` / `list_dir`, confined to the working directory, so a
  terminal run can produce real artifacts. Also exported for library use.

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

[0.1.2]: https://github.com/didrod205/oh-my-fable/releases/tag/v0.1.2
[0.1.1]: https://github.com/didrod205/oh-my-fable/releases/tag/v0.1.1
[0.1.0]: https://github.com/didrod205/oh-my-fable/releases/tag/v0.1.0
