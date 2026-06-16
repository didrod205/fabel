import type { RunContext } from "../core/types.js";

export interface BudgetVerdict {
  exceeded: boolean;
  reason?: string;
}

/**
 * The three top-level guards, checked at the very top of every loop turn. The
 * per-step (attempts) and replan guards live alongside the reflector; this is the
 * hard ceiling that stops a runaway run from spending forever.
 */
export function checkBudget(ctx: RunContext): BudgetVerdict {
  const c = ctx.config;
  const b = ctx.budget;
  if (b.steps >= c.maxSteps) {
    return { exceeded: true, reason: `step budget exhausted (${b.steps}/${c.maxSteps} steps)` };
  }
  if (b.tokens >= c.maxTokens) {
    return { exceeded: true, reason: `token budget exhausted (${b.tokens}/${c.maxTokens} tokens)` };
  }
  const elapsed = Date.now() - b.startedAtMs;
  if (elapsed >= c.maxWallClockMs) {
    return { exceeded: true, reason: `wall-clock budget exhausted (${Math.round(elapsed / 1000)}s/${Math.round(c.maxWallClockMs / 1000)}s)` };
  }
  if (b.replans >= c.maxReplans) {
    return { exceeded: true, reason: `replan budget exhausted (${b.replans}/${c.maxReplans} replans)` };
  }
  return { exceeded: false };
}
