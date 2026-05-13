import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import { ProjectsService } from './projects.service.js';
import type { CreateProjectDto } from './projects.service.js';
import { ProjectKnowledgeService } from './project-knowledge.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

// Shared upload dir with the Knowledge Core controller. Same path,
// same on-disk shape — uploads from Manage Context land alongside
// regular KC uploads so the storage_path saved on the row keeps
// resolving from `uploads/knowledge-core/<uuid>-<name>`. Created
// once at module load so the first request doesn't race the
// directory creation.
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'knowledge-core');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectKnowledge: ProjectKnowledgeService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('filter') filter?: 'all' | 'personal' | 'team',
  ) {
    return this.projectsService.findAll(user.id, filter || 'all');
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.findOne(id, user.id);
  }

  @Post()
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.create(dto, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.remove(id, user.id);
  }

  /* ─── Project ↔ Knowledge Core links ──────────────────────────── */

  @Get(':id/knowledge-files')
  listKnowledgeFiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectKnowledge.listAttached(id, user.id);
  }

  /**
   * Smart-default hint for the Manage Context upload dialog. The
   * FE pre-fills its picker state from this — folder defaults to
   * the caller's "Projects" KC folder; visibility tracks the
   * project's scope (team project → 'teams' with team pre-
   * selected; personal → 'all'). User can override before submit.
   */
  @Get(':id/knowledge-files/upload-defaults')
  uploadDefaults(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectKnowledge.getUploadDefaults(id, user.id);
  }

  @Post(':id/knowledge-files')
  attachKnowledgeFiles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { fileIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectKnowledge.attach(id, body?.fileIds ?? [], user.id);
  }

  @Delete(':id/knowledge-files/:fileId')
  detachKnowledgeFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectKnowledge.detach(id, fileId, user.id);
  }

  /**
   * Upload one or more files from the Manage Context dialog. Body
   * is multipart: `files[]` + optional `folderId`, `visibility`,
   * `teamIds[]`. Routes through KnowledgeCoreService (dedupe +
   * ingestion + visibility validation) and auto-attaches the
   * resulting rows to the project.
   *
   * Same multer config as the KC upload — disk storage in
   * uploads/knowledge-core, 50 MB limit, same MIME / ext
   * allowlist. Inlined here vs sharing because Nest decorators
   * don't compose across modules cleanly.
   */
  @Post(':id/knowledge-files/upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique = randomUUID();
          const safe = file.originalname
            .replace(/[^a-zA-Z0-9_.-]/g, '_')
            .slice(0, 200);
          cb(null, `${unique}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowedExt = /\.(pdf|docx|xlsx?|png|jpe?g)$/i;
        const allowedMime =
          /^(application\/(pdf|vnd\.openxmlformats|vnd\.ms-excel|octet-stream)|image\/(png|jpe?g))/i;
        if (
          !allowedExt.test(file.originalname) ||
          !allowedMime.test(file.mimetype)
        ) {
          cb(
            new BadRequestException(
              `Unsupported file type: ${file.originalname}`,
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadKnowledgeFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      folderId?: string;
      visibility?: string;
      teamIds?: string | string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const teamIds = Array.isArray(body?.teamIds)
      ? body.teamIds
      : body?.teamIds
        ? [body.teamIds]
        : [];
    return this.projectKnowledge.uploadAndAttach(id, user.id, files, {
      folderId: body?.folderId,
      visibility: body?.visibility,
      teamIds,
    });
  }
}
