import type { Goal, Plan, Observation, Message } from "../core/types.js";

const PLAN_SYSTEM = `You are a planning module. Decompose a goal into an ordered list of executable steps.

Rules:
- Each step has a single, verifiable intent.
- If a step is too big, split it further.
- Never create a step that violates a constraint.
- Order matters; use dependsOn (step ids) when a step needs an earlier one.
- Respond with ONLY this JSON. No prose, no code fences:
{ "steps": [ { "id": "s1", "intent": "...", "dependsOn": [] } ] }`;

export function planPrompt(goal: Goal): Message[] {
  return [
    { role: "system", content: PLAN_SYSTEM },
    {
      role: "user",
      content: [
        `Goal: ${goal.description}`,
        goal.constraints?.length ? `Constraints: ${goal.constraints.join("; ")}` : "",
        goal.successCriteria?.length ? `Done when: ${goal.successCriteria.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

const REPLAN_SYSTEM = `You are a planning module revising a plan that hit an obstacle.

CRITICAL: steps already completed are DONE — do not redo them. Their results are given.
Produce ONLY the steps still needed to reach the goal from the current state.
Account for the obstacle so the new steps actually get unblocked.
Respond with ONLY this JSON. No prose, no code fences:
{ "steps": [ { "id": "n1", "intent": "...", "dependsOn": [] } ] }`;

export function replanPrompt(plan: Plan, obs: Observation, notes: string, goal: Goal): Message[] {
  const done = plan.steps.filter((s) => s.status === "done");
  const blocked = plan.steps.find((s) => s.id === obs.stepId);
  return [
    { role: "system", content: REPLAN_SYSTEM },
    {
      role: "user",
      content: [
        `Goal: ${goal.description}`,
        goal.successCriteria?.length ? `Done when: ${goal.successCriteria.join("; ")}` : "",
        "",
        "Already completed (do NOT redo):",
        done.length ? done.map((s) => `  ✓ [${s.id}] ${s.intent}${s.result ? ` → ${s.result}` : ""}`).join("\n") : "  (nothing yet)",
        "",
        `The step that got stuck: ${blocked ? blocked.intent : obs.stepId}`,
        `What happened: ${obs.error ?? obs.output}`,
        `Reflection: ${notes}`,
        "",
        "Give the remaining steps from here.",
      ].join("\n"),
    },
  ];
}
