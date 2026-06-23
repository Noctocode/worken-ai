import { Injectable, Logger } from '@nestjs/common';
import { ModelsService } from '../models/models.service.js';

/**
 * Lightweight heuristic that nudges the user toward a better-suited
 * model when the current pick is clearly mismatched to the prompt.
 *
 * The match is intentionally simple — a small in-code rule table
 * keyed on prompt keywords. Promoting this to a DB table (so admins
 * can tune rules per-org) is a follow-up; we want a few months of
 * production hits first to know which rules survive.
 *
 * Surfaced on the SSE `done` event under `alternativeModel`. The FE
 * renders a "we think X would work better — Try It" bubble below the
 * assistant message; the `done` shape change is purely additive, so
 * older FE builds that don't read the field just ignore it.
 *
 * The suggested id is **resolved against the user's available (curated)
 * models** before it's returned: clicking "Try It" persists the id as
 * the project's model, and models are admin-curated — a model that isn't
 * enabled would be rejected at chat time with MODEL_UNAVAILABLE. So we
 * only ever suggest a model the user can actually switch to; if it isn't
 * enabled (or the lookup fails) we drop the suggestion.
 */
export interface ModelSuggestion {
  /** Slug the user can pass back to /chat/stream as `model`. */
  id: string;
  /** Friendly label for the bubble ("Claude 3.5 Sonnet"). */
  label: string;
  /** One-line "why" shown next to the suggestion. */
  reason: string;
}

interface Rule {
  pattern: RegExp;
  /** Skip the suggestion when the user is already on a model whose
   *  id starts with one of these prefixes — avoids the awkward "we
   *  think Claude would work better" bubble after a Claude response. */
  skipIfCurrentMatches: string[];
  suggestion: ModelSuggestion;
}

const RULES: Rule[] = [
  // Coding intent — keywords picked from real prompt logs (the top-
  // 20 user phrases on chat where the user followed up with "this
  // doesn't compile"). Claude is the BE recommendation for code.
  {
    pattern:
      /\b(code|function|debug|stack ?trace|typescript|javascript|python|refactor|implement|algorithm)\b/i,
    skipIfCurrentMatches: ['anthropic/'],
    suggestion: {
      id: 'anthropic/claude-opus-4.8',
      label: 'Claude Opus 4.8',
      reason:
        'Claude handles structured code tasks better — fewer hallucinated API calls.',
    },
  },
  // Creative writing — divergent prose / story / poem. GPT has the
  // smoothest style for long-form creative output today.
  {
    pattern: /\b(story|poem|creative|essay|narrative|character|dialogue)\b/i,
    skipIfCurrentMatches: ['openai/'],
    suggestion: {
      id: 'openai/gpt-5.5',
      label: 'GPT-5.5',
      reason: 'GPT has a smoother voice for long-form creative prose.',
    },
  },
];

@Injectable()
export class ModelSuggestionService {
  private readonly logger = new Logger(ModelSuggestionService.name);

  constructor(private readonly modelsService: ModelsService) {}

  /**
   * Return a suggestion for this turn, or null. The keyword match is a
   * cheap in-memory rule scan; the only async work is resolving the
   * caller's available models below, on the chat-stream tail.
   *
   * Always opt-in for the caller: the FE bubble only renders when the
   * field is present, so a null is a no-op for users.
   */
  async suggest(input: {
    prompt: string;
    currentModel: string;
    userId: string;
  }): Promise<ModelSuggestion | null> {
    const prompt = (input.prompt ?? '').slice(0, 4000); // cap to keep regex cheap
    const current = input.currentModel ?? '';

    let matched: ModelSuggestion | null = null;
    for (const rule of RULES) {
      if (rule.skipIfCurrentMatches.some((p) => current.startsWith(p)))
        continue;
      if (rule.pattern.test(prompt)) {
        matched = rule.suggestion;
        break;
      }
    }
    if (!matched) return null;
    const chosen = matched;

    // Never suggest a model the user can't actually switch to. Models are
    // admin-curated, so validate against the caller's available (enabled)
    // models — not the raw catalog: a catalog-valid-but-not-enabled model
    // would be rejected at chat time with MODEL_UNAVAILABLE. Fail-safe —
    // on any lookup error, drop the suggestion rather than risk breaking
    // the chat `done` event or surfacing an unusable id.
    try {
      const available = await this.modelsService.availableModelIds(
        input.userId,
      );
      if (!available.has(chosen.id)) return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Suggestion availability check failed; dropping: ${msg}`,
      );
      return null;
    }
    return chosen;
  }
}
