import { describe, it, expect } from "vitest";
import { reply } from "../src/index.js";
import { runScripted } from "./helpers.js";

describe("the core loop", () => {
  it("plans, executes every step, and finishes when the plan is complete", async () => {
    const { result } = await runScripted("ship a feature", [
      reply.plan([{ id: "s1", intent: "design it" }, { id: "s2", intent: "build it" }]),
      reply.text("designed"),
      reply.reflection("on_track"),
      reply.text("built"),
      reply.reflection("on_track"),
    ]);
    expect(result.status).toBe("done");
    expect(result.ctx.plan.steps.map((s) => s.status)).toEqual(["done", "done"]);
    expect(result.ctx.plan.steps[0]!.result).toBe("designed");
    expect(result.ctx.budget.steps).toBe(2);
  });

  it("exits early on goal_met even with steps left (no busywork)", async () => {
    const { result } = await runScripted("find the answer", [
      reply.plan([{ id: "s1", intent: "look it up" }, { id: "s2", intent: "double-check" }, { id: "s3", intent: "triple-check" }]),
      reply.text("the answer is 42"),
      reply.reflection("goal_met", "already have the answer"),
    ]);
    expect(result.status).toBe("done");
    expect(result.ctx.plan.steps[0]!.status).toBe("done");
    expect(result.ctx.plan.steps[1]!.status).toBe("pending"); // never run
  });

  it("emits a legible event stream", async () => {
    const { events } = await runScripted("x", [
      reply.plan([{ id: "s1", intent: "do x" }]),
      reply.text("did x"),
      reply.reflection("on_track"),
    ]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("plan_created");
    expect(types).toContain("step_start");
    expect(types).toContain("checkpoint");
    expect(types).toContain("done");
  });

  it("checkpoints after every step", async () => {
    const { store, result } = await runScripted("x", [
      reply.plan([{ id: "s1", intent: "a" }, { id: "s2", intent: "b" }]),
      reply.text("a done"),
      reply.reflection("on_track"),
      reply.text("b done"),
      reply.reflection("on_track"),
    ]);
    const saved = await store.load(result.ctx.runId);
    expect(saved).not.toBeNull();
    expect(saved!.plan.steps.every((s) => s.status === "done")).toBe(true);
    // disk == memory (the invariant)
    expect(JSON.stringify(saved)).toBe(JSON.stringify(result.ctx));
  });
});

describe("budget guards", () => {
  it("halts (cleanly, without losing work) when the step budget is spent", async () => {
    const { result } = await runScripted(
      "endless",
      [reply.plan([{ id: "s1", intent: "a" }, { id: "s2", intent: "b" }]), reply.text("a"), reply.reflection("on_track")],
      { maxSteps: 1 },
    );
    expect(result.status).toBe("halted");
    expect(result.reason).toMatch(/step budget/);
    expect(result.ctx.plan.steps[0]!.status).toBe("done"); // the work done so far is preserved
  });
});
