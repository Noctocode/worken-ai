/**
 * @deprecated The hardcoded MODELS / MODEL_LABELS list was replaced by the
 * admin-curated catalog. Use `useAvailableModels()` from
 * `@/lib/hooks/use-available-models` for the runtime list, or call
 * `fetchAvailableModels()` from `@/lib/api` directly when you need the
 * data outside React.
 *
 * This file is kept as an empty module so any leftover bare-specifier
 * import surfaces as a TS error instead of silently resolving to a stale
 * constant. Remove it once we're confident no tooling references it.
 */
export {};
