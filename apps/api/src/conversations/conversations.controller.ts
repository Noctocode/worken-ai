import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller()
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get('projects/:projectId/conversations')
  findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationsService.findByProject(projectId, user.id);
  }

  @Get('conversations/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.findOne(id, user.id);
  }

  @Post('projects/:projectId/conversations')
  create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationsService.create(projectId, user.id);
  }

  @Delete('conversations/:id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conversationsService.remove(id, user.id);
  }
}
