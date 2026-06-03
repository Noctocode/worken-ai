import { effectiveWebSearchCapability } from './web-search-capability.js';

/**
 * Freezes the web-search capability rule shared by ChatController (chat
 * hot path) and ProjectsService (drives the FE toggle). The two must
 * agree, so the decision lives in one pure function tested here. The
 * key invariant: the org default is the master switch — Org Off
 * disables web search everywhere, even when a team explicitly turned it
 * on. When the org allows it, the team setting decides (an unset team
 * defaults to the org value).
 */
describe('effectiveWebSearchCapability', () => {
  describe('org Off (or unset) → off everywhere, overriding the team', () => {
    const cases: Array<
      [string, boolean | null | undefined, boolean | null | undefined, boolean]
    > = [
      ['team=true, company=false → false', true, false, false],
      ['team=true, company=null → false', true, null, false],
      ['team=true, company=undefined → false', true, undefined, false],
      ['team=false, company=false → false', false, false, false],
      ['team=null, company=false → false', null, false, false],
      ['team=null, company=null → false', null, null, false],
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

  describe('org On → team setting decides (unset defaults to org value)', () => {
    const cases: Array<[string, boolean | null | undefined, boolean, boolean]> =
      [
        ['team=true, company=true → true', true, true, true],
        ['team=false, company=true → false', false, true, false],
        ['team=null, company=true → true', null, true, true],
        ['team=undefined, company=true → true', undefined, true, true],
      ];
    it.each(cases)('%s', (_label, teamFlag, companyFlag, expected) => {
      expect(effectiveWebSearchCapability(teamFlag, companyFlag)).toBe(
        expected,
      );
    });
  });
});
