import { Injectable } from '@nestjs/common';
import { KnowledgeIngestionService } from '../knowledge-core/knowledge-ingestion.service.js';
import type {
  AgentToolDef,
  AgentToolDispatch,
} from '../integrations/agent-tools.types.js';

/** Per-run context the tools are scoped to. */
export interface ToolContext {
  userId: string;
}

/** The tool defs handed to the model + the dispatcher that runs them. */
export interface BuiltTools {
  tools: AgentToolDef[];
  dispatch: AgentToolDispatch;
}

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
  constructor(private readonly ingestion: KnowledgeIngestionService) {}

  build(ctx: ToolContext): BuiltTools {
    const { userId } = ctx;

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
        default:
          return `Error: unknown tool "${call.name}".`;
      }
    };

    return { tools: defs, dispatch };
  }
}
