import { ToolRegistryService } from './tool-registry.service.js';

function svc(ingestion: unknown) {
  return new ToolRegistryService(ingestion as never);
}

describe('ToolRegistryService', () => {
  it('exposes kc_search + read_attached_file tool defs', () => {
    const { tools } = svc({}).build({ userId: 'u1' });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'kc_search',
      'read_attached_file',
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toMatchObject({ type: 'object' });
      expect(typeof t.description).toBe('string');
    }
  });

  it('kc_search dispatches to the caller-scoped search and joins chunks', async () => {
    const searchAccessibleChunks = jest
      .fn()
      .mockResolvedValue([{ content: 'alpha' }, { content: 'beta' }]);
    const { dispatch } = svc({ searchAccessibleChunks }).build({
      userId: 'u1',
    });
    const out = await dispatch({
      id: 't1',
      name: 'kc_search',
      input: { query: 'hello', limit: 3 },
    });
    expect(searchAccessibleChunks).toHaveBeenCalledWith('u1', 'hello', 3);
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('kc_search returns a corrective message (no DB call) on bad input', async () => {
    const searchAccessibleChunks = jest.fn();
    const { dispatch } = svc({ searchAccessibleChunks }).build({
      userId: 'u1',
    });
    const out = await dispatch({ id: 't1', name: 'kc_search', input: {} });
    expect(out).toMatch(/query/i);
    expect(searchAccessibleChunks).not.toHaveBeenCalled();
  });

  it('kc_search clamps limit to 1..10', async () => {
    const searchAccessibleChunks = jest.fn().mockResolvedValue([]);
    const { dispatch } = svc({ searchAccessibleChunks }).build({
      userId: 'u1',
    });
    await dispatch({
      id: 't1',
      name: 'kc_search',
      input: { query: 'x', limit: 999 },
    });
    expect(searchAccessibleChunks).toHaveBeenCalledWith('u1', 'x', 10);
  });

  it('read_attached_file returns the owned file text', async () => {
    const getOwnedAttachedFilesText = jest
      .fn()
      .mockResolvedValue([{ fileId: 'f1', name: 'n', text: 'body' }]);
    const { dispatch } = svc({ getOwnedAttachedFilesText }).build({
      userId: 'u1',
    });
    const out = await dispatch({
      id: 't1',
      name: 'read_attached_file',
      input: { fileId: 'f1' },
    });
    expect(getOwnedAttachedFilesText).toHaveBeenCalledWith('u1', ['f1']);
    expect(out).toBe('body');
  });

  it('read_attached_file reports a missing/inaccessible file', async () => {
    const getOwnedAttachedFilesText = jest.fn().mockResolvedValue([]);
    const { dispatch } = svc({ getOwnedAttachedFilesText }).build({
      userId: 'u1',
    });
    const out = await dispatch({
      id: 't1',
      name: 'read_attached_file',
      input: { fileId: 'nope' },
    });
    expect(out).toMatch(/not found|not accessible/i);
  });

  it('reports an unknown tool', async () => {
    const { dispatch } = svc({}).build({ userId: 'u1' });
    const out = await dispatch({ id: 't1', name: 'mystery', input: {} });
    expect(out).toMatch(/unknown tool/i);
  });
});
