import { applyDecorators, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { ALL_THROTTLER_NAMES, THROTTLER_NAMES } from './throttler.options';

/**
 * All named throttlers are registered globally, but each auth endpoint
 * only wants two of them. Rather than skip the other six by hand on
 * every handler (easy to get wrong), opt in by name here: enable the
 * given throttlers and skip the rest. The guard is attached per-method
 * (not on the whole controller) so the other AuthController routes —
 * refresh, logout, me, verify — are untouched.
 */
const only = (...active: string[]) => {
  const skip: Record<string, boolean> = {};
  for (const name of ALL_THROTTLER_NAMES) {
    if (!active.includes(name)) skip[name] = true;
  }
  return applyDecorators(UseGuards(AuthThrottlerGuard), SkipThrottle(skip));
};

/** /auth/login — 5/min/IP + 10/hour/email (credential stuffing). */
export const ThrottleLogin = () =>
  only(THROTTLER_NAMES.loginIp, THROTTLER_NAMES.loginEmail);

/** /auth/signup — 3/min/IP + 20/day/IP (account + mail flood). */
export const ThrottleSignup = () =>
  only(THROTTLER_NAMES.signupIpMin, THROTTLER_NAMES.signupIpDay);

/** /auth/resend-verification — 3/hour/email + 10/hour/IP (mail spam). */
export const ThrottleResendVerification = () =>
  only(THROTTLER_NAMES.resendEmail, THROTTLER_NAMES.resendIp);

/** /auth/forgot-password — 3/hour/email + 10/hour/IP (mail spam). */
export const ThrottleForgotPassword = () =>
  only(THROTTLER_NAMES.forgotEmail, THROTTLER_NAMES.forgotIp);

/** POST /skills/:id/run — 10/min/user (executable-skill run flood). */
export const ThrottleSkillRun = () => only(THROTTLER_NAMES.skillRun);
