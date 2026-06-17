import {
  SkillRouterService,
  type RoutableSkill,
} from './skill-router.service.js';

// Build a routable skill with a 2-D unit embedding so cosine is easy to
// reason about: [1,0] matches a [1,0] query exactly (cos=1), [0,1] is
// orthogonal (cos=0, below the similarity threshold).
function skill(
  id: string,
  embedding: number[],
  instructions = 'do the thing',
): RoutableSkill {
  return {
    id,
    name: `Skill ${id}`,
    description: `desc ${id}`,
    instructions,
    descriptionEmbedding: embedding,
  };
}

describe('SkillRouterService.selectForMessage', () => {
  let router: SkillRouterService;

  beforeEach(() => {
    router = new SkillRouterService({} as never, {} as never, {} as never);
    // Isolate the selection algorithm from the DB + LLM.
    jest
      .spyOn(router as never, 'loadConversationSkills')
      .mockResolvedValue([] as never);
    jest
      .spyOn(router as never, 'persistSticky')
      .mockResolvedValue(undefined as never);
  });

  const stubAccessible = (skills: RoutableSkill[]) =>
    jest.spyOn(router, 'getAccessibleSkills').mockResolvedValue(skills);

  // Confirm-step stub: confirm everything passed in (so embedding ranking
  // is what's under test). Individual tests override this.
  const confirmAll = () =>
    jest
      .spyOn(router as never, 'confirmRelevance')
      .mockImplementation(
        (_userId: never, _msg: never, candidates: RoutableSkill[]) =>
          Promise.resolve(new Set(candidates.map((c) => c.id))),
      );

  it('returns nothing when the user has no accessible skills', async () => {
    stubAccessible([]);
    confirmAll();
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
    });
    expect(out).toEqual([]);
  });

  it('selects a skill above the threshold and drops one below it', async () => {
    stubAccessible([skill('match', [1, 0]), skill('orthogonal', [0, 1])]);
    confirmAll();
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
    });
    expect(out.map((s) => s.id)).toEqual(['match']);
    expect(out[0].reason).toBe('auto');
  });

  it('caps auto-selected skills at MAX_AUTO_SKILLS (2)', async () => {
    stubAccessible([
      skill('a', [1, 0]),
      skill('b', [0.99, 0.01]),
      skill('c', [0.98, 0.02]),
    ]);
    confirmAll();
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
    });
    expect(out.filter((s) => s.reason === 'auto')).toHaveLength(2);
  });

  it('always includes pinned skills, even below the threshold', async () => {
    stubAccessible([skill('pinned', [0, 1])]); // orthogonal → below threshold
    confirmAll();
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
      pinnedSkillIds: ['pinned'],
    });
    expect(out.map((s) => s.id)).toEqual(['pinned']);
    expect(out[0].reason).toBe('pinned');
  });

  it('keeps sticky skills active across the conversation', async () => {
    stubAccessible([skill('sticky', [0, 1])]); // below threshold this turn
    confirmAll();
    jest
      .spyOn(router as never, 'loadConversationSkills')
      .mockResolvedValue([{ skillId: 'sticky', pinned: false }] as never);

    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
      conversationId: 'c1',
    });
    expect(out.map((s) => s.id)).toEqual(['sticky']);
    expect(out[0].reason).toBe('sticky');
  });

  it('fails closed: an empty confirm result drops all auto candidates', async () => {
    stubAccessible([skill('match', [1, 0])]);
    jest
      .spyOn(router as never, 'confirmRelevance')
      .mockResolvedValue(new Set() as never);
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
    });
    expect(out).toEqual([]);
  });

  it('persists freshly auto-selected skills as sticky', async () => {
    stubAccessible([skill('match', [1, 0])]);
    confirmAll();
    const persist = jest
      .spyOn(router as never, 'persistSticky')
      .mockResolvedValue(undefined as never);
    await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
      conversationId: 'c1',
    });
    expect(persist).toHaveBeenCalledWith('c1', ['match']);
  });

  it('drops skills that overflow the char budget (pins kept first)', async () => {
    const huge = 'x'.repeat(5000); // > MAX_SKILL_CHARS (4000)
    stubAccessible([skill('pinned', [0, 1], huge)]);
    confirmAll();
    const out = await router.selectForMessage({
      userId: 'u1',
      queryEmbedding: [1, 0],
      messageText: 'hi',
      pinnedSkillIds: ['pinned'],
    });
    // The single pinned skill exceeds the budget on its own → dropped.
    expect(out).toEqual([]);
  });
});

describe('SkillRouterService.resolveConfirmClient', () => {
  const origKey = process.env['OPENROUTER_API_KEY'];
  afterEach(() => {
    if (origKey === undefined) delete process.env['OPENROUTER_API_KEY'];
    else process.env['OPENROUTER_API_KEY'] = origKey;
  });

  it('builds a client from the per-user transport key (no env needed)', async () => {
    delete process.env['OPENROUTER_API_KEY'];
    const transport = {
      resolve: jest.fn().mockResolvedValue({
        apiKey: 'sk-byok-user',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    };
    const router = new SkillRouterService(
      {} as never,
      {} as never,
      transport as never,
    );
    const client = await (
      router as never as {
        resolveConfirmClient: (u: string) => Promise<unknown>;
      }
    ).resolveConfirmClient('u1');
    expect(client).not.toBeNull();
    expect(transport.resolve).toHaveBeenCalled();
  });

  it('falls back to process.env when the transport resolves no key', async () => {
    process.env['OPENROUTER_API_KEY'] = 'sk-platform-fallback';
    const transport = {
      resolve: jest.fn().mockResolvedValue({ apiKey: '', baseURL: '' }),
    };
    const router = new SkillRouterService(
      {} as never,
      {} as never,
      transport as never,
    );
    const client = await (
      router as never as {
        resolveConfirmClient: (u: string) => Promise<unknown>;
      }
    ).resolveConfirmClient('u1');
    expect(client).not.toBeNull();
  });

  it('returns null (→ fail-closed) when neither transport nor env yields a key', async () => {
    delete process.env['OPENROUTER_API_KEY'];
    const transport = {
      resolve: jest.fn().mockRejectedValue(new Error('no route')),
    };
    const router = new SkillRouterService(
      {} as never,
      {} as never,
      transport as never,
    );
    const client = await (
      router as never as {
        resolveConfirmClient: (u: string) => Promise<unknown>;
      }
    ).resolveConfirmClient('u1');
    expect(client).toBeNull();
  });
});

describe('SkillRouterService.renderContextBlock', () => {
  const router = new SkillRouterService({} as never, {} as never, {} as never);

  it('returns empty string for no skills', () => {
    expect(router.renderContextBlock([])).toBe('');
  });

  it('renders each skill under a heading', () => {
    const block = router.renderContextBlock([
      { id: 'a', name: 'Proposal', instructions: 'Be formal.', reason: 'auto' },
    ]);
    expect(block).toContain('## Skill: Proposal');
    expect(block).toContain('Be formal.');
  });
});
