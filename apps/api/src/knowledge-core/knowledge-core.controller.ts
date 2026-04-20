import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { KnowledgeCoreService } from './knowledge-core.service.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'knowledge-core');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '_');
}

@Controller('knowledge-core')
export class KnowledgeCoreController {
  constructor(private readonly service: KnowledgeCoreService) {}

  @Get('folders')
  findAllFolders(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAllFolders(user.id);
  }

  @Get('folders/:id')
  findFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findFolder(id, user.id);
  }

  @Post('folders')
  createFolder(
    @Body() body: { name: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      throw new BadRequestException('Folder name is required');
    }
    return this.service.createFolder(body.name, user.id);
  }

  @Delete('folders/:id')
  deleteFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteFolder(id, user.id);
  }

  @Post('folders/:id/files')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const unique = crypto.randomBytes(8).toString('hex');
          const safe = sanitizeFilename(file.originalname);
          cb(null, `${unique}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowedExt = /\.(pdf|docx?|xlsx?|png|jpe?g)$/i;
        const allowedMime =
          /^(application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|octet-stream)|image\/(png|jpe?g))/i;
        if (
          !allowedExt.test(file.originalname) ||
          !allowedMime.test(file.mimetype)
        ) {
          cb(new BadRequestException(`Unsupported file type: ${file.originalname}`), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadFiles(
    @Param('id') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.uploadFiles(folderId, user.id, files);
  }

  @Get('files/:id/download')
  async downloadFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.service.getFileForDownload(id, user.id);
    res.download(file.storagePath, file.name);
  }

  @Patch('files/:id/move')
  moveFile(
    @Param('id') id: string,
    @Body() body: { targetFolderId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.moveFile(id, body.targetFolderId, user.id);
  }

  @Delete('files/:id')
  deleteFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteFile(id, user.id);
  }

  @Get('recent')
  recentFiles(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recentFiles(user.id);
  }
}
