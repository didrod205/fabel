# Contributing to fable5-mind

Thanks for your interest! The most valuable contributions: a **new Provider**, a
sharper **reflector heuristic**, a **Store backend**, or a failing test that
exposes a loop that doesn't terminate.

## Getting started

```bash
git clone https://github.com/didrod205/fable5-mind.git
cd fable5-mind
npm install
npm test          # vitest — the whole loop is tested with a ScriptedProvider, no network
npm run typecheck
npm run build
npm run example   # the crash-resume demo (no API key)
```

## Project layout

```
src/
  core/
    types.ts      # the entire type surface (everything is serializable data)
    json.ts       # extract/parse JSON from model output, with self-repair
    loop.ts       # the plan ↔ execute ↔ reflect orchestration
  providers/
    provider.ts   # Provider interface + retry wrapper + ScriptedProvider + reply
    anthropic.ts  # default provider over fetch (no SDK)
  planner/        # plan / replan (accumulate) + prompts
  executor/       # step execution + tool mini-loop + ToolRegistry
  reflector/      # heuristic + model verdicts + prompts
  memory/
    store.ts      # FileStore / MemoryStore
    context.ts    # ContextManager (digest compaction)
  run/
    context.ts    # RunContext create/update + nextPendingStep
    budget.ts     # the guards
  config/defaults.ts
  index.ts        # run() / resume() / runWith() + public surface
tests/            # ScriptedProvider-driven specs (deterministic)
examples/         # scripted-run.mjs (crash → resume)
```

## The rules this repo lives by

1. **`RunContext` is the only source of truth, and always serializable.** No live
   state may hide in a closure or a class field that isn't on `ctx`. The
   "disk == memory" invariant test must stay green.
2. **Every loop must provably terminate.** New behavior that can recur needs a
   counter and a cap, plus a test that proves the cap fires (see
   `tests/self-correct.test.ts`).
3. **Deterministically testable.** Drive new behavior with a `ScriptedProvider` and
   assert the loop — no live API calls in the test suite.
4. **Zero runtime dependencies.** The core stays dependency-free; the
   `AnthropicProvider` uses global `fetch`.

## Adding a provider

Implement `complete(req)` and `estimateTokens(messages)`. Map the harness's
plain `{role, content}` messages and `ToolSchema[]` to your backend, and map the
response back to `CompletionResult`. Use `withRetry` for transient errors.

## Quality bar

- [ ] `npm run typecheck && npm test && npm run build` pass.
- [ ] New loops have a guard + a test proving it terminates.
- [ ] The core imports no third-party runtime packages.
