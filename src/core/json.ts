import type { Provider } from "./types.js";

/** Pull a JSON object/array out of a model response that may be fenced or prose-wrapped. */
export function extractJson(raw: string): string {
  let s = raw.trim();
  // strip ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1]!.trim();
  // grab the first balanced {...} or [...] if there's surrounding prose
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const open = s[0];
  if (open === "{" || open === "[") {
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return s.slice(0, i + 1);
      }
    }
  }
  return s;
}

export function tryParse<T>(raw: string): T | null {
  try {
    return JSON.parse(extractJson(raw)) as T;
  } catch {
    return null;
  }
}

/**
 * Parse JSON from a model response, with one self-repair attempt: if the first
 * parse fails, ask the model to fix its own output, then parse again. Returns
 * null if it still can't be parsed — callers decide the conservative fallback.
 */
export async function parseWithRepair<T>(raw: string, provider: Provider, validate?: (v: T) => boolean): Promise<T | null> {
  const first = tryParse<T>(raw);
  if (first !== null && (!validate || validate(first))) return first;

  const repaired = await provider.complete({
    responseFormat: "json",
    temperature: 0,
    messages: [
      { role: "system", content: "You convert a malformed response into valid JSON. Output ONLY the JSON — no prose, no code fences." },
      { role: "user", content: raw },
    ],
  });
  const second = tryParse<T>(repaired.content);
  if (second !== null && (!validate || validate(second))) return second;
  return null;
}
