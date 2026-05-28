import { BadRequestException } from '@nestjs/common';
import {
  validateSharePointScope,
  type SharePointImportScope,
} from './sharepoint-scope.js';

/**
 * The validation contract for SharePoint import requests. These tests
 * freeze the rules the BE actually applies to incoming POST bodies on
 * `/knowledge-core/sharepoint/import` (and `/import/async`).
 *
 * Each rejected case asserts both the exception class AND a
 * substring of the message: the message is the only thing the FE
 * surfaces back to the user, so it must remain actionable. If a
 * future change to the message wording happens, this test will fail
 * loudly and the fix is to keep the new wording user-facing.
 */
describe('validateSharePointScope', () => {
  describe('accepts', () => {
    const VALID: Array<[string, SharePointImportScope]> = [
      ['site scope with siteId', { kind: 'site', siteId: 's-1' }],
      [
        'site scope with visibility=all',
        { kind: 'site', siteId: 's-1', visibility: 'all' },
      ],
      [
        'site scope with visibility=teams + teamIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'teams',
          teamIds: ['t-1'],
        },
      ],
      [
        'site scope with visibility=project + projectIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'project',
          projectIds: ['p-1'],
        },
      ],
      [
        'folder scope with all required fields',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          folderIds: ['f-1'],
        },
      ],
      [
        'folder scope with multiple folderIds',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          folderIds: ['f-1', 'f-2', 'f-3'],
        },
      ],
      [
        'folder scope with admin visibility (no team/project required)',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          folderIds: ['f-1'],
          visibility: 'admins',
        },
      ],
    ];

    it.each(VALID)('%s', (_label, scope) => {
      expect(() => validateSharePointScope(scope)).not.toThrow();
    });
  });

  describe('rejects with BadRequestException', () => {
    type Case = [
      string,
      SharePointImportScope | undefined | null,
      string, // expected substring of the error message
    ];

    const REJECTED: Case[] = [
      ['null scope', null, 'Invalid scope'],
      ['undefined scope', undefined, 'Invalid scope'],
      [
        'site scope with empty siteId',
        { kind: 'site', siteId: '' },
        'siteId is required for site scope',
      ],
      [
        'folder scope with empty siteId',
        // siteId="" — required even on folder scope because the
        // import path always anchors to a site.
        {
          kind: 'folder',
          siteId: '',
          driveId: 'd-1',
          folderIds: ['f-1'],
        },
        'siteId is required for folder scope',
      ],
      [
        'folder scope with empty driveId',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: '',
          folderIds: ['f-1'],
        },
        'driveId is required for folder scope',
      ],
      [
        'folder scope with empty folderIds',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          folderIds: [],
        },
        'folderIds must be a non-empty array',
      ],
      [
        'folder scope with folderIds not an array',
        {
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          // Forced to string at the JSON boundary — should still reject.
          folderIds: 'f-1' as unknown as string[],
        },
        'folderIds must be a non-empty array',
      ],
      [
        'unknown scope kind',
        { kind: 'all' as 'site', siteId: 's-1' },
        'Unknown scope kind',
      ],
      [
        'visibility=teams with empty teamIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'teams',
          teamIds: [],
        },
        'teamIds must be a non-empty array',
      ],
      [
        'visibility=teams with missing teamIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'teams',
        },
        'teamIds must be a non-empty array',
      ],
      [
        'visibility=project with empty projectIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'project',
          projectIds: [],
        },
        'projectIds must be a non-empty array',
      ],
      [
        'visibility=project with missing projectIds',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'project',
        },
        'projectIds must be a non-empty array',
      ],
      [
        'visibility not in the allowed enum',
        {
          kind: 'site',
          siteId: 's-1',
          visibility: 'public' as 'all',
        },
        'Invalid visibility',
      ],
    ];

    it.each(REJECTED)('%s', (_label, scope, expectedSubstring) => {
      let thrown: unknown;
      try {
        validateSharePointScope(scope as SharePointImportScope);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      const message = (thrown as BadRequestException).message;
      expect(message).toContain(expectedSubstring);
    });
  });

  describe('visibility default behaviour', () => {
    it('treats undefined visibility as valid (caller defaults to "all")', () => {
      expect(() =>
        validateSharePointScope({ kind: 'site', siteId: 's-1' }),
      ).not.toThrow();
    });

    it('does not require teamIds when visibility is omitted', () => {
      expect(() =>
        validateSharePointScope({
          kind: 'folder',
          siteId: 's-1',
          driveId: 'd-1',
          folderIds: ['f-1'],
        }),
      ).not.toThrow();
    });
  });
});
