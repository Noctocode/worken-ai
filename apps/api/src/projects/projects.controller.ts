import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import type { CreateProjectDto } from './projects.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/types.js';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

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
    return this.projectsService.create(dto, user.id, user.isPaid);
  }
}
