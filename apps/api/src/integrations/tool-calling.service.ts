import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnthropicClientService,
  isAnthropicNativeSupported,
} from './anthropic-client.service.js';
import { ChatTransportService } from './chat-transport.service.js';
import type { AgentLoopEvent, AgentLoopRequest } from './agent-tools.types.js';

/** A provider-neutral tool-calling run: the agent-loop request + how to route. */
export type ToolCallingRequest = AgentLoopRequest & {
  userId: string;
  modelIdentifier: string;
  projectId?: string | null;
  teamId?: string | null;
};

/**
 * Provider abstraction for the executable-skills agent loop (Option #3).
 * Resolves the caller's transport for the requested model and, **only when it
 * routes to a native Anthropic model**, drives the tool-calling loop via
 * AnthropicClientService. Every other route is rejected up-front — tool-calling
 * has no cross-provider implementation yet, and a half-working loop on a model
 * that can't tool-call is worse than a clear "unsupported".
 *
 * Composes ChatTransportService (the resolver) + AnthropicClientService (the
 * impl) rather than bloating either; new providers slot in as more branches.
 */
@Injectable()
export class ToolCallingService {
  constructor(
    private readonly transport: ChatTransportService,
    private readonly anthropic: AnthropicClientService,
  ) {}

  /** True iff `modelIdentifier` would route to a tool-calling-capable backend
   *  for this caller. Lets callers (UI gate / endpoint) check before running. */
  async supports(input: {
    userId: string;
    modelIdentifier: string;
    projectId?: string | null;
    teamId?: string | null;
  }): Promise<boolean> {
    const t = await this.transport.resolve(input);
    return t.kind === 'anthropic-sdk' && isAnthropicNativeSupported(t.model);
  }

  /**
   * Run the agent loop, yielding provider-neutral {@link AgentLoopEvent}s.
   * Throws BadRequest if the resolved route can't tool-call.
   */
  async *streamWithTools(
    req: ToolCallingRequest,
  ): AsyncIterable<AgentLoopEvent> {
    const t = await this.transport.resolve({
      userId: req.userId,
      modelIdentifier: req.modelIdentifier,
      projectId: req.projectId,
      teamId: req.teamId,
    });

    if (t.kind !== 'anthropic-sdk' || !isAnthropicNativeSupported(t.model)) {
      throw new BadRequestException(
        'Executable skills require an Anthropic-native model. Pick a supported Claude model and connect an Anthropic key.',
      );
    }

    yield* this.anthropic.streamWithTools({
      model: t.model,
      apiKey: t.apiKey,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
      dispatch: req.dispatch,
      maxIterations: req.maxIterations,
      maxTokens: req.maxTokens,
      signal: req.signal,
      onBeforeCall: req.onBeforeCall,
    });
  }
}
