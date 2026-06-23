import { ModelSuggestionService } from './model-suggestion.service.js';

/** Stub ModelsService whose availableModelIds() resolves to the given ids
 *  (as a Set) — or rejects, to exercise the fail-safe path. */
function makeModelsService(ids: string[] | Error) {
  return {
    availableModelIds: () =>
      ids instanceof Error
        ? Promise.reject(ids)
        : Promise.resolve(new Set(ids)),
  };
}

function svc(ids: string[] | Error) {
  return new ModelSuggestionService(makeModelsService(ids) as never);
}

const CODING = 'help me debug this typescript function';
const CREATIVE = 'write a short story about a poem';
const USER = 'user-1';

describe('ModelSuggestionService.suggest', () => {
  it("suggests the coding model when it is in the user's available models", async () => {
    const out = await svc(['anthropic/claude-opus-4.8']).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
      userId: USER,
    });
    expect(out).toMatchObject({ id: 'anthropic/claude-opus-4.8' });
  });

  it('suggests the creative model for prose prompts', async () => {
    const out = await svc(['openai/gpt-5.5']).suggest({
      prompt: CREATIVE,
      currentModel: 'anthropic/claude-opus-4.8',
      userId: USER,
    });
    expect(out).toMatchObject({ id: 'openai/gpt-5.5' });
  });

  it('returns null when no rule matches', async () => {
    const out = await svc(['anthropic/claude-opus-4.8']).suggest({
      prompt: 'what time is it',
      currentModel: 'openai/gpt-5.5',
      userId: USER,
    });
    expect(out).toBeNull();
  });

  it('skips the suggestion when already on a matching provider', async () => {
    const out = await svc(['anthropic/claude-opus-4.8']).suggest({
      prompt: CODING,
      currentModel: 'anthropic/claude-opus-4.8',
      userId: USER,
    });
    expect(out).toBeNull();
  });

  it('drops a matched suggestion the user has not enabled (curation guard)', async () => {
    const out = await svc(['some/other-model']).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
      userId: USER,
    });
    expect(out).toBeNull();
  });

  it('fails safe to null when the availability lookup throws', async () => {
    const out = await svc(new Error('db down')).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
      userId: USER,
    });
    expect(out).toBeNull();
  });
});
