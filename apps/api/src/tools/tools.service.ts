import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  aiToolProjects,
  aiToolTeams,
  aiTools,
  projectMembers,
  projects,
  teamMembers,
  users,
} from '@worken/database/schema';
import { DATABASE, type Database } from '../database/database.module.js';
import { EncryptionService } from '../openrouter/encryption.service.js';

export type ToolVisibility = 'all' | 'admins' | 'teams' | 'project';
export type ToolAuthType =
  | 'none'
  | 'api_key_header'
  | 'api_key_query'
  | 'bearer';
export type ToolHttpMethod = 'GET' | 'POST';

export interface CreateToolInput {
  name: string;
  displayName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  httpMethod?: string;
  urlTemplate: string;
  headersTemplate?: Record<string, string>;
  queryTemplate?: Record<string, string>;
  bodyTemplate?: Record<string, unknown>;
  authType?: string;
  authParamName?: string | null;
  apiKey?: string | null;
  responsePath?: string | null;
  visibility?: string;
  isEnabled?: boolean;
  monthlyCallLimit?: number | null;
  timeoutMs?: number;
  teamIds?: string[];
  projectIds?: string[];
}

export type UpdateToolInput = Partial<CreateToolInput>;

/** Redacted row sent to clients — the encrypted key is NEVER exposed. */
export interface ToolView {
  id: string;
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  httpMethod: string;
  urlTemplate: string;
  headersTemplate: Record<string, string>;
  queryTemplate: Record<string, string>;
  bodyTemplate: Record<string, unknown>;
  authType: string;
  authParamName: string | null;
  hasApiKey: boolean;
  responsePath: string | null;
  visibility: string;
  isEnabled: boolean;
  monthlyCallLimit: number | null;
  timeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}

// LLM-facing function name: lowercase, snake-friendly, must be a valid
// function-call identifier for every provider.
const NAME_RE = /^[a-z0-9_]{1,48}$/;
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST']);
const AUTH_TYPES: ReadonlySet<string> = new Set([
  'none',
  'api_key_header',
  'api_key_query',
  'bearer',
]);
const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 30000;

