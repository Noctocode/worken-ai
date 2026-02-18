import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
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
