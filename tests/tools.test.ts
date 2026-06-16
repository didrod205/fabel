import { describe, it, expect } from "vitest";
import { reply, defineTool } from "../src/index.js";
import { runScripted } from "./helpers.js";

describe("tool use", () => {
  it("runs the tool mini-loop: call → run handler → feed result back → finish", async () => {
    let receivedInput: unknown = null;
    const sum = defineTool(
      "sum",
      "add two numbers",
      { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
      (input) => {
        receivedInput = input;
        const { a, b } = input as { a: number; b: number };
        return { ok: true, output: String(a + b) };
      },
    );

    const { result } = await runScripted(
      "add 2 and 3",
      [
        reply.plan([{ id: "s1", intent: "compute the sum" }]),
        reply.toolUse([{ id: "t1", name: "sum", input: { a: 2, b: 3 } }]),
        reply.text("the total is 5"),
        reply.reflection("goal_met"),
      ],
      { tools: [sum] },
    );

    expect(result.status).toBe("done");
    expect(receivedInput).toEqual({ a: 2, b: 3 }); // the handler actually ran
    expect(result.ctx.plan.steps[0]!.result).toBe("the total is 5");
  });

  it("a thrown tool becomes an observation, not a crash", async () => {
    const boom = defineTool("boom", "always throws", { type: "object" }, () => {
      throw new Error("kaboom");
    });
    const { result } = await runScripted(
      "use the broken tool",
      [
        reply.plan([{ id: "s1", intent: "call boom" }]),
        reply.toolUse([{ id: "t1", name: "boom", input: {} }]),
        reply.text("the tool failed but I handled it"),
        reply.reflection("on_track"),
      ],
      { tools: [boom] },
    );
    expect(result.status).toBe("done"); // loop survived the throwing tool
  });
});
