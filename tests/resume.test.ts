import { describe, it, expect } from "vitest";
import { reply, runWith, resume, createContext, resolveSerializable, MemoryStore, ScriptedProvider } from "./helpers.js";
import type { Provider, RunEvent } from "../src/index.js";

/** A scripted provider that throws on the Nth call — simulating a process crash. */
class CrashAfter implements Provider {
  name = "crash";
  private inner: ScriptedProvider;
  private calls = 0;
  constructor(responses: ConstructorParameters<typeof ScriptedProvider>[0], private crashAt: number) {
    this.inner = new ScriptedProvider(responses);
  }
  async complete(req: Parameters<Provider["complete"]>[0]) {
    this.calls++;
    if (this.calls === this.crashAt) throw new Error("process died");
    return this.inner.complete(req);
  }
  estimateTokens(m: Parameters<Provider["estimateTokens"]>[0]) {
    return this.inner.estimateTokens(m);
  }
}

describe("crash recovery — the headline feature", () => {
  it("resumes from the last checkpoint after a crash, losing no committed progress", async () => {
    const store = new MemoryStore();
    const events: RunEvent[] = [];
    const ctx = createContext({ description: "write a post", successCriteria: ["edited post exists"] }, resolveSerializable({}));
    const runId = ctx.runId;

    // Crash during the reflect after step 2 (the 5th model call).
    const crashing = new CrashAfter(
      [
        reply.plan([{ id: "s1", intent: "outline" }, { id: "s2", intent: "draft", dependsOn: ["s1"] }, { id: "s3", intent: "edit", dependsOn: ["s2"] }]),
        reply.text("outlined"),
        reply.reflection("on_track"),
        reply.text("drafted"),
      ],
      5,
    );

    await expect(runWith(ctx, { provider: crashing, store, onEvent: (e) => events.push(e) })).rejects.toThrow(/died/);

    // The checkpoint on disk should have step 1 done, step 2 NOT yet committed.
    const checkpoint = await store.load(runId);
    expect(checkpoint!.plan.steps[0]!.status).toBe("done");
    expect(checkpoint!.plan.steps[1]!.status).toBe("pending");

    // Resume with a fresh provider — it picks up exactly at step 2.
    const finishing = new ScriptedProvider([
      reply.text("drafted (again)"),
      reply.reflection("on_track"),
      reply.text("edited"),
      reply.reflection("goal_met", "post done"),
    ]);
    const result = await resume(runId, { provider: finishing, store });

    expect(result.status).toBe("done");
    expect(result.ctx.plan.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    // step 1's original result survived the crash (it was never re-run)
    expect(result.ctx.plan.steps[0]!.result).toBe("outlined");
    expect(result.ctx.runId).toBe(runId);
  });

  it("resume throws for an unknown run id", async () => {
    const store = new MemoryStore();
    await expect(resume("nope", { provider: new ScriptedProvider([]), store })).rejects.toThrow(/No saved run/);
  });
});
