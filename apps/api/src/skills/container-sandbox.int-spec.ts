import { ContainerSandbox } from './container-sandbox.js';
import { DEFAULT_SANDBOX_LIMITS } from './skill-sandbox.js';

/**
 * Live Docker sandbox integration test. Exercises the REAL `docker run` path
 * that unit tests can't (CI has no daemon): artifact production, the wall-clock
 * kill, network isolation, and read-only input files.
 *
 * Opt-in — runs only with `RUN_SANDBOX_IT=true` on a host with a Docker daemon
 * and the python image pullable. Skipped otherwise so the normal
 * `test:integration` run (testcontainers/Postgres only) doesn't need Docker
 * images. Run with:
 *   RUN_SANDBOX_IT=true pnpm --filter api test:integration -- container-sandbox
 */
const RUN = process.env['RUN_SANDBOX_IT'] === 'true';
const suite = RUN ? describe : describe.skip;

suite('ContainerSandbox (live docker)', () => {
  const sandbox = new ContainerSandbox();

  it('runs a python script and collects its /out artifact', async () => {
    const res = await sandbox.run({
      language: 'python',
      script: [
        "print('hello from sandbox')",
        "open('/out/result.txt', 'w').write('artifact-body')",
      ].join('\n'),
      limits: DEFAULT_SANDBOX_LIMITS,
    });
    expect(res.error).toBeNull();
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('hello from sandbox');
    const art = res.artifacts.find((a) => a.filename === 'result.txt');
    expect(art?.content.toString('utf8')).toBe('artifact-body');
  }, 120_000);

  it('kills a script that exceeds the wall-clock limit', async () => {
    const res = await sandbox.run({
      language: 'python',
      script: 'import time; time.sleep(30)',
      limits: { ...DEFAULT_SANDBOX_LIMITS, timeoutMs: 2000 },
    });
    expect(res.timedOut).toBe(true);
  }, 60_000);

  it('blocks outbound network when network=false', async () => {
    const res = await sandbox.run({
      language: 'python',
      script: [
        'import urllib.request',
        'try:',
        "  urllib.request.urlopen('http://example.com', timeout=3)",
        "  print('NET_OK')",
        'except Exception:',
        "  print('NET_BLOCKED')",
      ].join('\n'),
      limits: DEFAULT_SANDBOX_LIMITS,
    });
    expect(res.stdout).toContain('NET_BLOCKED');
  }, 60_000);

  it('exposes sibling input files read-only in /work', async () => {
    const res = await sandbox.run({
      language: 'python',
      script: "print(open('/work/data.txt').read())",
      inputs: [
        {
          filename: 'data.txt',
          mimeType: 'text/plain',
          content: Buffer.from('sibling-data'),
        },
      ],
      limits: DEFAULT_SANDBOX_LIMITS,
    });
    expect(res.stdout).toContain('sibling-data');
  }, 60_000);
});
