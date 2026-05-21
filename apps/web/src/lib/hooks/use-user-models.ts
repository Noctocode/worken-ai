"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchEffectiveModels,
  type AvailableModel,
  type EffectiveModel,
} from "@/lib/api";

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
 * gates on `< 2 models`, project create alerts the user instead).
 *
 * The hook keeps the same shape as useAvailableModels for drop-in
 * compatibility — consumers that just need {id, name, getLabel} don't
 * need to know about the new EffectiveModel.source field.
 */
export function useUserModels(): {
  models: AvailableModel[];
  /** Same models as `models`, with the `routing` field preserved so
   *  pickers can append a "(BYOK)" / "(Custom)" marker. Kept separate
   *  so legacy callers that only need `AvailableModel` don't need to
   *  worry about the extra field. */
  effective: EffectiveModel[];
  isLoading: boolean;
  /** True whenever a fetch is in flight — covers the initial load AND
   *  subsequent background refetches (e.g., after a sibling tab
   *  invalidated `["models", "effective"]`). Consumers should gate
   *  empty-state UI on `!isLoading && !isFetching` rather than just
   *  `!isLoading`; otherwise a cached `[]` from a stale fetch flashes
   *  the empty state until the background refetch lands. */
  isFetching: boolean;
  error: unknown;
  getLabel: (id: string) => string;
} {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["models", "effective"],
    queryFn: fetchEffectiveModels,
    staleTime: STALE_TIME_MS,
  });

  // Memoize on `data` reference so consumers' `useEffect` deps don't
  // churn on every parent re-render. Without this, `effective.map(...)`
  // produces a fresh array each render and any effect that depends on
  // `models` re-runs needlessly (compare-models had this pattern and
  // it amplified the load-time flicker).
  const effective = useMemo<EffectiveModel[]>(() => data ?? [], [data]);
  const models = useMemo<AvailableModel[]>(
    () =>
      // Order is BE-controlled: aliases first, then BYOK catalog entries.
      effective.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        context_length: m.context_length,
        pricing: m.pricing,
      })),
    [effective],
  );

  const getLabel = useCallback(
    (id: string) => models.find((m) => m.id === id)?.name ?? id,
    [models],
  );

  return { models, effective, isLoading, isFetching, error, getLabel };
}
