import type { Goal, RunConfig, RunResult, RunContext, SerializableConfig } from "./core/types.js";
import { resolveSerializable } from "./config/defaults.js";
import { createContext } from "./run/context.js";
import { FileStore } from "./memory/store.js";
import { ToolRegistry } from "./executor/tools.js";
import { Planner } from "./planner/planner.js";
import { Executor } from "./executor/executor.js";
import { Reflector } from "./reflector/reflector.js";
import { ContextManager } from "./memory/context.js";
import { runLoop, type LoopDeps } from "./core/loop.js";

function buildDeps(config: RunConfig, serializable: SerializableConfig): LoopDeps {
  const provider = config.provider;
  const store = config.store ?? new FileStore(config.runsDir);
  const registry = new ToolRegistry(config.tools ?? []);
  return {
    planner: new Planner(provider, serializable.temperature),
    executor: new Executor(provider, registry, { temperature: serializable.temperature, maxStepTokens: serializable.maxStepTokens }),
    reflector: new Reflector(provider),
    contextManager: new ContextManager(provider, serializable),
    store,
    onEvent: config.onEvent ?? (() => {}),
  };
}

/** Run an agent to completion (or to a budget halt). The whole run is checkpointed every step. */
export async function run(goal: Goal | string, config: RunConfig): Promise<RunResult> {
  const g: Goal = typeof goal === "string" ? { description: goal } : goal;
  const serializable = resolveSerializable(config);
  const ctx = createContext(g, serializable);
  return runLoop(ctx, buildDeps(config, serializable));
}

/** Resume a run from its last checkpoint — same plan, same progress, continues where it died. */
export async function resume(runId: string, config: RunConfig): Promise<RunResult> {
  const store = config.store ?? new FileStore(config.runsDir);
  const ctx = await store.load(runId);
  if (!ctx) throw new Error(`No saved run found for "${runId}".`);
  // Honor the run's own persisted budgets/limits; only the live deps come from `config`.
  return runLoop(ctx, buildDeps({ ...config, store }, ctx.config));
}

/** Continue a RunContext you already hold in memory (advanced; same as resume without the store load). */
export async function runWith(ctx: RunContext, config: RunConfig): Promise<RunResult> {
  return runLoop(ctx, buildDeps(config, ctx.config));
}

// ── Public surface ───────────────────────────────────────────────────────────
export type * from "./core/types.js";
export { DEFAULT_CONFIG, resolveSerializable } from "./config/defaults.js";
export { createContext, genId, nextPendingStep } from "./run/context.js";
export { checkBudget } from "./run/budget.js";
export { FileStore, MemoryStore } from "./memory/store.js";
export { ContextManager } from "./memory/context.js";
export { ToolRegistry, defineTool } from "./executor/tools.js";
export { Planner } from "./planner/planner.js";
export { Executor } from "./executor/executor.js";
export { Reflector } from "./reflector/reflector.js";
export { runLoop } from "./core/loop.js";
export type { LoopDeps } from "./core/loop.js";
export { ScriptedProvider, reply, withRetry, estimateTokens } from "./providers/provider.js";
export type { ScriptedResponse } from "./providers/provider.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export type { AnthropicOptions } from "./providers/anthropic.js";
