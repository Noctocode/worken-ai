import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleStrategy } from './google.strategy.js';
import { JwtStrategy } from './jwt.strategy.js';
import { TeamsModule } from '../teams/teams.module.js';

@Module({
  imports: [PassportModule, JwtModule.register({}), TeamsModule],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtStrategy],
})
export class AuthModule {}
