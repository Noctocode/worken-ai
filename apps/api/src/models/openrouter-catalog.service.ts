import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

const CACHE_KEY = 'openrouter:models:catalog';
const CACHE_TTL_SECONDS = 3600; // 1h

export interface CatalogModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

/**
 * Fetches the OpenRouter `/api/v1/models` catalog and caches it in Redis.
 * The catalog itself is public — no auth header required — but we still
 * proxy it through the BE so the FE doesn't slam OpenRouter on every page
 * load and so we have a single place to layer caching/filtering.
 */
@Injectable()
export class OpenRouterCatalogService {
  private readonly logger = new Logger(OpenRouterCatalogService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async list(): Promise<CatalogModel[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as CatalogModel[];
      } catch {
        // Corrupt cache entry — fall through to refetch.
      }
    }

    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OpenRouter /models fetch failed: ${res.status} ${res.statusText} — ${text}`,
      );
    }

    const json = (await res.json()) as { data?: CatalogModel[] };
    const data = json.data ?? [];

    await this.redis.set(CACHE_KEY, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS);
    return data;
  }

  /** Force-refresh: bypass cache, refetch, and replace. Useful after admin edits. */
  async refresh(): Promise<CatalogModel[]> {
    await this.redis.del(CACHE_KEY);
    return this.list();
  }

  /**
   * Estimate USD cost of a chat call from the catalog's per-token
   * pricing. Returns null when the model isn't in the catalog or has
   * no pricing data — caller should leave costUsd null and not show a
   * misleading zero on the dashboard.
   *
   * Used for BYOK / Custom routes where the upstream response doesn't
   * include cost (only OpenRouter does), so observability would
   * otherwise undercount spend.
   */
  async estimateCost(
    modelId: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number | null> {
    const catalog = await this.list();
    const model = catalog.find((m) => m.id === modelId);
    if (!model?.pricing) return null;
    const promptPrice = Number(model.pricing.prompt ?? 0);
    const completionPrice = Number(model.pricing.completion ?? 0);
    if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) {
      return null;
    }
    return promptTokens * promptPrice + completionTokens * completionPrice;
  }
}
