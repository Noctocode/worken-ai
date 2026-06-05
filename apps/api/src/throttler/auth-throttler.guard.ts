import { ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';

/**
 * The base guard only emits a name-suffixed header (e.g.
 * `Retry-After-auth-login-ip`) because we run named throttlers. Clients
 * expect the standard `Retry-After`, so set it explicitly (seconds until
 * the window — or block — frees up) and return a clean 429 message.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const retryAfter = Math.ceil(
      detail.timeToBlockExpire || detail.timeToExpire || 0,
    );
    res.header('Retry-After', String(retryAfter));
    throw new ThrottlerException('Too many requests. Please try again later.');
  }
}
