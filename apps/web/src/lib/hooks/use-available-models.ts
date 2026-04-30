"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAvailableModels, type AvailableModel } from "@/lib/api";

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — catalog rarely changes mid-session

/**
 * The admin-curated subset of the OpenRouter catalog. Drives every model
 * picker in the app. Returns an empty list (not a fallback to hardcoded
 * defaults) when the admin has enabled nothing yet — UI should treat that
 * as a setup-required state.
 */
export function useAvailableModels(): {
  models: AvailableModel[];
  isLoading: boolean;
  error: unknown;
  /** Resolve a model id to a friendly label, falling back to the id itself. */
  getLabel: (id: string) => string;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: ["models", "available"],
    queryFn: fetchAvailableModels,
    staleTime: STALE_TIME_MS,
  });

  const models = data ?? [];
  const getLabel = (id: string) =>
    models.find((m) => m.id === id)?.name ?? id;

  return { models, isLoading, error, getLabel };
}
