"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchEffectiveModels, type AvailableModel } from "@/lib/api";

const STALE_TIME_MS = 60 * 1000; // 1 min — list moves when user edits Models or Integration tabs

/**
 * Effective model list for the current user — used by the arena, the
 * project pickers, and anything else that lets the user pick a model
 * to chat with.
 *
 * Sources (BE-merged via /models/effective):
 *   - Active model_configs aliases (Models tab) — custom name preserved.
 *   - Catalog models for any provider with an enabled BYOK key in
 *     Integration tab — auto-unlocked, no per-model alias needed.
 *
 * Returns an empty list when the user has neither aliases nor BYOK
 * keys; UI should treat that as a setup-required state (the arena
 * already does — it gates on `< 2 models`).
 *
 * The hook keeps the same shape as useAvailableModels for drop-in
 * compatibility — consumers that just need {id, name, getLabel} don't
 * need to know about the new EffectiveModel.source field.
 */
export function useUserModels(): {
  models: AvailableModel[];
  isLoading: boolean;
  error: unknown;
  getLabel: (id: string) => string;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models", "effective"],
    queryFn: fetchEffectiveModels,
    staleTime: STALE_TIME_MS,
  });

  const all = data ?? [];
  // Strip the BE-only `source` / `aliasId` fields for callers that only
  // know AvailableModel. Order is BE-controlled: aliases first, then
  // BYOK catalog entries.
  const models: AvailableModel[] = all.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    context_length: m.context_length,
    pricing: m.pricing,
  }));

  const getLabel = (id: string) =>
    models.find((m) => m.id === id)?.name ?? id;

  return { models, isLoading, error, getLabel };
}
