import type { RunContext, Message, Provider, SerializableConfig } from "../core/types.js";
import { nowIso } from "../run/context.js";

const FOLD_SYSTEM = `You compress an agent's conversation log. Keep ONLY: key decisions made, concrete results/outputs produced, and any open or unresolved items. Drop chit-chat and restating. Be terse — this summary replaces the raw log.`;

const DIGEST_CHAR_LIMIT = 6000;

/**
 * Keeps the model's context inside its window by folding old, completed turns
 * into a running digest. The plan is NEVER touched here — it lives outside
 * history precisely so compaction can't blur "where we are".
 */
export class ContextManager {
  constructor(
    private readonly provider: Provider,
    private readonly config: SerializableConfig,
  ) {}

  overBudget(ctx: RunContext): boolean {
    return this.provider.estimateTokens(ctx.history) >= this.config.contextTokenLimit * 0.8;
  }

  /** Fold all but the most recent K messages into a digest; return the new (short) history. */
  async compact(ctx: RunContext): Promise<Message[]> {
    const keep = this.config.keepRecent;
    if (ctx.history.length <= keep) return ctx.history;

    const recent = ctx.history.slice(-keep);
    const toFold = ctx.history.slice(0, -keep);

    const folded = await this.provider.complete({
      temperature: 0,
      messages: [
        { role: "system", content: FOLD_SYSTEM },
        { role: "user", content: toFold.map((m) => `[${m.role}] ${m.content}`).join("\n\n") },
      ],
    });
    ctx.digests.push({ summary: folded.content.trim(), coversUntil: nowIso() });

    // Meta-compaction: if the digests themselves grow large, fold them into one.
    const totalDigestChars = ctx.digests.reduce((n, d) => n + d.summary.length, 0);
    if (totalDigestChars > DIGEST_CHAR_LIMIT && ctx.digests.length > 1) {
      const merged = await this.provider.complete({
        temperature: 0,
        messages: [
          { role: "system", content: FOLD_SYSTEM },
          { role: "user", content: ctx.digests.map((d) => d.summary).join("\n\n") },
        ],
      });
      ctx.digests = [{ summary: merged.content.trim(), coversUntil: nowIso() }];
    }

    return recent;
  }
}
