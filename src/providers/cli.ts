import { spawn } from "node:child_process";
import type { Provider, CompletionRequest, CompletionResult, Message } from "../core/types.js";
import { estimateTokens } from "./provider.js";

export interface CliProviderOptions {
  /** The executable, e.g. "claude" or "codex". */
  command: string;
  /** Fixed args before the prompt, e.g. ["-p"] for Claude Code print mode. */
  args?: string[];
  /** Pass the prompt as the final arg ("arg", default) or on stdin ("stdin"). */
  promptVia?: "arg" | "stdin";
  /** Extract the assistant text from the command's stdout. Default: trim. */
  parse?: (stdout: string) => string;
  env?: Record<string, string>;
  timeoutMs?: number;
  label?: string;
}

/** Flatten role-structured messages into one prompt for a text-only CLI. */
function flatten(messages: Message[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "assistant") parts.push(`Assistant: ${m.content}`);
    else parts.push(m.content); // system + user read as plain instructions/content
  }
  return parts.join("\n\n");
}

function runCli(command: string, args: string[], input: string | null, timeoutMs: number, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { env: { ...process.env, ...env } });
    } catch (e) {
      return reject(e);
    }
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error(`"${command}" is not installed or not on your PATH.`) : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${command} exited ${code}: ${err.trim().slice(0, 300)}`));
    });
    if (input !== null) child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Drives an agentic CLI (Claude Code, Codex, …) in non-interactive mode: every
 * model call shells out to the command and captures its stdout. This means
 * people who use those CLIs via a **subscription login use oh-my-fable with no
 * separate API key** — it rides whatever auth the CLI already has.
 *
 * Note: it returns text only (no native tool-calling), so the agent runs in
 * pure-reasoning mode; `--tools fs` is unavailable through a CLI provider.
 */
export class CliProvider implements Provider {
  readonly name: string;
  private readonly command: string;
  private readonly args: string[];
  private readonly promptVia: "arg" | "stdin";
  private readonly parse: (s: string) => string;
  private readonly env?: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts: CliProviderOptions) {
    this.command = opts.command;
    this.args = opts.args ?? [];
    this.promptVia = opts.promptVia ?? "arg";
    this.parse = opts.parse ?? ((s) => s.trim());
    this.env = opts.env;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.name = opts.label ?? `cli:${opts.command}`;
  }

  estimateTokens(messages: Message[]): number {
    return estimateTokens(messages);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const prompt = flatten(req.messages);
    const args = this.promptVia === "arg" ? [...this.args, prompt] : this.args;
    const stdout = await runCli(this.command, args, this.promptVia === "stdin" ? prompt : null, this.timeoutMs, this.env);
    const content = this.parse(stdout);
    return {
      content,
      tokensIn: estimateTokens(req.messages),
      tokensOut: Math.ceil(content.length / 4),
      stopReason: "end",
    };
  }
}

/** Claude Code in print mode — uses your existing `claude` auth (subscription or key). */
export function claudeCode(opts: Partial<CliProviderOptions> = {}): CliProvider {
  return new CliProvider({ command: "claude", args: ["-p"], promptVia: "arg", label: "claude-code", ...opts });
}

/** OpenAI Codex CLI in non-interactive exec mode — uses your existing `codex` auth. */
export function codexCli(opts: Partial<CliProviderOptions> = {}): CliProvider {
  return new CliProvider({ command: "codex", args: ["exec"], promptVia: "arg", label: "codex", ...opts });
}
