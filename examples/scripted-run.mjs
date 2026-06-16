// A no-API-key demo of the one thing most agent frameworks can't do: survive a
// crash. We script the model (so it's deterministic), let the process "die"
// mid-run, then resume from the last checkpoint and finish.
//
//   npm run example
//
import { runWith, resume, createContext, resolveSerializable, MemoryStore, ScriptedProvider, reply } from "../dist/index.js";

// A provider that replays a script, then throws — simulating a crash mid-run.
class CrashAfter {
  name = "crash-after";
  constructor(responses, crashAt) {
    this.inner = new ScriptedProvider(responses);
    this.crashAt = crashAt;
    this.calls = 0;
  }
  async complete(req) {
    this.calls++;
    if (this.calls === this.crashAt) throw new Error("💥 the process just died (power outage, OOM, deploy, whatever)");
    return this.inner.complete(req);
  }
  estimateTokens(m) {
    return this.inner.estimateTokens(m);
  }
}

const log = (e) => {
  const m = {
    plan_created: () => `📋 planned ${e.plan?.steps.length} steps: ${e.plan?.steps.map((s) => s.intent).join(" → ")}`,
    step_start: () => `▶  ${e.step.intent}`,
    step_done: () => `   → ${e.observation.output}`,
    reflection: () => `   reflect: ${e.reflection.progress}`,
    checkpoint: () => `   💾 checkpoint saved`,
    replan: () => `🔁 replan (rev ${e.revision})`,
    done: () => `✅ done — ${e.reason}`,
    halted: () => `⛔ halted — ${e.reason}`,
  }[e.type];
  if (m) console.log("  " + m());
};

const store = new MemoryStore();
const goal = { description: "Publish a short blog post", successCriteria: ["an edited post exists"] };
const ctx = createContext(goal, resolveSerializable({}));
const runId = ctx.runId;

// First attempt — crashes during the reflect after step 2.
const crashing = new CrashAfter(
  [
    reply.plan([
      { id: "s1", intent: "Write an outline" },
      { id: "s2", intent: "Write the draft", dependsOn: ["s1"] },
      { id: "s3", intent: "Edit and finalize", dependsOn: ["s2"] },
    ]),
    reply.text("outline: intro, body, conclusion"), // execute s1
    reply.reflection("on_track", "outline looks good"), // reflect s1
    reply.text("draft written (~400 words)"), // execute s2
  ],
  5, // throw on the 5th call (reflect after s2)
);

console.log(`\n── run ${runId} ──`);
try {
  await runWith(ctx, { provider: crashing, store, onEvent: log });
} catch (err) {
  console.log(`  ${err.message}`);
  console.log("  (the last good checkpoint is on disk — step 1 done, step 2 not yet committed)\n");
}

// Resume from the checkpoint with a fresh provider. It picks up at step 2.
console.log("── resuming from the last checkpoint ──");
const finishing = new ScriptedProvider([
  reply.text("draft written (~400 words)"), // re-do s2 (its result was never committed)
  reply.reflection("on_track", "draft is solid"),
  reply.text("edited: tightened intro, fixed typos"), // s3
  reply.reflection("goal_met", "post is written and edited"),
]);

const result = await resume(runId, { provider: finishing, store, onEvent: log });

console.log(`\nfinal: ${result.status}`);
console.log("steps:", result.ctx.plan.steps.map((s) => `${s.intent} [${s.status}]`).join(", "));
