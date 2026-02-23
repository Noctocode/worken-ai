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
import { DocumentsService } from './documents.service.js';

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('projects/:projectId/documents')
  async create(
    @Param('projectId') projectId: string,
    @Body() body: { content: string },
  ) {
    return this.documentsService.create(projectId, body.content);
  }

  @Post('projects/:projectId/documents/upload')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
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
