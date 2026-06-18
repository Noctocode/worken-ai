/**
 * Operator-tunable knobs for executable skills (Option #3, Phase F). Each reads
 * an env var at startup with a safe default, so a deployment can tighten/loosen
 * the cost ceiling, agent-loop caps, sandbox resource limits, and artifact
 * retention without a code change. Invalid / non-positive values fall back to
 * the default rather than disabling a guard.
 */

/** Parse a positive number from env, else the default. */
export function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Agent-loop + billing caps for a single run. */
export const skillExecutionConfig = {
  /** Hard cap on model↔tool round-trips per run (fail-closed). */
  maxIterations: numFromEnv('SKILL_MAX_ITERATIONS', 8),
  /** Hard per-run cost ceiling (USD). */
  maxRunCostUsd: numFromEnv('SKILL_MAX_RUN_COST_USD', 1.0),
  /** Conservative price (USD/1k tokens) when the catalog has no entry. */
  fallbackUsdPer1kTokens: numFromEnv('SKILL_FALLBACK_USD_PER_1K_TOKENS', 0.02),
};

/** Resource limits enforced on each sandboxed script run. */
export const skillSandboxConfig = {
  timeoutMs: numFromEnv('SKILL_SANDBOX_TIMEOUT_MS', 30_000),
  maxOutputBytes: numFromEnv('SKILL_SANDBOX_MAX_OUTPUT_BYTES', 64 * 1024),
  maxArtifactBytes: numFromEnv(
    'SKILL_SANDBOX_MAX_ARTIFACT_BYTES',
    25 * 1024 * 1024,
  ),
  memoryMb: numFromEnv('SKILL_SANDBOX_MEMORY_MB', 256),
  cpus: numFromEnv('SKILL_SANDBOX_CPUS', 1),
};

/** Artifact retention. */
export const skillArtifactConfig = {
  retentionMs: numFromEnv(
    'SKILL_ARTIFACT_RETENTION_MS',
    7 * 24 * 60 * 60 * 1000,
  ),
};
