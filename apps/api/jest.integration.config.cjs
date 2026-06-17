// Integration tests (`*.int-spec.ts`) — spin up a real PostgreSQL+pgvector
// container via Testcontainers. Kept separate from the unit config (which
// matches `*.spec.ts`) so `pnpm test` stays fast and needs no Docker; run
// these with `pnpm --filter api test:integration`.
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  testEnvironment: 'node',
  // Container start + migrations need headroom on a cold image cache.
  testTimeout: 180_000,
  // One container per worker — keep it single-threaded for deterministic
  // ordering and to avoid spinning N containers.
  maxWorkers: 1,
};
