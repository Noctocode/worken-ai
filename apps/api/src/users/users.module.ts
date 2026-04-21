import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { MailModule } from '../mail/mail.module.js';
import { OpenRouterModule } from '../openrouter/openrouter.module.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [MailModule, OpenRouterModule, TeamsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
