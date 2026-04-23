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
import { shortcuts } from '@worken/database/schema';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { DATABASE, type Database } from '../database/database.module.js';

const MAX_BODY_LENGTH = 500;

interface CreateShortcutBody {
  label: string;
  body: string;
  category?: string | null;
  description?: string | null;
}

type UpdateShortcutBody = Partial<CreateShortcutBody>;

@Controller('shortcuts')
export class ShortcutsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private assertBodyWithinLimit(body: string) {
    if (body.length > MAX_BODY_LENGTH) {
      throw new BadRequestException(
        `Shortcut body must be ${MAX_BODY_LENGTH} characters or fewer (got ${body.length}).`,
      );
    }
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.db
      .select()
      .from(shortcuts)
      .where(eq(shortcuts.userId, user.id))
      .orderBy(desc(shortcuts.updatedAt));
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [row] = await this.db
      .select()
      .from(shortcuts)
      .where(and(eq(shortcuts.id, id), eq(shortcuts.userId, user.id)));

    if (!row) throw new NotFoundException('Shortcut not found.');
    return row;
  }

  @Post()
  async create(
    @Body() body: CreateShortcutBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body?.label?.trim()) {
      throw new BadRequestException('`label` is required.');
    }
    if (!body?.body?.trim()) {
      throw new BadRequestException('`body` is required.');
    }
    this.assertBodyWithinLimit(body.body);

    const [row] = await this.db
      .insert(shortcuts)
      .values({
        userId: user.id,
        label: body.label.trim(),
        body: body.body,
        category: body.category?.trim() || null,
        description: body.description?.trim() || null,
      })
      .returning();

    return row;
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateShortcutBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const [existing] = await this.db
      .select({ id: shortcuts.id })
      .from(shortcuts)
      .where(and(eq(shortcuts.id, id), eq(shortcuts.userId, user.id)));

    if (!existing) throw new NotFoundException('Shortcut not found.');

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.label !== undefined) {
      if (!body.label.trim()) {
        throw new BadRequestException('`label` cannot be empty.');
      }
      patch.label = body.label.trim();
    }
    if (body.body !== undefined) {
      if (!body.body.trim()) {
        throw new BadRequestException('`body` cannot be empty.');
      }
      this.assertBodyWithinLimit(body.body);
      patch.body = body.body;
    }
    if (body.category !== undefined) {
      patch.category = body.category?.trim() || null;
    }
    if (body.description !== undefined) {
      patch.description = body.description?.trim() || null;
    }

    const [row] = await this.db
      .update(shortcuts)
      .set(patch)
      .where(and(eq(shortcuts.id, id), eq(shortcuts.userId, user.id)))
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
      .delete(shortcuts)
      .where(and(eq(shortcuts.id, id), eq(shortcuts.userId, user.id)))
      .returning({ id: shortcuts.id });

    if (deleted.length === 0) {
      throw new NotFoundException('Shortcut not found.');
    }
  }
}
