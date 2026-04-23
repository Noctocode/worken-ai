import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { prompts } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';

interface PromptVariable {
  name: string;
  description?: string;
  default?: string;
}

interface CreatePromptBody {
  title: string;
  description?: string | null;
  body: string;
  category?: string | null;
  tags?: string[];
  variables?: PromptVariable[];
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
}

type UpdatePromptBody = Partial<CreatePromptBody>;

@Controller('prompts')
export class PromptsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private sanitizeTags(tags: unknown): string[] | undefined {
    if (tags === undefined) return undefined;
    if (!Array.isArray(tags)) {
      throw new BadRequestException('`tags` must be an array of strings.');
    }
    return tags
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter(Boolean);
  }

  private sanitizeVariables(
    variables: unknown,
  ): PromptVariable[] | undefined {
    if (variables === undefined) return undefined;
    if (!Array.isArray(variables)) {
      throw new BadRequestException('`variables` must be an array.');
    }
    return variables.map((v) => {
      if (!v || typeof v !== 'object') {
        throw new BadRequestException('Each variable must be an object.');
      }
      const name = (v as { name?: unknown }).name;
      if (typeof name !== 'string' || !name.trim()) {
        throw new BadRequestException('Variable `name` is required.');
      }
      return {
        name: name.trim(),
        description:
          typeof (v as { description?: unknown }).description === 'string'
            ? ((v as { description: string }).description)
            : undefined,
        default:
          typeof (v as { default?: unknown }).default === 'string'
            ? ((v as { default: string }).default)
            : undefined,
      };
    });
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.db
      .select({
        id: prompts.id,
        title: prompts.title,
        description: prompts.description,
        body: prompts.body,
        category: prompts.category,
        tags: prompts.tags,
        createdAt: prompts.createdAt,
        updatedAt: prompts.updatedAt,
      })
      .from(prompts)
      .where(eq(prompts.userId, user.id))
      .orderBy(desc(prompts.updatedAt));

    return rows;
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [row] = await this.db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, user.id)));

    if (!row) throw new NotFoundException('Prompt not found.');
    return row;
  }

  @Post()
  async create(
    @Body() body: CreatePromptBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body?.title?.trim()) {
      throw new BadRequestException('`title` is required.');
    }
    if (!body?.body?.trim()) {
      throw new BadRequestException('`body` is required.');
    }

    const tags = this.sanitizeTags(body.tags) ?? [];
    const variables = this.sanitizeVariables(body.variables) ?? [];

    const [row] = await this.db
      .insert(prompts)
      .values({
        userId: user.id,
        title: body.title.trim(),
        description: body.description?.trim() || null,
        body: body.body,
        category: body.category?.trim() || null,
        tags,
        variables,
        model: body.model?.trim() || null,
        temperature: body.temperature ?? null,
        maxTokens: body.maxTokens ?? null,
        topP: body.topP ?? null,
      })
      .returning();

    return row;
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePromptBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [existing] = await this.db
      .select({ id: prompts.id })
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, user.id)));

    if (!existing) throw new NotFoundException('Prompt not found.');

    const tags = this.sanitizeTags(body.tags);
    const variables = this.sanitizeVariables(body.variables);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) {
      if (!body.title.trim()) {
        throw new BadRequestException('`title` cannot be empty.');
      }
      patch.title = body.title.trim();
    }
    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }
    if (body.body !== undefined) {
      if (!body.body.trim()) {
        throw new BadRequestException('`body` cannot be empty.');
      }
      patch.body = body.body;
    }
    if (body.category !== undefined) {
      patch.category = body.category?.trim() || null;
    }
    if (tags !== undefined) patch.tags = tags;
    if (variables !== undefined) patch.variables = variables;
    if (body.model !== undefined) patch.model = body.model?.trim() || null;
    if (body.temperature !== undefined) patch.temperature = body.temperature;
    if (body.maxTokens !== undefined) patch.maxTokens = body.maxTokens;
    if (body.topP !== undefined) patch.topP = body.topP;

    const [row] = await this.db
      .update(prompts)
      .set(patch)
      .where(and(eq(prompts.id, id), eq(prompts.userId, user.id)))
      .returning();

    return row;
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const deleted = await this.db
      .delete(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, user.id)))
      .returning({ id: prompts.id });

    if (deleted.length === 0) {
      throw new NotFoundException('Prompt not found.');
    }
  }
}
