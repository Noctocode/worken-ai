import { ToolRegistryService } from './tool-registry.service.js';

/** Deny-by-default sandbox + no-op artifact store unless a test overrides. */
function svc(ingestion: unknown, sandbox?: unknown, artifacts?: unknown) {
  return new ToolRegistryService(
    ingestion as never,
    (artifacts ?? { store: () => Promise.resolve([]) }) as never,
    (sandbox ?? { isAvailable: () => false }) as never,
  );
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

  describe('run_script', () => {
    const SCRIPTS = [
      { name: 'build', language: 'python', entrypoint: true, content: 'x=1' },
    ];

    it('is omitted unless a sandbox is available + scripts + runId exist', () => {
      // No sandbox.
      expect(
        svc({})
          .build({ userId: 'u1', runId: 'r1', scripts: SCRIPTS })
          .tools.map((t) => t.name),
      ).not.toContain('run_script');
      // Sandbox available but no scripts.
      const sandbox = { isAvailable: () => true, run: jest.fn() };
      expect(
        svc({}, sandbox)
          .build({ userId: 'u1', runId: 'r1', scripts: [] })
          .tools.map((t) => t.name),
      ).not.toContain('run_script');
    });

    it('runs the entrypoint, persists artifacts, and surfaces them', async () => {
      const run = jest.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        outputTruncated: false,
        artifacts: [
          {
            filename: 'r.xlsx',
            mimeType: 'application/x',
            content: Buffer.from('a'),
          },
        ],
        timedOut: false,
        error: null,
      });
      const store = jest.fn().mockResolvedValue([
        {
          id: 'a1',
          filename: 'r.xlsx',
          mimeType: 'application/x',
          sizeBytes: 1,
        },
      ]);
      const surfaced: unknown[] = [];
      const sandbox = { isAvailable: () => true, run };

      const { tools, dispatch } = svc({}, sandbox, { store }).build({
        userId: 'u1',
        runId: 'r1',
        scripts: SCRIPTS,
        onArtifacts: (a) => surfaced.push(...a),
      });

      expect(tools.map((t) => t.name)).toContain('run_script');
      const out = await dispatch({ id: 't1', name: 'run_script', input: {} });

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'python', script: 'x=1' }),
      );
      expect(store).toHaveBeenCalledWith('r1', expect.any(Array));
      expect(surfaced).toEqual([
        {
          id: 'a1',
          filename: 'r.xlsx',
          mimeType: 'application/x',
          sizeBytes: 1,
        },
      ]);
      expect(out).toMatch(/r\.xlsx/);
      expect(out).toMatch(/exit=0/);
    });

    it('returns a corrective message for an unknown script name', async () => {
      const sandbox = { isAvailable: () => true, run: jest.fn() };
      const { dispatch } = svc({}, sandbox).build({
        userId: 'u1',
        runId: 'r1',
        scripts: SCRIPTS,
      });
      const out = await dispatch({
        id: 't1',
        name: 'run_script',
        input: { scriptName: 'nope' },
      });
      expect(out).toMatch(/no matching script/i);
      expect(sandbox.run).not.toHaveBeenCalled();
    });
  });
});
