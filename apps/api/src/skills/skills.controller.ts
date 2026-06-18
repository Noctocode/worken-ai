import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { OrgSettingsService } from '../org-settings/org-settings.service.js';
import { parseSkillMd } from './skill-md.parser.js';
import { SkillArtifactService } from './skill-artifact.service.js';
import { SkillExecutionService } from './skill-execution.service.js';
import { SkillRouterService } from './skill-router.service.js';
import { SkillsService } from './skills.service.js';

interface RunSkillBody {
  /** What to ask the skill to do; optional generic kick-off otherwise. */
  message?: string;
  /** Model to run on (must route to an Anthropic-native model). */
  model: string;
  conversationId?: string;
  projectId?: string;
}

interface CreateSkillBody {
  name: string;
  description: string;
  instructions: string;
  visibility?: string;
  teamIds?: string[];
  projectIds?: string[];
}

type UpdateSkillBody = Partial<
  Pick<CreateSkillBody, 'name' | 'description' | 'instructions'>
>;

interface UpdateVisibilityBody {
  visibility?: string;
  teamIds?: string[];
  projectIds?: string[];
}

interface ImportSkillBody {
  /** Raw SKILL.md content. */
  content: string;
  /** Optional overrides when the frontmatter is missing a field. */
  name?: string;
  description?: string;
  visibility?: string;
  teamIds?: string[];
  projectIds?: string[];
}

@Controller('skills')
export class SkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly execution: SkillExecutionService,
    private readonly orgSettings: OrgSettingsService,
    private readonly router: SkillRouterService,
    private readonly artifacts: SkillArtifactService,
  ) {}

  /** 404 the executable-skills surface unless the tenant flag is on. */
  private async assertExecutableEnabled(userId: string): Promise<void> {
    if (!(await this.orgSettings.isExecutableSkillsEnabled(userId))) {
      throw new NotFoundException('Not found.');
    }
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.skills.list(user.id);
  }

  // ── Executable skills (Option #3) — declared before :id so the literal
  //    `runs` paths win over the param route. ────────────────────────────
  @Get('runs')
  async listRuns(@CurrentUser() user: AuthenticatedUser) {
    await this.assertExecutableEnabled(user.id);
    return this.execution.listRuns(user.id);
  }

  @Get('runs/:id')
  async getRun(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertExecutableEnabled(user.id);
    return this.execution.getRun(user.id, id);
  }

  /** Cancel the caller's in-flight run (abort). */
  @Delete('runs/active')
  async cancelRun(@CurrentUser() user: AuthenticatedUser) {
    await this.assertExecutableEnabled(user.id);
    return { cancelled: this.execution.cancel(user.id) };
  }

  /** The owner's generated artifacts for one run. */
  @Get('runs/:id/artifacts')
  async listArtifacts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.assertExecutableEnabled(user.id);
    return this.artifacts.listForRun(user.id, id);
  }

  /** Stream a generated artifact to its run owner. Always an attachment — the
   *  bytes were authored by untrusted skill code, never rendered inline. */
  @Get('artifacts/:id/download')
  async downloadArtifact(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertExecutableEnabled(user.id);
    const artifact = await this.artifacts.getForDownload(user.id, id);
    res.download(artifact.storagePath, artifact.filename);
  }

  /**
   * Run an executable skill, streaming the agent loop as SSE
   * (`run_started` / `cost_estimate` / `text` / `tool_call` / `tool_result` /
   * `usage` / `artifact` / `done` / `run_done` / `error`). `artifact` events
   * carry files produced by run_script (downloadable via the artifact route);
   * `run_done` carries the run's rolled-up `costUsd`. 404 when the tenant flag
   * is off. The run aborts if the client disconnects.
   */
  @Post(':id/run')
  async run(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RunSkillBody,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertExecutableEnabled(user.id);
    if (!body?.model) {
      throw new BadRequestException('`model` is required.');
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const ev of this.execution.run({
        userId: user.id,
        skillId: id,
        modelIdentifier: body.model,
        userMessage: body.message,
        conversationId: body.conversationId ?? null,
        projectId: body.projectId ?? null,
        signal: controller.signal,
      })) {
        send(ev.type, ev);
      }
    } catch (err) {
      send('error', {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * Skills the caller can pin in THIS context — own (non-project) skills,
   * company-shared skills, and project-scoped skills linked to `projectId`
   * (omit for the project-less arena). Backed by the same accessible-skills
   * query the router uses, so the picker can't offer a skill that wouldn't
   * actually apply here (e.g. another project's project-scoped skill).
   * Declared before `:id` so the literal path wins over the param route.
   */
  @Get('pinnable')
  async pinnable(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    const accessible = await this.router.getAccessibleSkills(
      user.id,
      projectId ?? null,
    );
    return accessible.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.skills.get(id, user.id);
  }

  @Post()
  async create(
    @Body() body: CreateSkillBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.skills.create(user.id, {
      name: body.name,
      description: body.description,
      instructions: body.instructions,
      visibility: body.visibility,
      teamIds: body.teamIds,
      projectIds: body.projectIds,
      source: 'manual',
    });
  }

  /** Import a skill from agentskills.io SKILL.md content. Frontmatter
   *  name/description are used unless overridden in the body. */
  @Post('import')
  async import(
    @Body() body: ImportSkillBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body?.content?.trim()) {
      throw new BadRequestException('`content` (SKILL.md) is required.');
    }
    const parsed = parseSkillMd(body.content);
    const name = body.name?.trim() || parsed.name?.trim();
    const description = body.description?.trim() || parsed.description?.trim();
    if (!name) {
      throw new BadRequestException(
        'SKILL.md is missing a `name` — add it to the frontmatter or pass `name`.',
      );
    }
    if (!description) {
      throw new BadRequestException(
        'SKILL.md is missing a `description` — add it to the frontmatter or pass `description`.',
      );
    }
    if (!parsed.instructions) {
      throw new BadRequestException('SKILL.md has no instructions body.');
    }
    // A SKILL.md carrying named script blocks is an executable skill (#3);
    // otherwise it's an instructional import (#2).
    const isExecutable = parsed.scripts.length > 0;
    return this.skills.create(user.id, {
      name,
      description,
      instructions: parsed.instructions,
      visibility: body.visibility,
      teamIds: body.teamIds,
      projectIds: body.projectIds,
      source: isExecutable ? 'executable' : 'import',
      scripts: isExecutable ? parsed.scripts : undefined,
    });
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateSkillBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.skills.update(id, user.id, body);
  }

  @Patch(':id/visibility')
  async updateVisibility(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateVisibilityBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.skills.updateVisibility(
      id,
      user.id,
      body.visibility,
      body.teamIds,
      body.projectIds,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.skills.delete(id, user.id);
  }
}