@Injectable()
export class ToolsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly encryption: EncryptionService,
  ) {}

  /** Caller's company + admin flag. companyId is null for personal accounts. */
  private async readProfile(
    userId: string,
  ): Promise<{ companyId: string | null; isAdmin: boolean }> {
    const [u] = await this.db
      .select({ companyId: users.companyId, role: users.role })
      .from(users)
      .where(eq(users.id, userId));
    return { companyId: u?.companyId ?? null, isAdmin: u?.role === 'admin' };
  }

  /**
   * Mutations are company-admin only (Tools is a company-wide catalog, like
   * the Models + Integration tabs). Returns the caller's companyId.
   */
  private async requireAdminCompany(userId: string): Promise<string> {
    const { companyId, isAdmin } = await this.readProfile(userId);
    if (!companyId) {
      throw new ForbiddenException(
        'Tools are a company feature — personal accounts cannot manage them.',
      );
    }
    if (!isAdmin) {
      throw new ForbiddenException('Only company admins can manage tools.');
    }
    return companyId;
  }

  private toView(row: typeof aiTools.$inferSelect): ToolView {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      inputSchema: row.inputSchema,
      httpMethod: row.httpMethod,
      urlTemplate: row.urlTemplate,
      headersTemplate: row.headersTemplate,
      queryTemplate: row.queryTemplate,
      bodyTemplate: row.bodyTemplate,
      authType: row.authType,
      authParamName: row.authParamName,
      hasApiKey: row.apiKeyEncrypted != null,
      responsePath: row.responsePath,
      visibility: row.visibility,
      isEnabled: row.isEnabled,
      monthlyCallLimit: row.monthlyCallLimit,
      timeoutMs: row.timeoutMs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ── Validation ──────────────────────────────────────────────────────────

  private validateName(name: string | undefined): string {
    const trimmed = name?.trim() ?? '';
    if (!NAME_RE.test(trimmed)) {
      throw new BadRequestException(
        '`name` must be 1–48 chars of [a-z0-9_] (the function name the model calls).',
      );
    }
    return trimmed;
  }

  private validateMethod(method: string | undefined): ToolHttpMethod {
    const m = (method ?? 'GET').toUpperCase();
    if (!HTTP_METHODS.has(m)) {
      throw new BadRequestException('`httpMethod` must be GET or POST.');
    }
    return m as ToolHttpMethod;
  }

  /**
   * Save-time URL check: HTTPS-only and parseable. The deep SSRF guard
   * (DNS resolution, private-range block, redirect handling) runs in the
   * executor at call time — see the Phase B plan.
   */
  private validateUrl(url: string | undefined): string {
    const raw = url?.trim() ?? '';
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new BadRequestException('`urlTemplate` must be a valid URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('`urlTemplate` must use https://.');
    }
    return raw;
  }

  private validateAuth(
    authType: string | undefined,
    authParamName: string | null | undefined,
  ): { authType: ToolAuthType; authParamName: string | null } {
    const t = authType ?? 'none';
    if (!AUTH_TYPES.has(t)) {
      throw new BadRequestException(
        '`authType` must be none, api_key_header, api_key_query, or bearer.',
      );
    }
    const needsParam = t === 'api_key_header' || t === 'api_key_query';
    const param = authParamName?.trim() || null;
    if (needsParam && !param) {
      throw new BadRequestException(
        '`authParamName` (the header/query name for the key) is required for api_key_* auth.',
      );
    }
    return {
      authType: t as ToolAuthType,
      authParamName: needsParam ? param : null,
    };
  }

  private validateObject(
    value: unknown,
    field: string,
  ): Record<string, unknown> {
    if (value == null) return {};
    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value instanceof Date
    ) {
      throw new BadRequestException(`\`${field}\` must be a JSON object.`);
    }
    return value as Record<string, unknown>;
  }

  /** Like validateObject but every value must be a string (headers / query). */
  private validateStringMap(
    value: unknown,
    field: string,
  ): Record<string, string> {
    const obj = this.validateObject(value, field);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string') {
        throw new BadRequestException(`\`${field}.${k}\` must be a string.`);
      }
      out[k] = v;
    }
    return out;
  }

  private validateTimeout(timeoutMs: number | undefined): number {
    if (timeoutMs == null) return 8000;
    if (!Number.isFinite(timeoutMs)) {
      throw new BadRequestException('`timeoutMs` must be a number.');
    }
    return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.floor(timeoutMs)));
  }

  private validateLimit(limit: number | null | undefined): number | null {
    if (limit == null) return null;
    if (!Number.isFinite(limit) || limit < 0) {
      throw new BadRequestException(
        '`monthlyCallLimit` must be null (unlimited), 0 (paused) or a positive integer.',
      );
    }
    return Math.floor(limit);
  }

  private resolveVisibility(
    input: string | undefined,
    isAdmin: boolean,
  ): ToolVisibility {
    if (input == null || input === '') return 'all';
    if (
      input !== 'all' &&
      input !== 'admins' &&
      input !== 'teams' &&
      input !== 'project'
    ) {
      throw new BadRequestException(
        `Invalid visibility "${input}". Must be 'all', 'admins', 'teams', or 'project'.`,
      );
    }
    if (input === 'admins' && !isAdmin) {
      throw new ForbiddenException('Only admins can mark a tool admin-only.');
    }
    return input;
  }

  private async resolveAssignableTeamIds(
    input: string[] | undefined,
    callerId: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        '`teamIds` must be an array when visibility is "teams".',
      );
    }
    const unique = [
      ...new Set(input.filter((t) => typeof t === 'string' && t)),
    ];
    if (unique.length === 0) {
      throw new BadRequestException(
        'Team visibility requires at least one team.',
      );
    }
    if (isAdmin) return unique;
    const rows = await this.db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, callerId),
          eq(teamMembers.status, 'accepted'),
          inArray(teamMembers.teamId, unique),
        ),
      );
    const allowed = new Set(rows.map((r) => r.teamId));
    const denied = unique.filter((t) => !allowed.has(t));
    if (denied.length > 0) {
      throw new ForbiddenException(
        `You can only share a tool with teams you belong to. Not a member of: ${denied.join(', ')}.`,
      );
    }
    return unique;
  }

  private async resolveAssignableProjectIds(
    input: string[] | undefined,
    callerId: string,
    isAdmin: boolean,
  ): Promise<string[]> {
    if (!Array.isArray(input)) {
      throw new BadRequestException(
        '`projectIds` must be an array when visibility is "project".',
      );
    }
    const unique = [
      ...new Set(input.filter((p) => typeof p === 'string' && p)),
    ];
    if (unique.length === 0) {
      throw new BadRequestException(
        'Project visibility requires at least one project.',
      );
    }
    if (isAdmin) return unique;
    const rows = await this.db
      .selectDistinct({ id: projects.id })
      .from(projects)
      .leftJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(
        and(
          inArray(projects.id, unique),
          or(
            eq(projects.userId, callerId),
            eq(projectMembers.userId, callerId),
          ),
        ),
      );
    const allowed = new Set(rows.map((r) => r.id));
    const denied = unique.filter((p) => !allowed.has(p));
    if (denied.length > 0) {
      throw new ForbiddenException(
        `You can only scope a tool to projects you own or belong to. No access to: ${denied.join(', ')}.`,
      );
    }
    return unique;
  }

  private async replaceLinks(
    toolId: string,
    teamIds: string[],
    projectIds: string[],
  ): Promise<void> {
    await this.db.delete(aiToolTeams).where(eq(aiToolTeams.toolId, toolId));
    await this.db
      .delete(aiToolProjects)
      .where(eq(aiToolProjects.toolId, toolId));
    if (teamIds.length > 0) {
      await this.db
        .insert(aiToolTeams)
        .values(teamIds.map((teamId) => ({ toolId, teamId })));
    }
    if (projectIds.length > 0) {
      await this.db
        .insert(aiToolProjects)
        .values(projectIds.map((projectId) => ({ toolId, projectId })));
    }
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  /** Company-wide tool catalog. Empty for personal accounts. */
  async list(userId: string): Promise<ToolView[]> {
    const { companyId } = await this.readProfile(userId);
    if (!companyId) return [];
    const rows = await this.db
      .select()
      .from(aiTools)
      .where(eq(aiTools.companyId, companyId))
      .orderBy(desc(aiTools.updatedAt));
    return rows.map((r) => this.toView(r));
  }

  async get(
    id: string,
    userId: string,
  ): Promise<
    ToolView & {
      teamIds: string[];
      projectIds: string[];
    }
  > {
    const { companyId } = await this.readProfile(userId);
    if (!companyId) throw new NotFoundException('Tool not found.');
    const [row] = await this.db
      .select()
      .from(aiTools)
      .where(and(eq(aiTools.id, id), eq(aiTools.companyId, companyId)));
    if (!row) throw new NotFoundException('Tool not found.');
    const [teamRows, projectRows] = await Promise.all([
      this.db
        .select({ teamId: aiToolTeams.teamId })
        .from(aiToolTeams)
        .where(eq(aiToolTeams.toolId, id)),
      this.db
        .select({ projectId: aiToolProjects.projectId })
        .from(aiToolProjects)
        .where(eq(aiToolProjects.toolId, id)),
    ]);
    return {
      ...this.toView(row),
      teamIds: teamRows.map((r) => r.teamId),
      projectIds: projectRows.map((r) => r.projectId),
    };
  }

  async create(userId: string, input: CreateToolInput): Promise<ToolView> {
    const companyId = await this.requireAdminCompany(userId);

    const name = this.validateName(input.name);
    const displayName = input.displayName?.trim();
    const description = input.description?.trim();
    if (!displayName)
      throw new BadRequestException('`displayName` is required.');
    if (!description)
      throw new BadRequestException('`description` is required.');

    const httpMethod = this.validateMethod(input.httpMethod);
    const urlTemplate = this.validateUrl(input.urlTemplate);
    const { authType, authParamName } = this.validateAuth(
      input.authType,
      input.authParamName,
    );
    const visibility = this.resolveVisibility(input.visibility, true);
    const teamIds =
      visibility === 'teams'
        ? await this.resolveAssignableTeamIds(input.teamIds, userId, true)
        : [];
    const projectIds =
      visibility === 'project'
        ? await this.resolveAssignableProjectIds(input.projectIds, userId, true)
        : [];

    const apiKeyEncrypted =
      authType !== 'none' && input.apiKey?.trim()
        ? this.encryption.encrypt(input.apiKey.trim())
        : null;

    let row: typeof aiTools.$inferSelect;
    try {
      [row] = await this.db
        .insert(aiTools)
        .values({
          companyId,
          createdBy: userId,
          name,
          displayName,
          description,
          inputSchema: this.validateObject(input.inputSchema, 'inputSchema'),
          httpMethod,
          urlTemplate,
          headersTemplate: this.validateStringMap(
            input.headersTemplate,
            'headersTemplate',
          ),
          queryTemplate: this.validateStringMap(
            input.queryTemplate,
            'queryTemplate',
          ),
          bodyTemplate: this.validateObject(input.bodyTemplate, 'bodyTemplate'),
          authType,
          authParamName,
          apiKeyEncrypted,
          responsePath: input.responsePath?.trim() || null,
          visibility,
          isEnabled: input.isEnabled ?? true,
          monthlyCallLimit: this.validateLimit(input.monthlyCallLimit),
          timeoutMs: this.validateTimeout(input.timeoutMs),
        })
        .returning();
    } catch (err) {
      throw this.mapInsertError(err, name);
    }

    await this.replaceLinks(row.id, teamIds, projectIds);
    return this.toView(row);
  }

  async update(
    id: string,
    userId: string,
    input: UpdateToolInput,
  ): Promise<ToolView> {
    const companyId = await this.requireAdminCompany(userId);
    const [existing] = await this.db
      .select()
      .from(aiTools)
      .where(and(eq(aiTools.id, id), eq(aiTools.companyId, companyId)));
    if (!existing) throw new NotFoundException('Tool not found.');

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = this.validateName(input.name);
    if (input.displayName !== undefined) {
      const dn = input.displayName.trim();
      if (!dn) throw new BadRequestException('`displayName` cannot be empty.');
      patch.displayName = dn;
    }
    if (input.description !== undefined) {
      const d = input.description.trim();
      if (!d) throw new BadRequestException('`description` cannot be empty.');
      patch.description = d;
    }
    if (input.inputSchema !== undefined)
      patch.inputSchema = this.validateObject(input.inputSchema, 'inputSchema');
    if (input.httpMethod !== undefined)
      patch.httpMethod = this.validateMethod(input.httpMethod);
    if (input.urlTemplate !== undefined)
      patch.urlTemplate = this.validateUrl(input.urlTemplate);
    if (input.headersTemplate !== undefined)
      patch.headersTemplate = this.validateStringMap(
        input.headersTemplate,
        'headersTemplate',
      );
    if (input.queryTemplate !== undefined)
      patch.queryTemplate = this.validateStringMap(
        input.queryTemplate,
        'queryTemplate',
      );
    if (input.bodyTemplate !== undefined)
      patch.bodyTemplate = this.validateObject(
        input.bodyTemplate,
        'bodyTemplate',
      );
    if (input.responsePath !== undefined)
      patch.responsePath = input.responsePath?.trim() || null;
    if (input.isEnabled !== undefined) patch.isEnabled = !!input.isEnabled;
    if (input.monthlyCallLimit !== undefined)
      patch.monthlyCallLimit = this.validateLimit(input.monthlyCallLimit);
    if (input.timeoutMs !== undefined)
      patch.timeoutMs = this.validateTimeout(input.timeoutMs);

    // Auth: re-validate as a unit when any of the three parts is touched.
    if (
      input.authType !== undefined ||
      input.authParamName !== undefined ||
      input.apiKey !== undefined
    ) {
      const authType = input.authType ?? existing.authType;
      const { authType: at, authParamName } = this.validateAuth(
        authType,
        input.authParamName !== undefined
          ? input.authParamName
          : existing.authParamName,
      );
      patch.authType = at;
      patch.authParamName = authParamName;
      // apiKey: undefined = leave; null = clear; string = replace (encrypt).
      if (input.apiKey !== undefined) {
        patch.apiKeyEncrypted =
          input.apiKey && input.apiKey.trim()
            ? this.encryption.encrypt(input.apiKey.trim())
            : null;
      }
      if (at === 'none') patch.apiKeyEncrypted = null;
    }

    // Visibility + links, when visibility is provided.
    if (input.visibility !== undefined) {
      const visibility = this.resolveVisibility(input.visibility, true);
      const teamIds =
        visibility === 'teams'
          ? await this.resolveAssignableTeamIds(input.teamIds, userId, true)
          : [];
      const projectIds =
        visibility === 'project'
          ? await this.resolveAssignableProjectIds(
              input.projectIds,
              userId,
              true,
            )
          : [];
      patch.visibility = visibility;
      await this.replaceLinks(id, teamIds, projectIds);
    }

    let row: typeof aiTools.$inferSelect;
    try {
      [row] = await this.db
        .update(aiTools)
        .set(patch)
        .where(and(eq(aiTools.id, id), eq(aiTools.companyId, companyId)))
        .returning();
    } catch (err) {
      throw this.mapInsertError(err, (patch.name as string) ?? existing.name);
    }
    return this.toView(row);
  }

  async delete(id: string, userId: string): Promise<void> {
    const companyId = await this.requireAdminCompany(userId);
    const deleted = await this.db
      .delete(aiTools)
      .where(and(eq(aiTools.id, id), eq(aiTools.companyId, companyId)))
      .returning({ id: aiTools.id });
    if (deleted.length === 0) throw new NotFoundException('Tool not found.');
  }

  /** Turn a duplicate-name unique violation into a friendly 400. */
  private mapInsertError(err: unknown, name: string): Error {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ai_tools_company_name_unique')) {
      return new BadRequestException(
        `A tool named "${name}" already exists in this company.`,
      );
    }
    return err instanceof Error ? err : new Error(msg);
  }
}
