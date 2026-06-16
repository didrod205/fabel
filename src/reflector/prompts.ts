import type { Plan, Observation, Goal, Step, Message } from "../core/types.js";

const REFLECT_SYSTEM = `You are the progress supervisor of an autonomous agent. You just saw the result of one step. Judge what should happen next — pick exactly ONE:

- goal_met     — the goal's success criteria are ALL satisfied. (Allowed even if planned steps remain — don't pad work that's already done.)
- needs_replan — the step worked, but its result changed the assumptions the remaining plan was built on. The plan needs revising.
- blocked      — the same obstacle keeps recurring, or there is no path forward with the current plan.
- on_track     — normal forward progress; continue to the next step.

Respond with ONLY this JSON. No prose, no code fences:
{ "progress": "on_track" | "needs_replan" | "blocked" | "goal_met", "notes": "1-2 sentence reason", "confidence": 0.0 }`;

function planSummary(plan: Plan): string {
  const done = plan.steps.filter((s) => s.status === "done");
  const pending = plan.steps.filter((s) => s.status === "pending");
  const lines: string[] = [];
  if (done.length) lines.push("Done:", ...done.map((s) => `  ✓ ${s.intent}`));
  if (pending.length) lines.push("Remaining:", ...pending.map((s) => `  • ${s.intent}`));
  return lines.join("\n") || "(no steps)";
}

export function reflectPrompt(plan: Plan, obs: Observation, goal: Goal, step: Step | undefined): Message[] {
  return [
    { role: "system", content: REFLECT_SYSTEM },
    {
      role: "user",
      content: [
        `Goal: ${goal.description}`,
        goal.successCriteria?.length ? `Done when: ${goal.successCriteria.join("; ")}` : "",
        "",
        "Current plan:",
        planSummary(plan),
        "",
        `Step just run: ${step ? step.intent : obs.stepId}`,
        `Succeeded: ${obs.ok}`,
        `Result: ${obs.error ? `ERROR — ${obs.error}` : obs.output}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}
