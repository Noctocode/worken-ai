import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Default OCR fallback chain. Ordered roughly smallest-first (the
 * smaller model is cheaper and usually faster on short OCR prompts);
 * the runtime tries each in sequence and stops at the first one that
 * returns a non-error response. Every entry is a public :free tier
 * vision-capable model currently listed on OpenRouter as of 2026-05.
 *
 * Free-tier model availability shifts often — providers come and go
 * from the free pool without notice (that's how the previous default
 * `baidu/qianfan-ocr-fast:free` ended up dark). Operators can override
 * this chain with the OCR_MODELS env var when a provider drops, or
 * append a paid model (e.g. `openai/gpt-4o-mini`) as the last hop to
 * guarantee an answer.
 */
const DEFAULT_OCR_MODELS =
  'nvidia/nemotron-nano-12b-v2-vl:free,' +
  'google/gemma-4-26b-a4b-it:free,' +
  'google/gemma-4-31b-it:free,' +
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

/**
 * Sentinel the OCR prompt asks the model to emit when the image has
 * no extractable text. Returned to callers as an empty string so
 * downstream code (the chunker, the arena attachment renderer) does
 * not need to know about the marker.
 */
const NO_TEXT_MARKER = 'NO_TEXT_FOUND';

const OCR_PROMPT =
  'Extract ALL text visible in this image, preserving structure and ' +
  'line breaks as best you can. If there is no text, respond with ' +
  'exactly: NO_TEXT_FOUND.';

interface AttemptFailure {
  model: string;
  reason: string;
}

/**
 * Shared OCR pipeline used by Knowledge Core image ingestion and the
 * Model Arena attachment path. Runs a chain of vision-capable models
 * on OpenRouter so a single retired / rate-limited model does not
 * take the whole OCR surface down (which is what the previous
 * hardcoded `baidu/qianfan-ocr-fast:free` did when its endpoints
 * disappeared upstream).
 *
 * Auth-style 4xx errors (401 / 403) and request-shape 4xx errors
 * other than 404 / 429 short-circuit the chain — retrying with a
 * different model would not fix them. 404 / 429 / 5xx / network
 * errors advance to the next model.
 */
@Injectable()
export class OcrFallbackService {
  private readonly logger = new Logger(OcrFallbackService.name);
  private readonly models: string[];

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('OCR_MODELS') ?? DEFAULT_OCR_MODELS;
    const parsed = raw
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    // Empty env value falls through to the default chain rather than
    // leaving us with zero models — an empty chain would throw on
    // every OCR call which is worse UX than a sensible default.
    this.models =
      parsed.length > 0
        ? parsed
        : DEFAULT_OCR_MODELS.split(',')
            .map((m) => m.trim())
            .filter((m) => m.length > 0);

    this.logger.log(`OCR fallback chain: ${this.models.join(' -> ')}`);
  }

  /**
   * Run OCR on a single image. `imageDataUrl` is a base64 data URL
   * (`data:image/png;base64,...`) — same shape both call sites
   * already build. `apiKey` is the caller's resolved OpenRouter key
   * (KeyResolverService output); pass-through so usage and budget
   * routing stay consistent with the rest of the OpenRouter calls.
   *
   * Returns the extracted text and the model that actually produced
   * it, so observability records the model the user really paid for
   * rather than a hardcoded label.
   */
  async extractText(
    imageDataUrl: string,
    apiKey: string,
  ): Promise<{ text: string; model: string }> {
    if (!apiKey) {
      throw new Error('OCR: missing OpenRouter API key.');
    }

    const failures: AttemptFailure[] = [];

    for (const model of this.models) {
      try {
        const client = this.makeClient(apiKey);
        const completion = await client.chat.completions.create({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: OCR_PROMPT },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? '';
        const text = raw === NO_TEXT_MARKER ? '' : raw;
        this.logger.debug(`OCR succeeded via "${model}"`);
        return { text, model };
      } catch (err) {
        const decision = this.classify(err);
        if (decision.fatal) {
          // 401 / 403 / non-404 non-429 4xx — not a model-availability
          // problem, throw immediately with context.
          throw new Error(
            `OCR aborted at model "${model}": ${decision.reason}`,
          );
        }
        failures.push({ model, reason: decision.reason });
        this.logger.warn(
          `OCR fallback advancing past "${model}": ${decision.reason}`,
        );
      }
    }

    const attempted = failures
      .map((f) => `${f.model} (${f.reason})`)
      .join(', ');
    this.logger.error(`OCR exhausted all fallback models. Tried: ${attempted}`);
    throw new Error(
      `OCR failed across all configured models. Tried: ${attempted}`,
    );
  }

  /**
   * Exposed so callers (or tests) can introspect which chain is
   * active without re-parsing OCR_MODELS themselves.
   */
  get modelChain(): readonly string[] {
    return this.models;
  }

  private makeClient(apiKey: string): OpenAI {
    return new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': process.env['SITE_URL'] ?? '',
        'X-Title': process.env['SITE_NAME'] ?? 'WorkenAI',
      },
    });
  }

  /**
   * Map an exception to (advance | abort) plus a short human-readable
   * reason. Network / timeout errors and the retry-worthy HTTP codes
   * (404, 429, 5xx) advance the chain; auth and shape errors abort.
   */
  private classify(err: unknown): { fatal: boolean; reason: string } {
    if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 0;
      const summary = `${status} ${err.name}: ${err.message}`;
      if (status === 401 || status === 403) {
        return { fatal: true, reason: `auth error (${summary})` };
      }
      if (status === 404 || status === 429 || status >= 500) {
        return { fatal: false, reason: summary };
      }
      // Any other 4xx (400 / 422 / etc.) is a request-shape issue —
      // the next model will see the same payload and reject it the
      // same way, so we abort instead of burning the rest of the
      // chain.
      if (status >= 400) {
        return { fatal: true, reason: `bad request (${summary})` };
      }
      // 1xx / 2xx / 3xx shouldn't surface as an error in practice; if
      // they do we treat them as advanceable so the chain keeps moving.
      return { fatal: false, reason: summary };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { fatal: false, reason: `network/runtime error: ${msg}` };
  }
}
