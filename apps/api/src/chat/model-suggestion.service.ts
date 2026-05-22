import { Injectable } from '@nestjs/common';

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
  // doesn't compile"). Sonnet's the BE recommendation for code.
  {
    pattern:
      /\b(code|function|debug|stack ?trace|typescript|javascript|python|refactor|implement|algorithm)\b/i,
    skipIfCurrentMatches: ['anthropic/'],
    suggestion: {
      id: 'anthropic/claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      reason:
        'Sonnet handles structured code tasks better — fewer hallucinated API calls.',
    },
  },
  // Creative writing — divergent prose / story / poem. GPT-4o has
  // the smoothest style for long-form creative output today.
  {
    pattern: /\b(story|poem|creative|essay|narrative|character|dialogue)\b/i,
    skipIfCurrentMatches: ['openai/'],
    suggestion: {
      id: 'openai/gpt-4o',
      label: 'GPT-4o',
      reason: 'GPT-4o has a smoother voice for long-form creative prose.',
    },
  },
];

@Injectable()
export class ModelSuggestionService {
  /**
   * Return a suggestion for this turn, or null. Pure function — no
   * DB or external calls, so it adds <1ms to the chat-stream tail.
   *
   * Always opt-in for the caller: the FE bubble only renders when
   * the field is present, so wiring this in without rules ready
   * (e.g. behind a flag) is a no-op for users.
   */
  suggest(input: {
    prompt: string;
    currentModel: string;
  }): ModelSuggestion | null {
    const prompt = (input.prompt ?? '').slice(0, 4000); // cap to keep regex cheap
    const current = input.currentModel ?? '';

    for (const rule of RULES) {
      if (rule.skipIfCurrentMatches.some((p) => current.startsWith(p)))
        continue;
      if (rule.pattern.test(prompt)) {
        return rule.suggestion;
      }
    }
    return null;
  }
}
