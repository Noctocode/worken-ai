import { effectiveWebSearchCapability } from './web-search-capability.js';

/**
 * Freezes the web-search capability rule shared by ChatController (chat
 * hot path) and ProjectsService (drives the FE toggle). The two must
 * agree, so the decision lives in one pure function tested here. The
 * key invariant: a non-null team override wins outright — including a
 * hard `false` that disables web search even when the org allows it.
 */
describe('effectiveWebSearchCapability', () => {
  describe('team override is set (non-null) → it wins', () => {
    const cases: Array<[string, boolean, boolean | null | undefined, boolean]> =
      [
        ['team=true, company=false → true', true, false, true],
        ['team=true, company=null → true', true, null, true],
        ['team=true, company=undefined → true', true, undefined, true],
        ['team=false, company=true → false', false, true, false],
        ['team=false, company=false → false', false, false, false],
        ['team=false, company=null → false', false, null, false],
      ];
    it.each(cases)('%s', (_label, teamFlag, companyFlag, expected) => {
      expect(effectiveWebSearchCapability(teamFlag, companyFlag)).toBe(
        expected,
      );
    });
  });

  describe('team inherits (null/undefined) → org default applies', () => {
    const cases: Array<
      [string, boolean | null | undefined, boolean | null | undefined, boolean]
    > = [
      ['team=null, company=true → true', null, true, true],
      ['team=null, company=false → false', null, false, false],
      ['team=null, company=null → false', null, null, false],
      ['team=null, company=undefined → false', null, undefined, false],
      ['team=undefined, company=true → true', undefined, true, true],
      ['team=undefined, company=false → false', undefined, false, false],
      [
        'team=undefined, company=undefined → false',
        undefined,
        undefined,
        false,
      ],
    ];
    it.each(cases)('%s', (_label, teamFlag, companyFlag, expected) => {
      expect(effectiveWebSearchCapability(teamFlag, companyFlag)).toBe(
        expected,
      );
    });
  });
});
