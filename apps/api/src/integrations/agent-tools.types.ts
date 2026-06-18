/**
 * Provider-neutral tool-calling shapes for the executable-skills agent loop
 * (Option #3). Types only — no service imports — so both the provider adapters
 * (e.g. AnthropicClientService) and the routing abstraction (ToolCallingService)
 * can depend on them without a circular import.
 */

/** A tool the model may call. `inputSchema` is a JSON Schema object. */
export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Caller-supplied handler: runs a tool call, returns its result text.
 *  Throwing is surfaced to the model as an error tool_result. */
export type AgentToolDispatch = (call: {
  id: string;
  name: string;
  input: unknown;
}) => Promise<string>;

/** Events streamed by the agent loop. */
export type AgentLoopEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      output: string;
      isError: boolean;
    }
  | {
      type: 'usage';
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string; status?: number };

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Provider-neutral core of a tool-calling run — no routing/credentials. */
export interface AgentLoopRequest {
  system?: string;
  messages: AgentChatMessage[];
  tools: AgentToolDef[];
  dispatch: AgentToolDispatch;
  /** Hard cap on model↔tool round-trips. Fail-closed on reaching it. */
  maxIterations?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Invoked just before each upstream model call (0-based round index). The
   * gate for multi-call billing (Option #3, Phase C): the caller re-checks the
   * budget and the per-run cost ceiling here. **Throwing stops the loop** —
   * surfaced as an `error` event — so a runaway/over-budget run never makes the
   * next call. A `usage` event is emitted per round so the caller can track
   * accumulated spend between gates.
   */
  onBeforeCall?: (iteration: number) => Promise<void>;
}
