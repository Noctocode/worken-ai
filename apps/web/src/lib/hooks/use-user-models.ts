"use client";

import { useCallback, useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
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

/**
 * Refresh every query that depends on the user's model_configs after a
 * create/update/delete mutation. Two keys to touch:
 *   - `["models"]` (exact): drives Manage Models.
 *   - `["models", "effective"]`: drives /compare-models, the project
 *     model picker, and anything else that asks "what can the user
 *     chat with right now?".
 *
 * Both use `refetchType: 'all'`. AddModelDialog fires from BOTH the
 * Models tab and /compare-models, so at mutation time either consumer
 * may be unmounted. React Query's default active-only refetch would
 * then just mark the inactive query stale and leave its cached data in
 * place — so the next visit renders that stale list (a cached `[]`
 * flashing "Add at least 2 models" on /compare-models, or the Models
 * tab missing a just-added alias) until its own background refetch
 * lands. Forcing an inactive refetch warms the cache before the user
 * navigates over.
 *
 * Deliberately NOT a prefix invalidation on `["models"]` — that would
 * also catch `["models", "available"]` (the read-only OpenRouter
 * catalog), which can't change as a side-effect of an alias mutation
 * and only churns network for nothing.
 */
export function invalidateModelMutations(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    queryKey: ["models"],
    exact: true,
    refetchType: "all",
  });
  void queryClient.invalidateQueries({
    queryKey: ["models", "effective"],
    refetchType: "all",
  });
}
