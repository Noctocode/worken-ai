import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'crypto';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { uploadFileFilter } from '../knowledge-core/upload-allowlist.js';
import {
  AiCronService,
  type CreateScheduledPromptInput,
  type UpdateScheduledPromptInput,
} from './ai-cron.service.js';
import { ScheduleKnowledgeService } from './schedule-knowledge.service.js';

// Shared on-disk upload dir with the Knowledge Core / projects controllers.
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'knowledge-core');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('ai-cron')
export class AiCronController {
  constructor(
    private readonly service: AiCronService,
    private readonly scheduleKnowledge: ScheduleKnowledgeService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }

  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.get(id, user.id);
  }

  @Get(':id/runs')
  listRuns(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.listRuns(
      id,
      user.id,
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  // Stateless preview for the schedule builder's advanced cron field. No
  // ownership needed — it only parses the expression the user is typing.
  @Post('validate-cron')
  validateCron(@Body() body: { cronExpression: string; timezone?: string }) {
    return this.service.describeCron(
      body?.cronExpression ?? '',
      body?.timezone,
    );
  }

  @Post()
  create(
    @Body() body: CreateScheduledPromptInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(user.id, body);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateScheduledPromptInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, user.id, body);
  }

  @Post(':id/run-now')
  runNow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.runNow(id, user.id);
  }

  @Post(':id/toggle')
  toggle(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { isEnabled: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setEnabled(id, user.id, !!body?.isEnabled);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.service.remove(id, user.id);
  }

  /* ── Files attached to a schedule (KC visibility='schedule') ──────────── */

  @Get(':id/files')
  listFiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scheduleKnowledge.listAttached(id, user.id);
  }

  @Post(':id/files')
  attachFiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { fileIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scheduleKnowledge.attach(id, body?.fileIds ?? [], user.id);
  }

  @Delete(':id/files/:fileId')
  detachFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scheduleKnowledge.detach(id, fileId, user.id);
  }

  @Post(':id/files/upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const safe = file.originalname
            .replace(/[^a-zA-Z0-9_.-]/g, '_')
            .slice(0, 200);
          cb(null, `${randomUUID()}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: uploadFileFilter,
    }),
  )
  uploadFiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scheduleKnowledge.uploadAndAttach(id, user.id, files);
  }
}
