<div align="center">

# fabel

### Fable 5's way of working a long task — plan first, self-correct every step, never lose the thread — as a model-agnostic agent harness.

<sub><code>fabel</code> — <i>fable</i>, as in the mindset of <b>Fable 5</b>. The thinking is the model's; the engine is any provider.</sub>

[![npm version](https://img.shields.io/npm/v/fabel.svg?color=success)](https://www.npmjs.com/package/fabel)
[![CI](https://github.com/didrod205/fabel/actions/workflows/ci.yml/badge.svg)](https://github.com/didrod205/fabel/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/fabel.svg)](https://www.npmjs.com/package/fabel)
[![zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/fabel?activeTab=dependencies)
[![license](https://img.shields.io/npm/l/fabel.svg)](./LICENSE)

```bash
npm i fabel
```

</div>

The demos are magical. Then you point an agent at a *real* multi-hour task and it
loops on the same step, loses the plan somewhere in a 40-message chat history, and
— when your process restarts — forgets everything and starts over.

**fabel** encodes the way a strong reasoning model works a long task — the
*mindset*, not the model — into a harness: plan first, self-correct every step,
keep the thread, and finish. It's built around two mechanisms and one rule:

> The whole run lives in a single **`RunContext`** — the only source of truth, and
> always serializable. It's checkpointed after **every** step.

From that one rule you get the thing nobody else gives you: **a crash is a pause.**

<sub>The name is about the *thinking*, not a model lock-in — the mindset is Fable 5's, the
engine is whatever `Provider` you hand it (Anthropic, OpenAI-compatible, local, …).</sub>

```
── run run_mqf… ──
  📋 planned 3 steps: outline → draft → edit
  ▶  outline
     → outlined
     💾 checkpoint saved
  ▶  draft
  💥 the process just died (power outage, OOM, deploy, whatever)

── resuming from the last checkpoint ──
  ▶  draft                ← picks up exactly where it died
     💾 checkpoint saved
  ▶  edit
  ✅ done

  steps: outline [done], draft [done], edit [done]
```

```ts
const result = await run(goal, { provider, store });   // crashes at step 2
// ...process restarts...
await resume(result.runId, { provider, store });        // finishes from step 2
```

That's `examples/scripted-run.mjs` — run it with `npm run example`, no API key needed.

## The three things it does that most frameworks don't

### 1. It survives crashes (resumable by construction)

State doesn't live in memory or in a chat transcript — it lives in `RunContext`,
saved to disk after every step. Kill the process at step 47 of 60 and `resume()`
continues from step 47, plan and progress intact. Swap the `FileStore` for
SQLite/Redis by implementing one interface.

### 2. It plans first, then self-corrects (plan ≠ history)

The **plan** is structured data that lives *outside* the conversation, so the model
never loses track of "where am I" in a wall of text. After every step a **reflector**
checks the result against the goal and routes:

| verdict | meaning | what happens |
| --- | --- | --- |
| `on_track` | normal progress | next step |
| `needs_replan` | the result changed the plan's assumptions | replan |
| `blocked` | same obstacle keeps recurring | replan around it / escalate |
| `goal_met` | success criteria satisfied | stop (even with steps left — no busywork) |

And replanning **accumulates**: finished steps are preserved verbatim; only the
remaining work is regenerated. Long tasks move forward instead of restarting.

### 3. It's deterministically testable (genuinely rare for an agent framework)

Because every model call is stateless, you can script the model and assert the
loop's behavior — no network, no flakiness:

```ts
import { run, ScriptedProvider, reply, MemoryStore } from "fabel";

const provider = new ScriptedProvider([
  reply.plan([{ id: "s1", intent: "do the thing" }]),
  reply.text("did it"),
  reply.reflection("goal_met"),
]);

const { status } = await run("do the thing", { provider, store: new MemoryStore() });
expect(status).toBe("done"); // fully deterministic
```

The whole harness is tested this way — crash-recovery, replan-accumulation,
budget halts, the tool loop — all without a single API call.

## Quick start

```ts
import { run, AnthropicProvider } from "fabel";

const result = await run(
  {
    description: "Research the top 3 Rust web frameworks and write a comparison table",
    successCriteria: ["a markdown table comparing 3 frameworks exists"],
    constraints: ["only use information you can verify"],
  },
  { provider: new AnthropicProvider() }, // reads ANTHROPIC_API_KEY
);

console.log(result.status); // "done" | "halted" | "failed"
console.log(result.ctx.plan.steps);
```

```bash
npm i fabel        # zero runtime dependencies
```

Node ≥ 18. The `AnthropicProvider` talks to the API over `fetch` — no SDK. Bring
any model by implementing the `Provider` interface (three methods).

## Tools

```ts
import { run, defineTool, AnthropicProvider } from "fabel";

const search = defineTool(
  "web_search",
  "Search the web and return results.",
  { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  async ({ query }) => ({ ok: true, output: await fetchResults(query) }),
);

await run(goal, { provider: new AnthropicProvider(), tools: [search] });
```

A tool that throws becomes an `Observation`, not a crash — the reflector decides
what to do about it.

## Watch it work

```ts
await run(goal, {
  provider,
  onEvent: (e) => console.log(e.type, e),
  // plan_created · step_start · step_done · reflection · replan · compaction · checkpoint · done · halted
});
```

## It can't run away

Three hard ceilings, checked at the top of every loop turn, plus two recovery
caps — exceed any and it halts cleanly, preserving all work:

```ts
await run(goal, {
  provider,
  maxSteps: 50,            // total step budget
  maxTokens: 2_000_000,    // cumulative token budget
  maxWallClockMs: 1_800_000,
  maxStepAttempts: 3,      // a single step retried this many times → blocked
  maxReplans: 12,          // replan storm → halted
});
```

## How it's built

A `planner ↔ executor ↔ reflector` loop over a serializable `RunContext`:

```
plan → [ budget? → next step → compact? → execute → reflect → checkpoint → route ] → done
```

- **planner** — goal → ordered steps; `replan` accumulates instead of resetting.
- **executor** — runs one step, including a provider-agnostic tool mini-loop.
- **reflector** — heuristics first (cheap, certain), then the model, with JSON
  self-repair and a conservative fallback (a wrong early exit is worse than one
  more loop).
- **contextManager** — folds old turns into digests so long runs stay inside the
  window; the plan is never compacted.
- **store / budget** — checkpoint after every step; guard against runaways.

Every piece is an interface you can replace without touching the core. The full
architecture writeup is in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Roadmap

- A web dashboard that tails a run's events and lets you resume from any checkpoint.
- More providers in-repo (OpenAI-compatible, local) — though it's a 3-method interface.
- Parallel step execution for independent branches of the plan DAG.
- Human-in-the-loop: pause for approval as a first-class step status.

## 💖 Sponsor

Free, MIT, zero-dependency, built in spare time. If it saved your agent from
starting over:

- ⭐ **Star the repo** — it's how the next person building an agent finds it.
- 🍋 **[Sponsor via Lemon Squeezy](https://elab-studio.lemonsqueezy.com/checkout/buy/5d059b89-51d0-456b-b33a-ed56994f7010)** — one-time or recurring.

## License

[MIT](./LICENSE) © fabel contributors
