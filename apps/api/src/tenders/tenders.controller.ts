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
import { TendersService } from './tenders.service.js';

@Controller('tenders')
export class TendersController {
  constructor(private readonly tendersService: TendersService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.tendersService.findAll(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tendersService.findOne(id);
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      code?: string;
      organization?: string;
      description?: string;
      category?: string;
      deadline?: string;
      value?: string;
      requirements?: { title: string; priority: string }[];
      teamMemberIds?: string[];
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.create(body, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      organization?: string;
      description?: string;
      category?: string;
      deadline?: string;
      value?: string;
      matchRate?: number;
      status?: string;
    },
  ) {
    return this.tendersService.update(id, body);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tendersService.remove(id, user.id);
  }
}
