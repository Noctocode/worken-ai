import { Inject, Injectable, Logger } from '@nestjs/common';
import { observabilityEvents } from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';

/**
 * Derive a coarse provider label from an OpenRouter-style model id like
 * "openai/gpt-4o:free" → "openai". Falls back to "openrouter:other" so we
 * can still group unknown providers in the dashboard.
 */
export function providerFromModel(model: string | null | undefined): string {
  if (!model) return 'unknown';
  const slug = model.split('/')[0]?.toLowerCase();
  if (!slug) return 'unknown';
  const known = new Set([
    'openai',
    'anthropic',
    'google',
    'meta-llama',
    'mistralai',
    'cohere',
    'nvidia',
    'arcee-ai',
    'liquid',
    'stepfun',
    'baidu',
    'qwen',
    'deepseek',
  ]);
  return known.has(slug) ? slug : `openrouter:${slug}`;
}

const PROMPT_PREVIEW_MAX = 200;

function truncatePreview(prompt: string | null | undefined): string | null {
  if (!prompt) return null;
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  return trimmed.length <= PROMPT_PREVIEW_MAX
    ? trimmed
    : `${trimmed.slice(0, PROMPT_PREVIEW_MAX)}…`;
}

export interface RecordLLMCallInput {
  userId: string;
  teamId?: string | null;
  eventType:
    | 'arena_call'
    | 'evaluator_call'
    | 'arena_attachment_ocr'
    | 'guardrail_trigger'
    | string;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
  prompt?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Persist a single observability event. Errors are caught and logged so a
   * failing insert never breaks the user-facing request path.
   */
  async recordLLMCall(input: RecordLLMCallInput): Promise<void> {
    try {
      await this.db.insert(observabilityEvents).values({
        userId: input.userId,
        teamId: input.teamId ?? null,
        eventType: input.eventType,
        model: input.model ?? null,
        provider:
          input.provider ?? (input.model ? providerFromModel(input.model) : null),
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        costUsd:
          input.costUsd !== undefined && input.costUsd !== null
            ? String(input.costUsd)
            : null,
        latencyMs: input.latencyMs ?? null,
        success: input.success ?? true,
        errorMessage: input.errorMessage ?? null,
        promptPreview: truncatePreview(input.prompt),
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to record observability event for user ${input.userId} (${input.eventType}): ${msg}`,
      );
    }
  }
}
