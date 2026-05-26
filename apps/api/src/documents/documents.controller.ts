import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { uploadFileFilter } from '../knowledge-core/upload-allowlist.js';
import { KeyResolverService } from '../openrouter/key-resolver.service.js';
import { DocumentsService } from './documents.service.js';

@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly keyResolverService: KeyResolverService,
  ) {}

  @Post('projects/:projectId/documents')
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { content: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const apiKey = await this.keyResolverService.resolveForProject(
      projectId,
      user.id,
    );
    return this.documentsService.create(
      projectId,
      body.content,
      apiKey,
      user.id,
    );
  }

  /**
   * Legacy per-project document upload — the FE no longer calls this
   * route (Knowledge Core supersedes it), but the endpoint is still
   * mounted, so the same upload allowlist that gates KC and the
   * project-scoped chat upload also applies here. Without it, anyone
   * with a token + the URL could push arbitrary files (.zip, .png,
   * .exe) past the multipart layer; the parser would then throw, but
   * the request would already have been buffered.
   */
  @Post('projects/:projectId/documents/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: uploadFileFilter,
    }),
  )
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.documentsService.createFromFile(
      projectId,
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Get('projects/:projectId/documents')
  async findByProject(@Param('projectId') projectId: string) {
    return this.documentsService.findByProject(projectId);
  }

  @Get('projects/:projectId/documents/groups')
  async findGroupsByProject(@Param('projectId') projectId: string) {
    return this.documentsService.findGroupsByProject(projectId);
  }

  @Delete('projects/:projectId/documents/groups/:groupId')
  async removeByGroup(
    @Param('projectId') projectId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.documentsService.removeByGroup(projectId, groupId);
  }

  @Delete('documents/:id')
  async remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
