import { BadRequestException } from '@nestjs/common';

export type SharePointVisibility =
  | 'all'
  | 'admins'
  | 'teams'
  | 'project'
  | 'schedule';

/**
 * Shape passed by the FE to every SharePoint import endpoint.
 *
 *   - `kind: 'site'`   imports the entire site (every drive/library).
 *   - `kind: 'folder'` imports specific folders inside one drive on
 *     one site.
 *
 * Visibility fields are optional; missing visibility is treated as
 * 'all' by the import code (default for backwards compatibility with
 * callers that pre-date the visibility picker).
 */
export type SharePointImportScope = (
  | { kind: 'site'; siteId: string }
  | {
      kind: 'folder';
      siteId: string;
      driveId: string;
      folderIds: string[];
    }
) & {
  visibility?: SharePointVisibility;
  teamIds?: string[];
  projectIds?: string[];
  scheduleIds?: string[];
};

const VALID_VISIBILITIES: readonly SharePointVisibility[] = [
  'all',
  'admins',
  'teams',
  'project',
  'schedule',
];

/**
 * Validate a scope payload supplied by an external caller (REST body
 * or resync code path). Throws `BadRequestException` on any
 * mismatch — Nest turns that into a 400 with the message verbatim, so
 * keep the error text actionable.
 *
 * Lives in its own module so a unit test can exercise every branch
 * without pulling in the whole DI graph.
 */
export function validateSharePointScope(
  scope: SharePointImportScope | undefined | null,
): void {
  if (!scope || typeof scope !== 'object') {
    throw new BadRequestException('Invalid scope.');
  }
  if (scope.kind === 'site') {
    if (!scope.siteId) {
      throw new BadRequestException('siteId is required for site scope.');
    }
  } else if (scope.kind === 'folder') {
    if (!scope.siteId) {
      throw new BadRequestException('siteId is required for folder scope.');
    }
    if (!scope.driveId) {
      throw new BadRequestException('driveId is required for folder scope.');
    }
    if (!Array.isArray(scope.folderIds) || scope.folderIds.length === 0) {
      throw new BadRequestException(
        'folderIds must be a non-empty array when scope is "folder".',
      );
    }
  } else {
    throw new BadRequestException('Unknown scope kind.');
  }

  if (
    scope.visibility !== undefined &&
    !VALID_VISIBILITIES.includes(scope.visibility)
  ) {
    throw new BadRequestException(
      `Invalid visibility "${String(scope.visibility)}".`,
    );
  }
  if (
    scope.visibility === 'teams' &&
    (!Array.isArray(scope.teamIds) || scope.teamIds.length === 0)
  ) {
    throw new BadRequestException(
      'teamIds must be a non-empty array when visibility is "teams".',
    );
  }
  if (
    scope.visibility === 'project' &&
    (!Array.isArray(scope.projectIds) || scope.projectIds.length === 0)
  ) {
    throw new BadRequestException(
      'projectIds must be a non-empty array when visibility is "project".',
    );
  }
  if (
    scope.visibility === 'schedule' &&
    (!Array.isArray(scope.scheduleIds) || scope.scheduleIds.length === 0)
  ) {
    throw new BadRequestException(
      'scheduleIds must be a non-empty array when visibility is "schedule".',
    );
  }
}
