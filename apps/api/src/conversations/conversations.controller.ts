import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
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

  /**
   * 👍 / 👎 feedback on a single message. `score` is 1, -1, or null
   * (null deletes the existing row, matching the FE's toggle-off
   * behavior). Backs the MessageActions component on the project
   * chat page (Figma `Icons` frame in 30:10464 / 168:7221).
   */
  @Post('messages/:id/feedback')
  submitFeedback(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { score: 1 | -1 | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationsService.submitFeedback(id, user.id, body.score);
  }
}
