import {
  DEFAULT_SANDBOX_LIMITS,
  UnavailableSandboxRuntime,
} from './skill-sandbox.js';

describe('UnavailableSandboxRuntime (deny-by-default)', () => {
  const runtime = new UnavailableSandboxRuntime();

  it('reports itself unavailable so callers fall back to loop-with-tools', () => {
    expect(runtime.isAvailable()).toBe(false);
  });

  it('refuses to run — no untrusted code executes by default', () => {
    expect(() => runtime.run()).toThrow(/sandbox is not configured/i);
  });
});

describe('DEFAULT_SANDBOX_LIMITS', () => {
  it('is offline by default (network must be opted into)', () => {
    expect(DEFAULT_SANDBOX_LIMITS.network).toBe(false);
  });

  it('caps wall-clock, output and artifact size', () => {
    expect(DEFAULT_SANDBOX_LIMITS.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.maxOutputBytes).toBeGreaterThan(0);
    expect(DEFAULT_SANDBOX_LIMITS.maxArtifactBytes).toBeGreaterThan(0);
  });
});
