import { describe, it, expect } from "vitest";
import { reply } from "../src/index.js";
import { runScripted } from "./helpers.js";

const ERROR = { content: "", stopReason: "error" as const };

describe("self-correction", () => {
  it("retries a failing step, then declares it blocked and replans around it", async () => {
    const { result } = await runScripted(
      "do the hard thing",
      [
        reply.plan([{ id: "s1", intent: "the hard thing" }]),
        ERROR, // execute s1 — fails
        reply.reflection("on_track", "retry"), // attempts=1, retry
        ERROR, // execute s1 — fails again (attempts=2 → heuristic blocked, no model call)
        reply.plan([{ id: "alt", intent: "a different approach" }]), // replan
        reply.text("worked this time"), // execute alt
        reply.reflection("on_track"), // reflect alt → plan complete
      ],
      { maxStepAttempts: 2 },
    );

    expect(result.status).toBe("done");
    expect(result.ctx.plan.revision).toBe(1);
    expect(result.ctx.budget.replans).toBe(1);
    // the unsolvable step was replaced, not retried forever
    expect(result.ctx.plan.steps.some((s) => s.intent === "a different approach" && s.status === "done")).toBe(true);
    expect(result.ctx.plan.steps.some((s) => s.id === "s1")).toBe(false);
  });

  it("replan ACCUMULATES — completed steps survive, only remaining work is regenerated", async () => {
    const { result } = await runScripted("research and write", [
      reply.plan([{ id: "s1", intent: "research" }, { id: "s2", intent: "write based on old assumptions" }]),
      reply.text("research found X, which changes everything"),
      reply.reflection("needs_replan", "X invalidates step 2"),
      reply.plan([{ id: "r1a", intent: "write based on X" }]), // replan: note s2 is NOT here
      reply.text("wrote based on X"),
      reply.reflection("on_track"),
    ]);

    expect(result.status).toBe("done");
    expect(result.ctx.plan.revision).toBe(1);
    // the completed research step is preserved verbatim with its result
    const research = result.ctx.plan.steps.find((s) => s.id === "s1");
    expect(research?.status).toBe("done");
    expect(research?.result).toContain("X");
    // the stale step was dropped; the regenerated one ran
    expect(result.ctx.plan.steps.some((s) => s.intent === "write based on old assumptions")).toBe(false);
    expect(result.ctx.plan.steps.some((s) => s.intent === "write based on X" && s.status === "done")).toBe(true);
  });

  it("a replan storm is capped by maxReplans → halted", async () => {
    // Every reflection demands a replan; the guard must stop it.
    const responses = [reply.plan([{ id: "s1", intent: "loop forever" }])];
    for (let i = 0; i < 20; i++) {
      responses.push(reply.text(`attempt ${i}`));
      responses.push(reply.reflection("needs_replan", "again"));
      responses.push(reply.plan([{ id: `r${i}`, intent: "still going" }]));
    }
    const { result } = await runScripted("impossible", responses, { maxReplans: 3 });
    expect(result.status).toBe("halted");
    expect(result.reason).toMatch(/replan budget/);
  });
});
