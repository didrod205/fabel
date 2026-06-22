import type { Provider, CompletionRequest, CompletionResult, Message, ToolCall, StopReason } from "../core/types.js";
import { estimateTokens, withRetry } from "./provider.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** anthropic-version header. */
  version?: string;
  maxRetries?: number;
  defaultMaxTokens?: number;
  /**
   * Cache the stable system + tools prefix with `cache_control: ephemeral`.
   * A durable agent replays a large prefix every step, so cached tokens cost
   * ~10× less. On by default; harmless when the prefix is below the cache
   * minimum (it just won't cache). Set false to disable.
   */
  cache?: boolean;
  /** Turn on adaptive thinking (recommended for planning/reflection on 4.7+/Fable). */
  thinking?: "adaptive";
  /** Reasoning/spend dial for thinking models: low | medium | high | xhigh | max. */
  effort?: Effort;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Models that removed the sampling parameters (`temperature`/`top_p`/`top_k`) —
 * sending `temperature` to any of these returns HTTP 400. Opus 4.7/4.8, Fable 5,
 * and Mythos 5. We strip it for them so the provider works against the flagship
 * models, not just Sonnet.
 */
export function modelRejectsSampling(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("opus-4-7") || m.includes("opus-4-8") || m.includes("fable") || m.includes("mythos");
}

/** Coalesce consecutive same-role turns — the Messages API wants alternation. */
function coalesce(messages: Array<{ role: "user" | "assistant"; content: string }>): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else out.push({ ...m });
  }
  if (out.length === 0 || out[0]!.role !== "user") out.unshift({ role: "user", content: "(begin)" });
  return out;
}

/**
 * The default provider — talks to the Anthropic Messages API over `fetch`, no
 * SDK, no dependencies. Swap in any other `Provider` to go model-agnostic.
 */
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly maxRetries: number;
  private readonly defaultMaxTokens: number;
  private readonly cache: boolean;
  private readonly thinking?: "adaptive";
  private readonly effort?: Effort;

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.version = opts.version ?? "2023-06-01";
    this.maxRetries = opts.maxRetries ?? 4;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4096;
    this.cache = opts.cache ?? true;
    this.thinking = opts.thinking;
    this.effort = opts.effort;
    if (!this.apiKey) {
      throw new Error("AnthropicProvider needs an API key (pass { apiKey } or set ANTHROPIC_API_KEY).");
    }
  }

  estimateTokens(messages: Message[]): number {
    return estimateTokens(messages);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const convo = coalesce(
      req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    );

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? this.defaultMaxTokens,
      messages: convo,
    };

    // Sampling: omit `temperature` for models that reject it (would 400), and
    // for thinking runs (thinking models don't take sampling params).
    if (typeof req.temperature === "number" && !this.thinking && !modelRejectsSampling(this.model)) {
      body["temperature"] = req.temperature;
    }

    if (this.thinking === "adaptive") body["thinking"] = { type: "adaptive" };
    if (this.effort) body["output_config"] = { effort: this.effort };

    let sys = system;
    if (req.responseFormat === "json") sys = (sys ? sys + "\n\n" : "") + "Output ONLY valid JSON. No prose, no code fences.";
    if (sys) {
      // A cache breakpoint on the system block caches tools + system together.
      body["system"] = this.cache ? [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] : sys;
    }
    if (req.tools?.length) {
      body["tools"] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }

    const data = await withRetry(
      async () => {
        const res = await fetch(`${this.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": this.version,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        return (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string; usage?: AnthropicUsage };
      },
      {
        retries: this.maxRetries,
        isRetryable: (e) => {
          const status = (e as { status?: number }).status;
          return status === undefined || status === 429 || (status >= 500 && status < 600);
        },
      },
    );

    let content = "";
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text" && block.text) content += block.text;
      else if (block.type === "tool_use" && block.name) toolCalls.push({ id: block.id ?? block.name, name: block.name, input: block.input });
    }

    // True input size = uncached + cache-read + cache-write, so the budget
    // reflects the real context the model saw, not just the uncached remainder.
    const u = data.usage ?? {};
    const tokensIn = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

    const map: Record<string, StopReason> = { end_turn: "end", tool_use: "tool_use", max_tokens: "max_tokens", stop_sequence: "end" };
    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      tokensIn,
      tokensOut: u.output_tokens ?? 0,
      stopReason: map[data.stop_reason ?? ""] ?? "end",
    };
  }
}
