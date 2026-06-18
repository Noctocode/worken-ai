import { Inject, Injectable } from '@nestjs/common';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import type {
  AgentToolDef,
  AgentToolDispatch,
} from '../integrations/agent-tools.types.js';
import { SkillArtifactService } from './skill-artifact.service.js';
import {
  DEFAULT_SANDBOX_LIMITS,
  SKILL_SANDBOX,
  type SandboxRunResult,
  type SkillSandboxRuntime,
} from './skill-sandbox.js';

/** One of the skill's own scripts (parsed from SKILL.md). */
export interface SkillScript {
  name: string;
  language: string;
  entrypoint?: boolean;
  content: string;
}

/** Artifact metadata surfaced back to the run after run_script persists it. */
export interface StoredArtifact {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** Per-run context the tools are scoped to. */
export interface ToolContext {
  userId: string;
  /** The active run id — required for run_script to persist artifacts. */
  runId?: string;
  /** The skill's own scripts; run_script may only execute one of these. */
  scripts?: SkillScript[];
  /** Notified with each batch of artifacts run_script persists, so the run can
   *  stream them to the client. */
  onArtifacts?: (artifacts: StoredArtifact[]) => void;
  /** Aborts an in-flight sandbox run (user Stop / disconnect). */
  signal?: AbortSignal;
}

/** The tool defs handed to the model + the dispatcher that runs them. */
export interface BuiltTools {
  tools: AgentToolDef[];
  dispatch: AgentToolDispatch;
}

/** Clip captured output before feeding it back to the model. */
const STDOUT_CLIP = 4000;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object'
    ? (v as Record<string, unknown>)
    : {};
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Vetted tools an executable-skill agent loop may call in the 3a (no-sandbox)
 * stage. Every tool is **scoped to the caller** via the existing KC services —
 * a tool can never reach data the user couldn't already see in chat. Handlers
 * return a string the model reads back; bad input returns a corrective message
 * (not a throw) so the model can retry, while genuine failures throw and become
 * an error tool_result.
 */
@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly ingestion: KnowledgeIngestionService,
    private readonly artifacts: SkillArtifactService,
    @Inject(SKILL_SANDBOX) private readonly sandbox: SkillSandboxRuntime,
  ) {}

  /** Pick the script to run: by name (case-insensitive), else the entrypoint,
   *  else the only one. Returns null when ambiguous/absent. */
  private pickScript(
    scripts: SkillScript[],
    name?: string,
  ): SkillScript | null {
    if (name) {
      return (
        scripts.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null
      );
    }
    const entry = scripts.find((s) => s.entrypoint);
    if (entry) return entry;
    return scripts.length === 1 ? scripts[0] : null;
  }

  build(ctx: ToolContext): BuiltTools {
    const { userId } = ctx;
    // run_script is offered only when a real sandbox is configured AND the
    // skill actually ships scripts AND we have a run to attach artifacts to.
    const canRunScripts =
      this.sandbox.isAvailable() &&
      !!ctx.runId &&
      (ctx.scripts?.length ?? 0) > 0;

    const defs: AgentToolDef[] = [
      {
        name: 'kc_search',
        description:
          'Search the user-accessible Knowledge Core for passages relevant to a query. Returns the top matching chunks.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for.' },
            limit: {
              type: 'integer',
              description: 'Max chunks to return (1–10, default 5).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'read_attached_file',
        description:
          'Read the full text of one Knowledge Core file the caller owns, by its id.',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'The KC file id (uuid).' },
          },
          required: ['fileId'],
        },
      },
    ];

    if (canRunScripts) {
      defs.push({
        name: 'run_script',
        description:
          "Run one of THIS skill's own scripts in a locked-down sandbox and capture its output plus any files it produces (returned as downloadable artifacts). You cannot run arbitrary code — only the skill's provided scripts, by name (or the entrypoint if omitted).",
        inputSchema: {
          type: 'object',
          properties: {
            scriptName: {
              type: 'string',
              description:
                "Name of the skill's script to run; omit to run the entrypoint.",
            },
          },
        },
      });
    }

    const dispatch: AgentToolDispatch = async (call) => {
      const input = asRecord(call.input);
      switch (call.name) {
        case 'kc_search': {
          const query = input.query;
          if (typeof query !== 'string' || !query.trim()) {
            return 'Error: `query` must be a non-empty string.';
          }
          const limit = clamp(
            typeof input.limit === 'number' ? Math.floor(input.limit) : 5,
            1,
            10,
          );
          const chunks = await this.ingestion.searchAccessibleChunks(
            userId,
            query,
            limit,
          );
          if (chunks.length === 0) return 'No matching knowledge found.';
          return chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
        }
        case 'read_attached_file': {
          const fileId = input.fileId;
          if (typeof fileId !== 'string' || !fileId) {
            return 'Error: `fileId` must be a string.';
          }
          const files = await this.ingestion.getOwnedAttachedFilesText(userId, [
            fileId,
          ]);
          if (files.length === 0) {
            return 'File not found or not accessible to you.';
          }
          return files[0].text || '(the file has no extractable text)';
        }
        case 'run_script': {
          if (!canRunScripts || !ctx.runId) {
            return 'Error: script execution is not available for this run.';
          }
          const name =
            typeof input.scriptName === 'string' ? input.scriptName : undefined;
          const script = this.pickScript(ctx.scripts ?? [], name);
          if (!script) {
            const available = (ctx.scripts ?? []).map((s) => s.name).join(', ');
            return `Error: no matching script. Specify scriptName as one of: ${available || '(none)'}.`;
          }
          // Sandbox/store failures (daemon down, disk error) are infra issues,
          // not the model's fault — return a concise corrective message rather
          // than letting a raw exception become a confusing tool error the
          // model retries against.
          let result: SandboxRunResult;
          try {
            result = await this.sandbox.run({
              language: script.language,
              script: script.content,
              limits: DEFAULT_SANDBOX_LIMITS,
              signal: ctx.signal,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return `Error: could not run "${script.name}" — the execution sandbox is unavailable (${msg}). Do not retry.`;
          }
          // Persist + surface any produced files.
          let artifactNote = 'No files were produced.';
          if (result.artifacts.length > 0) {
            let surfaced: StoredArtifact[];
            try {
              const stored = await this.artifacts.store(
                ctx.runId,
                result.artifacts,
              );
              surfaced = stored.map((a) => ({
                id: a.id,
                filename: a.filename,
                mimeType: a.mimeType,
                sizeBytes: a.sizeBytes,
              }));
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return `Ran "${script.name}" but its output files could not be saved (${msg}). The script itself succeeded; do not retry just to regenerate the files.`;
            }
            ctx.onArtifacts?.(surfaced);
            artifactNote = `Produced ${surfaced.length} artifact(s): ${surfaced
              .map((a) => `${a.filename} (${a.sizeBytes} bytes)`)
              .join(', ')}.`;
          }
          const stdout = result.stdout.slice(0, STDOUT_CLIP);
          const parts = [
            `Ran "${script.name}" (${script.language}). exit=${result.exitCode}.`,
            result.error ? `Error: ${result.error}` : null,
            stdout ? `stdout:\n${stdout}` : null,
            result.stderr
              ? `stderr:\n${result.stderr.slice(0, STDOUT_CLIP)}`
              : null,
            artifactNote,
          ].filter(Boolean);
          return parts.join('\n');
        }
        default:
          return `Error: unknown tool "${call.name}".`;
      }
    };

    return { tools: defs, dispatch };
  }
}
