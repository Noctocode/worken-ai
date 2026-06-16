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
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import {
  AiCronService,
  type CreateScheduledPromptInput,
  type UpdateScheduledPromptInput,
} from './ai-cron.service.js';

@Controller('ai-cron')
export class AiCronController {
  constructor(private readonly service: AiCronService) {}

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
}
