import { numFromEnv } from './skill-config.js';

describe('numFromEnv', () => {
  const KEY = 'SKILL_TEST_NUM';
  afterEach(() => delete process.env[KEY]);

  it('returns the default when unset or blank', () => {
    delete process.env[KEY];
    expect(numFromEnv(KEY, 8)).toBe(8);
    process.env[KEY] = '   ';
    expect(numFromEnv(KEY, 8)).toBe(8);
  });

  it('parses a positive override', () => {
    process.env[KEY] = '16';
    expect(numFromEnv(KEY, 8)).toBe(16);
    process.env[KEY] = '0.5';
    expect(numFromEnv(KEY, 8)).toBe(0.5);
  });

  it('falls back on non-positive or non-numeric values (never disables a guard)', () => {
    process.env[KEY] = '0';
    expect(numFromEnv(KEY, 8)).toBe(8);
    process.env[KEY] = '-5';
    expect(numFromEnv(KEY, 8)).toBe(8);
    process.env[KEY] = 'abc';
    expect(numFromEnv(KEY, 8)).toBe(8);
  });
});
