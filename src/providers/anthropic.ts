import type { Provider, CompletionRequest, CompletionResult, Message, ToolCall, StopReason } from "../core/types.js";
import { estimateTokens, withRetry } from "./provider.js";

export interface AnthropicOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  /** anthropic-version header. */
  version?: string;
  maxRetries?: number;
  defaultMaxTokens?: number;
}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
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

  constructor(opts: AnthropicOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.version = opts.version ?? "2023-06-01";
    this.maxRetries = opts.maxRetries ?? 4;
    this.defaultMaxTokens = opts.defaultMaxTokens ?? 4096;
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
      temperature: req.temperature ?? 1,
      messages: convo,
    };
    let sys = system;
    if (req.responseFormat === "json") sys = (sys ? sys + "\n\n" : "") + "Output ONLY valid JSON. No prose, no code fences.";
    if (sys) body["system"] = sys;
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
        return (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
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

    const map: Record<string, StopReason> = { end_turn: "end", tool_use: "tool_use", max_tokens: "max_tokens", stop_sequence: "end" };
    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      stopReason: map[data.stop_reason ?? ""] ?? "end",
    };
  }
}
