import { describe, it, expect, afterEach } from "vitest";
import { AnthropicProvider, modelRejectsSampling, parseClaudeJson, claudeRequestArgs, CliProvider } from "../src/index.js";
import type { CompletionRequest } from "../src/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, capturing the request body and returning a canned Messages response. */
function stub(response: unknown) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return { ok: true, status: 200, json: async () => response, text: async () => "" } as Response;
  }) as typeof fetch;
  return calls;
}

const usage = { input_tokens: 10, output_tokens: 5 };
const ok = { content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage };

describe("AnthropicProvider — temperature compatibility (the 400 fix)", () => {
  it("sends temperature to Sonnet (still accepts sampling)", async () => {
    const calls = stub(ok);
    await new AnthropicProvider({ apiKey: "k", model: "claude-sonnet-4-6" }).complete({ messages: [{ role: "user", content: "x" }], temperature: 0.7 });
    expect(calls[0]!.body["temperature"]).toBe(0.7);
  });

  it("OMITS temperature for Opus 4.8 / 4.7 / Fable (they 400 on it)", async () => {
    for (const model of ["claude-opus-4-8", "claude-opus-4-7", "claude-fable-5"]) {
      const calls = stub(ok);
      await new AnthropicProvider({ apiKey: "k", model }).complete({ messages: [{ role: "user", content: "x" }], temperature: 0.7 });
      expect(calls[0]!.body).not.toHaveProperty("temperature");
    }
  });

  it("modelRejectsSampling matches the flagship models", () => {
    expect(modelRejectsSampling("claude-opus-4-8")).toBe(true);
    expect(modelRejectsSampling("claude-fable-5")).toBe(true);
    expect(modelRejectsSampling("claude-mythos-5")).toBe(true);
    expect(modelRejectsSampling("claude-sonnet-4-6")).toBe(false);
  });
});

describe("AnthropicProvider — prompt caching + real usage", () => {
  it("wraps the system prompt in a cache_control block by default", async () => {
    const calls = stub(ok);
    await new AnthropicProvider({ apiKey: "k" }).complete({ messages: [{ role: "system", content: "you are helpful" }, { role: "user", content: "x" }] });
    const sys = calls[0]!.body["system"] as Array<{ type: string; cache_control?: unknown }>;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("can disable caching (system stays a plain string)", async () => {
    const calls = stub(ok);
    await new AnthropicProvider({ apiKey: "k", cache: false }).complete({ messages: [{ role: "system", content: "sys" }, { role: "user", content: "x" }] });
    expect(typeof calls[0]!.body["system"]).toBe("string");
  });

  it("counts cache-read + cache-write tokens as input (true context size)", async () => {
    stub({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 5 } });
    const out = await new AnthropicProvider({ apiKey: "k" }).complete({ messages: [{ role: "user", content: "x" }] });
    expect(out.tokensIn).toBe(100);
    expect(out.tokensOut).toBe(5);
  });
});

describe("AnthropicProvider — opt-in thinking/effort", () => {
  it("sends adaptive thinking + effort and drops temperature", async () => {
    const calls = stub(ok);
    await new AnthropicProvider({ apiKey: "k", model: "claude-sonnet-4-6", thinking: "adaptive", effort: "high" }).complete({ messages: [{ role: "user", content: "x" }], temperature: 1 });
    expect(calls[0]!.body["thinking"]).toEqual({ type: "adaptive" });
    expect(calls[0]!.body["output_config"]).toEqual({ effort: "high" });
    expect(calls[0]!.body).not.toHaveProperty("temperature");
  });
});

describe("parseClaudeJson — claude --output-format json", () => {
  it("extracts result text, session id, real cost, and usage", () => {
    const r = parseClaudeJson(JSON.stringify({ type: "result", result: "hello", session_id: "sess_1", total_cost_usd: 0.012, usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 7 } }));
    expect(r.content).toBe("hello");
    expect(r.sessionId).toBe("sess_1");
    expect(r.costUsd).toBe(0.012);
    expect(r.tokensIn).toBe(10); // 3 + 7 cache-read
    expect(r.tokensOut).toBe(4);
  });

  it("prefers structured_output when --json-schema was used", () => {
    const r = parseClaudeJson(JSON.stringify({ result: "ignored", structured_output: { steps: [{ id: "s1" }] } }));
    expect(r.content).toBe(JSON.stringify({ steps: [{ id: "s1" }] }));
  });

  it("falls back to trimmed text when stdout is not JSON", () => {
    const r = parseClaudeJson("  just text  ");
    expect(r.content).toBe("just text");
    expect(r.sessionId).toBeUndefined();
  });
});

describe("claudeRequestArgs — per-request flags", () => {
  const req: CompletionRequest = { messages: [{ role: "system", content: "be terse" }, { role: "user", content: "go" }], responseFormat: "json" };

  it("passes --output-format json and --append-system-prompt with a JSON instruction", () => {
    const args = claudeRequestArgs(req, { json: true, appendSystem: true });
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    const sys = args[args.indexOf("--append-system-prompt") + 1]!;
    expect(sys).toContain("be terse");
    expect(sys).toMatch(/ONLY valid JSON/);
  });

  it("adds --json-schema only when a schema is supplied and JSON is requested", () => {
    const schema = { type: "object", properties: { steps: { type: "array" } } };
    const args = claudeRequestArgs(req, { json: true, appendSystem: false, jsonSchema: schema });
    expect(args[args.indexOf("--json-schema") + 1]).toBe(JSON.stringify(schema));
    expect(args).not.toContain("--append-system-prompt");
  });
});

describe("CliProvider — structured result path (subprocess)", () => {
  it("routes stdout through parseResult and surfaces session id + cost", async () => {
    const json = JSON.stringify({ result: "OK", session_id: "s1", total_cost_usd: 0.5, usage: { input_tokens: 2, output_tokens: 3 } });
    const p = new CliProvider({
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(json)})`],
      promptVia: "arg",
      parseResult: parseClaudeJson,
    });
    const out = await p.complete({ messages: [{ role: "user", content: "x" }] });
    expect(out.content).toBe("OK");
    expect(out.sessionId).toBe("s1");
    expect(out.costUsd).toBe(0.5);
    expect(out.tokensOut).toBe(3);
  });
});
