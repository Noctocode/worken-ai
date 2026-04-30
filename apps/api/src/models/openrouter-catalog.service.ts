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
}
