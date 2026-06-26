/**
 * Test stub for the ESM-only `@mistralai/mistralai` SDK. The real package
 * ships pure ESM, which the (CJS) ts-jest runner can't parse — so jest maps
 * `@mistralai/mistralai` to this file via `moduleNameMapper`. The Mistral
 * adapter spec drives the fake conversation stream by assigning
 * `mistralMock.startStream`. Deliberately free of any `jest` reference so it
 * compiles in the production build (where it's never imported).
 */
export const mistralMock: {
  startStream: (...args: unknown[]) => unknown;
} = {
  startStream: () => {
    throw new Error('mistralMock.startStream not configured');
  },
};

export class Mistral {
  beta = {
    conversations: {
      startStream: (...args: unknown[]) => mistralMock.startStream(...args),
    },
  };
  constructor(_opts?: unknown) {
    void _opts;
  }
}
