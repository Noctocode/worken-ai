import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
    @Query('q') q?: string,
  ) {
    return this.conversationsService.findByProject(projectId, user.id, q);
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

  /**
   * Update the conversation's free-form Chat Context (right-panel
   * "Edit Context", Figma 238:17561). Any project member who can read
   * the conversation can edit its shared context.
   */
  @Patch('conversations/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { context?: string | null },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversationsService.updateContext(
      id,
      user.id,
      body.context ?? null,
    );
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
