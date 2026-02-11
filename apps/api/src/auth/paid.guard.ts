import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from './types.js';

@Injectable()
export class PaidGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    if (!request.user?.isPaid) {
      throw new ForbiddenException('This feature requires a paid account');
    }
    return true;
  }
}
