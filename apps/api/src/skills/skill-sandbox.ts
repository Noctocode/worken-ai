import { Injectable } from '@nestjs/common';

/**
 * Pluggable execution backend for executable skills (Option #3, Phase D / 3b).
 *
 * This module defines ONLY the contract + a deny-by-default implementation. The
 * concrete runtime is intentionally deferred: the v1 candidate is Anthropic
 * code-execution, with a self-hosted container / WASM worker as the fallback —
 * a choice that needs account/infra verification before it's committed to (see
 * docs/skills-option3-plan.md §3.4, §12). Everything downstream (artifact
 * storage, download, retention) consumes a {@link SandboxRunResult} and is
 * therefore independent of which runtime is eventually dropped in here.
 *
 * Until a real runtime is configured, {@link UnavailableSandboxRuntime} denies
 * every run — so no untrusted skill code executes. This is the safe production
 * default; an in-process runner is deliberately NOT shipped, because `vm` /
 * worker-threads are not a security boundary for untrusted code.
 */

/** DI token for the active {@link SkillSandboxRuntime}. */
export const SKILL_SANDBOX = Symbol('SKILL_SANDBOX');

/** Resource caps a runtime MUST enforce when running untrusted skill code. */
export interface SandboxLimits {
  /** Hard wall-clock cap (ms). The run is killed past this. */
  timeoutMs: number;
  /** Max bytes of captured stdout+stderr; output is truncated beyond this. */
  maxOutputBytes: number;
  /** Max total bytes of produced artifact files; the run fails past this. */
  maxArtifactBytes: number;
  /** Memory cap (MiB). Swap is disabled so this is a hard ceiling. */
  memoryMb: number;
  /** CPU cap (fractional cores). */
  cpus: number;
  /** Outbound network access. Default false — skills run offline. */
  network: boolean;
}

/** Conservative defaults — offline, short, small. Tune in config (Phase F). */
export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  timeoutMs: 30_000,
  maxOutputBytes: 64 * 1024,
  maxArtifactBytes: 25 * 1024 * 1024,
  memoryMb: 256,
  cpus: 1,
  network: false,
};

/** A file produced (or supplied) for a sandbox run. `content` is raw bytes. */
export interface SandboxFile {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface SandboxRunInput {
  /** Language of the entrypoint, e.g. 'python' | 'node'. */
  language: string;
  /** Entrypoint script source. */
  script: string;
  /** Read-only input files the script may read (e.g. fetched KC data). */
  inputs?: SandboxFile[];
  limits: SandboxLimits;
  /** Aborts the run (user Stop / client disconnect). */
  signal?: AbortSignal;
}

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True if stdout/stderr was truncated at {@link SandboxLimits.maxOutputBytes}. */
  outputTruncated: boolean;
  /** Files the script wrote to its output dir. */
  artifacts: SandboxFile[];
  /** True if the run was killed by the wall-clock cap. */
  timedOut: boolean;
  /** Non-null when the run failed to start / timed out / exceeded a cap. */
  error: string | null;
}

/** Execution backend. Implementations: Anthropic code-exec (v1 candidate) or a
 *  self-hosted container/WASM worker. */
export interface SkillSandboxRuntime {
  /** Whether a real runtime is configured. Deny-by-default returns false. */
  isAvailable(): boolean;
  run(input: SandboxRunInput): Promise<SandboxRunResult>;
}

/**
 * Safe production default: no runtime configured, so script execution is
 * denied. Callers MUST check {@link isAvailable} and fall back to the
 * loop-with-tools behavior (Phase B) rather than executing the skill's own
 * scripts.
 */
@Injectable()
export class UnavailableSandboxRuntime implements SkillSandboxRuntime {
  isAvailable(): boolean {
    return false;
  }

  run(): Promise<SandboxRunResult> {
    throw new Error(
      'Skill execution sandbox is not configured — scripts cannot be run.',
    );
  }
}
