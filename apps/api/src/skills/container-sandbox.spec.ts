import { ContainerSandbox } from './container-sandbox.js';
import {
  DEFAULT_SANDBOX_LIMITS,
  type SandboxRunInput,
} from './skill-sandbox.js';

// CI has no Docker daemon, so these exercise the pure pieces — argument
// construction, language resolution, availability gating, and the
// unsupported-language short-circuit — never a live `docker run`.

function input(over: Partial<SandboxRunInput> = {}): SandboxRunInput {
  return {
    language: 'python',
    script: 'print(1)',
    limits: DEFAULT_SANDBOX_LIMITS,
    ...over,
  };
}

describe('ContainerSandbox.isAvailable', () => {
  const prev = process.env['SKILL_SANDBOX_DOCKER'];
  afterEach(() => {
    if (prev === undefined) delete process.env['SKILL_SANDBOX_DOCKER'];
    else process.env['SKILL_SANDBOX_DOCKER'] = prev;
  });

  it('is OFF by default and ON only when the env flag is set', () => {
    delete process.env['SKILL_SANDBOX_DOCKER'];
    expect(new ContainerSandbox().isAvailable()).toBe(false);
    process.env['SKILL_SANDBOX_DOCKER'] = 'true';
    expect(new ContainerSandbox().isAvailable()).toBe(true);
  });
});

describe('ContainerSandbox.resolveLanguage', () => {
  const sandbox = new ContainerSandbox();

  it('maps python/node/shell aliases', () => {
    expect(sandbox.resolveLanguage('py')?.ext).toBe('py');
    expect(sandbox.resolveLanguage('JavaScript')?.ext).toBe('js');
    expect(sandbox.resolveLanguage('bash')?.ext).toBe('sh');
  });

  it('returns null for an unsupported language', () => {
    expect(sandbox.resolveLanguage('ruby')).toBeNull();
  });
});

describe('ContainerSandbox.buildDockerArgs (hardening)', () => {
  const sandbox = new ContainerSandbox();
  const lang = sandbox.resolveLanguage('python')!;

  it('produces a locked-down, offline container invocation', () => {
    const args = sandbox.buildDockerArgs(
      input(),
      lang,
      '/host/work',
      '/host/out',
      'skill-abc',
    );
    const joined = args.join(' ');

    expect(args[0]).toBe('run');
    expect(joined).toContain('--rm');
    expect(joined).toContain('--name skill-abc');
    // Offline by default.
    expect(joined).toContain('--network none');
    // Resource caps (memory == memory-swap disables swap growth).
    expect(joined).toContain('--memory 256m');
    expect(joined).toContain('--memory-swap 256m');
    expect(joined).toContain('--cpus 1');
    expect(joined).toContain('--pids-limit 256');
    // Privilege lockdown.
    expect(joined).toContain('--cap-drop ALL');
    expect(joined).toContain('--security-opt no-new-privileges');
    expect(joined).toContain('--user 1000:1000');
    // Read-only root; inputs ro, outputs rw, tmpfs scratch.
    expect(joined).toContain('--read-only');
    expect(joined).toContain('/host/work:/work:ro');
    expect(joined).toContain('/host/out:/out:rw');
    expect(joined).toContain('--tmpfs /tmp:rw,noexec,nosuid,size=64m');
    // Entrypoint runs the script from the read-only mount.
    expect(joined).toContain('python /work/script.py');
  });

  it('opens the network only when the run opts in', () => {
    const args = sandbox.buildDockerArgs(
      input({ limits: { ...DEFAULT_SANDBOX_LIMITS, network: true } }),
      lang,
      '/w',
      '/o',
      'skill-net',
    );
    expect(args.join(' ')).toContain('--network bridge');
    expect(args.join(' ')).not.toContain('--network none');
  });
});

describe('ContainerSandbox.run', () => {
  it('fails closed (no spawn) for an unsupported language', async () => {
    const res = await new ContainerSandbox().run(input({ language: 'ruby' }));
    expect(res.error).toMatch(/unsupported sandbox language/i);
    expect(res.artifacts).toEqual([]);
    expect(res.exitCode).toBe(-1);
  });
});
