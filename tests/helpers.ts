import { run, runWith, resume, createContext, resolveSerializable, MemoryStore, ScriptedProvider, reply } from "../src/index.js";
import type { Goal, RunConfig, RunEvent, RunResult, Provider } from "../src/index.js";

export interface Harness {
  store: MemoryStore;
  events: RunEvent[];
  config: RunConfig;
}

export function harness(provider: Provider, overrides: Partial<RunConfig> = {}): Harness {
  const store = new MemoryStore();
  const events: RunEvent[] = [];
  const config: RunConfig = { provider, store, onEvent: (e) => events.push(e), ...overrides };
  return { store, events, config };
}

export async function runScripted(goal: Goal | string, responses: ConstructorParameters<typeof ScriptedProvider>[0], overrides: Partial<RunConfig> = {}) {
  const provider = new ScriptedProvider(responses);
  const h = harness(provider, overrides);
  const result = await run(goal, h.config);
  return { result, ...h, provider };
}

export { run, runWith, resume, createContext, resolveSerializable, MemoryStore, ScriptedProvider, reply };
export type { Goal, RunConfig, RunEvent, RunResult };
