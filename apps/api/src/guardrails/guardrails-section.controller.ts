import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { GuardrailsSectionService } from './guardrails-section.service.js';

@Controller('guardrails-section')
export class GuardrailsSectionController {
  constructor(private readonly service: GuardrailsSectionService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.id);
  }

  @Get('stats')
  getStats(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getStats(user.id);
  }

  @Get('templates')
  getTemplates() {
    return this.service.getTemplates();
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      type: string;
      severity: string;
      validatorType?: string;
      entities?: string[];
      target?: string;
      onFail?: string;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(body, user.id);
  }

  @Patch(':id/toggle')
  toggle(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.toggle(id, user.id);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, user.id);
  }

  @Post('apply-template')
  applyTemplate(
    @Body() body: { templateId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.applyTemplate(body.templateId, user.id);
  }

  @Patch(':id/assign')
  assignToTeam(
    @Param('id') id: string,
    @Body() body: { teamId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assignToTeam(id, body.teamId, user.id);
  }

  @Patch(':id/unassign')
  unassignFromTeam(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.unassignFromTeam(id, user.id);
  }
}
