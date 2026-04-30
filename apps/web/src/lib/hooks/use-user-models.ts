"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchModels, type AvailableModel } from "@/lib/api";

const STALE_TIME_MS = 60 * 1000; // 1 min — user can edit Models tab live

/**
 * The user's active model_configs aliases, exposed in the same shape as
 * useAvailableModels() so consumers can swap one for the other.
 *
 * Used by the Compare Models arena, where we only want to allow choosing
 * among models the user has explicitly added under Management → Models
 * (i.e. their custom aliases). Two aliases that point at the same upstream
 * modelIdentifier are deduped to the first one, since selectedModels in
 * the arena is keyed on upstream id.
 */
export function useUserModels(): {
  models: AvailableModel[];
  isLoading: boolean;
  error: unknown;
  getLabel: (id: string) => string;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models", "user", "active"],
    queryFn: fetchModels,
    staleTime: STALE_TIME_MS,
  });

  const all = data ?? [];
  const seen = new Set<string>();
  const models: AvailableModel[] = [];
  for (const cfg of all) {
    if (!cfg.isActive) continue;
    if (seen.has(cfg.modelIdentifier)) continue;
    seen.add(cfg.modelIdentifier);
    models.push({
      id: cfg.modelIdentifier,
      name: cfg.customName,
    });
  }

  const getLabel = (id: string) =>
    models.find((m) => m.id === id)?.name ?? id;

  return { models, isLoading, error, getLabel };
}
