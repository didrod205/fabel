import type { SerializableConfig, Provider, Store, Tool, RunEvent } from "../core/types.js";

export const DEFAULT_CONFIG: SerializableConfig = {
  maxSteps: 50,
  maxTokens: 2_000_000,
  maxWallClockMs: 30 * 60 * 1000,
  maxStepAttempts: 3,
  maxReplans: 12,
  contextTokenLimit: 100_000,
  keepRecent: 8,
  temperature: 0.2,
  maxStepTokens: 4096,
};

export interface ResolvedConfig {
  serializable: SerializableConfig;
  provider: Provider;
  store: Store;
  tools: Tool[];
  runsDir: string;
  onEvent: (e: RunEvent) => void;
}

/** Merge user config over defaults and pull out the serializable subset. */
export function resolveSerializable(config: Partial<SerializableConfig>): SerializableConfig {
  return {
    maxSteps: config.maxSteps ?? DEFAULT_CONFIG.maxSteps,
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    maxWallClockMs: config.maxWallClockMs ?? DEFAULT_CONFIG.maxWallClockMs,
    maxStepAttempts: config.maxStepAttempts ?? DEFAULT_CONFIG.maxStepAttempts,
    maxReplans: config.maxReplans ?? DEFAULT_CONFIG.maxReplans,
    contextTokenLimit: config.contextTokenLimit ?? DEFAULT_CONFIG.contextTokenLimit,
    keepRecent: config.keepRecent ?? DEFAULT_CONFIG.keepRecent,
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxStepTokens: config.maxStepTokens ?? DEFAULT_CONFIG.maxStepTokens,
  };
}
