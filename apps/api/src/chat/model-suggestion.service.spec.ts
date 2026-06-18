import { ModelSuggestionService } from './model-suggestion.service.js';

/** Stub catalog whose list() resolves to the given ids (or throws). */
function makeCatalog(ids: string[] | Error) {
  return {
    list: () =>
      ids instanceof Error
        ? Promise.reject(ids)
        : Promise.resolve(ids.map((id) => ({ id }))),
  };
}

function svc(ids: string[] | Error) {
  return new ModelSuggestionService(makeCatalog(ids) as never);
}

const CODING = 'help me debug this typescript function';
const CREATIVE = 'write a short story about a poem';

describe('ModelSuggestionService.suggest', () => {
  it('suggests the coding model when the id is in the catalog', async () => {
    const out = await svc(['anthropic/claude-opus-4.7']).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
    });
    expect(out).toMatchObject({ id: 'anthropic/claude-opus-4.7' });
  });

  it('suggests the creative model for prose prompts', async () => {
    const out = await svc(['openai/gpt-5.5']).suggest({
      prompt: CREATIVE,
      currentModel: 'anthropic/claude-opus-4.7',
    });
    expect(out).toMatchObject({ id: 'openai/gpt-5.5' });
  });

  it('returns null when no rule matches', async () => {
    const out = await svc(['anthropic/claude-opus-4.7']).suggest({
      prompt: 'what time is it',
      currentModel: 'openai/gpt-5.5',
    });
    expect(out).toBeNull();
  });

  it('skips the suggestion when already on a matching provider', async () => {
    const out = await svc(['anthropic/claude-opus-4.7']).suggest({
      prompt: CODING,
      currentModel: 'anthropic/claude-opus-4.7',
    });
    expect(out).toBeNull();
  });

  it('drops a matched suggestion whose id is NOT in the catalog (delisting guard)', async () => {
    const out = await svc(['some/other-model']).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
    });
    expect(out).toBeNull();
  });

  it('fails safe to null when the catalog is unreachable', async () => {
    const out = await svc(new Error('openrouter down')).suggest({
      prompt: CODING,
      currentModel: 'openai/gpt-5.5',
    });
    expect(out).toBeNull();
  });
});
