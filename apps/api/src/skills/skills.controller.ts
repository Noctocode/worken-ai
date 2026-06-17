import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { parseSkillMd } from './skill-md.parser.js';
import { SkillsService } from './skills.service.js';

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
  constructor(private readonly skills: SkillsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.skills.list(user.id);
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
    return this.skills.create(user.id, {
      name,
      description,
      instructions: parsed.instructions,
      visibility: body.visibility,
      teamIds: body.teamIds,
      projectIds: body.projectIds,
      source: 'import',
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
