import { describe, it, expect, afterEach } from "vitest";
import { OpenAICompatProvider, ollama } from "../src/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub fetch, capturing the request and returning a canned chat-completion. */
function stub(response: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => response, text: async () => "" } as Response;
  }) as typeof fetch;
  return calls;
}

describe("OpenAICompatProvider", () => {
  it("maps messages + tools to the chat-completions request", async () => {
    const calls = stub({ choices: [{ message: { content: "hi back" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
    const p = new OpenAICompatProvider({ baseUrl: "http://host/v1/", apiKey: "secret", model: "m-1" });
    const out = await p.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "sum", description: "add", parameters: { type: "object" } }],
    });

    expect(out.content).toBe("hi back");
    expect(out.tokensIn).toBe(11);
    expect(out.tokensOut).toBe(7);
    expect(out.stopReason).toBe("end");

    const { url, init } = calls[0]!;
    expect(url).toBe("http://host/v1/chat/completions"); // trailing slash normalized
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("m-1");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "sum", description: "add", parameters: { type: "object" } } });
  });

  it("parses tool calls and a tool_calls finish reason", async () => {
    stub({ choices: [{ message: { content: "", tool_calls: [{ id: "call_1", function: { name: "sum", arguments: '{"a":2,"b":3}' } }] }, finish_reason: "tool_calls" }] });
    const out = await new OpenAICompatProvider({ baseUrl: "http://h/v1", model: "m" }).complete({ messages: [{ role: "user", content: "x" }] });
    expect(out.stopReason).toBe("tool_use");
    expect(out.toolCalls).toEqual([{ id: "call_1", name: "sum", input: { a: 2, b: 3 } }]);
  });

  it("surfaces server errors", async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 400, text: async () => "bad model" }) as Response) as typeof fetch;
    await expect(new OpenAICompatProvider({ baseUrl: "http://h/v1", model: "nope", maxRetries: 0 }).complete({ messages: [] })).rejects.toThrow(/400/);
  });
});

describe("ollama() helper — local, no key", () => {
  it("hits localhost:11434 with no Authorization header", async () => {
    const calls = stub({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
    await ollama("llama3.1").complete({ messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect((calls[0]!.init.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });
});
